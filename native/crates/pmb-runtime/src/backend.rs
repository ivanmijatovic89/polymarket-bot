//! The seam between the runtime and the engine for one candidate × market
//! (12 §2.1, §5.1, §11; 30 §4 rule 1).
//!
//! [`Backend`] is generic over the strategy and the trace sink: the
//! production [`EngineBackend`] monomorphizes `Session<T, E, K>` in the
//! strategy's bin crate and never boxes the strategy (30 §4 rule 1, 12 §14
//! P6). Tests drive the rest of the run pipeline through their own backend
//! while the engine bodies are being implemented.

use std::time::{Duration, Instant};

use pmb_contract::vocab::{InputMode, Profile};
use pmb_core::ids::MetaId;
use pmb_core::seed::{market_seed, RunSeed};
use pmb_core::{MarketEvent, TsMs};
use pmb_engine::config::EngineConfig;
use pmb_engine::envelope::{Envelope, Payload, Source};
use pmb_engine::exec::{ExecDiagnostics, TimerFired};
use pmb_engine::session::{drive, SessionFault, StrategyFaultCause};
use pmb_engine::stats::{FinalStats, MarketStatsAcc};
use pmb_engine::trace::TraceSink;
use pmb_engine::{EventQueue, ExecCommand, ExecCtx, Execution, Session, SharedMarket, Strategy};
use serde_json::{Map, Value};

use crate::error::EngineError;
use crate::inputs::DecodedInputs;
use crate::job::CandidatePlan;

/// Engine events between cooperative deadline checks (20 §6.3 S4).
pub const DEADLINE_CHECK_EVENTS: usize = 4096;

/// The job's cooperative deadline (`budget.wallMs`, 20 §6.3 S4). Host time
/// is used only to stop the job, never inside a decision.
#[derive(Copy, Clone, Debug)]
pub struct Deadline {
    at: Instant,
    budget_ms: u64,
}

impl Deadline {
    /// A deadline `wall_ms` from now.
    pub fn after_ms(wall_ms: u64) -> Deadline {
        Deadline::from_start(Instant::now(), wall_ms)
    }

    /// A deadline `wall_ms` after `start` (the job's start).
    pub fn from_start(start: Instant, wall_ms: u64) -> Deadline {
        Deadline {
            at: start + Duration::from_millis(wall_ms),
            budget_ms: wall_ms,
        }
    }

    /// Whether the budget is spent.
    pub fn expired(&self) -> bool {
        Instant::now() >= self.at
    }

    /// The `timeout: deadline` error (20 §4).
    pub fn error(&self) -> EngineError {
        EngineError::timeout(format!(
            "job exceeded its budget of {} ms (budget.wallMs)",
            self.budget_ms
        ))
    }
}

/// Run-level context of one market (immutable, shared by candidates).
pub struct RunCtx<'a> {
    /// Decoded inputs.
    pub inputs: &'a DecodedInputs,
    /// Run seed (10 RNG-1).
    pub run_seed: u64,
    /// Input mode of the job.
    pub input_mode: InputMode,
    /// Cooperative deadline.
    pub deadline: &'a Deadline,
}

/// What a finished candidate session returns (21 §11, 22 §2 `Final`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CandidateRun {
    /// Unrounded final values.
    pub stats: FinalStats,
    /// Tick and capital-aware counters.
    pub acc: MarketStatsAcc,
    /// `intentMeta` objects in fill order (21 §16).
    pub intent_meta: Vec<Map<String, Value>>,
    /// Whether a counted tick was seen (sets `marketId`, 21 §11).
    pub counted_tick_seen: bool,
    /// Final exchange-time skew (12 §4.4 XT4; diagnostics only).
    pub skew_ms: Option<i64>,
}

/// Why a candidate did not finish (12 §11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunFailure {
    /// `strategy_fault` of this candidate; other candidates continue.
    Strategy {
        /// Cause (20 §4.1: `panic`, `error`, `cascade_limit`,
        /// `intent_meta_limit`).
        cause: &'static str,
        /// Message.
        message: String,
        /// Callback kind (`onMarketTick`, `onAccountEvent`, `new`).
        callback: &'static str,
        /// Strategy-tick seq at the fault.
        seq: u64,
        /// Loop time at the fault.
        at: TsMs,
    },
    /// A group-level error: the job fails (engine fault, deadline, ...).
    Group(EngineError),
}

