//! Author views of `Ctx` (30 §5): tick info, books, portfolio, orders and
//! rules. All are borrows; reading them never allocates or copies (30 §16
//! S1, 12 §14 P3).

use pmb_book::OutcomeBook;
use pmb_core::fill::{Capital, Fill, Position};
use pmb_core::ids::{CidInterner, ClientOrderId};
use pmb_core::market_event::QuoteSide;
use pmb_core::rules::{ExchangeRules, FeeCurve, GtdRules, RulesSource, TakerDelay};
use pmb_core::{Outcome, Price, Qty, Rounding, TsMs, Usdc};

use crate::exec::BookOverlay;
use crate::ledger::{Ledger, OrderRecord};

pub use pmb_book::Level;

/// The author view of one order (30 §5.2): the ledger record, read through
/// accessor methods only.
pub type OrderView = OrderRecord;

/// Strategy tick cause (30 §5, 12 §5.3): the closed vocabulary of the
/// `eventsByType` keys (21 §15), identical in both profiles.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TickCause {
    /// `book`.
    Book,
    /// `price_change`.
    PriceChange,
    /// `binance_agg_trade` (synthetic).
    BinanceAggTrade,
    /// `chainlink_round` (synthetic).
    ChainlinkRound,
}

impl TickCause {
    /// Every cause in `eventsByType` order (21 §15).
    pub const ALL: [TickCause; 4] = [
        TickCause::Book,
        TickCause::PriceChange,
        TickCause::BinanceAggTrade,
        TickCause::ChainlinkRound,
    ];

    /// Index into fixed per-cause arrays (21 §15).
    #[inline]
    pub const fn index(self) -> usize {
        self as usize
    }

    /// The TS `event_type` string (12 §5.3).
    pub const fn as_str(self) -> &'static str {
        match self {
            TickCause::Book => "book",
            TickCause::PriceChange => "price_change",
            TickCause::BinanceAggTrade => "binance_agg_trade",
            TickCause::ChainlinkRound => "chainlink_round",
        }
    }

    /// Synthetic feed ticks (14 §8).
    #[inline]
    pub const fn is_synthetic(self) -> bool {
        matches!(self, TickCause::BinanceAggTrade | TickCause::ChainlinkRound)
    }
}

/// The current strategy tick (30 §5 `tick()`); inside `on_event` the last
/// dispatched strategy tick (12 §6.5).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct TickInfo {
    /// 0-based strategy-tick index, as the trace `seq` (22 §3.3).
    pub seq: u64,
    /// Cause.
    pub cause: TickCause,
    /// Synthetic feed tick.
    pub synthetic: bool,
    /// Exchange timestamp of the tick's event, when known.
    pub exchange_ts: Option<TsMs>,
}

/// Book of one outcome (30 §5.1): the recorded book in ts-compat; recorded
/// book minus depletion plus own resting orders in realistic (12 §6.5,
/// 13 §6.11).
#[derive(Copy, Clone, Debug)]
pub struct BookView<'a> {
    pub(crate) outcome: Outcome,
    pub(crate) recorded: Option<&'a OutcomeBook>,
    pub(crate) overlay: Option<&'a BookOverlay>,
    pub(crate) updated_at: TsMs,
    pub(crate) stale: bool,
}

impl<'a> BookView<'a> {
    fn assert_no_overlay(&self) {
        // The realistic overlay merge (13 §6.11) is M3b.
        assert!(
            self.overlay.is_none(),
            "M3b: realistic BookView overlay merge"
        );
    }

    /// Best bid (O(1), 30 §5.1).
    pub fn best_bid(&self) -> Option<Level> {
        self.assert_no_overlay();
        self.recorded.and_then(|b| b.bids.best())
    }

    /// Best ask (O(1), 30 §5.1).
    pub fn best_ask(&self) -> Option<Level> {
        self.assert_no_overlay();
        self.recorded.and_then(|b| b.asks.best())
    }

