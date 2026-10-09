//! The `run` pipeline (20 §5.4, 21 §10–§16, §19): job → plan → inputs →
//! candidate session → `EngineResult` with its egress self-check.
//!
//! The deterministic section of the result (21 §10) depends only on the
//! binary and the job's semantic sections (20 G5): outputs, budget and
//! process flags never enter it, and host times live in `diagnostics`.

use std::collections::BTreeMap;
use std::time::Instant;

use pmb_contract::job::EngineJob;
use pmb_contract::num::{Decimal, OutDec2, OutDec4, SafeI64, SafeU64, Sha256Hex};
use pmb_contract::result::{
    check_intent_meta_caps, AnomalyValue, CacheStats, CandidateCounters as OutCounters,
    CandidateResult, Diagnostics, EngineMarketOutput, EngineMarketStats, EngineResult, ErrorDetail,
    EventsByType, MarketEcho,
};
use pmb_contract::support::Version;
use pmb_contract::vocab::{self, ErrorClass, InputPath, ResultStatus, SkipReason, StatsSkipReason};
use pmb_core::fixed::{div_round_i128, Rounding};
use pmb_core::Outcome;
use pmb_engine::stats::{CandidateCounters, FinalStats};
use pmb_engine::{NoTrace, Strategy};
use serde::ser::{Serialize, SerializeStruct, Serializer};

use crate::backend::{Backend, CandidateRun, Deadline, RunCtx, RunFailure};
use crate::error::{exit_code_of, EngineError};
use crate::identity::engine_identity;
use crate::inputs::{build_inputs, rules_source_vocab, DecodedInputs};
use crate::job::{parse_job, plan_job, JobPlan, OutputOverrides};
use crate::panic::catch;
use crate::params::StrategyParams;
use crate::trace::{ParityTraceSink, TraceFinal, TraceHeader, Unrounded};

/// Host-time measurements of one job (21 §10 `diagnostics`; never
/// compared, never persisted).
#[derive(Clone, Debug)]
pub struct JobClock {
    started_wall_ms: u64,
    started: Instant,
}

impl JobClock {
    /// Starts measuring now.
    pub fn start() -> JobClock {
        JobClock::started_at(Instant::now(), crate::log::wall_ms())
    }

    /// A clock whose job started at `started` (wall time `started_wall_ms`):
    /// the injection point that lets tests drive the real deadline checks.
    pub fn started_at(started: Instant, started_wall_ms: u64) -> JobClock {
        JobClock {
            started_wall_ms,
            started,
        }
    }

    /// The job's deadline: `budget.wallMs` after the job started
    /// (20 §6.3 S4), so decoding counts against the budget.
    pub fn deadline(&self, wall_ms: u32) -> Deadline {
        Deadline::from_start(self.started, u64::from(wall_ms))
    }

    fn diagnostics(
        &self,
        skew_ms: Option<i64>,
        input_path: InputPath,
        anomalies: BTreeMap<String, AnomalyValue>,
        counters: Vec<OutCounters>,
    ) -> Diagnostics {
        let elapsed = self.started.elapsed().as_millis() as u64;
        let safe = |v: u64| SafeU64::new(v).unwrap_or(SafeU64::new(0).expect("zero is safe"));
        Diagnostics {
            started_at_ms: safe(self.started_wall_ms),
            finished_at_ms: safe(self.started_wall_ms + elapsed),
            wall_ms: safe(elapsed),
            busy_ms: safe(elapsed),
            // D-PENDING: per-thread CPU time and peak RSS need getrusage
            // (unsafe FFI, forbidden by the workspace lints); M5a decides the
            // measurement. cpuMs reports the job thread's busy time, RSS 0.
            cpu_ms: safe(elapsed),
            peak_rss_bytes: safe(0),
            thread: 0,
            cache: CacheStats {
                hits: safe(0),
                misses: safe(0),
            },
            skew_ms: skew_ms.and_then(SafeI64::new),
            input_path,
            anomalies,
            counters,
        }
    }
}

/// Default job-thread stack (16 EX-6, 20 G11).
pub const DEFAULT_STACK_MB: usize = 8;

