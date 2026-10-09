//! Per-process cache of TA candles per `(pair, interval, UTC date)`
//! (14 PF-5, P-12).
//!
//! The engine supplies a loader that decodes one aggTrades day file; the
//! cache builds the day's 1h and 15m candles from it once, drops the trades
//! (PF-5: raw trades loaded only for candles are not retained), and shares
//! the immutable result (`Arc`) across markets, candidates and threads. Both
//! intervals of a date are stored side by side because one decode builds
//! both. A key is built once even under concurrent requests (as PF-1): later
//! requests for the same key wait for the first build.
//!
//! No eviction: a day holds 24 + 96 candles (about 7 KB), so a year of days
//! is about 2.5 MB, far below the feed day cache (16 §6.1).
//!
//! [`CandleCache::ta_candles`] assembles a market's TA input from the cached
//! days covering [`ta_trades_range`]. [`compute`](crate::compute_technical_indicators)
//! bounds the candles by time, so the output does not depend on which days
//! were already cached (14 V-7, cold or warm day cache).

use crate::candles::{build_day_candles, AggTrade, Candle, CandleError, CandleInterval, DAY_MS};
use crate::technical_indicators::{ta_trades_range, TaInput, TA_LOOKBACK_15M, TA_SYMBOL};
use crate::PluginMarket;
use pmb_core::TsMs;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex, OnceLock};

/// A UTC calendar date, as days since 1970-01-01 (day-file key, 14 §4.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UtcDay(pub i64);

impl UtcDay {
    /// The date containing `t`.
    pub const fn containing(t: TsMs) -> UtcDay {
        UtcDay(t.0.div_euclid(DAY_MS))
    }

    /// Midnight UTC at the start of the date.
    pub const fn start(self) -> TsMs {
        TsMs(self.0 * DAY_MS)
    }

    /// `(year, month, day)` of the proleptic Gregorian calendar
    /// (days-from-civil inverse, exact for every `i64` day in range).
    pub const fn ymd(self) -> (i64, u32, u32) {
        let z = self.0 + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
        let y = yoe + era * 400 + (m <= 2) as i64;
        (y, m, d)
    }
}

/// ISO date `YYYY-MM-DD`, as in the day-file names (14 §4.1).
impl fmt::Display for UtcDay {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (y, m, d) = self.ymd();
        write!(f, "{y:04}-{m:02}-{d:02}")
    }
}

/// The 1h and 15m candles of one UTC date (14 P-8), immutable once built.
#[derive(Clone, Debug, PartialEq)]
pub struct DayCandles {
    h1: Box<[Candle]>,
    m15: Box<[Candle]>,
}

impl DayCandles {
    /// Builds both intervals from the date's trades in `agg_trade_id` order.
    pub fn build(day: UtcDay, trades: &[AggTrade]) -> Result<DayCandles, CandleError> {
        Ok(DayCandles {
            h1: build_day_candles(day.start(), trades, CandleInterval::H1)?.into(),
            m15: build_day_candles(day.start(), trades, CandleInterval::M15)?.into(),
        })
    }

    pub fn get(&self, interval: CandleInterval) -> &[Candle] {
        match interval {
            CandleInterval::H1 => &self.h1,
            CandleInterval::M15 => &self.m15,
        }
    }
}

/// A failed day build. Cached like a success, so every request for the key
/// sees the same error (00 R14: no retry that could change the outcome).
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum CandleCacheError<E: fmt::Display> {
    #[error("loading {pair} aggTrades for {day}: {error}")]
    Load {
        pair: Box<str>,
        day: UtcDay,
        error: E,
    },
    #[error("building {pair} candles for {day}: {error}")]
    Build {
        pair: Box<str>,
        day: UtcDay,
        error: CandleError,
    },
}

type Built<E> = Result<Arc<DayCandles>, CandleCacheError<E>>;
type Slot<E> = Arc<OnceLock<Built<E>>>;
/// pair -> date -> slot (ordered maps, 10 D-2).
type SlotMap<E> = BTreeMap<Box<str>, BTreeMap<UtcDay, Slot<E>>>;

/// Day-cache use of one request, for the per-market diagnostics (14 PF-7:
/// day-cache hits and misses).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct CacheUse {
    /// Days found built (or being built by another request).
    pub hits: u32,
    /// Days this request built.
    pub misses: u32,
}

/// The candles TA needs for one market, copied out of the cached days:
/// 1h candles opening in the P-12 range and 15m candles opening in the last
/// 10 h before `t0` (14 P-9, P-12).
#[derive(Clone, Debug, PartialEq)]
pub struct TaCandles {
    h1: Vec<Candle>,
    m15: Vec<Candle>,
}

impl TaCandles {
    /// The TA input for [`crate::PluginPool::start_market`].
    pub fn input(&self) -> TaInput<'_> {
        TaInput {
            h1: &self.h1,
            m15: &self.m15,
        }
    }
}

