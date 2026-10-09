//! Order books per outcome: recorded book reconstruction (15 §2.1) on the
//! dense-ladder layout of 16 §8.
//!
//! Each side is a ladder of 10,001 slots indexed by `price / 100` micros
//! (0.0001 units, BK-1) with a two-level occupancy bitset, plus an ordered
//! overflow map for prices off that grid or outside `[0, 1]` (anomalies are
//! replayed as recorded, 15 I-6). Applies report whether the top of book
//! changed (BK-7).

use pmb_core::{Outcome, PerOutcome, Price, Qty};
use std::collections::BTreeMap;

/// Ladder resolution in micros (0.0001 USDC).
pub const LADDER_STEP: i64 = 100;
/// Number of ladder slots (prices 0.0000 ..= 1.0000).
pub const LADDER_SLOTS: usize = 10_001;
const WORDS: usize = LADDER_SLOTS.div_ceil(64);
const SUMMARY_WORDS: usize = WORDS.div_ceil(64);

/// Book side.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Side {
    /// Bids: best is the highest price.
    Bid,
    /// Asks: best is the lowest price.
    Ask,
}

/// One price level.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Level {
    pub price: Price,
    pub size: Qty,
}

/// Best price and size of one side, used for the top-change bit (BK-7).
type Top = Option<Level>;

/// One side of one outcome's book.
#[derive(Clone)]
pub struct BookSide {
    side: Side,
    sizes: Box<[i64; LADDER_SLOTS]>,
    bits: [u64; WORDS],
    summary: [u64; SUMMARY_WORDS],
    overflow: BTreeMap<i64, i64>,
    len: usize,
}

impl std::fmt::Debug for BookSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BookSide")
            .field("side", &self.side)
            .field("levels", &self.levels().collect::<Vec<_>>())
            .finish()
    }
}

#[inline]
fn slot_of(price: Price) -> Option<usize> {
    let m = price.micros();
    if (0..=1_000_000).contains(&m) && m % LADDER_STEP == 0 {
        Some((m / LADDER_STEP) as usize)
    } else {
        None
    }
}

#[inline]
fn price_of(slot: usize) -> Price {
    Price::from_micros(slot as i64 * LADDER_STEP)
}

impl BookSide {
    pub fn new(side: Side) -> Self {
        let sizes: Box<[i64; LADDER_SLOTS]> = vec![0i64; LADDER_SLOTS]
            .into_boxed_slice()
            .try_into()
            .expect("ladder size");
        BookSide {
            side,
            sizes,
            bits: [0; WORDS],
            summary: [0; SUMMARY_WORDS],
            overflow: BTreeMap::new(),
            len: 0,
        }
    }

    #[inline]
    pub fn side(&self) -> Side {
        self.side
    }

    /// Number of non-empty levels.
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    fn set_bit(&mut self, slot: usize) {
        let w = slot / 64;
        self.bits[w] |= 1u64 << (slot % 64);
        self.summary[w / 64] |= 1u64 << (w % 64);
    }

    #[inline]
    fn clear_bit(&mut self, slot: usize) {
        let w = slot / 64;
        self.bits[w] &= !(1u64 << (slot % 64));
        if self.bits[w] == 0 {
            self.summary[w / 64] &= !(1u64 << (w % 64));
        }
    }

    /// Sets the aggregate size at `price`; `size <= 0` removes the level (I-6b).
    #[inline]
    pub fn set(&mut self, price: Price, size: Qty) {
        let s = size.micros();
        match slot_of(price) {
            Some(slot) => {
                let old = self.sizes[slot];
                if s > 0 {
                    self.sizes[slot] = s;
                    if old == 0 {
                        self.set_bit(slot);
                        self.len += 1;
                    }
                } else if old != 0 {
                    self.sizes[slot] = 0;
                    self.clear_bit(slot);
                    self.len -= 1;
                }
            }
            None => {
                if s > 0 {
                    if self.overflow.insert(price.micros(), s).is_none() {
                        self.len += 1;
                    }
                } else if self.overflow.remove(&price.micros()).is_some() {
                    self.len -= 1;
                }
            }
        }
    }