/// Runs `f` on a spawned engine thread with the job stack size (20 G11),
/// so a strategy that runs under `run` also runs under `serve`. A panic
/// escaping `f` is an `engine_fault`.
pub fn on_job_thread<R: Send>(
    stack_bytes: usize,
    f: impl FnOnce() -> R + Send,
) -> Result<R, EngineError> {
    std::thread::scope(|s| {
        let h = std::thread::Builder::new()
            .name("pmb-job".into())
            .stack_size(stack_bytes)
            .spawn_scoped(s, f)
            .map_err(|e| {
                EngineError::runtime("resource", format!("spawning the job thread: {e}"))
            })?;
        h.join()
            .map_err(|p| EngineError::engine_fault("panic", crate::panic::payload_text(p.as_ref())))
    })
}

/// The result of a `run`, with its exit code (20 §5.4) and stderr reason.
#[derive(Clone, Debug)]
pub struct RunOutcome {
    /// The `EngineResult`.
    pub result: EngineResult,
    /// Exit code: 0 when the group and the candidate are `ok`, else the
    /// class code (20 §5.4).
    pub exit_code: i32,
    /// One-line reason for a non-zero exit (20 §4).
    pub reason: Option<String>,
}

impl RunOutcome {
    fn from_result(result: EngineResult) -> RunOutcome {
        let err = match (&result.error, result.candidates.first()) {
            (Some(e), _) => Some(e.clone()),
            (None, Some(c)) => c.error.clone(),
            (None, None) => None,
        };
        match err {
            Some(e) => RunOutcome {
                exit_code: exit_code_of(e.class),
                reason: Some(crate::error::one_line(
                    &e.reason_text(),
                    crate::error::MESSAGE_MAX_CHARS,
                )),
                result,
            },
            None => RunOutcome {
                result,
                exit_code: 0,
                reason: None,
            },
        }
    }

    /// The stdout document (20 G1).
    pub fn document(&self) -> String {
        serde_json::to_string(&self.result).expect("EngineResult serializes")
    }
}

fn placeholder_digest() -> Sha256Hex {
    Sha256Hex::from_digest(&[0; 32])
}

/// Sets `resultDigest` and runs the egress self-check (21 §19). A failure
/// replaces the result with an `invalid_output: self_check` error.
fn seal(mut r: EngineResult, clock: &JobClock) -> EngineResult {
    let checked = r
        .compute_digest()
        .map_err(|e| EngineError::invalid_output("self_check", format!("digest: {e}")))
        .and_then(|d| {
            r.result_digest = d;
            r.validate().map_err(EngineError::from)
        });
    match checked {
        Ok(()) => r,
        Err(e) => {
            let echo = r.echo.take();
            let market = r.market.take();
            let mut bad = group_error(e, echo, market, clock);
            // The fallback document must itself be valid; drop what is not.
            if bad.validate().is_err() {
                bad.market = None;
                bad.echo = None;
                if let Ok(d) = bad.compute_digest() {
                    bad.result_digest = d;
                }
            }
            bad
        }
    }
}

fn group_error(
    e: EngineError,
    echo: Option<pmb_contract::result::Echo>,
    market: Option<MarketEcho>,
    clock: &JobClock,
) -> EngineResult {
    let mut r = EngineResult {
        output_schema_version: Version,
        status: ResultStatus::Error,
        error: Some(e.info()),
        echo,
        market,
        candidates: Vec::new(),
        result_digest: placeholder_digest(),
        diagnostics: clock.diagnostics(None, InputPath::V1, BTreeMap::new(), Vec::new()),
    };
    if let Ok(d) = r.compute_digest() {
        r.result_digest = d;
    }
    r
}

/// A group-level error result (21 §10) with its exit code.
pub fn error_outcome(
    e: EngineError,
    echo: Option<pmb_contract::result::Echo>,
    clock: &JobClock,
) -> RunOutcome {
    RunOutcome::from_result(seal(group_error(e, echo, None, clock), clock))
}

/// Serializes the deterministic section (every field but `diagnostics`,
/// 21 §10) in type order; equal bytes ⇔ equal deterministic results.
pub fn deterministic_json(r: &EngineResult) -> String {
    struct Det<'a>(&'a EngineResult);
    impl Serialize for Det<'_> {
        fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let r = self.0;
            let mut st = s.serialize_struct("EngineResult", 7)?;
            st.serialize_field("outputSchemaVersion", &r.output_schema_version)?;
            st.serialize_field("status", &r.status)?;
            st.serialize_field("error", &r.error)?;
            st.serialize_field("echo", &r.echo)?;
            st.serialize_field("market", &r.market)?;
            st.serialize_field("candidates", &r.candidates)?;
            st.serialize_field("resultDigest", &r.result_digest)?;
            st.end()
        }
    }
    serde_json::to_string(&Det(r)).expect("EngineResult serializes")
}

