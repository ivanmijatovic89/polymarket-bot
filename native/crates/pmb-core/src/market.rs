//! Market-channel events and order books.

use crate::fixed::{Price, Qty};
use crate::model::{AssetId, Side, TsMs};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One aggregate price level.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Level {
    pub price: Price,
    pub size: Qty,
}

/// Decoded market-channel event. Book-mutating variants produce strategy ticks.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
pub enum MarketEvent {
    /// Full snapshot for one asset; replaces local state.
    Book {
        asset_id: AssetId,
        ts_ms: TsMs,
        bids: Vec<Level>,
        asks: Vec<Level>,
    },
    /// New aggregate sizes at one or more levels (size 0 removes the level).
    PriceChange {
        ts_ms: TsMs,
        changes: Vec<PriceChange>,
    },
    TickSizeChange {
        asset_id: AssetId,
        ts_ms: TsMs,
        new_tick_size: Price,
    },
    /// A trade print. Does not mutate the book.
    LastTradePrice {
        asset_id: AssetId,
        ts_ms: TsMs,
        price: Price,
        size: Qty,
        /// Taker side.
        side: Side,
        fee_rate_bps: Option<i64>,
    },
}

impl MarketEvent {
    pub fn ts_ms(&self) -> TsMs {
        match self {
            MarketEvent::Book { ts_ms, .. }
            | MarketEvent::PriceChange { ts_ms, .. }
            | MarketEvent::TickSizeChange { ts_ms, .. }
            | MarketEvent::LastTradePrice { ts_ms, .. } => *ts_ms,
        }
    }
    /// Only `book` and `price_change` produce strategy ticks.
    pub fn is_tick(&self) -> bool {
        matches!(self, MarketEvent::Book { .. } | MarketEvent::PriceChange { .. })
    }
    pub fn type_name(&self) -> &'static str {
        match self {
            MarketEvent::Book { .. } => "book",
            MarketEvent::PriceChange { .. } => "price_change",
            MarketEvent::TickSizeChange { .. } => "tick_size_change",
            MarketEvent::LastTradePrice { .. } => "last_trade_price",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PriceChange {
    pub asset_id: AssetId,
    pub side: Side,
    pub price: Price,
    pub size: Qty,
}

/// Order book for one outcome asset.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Book {
    /// price -> size; iterate `.iter().rev()` for best-first bids.
    pub bids: BTreeMap<Price, Qty>,
    /// price -> size; iterate `.iter()` for best-first asks.
    pub asks: BTreeMap<Price, Qty>,
    pub ts_ms: TsMs,
    pub tick_size: Option<Price>,
    /// False until the first `book` snapshot arrives.
    pub initialized: bool,
}

impl Book {
    pub fn best_bid(&self) -> Option<Level> {
        self.bids
            .iter()
            .next_back()
            .map(|(p, s)| Level { price: *p, size: *s })
    }
    pub fn best_ask(&self) -> Option<Level> {
        self.asks
            .iter()
            .next()
            .map(|(p, s)| Level { price: *p, size: *s })
    }
    pub fn mid(&self) -> Option<f64> {
        Some((self.best_bid()?.price.to_f64() + self.best_ask()?.price.to_f64()) / 2.0)
    }
    pub fn spread(&self) -> Option<f64> {
        Some(self.best_ask()?.price.to_f64() - self.best_bid()?.price.to_f64())
    }
    /// Bids best-first.
    pub fn bids_desc(&self) -> impl Iterator<Item = Level> + '_ {
        self.bids
            .iter()
            .rev()
            .map(|(p, s)| Level { price: *p, size: *s })
    }
    /// Asks best-first.
    pub fn asks_asc(&self) -> impl Iterator<Item = Level> + '_ {
        self.asks
            .iter()
            .map(|(p, s)| Level { price: *p, size: *s })
    }
    pub fn side(&self, side: Side) -> &BTreeMap<Price, Qty> {
        match side {
            Side::Buy => &self.bids,
            Side::Sell => &self.asks,
        }
    }
    pub fn side_mut(&mut self, side: Side) -> &mut BTreeMap<Price, Qty> {
        match side {
            Side::Buy => &mut self.bids,
            Side::Sell => &mut self.asks,
        }
    }
}

