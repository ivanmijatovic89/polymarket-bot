//! The narrow input plugins observe (14 §12.1 P-1, P-6; §12.3).
//!
//! Plugins are pure functions of the recorded book tops, the tick's decision
//! time, the synthetic flag, their config and the market identity (14 P-6).
//! They never see a candidate's overlay, the wall clock or the environment.

use pmb_core::market::{MarketInfo, Symbol, Timeframe, Window};
use pmb_core::{Outcome, PerOutcome, Price, TsMs};

/// Best bid and ask of one outcome book (recorded book, 14 P-6).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct BookTop {
    pub bid: Option<Price>,
    pub ask: Option<Price>,
}

impl BookTop {
    pub const EMPTY: BookTop = BookTop {
        bid: None,
        ask: None,
    };

    pub const fn new(bid: Option<Price>, ask: Option<Price>) -> BookTop {
        BookTop { bid, ask }
    }

    /// Best bid as plugin analytics `f64` (10 T5; `to_f64_lossy` is the
    /// correctly rounded value of the decimal, 30 §6).
    #[inline]
    pub fn bid_f64(&self) -> Option<f64> {
        self.bid.map(Price::to_f64_lossy)
    }

    /// Best ask as plugin analytics `f64`.
    #[inline]
    pub fn ask_f64(&self) -> Option<f64> {
        self.ask.map(Price::to_f64_lossy)
    }

    /// `(bid + ask) / 2` in `f64`, present only when both sides are (the book
    /// snapshot `mid` of the TS oracle, `src/market/orderbook/utils.ts:56-59`).
    #[inline]
    pub fn mid_f64(&self) -> Option<f64> {
        match (self.bid_f64(), self.ask_f64()) {
            (Some(b), Some(a)) => Some((b + a) / 2.0),
            _ => None,
        }
    }
}

/// One tick as observed by plugins (14 §12.1 P-4).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct PluginTick {
    /// Decision time of the tick (14 §12.3, 12 §4.2 `tick.ts`): in ts-compat
    /// the TS `snapshot.timestamp` (exchange time of real ticks, clamped
    /// stamp of synthetic ticks, so it can step back); in realistic the loop
    /// clock `now`.
    pub ts: TsMs,
    /// A synthetic feed tick (14 §8): unchanged book, re-stamped time.
    pub synthetic: bool,
    /// Recorded book tops per outcome.
    pub tops: PerOutcome<BookTop>,
}

impl PluginTick {
    pub const fn new(ts: TsMs, synthetic: bool, tops: PerOutcome<BookTop>) -> PluginTick {
        PluginTick {
            ts,
            synthetic,
            tops,
        }
    }

    #[inline]
    pub fn top(&self, o: Outcome) -> &BookTop {
        &self.tops[o]
    }
}

/// Market identity plugins read (14 P-6): symbol, timeframe and the window
/// derived from the slug (10 §5).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct PluginMarket {
    pub symbol: Symbol,
    pub timeframe: Timeframe,
    pub window: Window,
}

impl From<&MarketInfo> for PluginMarket {
    fn from(m: &MarketInfo) -> PluginMarket {
        PluginMarket {
            symbol: m.symbol,
            timeframe: m.timeframe,
            window: m.window,
        }
    }
}

impl PluginMarket {
    /// Builds the identity from a slug through the single slug parser
    /// (10 §5, 14 P-11).
    pub fn from_slug(slug: &str) -> Result<PluginMarket, pmb_core::SlugError> {
        let s = pmb_core::parse_slug(slug)?;
        Ok(PluginMarket {
            symbol: s.symbol,
            timeframe: s.timeframe,
            window: s.window,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 14 §12.2 trackPrice mid; TS getMid (`utils.ts:56-59`)
    #[test]
    fn mid_needs_both_sides_and_is_float_mean() {
        let p = |m| Some(Price::from_micros(m));
        assert_eq!(BookTop::new(p(510_000), p(530_000)).mid_f64(), Some(0.52));
        assert_eq!(
            BookTop::new(p(505_000), p(510_000)).mid_f64(),
            Some((0.505 + 0.51) / 2.0)
        );
        assert_eq!(BookTop::new(None, p(530_000)).mid_f64(), None);
        assert_eq!(BookTop::new(p(530_000), None).mid_f64(), None);
        // to_f64_lossy equals parsing the same decimal text (30 §6).
        assert_eq!(BookTop::new(p(510_000), None).bid_f64(), Some(0.51));
    }

    // spec: 14 P-11 (single slug parser)
    #[test]
    fn market_from_slug_uses_the_core_parser() {
        let m = PluginMarket::from_slug("btc-updown-15m-1760140800").unwrap();
        assert_eq!(m.timeframe, Timeframe::M15);
        assert_eq!(m.window.start_ms, TsMs(1_760_140_800_000));
        assert!(PluginMarket::from_slug("eth-updown-15m-1760140800").is_err());
    }
}