    /// Bid levels, descending (30 §5.1).
    pub fn bids(&self) -> impl Iterator<Item = Level> + 'a {
        self.assert_no_overlay();
        self.recorded.into_iter().flat_map(|b| b.bids.levels())
    }

    /// Ask levels, ascending (30 §5.1).
    pub fn asks(&self) -> impl Iterator<Item = Level> + 'a {
        self.assert_no_overlay();
        self.recorded.into_iter().flat_map(|b| b.asks.levels())
    }

    /// Depth at or better than `limit` on one side (30 §5.1).
    pub fn depth_through(&self, side: QuoteSide, limit: Price) -> Qty {
        self.assert_no_overlay();
        self.recorded.map_or(Qty::ZERO, |b| match side {
            QuoteSide::Bid => b.bids.depth_through(limit),
            QuoteSide::Ask => b.asks.depth_through(limit),
        })
    }

    /// Mid price with explicit rounding (30 §5.1, §6).
    pub fn mid(&self, r: Rounding) -> Option<Price> {
        let (b, a) = (self.best_bid()?, self.best_ask()?);
        let sum = b.price.micros() as i128 + a.price.micros() as i128;
        let m = pmb_core::fixed::div_round_i128(sum, 2, r).ok()?;
        i64::try_from(m).ok().map(Price::from_micros)
    }

    /// `best_ask − best_bid` (30 §5.1).
    pub fn spread(&self) -> Option<Price> {
        match (self.best_bid(), self.best_ask()) {
            (Some(b), Some(a)) => Some(a.price - b.price),
            _ => None,
        }
    }

    /// Last update time of this book (30 §5.1).
    #[inline]
    pub fn updated_at(&self) -> TsMs {
        self.updated_at
    }

    /// True between a data gap and the next full book (30 §5.1, 12 §5.2).
    #[inline]
    pub fn is_stale(&self) -> bool {
        self.stale
    }

    /// The outcome of this book.
    #[inline]
    pub fn outcome(&self) -> Outcome {
        self.outcome
    }
}

/// The strategy view of the ledger (30 §5.2, 12 §9.7): a borrow, never a
/// copy.
#[derive(Copy, Clone, Debug)]
pub struct PortfolioView<'a> {
    pub(crate) ledger: &'a Ledger,
    pub(crate) cids: &'a CidInterner,
}

impl<'a> PortfolioView<'a> {
    /// Position of an outcome (30 §5.2; `avg_entry` via
    /// [`PortfolioView::avg_entry`]).
    #[inline]
    pub fn position(&self, o: Outcome) -> Position {
        self.ledger.position(o)
    }

    /// Average entry `basis / quantity` when both are positive (12 §9.7).
    // D-PENDING: 12 §9.7 does not name the rounding of the average entry;
    // chose HalfAwayFromZero, the output rule of 10 §3.3 R14.
    pub fn avg_entry(&self, o: Outcome) -> Option<Price> {
        let p = self.ledger.position(o);
        if !p.qty.is_positive() || !p.cost_basis.is_positive() {
            return None;
        }
        pmb_core::fixed::mul_div(
            p.cost_basis.micros(),
            pmb_core::SCALE,
            p.qty.micros(),
            Rounding::HalfAwayFromZero,
        )
        .ok()
        .map(Price::from_micros)
    }

    /// Settled, unreserved shares (30 §5.2; equals `qty` in ts-compat).
    pub fn sellable(&self, o: Outcome) -> Qty {
        self.ledger.sellable(o)
    }

    /// Capital `{starting, cash, reserved}` (30 §5.2).
    #[inline]
    pub fn capital(&self) -> Capital {
        self.ledger.capital()
    }

    /// Realized PnL (30 §5.2).
    #[inline]
    pub fn realized_pnl(&self) -> Usdc {
        self.ledger.realized_pnl()
    }

    /// The latest generation of a cid (30 §5.2, 12 §9.7).
    pub fn order(&self, cid: &ClientOrderId) -> Option<&'a OrderView> {
        let k = self.cids.get(cid.as_str())?;
        let key = self.ledger.current(k)?;
        Some(self.ledger.order(key))
    }

    /// Open orders in submission order (30 §5.2).
    pub fn open_orders(&self) -> impl Iterator<Item = &'a OrderView> + 'a {
        self.ledger.open_orders()
    }

    /// Every order of this market including terminal ones, in submission
    /// order (30 §5.2).
    pub fn orders(&self) -> impl Iterator<Item = &'a OrderView> + 'a {
        self.ledger.orders().iter()
    }

    /// Every fill in delivery order, lossless (12 §9.7).
    pub fn fills(&self) -> &'a [Fill] {
        self.ledger.fills()
    }

    /// Text of an order's client order id (30 §5.2 `cid`).
    // D-PENDING: 30 §5.2 lists `cid` on OrderView; records hold the interned
    // key, so the text is resolved through the portfolio view.
    pub fn cid_str(&self, order: &OrderView) -> &'a str {
        self.cids.resolve(order.cid())
    }
}