/// Both outcome books of one binary market.
#[derive(Clone, Debug, PartialEq)]
pub struct MarketBooks {
    pub assets: [AssetId; 2],
    pub books: [Book; 2],
    /// Timestamp of the last applied event.
    pub ts_ms: TsMs,
}

impl MarketBooks {
    pub fn new(assets: [AssetId; 2]) -> Self {
        Self {
            assets,
            books: [Book::default(), Book::default()],
            ts_ms: 0,
        }
    }
    pub fn index_of(&self, asset: &AssetId) -> Option<usize> {
        self.assets.iter().position(|a| a == asset)
    }
    pub fn book(&self, asset: &AssetId) -> Option<&Book> {
        self.index_of(asset).map(|i| &self.books[i])
    }
    pub fn book_mut(&mut self, asset: &AssetId) -> Option<&mut Book> {
        self.index_of(asset).map(move |i| &mut self.books[i])
    }
}

/// Number of top levels used for cumulative depth (TS `WEB_UI_ORDERBOOK_LEVELS`, default 10).
pub const DEFAULT_DEPTH_LEVELS: usize = 10;

/// What applying one market event did to [`MarketBooks`].
///
/// Warnings mirror TS `MarketOrderBookWarning`; they never stop the replay.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct ApplyOutcome {
    /// The event produces a strategy tick (`book` / `price_change`), even if
    /// it did not change any level.
    pub tick: bool,
    /// Outcome index touched by the event (asset 0 / asset 1).
    pub touched: [bool; 2],
    /// A delta (`price_change` / `tick_size_change` / `last_trade_price`)
    /// arrived for an asset whose first `book` snapshot has not been seen.
    pub delta_before_book: [bool; 2],
    /// A `book` snapshot is older than the asset's previous update.
    pub non_monotonic_book_ts: bool,
    /// The event (or some of its changes) referenced an asset outside this market; ignored.
    pub ignored_unknown_asset: bool,
}

impl Book {
    /// True once any event for this asset was applied (TS: the per-asset book
    /// exists in `MarketOrderBooksSnapshot.byAssetId`). Real event timestamps
    /// are epoch milliseconds, so `ts_ms > 0` marks an applied event.
    pub fn has_state(&self) -> bool {
        self.initialized || self.ts_ms > 0
    }

    /// Number of price levels on one side (`Side::Buy` = bids).
    pub fn level_count(&self, side: Side) -> usize {
        self.side(side).len()
    }

    /// Levels of one side, best first.
    pub fn levels(&self, side: Side) -> impl Iterator<Item = Level> + '_ {
        let (bids, asks) = match side {
            Side::Buy => (Some(self.bids.iter().rev()), None),
            Side::Sell => (None, Some(self.asks.iter())),
        };
        bids.into_iter()
            .flatten()
            .chain(asks.into_iter().flatten())
            .map(|(p, s)| Level {
                price: *p,
                size: *s,
            })
    }

    /// Cumulative size of the best `levels` levels, one entry per level
    /// (TS `bidsDepthByLevel` / `asksDepthByLevel`; index 0 = level 1).
    pub fn cumulative_depth(&self, side: Side, levels: usize) -> Vec<Qty> {
        let mut sum = Qty::ZERO;
        self.levels(side)
            .take(levels)
            .map(|l| {
                sum += l.size;
                sum
            })
            .collect()
    }

    /// Total size of the best `levels` levels of one side.
    pub fn depth(&self, side: Side, levels: usize) -> Qty {
        let mut sum = Qty::ZERO;
        for l in self.levels(side).take(levels) {
            sum += l.size;
        }
        sum
    }

    /// Replaces both sides with a snapshot. Levels with size <= 0 are
    /// dropped; for duplicate prices the last level wins.
    fn replace(&mut self, ts_ms: TsMs, bids: &[Level], asks: &[Level]) {
        self.bids.clear();
        self.asks.clear();
        for l in bids.iter().filter(|l| l.size.is_positive()) {
            self.bids.insert(l.price, l.size);
        }
        for l in asks.iter().filter(|l| l.size.is_positive()) {
            self.asks.insert(l.price, l.size);
        }
        self.ts_ms = ts_ms;
        self.initialized = true;
    }

    /// Sets the new aggregate size of one level; size <= 0 removes it.
    fn set_level(&mut self, side: Side, price: Price, size: Qty) {
        let book = self.side_mut(side);
        if size.is_positive() {
            book.insert(price, size);
        } else {
            book.remove(&price);
        }
    }
}

