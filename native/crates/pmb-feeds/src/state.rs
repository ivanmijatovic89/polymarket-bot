//! Per-session feed state: the high-water feed clock, one monotone cursor per
//! series and the strategy-facing [`FeedsView`] (14 §3, P-4, P-13).
//!
//! This replaces the TS `ExternalFeedsRequestPlugin` + provider pair: the
//! view is updated in place, never cloned per tick (14 PF-4).

use crate::market::MarketFeeds;
use pmb_core::{FeedsView, SpotPoint, TsMs};

/// Feed state of one session (one candidate on one market).
#[derive(Clone, Debug, PartialEq)]
pub struct FeedState {
    /// `H`; `i64::MIN` stands for `-inf` before the first tick (14 §3.1).
    high_water: i64,
    /// Visible elements per series: the cursor is `visible - 1` (F-10).
    binance_visible: usize,
    chainlink_visible: usize,
    view: FeedsView,
}

impl Default for FeedState {
    fn default() -> Self {
        FeedState::new()
    }
}

impl FeedState {
    pub fn new() -> FeedState {
        FeedState {
            high_water: i64::MIN,
            binance_visible: 0,
            chainlink_visible: 0,
            view: FeedsView::EMPTY,
        }
    }

    /// Advances the feed clock to `H := max(H, clock)` and every cursor to
    /// `H` (14 F-7, F-9, F-10, F-28). The engine calls it on **every** tick
    /// delivered to the runner, real or synthetic, whether or not the
    /// strategy reads feeds: ts-compat passes the tick's feed clock `C(t)`
    /// (§3.1), realistic passes `now`. Amortized O(1), no allocation.
    #[inline]
    pub fn advance(&mut self, feeds: &MarketFeeds, clock: TsMs) -> &FeedsView {
        let h = self.high_water.max(clock.0);
        self.high_water = h;
        if let Some(b) = feeds.binance() {
            let s = &b.series;
            let mut n = self.binance_visible;
            while n < s.len() && s.vis(n) <= h {
                n += 1;
            }
            if n != self.binance_visible {
                self.binance_visible = n;
                let i = n - 1;
                self.view.set_binance_spot(Some(SpotPoint {
                    source_ts: TsMs(s.ts(i)),
                    value: s.price(i),
                    received_at: TsMs(s.vis(i)),
                }));
            }
        }
        if let Some(c) = feeds.chainlink() {
            let s = &c.series;
            let mut n = self.chainlink_visible;
            while n < s.len() && s.vis(n) <= h {
                n += 1;
            }
            if n != self.chainlink_visible {
                self.chainlink_visible = n;
                let i = n - 1;
                self.view.set_chainlink_spot(Some(SpotPoint {
                    source_ts: TsMs(s.round(i)),
                    value: s.price(i),
                    received_at: TsMs(s.vis(i)),
                }));
            }
        }
        if let Some(p) = feeds.price_to_beat() {
            if self.view.price_to_beat().is_none() && h >= p.available_at().0 {
                self.view.set_price_to_beat(Some(p.point));
            }
        }
        &self.view
    }

    /// The view as of the last [`advance`](Self::advance).
    #[inline]
    pub fn view(&self) -> &FeedsView {
        &self.view
    }