    /// Removes every level, touching only occupied slots (BK-2).
    pub fn clear(&mut self) {
        for sw in 0..SUMMARY_WORDS {
            let mut s = self.summary[sw];
            while s != 0 {
                let w = sw * 64 + s.trailing_zeros() as usize;
                s &= s - 1;
                let mut b = self.bits[w];
                while b != 0 {
                    let slot = w * 64 + b.trailing_zeros() as usize;
                    b &= b - 1;
                    self.sizes[slot] = 0;
                }
                self.bits[w] = 0;
            }
            self.summary[sw] = 0;
        }
        self.overflow.clear();
        self.len = 0;
    }

    /// Size at an exact price (0 when absent).
    #[inline]
    pub fn size_at(&self, price: Price) -> Qty {
        match slot_of(price) {
            Some(slot) => Qty::from_micros(self.sizes[slot]),
            None => Qty::from_micros(self.overflow.get(&price.micros()).copied().unwrap_or(0)),
        }
    }

    fn ladder_max(&self) -> Option<usize> {
        for sw in (0..SUMMARY_WORDS).rev() {
            let s = self.summary[sw];
            if s != 0 {
                let w = sw * 64 + 63 - s.leading_zeros() as usize;
                let b = self.bits[w];
                return Some(w * 64 + 63 - b.leading_zeros() as usize);
            }
        }
        None
    }

    fn ladder_min(&self) -> Option<usize> {
        for sw in 0..SUMMARY_WORDS {
            let s = self.summary[sw];
            if s != 0 {
                let w = sw * 64 + s.trailing_zeros() as usize;
                let b = self.bits[w];
                return Some(w * 64 + b.trailing_zeros() as usize);
            }
        }
        None
    }

    /// Next occupied ladder slot strictly above `slot`.
    fn next_above(&self, slot: usize) -> Option<usize> {
        let start = slot + 1;
        if start >= LADDER_SLOTS {
            return None;
        }
        let mut w = start / 64;
        let mut word = self.bits[w] & (!0u64 << (start % 64));
        loop {
            if word != 0 {
                return Some(w * 64 + word.trailing_zeros() as usize);
            }
            w += 1;
            if w >= WORDS {
                return None;
            }
            word = self.bits[w];
        }
    }

    /// Next occupied ladder slot strictly below `slot`.
    fn next_below(&self, slot: usize) -> Option<usize> {
        if slot == 0 {
            return None;
        }
        let end = slot - 1;
        let mut w = end / 64;
        let shift = 63 - (end % 64);
        let mut word = self.bits[w] & (!0u64 >> shift);
        loop {
            if word != 0 {
                return Some(w * 64 + 63 - word.leading_zeros() as usize);
            }
            if w == 0 {
                return None;
            }
            w -= 1;
            word = self.bits[w];
        }
    }

    /// Best level: highest bid or lowest ask.
    #[inline]
    pub fn best(&self) -> Option<Level> {
        let ladder = match self.side {
            Side::Bid => self.ladder_max(),
            Side::Ask => self.ladder_min(),
        }
        .map(|slot| Level {
            price: price_of(slot),
            size: Qty::from_micros(self.sizes[slot]),
        });
        let over = match self.side {
            Side::Bid => self.overflow.iter().next_back(),
            Side::Ask => self.overflow.iter().next(),
        }
        .map(|(&p, &s)| Level {
            price: Price::from_micros(p),
            size: Qty::from_micros(s),
        });
        match (ladder, over) {
            (Some(a), Some(b)) => Some(if self.better(b.price, a.price) { b } else { a }),
            (a, b) => a.or(b),
        }
    }

