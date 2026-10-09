//! Breadth-first cascades (12 §6.2) and the cascade budget (12 §6.3).
//!
//! One FIFO queue per session ([`crate::exec::EventQueue`]). Delivery of one
//! event, in order: the ledger applies it (12 §9) → the OM processes it
//! (cid release, deferred cancels, 12 §7.6) → `trace(AccountEvent)` →
//! strategy callback (if enabled, interested and allowed by 12 §5.4) →
//! `trace(Decision{origin: Account})` → the OM handles the intents, which
//! append to the back of the queue. `drain` is not re-entrant: only the loop
//! calls it, at the points of 12 §5.

use pmb_core::FinalOutcome;
use pmb_core::Outcome;

use crate::exec::Execution;
use crate::om::OmIo;
use crate::session::{Session, SessionFault, StrategyFaultCause};
use crate::shared::SharedMarket;
use crate::strategy::{EventFlags, Strategy};
use crate::trace::{TraceEvent, TraceSink};

/// Deliveries with callbacks in one drain, bounded by
/// `runner.maxEventsPerDrain` (12 §6.3). Interest-skipped deliveries count
/// (D69 A-08); deliveries with no callback by rule do not.
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
    pub(crate) fn drain(&mut self, market: &SharedMarket) -> Result<(), SessionFault> {
        let mut budget = CascadeBudget::new(self.config.max_events_per_drain);
        while let Some(ev) = self.queue.pop() {
            // 12 §4.2: the event clock is the max over delivered events.
            self.clocks.event_clock.on_delivered(ev.at);
            // 1. The ledger applies it (12 §9).
            let effect = match self.ledger.apply_delivered(&ev) {
                Ok(e) => e,
                Err(e) => return Err(self.engine_fault(format!("ledger: {e} (12 §9.8)"))),
            };
            if cfg!(debug_assertions) && !self.ledger_invariants_hold() {
                return Err(self.engine_fault(format!(
                    "ledger invariant violated after {} (12 §9.6, §9.8)",
                    ev.kind.ts_kind()
                )));
            }
            // 2. The OM processes it (cid release, deferred cancels, 12 §7.6).
            let io = OmIo {
                ledger: &mut self.ledger,
                cids: &mut self.cids,
                metas: &mut self.metas,
                exec: &mut self.exec,
                queue: &mut self.queue,
                market,
                config: &self.config,
            };
            self.om.on_delivered(&ev, effect, self.clocks.now, io);
            self.forward_exec_trace();
            self.stats.counters.on_delivered(&ev);
            self.stats
                .counters
                .observe_reserved(self.ledger.capital().reserved);
            // 3. trace(AccountEvent), before the callback (12 §12).
            if T::ENABLED {
                let seq = self.last_tick.map_or(0, |t| t.seq);
                self.trace
                    .record(&TraceEvent::AccountEvent { seq, event: &ev });
            }
            self.delivered_since_tick = true;
            // 4. Strategy callback if enabled and allowed by rule (12 §5.4,
            // §10, §11); deliveries with no callback by rule do not count.
            let by_rule =
                self.strategy.is_some() && self.callbacks_allowed() && !effect.suppress_callback;
            if !by_rule {
                continue;
            }
            // D69 A-08: an interest-skipped delivery counts against the
            // budget, otherwise the declared interests would change outputs
            // (30 §4.1, 16 TF-3).
            if !budget.take() {
                // 12 §6.3 (backtest): the candidate stops at once.
                let cause = StrategyFaultCause::CascadeLimit {
                    seq: self.env_seq,
                    tick: self.last_tick.map_or(0, |t| t.seq),
                    deliveries: budget.used - 1,
                };
                return Err(self.strategy_fault(cause, "onAccountEvent"));
            }
            // 12 §6.1: a skipped callback is equivalent to one that returned
            // no intents.
            if !self.interests.events.contains(EventFlags::of(&ev.kind)) {
                continue;
            }
            self.call_event(&ev, market)?;
        }
        Ok(())
    }

    /// Debug-build ledger checks after every delivered event (12 §9.6, §9.8):
    /// the PnL identity for either resolution and reservation consistency.
    fn ledger_invariants_hold(&self) -> bool {
        let identity = Outcome::ALL
            .iter()
            .all(|&o| self.ledger.identity_holds(FinalOutcome::new(o)));
        let qty_ok = Outcome::ALL
            .iter()
            .all(|&o| !self.ledger.position(o).qty.is_negative());
        // A clamped reversal (`reversal_deficit`, 12 §9.3) is the one
        // documented identity break.
        (identity || self.ledger.counters().reversal_deficit > 0)
            && qty_ok
            && self.ledger.reservations_consistent()
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