    /// `H`, or `None` before the first tick.
    pub fn high_water(&self) -> Option<TsMs> {
        (self.high_water != i64::MIN).then_some(TsMs(self.high_water))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binance::BinanceSeries;
    use crate::chainlink::ChainlinkSeries;
    use crate::config::FeedProfile;
    use crate::market::{BinanceFeed, ChainlinkFeed};
    use crate::price_to_beat::PriceToBeatSource;
    use pmb_core::{FeedKind, PriceToBeatPoint, Window};

    fn feeds() -> MarketFeeds {
        let window = Window {
            start_ms: TsMs(1000),
            end_ms: TsMs(2000),
        };
        let b = BinanceSeries::from_parts(
            vec![900, 1000, 1000, 1100],
            vec![1.0, 2.0, 2.0, 3.0],
            true,
            10,
            FeedProfile::TsCompat,
        );
        let c = ChainlinkSeries::from_parts(
            vec![950, 1005, 990],
            vec![980, 1010, 1020],
            vec![10.0, 11.0, 12.0],
            true,
            5,
            FeedProfile::TsCompat,
        );
        let p = PriceToBeatSource {
            point: PriceToBeatPoint {
                open_price: 7.0,
                received_at: TsMs(1050),
                event_start: TsMs(1000),
                end: TsMs(2000),
            },
        };
        MarketFeeds::from_parts(
            window,
            Some(BinanceFeed {
                symbol: "btcusdt",
                series: b,
                tick_on_update: false,
            }),
            Some(ChainlinkFeed {
                symbol: "btc/usd",
                asset_id: "btcusd",
                series: c,
                tick_on_update: false,
            }),
            Some(p),
        )
    }

    // spec: 14 F-7 (high-water), F-9 (inclusive), F-10 (cursor), F-11 (key
    // presence), F-24 (round time emitted), F-28, P-13 (generations)
    #[test]
    fn visibility_and_high_water() {
        let f = feeds();
        let mut st = FeedState::new();
        assert!(st.high_water().is_none());
        let v = *st.advance(&f, TsMs(900));
        assert!(v.binance_spot().is_none() && v.chainlink_spot().is_none());
        let v = *st.advance(&f, TsMs(910)); // inclusive: 900 + 10
        assert_eq!(v.binance_spot().unwrap().value, 1.0);
        assert_eq!(v.binance_spot().unwrap().received_at, TsMs(910));
        let v = *st.advance(&f, TsMs(1010));
        // Same-ms trades resolve to the last in series order.
        assert_eq!(v.binance_spot().unwrap().source_ts, TsMs(1000));
        assert_eq!(v.generation(FeedKind::BinanceSpot), 2);
        // Chainlink: visible at broadcast + 5; emits the round time.
        let cl = v.chainlink_spot().unwrap();
        assert_eq!(
            (cl.source_ts, cl.value, cl.received_at),
            (TsMs(950), 10.0, TsMs(985))
        );
        // A backward clock sees the high-water state.
        let v = *st.advance(&f, TsMs(0));
        assert_eq!(v.binance_spot().unwrap().source_ts, TsMs(1000));
        assert_eq!(st.high_water(), Some(TsMs(1010)));
        assert!(v.price_to_beat().is_none());
        let v = *st.advance(&f, TsMs(1015));
        assert_eq!(v.chainlink_spot().unwrap().source_ts, TsMs(1005));
        let v = *st.advance(&f, TsMs(1025));
        // Round time steps back (990 after 1005): live-correct (F-24).
        let cl = v.chainlink_spot().unwrap();
        assert_eq!((cl.source_ts, cl.value), (TsMs(990), 12.0));
        assert_eq!(v.generation(FeedKind::ChainlinkSpot), 3);
        assert!(v.price_to_beat().is_none());
        let v = *st.advance(&f, TsMs(1050));
        assert_eq!(v.price_to_beat().unwrap().open_price, 7.0);
        assert_eq!(v.generation(FeedKind::PriceToBeat), 1);
        let g = v.generation(FeedKind::BinanceSpot);
        let v = *st.advance(&f, TsMs(5000));
        assert_eq!(v.binance_spot().unwrap().value, 3.0);
        assert_eq!(v.generation(FeedKind::BinanceSpot), g + 1);
    }

    // spec: 30 §5 (unrequested feeds are always None)
    #[test]
    fn unrequested_feeds_stay_absent() {
        let f = MarketFeeds::empty();
        let mut st = FeedState::new();
        let v = st.advance(&f, TsMs(i64::MAX));
        assert_eq!(*v, FeedsView::EMPTY);
    }
}
