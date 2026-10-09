//! Sparse per-session book overlay (13 §4.2, §6.11): own resting orders in
//! rest order with their fill-model state (the simulator's exchange truth,
//! 13 §4.1) and depletion deficits keyed by (outcome, side, price).
//!
//! The recorded book lives in `SharedMarket` and is never mutated by a
//! session (13 §4.2, 15 I-5); only this overlay is per session.

use pmb_core::ids::OrderKey;
use pmb_core::market_event::QuoteSide;
use pmb_core::order::Side;
use pmb_core::{Outcome, PerOutcome, Price, Qty, TsMs};

use crate::exec::OverlayLevel;

/// An own order resting at the simulated exchange (13 §4.1, §6.5).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RestingOrder {
    /// Engine key (10 §6).
    pub key: OrderKey,
    /// Outcome.
    pub outcome: Outcome,
    /// Side.
    pub side: Side,
    /// Limit price `P`.
    pub price: Price,
    /// Original size (shares).
    pub size: Qty,
    /// Remaining size `r` at the exchange.
    pub remaining: Qty,
    /// Effective expiry on the loop clock for GTD (ts-compat: the stated
    /// `expire_at`, TC-E5); `None` for GTC.
    pub expire_at: Option<TsMs>,
    /// Last `FillKey.seq` used for this order (starts at 1, 10 §6).
    pub fill_seq: u32,
}

impl RestingOrder {
    /// Exchange-side filled quantity: `size − remaining` (10 S3).
    #[inline]
    pub fn filled(&self) -> Qty {
        self.size - self.remaining
    }
}

/// Bounds over the resting set, for the exact early exit of the maker scan
/// (13 §5.1 "early exit", §10): no order can fill or expire on a tick whose
/// book does not cross any of these and whose time precedes the earliest
/// expiry.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RestingBounds {
    /// Highest own BUY limit per outcome.
    pub max_buy: PerOutcome<Option<Price>>,
    /// Lowest own SELL limit per outcome.
    pub min_sell: PerOutcome<Option<Price>>,
    /// Earliest GTD expiry.
    pub min_expiry: Option<TsMs>,
}

impl RestingBounds {
    const EMPTY: RestingBounds = RestingBounds {
        max_buy: PerOutcome::new(None, None),
        min_sell: PerOutcome::new(None, None),
        min_expiry: None,
    };
}

/// Own resting orders in rest order (13 §4.2): the order in which they
/// started resting, which is the TS `openByClientId` insertion order the
/// maker scan and scope cancels iterate (`BacktestExecution.ts:744-751,
/// 803-834`). Removal keeps the order.
#[derive(Clone, Debug, Default)]
pub struct RestingSet {
    orders: Vec<RestingOrder>,
    bounds: Option<RestingBounds>,
}

impl RestingSet {
    /// An empty set.
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of resting orders.
    #[inline]
    pub fn len(&self) -> usize {
        self.orders.len()
    }

    /// Whether nothing rests.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.orders.is_empty()
    }

    /// Resting orders in rest order.
    #[inline]
    pub fn as_slice(&self) -> &[RestingOrder] {
        &self.orders
    }

    /// Index of a key, if it rests (linear; own resting sets are small).
    #[inline]
    pub fn position(&self, key: OrderKey) -> Option<usize> {
        self.orders.iter().position(|o| o.key == key)
    }

    /// The order at `i`.
    #[inline]
    pub fn get(&self, i: usize) -> &RestingOrder {
        &self.orders[i]
    }

    /// Mutable access to the order at `i`. Price, side, outcome and expiry
    /// must not change (they feed the cached bounds).
    #[inline]
    pub fn get_mut(&mut self, i: usize) -> &mut RestingOrder {
        &mut self.orders[i]
    }

    /// Appends an order that starts resting.
    #[inline]
    pub fn push(&mut self, o: RestingOrder) {
        debug_assert!(self.position(o.key).is_none(), "order rests twice");
        self.orders.push(o);
        self.bounds = None;
    }

    /// Removes the order at `i`, keeping rest order.
    #[inline]
    pub fn remove(&mut self, i: usize) -> RestingOrder {
        self.bounds = None;
        self.orders.remove(i)
    }

    /// Bounds over the current set, recomputed lazily after a change.
    pub fn bounds(&mut self) -> RestingBounds {
        if let Some(b) = self.bounds {
            return b;
        }
        let mut b = RestingBounds::EMPTY;
        for o in &self.orders {
            match o.side {
                Side::Buy => {
                    let m = &mut b.max_buy[o.outcome];
                    *m = Some(m.map_or(o.price, |x| x.max(o.price)));
                }
                Side::Sell => {
                    let m = &mut b.min_sell[o.outcome];
                    *m = Some(m.map_or(o.price, |x| x.min(o.price)));
                }
            }
            if let Some(e) = o.expire_at {
                b.min_expiry = Some(b.min_expiry.map_or(e, |x| x.min(e)));
            }
        }
        self.bounds = Some(b);
        b
    }
}

/// Depletion deficits keyed by (outcome, side, price) (13 §4.2): effective
/// opposite liquidity = `max(0, recorded − deficit)`. Sorted vector, so
/// iteration is ordered and deterministic (R7). Empty under
/// `depletion: none` (ts-compat); the realistic policies
/// `persistent_deficit` and `reset_on_update` fill it from M3b (13 §6.4).
#[derive(Clone, Debug, Default)]
pub struct Deficits {
    levels: Vec<OverlayLevel>,
}