    #[inline]
    fn better(&self, a: Price, b: Price) -> bool {
        match self.side {
            Side::Bid => a > b,
            Side::Ask => a < b,
        }
    }

    /// Levels best-first (bids descending, asks ascending).
    pub fn levels(&self) -> impl Iterator<Item = Level> + '_ {
        LevelIter::new(self)
    }

    /// Sum of sizes of levels at or better than `limit` (BUY walks asks
    /// `<= limit`, SELL walks bids `>= limit`).
    pub fn depth_through(&self, limit: Price) -> Qty {
        let mut total = Qty::ZERO;
        for l in self.levels() {
            let ok = match self.side {
                Side::Ask => l.price <= limit,
                Side::Bid => l.price >= limit,
            };
            if !ok {
                break;
            }
            total += l.size;
        }
        total
    }
}

/// Best-first iterator merging the ladder and the overflow map.
struct LevelIter<'a> {
    book: &'a BookSide,
    next_slot: Option<usize>,
    over: Vec<(i64, i64)>,
    over_pos: usize,
}

impl<'a> LevelIter<'a> {
    fn new(book: &'a BookSide) -> Self {
        let next_slot = match book.side {
            Side::Bid => book.ladder_max(),
            Side::Ask => book.ladder_min(),
        };
        let mut over: Vec<(i64, i64)> = book.overflow.iter().map(|(&p, &s)| (p, s)).collect();
        if book.side == Side::Bid {
            over.reverse();
        }
        LevelIter {
            book,
            next_slot,
            over,
            over_pos: 0,
        }
    }

    fn advance_slot(&mut self, slot: usize) {
        let b = self.book;
        self.next_slot = match b.side {
            Side::Ask => b.next_above(slot),
            Side::Bid => b.next_below(slot),
        };
    }
}

impl Iterator for LevelIter<'_> {
    type Item = Level;
    fn next(&mut self) -> Option<Level> {
        let ladder = self.next_slot.map(|s| (price_of(s), s));
        let over = self.over.get(self.over_pos).copied();
        match (ladder, over) {
            (None, None) => None,
            (Some((p, s)), None) => {
                self.advance_slot(s);
                Some(Level {
                    price: p,
                    size: Qty::from_micros(self.book.sizes[s]),
                })
            }
            (None, Some((p, sz))) => {
                self.over_pos += 1;
                Some(Level {
                    price: Price::from_micros(p),
                    size: Qty::from_micros(sz),
                })
            }
            (Some((lp, s)), Some((op, sz))) => {
                if self.book.better(Price::from_micros(op), lp) {
                    self.over_pos += 1;
                    Some(Level {
                        price: Price::from_micros(op),
                        size: Qty::from_micros(sz),
                    })
                } else {
                    self.advance_slot(s);
                    Some(Level {
                        price: lp,
                        size: Qty::from_micros(self.book.sizes[s]),
                    })
                }
            }
        }
    }
}

/// Both sides of one outcome's book.
#[derive(Clone, Debug)]
pub struct OutcomeBook {
    pub bids: BookSide,
    pub asks: BookSide,
}

impl Default for OutcomeBook {
    fn default() -> Self {
        OutcomeBook {
            bids: BookSide::new(Side::Bid),
            asks: BookSide::new(Side::Ask),
        }
    }
}

impl OutcomeBook {
    #[inline]
    pub fn side(&self, side: Side) -> &BookSide {
        match side {
            Side::Bid => &self.bids,
            Side::Ask => &self.asks,
        }
    }

    #[inline]
    pub fn side_mut(&mut self, side: Side) -> &mut BookSide {
        match side {
            Side::Bid => &mut self.bids,
            Side::Ask => &mut self.asks,
        }
    }

    #[inline]
    fn tops(&self) -> (Top, Top) {
        (self.bids.best(), self.asks.best())
    }
}

/// What an apply changed at the top of book (BK-7).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct TopChange {
    /// The best bid or best ask price changed.
    pub price: bool,
    /// The size at a best level changed (price unchanged).
    pub size: bool,
}

