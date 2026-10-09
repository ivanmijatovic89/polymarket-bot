//! Binance aggTrades day files and the per-market as-of series (14 §4).
//!
//! A decoded day is immutable and shared (`Arc`) by every market of the day
//! (14 PF-1). A market's series is an index range into the day when the day
//! is a single file with `ts_ms` non-decreasing in id order, otherwise a
//! small filtered copy (14 PF-2). Either way the series keeps F-13/F-14
//! exactly: members are trades with `start - lookback <= ts <= end + tail`
//! in `agg_trade_id` order, preceded by the single highest-id trade with
//! `ts < start - lookback` in the covered days.

use crate::config::{FeedProfile, BINANCE_TAIL_MS, LOOKBACK_MS};
use crate::error::{FeedCause, FeedError};
use crate::pq::{self, Column};
use crate::time::{iso_ms, UtcDay};
use parquet::basic::Type as PhysicalType;
use parquet::data_type::{DoubleType, Int64Type};
use parquet::file::reader::FileReader;
use pmb_core::Window;
use std::path::Path;
use std::sync::Arc;

/// One decoded aggTrades day (14 §4.1), sorted by `agg_trade_id`.
#[derive(Debug)]
pub struct BinanceDay {
    pub day: UtcDay,
    ids: Box<[i64]>,
    ts: Arc<[i64]>,
    /// NaN where the file holds NULL; validated per series (14 F-17).
    price: Arc<[f64]>,
    ts_monotone: bool,
}

impl BinanceDay {
    /// Builds a day from `(agg_trade_id, ts_ms, price)` rows in any order.
    /// Duplicate ids are `data_defect: corrupt`.
    // D-PENDING: duplicate agg_trade_id within a day (TS orders such ties
    // arbitrarily); chose data_defect corrupt.
    pub fn from_rows(
        day: UtcDay,
        mut rows: Vec<(i64, i64, f64)>,
        what: &str,
    ) -> Result<BinanceDay, FeedError> {
        if !rows.windows(2).all(|w| w[0].0 < w[1].0) {
            rows.sort_by_key(|r| r.0);
            if let Some(w) = rows.windows(2).find(|w| w[0].0 == w[1].0) {
                return Err(FeedError::new(
                    FeedCause::Corrupt,
                    format!(
                        "duplicate agg_trade_id {} in {what}; re-download with --force",
                        w[0].0
                    ),
                ));
            }
        }
        let ts_monotone = rows.windows(2).all(|w| w[0].1 <= w[1].1);
        Ok(BinanceDay {
            day,
            ids: rows.iter().map(|r| r.0).collect(),
            ts: rows.iter().map(|r| r.1).collect(),
            price: rows.iter().map(|r| r.2).collect(),
            ts_monotone,
        })
    }

    /// Decodes a day file (columns `agg_trade_id INT64`, `ts_ms INT64`,
    /// `price DOUBLE`; 14 §4.1). A decode failure is `runtime:
    /// decode_unverified`; a NULL id or timestamp is `data_defect: corrupt`.
    // D-PENDING: NULL agg_trade_id / ts_ms (TS drops NULL-ts rows through SQL
    // and orders NULL ids last); chose data_defect corrupt (fail loud, R14).
    pub fn decode(path: &Path, day: UtcDay) -> Result<BinanceDay, FeedError> {
        let what = path.display().to_string();
        let decode_err = |e: String| {
            FeedError::new(
                FeedCause::DecodeUnverified,
                format!("Binance aggTrades day file {what} fails to decode: {e}"),
            )
        };
        let reader = pq::open(path).map_err(decode_err)?;
        let c_id = pq::column(&reader, "agg_trade_id", PhysicalType::INT64).map_err(decode_err)?;
        let c_ts = pq::column(&reader, "ts_ms", PhysicalType::INT64).map_err(decode_err)?;
        let c_px = pq::column(&reader, "price", PhysicalType::DOUBLE).map_err(decode_err)?;
        let total: i64 = reader.metadata().file_metadata().num_rows();
        let mut rows = Vec::with_capacity(usize::try_from(total).unwrap_or(0));
        let (mut id, mut ts, mut px) = (
            Column::<i64>::new(),
            Column::<i64>::new(),
            Column::<f64>::new(),
        );
        for g in 0..reader.num_row_groups() {
            let n = pq::group_rows(&reader, g).map_err(decode_err)?;
            let rg = pq::row_group(&reader, g).map_err(decode_err)?;
            id.read::<Int64Type>(rg.as_ref(), c_id, n)
                .map_err(decode_err)?;
            ts.read::<Int64Type>(rg.as_ref(), c_ts, n)
                .map_err(decode_err)?;
            px.read::<DoubleType>(rg.as_ref(), c_px, n)
                .map_err(decode_err)?;
            for r in 0..n {
                let (Some(&i), Some(&t)) = (id.get(r), ts.get(r)) else {
                    return Err(FeedError::new(
                        FeedCause::Corrupt,
                        format!(
                            "NULL agg_trade_id or ts_ms in {what} (row group {g}, row {r}); \
                             re-download with --force"
                        ),
                    ));
                };
                rows.push((i, t, px.get(r).copied().unwrap_or(f64::NAN)));
            }
        }
        BinanceDay::from_rows(day, rows, &what)
    }