impl MarketBooks {
    /// Applies one market-channel event (TS `MarketOrderBookEngine.applyAny`):
    ///
    /// - `book` replaces the asset's state and marks it warm;
    /// - `price_change` sets the new aggregate size per level (0 removes);
    /// - `tick_size_change` updates the tick size;
    /// - `last_trade_price` only advances timestamps.
    ///
    /// Every event advances `ts_ms` (market) and the touched assets' `ts_ms`.
    pub fn apply(&mut self, ev: &MarketEvent) -> ApplyOutcome {
        let mut out = ApplyOutcome {
            tick: ev.is_tick(),
            ..ApplyOutcome::default()
        };
        let ts = ev.ts_ms();
        match ev {
            MarketEvent::Book {
                asset_id,
                bids,
                asks,
                ..
            } => match self.index_of(asset_id) {
                Some(i) => {
                    let book = &mut self.books[i];
                    out.non_monotonic_book_ts = book.has_state() && ts < book.ts_ms;
                    book.replace(ts, bids, asks);
                    out.touched[i] = true;
                }
                None => out.ignored_unknown_asset = true,
            },
            MarketEvent::PriceChange { changes, .. } => {
                for ch in changes {
                    let Some(i) = self.index_of(&ch.asset_id) else {
                        out.ignored_unknown_asset = true;
                        continue;
                    };
                    let book = &mut self.books[i];
                    if !out.touched[i] {
                        out.touched[i] = true;
                        out.delta_before_book[i] = !book.initialized;
                        book.ts_ms = ts;
                    }
                    book.set_level(ch.side, ch.price, ch.size);
                }
            }
            MarketEvent::TickSizeChange {
                asset_id,
                new_tick_size,
                ..
            } => match self.index_of(asset_id) {
                Some(i) => {
                    let book = &mut self.books[i];
                    out.delta_before_book[i] = !book.initialized;
                    book.tick_size = Some(*new_tick_size);
                    book.ts_ms = ts;
                    out.touched[i] = true;
                }
                None => out.ignored_unknown_asset = true,
            },
            MarketEvent::LastTradePrice { asset_id, .. } => match self.index_of(asset_id) {
                Some(i) => {
                    let book = &mut self.books[i];
                    out.delta_before_book[i] = !book.initialized;
                    book.ts_ms = ts;
                    out.touched[i] = true;
                }
                None => out.ignored_unknown_asset = true,
            },
        }
        self.ts_ms = ts;
        out
    }

    /// Both outcome books received their first `book` snapshot.
    pub fn is_warm(&self) -> bool {
        self.books.iter().all(|b| b.initialized)
    }

