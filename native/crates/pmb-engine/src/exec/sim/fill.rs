//! Fill models (13 §4.4 `FillModel`, §4.5): taker walks with optional
//! depletion (13 §6.4), resting-order fills (13 §6.5), and the fill unit
//! F-U1/F-U2 shared by every model.
//!
//! The walk iterates the recorded book in place and calls back per level;
//! nothing is collected, so a walk allocates nothing (13 X1, §10).

use pmb_book::{MarketBooks, OutcomeBook};
use pmb_core::fill::{Fill, Liquidity};
use pmb_core::ids::{FillKey, TradeSeq};
use pmb_core::market_event::QuoteSide;
use pmb_core::order::Side;
use pmb_core::{Outcome, Price, Qty, TsMs, Usdc};

use super::book_overlay::{Deficits, RestingOrder};
use super::compat::CompatFill;

/// Taker matching with depletion, and resting-order fills (13 §4.4).
pub trait FillModel {
    /// Effective opposite size of a recorded level as a taker sees it
    /// (13 §4.2): the recorded size minus the session's deficit, or the
    /// recorded size under `depletion: none`.
    fn effective_size(
        &self,
        deficits: &Deficits,
        outcome: Outcome,
        side: QuoteSide,
        price: Price,
        recorded: Qty,
    ) -> Qty;
    /// Records `qty` consumed at a level (13 §6.4 depletion); a no-op under
    /// `depletion: none`.
    fn consume(
        &self,
        deficits: &mut Deficits,
        outcome: Outcome,
        side: QuoteSide,
        price: Price,
        qty: Qty,
    );
    /// Quantity of a resting order that fills on the current market event,
    /// at its limit price (13 §5.1 `WorstQueueCompat`, §6.5).
    fn maker_fill(&self, order: &RestingOrder, books: &MarketBooks) -> Qty;
}

/// The fill axes (13 §7.3 `models.depletion` and `models.maker`),
/// enum-dispatched (13 §4.4). The realistic depletion policies and the
/// `queue`/`trade_through` maker models are added in M3b.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Fills {
    /// `depletion: none` + `maker: worst_queue` (+ the compat taker).
    Compat(CompatFill),
}

impl FillModel for Fills {
    #[inline]
    fn effective_size(
        &self,
        deficits: &Deficits,
        outcome: Outcome,
        side: QuoteSide,
        price: Price,
        recorded: Qty,
    ) -> Qty {
        match self {
            Fills::Compat(m) => m.effective_size(deficits, outcome, side, price, recorded),
        }
    }
    #[inline]
    fn consume(
        &self,
        deficits: &mut Deficits,
        outcome: Outcome,
        side: QuoteSide,
        price: Price,
        qty: Qty,
    ) {
        match self {
            Fills::Compat(m) => m.consume(deficits, outcome, side, price, qty),
        }
    }
    #[inline]
    fn maker_fill(&self, order: &RestingOrder, books: &MarketBooks) -> Qty {
        match self {
            Fills::Compat(m) => m.maker_fill(order, books),
        }
    }
}

/// The book side a taker order of `side` walks: BUY takes asks, SELL takes
/// bids.
#[inline]
pub fn opposite(side: Side) -> QuoteSide {
    match side {
        Side::Buy => QuoteSide::Ask,
        Side::Sell => QuoteSide::Bid,
    }
}

#[inline]
fn book_side(book: &OutcomeBook, q: QuoteSide) -> &pmb_book::BookSide {
    match q {
        QuoteSide::Ask => &book.asks,
        QuoteSide::Bid => &book.bids,
    }
}

/// Whether a level price crosses a taker limit (BUY: `level ≤ limit`; SELL:
/// `level ≥ limit`; 13 §5.1 walk).
#[inline]
pub fn crosses(side: Side, level: Price, limit: Price) -> bool {
    match side {
        Side::Buy => level <= limit,
        Side::Sell => level >= limit,
    }
}