    pub fn len(&self) -> usize {
        self.ts.len()
    }
    pub fn is_empty(&self) -> bool {
        self.ts.is_empty()
    }
    /// `ts_ms` is non-decreasing in id order (14 PF-2).
    pub fn ts_monotone(&self) -> bool {
        self.ts_monotone
    }
    /// Decoded size in bytes (cache accounting, 14 PF-1).
    pub fn bytes(&self) -> usize {
        self.len() * 24
    }
    /// Whether a market series still borrows this day's arrays.
    pub(crate) fn in_use(&self) -> bool {
        Arc::strong_count(&self.ts) > 1 || Arc::strong_count(&self.price) > 1
    }
}

/// A market's Binance series in series order (seed first when present).
#[derive(Clone, Debug)]
pub struct BinanceSeries {
    ts: Arc<[i64]>,
    price: Arc<[f64]>,
    start: usize,
    len: usize,
    seeded: bool,
    latency_ms: i64,
    /// Explicit visibility, only when the realistic monotone clamp changes
    /// it (14 F-52, PF-8).
    vis: Option<Box<[i64]>>,
    zero_copy: bool,
}

impl BinanceSeries {
    /// A series from in-memory arrays in series order (tests, goldens).
    pub fn from_parts(
        ts: Vec<i64>,
        price: Vec<f64>,
        seeded: bool,
        latency_ms: i64,
        profile: FeedProfile,
    ) -> BinanceSeries {
        assert_eq!(ts.len(), price.len(), "series arrays differ in length");
        let len = ts.len();
        let mut s = BinanceSeries {
            ts: ts.into(),
            price: price.into(),
            start: 0,
            len,
            seeded,
            latency_ms,
            vis: None,
            zero_copy: false,
        };
        s.apply_delivery(profile);
        s
    }