fn safe_u64(v: u64, what: &str) -> Result<SafeU64, EngineError> {
    SafeU64::new(v)
        .ok_or_else(|| EngineError::invalid_output("self_check", format!("{what} above 2^53-1")))
}

fn count_u32(v: u64, what: &str) -> Result<u32, EngineError> {
    u32::try_from(v)
        .ok()
        .filter(|n| *n <= i32::MAX as u32)
        .ok_or_else(|| EngineError::invalid_output("self_check", format!("{what} above 2^31-1")))
}

/// BUY VWAP at 4 dp, half away from zero, from the exact i128 sums
/// (21 §11 `avgEntryPrice*`): Σ(price × qty) / Σ qty, one rounding.
fn avg_entry(num_den: (i128, i128)) -> Result<Option<OutDec4>, EngineError> {
    let (num, den) = num_den;
    if den == 0 {
        return Ok(None);
    }
    // num is micros², den micros; price micros = num / den; 4 dp units =
    // price micros / 100.
    let units = div_round_i128(num, den * 100, Rounding::HalfAwayFromZero)
        .map_err(|e| EngineError::engine_fault("invariant", format!("avg entry price: {e}")))?;
    let units = i64::try_from(units)
        .map_err(|_| EngineError::engine_fault("invariant", "avg entry price out of range"))?;
    Ok(Some(OutDec4::from_units(units)))
}

/// `MarketStats` from the unrounded final values (21 §11; quantization
/// half away from zero once, at output, D08).
pub fn market_stats(
    slug: &str,
    market_id: &str,
    outcome: vocab::Outcome,
    s: &FinalStats,
    intent_meta: Vec<serde_json::Map<String, serde_json::Value>>,
    zero_row: bool,
) -> Result<EngineMarketStats, EngineError> {
    let q2 = OutDec2::from_micros_half_away;
    let up = s.shares[Outcome::Up];
    let down = s.shares[Outcome::Down];
    Ok(EngineMarketStats {
        market_id: market_id.to_string(),
        slug: slug.to_string(),
        final_outcome: outcome,
        pnl: q2(s.pnl.micros()),
        trade_count: count_u32(s.trade_count, "tradeCount")?,
        trade_as_maker: count_u32(s.trade_as_maker, "tradeAsMaker")?,
        trade_as_taker: count_u32(s.trade_as_taker, "tradeAsTaker")?,
        fees_paid: q2(s.fees_paid.micros()),
        avg_entry_price_up: avg_entry(s.buy_vwap[Outcome::Up])?,
        avg_entry_price_down: avg_entry(s.buy_vwap[Outcome::Down])?,
        up_shares: q2(up),
        down_shares: q2(down),
        // min(up, down) on micros before rounding (21 §11).
        mergable_shares: q2(up.min(down)),
        cost: q2(s.cost.micros()),
        split_cost: q2(s.split_cost.micros()),
        intent_meta,
        skip_reason: zero_row.then_some(StatsSkipReason::NoInWindowActivity),
        // ts-compat outputs `rules: null` (11 §13.8, 21 §7.2).
        rules: Some(None),
    })
}

/// The candidate's `EngineMarketOutput` and the 21 §13 null/zero-row
/// taxonomy decided by the engine.
pub fn market_output(
    slug: &str,
    market_id: Option<&str>,
    outcome: vocab::Outcome,
    run: &CandidateRun,
) -> Result<EngineMarketOutput, EngineError> {
    let ticks = &run.acc.ticks;
    let events_processed = ticks.events_processed();
    let events_by_type = EventsByType::from_counts(ticks.by_cause)
        .ok_or_else(|| EngineError::invalid_output("self_check", "eventsByType above 2^53-1"))?;
    let (market_stats, skip_reason) = if events_processed == 0 {
        (None, Some(SkipReason::NoActivity))
    } else {
        let id = market_id.ok_or_else(|| {
            EngineError::engine_fault("invariant", "counted ticks without a market id (21 §11)")
        })?;
        let s = &run.stats;
        let zero_row =
            s.trade_count == 0 && s.shares[Outcome::Up] <= 0 && s.shares[Outcome::Down] <= 0;
        let stats = market_stats(slug, id, outcome, s, run.intent_meta.clone(), zero_row)?;
        (Some(stats), zero_row.then_some(SkipReason::NoActivity))
    };
    Ok(EngineMarketOutput {
        slug: slug.to_string(),
        market_stats,
        events_processed: safe_u64(events_processed, "eventsProcessed")?,
        events_by_type,
        skip_reason,
        coverage_reasons: None,
    })
}

