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
