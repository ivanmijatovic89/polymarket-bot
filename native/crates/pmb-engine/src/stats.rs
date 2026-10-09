//! Per-market accumulation for the engine output (21 §11, §13, §15, §16)
//! and the capital-aware counters (21 §10).
//!
//! Everything here is plain integers updated on the hot path; quantization
//! to output precision happens once, at the output boundary (D08, 10 §4).
//! Conversion into `pmb_contract::result` types is the binary's job.

use pmb_core::event::RejectReason;
use pmb_core::{FinalOutcome, PerOutcome, Usdc};

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
    /// Rejections by reason code, sorted by code at output (21 §17).
    pub orders_rejected: Vec<(RejectReason, u64)>,
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

impl MarketStatsAcc {
    /// Builds the unrounded final values from the ledger and the resolution
    /// (21 §11; settlement 12 §9.5). The zero-row and null cases of 21 §13
    /// are decided by the caller from [`TickCounters::events_processed`].
    pub fn finalize(&self, _ledger: &Ledger, _outcome: FinalOutcome) -> FinalStats {
        todo!("core agent: 21 §11 MarketStats from the ledger")
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
