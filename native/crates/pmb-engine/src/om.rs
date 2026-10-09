//! The order manager (12 §7–§8): turns intents into commands through halt
//! and guards, dedupe, validation (`ExchangeRules`), risk, funding, ledger
//! command entries and dispatch.
//!
//! Realistic handles intents one at a time in list order (12 §7.2); ts-compat
//! runs the TS risk pass over the whole list first and emits its rejections
//! first (TC-C2, 12 §8.2). Engine-originated intents (window end, kill
//! switch, panic handling, operator, rotation) go through the same pipeline
//! (12 §8.3).

use pmb_core::event::{AccountEvent, CancelCause, RejectReason};
use pmb_core::ids::{CancelSeq, CidInterner, OpKey, OrderKey};
use pmb_core::order::{OrderRequest, Side};
use pmb_core::{Outcome, PerOutcome, Price, TsMs};

use crate::config::EngineConfig;
use crate::exec::{CancelScope, EventQueue, Execution};
use crate::ledger::{Delivered, Ledger};
use crate::shared::SharedMarket;
use crate::strategy::Intents;

/// OM counters (12 §14 P12, 21 §10): plain integers, always on.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OmCounters {
    /// Placements dropped as duplicates of an active cid (12 §7.6); a counter
    /// key, never an emitted reject reason.
    pub duplicate_active_cid: u64,
    /// Intents handled by kind, indexed by `IntentKind as usize`.
    pub intents_by_kind: [u64; 8],
    /// Commands dispatched.
    pub commands: u64,
}

/// Best own price per (outcome, side) over own orders that could still match
/// (10 N6), updated at emission, `CancelAcked` delivery and terminal delivery
/// (12 §7.4 self-cross block). Realistic only (TC-C14).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct SelfCrossIndex {
    /// Highest own BUY price per outcome.
    pub best_buy: PerOutcome<Option<Price>>,
    /// Lowest own SELL price per outcome.
    pub best_sell: PerOutcome<Option<Price>>,
}

impl SelfCrossIndex {
    /// Whether a placement could match an own order, directly or through
    /// complementary matching (10 N6, 12 §7.4): four comparisons.
    pub fn would_cross(&self, _outcome: Outcome, _side: Side, _price: Price) -> bool {
        todo!("core agent: 12 §7.4 self-cross block")
    }
}

/// An engine-originated intent (12 §8.3, §10).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EngineIntent {
    /// `CancelMarket{scope}` with an engine cause (`WindowEnd`, `Rotation`,
    /// `StrategyPanic`, `Operator`).
    CancelMarket {
        /// Scope.
        scope: CancelScope,
        /// Engine cause.
        cause: CancelCause,
    },
    /// `CancelAll` with an engine cause (`KillSwitch`, `Operator`).
    CancelAll {
        /// Engine cause.
        cause: CancelCause,
    },
}

/// Halt state of the strategy (12 §11, §8.3).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum Halt {
    /// Placements allowed.
    #[default]
    Running,
    /// Strategy halted (panic, error, cascade limit): placements rejected
    /// `StrategyHalted`.
    StrategyHalted,
    /// Kill switch tripped: placements rejected `KillSwitch`.
    KillSwitch,
}

/// Mutable session parts the OM works on, borrowed disjointly from the
/// session for one `handle` call.
pub struct OmIo<'s, E: Execution> {
    /// The ledger (commands apply at emission, 12 §9.1).
    pub ledger: &'s mut Ledger,
    /// The session cid interner (local cids of the buffer are interned here).
    pub cids: &'s mut CidInterner,
    /// The execution adapter.
    pub exec: &'s mut E,
    /// The cascade queue (`OrderSubmitted`, OM rejections and synchronous
    /// adapter events are appended here).
    pub queue: &'s mut EventQueue,
    /// Shared market (rules in force, window, skew).
    pub market: &'s SharedMarket,
    /// Resolved config.
    pub config: &'s EngineConfig,
}

