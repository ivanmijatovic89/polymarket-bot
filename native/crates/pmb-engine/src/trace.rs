//! The engine event stream and the `TraceSink` trait (22 §2, 12 §12).
//!
//! The session is generic over its sink (static dispatch). [`NoTrace`]
//! compiles to nothing: with no outputs requested the hot path is the same
//! machine code as an untraced build (22 §2). Sinks receive borrows and never
//! change engine state, so output is byte-identical with any sink or none.
//!
//! Emission points (12 §12): `TickStart` in `begin_tick`; `FeedView` after
//! the feed view of a dispatched tick is built; `Decision` after every tick
//! or event callback (empty intent lists included); `AccountEvent` at
//! delivery, after the ledger applied it and before the strategy callback;
//! `OrderLifecycle`/`FillDetail` from the execution adapter at exchange-side
//! times (13 §4.3); `Final` at finalize.

// D-PENDING: 22 §2 says the trace event enum lives in pmb-core; chose
// pmb-engine because `Final` carries engine stats and `Decision` borrows the
// engine's author intent buffer.

use pmb_core::event::AccountEvent;
use pmb_core::fill::Fill;
use pmb_core::ids::OrderKey;
use pmb_core::TsMs;

use crate::clock::DecisionOrigin;
use crate::feeds_view::FeedsView;
use crate::stats::FinalStats;
use crate::strategy::{Intents, TickCause};

/// Internal order transition reported by the execution adapter (22 §2
/// `OrderLifecycle`).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum LifecycleTransition {
    /// The command was scheduled.
    Scheduled,
    /// The order reached the exchange.
    ExchangeVisible,
    /// Taker delay started (13 §6.3).
    Delayed,
    /// The order rests on the book.
    Resting,
    /// A cancel took effect.
    CancelEffective,
    /// GTD expiry took effect.
    Expired,
}

/// `OrderLifecycle` (22 §2): stamped with the action's due time (13 §4.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct OrderLifecycle {
    /// Engine order id.
    pub order: OrderKey,
    /// Transition.
    pub transition: LifecycleTransition,
    /// Exchange-side due time.
    pub at: TsMs,
}

/// `FillDetail` (22 §2): a fill with queue-ahead and sampled latency
/// components.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FillDetail {
    /// The fill as emitted.
    pub fill: Fill,
    /// Shares ahead in the queue at the fill (realistic maker model).
    pub queue_ahead: Option<pmb_core::Qty>,
    /// Sampled place latency, ms (realistic).
    pub place_latency_ms: Option<i64>,
    /// Sampled report latency, ms (realistic).
    pub report_latency_ms: Option<i64>,
}

/// Records produced by an execution adapter for the trace (13 §4.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ExecTraceRecord {
    /// `OrderLifecycle`.
    Lifecycle(OrderLifecycle),
    /// `FillDetail`.
    FillDetail(FillDetail),
}

/// One engine event (22 §2), borrowed from engine state.
#[derive(Copy, Clone, Debug)]
pub enum TraceEvent<'a> {
    /// `TickStart`: `seq`, `cause`, decision, exchange and visibility times.
    TickStart {
        /// 0-based strategy-tick index (22 §3.3).
        seq: u64,
        /// Tick cause.
        cause: TickCause,
        /// Decision time (`tick.ts`).
        decision_ts: TsMs,
        /// Exchange time of the event, when known.
        exchange_ts: Option<TsMs>,
        /// Visibility (feed clock) time.
        visibility_ts: TsMs,
    },
    /// `FeedView` of a dispatched tick.
    FeedView {
        /// Tick seq.
        seq: u64,
        /// The view.
        view: &'a FeedsView,
    },
    /// `Decision` after a callback, including empty intent lists.
    Decision {
        /// Tick seq the decision belongs to (12 §5.3).
        seq: u64,
        /// Tick, account or engine.
        origin: DecisionOrigin,
        /// The intents as written.
        intents: &'a Intents,
    },
    /// `AccountEvent` at delivery.
    AccountEvent {
        /// Tick seq the event belongs to (12 §5.3).
        seq: u64,
        /// The event as delivered.
        event: &'a AccountEvent,
    },
    /// `OrderLifecycle` or `FillDetail` from the adapter.
    Exec(&'a ExecTraceRecord),
    /// `Final` with unrounded values and the cash summary.
    Final(&'a FinalStats),
}

/// An observer of the engine event stream (22 §2). Static dispatch only.
pub trait TraceSink: Send {
    /// `false` compiles every emission point out (22 §2 speed rule).
    const ENABLED: bool = true;
    /// Whether `FeedView` events are wanted (22 §3.2 level `feeds`); the
    /// view is built for the sink only when this is true (12 §5.3).
    fn wants_feed_view(&self) -> bool {
        false
    }
    /// Whether adapter lifecycle records are wanted (22 §2, 13 §10).
    fn wants_exec_records(&self) -> bool {
        false
    }
    /// Receives one event. Must not affect engine state.
    fn record(&mut self, ev: &TraceEvent<'_>);
}

/// The default sink: records nothing and compiles to nothing (22 §2).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct NoTrace;

impl TraceSink for NoTrace {
    const ENABLED: bool = false;
    #[inline(always)]
    fn record(&mut self, _ev: &TraceEvent<'_>) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_trace_is_disabled() {
        // spec: 22 §2 (NoTrace compiles to nothing)
        const { assert!(!NoTrace::ENABLED) };
        let mut s = NoTrace;
        assert!(!s.wants_feed_view());
        assert!(!s.wants_exec_records());
        s.record(&TraceEvent::FeedView {
            seq: 0,
            view: &FeedsView::EMPTY,
        });
    }
}