impl TopChange {
    #[inline]
    fn between(before: (Top, Top), after: (Top, Top)) -> TopChange {
        let p = |t: Top| t.map(|l| l.price);
        let price = p(before.0) != p(after.0) || p(before.1) != p(after.1);
        let size = !price && (before != after);
        TopChange { price, size }
    }

    #[inline]
    pub fn any(self) -> bool {
        self.price || self.size
    }
}

/// Diagnostic counters of book reconstruction (15 §8).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct BookCounters {
    /// A delta arrived for an outcome without a book (I-6c).
    pub delta_before_book: u64,
}

/// Recorded books of both outcomes of one market (15 §2.1). Outcomes not
/// seen yet have no book (I-6e).
#[derive(Clone, Debug, Default)]
pub struct MarketBooks {
    books: PerOutcome<Option<Box<OutcomeBook>>>,
    pub counters: BookCounters,
}

impl MarketBooks {
    pub fn new() -> Self {
        Self::default()
    }

    /// The outcome's book, if one was seen.
    #[inline]
    pub fn get(&self, o: Outcome) -> Option<&OutcomeBook> {
        self.books[o].as_deref()
    }

    fn get_or_create(&mut self, o: Outcome, count_delta: bool) -> &mut OutcomeBook {
        if self.books[o].is_none() {
            if count_delta {
                self.counters.delta_before_book += 1;
            }
            self.books[o] = Some(Box::default());
        }
        self.books[o].as_deref_mut().expect("created")
    }

    /// `book` message: replaces both sides; levels with size `<= 0` are
    /// dropped (I-6a).
    pub fn apply_snapshot(
        &mut self,
        o: Outcome,
        bids: impl IntoIterator<Item = Level>,
        asks: impl IntoIterator<Item = Level>,
    ) -> TopChange {
        let book = self.get_or_create(o, false);
        let before = book.tops();
        book.bids.clear();
        book.asks.clear();
        for l in bids {
            book.bids.set(l.price, l.size);
        }
        for l in asks {
            book.asks.set(l.price, l.size);
        }
        TopChange::between(before, book.tops())
    }

    /// One `price_change` entry: sets the aggregate size; `<= 0` deletes (I-6b, I-6c).
    pub fn apply_level(&mut self, o: Outcome, side: Side, price: Price, size: Qty) -> TopChange {
        let book = self.get_or_create(o, true);
        let before = book.tops();
        book.side_mut(side).set(price, size);
        TopChange::between(before, book.tops())
    }

    /// `last_trade_price` / `tick_size_change` for an outcome without a book
    /// creates an empty entry (I-6c).
    pub fn touch(&mut self, o: Outcome) {
        self.get_or_create(o, true);
    }

    /// `BookReset` for one outcome or the whole market (I-6f).
    pub fn reset(&mut self, scope: Option<Outcome>) {
        for o in Outcome::ALL {
            if scope.is_none() || scope == Some(o) {
                if let Some(b) = self.books[o].as_deref_mut() {
                    b.bids.clear();
                    b.asks.clear();
                }
            }
        }
    }

    #[inline]
    pub fn best_bid(&self, o: Outcome) -> Option<Level> {
        self.get(o).and_then(|b| b.bids.best())
    }

