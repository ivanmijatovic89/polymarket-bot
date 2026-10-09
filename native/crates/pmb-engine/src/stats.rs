//! Per-market accumulation for the engine output (21 §11, §13, §15, §16)
//! and the capital-aware counters (21 §10).
//!
//! Everything here is plain integers updated on the hot path; quantization
//! to output precision happens once, at the output boundary (D08, 10 §4).
//! Conversion into `pmb_contract::result` types is the binary's job.

use pmb_core::event::{AccountEvent, AccountEventKind, DoneReason};
use pmb_core::fill::Liquidity;
use pmb_core::order::Side;
use pmb_core::{FinalOutcome, Outcome, PerOutcome, Rounding, Usdc};

use crate::ledger::Ledger;
use crate::strategy::TickCause;

/// Counted ticks per cause and strategy-tick counters (21 §15, 12 §5.2,
/// 16 TF-6).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct TickCounters {
    /// Counted ticks, indexed by [`TickCause::index`] (21 §15: a fixed array,
    /// no map on the hot path).
    pub by_cause: [u64; 4],
    /// Counted ticks that passed the window gate (21 §1.1 strategy ticks).
    pub strategy_ticks: u64,
    /// Strategy callbacks skipped by the tick interest filter (16 TF-6);
    /// never part of `eventsProcessed`.
    pub strategy_ticks_skipped: u64,
}

impl TickCounters {
    /// Counts one tick before the window gate (12 §5.2, 21 §15).
    #[inline]
    pub fn record(&mut self, cause: TickCause) {
        self.by_cause[cause.index()] += 1;
    }

    /// `eventsProcessed` (21 §15): every counted tick, real and synthetic.
    #[inline]
    pub fn events_processed(&self) -> u64 {
        self.by_cause.iter().sum()
    }
}

/// Capital-aware counters per candidate (21 §10 `counters`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CandidateCounters {
    /// Orders accepted by the OM (`OrderSubmitted` emitted).
    pub orders_placed: u64,
    /// Rejections by reason code (10 §10.2 `code()`), in first-seen order;
    /// the binary sorts by code at output (21 §17).
    pub orders_rejected: Vec<(&'static str, u64)>,
    /// Orders that ended `Canceled`.
    pub orders_canceled: u64,
    /// Σ BUY fill notional.
    pub buy_notional: Usdc,
    /// Σ SELL fill notional.
    pub sell_notional: Usdc,
    /// Peak of `reserved` over the session.
    pub peak_reserved: Usdc,
    /// Placements dropped as duplicates of an active cid (12 §7.6).
    pub duplicate_active_cid: u64,
}

/// Unrounded per-market values at finalize (21 §11, 22 §2 `Final`): the
/// source of `MarketStats` and of the trace `Final` event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FinalStats {
    /// Final PnL incl. settlement (12 §9.6).
    pub pnl: Usdc,
    /// Fills of the market (21 §11 `tradeCount`).
    pub trade_count: u64,
    /// Fills by liquidity: maker, taker.
    pub trade_as_maker: u64,
    /// Taker fills.
    pub trade_as_taker: u64,
    /// Σ `fill.fee` (12 §9.5).
    pub fees_paid: Usdc,
    /// BUY VWAP numerator Σ price × qty (micros², i128) and denominator Σ qty
    /// per outcome (21 §11 `avgEntryPrice*`).
    pub buy_vwap: PerOutcome<(i128, i128)>,
    /// Final position quantity per outcome, micros.
    pub shares: PerOutcome<i64>,
    /// Remaining fee-inclusive cost basis (12 §9.5).
    pub cost: Usdc,
    /// Σ split collateral.
    pub split_cost: Usdc,
    /// Cash at the end.
    pub cash_end: Usdc,
    /// Starting allowance.
    pub cash_start: Usdc,
    /// `intentMeta` entries as meta ids in fill order, first fill per cid
    /// (21 §16).
    pub intent_meta: Vec<pmb_core::MetaId>,
}

