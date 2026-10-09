//! The market session (12 §2.1, §5, §10): the unit of determinism.
//!
//! `Session<S, E, T>` is generic over the strategy, the execution adapter
//! and the trace sink (12 §14 P6, 30 §4 rule 1): the hot loop is
//! monomorphized in the strategy's bin crate. A session owns all its state
//! and is `Send`; it holds no references into `SharedMarket` across steps
//! (12 §2.1).

use pmb_core::ids::CidInterner;
use pmb_core::{FinalOutcome, TsMs};

use crate::clock::Clocks;
use crate::config::EngineConfig;
use crate::envelope::Envelope;
use crate::exec::{EventQueue, Execution};
use crate::ledger::Ledger;
use crate::om::OrderManager;
use crate::plugins_view::PluginSet;
use crate::shared::SharedMarket;
use crate::stats::{FinalStats, MarketStatsAcc};
use crate::strategy::{Intents, Interests, Strategy, TickInfo};
use crate::trace::TraceSink;
use crate::window::{SessionState, WindowGate};

/// Cause of a candidate failure (20 §4.1, 30 §12, 12 §6.3, §11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StrategyFaultCause {
    /// A panic in a callback or `new` (12 §11); message captured by the hook.
    Panic {
        /// Panic message.
        message: String,
    },
    /// `Err(StrategyError)` returned (30 §12).
    Error {
        /// Error message.
        message: String,
    },
    /// Cascade budget exceeded (12 §6.3).
    CascadeLimit {
        /// Envelope seq.
        seq: u64,
        /// Strategy-tick seq.
        tick: u64,
        /// Deliveries in the drain.
        deliveries: u32,
    },
    /// `intentMeta` over its per-market caps (21 §16).
    IntentMetaLimit,
}

/// Why a session stopped (12 §11): a candidate failure or an engine fault.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionFault {
    /// `strategy_fault`: this candidate stops and emits no `MarketStats`;
    /// other candidates continue (12 §6.3, §11, 21 §13).
    Strategy {
        /// Cause.
        cause: StrategyFaultCause,
        /// Callback kind (`onMarketTick`, `onAccountEvent`, `new`).
        callback: &'static str,
        /// Strategy-tick seq at the fault.
        tick_seq: u64,
        /// Loop time at the fault.
        at: TsMs,
    },
    /// `engine_fault`: overflow in engine code or a ledger invariant
    /// violation; never continue silently (12 §11).
    Engine {
        /// One line naming the violated rule.
        message: String,
    },
}

/// The per-market result of a session (21 §11, D11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionOutput {
    /// Unrounded final values.
    pub stats: FinalStats,
    /// Tick counters and capital-aware counters.
    pub acc: MarketStatsAcc,
}

/// One (market, candidate, profile, seed) session (12 §2.1).
pub struct Session<S: Strategy, E: Execution, T: TraceSink> {
    /// `None` after a fault: the strategy is never called again (12 §11).
    pub(crate) strategy: Option<S>,
    pub(crate) interests: Interests,
    pub(crate) exec: E,
    pub(crate) trace: T,
    pub(crate) config: EngineConfig,
    pub(crate) om: OrderManager,
    pub(crate) ledger: Ledger,
    pub(crate) cids: CidInterner,
    pub(crate) queue: EventQueue,
    /// Engine-owned, reused intent buffer (12 §6.1).
    pub(crate) intents: Intents,
    pub(crate) clocks: Clocks,
    pub(crate) window: WindowGate,
    pub(crate) state: SessionState,
    /// Last dispatched strategy tick (12 §6.5).
    pub(crate) last_tick: Option<TickInfo>,
    /// Next 0-based strategy-tick index (22 §3.3).
    pub(crate) next_tick_seq: u64,
    /// Plugin set (14 P-3). Stand-in until `pmb-plugins` lands.
    pub(crate) plugins: PluginSet,
    /// An account event was delivered since the last `on_tick` (16 TF-2 (c)).
    pub(crate) delivered_since_tick: bool,
    pub(crate) stats: MarketStatsAcc,
    pub(crate) fault: Option<SessionFault>,
}

impl<S: Strategy, E: Execution, T: TraceSink> Session<S, E, T> {
    /// Creates the session and the strategy instance, exactly once, inside
    /// `catch_unwind` (12 §6.1, §11; 30 §4 rule 4).
    pub fn new(
        _params: &S::Params,
        _market: &SharedMarket,
        _config: EngineConfig,
        _exec: E,
        _trace: T,
    ) -> Result<Self, SessionFault> {
        todo!("core agent: 12 §6.1 session construction")
    }

    /// Processes one envelope after the driver applied it to `market`
    /// (12 §5.1): (a) scheduled actions due strictly before `env.at`, one
    /// cascade per due time; then the payload.
    pub fn step(
        &mut self,
        _env: &Envelope<'_>,
        _market: &SharedMarket,
    ) -> Result<(), SessionFault> {
        todo!("core agent: 12 §5.1 step")
    }

    /// Backtest end of input (12 §5.1): realistic drains the scheduler in
    /// time order without strategy callbacks (Closing); ts-compat discards
    /// undue actions (TC-C13).
    pub fn end_of_stream(&mut self, _market: &SharedMarket) -> Result<(), SessionFault> {
        todo!("core agent: 12 §5.1 end_of_stream")
    }

    /// Settlement and the per-market result (12 §9.5, §9.6; 21 §11, §13).
    /// Checks the PnL identity; a violation is an `engine_fault` (12 §9.6).
    pub fn finalize(
        self,
        _market: &SharedMarket,
        _outcome: FinalOutcome,
    ) -> Result<SessionOutput, SessionFault> {
        todo!("core agent: 12 §9.6, 21 §11 finalize")
    }

    /// The fault that stopped this session, if any.
    pub fn fault(&self) -> Option<&SessionFault> {
        self.fault.as_ref()
    }

    /// Lifecycle state (12 §10).
    pub fn state(&self) -> SessionState {
        self.state
    }
}

/// The driver for one market (12 §2.1, §14 P10): for each envelope of a
/// decoded batch, apply it to `market`, then step every session that has
/// not faulted. Faulted sessions stop at once and keep their fault
/// (12 §6.3, §11).
pub fn drive<S: Strategy, E: Execution, T: TraceSink>(
    _market: &mut SharedMarket,
    _sessions: &mut [Session<S, E, T>],
    _batch: &[Envelope<'_>],
) {
    todo!("core agent: 12 §2.1 driver loop")
}