impl From<SessionFault> for RunFailure {
    fn from(f: SessionFault) -> RunFailure {
        match f {
            SessionFault::Strategy {
                cause,
                callback,
                tick_seq,
                at,
            } => {
                let (cause, message) = match cause {
                    StrategyFaultCause::Panic { message } => ("panic", message),
                    StrategyFaultCause::Error { message } => ("error", message),
                    StrategyFaultCause::CascadeLimit {
                        seq,
                        tick,
                        deliveries,
                    } => (
                        "cascade_limit",
                        format!(
                            "cascade budget exceeded: {deliveries} deliveries (envelope {seq}, tick {tick})"
                        ),
                    ),
                    StrategyFaultCause::IntentMetaLimit => (
                        "intent_meta_limit",
                        "intentMeta above the per-market caps (21 §16)".to_string(),
                    ),
                };
                RunFailure::Strategy {
                    cause,
                    message,
                    callback,
                    seq: tick_seq,
                    at,
                }
            }
            SessionFault::Engine { message } => {
                RunFailure::Group(EngineError::engine_fault("invariant", message))
            }
        }
    }
}

impl From<EngineError> for RunFailure {
    fn from(e: EngineError) -> RunFailure {
        RunFailure::Group(e)
    }
}

/// Runs one candidate over one decoded market (12 §2.1).
pub trait Backend<T: Strategy>: Sync {
    /// Creates the session, drives every envelope, ends the stream and
    /// finalizes (12 §5.1, §9.6). Engine events go to `sink` (22 §2).
    fn run_candidate<K: TraceSink>(
        &self,
        cx: &RunCtx<'_>,
        cand: &CandidatePlan<T::Params>,
        sink: K,
    ) -> Result<CandidateRun, RunFailure>;
}

/// Creates the execution adapter of a session (13 §2.2; ts-compat
/// simulator in backtest).
pub trait ExecFactory: Sync {
    /// The adapter type.
    type Exec: Execution;
    /// Refuses a profile this factory cannot serve, before the session is
    /// configured. A missing capability is a refusal, never an engine fault
    /// (20 §4: `engine_fault` means an engine bug and raises an alert).
    fn check(&self, _profile: Profile) -> Result<(), EngineError> {
        Ok(())
    }
    /// An adapter for one session.
    fn create(&self, cfg: &EngineConfig) -> Result<Self::Exec, EngineError>;
}

/// An execution adapter that cannot exist: the production binary's
/// adapter until the simulator (pmb-engine `exec::sim`) is wired.
#[derive(Debug)]
pub enum NoExecution {}

impl Execution for NoExecution {
    fn submit(&mut self, _: TsMs, _: ExecCommand<'_>, _: &ExecCtx<'_>, _: &mut EventQueue) {
        match *self {}
    }
    fn next_due(&self) -> Option<TsMs> {
        match *self {}
    }
    fn run_next_due(&mut self, _: &ExecCtx<'_>, _: &mut EventQueue) {
        match *self {}
    }
    fn on_timer(&mut self, _: &TimerFired, _: &ExecCtx<'_>, _: &mut EventQueue) {
        match *self {}
    }
    fn on_market_event(
        &mut self,
        _: TsMs,
        _: &MarketEvent<'_>,
        _: &ExecCtx<'_>,
        _: &mut EventQueue,
    ) {
        match *self {}
    }
    fn diagnostics(&self) -> &ExecDiagnostics {
        match *self {}
    }
}

/// The factory of the production binary before integration: refuses every
/// profile loudly, as `invalid_input: profile` (exit 2, never retried, no
/// alert), before any engine code runs.
// D-PENDING: `capabilities.profiles` still lists ts-compat for such a
// binary; it fails selftest (`run_path`), which the worker gate runs before
// any job (20 §5.3), so it is never given work.
#[derive(Copy, Clone, Debug, Default)]
pub struct UnwiredSimulator;

