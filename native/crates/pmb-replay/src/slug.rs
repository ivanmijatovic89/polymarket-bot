//! Up/down market slugs (`<symbol>-updown-<timeframe>-<epochSeconds>`),
//! market windows and UTC day-file dates (TS `upDownSlugWindow.ts`,
//! `binance/paths.ts`).

use anyhow::{bail, Result};
use pmb_core::model::TsMs;
use serde::{Deserialize, Serialize};

pub const DAY_MS: i64 = 86_400_000;

/// Inclusive market window `[start_ms, end_ms]` (ms since epoch).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub start_ms: TsMs,
    pub end_ms: TsMs,
}

impl Window {
    /// The backtest strategy gate: ticks outside the window are counted but
    /// never reach the strategy (TS `runSingleMarket` `strategyWindow`).
    pub fn contains(&self, ts_ms: TsMs) -> bool {
        ts_ms >= self.start_ms && ts_ms <= self.end_ms
    }
}

/// `(symbol, timeframe, epoch_seconds)` of an up/down slug.
fn parts(slug: &str) -> Option<(&str, &str, &str)> {
    let (symbol, rest) = slug.split_once("-updown-")?;
    if symbol.is_empty() || !symbol.bytes().all(|b| b.is_ascii_lowercase()) {
        return None;
    }
    let (timeframe, epoch) = rest.rsplit_once('-')?;
    if timeframe.is_empty()
        || timeframe.contains('-')
        || epoch.is_empty()
        || !epoch.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    Some((symbol, timeframe, epoch))
}

/// Leading symbol (`btc-updown-15m-…` → `btc`).
pub fn symbol_from_slug(slug: &str) -> Option<&str> {
    // TS matches the symbol prefix alone (`^([a-z]+)-updown-`).
    let (symbol, _) = slug.split_once("-updown-")?;
    (!symbol.is_empty() && symbol.bytes().all(|b| b.is_ascii_lowercase())).then_some(symbol)
}

/// Timeframe token, lowercased (`15m`).
pub fn timeframe_from_slug(slug: &str) -> Option<String> {
    parts(slug).map(|(_, tf, _)| tf.to_ascii_lowercase())
}

/// Timeframe duration in ms (`m` / `h` / `d` units).
pub fn timeframe_ms(timeframe: &str) -> Option<i64> {
    let tf = timeframe.to_ascii_lowercase();
    let unit = tf.chars().last()?;
    let digits = &tf[..tf.len() - unit.len_utf8()];
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: i64 = digits.parse().ok()?;
    if n <= 0 {
        return None;
    }
    match unit {
        'm' => Some(n * 60_000),
        'h' => Some(n * 3_600_000),
        'd' => Some(n * DAY_MS),
        _ => None,
    }
}

/// Market window from the slug, `None` if unparseable.
pub fn window_from_slug(slug: &str) -> Option<Window> {
    let (_, tf, epoch) = parts(slug)?;
    let start_ms = epoch.parse::<i64>().ok()?.checked_mul(1000)?;
    Some(Window {
        start_ms,
        end_ms: start_ms + timeframe_ms(tf)?,
    })
}

/// UTC calendar date (`YYYY-MM-DD`) of an epoch-ms timestamp.
pub fn utc_date_of(ms: TsMs) -> String {
    let days = ms.div_euclid(DAY_MS);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Epoch ms of `YYYY-MM-DDT00:00:00Z`.
pub fn utc_midnight_ms(year: i64, month: u32, day: u32) -> TsMs {
    days_from_civil(year, month, day) * DAY_MS
}

/// Every UTC date whose daily file can hold data in `[start_ms, end_ms)`.
/// `end_ms` is exclusive at day boundaries: a window ending exactly at UTC
/// midnight does not require the next day's file (TS `utcDatesCovering`).
pub fn utc_dates_covering(start_ms: TsMs, end_ms: TsMs) -> Result<Vec<String>> {
    if end_ms < start_ms {
        bail!("invalid time range: start_ms={start_ms} end_ms={end_ms}");
    }
    let mut out = Vec::new();
    let mut day_start = start_ms.div_euclid(DAY_MS) * DAY_MS;
    loop {
        out.push(utc_date_of(day_start));
        day_start += DAY_MS;
        if day_start >= end_ms {
            break;
        }
    }
    Ok(out)
}

/// Howard Hinnant's `civil_from_days` (proleptic Gregorian, UTC).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_slugs() {
        let w = window_from_slug("btc-updown-15m-1789560000").unwrap();
        assert_eq!(w.start_ms, 1_789_560_000_000);
        assert_eq!(w.end_ms, 1_789_560_900_000);
        assert_eq!(symbol_from_slug("btc-updown-15m-1789560000"), Some("btc"));
        assert_eq!(
            timeframe_from_slug("eth-updown-5m-1789560000").as_deref(),
            Some("5m")
        );
        assert_eq!(
            window_from_slug("sol-updown-4h-1789560000").unwrap().end_ms,
            1_789_560_000_000 + 4 * 3_600_000
        );
        assert_eq!(window_from_slug("btc-updown-15m-abc"), None);
        assert_eq!(window_from_slug("BTC-updown-15m-1"), None);
        assert_eq!(window_from_slug("btc-up-or-down-15m-1"), None);
        assert_eq!(window_from_slug("btc-updown-15x-1"), None);
        assert!(Window {
            start_ms: 10,
            end_ms: 20
        }
        .contains(20));
    }

    #[test]
    fn utc_dates() {
        assert_eq!(utc_date_of(0), "1970-01-01");
        assert_eq!(utc_date_of(1_789_516_800_000), "2026-09-16");
        assert_eq!(utc_midnight_ms(2026, 4, 2), 1_775_088_000_000);
        assert_eq!(utc_date_of(utc_midnight_ms(2024, 2, 29)), "2024-02-29");
        let day = 1_789_516_800_000;
        // window ending exactly at midnight does not need the next day
        assert_eq!(
            utc_dates_covering(day - 900_000, day).unwrap(),
            vec!["2026-09-15"]
        );
        assert_eq!(
            utc_dates_covering(day - 900_000, day + 1).unwrap(),
            vec!["2026-09-15", "2026-09-16"]
        );
        assert_eq!(utc_dates_covering(day, day).unwrap(), vec!["2026-09-16"]);
        assert!(utc_dates_covering(day, day - 1).is_err());
    }
}
