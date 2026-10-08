//! External price feeds as seen by strategies.
//!
//! Visibility is decided by the feed source (live: arrival; replay: modeled
//! arrival clock). Strategies only see values that were visible at `now`.

use crate::model::TsMs;
use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PricePoint {
    pub value: f64,
    /// Source timestamp (trade time / Chainlink round time).
    pub ts_ms: TsMs,
    /// When the bot could first see it.
    pub visible_at_ms: TsMs,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PriceToBeat {
    pub value: f64,
    pub visible_at_ms: TsMs,
}

/// Latest visible value of every requested feed.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FeedsSnapshot {
    pub binance_spot: Option<PricePoint>,
    pub chainlink: Option<PricePoint>,
    pub price_to_beat: Option<PriceToBeat>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FeedOptions {
    /// Symbol override (default: derived from the traded market, e.g. btcusdt / btc/usd).
    pub symbol: Option<String>,
    /// Emit a synthetic strategy tick on every update.
    pub tick_on_update: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FeedRequest {
    pub binance_spot: Option<FeedOptions>,
    pub chainlink: Option<FeedOptions>,
    pub price_to_beat: bool,
}

impl FeedRequest {
    pub fn is_empty(&self) -> bool {
        self.binance_spot.is_none() && self.chainlink.is_none() && !self.price_to_beat
    }
}