/// The order manager of one session (12 §7–§8).
#[derive(Clone, Debug)]
pub struct OrderManager {
    /// Reused key scratch for `ExecCommand::Place`/`Cancel` (12 §14 P1).
    pub(crate) scratch: Vec<OrderKey>,
    /// Requests of the intent being handled, after cid interning.
    pub(crate) requests: Vec<OrderRequest>,
    /// Deferred cancels waiting for an `OrderAccepted` delivery (12 §7.3).
    pub(crate) deferred: Vec<(OrderKey, CancelCause)>,
    /// Self-cross index (realistic).
    pub(crate) self_cross: SelfCrossIndex,
    /// Next `CancelSeq` (10 §6).
    pub(crate) next_cancel: CancelSeq,
    /// Next `OpKey` (10 §6).
    pub(crate) next_op: OpKey,
    /// Halt state.
    pub(crate) halt: Halt,
    /// Counters.
    pub(crate) counters: OmCounters,
}

impl Default for OrderManager {
    fn default() -> Self {
        OrderManager::new()
    }
}

impl OrderManager {
    /// A fresh OM: no active cids (12 §7.6, `OrderManager.ts:143-149`).
    pub fn new() -> OrderManager {
        OrderManager {
            scratch: Vec::new(),
            requests: Vec::new(),
            deferred: Vec::new(),
            self_cross: SelfCrossIndex::default(),
            next_cancel: CancelSeq::new(0),
            next_op: OpKey::new(0),
            halt: Halt::Running,
            counters: OmCounters::default(),
        }
    }

    /// Handles one strategy intent list decided at `stamp` (12 §7.2): ts-compat
    /// per TC-C2, realistic per intent in list order. Events go to the back
    /// of the queue (12 §6.2).
    pub fn handle<E: Execution>(&mut self, _intents: &Intents, _stamp: TsMs, _io: OmIo<'_, E>) {
        todo!("core agent: 12 §7.2 pipeline")
    }

    /// Handles one engine-originated intent (12 §8.3, §10).
    pub fn handle_engine<E: Execution>(
        &mut self,
        _intent: EngineIntent,
        _stamp: TsMs,
        _io: OmIo<'_, E>,
    ) {
        todo!("core agent: 12 §8.3 engine-originated intents")
    }

    /// Post-delivery processing of one event, after the ledger applied it
    /// (12 §6.2): cid release (12 §7.6), deferred cancel release on
    /// `OrderAccepted` (12 §7.3), self-cross index maintenance (12 §7.4).
    pub fn on_delivered<E: Execution>(
        &mut self,
        _ev: &AccountEvent,
        _effect: Delivered,
        _io: OmIo<'_, E>,
    ) {
        todo!("core agent: 12 §6.2 OM delivery step")
    }

    /// Validation of one placement (12 §7.4) against the rules in force and
    /// `xnow` (12 §4.4); `Err` is the reject reason.
    pub fn validate(
        &self,
        _req: &OrderRequest,
        _stamp: TsMs,
        _market: &SharedMarket,
        _config: &EngineConfig,
    ) -> Result<(), RejectReason> {
        todo!("core agent: 12 §7.4 validation")
    }

    /// Sets the halt state (12 §11, §8.3).
    pub fn set_halt(&mut self, h: Halt) {
        self.halt = h;
    }

    /// Counters.
    pub fn counters(&self) -> &OmCounters {
        &self.counters
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_om_is_running_with_zero_counters() {
        // spec: 12 §7.6 (a new session starts with no active cids), 12 §14 P12
        let mut om = OrderManager::new();
        assert_eq!(om.halt, Halt::Running);
        assert_eq!(om.counters().duplicate_active_cid, 0);
        om.set_halt(Halt::KillSwitch);
        assert_eq!(om.halt, Halt::KillSwitch);
    }
}
