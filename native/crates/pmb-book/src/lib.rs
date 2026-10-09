//! Order books per outcome: recorded book reconstruction (15 §2.1) on the
//! dense-ladder layout of 16 §8.
//!
//! Each side is a ladder of 10,001 slots indexed by `price / 100` micros
//! (0.0001 units, BK-1) with a two-level occupancy bitset, plus an ordered
//! overflow map for prices off that grid or outside `[0, 1]` (anomalies are
//! replayed as recorded, 15 I-6). The best price of each side is cached, so
//! `best()` is O(1) (30 §5.1) and every apply reports whether the top of book
//! changed at no extra scan (BK-7).
//!
//! [`MarketBooks::apply`] is the message-level entry point: it applies one
//! recorded market event with the rules I-6a–I-6e, keeps the snapshot time
//! (I-6d) and the anomaly counters of 15 §8 that belong to books
//! (`deltaBeforeBook`, `crossedBookTicks`, `staleBookEvents`).

use pmb_core::{LevelUpdate, MarketEvent, Outcome, PerOutcome, Price, PriceSize, Qty, TsMs};
use std::collections::btree_map;
use std::collections::BTreeMap;

/// Ladder resolution in micros (0.0001 USDC).
pub const LADDER_STEP: i64 = 100;
/// Number of ladder slots (prices 0.0000 ..= 1.0000).
pub const LADDER_SLOTS: usize = 10_001;
const WORDS: usize = LADDER_SLOTS.div_ceil(64);
const SUMMARY_WORDS: usize = WORDS.div_ceil(64);

/// Book side: the domain quote side (`Bid` = BUY, `Ask` = SELL).
pub type Side = pmb_core::QuoteSide;

/// One price level (the domain `PriceSize`).
pub type Level = PriceSize;

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
    /// Cached best price in micros (highest bid, lowest ask).
    best: Option<i64>,
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
fn slot_of(micros: i64) -> Option<usize> {
    if (0..=1_000_000).contains(&micros) && micros % LADDER_STEP == 0 {
        Some((micros / LADDER_STEP) as usize)
    } else {
        None
    }
}

#[inline]
fn price_of(slot: usize) -> i64 {
    slot as i64 * LADDER_STEP
}