    /// Realistic monotone delivery (14 F-52): `vis_i = max(vis_{i-1}, T_i +
    /// L)`. Equal to `T + L` whenever `T` is non-decreasing, so the vector
    /// is built only when it differs.
    fn apply_delivery(&mut self, profile: FeedProfile) {
        if profile != FeedProfile::Realistic {
            return;
        }
        let ts = &self.ts[self.start..self.start + self.len];
        if ts.windows(2).all(|w| w[0] <= w[1]) {
            return;
        }
        let mut prev = i64::MIN;
        self.vis = Some(
            ts.iter()
                .map(|&t| {
                    prev = prev.max(t + self.latency_ms);
                    prev
                })
                .collect(),
        );
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    /// Trade time of element `i`.
    #[inline]
    pub fn ts(&self, i: usize) -> i64 {
        self.ts[self.start + i]
    }
    #[inline]
    pub fn price(&self, i: usize) -> f64 {
        self.price[self.start + i]
    }
    /// Visibility time of element `i` (14 F-15, F-52).
    #[inline]
    pub fn vis(&self, i: usize) -> i64 {
        match &self.vis {
            Some(v) => v[i],
            None => self.ts(i) + self.latency_ms,
        }
    }
    /// Element 0 is the pre-range seed (14 F-14).
    #[inline]
    pub fn seeded(&self) -> bool {
        self.seeded
    }
    /// Elements inside the membership range (without the seed).
    #[inline]
    pub fn in_range(&self) -> usize {
        self.len - usize::from(self.seeded)
    }
    /// The series borrows its day without copying (14 PF-2).
    pub fn is_zero_copy(&self) -> bool {
        self.zero_copy
    }
}

/// A built series plus the seed-only warning of 14 F-18.
#[derive(Debug)]
pub struct BuiltBinance {
    pub series: BinanceSeries,
    pub warning: Option<String>,
}

/// Builds the market series from the covered days in date order (14 F-12 to
/// F-18). `days` MUST be the full day set of F-12.
pub fn build_binance_series(
    pair: &str,
    days: &[Arc<BinanceDay>],
    window: Window,
    latency_ms: i64,
    profile: FeedProfile,
) -> Result<BuiltBinance, FeedError> {
    let from = window.start_ms.0 - LOOKBACK_MS;
    let to = window.end_ms.0 + BINANCE_TAIL_MS;
    let mut series = if let [d] = days {
        if d.ts_monotone {
            // Zero-copy: members are one contiguous id range and the seed is
            // the element just before it (14 PF-2).
            let lo = d.ts.partition_point(|&t| t < from);
            let hi = d.ts.partition_point(|&t| t <= to);
            let seeded = lo > 0;
            let start = lo - usize::from(seeded);
            validate_prices(pair, &d.ids[start..hi], &d.price[start..hi])?;
            Some(BinanceSeries {
                ts: d.ts.clone(),
                price: d.price.clone(),
                start,
                len: hi - start,
                seeded,
                latency_ms,
                vis: None,
                zero_copy: true,
            })
        } else {
            None
        }
    } else {
        None
    };
    if series.is_none() {
        series = Some(filtered_copy(pair, days, from, to, latency_ms)?);
    }
    let mut series = series.expect("series built above");
    let dates = || {
        let first = days.first().map(|d| d.day.to_string()).unwrap_or_default();
        let last = days.last().map(|d| d.day.to_string()).unwrap_or_default();
        (first, last)
    };
    if series.is_empty() {
        let (first, last) = dates();
        let list: Vec<String> = days.iter().map(|d| d.day.to_string()).collect();
        return Err(FeedError::new(
            FeedCause::Corrupt,
            format!(
                "Binance aggTrades day file(s) for {pair} contain no trades up to {} ({}): \
                 corrupt or empty day file(s), or the pair had no trades yet. Re-download on the \
                 producer with: npm run binance:download-aggtrades -- --pair {pair} --from {first} \
                 --to {last} --force",
                iso_ms(window.end_ms.0),
                list.join(", ")
            ),
        ));
    }
    let warning = (series.in_range() == 0).then(|| {
        let (_, last) = dates();
        format!(
            "no {pair} trades inside [{}, {}]: the whole market replays on the single pre-window \
             price from {}. Quiet gap, or truncated day file? (verify {pair} day {last} with: npm \
             run verify:parquet)",
            iso_ms(from),
            iso_ms(window.end_ms.0),
            iso_ms(series.ts(0))
        )
    });
    series.apply_delivery(profile);
    Ok(BuiltBinance { series, warning })
}

/// F-13/F-14 by scanning: used for multi-day sets and days whose `ts_ms` is
/// not monotone in id order (14 PF-2).
fn filtered_copy(
    pair: &str,
    days: &[Arc<BinanceDay>],
    from: i64,
    to: i64,
    latency_ms: i64,
) -> Result<BinanceSeries, FeedError> {
    let mut seed: Option<usize> = None; // index into `picked`
    let mut picked: Vec<(i64, i64, f64)> = Vec::new();
    let mut seed_row: Option<(i64, i64, f64)> = None;
    for d in days {
        let row = |i: usize| (d.ids[i], d.ts[i], d.price[i]);
        if d.ts_monotone {
            let lo = d.ts.partition_point(|&t| t < from);
            let hi = d.ts.partition_point(|&t| t <= to);
            if lo > 0 && seed_row.is_none_or(|s| d.ids[lo - 1] > s.0) {
                seed_row = Some(row(lo - 1));
            }
            picked.extend((lo..hi).map(row));
        } else {
            for i in 0..d.len() {
                let t = d.ts[i];
                if t < from {
                    if seed_row.is_none_or(|s| d.ids[i] > s.0) {
                        seed_row = Some(row(i));
                    }
                } else if t <= to {
                    picked.push(row(i));
                }
            }
        }
    }
    picked.sort_by_key(|r| r.0);
    if let Some(s) = seed_row {
        picked.insert(0, s);
        seed = Some(0);
    }
    let ids: Vec<i64> = picked.iter().map(|r| r.0).collect();
    let price: Vec<f64> = picked.iter().map(|r| r.2).collect();
    validate_prices(pair, &ids, &price)?;
    Ok(BinanceSeries {
        len: picked.len(),
        ts: picked.iter().map(|r| r.1).collect(),
        price: price.into(),
        start: 0,
        seeded: seed.is_some(),
        latency_ms,
        vis: None,
        zero_copy: false,
    })
}

/// Every loaded price is finite and > 0, else `data_defect: corrupt`
/// naming the pair and agg id (14 F-17; TS does not check: a divergence is
/// classified "TS bug").
fn validate_prices(pair: &str, ids: &[i64], price: &[f64]) -> Result<(), FeedError> {
    match price.iter().position(|p| !(p.is_finite() && *p > 0.0)) {
        None => Ok(()),
        Some(i) => Err(FeedError::new(
            FeedCause::Corrupt,
            format!(
                "NULL/invalid price {} in Binance aggTrades for {pair} (agg_trade_id={}); \
                 re-download with --force",
                price[i], ids[i]
            ),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::TsMs;

    const DAY: i64 = 1_789_516_800_000; // 2026-09-16T00:00:00Z

    fn day(d: i64, rows: &[(i64, i64, f64)]) -> Arc<BinanceDay> {
        Arc::new(BinanceDay::from_rows(UtcDay::of_ms(d), rows.to_vec(), "test").unwrap())
    }

    fn win(start: i64, len: i64) -> Window {
        Window {
            start_ms: TsMs(start),
            end_ms: TsMs(start + len),
        }
    }

    fn elems(s: &BinanceSeries) -> Vec<(i64, f64)> {
        (0..s.len()).map(|i| (s.ts(i), s.price(i))).collect()
    }

    // spec: 14 F-13 (membership incl. tail), F-14 (seed), PF-2 (zero-copy)
    #[test]
    fn zero_copy_range_and_seed() {
        let t0 = DAY + 3_600_000;
        let from = t0 - LOOKBACK_MS;
        let end = t0 + 900_000;
        let d = day(
            DAY,
            &[
                (1, DAY + 10, 1.0),
                (2, from - 1, 2.0),
                (3, from, 3.0),
                (4, from, 4.0),
                (5, end + BINANCE_TAIL_MS, 5.0),
                (6, end + BINANCE_TAIL_MS + 1, 6.0),
            ],
        );
        assert!(d.ts_monotone());
        let b = build_binance_series(
            "BTCUSDT",
            &[d],
            win(t0, 900_000),
            110,
            FeedProfile::TsCompat,
        )
        .unwrap();
        let s = &b.series;
        assert!(s.is_zero_copy() && s.seeded() && b.warning.is_none());
        assert_eq!(
            elems(s),
            vec![(from - 1, 2.0), (from, 3.0), (from, 4.0), (end + 2000, 5.0)]
        );
        assert_eq!(s.vis(0), from - 1 + 110);
        assert_eq!(s.in_range(), 3);
    }

    // spec: 14 F-13, F-14 (id order, seed = highest id before the range even
    // when timestamps are not monotone), PF-2 (filtered copy)
    #[test]
    fn non_monotone_day_uses_filtered_copy() {
        let t0 = DAY + 3_600_000;
        let from = t0 - LOOKBACK_MS;
        let d = day(
            DAY,
            &[
                (7, t0 + 5, 7.0),
                (1, DAY + 10, 1.0),
                (5, from - 1, 5.0),
                (3, from - 50, 3.0),
                (4, from + 1, 4.0),
                (6, from - 7, 6.0),
            ],
        );
        assert!(!d.ts_monotone());
        let b = build_binance_series("BTCUSDT", &[d], win(t0, 900_000), 0, FeedProfile::TsCompat)
            .unwrap();
        assert!(!b.series.is_zero_copy());
        // seed = id 6 (highest id with ts < from), then ids 4, 7.
        assert_eq!(
            elems(&b.series),
            vec![(from - 7, 6.0), (from + 1, 4.0), (t0 + 5, 7.0)]
        );
    }

    // spec: 14 F-12 (multi-day sets), F-14 (seed across covered days)
    #[test]
    fn two_days() {
        let t0 = DAY; // midnight start: lookback lies in the previous day
        let from = t0 - LOOKBACK_MS;
        let prev = day(DAY - 86_400_000, &[(1, from - 10, 1.0), (2, from + 5, 2.0)]);
        let cur = day(DAY, &[(3, DAY + 1, 3.0)]);
        let b = build_binance_series(
            "BTCUSDT",
            &[prev, cur],
            win(t0, 900_000),
            0,
            FeedProfile::TsCompat,
        )
        .unwrap();
        assert_eq!(
            elems(&b.series),
            vec![(from - 10, 1.0), (from + 5, 2.0), (DAY + 1, 3.0)]
        );
        assert!(b.series.seeded());
    }

    // spec: 14 F-18 (seed-only warning, empty is data_defect), F-17
    #[test]
    fn seed_only_empty_and_bad_price() {
        let t0 = DAY + 3_600_000;
        let d = day(DAY, &[(1, DAY + 10, 1.0)]);
        let b = build_binance_series(
            "BTCUSDT",
            std::slice::from_ref(&d),
            win(t0, 900_000),
            0,
            FeedProfile::TsCompat,
        )
        .unwrap();
        assert_eq!(b.series.len(), 1);
        assert!(b.warning.unwrap().contains("single pre-window price"));
        let empty = day(DAY, &[]);
        let e = build_binance_series(
            "BTCUSDT",
            &[empty],
            win(t0, 900_000),
            0,
            FeedProfile::TsCompat,
        )
        .unwrap_err();
        assert_eq!(e.cause, FeedCause::Corrupt);
        assert!(e.message.contains("--force") && e.message.contains("2026-09-16"));
        let bad = day(DAY, &[(9, t0, f64::NAN)]);
        let e = build_binance_series(
            "BTCUSDT",
            &[bad],
            win(t0, 900_000),
            0,
            FeedProfile::TsCompat,
        )
        .unwrap_err();
        assert_eq!(e.cause, FeedCause::Corrupt);
        assert!(e.message.contains("agg_trade_id=9") && e.message.contains("BTCUSDT"));
        let neg = day(DAY, &[(9, t0, -1.0)]);
        assert!(build_binance_series(
            "BTCUSDT",
            &[neg],
            win(t0, 900_000),
            0,
            FeedProfile::TsCompat
        )
        .is_err());
    }

    // spec: 14 F-52 (realistic monotone delivery; ts-compat unclamped)
    #[test]
    fn realistic_monotone_delivery() {
        let ts = vec![100, 90, 120];
        let s =
            BinanceSeries::from_parts(ts.clone(), vec![1.0; 3], false, 10, FeedProfile::TsCompat);
        assert_eq!(
            (0..3).map(|i| s.vis(i)).collect::<Vec<_>>(),
            vec![110, 100, 130]
        );
        let r = BinanceSeries::from_parts(ts, vec![1.0; 3], false, 10, FeedProfile::Realistic);
        assert_eq!(
            (0..3).map(|i| r.vis(i)).collect::<Vec<_>>(),
            vec![110, 110, 130]
        );
        // V-10 (a): with non-decreasing ts the profiles agree.
        let m = BinanceSeries::from_parts(
            vec![1, 1, 2],
            vec![1.0; 3],
            false,
            5,
            FeedProfile::Realistic,
        );
        assert!(m.vis.is_none());
    }

    #[test]
    fn duplicate_ids_are_corrupt() {
        let e = BinanceDay::from_rows(UtcDay(0), vec![(2, 1, 1.0), (1, 1, 1.0), (2, 2, 1.0)], "x")
            .unwrap_err();
        assert_eq!(e.cause, FeedCause::Corrupt);
    }
}