/// The taker side of a walk: which book, which direction, which limit.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct TakerSide {
    /// Outcome whose book is walked.
    pub outcome: Outcome,
    /// Our side.
    pub side: Side,
    /// Limit (BUY maximum, SELL minimum).
    pub limit: Price,
}

/// `fillable` (13 §5.1 taker step 3): the sum of effective opposite level
/// sizes within the limit. An outcome without a book offers nothing.
pub fn fillable<M: FillModel>(
    model: &M,
    deficits: &Deficits,
    books: &MarketBooks,
    t: TakerSide,
) -> Qty {
    let TakerSide {
        outcome,
        side,
        limit,
    } = t;
    let Some(book) = books.get(outcome) else {
        return Qty::ZERO;
    };
    let q = opposite(side);
    let mut sum = Qty::ZERO;
    for l in book_side(book, q).levels() {
        if !crosses(side, l.price, limit) {
            break;
        }
        sum += model.effective_size(deficits, outcome, q, l.price, l.size);
    }
    sum
}

/// Walks effective opposite levels best first while the level price crosses
/// the limit, taking `min(remaining, effective size)` per level and calling
/// `on_level(price, take)` once per level with a positive take (13 §5.1;
/// one TAKER fill per level, F-U2). Consumption is recorded through the
/// model (depletion). Returns the remainder.
pub fn walk<M: FillModel>(
    model: &M,
    deficits: &mut Deficits,
    books: &MarketBooks,
    t: TakerSide,
    mut remaining: Qty,
    mut on_level: impl FnMut(Price, Qty),
) -> Qty {
    let TakerSide {
        outcome,
        side,
        limit,
    } = t;
    let Some(book) = books.get(outcome) else {
        return remaining;
    };
    let q = opposite(side);
    for l in book_side(book, q).levels() {
        if !remaining.is_positive() || !crosses(side, l.price, limit) {
            break;
        }
        let avail = model.effective_size(deficits, outcome, q, l.price, l.size);
        let take = remaining.min(avail);
        if !take.is_positive() {
            continue;
        }
        model.consume(deficits, outcome, q, l.price, take);
        remaining -= take;
        on_level(l.price, take);
    }
    remaining
}

/// Session counter of exchange trades (10 §6 `TradeSeq`): dense from 0 in
/// the order the simulator first observes each match (13 F-U2: one trade
/// per taker walk, one per maker fill).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct TradeCounter(u32);

impl TradeCounter {
    /// The next trade.
    #[inline]
    pub fn next_trade(&mut self) -> TradeSeq {
        let t = TradeSeq::new(self.0);
        self.0 += 1;
        t
    }

    /// Trades observed so far.
    #[inline]
    pub fn count(self) -> u32 {
        self.0
    }
}

/// The fields of one fill (13 §4.5 unit: one per (own order, trade, price
/// level)).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FillSpec {
    /// Trade this fill belongs to.
    pub trade: TradeSeq,
    /// Execution price.
    pub price: Price,
    /// Quantity.
    pub qty: Qty,
    /// Fee from the fee model, computed once (12 §9.5).
    pub fee: Usdc,
    /// Maker or taker.
    pub liquidity: Liquidity,
    /// Delivery time (13 §2.3 TS3).
    pub at: TsMs,
    /// Match time at the exchange.
    pub exchange_ts: TsMs,
}