/// The per-process candle cache (14 PF-5). `E` is the loader's error.
pub struct CandleCache<E: fmt::Display> {
    slots: Mutex<SlotMap<E>>,
}

impl<E: fmt::Display> Default for CandleCache<E> {
    fn default() -> Self {
        CandleCache::new()
    }
}

impl<E: fmt::Display> fmt::Debug for CandleCache<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CandleCache")
            .field("days", &self.len())
            .finish()
    }
}

impl<E: fmt::Display> CandleCache<E> {
    pub fn new() -> CandleCache<E> {
        CandleCache {
            slots: Mutex::new(BTreeMap::new()),
        }
    }

    /// Number of `(pair, date)` keys requested so far.
    pub fn len(&self) -> usize {
        self.lock().values().map(BTreeMap::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, SlotMap<E>> {
        // The map is only read or inserted into under the lock; a panic
        // there cannot leave it half-updated.
        self.slots.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn slot(&self, pair: &str, day: UtcDay) -> Slot<E> {
        let mut map = self.lock();
        if let Some(s) = map.get(pair).and_then(|days| days.get(&day)) {
            return Arc::clone(s);
        }
        let s: Slot<E> = Arc::new(OnceLock::new());
        map.entry(pair.into())
            .or_default()
            .insert(day, Arc::clone(&s));
        s
    }
}

impl<E: fmt::Display + Clone> CandleCache<E> {
    /// The candles of `(pair, day)`, built once from `load` (14 PF-5). The
    /// map lock is not held while loading, so different days build in
    /// parallel; a second request for the same day waits for the first.
    /// Returns whether this call built the day (`true` = miss).
    pub fn day(
        &self,
        pair: &str,
        day: UtcDay,
        load: impl FnOnce(&str, UtcDay) -> Result<Vec<AggTrade>, E>,
    ) -> Result<(Arc<DayCandles>, bool), CandleCacheError<E>> {
        let slot = self.slot(pair, day);
        let mut built = false;
        let res = slot.get_or_init(|| {
            built = true;
            let trades = load(pair, day).map_err(|error| CandleCacheError::Load {
                pair: pair.into(),
                day,
                error,
            })?;
            // `trades` is dropped at the end of this closure (PF-5).
            DayCandles::build(day, &trades)
                .map(Arc::new)
                .map_err(|error| CandleCacheError::Build {
                    pair: pair.into(),
                    day,
                    error,
                })
        });
        res.clone().map(|d| (d, built))
    }

    /// The TA candles of `market` from the cached days covering
    /// [`ta_trades_range`] (14 P-12), loading missing days with `load`.
    /// `Ok(None)` for a market TA does not support: it needs no days
    /// (14 P-11).
    pub fn ta_candles(
        &self,
        market: &PluginMarket,
        mut load: impl FnMut(&str, UtcDay) -> Result<Vec<AggTrade>, E>,
    ) -> Result<Option<(TaCandles, CacheUse)>, CandleCacheError<E>> {
        let Some((from, to)) = ta_trades_range(market) else {
            return Ok(None);
        };
        let from_15m = to.0 - TA_LOOKBACK_15M as i64 * CandleInterval::M15.ms();
        let mut out = TaCandles {
            h1: Vec::with_capacity(crate::TA_LOOKBACK_1H + 1),
            m15: Vec::with_capacity(TA_LOOKBACK_15M + 1),
        };
        let mut used = CacheUse::default();
        let last = UtcDay::containing(TsMs(to.0 - 1));
        for d in UtcDay::containing(from).0..=last.0 {
            let (days, built) = self.day(TA_SYMBOL, UtcDay(d), &mut load)?;
            if built {
                used.misses += 1;
            } else {
                used.hits += 1;
            }
            let keep = |lo: i64| move |c: &&Candle| c.open_time.0 >= lo && c.open_time < to;
            out.h1
                .extend(days.get(CandleInterval::H1).iter().filter(keep(from.0)));
            out.m15
                .extend(days.get(CandleInterval::M15).iter().filter(keep(from_15m)));
        }
        Ok(Some((out, used)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 14 §4.1 (day-file dates are UTC ISO dates)
    #[test]
    fn utc_day_dates() {
        assert_eq!(UtcDay(0).to_string(), "1970-01-01");
        assert_eq!(
            UtcDay::containing(TsMs(1_760_140_800_000)).to_string(),
            "2025-10-11"
        );
        assert_eq!(
            UtcDay::containing(TsMs(1_760_140_799_999)).to_string(),
            "2025-10-10"
        );
        assert_eq!(UtcDay(-1).to_string(), "1969-12-31");
        // 2024-02-29 (leap day) and 2026-09-18
        assert_eq!(UtcDay(19_782).to_string(), "2024-02-29");
        assert_eq!(UtcDay(20_714).to_string(), "2026-09-18");
        assert_eq!(UtcDay(20_714).start(), TsMs(20_714 * DAY_MS));
    }
}
