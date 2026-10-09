//! Strategy-facing external feed values (14 §2 F-5, §11; 30 §5 `feeds()`,
//! §10).
//!
//! Feed prices are `f64` (14 F-6, 00 R2: feed values are analytics, never
//! ledger state). Times are [`TsMs`]. The view is a small `Copy` value that
//! the engine rebuilds in place, never cloned per tick (14 PF-4, P-4).

use crate::market::Symbol;
use crate::TsMs;

/// A feed of the v1 feed view (14 §1). Captured-only feeds (V4 book ticker,
/// Chainlink TWAP, opening TWAP) are not offered in v1 (14 §7.4).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FeedKind {
    /// Binance spot last trade (`binanceWsSpotPrice`).
    BinanceSpot = 0,
    /// Chainlink round (`rtdsPolymarketCryptoPrices.chainlink`).
    ChainlinkSpot = 1,
    /// Price to beat (`polymarketPriceToBeat`).
    PriceToBeat = 2,
}

impl FeedKind {
    pub const ALL: [FeedKind; 3] = [
        FeedKind::BinanceSpot,
        FeedKind::ChainlinkSpot,
        FeedKind::PriceToBeat,
    ];

    #[inline]
    pub const fn index(self) -> usize {
        self as usize
    }

    /// The TS key of the feed (14 §11.2).
    pub const fn ts_key(self) -> &'static str {
        match self {
            FeedKind::BinanceSpot => "binanceWsSpotPrice",
            FeedKind::ChainlinkSpot => "rtdsPolymarketCryptoPrices.chainlink",
            FeedKind::PriceToBeat => "polymarketPriceToBeat",
        }
    }
}

/// Kind of a synthetic feed tick (14 §8). The derived order is the
/// cross-feed tie-break of the historical schedule: Binance before Chainlink
/// at equal visibility (14 F-39).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SyntheticKind {
    BinanceAggTrade = 0,
    ChainlinkRound = 1,
}

impl SyntheticKind {
    #[inline]
    pub const fn index(self) -> usize {
        self as usize
    }

    /// The tick cause / `eventsByType` key (12 §5.3, 14 §8.4).
    pub const fn as_str(self) -> &'static str {
        match self {
            SyntheticKind::BinanceAggTrade => "binance_agg_trade",
            SyntheticKind::ChainlinkRound => "chainlink_round",
        }
    }

    /// The feed whose updates schedule this kind.
    pub const fn feed(self) -> FeedKind {
        match self {
            SyntheticKind::BinanceAggTrade => FeedKind::BinanceSpot,
            SyntheticKind::ChainlinkRound => FeedKind::ChainlinkSpot,
        }
    }
}

/// Feed symbols that follow the traded market (14 F-49).
impl Symbol {
    /// Binance WS feed symbol (`btcusdt`).
    pub const fn binance_feed_symbol(self) -> &'static str {
        match self {
            Symbol::Btc => "btcusdt",
        }
    }
    /// Binance day-file pair (`BTCUSDT`, 14 §4.1).
    pub const fn binance_pair(self) -> &'static str {
        match self {
            Symbol::Btc => "BTCUSDT",
        }
    }
    /// Chainlink feed symbol (`btc/usd`).
    pub const fn chainlink_feed_symbol(self) -> &'static str {
        match self {
            Symbol::Btc => "btc/usd",
        }
    }
    /// Telonex `crypto_prices` asset id (`btcusd`, 14 §5.1).
    pub const fn chainlink_asset_id(self) -> &'static str {
        match self {
            Symbol::Btc => "btcusd",
        }
    }
    /// Price-to-beat symbol (`BTC`, 14 F-28).
    pub const fn price_to_beat_symbol(self) -> &'static str {
        match self {
            Symbol::Btc => "BTC",
        }
    }
}

/// One spot observation (14 F-16, F-24): the source time (Binance trade time
/// or Chainlink round time), the value and the modeled receipt time.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct SpotPoint {
    pub source_ts: TsMs,
    pub value: f64,
    pub received_at: TsMs,
}

impl SpotPoint {
    /// Field-wise identity with `f64` compared by bit pattern (14 P-13).
    #[inline]
    pub fn same(&self, other: &SpotPoint) -> bool {
        self.source_ts == other.source_ts
            && self.value.to_bits() == other.value.to_bits()
            && self.received_at == other.received_at
    }
}

/// The price-to-beat observation (14 F-28). The TS ISO strings
/// `eventStartTimeIso` / `endDateIso` are renderings of `event_start` / `end`
/// at the boundary only (14 F-5).
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PriceToBeatPoint {
    pub open_price: f64,
    pub received_at: TsMs,
    pub event_start: TsMs,
    pub end: TsMs,
}

impl PriceToBeatPoint {
    /// Field-wise identity with `f64` compared by bit pattern (14 P-13).
    #[inline]
    pub fn same(&self, other: &PriceToBeatPoint) -> bool {
        self.open_price.to_bits() == other.open_price.to_bits()
            && self.received_at == other.received_at
            && self.event_start == other.event_start
            && self.end == other.end
    }
}

/// Latest visible value of each requested feed (30 §5 `feeds()`; visibility
/// in 14 §3). An unrequested feed is always `None`; a requested feed is `None`
/// until its first visible element (14 F-11).
///
/// Each feed carries a change generation that increments exactly when the
/// visible value changes: presence, or any field by bit pattern (14 P-13).
/// Generations are engine-internal; they feed the tick interest filter
/// (16 §9.4) and are not part of the TS shape (14 §11.2).
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct FeedsView {
    binance: Option<SpotPoint>,
    chainlink: Option<SpotPoint>,
    price_to_beat: Option<PriceToBeatPoint>,
    generations: [u64; 3],
}

