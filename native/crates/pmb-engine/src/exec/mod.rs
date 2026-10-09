//! The `Execution` trait and its contract (13 §2).
//!
//! Adapters receive validated commands that carry keys only; order details
//! are read from the ledger's immutable order records (13 §2.1). Adapters
//! append account events to the session's [`EventQueue`], never mutate the
//! ledger and never see the strategy (13 X5).

pub mod sim;

use std::collections::VecDeque;

use pmb_core::event::{AccountEvent, CancelCause};
use pmb_core::ids::{CancelOp, OpKey, OrderKey};
use pmb_core::market_event::QuoteSide;
use pmb_core::{MarketEvent, Outcome, Price, Qty, TsMs};

use crate::config::EngineConfig;
use crate::ledger::{Ledger, OrderRecord};
use crate::shared::SharedMarket;
use crate::trace::ExecTraceRecord;

/// Scope of a `CancelMarket` (10 §7.3, 13 §2.1): resolved by the adapter when
/// the cancel takes effect, so it includes orders opened meanwhile.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CancelScope {
    /// One outcome of the market.
    Outcome(Outcome),
    /// The whole market (the session's condition id).
    Market,
}

/// A validated command (13 §2.1). Commands carry keys only.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ExecCommand<'a> {
    /// `PlaceLimit` is a batch of one (10 N2); one transport latency sample
    /// per command (13 §6.8).
    Place {
        /// Accepted orders in batch order.
        orders: &'a [OrderKey],
    },
    /// `CancelOrder`, a resolved `CancelBatch`, or released deferred cancels.
    Cancel {
        /// Cancel operation (10 §6).
        op: CancelOp,
        /// `Strategy(op)` or an engine cause (10 §10.2).
        cause: CancelCause,
        /// Target keys.
        keys: &'a [OrderKey],
    },
    /// `CancelMarket`: `Outcome(o) | Market`.
    CancelScope {
        /// Cancel operation.
        op: CancelOp,
        /// Cause.
        cause: CancelCause,
        /// Scope, resolved when the cancel takes effect.
        scope: CancelScope,
    },
    /// `CancelAll`.
    CancelAll {
        /// Cancel operation.
        op: CancelOp,
        /// Cause.
        cause: CancelCause,
    },
    /// Split `size` full sets (cost = size USDC).
    Split {
        /// Operation key.
        op: OpKey,
        /// Full sets.
        size: Qty,
    },
    /// Merge `size` full sets (already clamped by the OM, 12 §7.3).
    Merge {
        /// Operation key.
        op: OpKey,
        /// Full sets.
        size: Qty,
    },
}

/// Read-only context of every `Execution` call (13 §2.2): the
/// `SharedMarket` (recorded books, rules in force, window, `MarketInfo`, skew
/// estimate), the ledger's order records and the resolved `ModelConfig`.
#[derive(Copy, Clone, Debug)]
pub struct ExecCtx<'a> {
    /// Shared market state (12 §2.1).
    pub market: &'a SharedMarket,
    /// The session ledger; adapters read records and positions, never write
    /// (13 X5).
    pub ledger: &'a Ledger,
    /// Resolved model configuration (13 §7.3).
    pub config: &'a EngineConfig,
}

impl ExecCtx<'_> {
    /// Immutable record of an order key (13 §2.1).
    #[inline]
    pub fn order(&self, k: OrderKey) -> &OrderRecord {
        self.ledger.order(k)
    }
}

/// A timer fire in journaled mode (13 §2.3, 12 E5): `due` stays the
/// exchange-side time of the actions it runs; `at` is the fire time.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct TimerFired {
    /// Scheduled time.
    pub due: TsMs,
    /// Fire time on the loop clock.
    pub at: TsMs,
}

/// Live account inputs: REST responses, user-WS frames, reconciliation and
/// sidecar results (12 §3.2 `Account`, 13 §9). Deferred to the live adapters
/// (M8/M9); uninhabited until then, so no backtest path can construct one.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AccountInput {}

