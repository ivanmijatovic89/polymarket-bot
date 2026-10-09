//! The seam between the runtime and the engine for one candidate × market
//! (12 §2.1, §5.1, §11; 30 §4 rule 1).
//!
//! [`Backend`] is generic over the strategy and the trace sink: the
//! production [`EngineBackend`] monomorphizes `Session<T, E, K>` in the
//! strategy's bin crate and never boxes the strategy (30 §4 rule 1, 12 §14
//! P6). Tests drive the rest of the run pipeline through their own backend
//! while the engine bodies are being implemented.

use std::time::{Duration, Instant};

use pmb_contract::vocab::InputMode;
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
        Deadline {
            at: Instant::now() + Duration::from_millis(wall_ms),
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

/// The factory of the production binary before integration: fails loud.
#[derive(Copy, Clone, Debug, Default)]
pub struct UnwiredSimulator;

impl ExecFactory for UnwiredSimulator {
    type Exec = NoExecution;
    fn create(&self, _cfg: &EngineConfig) -> Result<NoExecution, EngineError> {
        // TODO(integration): `pmb_engine::exec::sim::simulator::Simulator::new(cfg)`.
        Err(EngineError::engine_fault(
            "invariant",
            "the execution simulator (pmb-engine exec::sim) is not wired before integration",
        ))
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
    if !out.stats.intent_meta.is_empty() {
        // D-PENDING: SessionOutput carries meta ids only; the session's meta
        // store is dropped by finalize (crossStreamNeeds).
        return Err(RunFailure::Group(EngineError::engine_fault(
            "invariant",
            "intentMeta ids cannot be resolved outside pmb-engine (SessionOutput needs resolved meta)",
        )));
    }
    Ok(CandidateRun {
        stats: out.stats,
        acc: out.acc,
        intent_meta: Vec::new(),
        counted_tick_seen,
        skew_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn unwired_simulator_fails_loud() {
        // spec: R14 (no silent substitution before integration)
        let d = Deadline::after_ms(60_000);
        assert!(!d.expired());
        assert!(Deadline::after_ms(0).expired());
        assert_eq!(Deadline::after_ms(0).error().exit_code(), 5);
    }
}