    /// Assets still waiting for their first `book` snapshot.
    pub fn missing_books(&self) -> impl Iterator<Item = &AssetId> + '_ {
        self.assets
            .iter()
            .zip(&self.books)
            .filter(|(_, b)| !b.initialized)
            .map(|(a, _)| a)
    }

    /// Cross-book depth comparison (TS `computeOrderbookMetrics`), with
    /// asset 0 = UP and asset 1 = DOWN. `None` until both books have state.
    pub fn orderbook_metrics(&self, depth_levels: usize) -> Option<OrderbookMetrics> {
        let [up, down] = &self.books;
        if !up.has_state() || !down.has_state() {
            return None;
        }
        let up_bids = up.cumulative_depth(Side::Buy, depth_levels);
        let up_asks = up.cumulative_depth(Side::Sell, depth_levels);
        let down_bids = down.cumulative_depth(Side::Buy, depth_levels);
        let down_asks = down.cumulative_depth(Side::Sell, depth_levels);
        let levels = [&up_bids, &up_asks, &down_bids, &down_asks]
            .iter()
            .map(|v| v.len())
            .min()
            .unwrap_or(0);
        let mut m = OrderbookMetrics {
            depth_levels: levels,
            ..OrderbookMetrics::default()
        };
        for i in 0..levels {
            let (side, ratio) = WeakSide::compare(up_bids[i], down_bids[i]);
            m.weak_bid_side_by_level.push(side);
            m.weak_bid_ratio_by_level.push(ratio);
            let (side, ratio) = WeakSide::compare(up_asks[i], down_asks[i]);
            m.weak_ask_side_by_level.push(side);
            m.weak_ask_ratio_by_level.push(ratio);
        }
        Some(m)
    }
}

/// Which outcome has less cumulative depth at a level.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum WeakSide {
    Up,
    Down,
    #[default]
    None,
}

impl WeakSide {
    /// TS `weakSideAndRatio`: equal depth → (`None`, 1); otherwise the thinner
    /// side and `min / max` (0 when the deeper side is 0).
    fn compare(up: Qty, down: Qty) -> (WeakSide, f64) {
        let u = up.max(Qty::ZERO);
        let d = down.max(Qty::ZERO);
        if u == d {
            return (WeakSide::None, 1.0);
        }
        let (min, max) = (u.min(d), u.max(d));
        let side = if u < d { WeakSide::Up } else { WeakSide::Down };
        let ratio = if max.is_positive() {
            min.micros() as f64 / max.micros() as f64
        } else {
            0.0
        };
        (side, ratio)
    }
}

/// Per-level UP vs DOWN depth comparison (TS `OrderbookMetrics`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OrderbookMetrics {
    /// Levels compared: min(depth levels, levels present on each of the 4 sides).
    pub depth_levels: usize,
    pub weak_bid_side_by_level: Vec<WeakSide>,
    pub weak_bid_ratio_by_level: Vec<f64>,
    pub weak_ask_side_by_level: Vec<WeakSide>,
    pub weak_ask_ratio_by_level: Vec<f64>,
}

/// Why a strategy tick fired.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TickCause {
    /// A book-mutating market event (`book` / `price_change`).
    Market { event_type: &'static str },
    /// Opt-in synthetic tick on a feed update (Binance aggTrade / Chainlink round).
    Feed { feed: FeedKind },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedKind {
    BinanceAggTrade,
    ChainlinkRound,
}

impl FeedKind {
    /// Event type of the synthetic tick (TS `SyntheticFeedEventType`; also
    /// the `eventsByType` key).
    pub fn event_type(self) -> &'static str {
        match self {
            FeedKind::BinanceAggTrade => "binance_agg_trade",
            FeedKind::ChainlinkRound => "chainlink_round",
        }
    }
}