/// One overlay level: depletion deficit or own resting size at
/// (outcome, side, price) (13 §4.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct OverlayLevel {
    /// Outcome.
    pub outcome: Outcome,
    /// Book side.
    pub side: QuoteSide,
    /// Price.
    pub price: Price,
    /// Size (deficit or own resting quantity).
    pub size: Qty,
}

/// Strategy-visible adjustments to the recorded book (realistic, 13 §4.2,
/// §6.11): depletion deficits and own resting orders. The core merges it
/// into `BookView` (12 §6.5 `book(o)`); ts-compat has none.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BookOverlay {
    /// Depletion deficits, sorted by (outcome, side, price).
    pub deficits: Vec<OverlayLevel>,
    /// Own resting quantity per level, sorted by (outcome, side, price).
    pub own: Vec<OverlayLevel>,
}

/// Adapter diagnostics (13 §2.2 `diagnostics`; 21 §10 attribution counters
/// of 13 §7.2). Plain integers, always on (12 §14 P12).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct ExecDiagnostics {
    /// Scheduled actions created.
    pub actions_scheduled: u64,
    /// Scheduled actions executed.
    pub actions_run: u64,
    /// Actions discarded at end of stream (ts-compat, TC-C13).
    pub actions_discarded: u64,
    /// Market events skipped by the per-candidate fast path (16 CG-4).
    pub fast_path_skips: u64,
}

/// The cascade queue of a session (12 §6.2): one FIFO; the OM and the
/// adapter append in emission order, `drain` pops from the front. It also
/// carries the adapter's `OrderLifecycle`/`FillDetail` records when the sink
/// asks for them (22 §2, 13 §4.3), so the trait needs no sink parameter.
// D-PENDING: 13 §2.2 gives the adapter no trace sink, but 12 §12 has it emit
// OrderLifecycle/FillDetail; chose an opt-in side buffer in EventQueue that
// the session forwards to its sink after each adapter call.
#[derive(Clone, Debug, Default)]
pub struct EventQueue {
    events: VecDeque<AccountEvent>,
    trace: Option<Vec<ExecTraceRecord>>,
}

impl EventQueue {
    /// An empty queue; `trace` enables the lifecycle side buffer.
    pub fn new(trace: bool) -> EventQueue {
        EventQueue {
            events: VecDeque::new(),
            trace: trace.then(Vec::new),
        }
    }

    /// Appends one event at the back (12 §6.2, 13 X4).
    #[inline]
    pub fn push(&mut self, ev: AccountEvent) {
        self.events.push_back(ev);
    }

    /// Pops the front event (12 §6.2 `drain`).
    #[inline]
    pub fn pop(&mut self) -> Option<AccountEvent> {
        self.events.pop_front()
    }

    /// Number of queued events.
    #[inline]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Whether no event is queued.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Events appended at or after position `mark` (a previous `len()`), for
    /// the ts-compat scan of synchronous events after a dispatch (12 §7.2
    /// TC-C2 step 4, 13 X2).
    pub fn since(&self, mark: usize) -> impl Iterator<Item = &AccountEvent> + '_ {
        self.events.range(mark.min(self.events.len())..)
    }

    /// Whether the session's sink wants lifecycle records (22 §2).
    #[inline]
    pub fn wants_trace(&self) -> bool {
        self.trace.is_some()
    }

    /// Records an `OrderLifecycle` or `FillDetail` (13 §4.3); a no-op unless
    /// enabled. Build the record only when [`Self::wants_trace`] is true.
    #[inline]
    pub fn record(&mut self, rec: ExecTraceRecord) {
        if let Some(t) = self.trace.as_mut() {
            t.push(rec);
        }
    }

    /// Takes the recorded lifecycle records, keeping capacity.
    pub fn drain_trace(&mut self) -> impl Iterator<Item = ExecTraceRecord> + '_ {
        self.trace.iter_mut().flat_map(|t| t.drain(..))
    }
}