impl Deficits {
    #[inline]
    fn search(&self, outcome: Outcome, side: QuoteSide, price: Price) -> Result<usize, usize> {
        self.levels
            .binary_search_by(|l| (l.outcome, l.side, l.price).cmp(&(outcome, side, price)))
    }

    /// The deficit at a level (0 when none).
    #[inline]
    pub fn get(&self, outcome: Outcome, side: QuoteSide, price: Price) -> Qty {
        match self.search(outcome, side, price) {
            Ok(i) => self.levels[i].size,
            Err(_) => Qty::ZERO,
        }
    }

    /// Effective size of a recorded level: `max(0, recorded − deficit)`
    /// (13 §4.2).
    #[inline]
    pub fn effective(&self, outcome: Outcome, side: QuoteSide, price: Price, recorded: Qty) -> Qty {
        let e = recorded - self.get(outcome, side, price);
        if e.is_negative() {
            Qty::ZERO
        } else {
            e
        }
    }

    /// Adds consumed quantity to a level's deficit (13 §6.4).
    pub fn add(&mut self, outcome: Outcome, side: QuoteSide, price: Price, qty: Qty) {
        match self.search(outcome, side, price) {
            Ok(i) => self.levels[i].size += qty,
            Err(i) => self.levels.insert(
                i,
                OverlayLevel {
                    outcome,
                    side,
                    price,
                    size: qty,
                },
            ),
        }
    }

    /// Clears a level's deficit (the recorded level disappeared or, under
    /// `reset_on_update`, was updated; 13 §6.4).
    pub fn clear_level(&mut self, outcome: Outcome, side: QuoteSide, price: Price) {
        if let Ok(i) = self.search(outcome, side, price) {
            self.levels.remove(i);
        }
    }

    /// Every deficit, sorted by (outcome, side, price).
    #[inline]
    pub fn levels(&self) -> &[OverlayLevel] {
        &self.levels
    }

    /// Whether no deficit is kept.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.levels.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ro(k: u32, outcome: Outcome, side: Side, price: i64, expire: Option<i64>) -> RestingOrder {
        RestingOrder {
            key: OrderKey::new(k),
            outcome,
            side,
            price: Price::from_micros(price),
            size: Qty::from_micros(10_000_000),
            remaining: Qty::from_micros(10_000_000),
            expire_at: expire.map(TsMs),
            fill_seq: 0,
        }
    }

    #[test]
    fn rest_order_is_kept_on_removal() {
        // spec: 13 §4.2 (own resting orders in rest order), 13 §5.1 (scan in rest order)
        let mut s = RestingSet::new();
        for k in 0..4 {
            s.push(ro(k, Outcome::Up, Side::Buy, 400_000, None));
        }
        let removed = s.remove(1);
        assert_eq!(removed.key, OrderKey::new(1));
        let keys: Vec<_> = s.as_slice().iter().map(|o| o.key.get()).collect();
        assert_eq!(keys, vec![0, 2, 3]);
        assert_eq!(s.position(OrderKey::new(3)), Some(2));
        assert_eq!(s.position(OrderKey::new(1)), None);
    }

    #[test]
    fn bounds_track_best_own_prices_and_expiry() {
        // spec: 13 §10 (crossing check against the best own price), 13 §5.1 early exit
        let mut s = RestingSet::new();
        s.push(ro(0, Outcome::Up, Side::Buy, 400_000, None));
        s.push(ro(1, Outcome::Up, Side::Buy, 450_000, Some(9_000)));
        s.push(ro(2, Outcome::Down, Side::Sell, 700_000, Some(5_000)));
        s.push(ro(3, Outcome::Down, Side::Sell, 650_000, None));
        let b = s.bounds();
        assert_eq!(b.max_buy[Outcome::Up], Some(Price::from_micros(450_000)));
        assert_eq!(b.max_buy[Outcome::Down], None);
        assert_eq!(b.min_sell[Outcome::Down], Some(Price::from_micros(650_000)));
        assert_eq!(b.min_expiry, Some(TsMs(5_000)));
        s.remove(2);
        assert_eq!(s.bounds().min_expiry, Some(TsMs(9_000)));
    }

    #[test]
    fn deficits_are_sorted_and_clamp_effective_size() {
        // spec: 13 §4.2 (effective = max(0, recorded − deficit); sparse, keyed by level)
        let mut d = Deficits::default();
        let (o, s) = (Outcome::Up, QuoteSide::Ask);
        let p1 = Price::from_micros(600_000);
        let p0 = Price::from_micros(550_000);
        d.add(o, s, p1, Qty::from_micros(3_000_000));
        d.add(o, s, p0, Qty::from_micros(1_000_000));
        d.add(o, s, p1, Qty::from_micros(1_000_000));
        assert_eq!(d.levels()[0].price, p0);
        assert_eq!(d.get(o, s, p1), Qty::from_micros(4_000_000));
        assert_eq!(
            d.effective(o, s, p1, Qty::from_micros(10_000_000)),
            Qty::from_micros(6_000_000)
        );
        assert_eq!(
            d.effective(o, s, p1, Qty::from_micros(2_000_000)),
            Qty::ZERO
        );
        d.clear_level(o, s, p1);
        assert_eq!(d.get(o, s, p1), Qty::ZERO);
        assert!(!d.is_empty());
    }
}