impl UnwiredSimulator {
    fn refusal(profile: Profile) -> EngineError {
        EngineError::invalid_input(
            "profile",
            format!(
                "profile {profile} needs the execution simulator (pmb-engine exec::sim), \
                 which is not wired into this pre-integration binary"
            ),
        )
    }
}

impl ExecFactory for UnwiredSimulator {
    type Exec = NoExecution;
    fn check(&self, profile: Profile) -> Result<(), EngineError> {
        Err(UnwiredSimulator::refusal(profile))
    }
    fn create(&self, cfg: &EngineConfig) -> Result<NoExecution, EngineError> {
        // TODO(integration): `pmb_engine::exec::sim::simulator::Simulator::new(cfg)`.
        let profile = if cfg.core_rules.is_ts_compat() {
            Profile::TsCompat
        } else {
            Profile::Realistic
        };
        Err(UnwiredSimulator::refusal(profile))
    }
}

/// The production backend: `pmb-engine` sessions over the decoded market.
#[derive(Copy, Clone, Debug, Default)]
pub struct EngineBackend<F> {
    factory: F,
}

impl<F> EngineBackend<F> {
    /// A backend creating adapters with `factory`.
    pub const fn new(factory: F) -> EngineBackend<F> {
        EngineBackend { factory }
    }
}

impl<T: Strategy, F: ExecFactory> Backend<T> for EngineBackend<F> {
    fn run_candidate<K: TraceSink>(
        &self,
        cx: &RunCtx<'_>,
        cand: &CandidatePlan<T::Params>,
        sink: K,
    ) -> Result<CandidateRun, RunFailure> {
        self.factory.check(cand.model_config.profile)?;
        let seed = RunSeed::new(cx.run_seed)
            .map_err(|e| EngineError::invalid_input("model_config", format!("seed: {e:?}")))?;
        let ms = market_seed(seed, &cx.inputs.info.slug);
        let cfg = EngineConfig::from_model_config(&cand.model_config, cx.input_mode, ms)
            .map_err(|e| EngineError::invalid_input("model_config", e.message))?;
        let exec = self.factory.create(&cfg)?;
        run_session::<T, F::Exec, K>(cx, &cand.params, cfg, exec, sink)
    }
}