#[inline]
fn level(price: i64, size: i64) -> Level {
    Level {
        price: Price::from_micros(price),
        size: Qty::from_micros(size),
    }
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
            best: None,
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

    /// `a` is strictly better than `b` on this side.
    #[inline]
    fn better(&self, a: i64, b: i64) -> bool {
        match self.side {
            Side::Bid => a > b,
            Side::Ask => a < b,
        }
    }

    /// Sets the aggregate size at `price`; `size <= 0` removes the level (I-6b).
    #[inline]
    pub fn set(&mut self, price: Price, size: Qty) {
        let (m, s) = (price.micros(), size.micros());
        let removed = match slot_of(m) {
            Some(slot) => {
                let old = self.sizes[slot];
                if s > 0 {
                    self.sizes[slot] = s;
                    if old == 0 {
                        self.set_bit(slot);
                        self.len += 1;
                    }
                    false
                } else if old != 0 {
                    self.sizes[slot] = 0;
                    self.clear_bit(slot);
                    self.len -= 1;
                    true
                } else {
                    false
                }
            }
            None => {
                if s > 0 {
                    if self.overflow.insert(m, s).is_none() {
                        self.len += 1;
                    }
                    false
                } else if self.overflow.remove(&m).is_some() {
                    self.len -= 1;
                    true
                } else {
                    false
                }
            }
        };
        if s > 0 {
            if self.best.is_none_or(|b| self.better(m, b)) {
                self.best = Some(m);
            }
        } else if removed && self.best == Some(m) {
            self.best = self.scan_best();
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
        self.best = None;
    }

    #[inline]
    fn size_micros(&self, m: i64) -> i64 {
        match slot_of(m) {
            Some(slot) => self.sizes[slot],
            None => self.overflow.get(&m).copied().unwrap_or(0),
        }
    }

    /// Size at an exact price (0 when absent).
    #[inline]
    pub fn size_at(&self, price: Price) -> Qty {
        Qty::from_micros(self.size_micros(price.micros()))
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

    /// Best price found by scanning the bitset and the overflow map.
    fn scan_best(&self) -> Option<i64> {
        let ladder = match self.side {
            Side::Bid => self.ladder_max(),
            Side::Ask => self.ladder_min(),
        }
        .map(price_of);
        let over = match self.side {
            Side::Bid => self.overflow.keys().next_back(),
            Side::Ask => self.overflow.keys().next(),
        }
        .copied();
        match (ladder, over) {
            (Some(a), Some(b)) => Some(if self.better(b, a) { b } else { a }),
            (a, b) => a.or(b),
        }
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

    /// Best level: highest bid or lowest ask (O(1), 30 §5.1).
    #[inline]
    pub fn best(&self) -> Option<Level> {
        self.best.map(|p| level(p, self.size_micros(p)))
    }

    /// Levels best-first (bids descending, asks ascending). Allocation-free.
    pub fn levels(&self) -> impl Iterator<Item = Level> + '_ {
        LevelIter::new(self)
    }

    /// Cumulative size of the best `n` levels (16 BK-4 "depth to N").
    /// Sizes are bounded at decode (15 I-20), so the checked sum cannot
    /// overflow for real books (10 T3).
    pub fn depth_levels(&self, n: usize) -> Qty {
        let mut total = Qty::ZERO;
        for l in self.levels().take(n) {
            total += l.size;
        }
        total
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
    over: btree_map::Iter<'a, i64, i64>,
    over_next: Option<(i64, i64)>,
}

impl<'a> LevelIter<'a> {
    fn new(book: &'a BookSide) -> Self {
        let next_slot = match book.side {
            Side::Bid => book.ladder_max(),
            Side::Ask => book.ladder_min(),
        };
        let mut it = LevelIter {
            book,
            next_slot,
            over: book.overflow.iter(),
            over_next: None,
        };
        it.over_next = it.pull_over();
        it
    }

    #[inline]
    fn pull_over(&mut self) -> Option<(i64, i64)> {
        match self.book.side {
            Side::Ask => self.over.next(),
            Side::Bid => self.over.next_back(),
        }
        .map(|(&p, &s)| (p, s))
    }

    #[inline]
    fn take_slot(&mut self, slot: usize) -> Level {
        let b = self.book;
        self.next_slot = match b.side {
            Side::Ask => b.next_above(slot),
            Side::Bid => b.next_below(slot),
        };
        level(price_of(slot), b.sizes[slot])
    }

    #[inline]
    fn take_over(&mut self, p: i64, s: i64) -> Level {
        self.over_next = self.pull_over();
        level(p, s)
    }
}

impl Iterator for LevelIter<'_> {
    type Item = Level;
    #[inline]
    fn next(&mut self) -> Option<Level> {
        match (self.next_slot, self.over_next) {
            (None, None) => None,
            (Some(slot), None) => Some(self.take_slot(slot)),
            (None, Some((p, s))) => Some(self.take_over(p, s)),
            (Some(slot), Some((p, s))) => {
                if self.book.better(p, price_of(slot)) {
                    Some(self.take_over(p, s))
                } else {
                    Some(self.take_slot(slot))
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

    /// Best bid at or above best ask (15 §8 `crossedBookTicks`).
    #[inline]
    pub fn is_crossed_or_locked(&self) -> bool {
        match (self.bids.best, self.asks.best) {
            (Some(b), Some(a)) => b >= a,
            _ => false,
        }
    }

    fn clear(&mut self) {
        self.bids.clear();
        self.asks.clear();
    }
}

/// What an apply changed at the top of book of either outcome (BK-7).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct TopChange {
    /// A best bid or best ask price changed (a side appearing or emptying
    /// counts as a price change).
    pub price: bool,
    /// The size at a best level changed while no best price changed.
    pub size: bool,
}

impl TopChange {
    #[inline]
    fn between(before: &[(Top, Top); 2], after: &[(Top, Top); 2]) -> TopChange {
        let p = |t: Top| t.map(|l| l.price);
        let price = before
            .iter()
            .zip(after)
            .any(|(b, a)| p(b.0) != p(a.0) || p(b.1) != p(a.1));
        let size = !price && before != after;
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
    /// `deltaBeforeBook`: a `price_change`, `last_trade_price` or
    /// `tick_size_change` message touched an outcome that has not had a
    /// `book` message yet (since the start or its last reset); counted once
    /// per message and outcome (I-6c; the TS `delta_before_book` warning of
    /// `MarketOrderBookEngine.ts:94-151`).
    pub delta_before_book: u64,
    /// `crossedBookTicks`: a `book` or `price_change` message after which
    /// some outcome book has best bid >= best ask (replayed unchanged).
    pub crossed_book_ticks: u64,
    /// `staleBookEvents`: a message applied to an outcome whose book is
    /// stale (reset and not yet re-booked, I-6f); counted once per message.
    /// The `book` message that ends staleness is not counted.
    /// Kept in both profiles; only realistic reports it and skips the
    /// strategy tick (12 §5.2).
    pub stale_book_events: u64,
}

/// Recorded books of both outcomes of one market (15 §2.1). Outcomes not
/// seen yet, or reset since, have no book (I-6e, I-6f).
#[derive(Clone, Debug, Default)]
pub struct MarketBooks {
    /// Ladder allocations, kept across resets.
    books: PerOutcome<Option<Box<OutcomeBook>>>,
    /// The outcome is listed in the snapshot (seen since start or reset).
    present: PerOutcome<bool>,
    /// A `book` message was applied for the outcome since start or reset.
    saw_book: PerOutcome<bool>,
    /// The outcome's book was cleared by a `BookReset` and has had no `book`
    /// message since (I-6f): distinguishes "reset, not yet re-booked" from
    /// "never had a book".
    stale: PerOutcome<bool>,
    /// Timestamp of the last message applied to each outcome (TS
    /// `byAssetId[id].timestamp`).
    outcome_ts: PerOutcome<Option<TsMs>>,
    /// Market snapshot time (I-6d): timestamp of the last applied message.
    snapshot_ts: Option<TsMs>,
    pub counters: BookCounters,
}

impl MarketBooks {
    pub fn new() -> Self {
        Self::default()
    }

    /// The outcome's book, if the outcome was seen (I-6e).
    #[inline]
    pub fn get(&self, o: Outcome) -> Option<&OutcomeBook> {
        if self.present[o] {
            self.books[o].as_deref()
        } else {
            None
        }
    }

    /// Market snapshot time (I-6d): the timestamp of the last applied
    /// message of any kind and outcome; it can move backwards. `None` before
    /// the first timestamped message and after a market-wide reset.
    #[inline]
    pub fn snapshot_ts(&self) -> Option<TsMs> {
        self.snapshot_ts
    }

    /// Timestamp of the last message applied to the outcome's book.
    #[inline]
    pub fn outcome_ts(&self, o: Outcome) -> Option<TsMs> {
        self.outcome_ts[o]
    }

    /// A `book` message was applied for the outcome since start or reset.
    #[inline]
    pub fn saw_book(&self, o: Outcome) -> bool {
        self.saw_book[o]
    }

    /// The outcome's book is stale: cleared by a `BookReset` and not yet
    /// replaced by a `book` message (I-6f; the strategy's `is_stale()`,
    /// 30 §5.1). Never true for an outcome that simply had no book yet.
    #[inline]
    pub fn is_stale(&self, o: Outcome) -> bool {
        self.stale[o]
    }

    #[inline]
    fn book_mut(&mut self, o: Outcome) -> &mut OutcomeBook {
        if !self.present[o] {
            self.present[o] = true;
        }
        self.books[o].get_or_insert_with(Box::default)
    }

    #[inline]
    fn tops(&self) -> [(Top, Top); 2] {
        Outcome::ALL.map(|o| self.get(o).map_or((None, None), OutcomeBook::tops))
    }

    /// A non-`book` message touches outcome `o` (I-6c): creates its book
    /// entry and counts `deltaBeforeBook` before the outcome's first book.
    #[inline]
    fn touch_outcome(&mut self, o: Outcome, ts: Option<TsMs>) -> &mut OutcomeBook {
        if !self.saw_book[o] {
            self.counters.delta_before_book += 1;
        }
        if ts.is_some() {
            self.outcome_ts[o] = ts;
        }
        self.book_mut(o)
    }

    /// Counts `staleBookEvents` once per message (I-6f).
    #[inline]
    fn count_stale(&mut self, stale: bool) {
        if stale {
            self.counters.stale_book_events += 1;
        }
    }

    #[inline]
    fn count_crossed(&mut self) {
        if Outcome::ALL
            .iter()
            .any(|&o| self.get(o).is_some_and(OutcomeBook::is_crossed_or_locked))
        {
            self.counters.crossed_book_ticks += 1;
        }
    }

    /// Applies one recorded market message with exchange timestamp `ts`
    /// (15 §2.1) and reports the top-of-book change (BK-7).
    ///
    /// - `Book` replaces both sides of its outcome; levels with size `<= 0`
    ///   are dropped (I-6a).
    /// - `PriceChange` sets the aggregate size per `(outcome, side, price)`
    ///   in message order; size `<= 0` deletes the level (I-6b).
    /// - `PriceChange`, `LastTrade` and `TickSizeChange` for an outcome
    ///   without a book create an empty book first (I-6c). Trade prints and
    ///   tick-size changes never change levels.
    /// - Every message with a timestamp sets the snapshot time (I-6d).
    pub fn apply(&mut self, ts: Option<TsMs>, event: &MarketEvent<'_>) -> TopChange {
        if ts.is_some() {
            self.snapshot_ts = ts;
        }
        match *event {
            MarketEvent::Book {
                outcome,
                bids,
                asks,
            } => {
                if ts.is_some() {
                    self.outcome_ts[outcome] = ts;
                }
                self.apply_snapshot(outcome, bids.iter().copied(), asks.iter().copied())
            }
            MarketEvent::PriceChange { changes } => self.apply_changes(ts, changes),
            MarketEvent::LastTrade { outcome, .. }
            | MarketEvent::TickSizeChange { outcome, .. } => {
                self.count_stale(self.stale[outcome]);
                self.touch_outcome(outcome, ts);
                TopChange::default()
            }
        }
    }

    /// `book` message without a timestamp: replaces both sides; levels with
    /// size `<= 0` are dropped before the replace, so a non-positive
    /// duplicate never deletes an earlier positive level (I-6a, TS
    /// `toSortedLevelsFromBookSide`). Duplicate prices: the last one wins.
    pub fn apply_snapshot(
        &mut self,
        o: Outcome,
        bids: impl IntoIterator<Item = Level>,
        asks: impl IntoIterator<Item = Level>,
    ) -> TopChange {
        let before = self.tops();
        let book = self.book_mut(o);
        book.clear();
        for l in bids {
            if l.size.micros() > 0 {
                book.bids.set(l.price, l.size);
            }
        }
        for l in asks {
            if l.size.micros() > 0 {
                book.asks.set(l.price, l.size);
            }
        }
        self.saw_book[o] = true;
        self.stale[o] = false;
        self.count_crossed();
        TopChange::between(&before, &self.tops())
    }

    /// `price_change` message: its changes in message order (I-6b, I-6c).
    fn apply_changes(&mut self, ts: Option<TsMs>, changes: &[LevelUpdate]) -> TopChange {
        self.count_stale(changes.iter().any(|c| self.stale[c.outcome]));
        let before = self.tops();
        let mut touched = [false; 2];
        for c in changes {
            let book = if touched[c.outcome.index()] {
                self.book_mut(c.outcome)
            } else {
                touched[c.outcome.index()] = true;
                self.touch_outcome(c.outcome, ts)
            };
            book.side_mut(c.side).set(c.price, c.size);
        }
        self.count_crossed();
        TopChange::between(&before, &self.tops())
    }

    /// A `price_change` message with one change and no timestamp (I-6b, I-6c).
    pub fn apply_level(&mut self, o: Outcome, side: Side, price: Price, size: Qty) -> TopChange {
        self.apply_changes(
            None,
            &[LevelUpdate {
                outcome: o,
                side,
                price,
                size,
            }],
        )
    }

    /// A `last_trade_price` or `tick_size_change` message without a
    /// timestamp: creates an empty book for an unseen outcome (I-6c).
    pub fn touch(&mut self, o: Outcome) {
        self.count_stale(self.stale[o]);
        self.touch_outcome(o, None);
    }

    /// `BookReset` (I-6f) for one outcome or, with `None`, the whole market:
    /// the books in scope are cleared and unlisted until later messages
    /// rebuild them (I-6a–I-6c), as TS does with a fresh
    /// `MarketOrderBookEngine` (`dispatcher.ts:179-189`), and marked stale
    /// until their next `book` message ([`is_stale`](Self::is_stale),
    /// `staleBookEvents`; used by the realistic profile). A market-wide
    /// reset also clears the snapshot time. Counters are kept.
    pub fn reset(&mut self, scope: Option<Outcome>) {
        for o in Outcome::ALL {
            if scope.is_none() || scope == Some(o) {
                if let Some(b) = self.books[o].as_deref_mut() {
                    b.clear();
                }
                self.present[o] = false;
                self.saw_book[o] = false;
                self.stale[o] = true;
                self.outcome_ts[o] = None;
            }
        }
        if scope.is_none() {
            self.snapshot_ts = None;
        }
        // D-PENDING: an outcome-scoped reset (no TS counterpart; TS resets
        // only whole markets) keeps the market snapshot time.
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
mod tests;