/// Input to `Strategy::on_market_tick`.
#[derive(Clone, Debug)]
pub struct MarketTick<'a> {
    pub cause: TickCause,
    /// Engine time of this tick (exchange timestamp of the event / feed tick time).
    pub ts_ms: TsMs,
    /// Bot-side receive time when the input has one (recorded/live).
    pub local_ts_ms: Option<TsMs>,
    pub books: &'a MarketBooks,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(v: f64) -> Price {
        Price::from_f64(v)
    }
    fn q(v: f64) -> Qty {
        Qty::from_f64(v)
    }
    fn lvl(p: f64, s: f64) -> Level {
        Level {
            price: px(p),
            size: q(s),
        }
    }
    fn assets() -> [AssetId; 2] {
        [AssetId::new("up"), AssetId::new("down")]
    }
    fn book(asset: &str, ts: TsMs, bids: Vec<Level>, asks: Vec<Level>) -> MarketEvent {
        MarketEvent::Book {
            asset_id: AssetId::new(asset),
            ts_ms: ts,
            bids,
            asks,
        }
    }
    fn change(asset: &str, side: Side, p: f64, s: f64) -> PriceChange {
        PriceChange {
            asset_id: AssetId::new(asset),
            side,
            price: px(p),
            size: q(s),
        }
    }

    #[test]
    fn book_replaces_state_and_drops_empty_levels() {
        let mut m = MarketBooks::new(assets());
        let out = m.apply(&book(
            "up",
            10,
            vec![
                lvl(0.40, 5.0),
                lvl(0.45, 2.0),
                lvl(0.30, 0.0),
                lvl(0.40, 7.0),
            ],
            vec![lvl(0.55, 3.0), lvl(0.50, 1.0)],
        ));
        assert!(out.tick && out.touched == [true, false]);
        let b = &m.books[0];
        assert_eq!(b.best_bid(), Some(lvl(0.45, 2.0)));
        assert_eq!(b.best_ask(), Some(lvl(0.50, 1.0)));
        // duplicate price: last one wins; size 0 dropped
        assert_eq!(b.bids.get(&px(0.40)), Some(&q(7.0)));
        assert_eq!(b.level_count(Side::Buy), 2);
        assert!(b.initialized && !m.is_warm());
        assert_eq!(
            m.missing_books().collect::<Vec<_>>(),
            vec![&AssetId::new("down")]
        );

        m.apply(&book("up", 20, vec![lvl(0.41, 1.0)], vec![]));
        let b = &m.books[0];
        assert_eq!(b.level_count(Side::Buy), 1);
        assert_eq!(b.level_count(Side::Sell), 0);
        assert_eq!(b.ts_ms, 20);
        assert_eq!(m.ts_ms, 20);
    }

    #[test]
    fn price_change_sets_aggregate_size_and_zero_removes() {
        let mut m = MarketBooks::new(assets());
        m.apply(&book("up", 1, vec![lvl(0.40, 5.0)], vec![lvl(0.60, 5.0)]));
        m.apply(&book("down", 1, vec![lvl(0.38, 4.0)], vec![lvl(0.62, 4.0)]));
        assert!(m.is_warm());
        let out = m.apply(&MarketEvent::PriceChange {
            ts_ms: 5,
            changes: vec![
                change("up", Side::Buy, 0.40, 9.0),
                change("up", Side::Buy, 0.42, 1.0),
                change("up", Side::Sell, 0.60, 0.0),
                change("down", Side::Sell, 0.61, 2.5),
            ],
        });
        assert!(out.tick);
        assert_eq!(out.touched, [true, true]);
        assert_eq!(out.delta_before_book, [false, false]);
        let up = &m.books[0];
        assert_eq!(up.best_bid(), Some(lvl(0.42, 1.0)));
        assert_eq!(up.bids.get(&px(0.40)), Some(&q(9.0)));
        assert_eq!(up.best_ask(), None);
        assert_eq!(m.books[1].best_ask(), Some(lvl(0.61, 2.5)));
        assert_eq!((up.ts_ms, m.books[1].ts_ms, m.ts_ms), (5, 5, 5));
        // removing a level that does not exist is a no-op but still a tick
        let out = m.apply(&MarketEvent::PriceChange {
            ts_ms: 6,
            changes: vec![change("up", Side::Sell, 0.99, 0.0)],
        });
        assert!(out.tick);
        assert_eq!(out.touched, [true, false]);
        assert_eq!(m.books[1].ts_ms, 5);
    }

    #[test]
    fn deltas_before_book_are_applied_and_flagged() {
        let mut m = MarketBooks::new(assets());
        let out = m.apply(&MarketEvent::PriceChange {
            ts_ms: 3,
            changes: vec![change("down", Side::Buy, 0.2, 1.0)],
        });
        assert_eq!(out.delta_before_book, [false, true]);
        assert!(m.books[1].has_state() && !m.books[1].initialized);
        assert!(!m.books[0].has_state());
        assert_eq!(m.books[1].best_bid(), Some(lvl(0.2, 1.0)));

        let out = m.apply(&MarketEvent::TickSizeChange {
            asset_id: AssetId::new("up"),
            ts_ms: 4,
            new_tick_size: px(0.001),
        });
        assert!(!out.tick);
        assert_eq!(out.delta_before_book, [true, false]);
        assert_eq!(m.books[0].tick_size, Some(px(0.001)));

        let before = m.books.clone();
        let out = m.apply(&MarketEvent::LastTradePrice {
            asset_id: AssetId::new("down"),
            ts_ms: 9,
            price: px(0.2),
            size: q(1.0),
            side: Side::Sell,
            fee_rate_bps: None,
        });
        assert!(!out.tick);
        assert_eq!(out.delta_before_book, [false, true]);
        // last_trade_price never mutates levels
        assert_eq!(m.books[1].bids, before[1].bids);
        assert_eq!((m.books[1].ts_ms, m.ts_ms), (9, 9));
    }

    #[test]
    fn non_monotonic_book_and_unknown_assets_are_flagged() {
        let mut m = MarketBooks::new(assets());
        m.apply(&book("up", 100, vec![], vec![]));
        let out = m.apply(&book("up", 90, vec![], vec![]));
        assert!(out.non_monotonic_book_ts);
        let out = m.apply(&book("other", 120, vec![lvl(0.5, 1.0)], vec![]));
        assert!(out.ignored_unknown_asset && out.tick);
        assert_eq!(out.touched, [false, false]);
        let out = m.apply(&MarketEvent::PriceChange {
            ts_ms: 130,
            changes: vec![
                change("other", Side::Buy, 0.5, 1.0),
                change("up", Side::Buy, 0.5, 1.0),
            ],
        });
        assert!(out.ignored_unknown_asset);
        assert_eq!(out.touched, [true, false]);
        assert_eq!(m.books[0].best_bid(), Some(lvl(0.5, 1.0)));
    }

    #[test]
    fn cumulative_depth_and_metrics() {
        let mut m = MarketBooks::new(assets());
        assert_eq!(m.orderbook_metrics(DEFAULT_DEPTH_LEVELS), None);
        m.apply(&book(
            "up",
            1,
            vec![lvl(0.50, 10.0), lvl(0.49, 5.0), lvl(0.48, 1.0)],
            vec![lvl(0.52, 4.0), lvl(0.53, 4.0)],
        ));
        assert_eq!(
            m.books[0].cumulative_depth(Side::Buy, 2),
            vec![q(10.0), q(15.0)]
        );
        assert_eq!(
            m.books[0].cumulative_depth(Side::Sell, 10),
            vec![q(4.0), q(8.0)]
        );
        assert_eq!(m.books[0].depth(Side::Buy, 10), q(16.0));
        assert_eq!(m.orderbook_metrics(DEFAULT_DEPTH_LEVELS), None);

        m.apply(&book(
            "down",
            2,
            vec![lvl(0.47, 20.0), lvl(0.46, 10.0), lvl(0.45, 1.0)],
            vec![lvl(0.51, 4.0), lvl(0.52, 2.0), lvl(0.53, 2.0)],
        ));
        let mm = m.orderbook_metrics(DEFAULT_DEPTH_LEVELS).unwrap();
        // limited by UP asks (2 levels)
        assert_eq!(mm.depth_levels, 2);
        assert_eq!(mm.weak_bid_side_by_level, vec![WeakSide::Up, WeakSide::Up]);
        assert_eq!(mm.weak_bid_ratio_by_level, vec![0.5, 0.5]);
        assert_eq!(
            mm.weak_ask_side_by_level,
            vec![WeakSide::None, WeakSide::Down]
        );
        assert_eq!(mm.weak_ask_ratio_by_level, vec![1.0, 0.75]);

        // an empty side yields zero compared levels
        m.apply(&book("down", 3, vec![], vec![lvl(0.6, 1.0)]));
        assert_eq!(
            m.orderbook_metrics(DEFAULT_DEPTH_LEVELS)
                .unwrap()
                .depth_levels,
            0
        );
    }
}