/// The envelope of tape event `i` (12 §3.1). telonex-delta: the loop clock
/// and the decision time are the exchange time (12 §4.1, 13 TC-C11).
#[inline]
fn envelope(i: usize, ev: pmb_core::TimedMarketEvent<'_>) -> Envelope<'_> {
    Envelope {
        seq: i as u64,
        at: ev.exchange_ts,
        exchange_ts: Some(ev.exchange_ts),
        recv_wall: ev.local_ts,
        recv_mono: None,
        source: Source::MarketWs,
        payload: Payload::Market(ev.event),
    }
}

/// Drives one session over the decoded market in batches of
/// [`DEADLINE_CHECK_EVENTS`], checking the deadline between batches
/// (20 §6.3 S4), then ends the stream and finalizes (12 §5.1).
pub fn run_session<T, E, K>(
    cx: &RunCtx<'_>,
    params: &T::Params,
    cfg: EngineConfig,
    exec: E,
    sink: K,
) -> Result<CandidateRun, RunFailure>
where
    T: Strategy,
    E: Execution,
    K: TraceSink,
{
    let inputs = cx.inputs;
    let mut market = SharedMarket::new(
        inputs.info.clone(),
        inputs.rules_timeline.clone(),
        inputs.rules_source,
    );
    let session = Session::<T, E, K>::new(params, &market, cfg, exec, sink)?;
    let mut sessions = [session];
    let tape = &inputs.tape;
    let mut batch: Vec<Envelope<'_>> = Vec::with_capacity(DEADLINE_CHECK_EVENTS);
    let mut i = 0;
    while i < tape.len() {
        if cx.deadline.expired() {
            return Err(RunFailure::Group(cx.deadline.error()));
        }
        let end = (i + DEADLINE_CHECK_EVENTS).min(tape.len());
        batch.clear();
        batch.extend((i..end).map(|j| envelope(j, tape.event(j))));
        drive(&mut market, &mut sessions, &batch);
        if let Some(f) = sessions[0].fault() {
            return Err(f.clone().into());
        }
        i = end;
    }
    let [mut session] = sessions;
    session.end_of_stream(&market)?;
    let counted_tick_seen = market.first_counted_tick_seen;
    let skew_ms = market.skew_ms;
    let out = session.finalize(&market, inputs.outcome)?;
    let intent_meta = resolve_intent_meta(&out.stats.intent_meta)?;
    Ok(CandidateRun {
        stats: out.stats,
        acc: out.acc,
        intent_meta,
        counted_tick_seen,
        skew_ms,
    })
}

/// The `intentMeta` objects of a finished session in fill order (21 §16;
/// the caps are checked by the run pipeline).
///
/// D-PENDING: `SessionOutput` carries meta ids only and `finalize` drops
/// the session's meta store, so ids cannot be resolved here
/// (crossStreamNeeds). A strategy whose filled orders carry meta is refused
/// as `invalid_input: flag` (a missing capability, not an engine bug, 20 §4),
/// never emitted without its meta.
pub fn resolve_intent_meta(ids: &[MetaId]) -> Result<Vec<Map<String, Value>>, EngineError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    Err(EngineError::invalid_input(
        "flag",
        format!(
            "intentMeta output ({} entries) is not available before integration: \
             pmb-engine does not hand the resolved meta objects to the runtime",
            ids.len()
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_contract::vocab::ErrorClass;

    #[test]
    fn session_faults_map_to_classes() {
        // spec: 12 §11 (strategy fault vs engine fault), 20 §4.1 causes
        let f = SessionFault::Strategy {
            cause: StrategyFaultCause::Panic {
                message: "boom".into(),
            },
            callback: "onMarketTick",
            tick_seq: 3,
            at: TsMs(9),
        };
        match RunFailure::from(f) {
            RunFailure::Strategy { cause, seq, at, .. } => {
                assert_eq!((cause, seq, at), ("panic", 3, TsMs(9)));
            }
            other => panic!("{other:?}"),
        }
        let e = RunFailure::from(SessionFault::Engine {
            message: "pnl identity".into(),
        });
        match e {
            RunFailure::Group(e) => assert_eq!((e.exit_code(), e.cause), (8, "invariant")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unwired_simulator_refuses_without_alerting() {
        // spec: R14 (no silent substitution), 20 §4 (a missing capability is
        // invalid_input, exit 2; engine_fault is reserved for engine bugs)
        for p in Profile::ALL {
            let e = UnwiredSimulator.check(*p).unwrap_err();
            assert_eq!(
                (e.class, e.cause, e.exit_code()),
                (ErrorClass::InvalidInput, "profile", 2)
            );
            assert!(e.message.contains(p.as_str()), "{}", e.message);
        }
    }

    #[test]
    fn intent_meta_is_refused_until_it_can_be_resolved() {
        // spec: 21 §16 (meta in fill order), R14 (never emitted without it)
        assert!(resolve_intent_meta(&[]).unwrap().is_empty());
        let e = resolve_intent_meta(&[MetaId::new(0), MetaId::new(3)]).unwrap_err();
        assert_eq!(
            (e.class, e.cause, e.exit_code()),
            (ErrorClass::InvalidInput, "flag", 2)
        );
        assert!(e.message.contains("2 entries"), "{}", e.message);
    }

    #[test]
    fn deadline_expires_after_its_budget() {
        // spec: 20 §6.3 S4 (cooperative deadline), §4 (timeout exit 5)
        let d = Deadline::after_ms(60_000);
        assert!(!d.expired());
        assert!(Deadline::after_ms(0).expired());
        let past = Instant::now() - Duration::from_secs(2);
        assert!(Deadline::from_start(past, 1_000).expired());
        assert!(!Deadline::from_start(past, 60_000).expired());
        let e = Deadline::after_ms(0).error();
        assert_eq!((e.cause, e.exit_code()), ("deadline", 5));
    }
}