fn spot_changed(old: &Option<SpotPoint>, new: &Option<SpotPoint>) -> bool {
    match (old, new) {
        (None, None) => false,
        (Some(a), Some(b)) => !a.same(b),
        _ => true,
    }
}

impl FeedsView {
    /// The empty view: nothing visible, every generation 0.
    pub const EMPTY: FeedsView = FeedsView {
        binance: None,
        chainlink: None,
        price_to_beat: None,
        generations: [0; 3],
    };

    #[inline]
    pub fn binance_spot(&self) -> Option<&SpotPoint> {
        self.binance.as_ref()
    }
    #[inline]
    pub fn chainlink_spot(&self) -> Option<&SpotPoint> {
        self.chainlink.as_ref()
    }
    #[inline]
    pub fn price_to_beat(&self) -> Option<&PriceToBeatPoint> {
        self.price_to_beat.as_ref()
    }

    /// Change generation of one feed (14 P-13).
    #[inline]
    pub fn generation(&self, feed: FeedKind) -> u64 {
        self.generations[feed.index()]
    }

    /// Sets the visible Binance point; bumps its generation iff it changed.
    /// Returns whether it changed.
    #[inline]
    pub fn set_binance_spot(&mut self, p: Option<SpotPoint>) -> bool {
        let changed = spot_changed(&self.binance, &p);
        if changed {
            self.binance = p;
            self.generations[FeedKind::BinanceSpot.index()] += 1;
        }
        changed
    }

    /// Sets the visible Chainlink point; bumps its generation iff it changed.
    #[inline]
    pub fn set_chainlink_spot(&mut self, p: Option<SpotPoint>) -> bool {
        let changed = spot_changed(&self.chainlink, &p);
        if changed {
            self.chainlink = p;
            self.generations[FeedKind::ChainlinkSpot.index()] += 1;
        }
        changed
    }

    /// Sets the visible price to beat; bumps its generation iff it changed.
    #[inline]
    pub fn set_price_to_beat(&mut self, p: Option<PriceToBeatPoint>) -> bool {
        let changed = match (&self.price_to_beat, &p) {
            (None, None) => false,
            (Some(a), Some(b)) => !a.same(b),
            _ => true,
        };
        if changed {
            self.price_to_beat = p;
            self.generations[FeedKind::PriceToBeat.index()] += 1;
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(ts: i64, v: f64, r: i64) -> SpotPoint {
        SpotPoint {
            source_ts: TsMs(ts),
            value: v,
            received_at: TsMs(r),
        }
    }

    // spec: 14 P-13 (generation increments exactly when the visible value changes)
    #[test]
    fn generations_follow_visible_changes() {
        let mut v = FeedsView::EMPTY;
        assert!(!v.set_binance_spot(None));
        assert_eq!(v.generation(FeedKind::BinanceSpot), 0);
        assert!(v.set_binance_spot(Some(pt(1, 2.0, 3))));
        assert_eq!(v.generation(FeedKind::BinanceSpot), 1);
        assert!(!v.set_binance_spot(Some(pt(1, 2.0, 3))));
        assert_eq!(v.generation(FeedKind::BinanceSpot), 1);
        assert!(v.set_binance_spot(Some(pt(1, 2.0, 4))));
        assert!(v.set_binance_spot(Some(pt(2, 2.0, 4))));
        // -0.0 and 0.0 differ by bit pattern.
        assert!(v.set_binance_spot(Some(pt(2, 0.0, 4))));
        assert!(v.set_binance_spot(Some(pt(2, -0.0, 4))));
        assert_eq!(v.generation(FeedKind::BinanceSpot), 5);
        assert_eq!(v.generation(FeedKind::ChainlinkSpot), 0);
        let p = PriceToBeatPoint {
            open_price: 1.5,
            received_at: TsMs(10),
            event_start: TsMs(0),
            end: TsMs(900_000),
        };
        assert!(v.set_price_to_beat(Some(p)));
        assert!(!v.set_price_to_beat(Some(p)));
        assert!(v.set_price_to_beat(None));
        assert_eq!(v.generation(FeedKind::PriceToBeat), 2);
        assert!(v.price_to_beat().is_none());
    }

    // spec: 14 F-49 (symbols follow the traded market), F-39 (Binance first)
    #[test]
    fn symbols_and_kinds() {
        let s = Symbol::Btc;
        assert_eq!(s.binance_feed_symbol(), "btcusdt");
        assert_eq!(s.binance_pair(), "BTCUSDT");
        assert_eq!(s.chainlink_feed_symbol(), "btc/usd");
        assert_eq!(s.chainlink_asset_id(), "btcusd");
        assert_eq!(s.price_to_beat_symbol(), "BTC");
        assert!(SyntheticKind::BinanceAggTrade < SyntheticKind::ChainlinkRound);
        assert_eq!(SyntheticKind::ChainlinkRound.as_str(), "chainlink_round");
        assert_eq!(SyntheticKind::BinanceAggTrade.feed(), FeedKind::BinanceSpot);
        assert_eq!(FeedKind::PriceToBeat.ts_key(), "polymarketPriceToBeat");
    }
}