/// An execution adapter (13 §2.2): simulator, paper or CLOB V2.
///
/// Contract rules X1–X8 of 13 §2.4: O(work done), never blocks, no I/O, no
/// steady-state allocation; synchronous events only in ts-compat (X2);
/// every event names its `OrderKey`/`OpKey` and fills carry their fee (X3);
/// the order of emitted events is output (X4); adapters never mutate the
/// ledger and the core never branches on adapter kind (X5); exactly one
/// terminal event per key (X7); randomness only from the market seed's
/// counter-based streams (X8).
pub trait Execution: Send {
    /// Dispatch one command decided at `stamp`. Never blocks, never does I/O.
    fn submit(&mut self, stamp: TsMs, cmd: ExecCommand<'_>, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// Earliest scheduled action time (13 §2.3); `None` while compat latency
    /// releases at market events (13 §5.1).
    fn next_due(&self) -> Option<TsMs>;
    /// Execute every action due at exactly `next_due()`, in (class, seq)
    /// order (13 §4.3).
    fn run_next_due(&mut self, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// Journaled mode: execute every action due at or before `t.due`.
    fn on_timer(&mut self, t: &TimerFired, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// After a real market event was applied to the shared book (12 §5.2).
    /// Never called for synthetic ticks, nor in ts-compat for out-of-window
    /// events (13 X6).
    // D67: `now` is the profile's execution clock: the loop clock in
    // realistic, the TS tick ts in ts-compat (TC-C11; equal on
    // telonex-delta real ticks, different on recorder-v4).
    fn on_market_event(
        &mut self,
        now: TsMs,
        ev: &MarketEvent<'_>,
        cx: &ExecCtx<'_>,
        out: &mut EventQueue,
    );
    /// Live inputs: REST responses, user-WS frames, reconciliation and
    /// sidecar results.
    fn on_account_input(
        &mut self,
        _now: TsMs,
        _input: &AccountInput,
        _cx: &ExecCtx<'_>,
        _out: &mut EventQueue,
    ) {
    }
    /// Backtest end of input: from now on `next_due()` reports every pending
    /// action, so the loop can drain the scheduler (12 §5.1). No-op for
    /// exact-time models.
    fn on_end_of_input(&mut self) {}
    /// Strategy-visible adjustments to the recorded book (realistic, 13 §6.11).
    fn book_overlay(&self) -> Option<&BookOverlay> {
        None
    }
    /// Adapter diagnostics.
    fn diagnostics(&self) -> &ExecDiagnostics;
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::event::AccountEventKind;

    fn ev(k: u32) -> AccountEvent {
        AccountEvent {
            at: TsMs(1),
            kind: AccountEventKind::OrderOpen {
                order: OrderKey::new(k),
            },
        }
    }

    #[test]
    fn queue_is_fifo_and_scans_appended_events() {
        // spec: 12 §6.2 (FIFO), 12 §7.2 TC-C2 step 4 (scan of synchronous events)
        let mut q = EventQueue::new(false);
        q.push(ev(0));
        let mark = q.len();
        q.push(ev(1));
        q.push(ev(2));
        let appended: Vec<_> = q.since(mark).map(|e| e.kind.order()).collect();
        assert_eq!(
            appended,
            vec![Some(OrderKey::new(1)), Some(OrderKey::new(2))]
        );
        assert_eq!(q.pop(), Some(ev(0)));
        assert_eq!(q.pop(), Some(ev(1)));
        assert_eq!(q.len(), 1);
        assert!(q.since(5).next().is_none());
    }

    #[test]
    fn trace_side_buffer_is_opt_in() {
        // spec: 22 §2 (lifecycle records built only when a sink asks)
        let mut off = EventQueue::new(false);
        assert!(!off.wants_trace());
        off.record(ExecTraceRecord::Lifecycle(crate::trace::OrderLifecycle {
            order: OrderKey::new(0),
            transition: crate::trace::LifecycleTransition::Scheduled,
            at: TsMs(5),
        }));
        assert_eq!(off.drain_trace().count(), 0);
        let mut on = EventQueue::new(true);
        on.record(ExecTraceRecord::Lifecycle(crate::trace::OrderLifecycle {
            order: OrderKey::new(0),
            transition: crate::trace::LifecycleTransition::Scheduled,
            at: TsMs(5),
        }));
        assert_eq!(on.drain_trace().count(), 1);
        assert_eq!(on.drain_trace().count(), 0);
    }
}