/// Builds the core `Fill` of an order and advances its `FillKey.seq`
/// (10 §6: starts at 1 per order, strictly increasing in delivery order;
/// the simulator pushes fills in delivery order).
#[inline]
pub fn make_fill(
    order: pmb_core::ids::OrderKey,
    fill_seq: &mut u32,
    outcome: Outcome,
    side: Side,
    spec: FillSpec,
) -> Fill {
    *fill_seq += 1;
    Fill {
        key: FillKey {
            order,
            seq: *fill_seq,
        },
        trade: spec.trade,
        outcome,
        side,
        price: spec.price,
        qty: spec.qty,
        fee: spec.fee,
        liquidity: spec.liquidity,
        at: spec.at,
        exchange_ts: Some(spec.exchange_ts),
        late: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_book::Level;

    fn lv(p: i64, s: i64) -> Level {
        Level {
            price: Price::from_micros(p),
            size: Qty::from_micros(s),
        }
    }

    fn books() -> MarketBooks {
        let mut b = MarketBooks::new();
        b.apply_snapshot(
            Outcome::Up,
            [lv(400_000, 3_000_000), lv(390_000, 5_000_000)],
            [
                lv(600_000, 2_000_000),
                lv(610_000, 4_000_000),
                lv(650_000, 9_000_000),
            ],
        );
        b
    }

    #[test]
    fn fillable_sums_levels_within_the_limit() {
        // spec: 13 §5.1 taker step 3 (fillable = Σ opposite level sizes within the limit)
        let b = books();
        let d = Deficits::default();
        let m = CompatFill;
        let ts = |side, p| TakerSide {
            outcome: Outcome::Up,
            side,
            limit: Price::from_micros(p),
        };
        let buy = |p| fillable(&m, &d, &b, ts(Side::Buy, p));
        assert_eq!(buy(599_999), Qty::ZERO);
        assert_eq!(buy(600_000), Qty::from_micros(2_000_000));
        assert_eq!(buy(640_000), Qty::from_micros(6_000_000));
        let sell = fillable(&m, &d, &b, ts(Side::Sell, 390_000));
        assert_eq!(sell, Qty::from_micros(8_000_000));
        // An outcome without a book offers nothing.
        let down = TakerSide {
            outcome: Outcome::Down,
            side: Side::Buy,
            limit: Price::ONE,
        };
        assert_eq!(fillable(&m, &d, &b, down), Qty::ZERO);
    }

    #[test]
    fn walk_takes_best_first_one_call_per_level() {
        // spec: 13 §5.1 walk (best first, min(remaining, level size), one fill per level; F-U2)
        let b = books();
        let mut d = Deficits::default();
        let mut seen = Vec::new();
        let buy610 = TakerSide {
            outcome: Outcome::Up,
            side: Side::Buy,
            limit: Price::from_micros(610_000),
        };
        let rem = walk(
            &CompatFill,
            &mut d,
            &b,
            buy610,
            Qty::from_micros(7_000_000),
            |p, q| seen.push((p.micros(), q.micros())),
        );
        assert_eq!(seen, vec![(600_000, 2_000_000), (610_000, 4_000_000)]);
        assert_eq!(rem, Qty::from_micros(1_000_000));
        // No depletion under the compat model (TC-E3): the same walk again sees the same book.
        assert!(d.is_empty());
        let rem2 = walk(
            &CompatFill,
            &mut d,
            &b,
            buy610,
            Qty::from_micros(1_000_000),
            |_, _| {},
        );
        assert_eq!(rem2, Qty::ZERO);
    }

    #[test]
    fn fill_unit_numbers_fills_per_order() {
        // spec: 10 §6 (FillKey.seq starts at 1 per order), 13 §4.5 F-U1
        let mut seq = 0u32;
        let mut trades = TradeCounter::default();
        let t = trades.next_trade();
        let spec = FillSpec {
            trade: t,
            price: Price::from_micros(500_000),
            qty: Qty::from_micros(1_000_000),
            fee: Usdc::ZERO,
            liquidity: Liquidity::Maker,
            at: TsMs(9),
            exchange_ts: TsMs(9),
        };
        let k = pmb_core::ids::OrderKey::new(4);
        let a = make_fill(k, &mut seq, Outcome::Up, Side::Buy, spec);
        let b = make_fill(k, &mut seq, Outcome::Up, Side::Buy, spec);
        assert_eq!((a.key.seq, b.key.seq), (1, 2));
        assert_eq!(a.trade, TradeSeq::new(0));
        assert_eq!(trades.next_trade(), TradeSeq::new(1));
        assert_eq!(trades.count(), 2);
        assert!(!a.late);
    }
}