/// Capital-aware counters for `diagnostics.counters` (21 §10).
pub fn counters_of(key: &str, c: &CandidateCounters, skipped: u64) -> OutCounters {
    let safe = |v: u64| SafeU64::new(v).unwrap_or(SafeU64::new(0).expect("zero is safe"));
    let mut rejected: BTreeMap<String, u64> = BTreeMap::new();
    for (reason, n) in &c.orders_rejected {
        *rejected.entry(reason.code().to_string()).or_default() += n;
    }
    OutCounters {
        key: key.to_string(),
        orders_placed: safe(c.orders_placed),
        orders_rejected: rejected.into_iter().map(|(k, v)| (k, safe(v))).collect(),
        orders_canceled: safe(c.orders_canceled),
        buy_notional_usdc: Decimal::from_micros(c.buy_notional.micros()),
        sell_notional_usdc: Decimal::from_micros(c.sell_notional.micros()),
        peak_reserved_usdc: Decimal::from_micros(c.peak_reserved.micros()),
        strategy_ticks_skipped: safe(skipped),
    }
}

/// Runs a job document through the whole pipeline with `backend`.
pub fn run_job_bytes<T, B>(
    bytes: &[u8],
    overrides: &OutputOverrides,
    backend: &B,
    clock: &JobClock,
) -> RunOutcome
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    let job = match parse_job(bytes) {
        Ok(j) => j,
        Err(e) => return error_outcome(e, None, clock),
    };
    run_job::<T, B>(job, overrides, backend, clock, build_inputs)
}

/// Runs a parsed job; `inputs` is the input seam (the telonex-delta file
/// reader in production, an in-memory tape in selftest).
pub fn run_job<T, B>(
    job: EngineJob,
    overrides: &OutputOverrides,
    backend: &B,
    clock: &JobClock,
    inputs: impl FnOnce(
        &EngineJob,
        pmb_core::rules::RulesTableVersion,
    ) -> Result<DecodedInputs, EngineError>,
) -> RunOutcome
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    let plan = match plan_job::<T>(job, overrides) {
        Ok(p) => p,
        Err(je) => return error_outcome(je.error, je.echo.map(|e| *e), clock),
    };
    // Engine panics anywhere below are engine faults (12 §11).
    let echo = plan.echo.clone();
    match catch(|| -> Result<RunOutcome, EngineError> {
        let decoded = inputs(&plan.job, plan.rules_table)?;
        Ok(execute_plan::<T, B>(&plan, &decoded, backend, clock))
    }) {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => error_outcome(e, Some(echo), clock),
        Err(p) => error_outcome(
            EngineError::engine_fault("panic", p.message.clone()).with_detail(ErrorDetail {
                location: p.location,
                ..ErrorDetail::default()
            }),
            Some(echo),
            clock,
        ),
    }
}

fn candidate_error(e: EngineError, key: &str, index: u32, sha: &Sha256Hex) -> CandidateResult {
    CandidateResult {
        key: key.to_string(),
        index,
        status: ResultStatus::Error,
        model_config_sha256: sha.clone(),
        output: None,
        error: Some(e.info()),
    }
}