    #[inline]
    pub fn best_ask(&self, o: Outcome) -> Option<Level> {
        self.get(o).and_then(|b| b.asks.best())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn p(m: i64) -> Price {
        Price::from_micros(m)
    }
    fn q(m: i64) -> Qty {
        Qty::from_micros(m)
    }

    #[test]
    fn snapshot_and_deltas() {
        let mut m = MarketBooks::new();
        assert!(m.get(Outcome::Up).is_none());
        let ch = m.apply_snapshot(
            Outcome::Up,
            [
                Level {
                    price: p(480_000),
                    size: q(10_000_000),
                },
                Level {
                    price: p(470_000),
                    size: q(0),
                },
            ],
            [
                Level {
                    price: p(520_000),
                    size: q(5_000_000),
                },
                Level {
                    price: p(530_000),
                    size: q(7_000_000),
                },
            ],
        );
        assert!(ch.price);
        assert_eq!(m.best_bid(Outcome::Up).unwrap().price, p(480_000));
        assert_eq!(
            m.get(Outcome::Up).unwrap().bids.len(),
            1,
            "size 0 dropped (I-6a)"
        );
        assert_eq!(m.best_ask(Outcome::Up).unwrap().price, p(520_000));
        // size change at the best ask
        let ch = m.apply_level(Outcome::Up, Side::Ask, p(520_000), q(1_000_000));
        assert_eq!(
            ch,
            TopChange {
                price: false,
                size: true
            }
        );
        // remove the best ask
        let ch = m.apply_level(Outcome::Up, Side::Ask, p(520_000), q(0));
        assert!(ch.price);
        assert_eq!(m.best_ask(Outcome::Up).unwrap().price, p(530_000));
        // deep change: no top change
        let ch = m.apply_level(Outcome::Up, Side::Bid, p(100_000), q(1));
        assert!(!ch.any());
        // delta before book (I-6c)
        m.apply_level(Outcome::Down, Side::Bid, p(500_000), q(1));
        assert_eq!(m.counters.delta_before_book, 1);
        let asks: Vec<_> = m
            .get(Outcome::Up)
            .unwrap()
            .asks
            .levels()
            .map(|l| l.price.micros())
            .collect();
        assert_eq!(asks, vec![530_000]);
        let bids: Vec<_> = m
            .get(Outcome::Up)
            .unwrap()
            .bids
            .levels()
            .map(|l| l.price.micros())
            .collect();
        assert_eq!(bids, vec![480_000, 100_000]);
    }

    #[test]
    fn off_grid_prices_use_overflow() {
        let mut s = BookSide::new(Side::Ask);
        s.set(p(500_050), q(1)); // off the 0.0001 grid
        s.set(p(500_100), q(2));
        s.set(p(500_000), q(3));
        let v: Vec<_> = s
            .levels()
            .map(|l| (l.price.micros(), l.size.micros()))
            .collect();
        assert_eq!(v, vec![(500_000, 3), (500_050, 1), (500_100, 2)]);
        assert_eq!(s.depth_through(p(500_050)), q(4));
        s.clear();
        assert!(s.is_empty());
        assert!(s.best().is_none());
    }

    proptest! {
        // spec: 16 BK-4 (ladder == BTreeMap reference on random streams)
        #[test]
        fn ladder_equals_btreemap(ops in prop::collection::vec((0i64..=1_000_100, 0i64..5, any::<bool>(), any::<bool>()), 0..400)) {
            for side in [Side::Bid, Side::Ask] {
                let mut s = BookSide::new(side);
                let mut r: BTreeMap<i64, i64> = BTreeMap::new();
                for &(price, size, coarse, clear) in &ops {
                    if clear && size == 0 && price % 97 == 0 {
                        s.clear();
                        r.clear();
                        continue;
                    }
                    let price = if coarse { price - price % 10_000 } else { price };
                    s.set(p(price), q(size));
                    if size > 0 { r.insert(price, size); } else { r.remove(&price); }
                    let got: Vec<(i64, i64)> = s.levels().map(|l| (l.price.micros(), l.size.micros())).collect();
                    let mut want: Vec<(i64, i64)> = r.iter().map(|(&a, &b)| (a, b)).collect();
                    if side == Side::Bid { want.reverse(); }
                    prop_assert_eq!(&got, &want);
                    prop_assert_eq!(s.len(), want.len());
                    prop_assert_eq!(s.best().map(|l| (l.price.micros(), l.size.micros())), want.first().copied());
                }
            }
        }
    }
}
