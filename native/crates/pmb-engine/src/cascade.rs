//! Breadth-first cascades (12 §6.2) and the cascade budget (12 §6.3).
//!
//! One FIFO queue per session ([`crate::exec::EventQueue`]). Delivery of one
//! event, in order: the ledger applies it (12 §9) → the OM processes it
//! (cid release, deferred cancels, 12 §7.6) → `trace(AccountEvent)` →
//! strategy callback (if enabled, interested and allowed by 12 §5.4) →
//! `trace(Decision{origin: Account})` → the OM handles the intents, which
//! append to the back of the queue. `drain` is not re-entrant: only the loop
//! calls it, at the points of 12 §5.

use crate::exec::Execution;
use crate::session::{Session, SessionFault};
use crate::shared::SharedMarket;
use crate::strategy::Strategy;
use crate::trace::TraceSink;

/// Deliveries with callbacks in one drain, bounded by
/// `runner.maxEventsPerDrain` (12 §6.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct CascadeBudget {
    /// Maximum deliveries with callbacks per drain.
    pub max: u32,
    /// Deliveries with callbacks in the current drain.
    pub used: u32,
}

impl CascadeBudget {
    /// A fresh budget for one drain.
    pub const fn new(max: u32) -> CascadeBudget {
        CascadeBudget { max, used: 0 }
    }

    /// Counts one delivery with a callback; `false` once the budget is
    /// exceeded (12 §6.3: backtest stops the candidate with
    /// `strategy_fault: cascade_limit`; paper and live treat it as a panic).
    #[inline]
    pub fn take(&mut self) -> bool {
        self.used += 1;
        self.used <= self.max
    }
}

impl<S: Strategy, E: Execution, T: TraceSink> Session<S, E, T> {
    /// Drains the cascade queue (12 §6.2, §6.3). Events are never dropped:
    /// after a fault in paper and live, remaining events are applied to the
    /// ledger without callbacks (10 S5).
    pub(crate) fn drain(&mut self, _market: &SharedMarket) -> Result<(), SessionFault> {
        todo!("core agent: 12 §6.2 drain")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_allows_exactly_max_deliveries() {
        // spec: 12 §6.3 (maxEventsPerDrain bounds deliveries with callbacks)
        let mut b = CascadeBudget::new(2);
        assert!(b.take());
        assert!(b.take());
        assert!(!b.take());
    }
}