/// Runs the planned candidate over the decoded market and assembles the
/// result (21 §10).
pub fn execute_plan<T, B>(
    plan: &JobPlan<T::Params>,
    inputs: &DecodedInputs,
    backend: &B,
    clock: &JobClock,
) -> RunOutcome
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    let job = &plan.job;
    let cand = &plan.candidate;
    let slug = job.market.slug.as_str();
    // `market.conditionId` is the market id of the first counted tick
    // (21 §10, §11): a property of the input, identical for every
    // candidate, so it does not depend on whether a candidate faulted.
    let market = MarketEcho {
        slug: slug.to_string(),
        condition_id: inputs.first_counted_market_id().map(str::to_string),
        rules_source: rules_source_vocab(inputs.rules_source),
    };

    // 30 §4 rule 3: requirements and interests again at job start; they
    // must equal the describe-time evaluation, else the job fails: a
    // group-level strategy_fault. No callback or tick was involved, so the
    // detail carries no callback, seq or tsMs.
    let again = catch(|| (T::requirements(&cand.params), T::interests(&cand.params)));
    let inconsistent = match again {
        Ok((r, i)) if r == cand.requirements && i == cand.interests => None,
        Ok(_) => Some(EngineError::strategy_fault(
            "error",
            "requirements/interests differ between describe and job start (30 §4 rule 3)",
        )),
        Err(p) => Some(
            EngineError::strategy_fault(
                "panic",
                format!("panic in requirements/interests: {}", p.message),
            )
            .with_detail(ErrorDetail {
                location: p.location,
                ..ErrorDetail::default()
            }),
        ),
    };
    if let Some(e) = inconsistent {
        return finish_group_error(e, plan, market, inputs, clock);
    }

    let deadline = clock.deadline(job.budget.wall_ms);
    if deadline.expired() {
        // The budget was spent decoding the inputs (20 §6.3 S4).
        return finish_group_error(deadline.error(), plan, market, inputs, clock);
    }
    let cx = RunCtx {
        inputs,
        run_seed: job.run.model_config.seed.get(),
        input_mode: job.run.input_mode,
        deadline: &deadline,
    };

    let mut sink = match &plan.trace {
        None => None,
        Some(t) => {
            let id = engine_identity();
            let header = TraceHeader {
                engine_version: id.engine_version,
                profile: job.run.model_config.profile,
                slug,
                candidate_key: &cand.key,
                level: t.level,
            };
            match ParityTraceSink::create(&t.path, &header) {
                Ok(s) => Some(s),
                Err(e) => return finish_group_error(e, plan, market, inputs, clock),
            }
        }
    };

    // Engine panics are engine faults of the job (12 §11); strategy panics
    // are caught inside the session and arrive as `RunFailure::Strategy`.
    let run = catch(|| match sink.as_mut() {
        Some(s) => backend.run_candidate(&cx, cand, s),
        None => backend.run_candidate(&cx, cand, NoTrace),
    })
    .unwrap_or_else(|p| {
        Err(RunFailure::Group(
            EngineError::engine_fault("panic", p.message).with_detail(ErrorDetail {
                location: p.location,
                ..ErrorDetail::default()
            }),
        ))
    });

    let (cand_result, skew, counters) = match run {
        Err(RunFailure::Group(e)) => {
            if let Some(s) = sink {
                s.abort();
            }
            return finish_group_error(e, plan, market, inputs, clock);
        }
        Err(RunFailure::Strategy {
            cause,
            message,
            callback,
            seq,
            at,
        }) => {
            // D-PENDING: 22 §3.1 gives every (market, candidate) a file that
            // ends in `final`, but a faulted candidate has no final values
            // (21 §13) and 22 defines no terminal record for it, so its trace
            // file is not written (spec question).
            if let Some(s) = sink {
                s.abort();
            }
            // A fault in `new` happens before the first strategy tick: there
            // is no tick seq or loop time to report (21 §10 detail).
            let tick = callback != "new";
            let e = EngineError::strategy_fault(cause, message).with_detail(ErrorDetail {
                callback: Some(callback.to_string()),
                seq: tick.then(|| SafeU64::new(seq)).flatten(),
                ts_ms: tick
                    .then(|| u64::try_from(at.0).ok().and_then(SafeU64::new))
                    .flatten(),
                ..ErrorDetail::default()
            });
            (
                candidate_error(e, &cand.key, cand.index, &cand.model_config_sha256),
                None,
                Vec::new(),
            )
        }
        Ok(run) => {
            if run.counted_tick_seen != market.condition_id.is_some() {
                if let Some(s) = sink {
                    s.abort();
                }
                let e = EngineError::engine_fault(
                    "invariant",
                    "the session's counted ticks disagree with the input (21 §11 marketId)",
                );
                return finish_group_error(e, plan, market, inputs, clock);
            }
            let built = check_intent_meta_caps(&run.intent_meta)
                .map_err(|cause| {
                    EngineError::strategy_fault(
                        cause,
                        "intentMeta above the per-market caps (21 §16)",
                    )
                })
                .and_then(|()| {
                    market_output(
                        slug,
                        market.condition_id.as_deref(),
                        job.market.outcome,
                        &run,
                    )
                });
            let out = match built {
                Ok(o) => o,
                Err(e) if e.class == ErrorClass::StrategyFault => {
                    if let Some(s) = sink {
                        s.abort();
                    }
                    let r = candidate_error(e, &cand.key, cand.index, &cand.model_config_sha256);
                    return finish(plan, market, inputs, clock, r, run.skew_ms, Vec::new());
                }
                Err(e) => {
                    if let Some(s) = sink {
                        s.abort();
                    }
                    return finish_group_error(e, plan, market, inputs, clock);
                }
            };
            if let Some(s) = sink {
                let fin = TraceFinal {
                    stats: out.market_stats.as_ref(),
                    skip_reason: out.skip_reason,
                    events_processed: out.events_processed.get(),
                    events_by_type: &out.events_by_type,
                    unrounded: Unrounded::from_stats(&run.stats),
                };
                if let Err(e) = s.finish(&fin) {
                    return finish_group_error(e, plan, market, inputs, clock);
                }
            }
            let counters = vec![counters_of(
                &cand.key,
                &run.acc.counters,
                run.acc.ticks.strategy_ticks_skipped,
            )];
            (
                CandidateResult {
                    key: cand.key.clone(),
                    index: cand.index,
                    status: ResultStatus::Ok,
                    model_config_sha256: cand.model_config_sha256.clone(),
                    output: Some(out),
                    error: None,
                },
                run.skew_ms,
                counters,
            )
        }
    };
    finish(plan, market, inputs, clock, cand_result, skew, counters)
}