/// Per-market accumulation of one session (21 §11, §13, §15, §16).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarketStatsAcc {
    /// Tick counters.
    pub ticks: TickCounters,
    /// Capital-aware counters.
    pub counters: CandidateCounters,
}

impl CandidateCounters {
    /// Counts one delivered event (21 §10 `counters`).
    pub fn on_delivered(&mut self, ev: &AccountEvent) {
        match ev.kind {
            AccountEventKind::OrderSubmitted { .. } => self.orders_placed += 1,
            AccountEventKind::OrderRejected { reason, .. } => {
                let code = reason.code();
                match self.orders_rejected.iter_mut().find(|(c, _)| *c == code) {
                    Some((_, n)) => *n += 1,
                    None => self.orders_rejected.push((code, 1)),
                }
            }
            AccountEventKind::OrderDone {
                reason: DoneReason::Canceled(_),
                ..
            } => self.orders_canceled += 1,
            AccountEventKind::Fill(f) => {
                let n = f
                    .price
                    .notional(f.qty, Rounding::HalfAwayFromZero)
                    .expect("notional overflow (10 T3)");
                match f.side {
                    Side::Buy => self.buy_notional += n,
                    Side::Sell => self.sell_notional += n,
                }
            }
            _ => {}
        }
    }

    /// Tracks the peak of `reserved` (21 §10 `peakReservedUsdc`).
    #[inline]
    pub fn observe_reserved(&mut self, reserved: Usdc) {
        if reserved > self.peak_reserved {
            self.peak_reserved = reserved;
        }
    }
}

impl MarketStatsAcc {
    /// Builds the unrounded final values from the ledger and the resolution
    /// (21 §11; settlement 12 §9.5). The zero-row and null cases of 21 §13
    /// are decided by the caller from [`TickCounters::events_processed`].
    pub fn finalize(&self, ledger: &Ledger, outcome: FinalOutcome) -> FinalStats {
        let mut trade_as_maker = 0;
        let mut trade_as_taker = 0;
        let mut buy_vwap = PerOutcome::<(i128, i128)>::default();
        let mut taken: Vec<bool> = Vec::new();
        let mut intent_meta = Vec::new();
        let mut trade_count = 0;
        for (i, f) in ledger.fills().iter().enumerate() {
            if ledger.fill_reversed(i) {
                continue;
            }
            trade_count += 1;
            match f.liquidity {
                Liquidity::Maker => trade_as_maker += 1,
                Liquidity::Taker => trade_as_taker += 1,
            }
            if f.side == Side::Buy {
                let v = &mut buy_vwap[f.outcome];
                v.0 += f.price.micros() as i128 * f.qty.micros() as i128;
                v.1 += f.qty.micros() as i128;
            }
            // 21 §16: first fill per cid, in fill order, orders with meta only.
            let r = ledger.order(f.key.order);
            if let Some(m) = r.request().meta {
                let c = r.cid().index();
                if taken.len() <= c {
                    taken.resize(c + 1, false);
                }
                if !taken[c] {
                    taken[c] = true;
                    intent_meta.push(m);
                }
            }
        }
        let mut cost = Usdc::ZERO;
        let mut shares = PerOutcome::<i64>::default();
        for o in Outcome::ALL {
            let p = ledger.position(o);
            cost += p.cost_basis;
            shares[o] = p.qty.micros();
        }
        let cap = ledger.capital();
        FinalStats {
            pnl: ledger.pnl(outcome),
            trade_count,
            trade_as_maker,
            trade_as_taker,
            fees_paid: ledger.fees_paid(),
            buy_vwap,
            shares,
            cost,
            split_cost: ledger.split_cost(),
            cash_end: cap.cash,
            cash_start: cap.starting,
            intent_meta,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_by_cause_and_total() {
        // spec: 21 §15 (fixed array indexed by cause; sum = eventsProcessed)
        let mut t = TickCounters::default();
        t.record(TickCause::Book);
        t.record(TickCause::PriceChange);
        t.record(TickCause::PriceChange);
        t.record(TickCause::ChainlinkRound);
        assert_eq!(t.by_cause, [1, 2, 0, 1]);
        assert_eq!(t.events_processed(), 4);
    }
}