/// Exchange rules in force (30 §5 `rules()`, 11).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RulesView {
    pub(crate) rules: ExchangeRules,
    pub(crate) source: RulesSource,
}

impl RulesView {
    /// Tick in force for an outcome (11 §7.5).
    #[inline]
    pub fn tick(&self, o: Outcome) -> Price {
        self.rules.tick[o]
    }
    /// Minimum resting size, shares (11 §7.4).
    #[inline]
    pub fn min_order_size(&self) -> Qty {
        self.rules.min_size_resting
    }
    /// Valid price bounds `[tick, 1 − tick]` for an outcome (11 §7.2).
    pub fn price_bounds(&self, o: Outcome) -> (Price, Price) {
        let t = self.tick(o);
        (t, Price::ONE - t)
    }
    /// Fee curve in force (11 §5).
    #[inline]
    pub fn fee_schedule(&self) -> &FeeCurve {
        &self.rules.fee
    }
    /// Taker delay in force, when enabled (11 §6).
    #[inline]
    pub fn taker_delay(&self) -> Option<&TakerDelay> {
        self.rules
            .taker_delay_enabled
            .then_some(&self.rules.taker_delay)
    }
    /// GTD minimum lead (11 §8).
    #[inline]
    pub fn gtd_min_lead(&self) -> pmb_core::DurMs {
        self.rules.gtd.min_lead
    }
    /// GTD early expiry (11 §8).
    #[inline]
    pub fn gtd_early_expiry(&self) -> pmb_core::DurMs {
        self.rules.gtd.early_expiry
    }
    /// GTD rules (11 §8).
    #[inline]
    pub fn gtd(&self) -> &GtdRules {
        &self.rules.gtd
    }
    /// Batch cap; `None` is unbounded (ts-compat, 11 §9).
    #[inline]
    pub fn batch_cap(&self) -> Option<u8> {
        self.rules.max_place_batch
    }
    /// RS4 source classification (11 §13.3).
    #[inline]
    pub fn source(&self) -> RulesSource {
        self.source
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_cause_order_and_strings() {
        // spec: 12 §5.3 tick causes, 21 §15 eventsByType keys
        let s: Vec<_> = TickCause::ALL.iter().map(|c| c.as_str()).collect();
        assert_eq!(
            s,
            [
                "book",
                "price_change",
                "binance_agg_trade",
                "chainlink_round"
            ]
        );
        for (i, c) in TickCause::ALL.iter().enumerate() {
            assert_eq!(c.index(), i);
        }
        assert!(!TickCause::Book.is_synthetic());
        assert!(TickCause::ChainlinkRound.is_synthetic());
    }

    #[test]
    fn book_view_reads_recorded_book() {
        // spec: 30 §5.1, 12 §6.5 (ts-compat: recorded book)
        let mut books = pmb_book::MarketBooks::new();
        let l = |p: i64, s: i64| Level {
            price: Price::from_micros(p),
            size: Qty::from_micros(s),
        };
        books.apply_snapshot(
            Outcome::Up,
            [l(400_000, 1_000_000), l(390_000, 2_000_000)],
            [l(420_000, 3_000_000)],
        );
        let v = BookView {
            outcome: Outcome::Up,
            recorded: books.get(Outcome::Up),
            overlay: None,
            updated_at: TsMs(7),
            stale: false,
        };
        assert_eq!(v.best_bid().unwrap().price, Price::from_micros(400_000));
        assert_eq!(v.best_ask().unwrap().price, Price::from_micros(420_000));
        assert_eq!(v.spread(), Some(Price::from_micros(20_000)));
        assert_eq!(v.mid(Rounding::Floor), Some(Price::from_micros(410_000)));
        assert_eq!(v.bids().count(), 2);
        assert_eq!(
            v.depth_through(QuoteSide::Bid, Price::from_micros(390_000)),
            Qty::from_micros(3_000_000)
        );
        let empty = BookView {
            recorded: books.get(Outcome::Down),
            outcome: Outcome::Down,
            ..v
        };
        assert_eq!(empty.best_bid(), None);
        assert_eq!(empty.asks().count(), 0);
    }
}