fn finish<P>(
    plan: &JobPlan<P>,
    market: MarketEcho,
    inputs: &DecodedInputs,
    clock: &JobClock,
    cand: CandidateResult,
    skew: Option<i64>,
    counters: Vec<OutCounters>,
) -> RunOutcome {
    let r = EngineResult {
        output_schema_version: Version,
        status: ResultStatus::Ok,
        error: None,
        echo: Some(plan.echo.clone()),
        market: Some(market),
        candidates: vec![cand],
        result_digest: placeholder_digest(),
        diagnostics: clock.diagnostics(skew, inputs.input_path, inputs.anomalies.clone(), counters),
    };
    RunOutcome::from_result(seal(r, clock))
}

fn finish_group_error<P>(
    e: EngineError,
    plan: &JobPlan<P>,
    market: MarketEcho,
    inputs: &DecodedInputs,
    clock: &JobClock,
) -> RunOutcome {
    let mut r = group_error(e, Some(plan.echo.clone()), Some(market), clock);
    r.diagnostics = clock.diagnostics(
        None,
        inputs.input_path,
        inputs.anomalies.clone(),
        Vec::new(),
    );
    RunOutcome::from_result(seal(r, clock))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::{PerOutcome, Usdc};

    fn stats() -> FinalStats {
        FinalStats {
            pnl: Usdc::from_micros(-1_005_000),
            trade_count: 3,
            trade_as_maker: 1,
            trade_as_taker: 2,
            fees_paid: Usdc::from_micros(174_400),
            // 2 × 0.5123 + 1 × 0.51235 → (1.53695 / 3) = 0.51231666… → 0.5123
            buy_vwap: PerOutcome::new(
                (2 * 512_300 * 1_000_000 + 512_350 * 1_000_000, 3_000_000),
                (0, 0),
            ),
            shares: PerOutcome::new(10_005_000, 2_004_999),
            cost: Usdc::from_micros(5_125_000),
            split_cost: Usdc::ZERO,
            cash_end: Usdc::ZERO,
            cash_start: Usdc::ZERO,
            intent_meta: Vec::new(),
        }
    }

    #[test]
    fn stats_quantize_half_away_once() {
        // spec: 21 §11 (2 dp / 4 dp, half away from zero; mergable on micros), 10 §4 Q1–Q3
        let s = market_stats(
            "btc-updown-15m-1780272000",
            "0xab",
            vocab::Outcome::Up,
            &stats(),
            Vec::new(),
            false,
        )
        .unwrap();
        assert_eq!(s.pnl.units(), -101);
        assert_eq!(s.fees_paid.units(), 17);
        assert_eq!(s.avg_entry_price_up.unwrap().units(), 5123);
        assert_eq!(s.avg_entry_price_down, None);
        assert_eq!(s.up_shares.units(), 1001);
        assert_eq!(s.down_shares.units(), 200);
        assert_eq!(s.mergable_shares.units(), 200);
        assert_eq!(s.cost.units(), 513);
        assert!(s.self_check().is_ok());
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"pnl\":-1.01"), "{json}");
        assert!(json.contains("\"avgEntryPriceUp\":0.5123"), "{json}");
    }

    #[test]
    fn avg_entry_rounds_ties_away_from_zero() {
        // 0.51235 exactly → 0.5124 (tie, half away from zero)
        assert_eq!(
            avg_entry((512_350 * 1_000_000, 1_000_000))
                .unwrap()
                .unwrap()
                .units(),
            5124
        );
        assert_eq!(avg_entry((0, 0)).unwrap(), None);
    }
}
