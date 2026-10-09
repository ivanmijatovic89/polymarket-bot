//! Chainlink `crypto_prices` day files and the two-clock market series
//! (14 §5).
//!
//! Membership is by round time, order by `(broadcast, round)`; visibility
//! keys on broadcast time plus the bot leg `L_c`, while the emitted point
//! keeps the round time (14 F-21 to F-24). The series is a small filtered
//! copy (about 1.5 k rows for a 15m market, 14 PF-2).

use crate::config::{CHAINLINK_TAIL_MS, LOOKBACK_MS};
use crate::error::{FeedCause, FeedError};
use crate::pq::{self, Column};
use crate::time::{iso_ms, UtcDay};
use parquet::basic::Type as PhysicalType;
use parquet::data_type::{ByteArray, ByteArrayType, Int64Type};
use parquet::file::reader::FileReader;
use pmb_core::Window;
use std::path::Path;
use std::sync::Arc;

const BAD_BROADCAST: u8 = 1;
const BAD_PRICE: u8 = 2;
const BAD_ASSET: u8 = 4;

/// One decoded `crypto_prices` day of one asset, in file order. Rows without
/// a round time are dropped (they can be neither member nor seed, F-21).
/// Row defects are flagged and raised only for rows a series uses (F-25).
#[derive(Debug)]
pub struct ChainlinkDay {
    pub day: UtcDay,
    round_us: Box<[i64]>,
    /// 0 where NULL (flagged).
    broadcast_us: Box<[i64]>,
    /// NaN where unparseable (flagged).
    price: Box<[f64]>,
    flags: Box<[u8]>,
}

/// Column builder shared by the decoder and [`ChainlinkDay::from_rows`].
#[derive(Default)]
struct Builder {
    round: Vec<i64>,
    broadcast: Vec<i64>,
    price: Vec<f64>,
    flags: Vec<u8>,
}

impl Builder {
    #[inline]
    fn push(&mut self, round: i64, broadcast: Option<i64>, price: Option<&str>, asset_ok: bool) {
        let mut flags = 0;
        let bc = broadcast.unwrap_or(0);
        if bc <= 0 {
            flags |= BAD_BROADCAST;
        }
        let px = price
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0);
        if px.is_none() {
            flags |= BAD_PRICE;
        }
        if !asset_ok {
            flags |= BAD_ASSET;
        }
        self.round.push(round);
        self.broadcast.push(bc);
        self.price.push(px.unwrap_or(f64::NAN));
        self.flags.push(flags);
    }

    fn finish(self, day: UtcDay) -> ChainlinkDay {
        ChainlinkDay {
            day,
            round_us: self.round.into(),
            broadcast_us: self.broadcast.into(),
            price: self.price.into(),
            flags: self.flags.into(),
        }
    }
}

/// One raw row: `(timestamp_us, server_timestamp_us, price, asset_id)`.
pub type RawRound<'a> = (i64, Option<i64>, Option<&'a str>, Option<&'a str>);

impl ChainlinkDay {
    /// Builds a day from raw rows in file order (tests).
    pub fn from_rows<'a>(
        day: UtcDay,
        asset_id: &str,
        rows: impl IntoIterator<Item = RawRound<'a>>,
    ) -> ChainlinkDay {
        let mut b = Builder::default();
        for (round, broadcast, price, asset) in rows {
            b.push(round, broadcast, price, asset == Some(asset_id));
        }
        b.finish(day)
    }

    /// Decodes a raw Telonex day file (`timestamp_us`, `server_timestamp_us`
    /// INT64; `price`, `asset_id` strings; 14 §5.1). A decode failure is
    /// `runtime: decode_unverified`.
    pub fn decode(path: &Path, day: UtcDay, asset_id: &str) -> Result<ChainlinkDay, FeedError> {
        let what = path.display().to_string();
        let decode_err = |e: String| {
            FeedError::new(
                FeedCause::DecodeUnverified,
                format!("Telonex crypto_prices day file {what} fails to decode: {e}"),
            )
        };
        let reader = pq::open(path).map_err(decode_err)?;
        let c_round =
            pq::column(&reader, "timestamp_us", PhysicalType::INT64).map_err(decode_err)?;
        let c_bc =
            pq::column(&reader, "server_timestamp_us", PhysicalType::INT64).map_err(decode_err)?;
        let c_px = pq::column(&reader, "price", PhysicalType::BYTE_ARRAY).map_err(decode_err)?;
        let c_asset =
            pq::column(&reader, "asset_id", PhysicalType::BYTE_ARRAY).map_err(decode_err)?;
        let (mut round, mut bc) = (Column::<i64>::new(), Column::<i64>::new());
        let (mut px, mut asset) = (Column::<ByteArray>::new(), Column::<ByteArray>::new());
        let mut out = Builder::default();
        for g in 0..reader.num_row_groups() {
            let n = pq::group_rows(&reader, g).map_err(decode_err)?;
            let rg = pq::row_group(&reader, g).map_err(decode_err)?;
            round
                .read::<Int64Type>(rg.as_ref(), c_round, n)
                .map_err(decode_err)?;
            bc.read::<Int64Type>(rg.as_ref(), c_bc, n)
                .map_err(decode_err)?;
            px.read::<ByteArrayType>(rg.as_ref(), c_px, n)
                .map_err(decode_err)?;
            asset
                .read::<ByteArrayType>(rg.as_ref(), c_asset, n)
                .map_err(decode_err)?;
            for r in 0..n {
                let Some(&t) = round.get(r) else { continue };
                let price = px.get(r).and_then(|b| std::str::from_utf8(b.data()).ok());
                let asset_ok = asset
                    .get(r)
                    .is_some_and(|b| b.data() == asset_id.as_bytes());
                out.push(t, bc.get(r).copied(), price, asset_ok);
            }
        }
        Ok(out.finish(day))
    }

    pub fn len(&self) -> usize {
        self.round_us.len()
    }
    pub fn is_empty(&self) -> bool {
        self.round_us.is_empty()
    }
    /// Decoded size in bytes (cache accounting, 14 PF-1).
    pub fn bytes(&self) -> usize {
        self.len() * 25
    }
}

/// A market's Chainlink series, ordered by `(broadcast, round)`; times in ms.
#[derive(Clone, Debug, Default)]
pub struct ChainlinkSeries {
    round: Box<[i64]>,
    broadcast: Box<[i64]>,
    price: Box<[f64]>,
    seeded: bool,
    latency_ms: i64,
}

impl ChainlinkSeries {
    /// A series from in-memory arrays in series order (tests, goldens).
    pub fn from_parts(
        round_ms: Vec<i64>,
        broadcast_ms: Vec<i64>,
        price: Vec<f64>,
        seeded: bool,
        latency_ms: i64,
    ) -> ChainlinkSeries {
        assert!(round_ms.len() == broadcast_ms.len() && round_ms.len() == price.len());
        ChainlinkSeries {
            round: round_ms.into(),
            broadcast: broadcast_ms.into(),
            price: price.into(),
            seeded,
            latency_ms,
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.round.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.round.is_empty()
    }
    /// Round time (`sourceTsMs`, F-24).
    #[inline]
    pub fn round(&self, i: usize) -> i64 {
        self.round[i]
    }
    /// Broadcast time.
    #[inline]
    pub fn broadcast(&self, i: usize) -> i64 {
        self.broadcast[i]
    }
    #[inline]
    pub fn price(&self, i: usize) -> f64 {
        self.price[i]
    }
    /// Visibility `broadcast + L_c` (F-23). Broadcast order makes it
    /// non-decreasing, so the realistic monotone clamp (F-52) is the
    /// identity here.
    #[inline]
    pub fn vis(&self, i: usize) -> i64 {
        self.broadcast[i] + self.latency_ms
    }
    #[inline]
    pub fn seeded(&self) -> bool {
        self.seeded
    }
}

/// Builds the market series from the covered days (14 F-20 to F-27).
/// `days` MUST be the full F-20 day set; the coverage floor (F-19) is checked
/// by the caller before any file is opened (TS order).
pub fn build_chainlink_series(
    asset_id: &str,
    days: &[Arc<ChainlinkDay>],
    window: Window,
    latency_ms: i64,
    max_gap_ms: i64,
) -> Result<ChainlinkSeries, FeedError> {
    build_chainlink_series_with_lookback(
        asset_id,
        days,
        window,
        latency_ms,
        max_gap_ms,
        LOOKBACK_MS,
    )
}

/// [`build_chainlink_series`] with an explicit lookback, for the lookback
/// invariance property only (14 §4.3, V-7); the engine always uses
/// [`LOOKBACK_MS`] (F-47).
#[doc(hidden)]
pub fn build_chainlink_series_with_lookback(
    asset_id: &str,
    days: &[Arc<ChainlinkDay>],
    window: Window,
    latency_ms: i64,
    max_gap_ms: i64,
    lookback_ms: i64,
) -> Result<ChainlinkSeries, FeedError> {
    let from_us = (window.start_ms.0 - lookback_ms) * 1000;
    let to_us = (window.end_ms.0 + CHAINLINK_TAIL_MS) * 1000;
    // (broadcast_us, round_us, day, row); comparisons in µs as the TS SQL.
    let mut members: Vec<(i64, i64, usize, usize)> = Vec::new();
    let mut seed: Option<(i64, i64, usize, usize)> = None;
    for (di, d) in days.iter().enumerate() {
        for i in 0..d.len() {
            let r = d.round_us[i];
            let key = (d.broadcast_us[i], r, di, i);
            if r < from_us {
                // D-PENDING: rows tied on (broadcast, round) have no defined
                // order in TS (DuckDB ORDER BY); chose the later file row.
                if seed.is_none_or(|s| (key.0, key.1) >= (s.0, s.1)) {
                    seed = Some(key);
                }
            } else if r <= to_us {
                members.push(key);
            }
        }
    }
    // Stable: ties keep file order (see the D-PENDING above).
    members.sort_by_key(|m| (m.0, m.1));
    let seeded = seed.is_some();
    let rows: Vec<(i64, i64, usize, usize)> = seed.into_iter().chain(members).collect();
    let (mut round, mut broadcast, mut price) = (
        Vec::with_capacity(rows.len()),
        Vec::with_capacity(rows.len()),
        Vec::with_capacity(rows.len()),
    );
    for &(bc, r, di, i) in &rows {
        let flags = days[di].flags[i];
        let round_ms = r.div_euclid(1000);
        // F-25: every row of the series including the seed.
        let defect = if flags & BAD_BROADCAST != 0 {
            Some("NULL/invalid server_timestamp_us")
        } else if flags & BAD_PRICE != 0 {
            Some("NULL/invalid price")
        } else if flags & BAD_ASSET != 0 {
            Some("foreign asset_id")
        } else {
            None
        };
        if let Some(what) = defect {
            return Err(FeedError::new(
                FeedCause::Corrupt,
                format!(
                    "{what} in crypto_prices day file {} for {asset_id} (round ts={round_ms}); \
                     corrupt row, re-download with --force",
                    days[di].day
                ),
            ));
        }
        round.push(round_ms);
        broadcast.push(bc.div_euclid(1000));
        price.push(days[di].price[i]);
    }
    let s = ChainlinkSeries {
        round: round.into(),
        broadcast: broadcast.into(),
        price: price.into(),
        seeded,
        latency_ms,
    };
    if s.is_empty() {
        let list: Vec<String> = days.iter().map(|d| d.day.to_string()).collect();
        let first = list.first().cloned().unwrap_or_default();
        let last = list.last().cloned().unwrap_or_default();
        return Err(FeedError::new(
            FeedCause::Corrupt,
            format!(
                "Telonex crypto_prices day file(s) for {asset_id} contain no rounds up to {} ({}): \
                 corrupt or empty day file(s)? Re-download on the producer with: npm run \
                 telonex:crypto-prices:download -- --asset {asset_id} --from {first} --to {last} \
                 --force",
                iso_ms(window.end_ms.0),
                list.join(", ")
            ),
        ));
    }
    check_gap(asset_id, &s.round, window, max_gap_ms)?;
    Ok(s)
}

/// Largest stale span of the round series clipped to `[start, end]`,
/// bounded by the seed before and the tail after: `(span, from)` (14 F-26;
/// `chainlinkCryptoPricesSource.ts:211-235`).
pub fn worst_gap(round_ms: &[i64], window: Window) -> (i64, i64) {
    let (start, end) = (window.start_ms.0, window.end_ms.0);
    let mut sorted = round_ms.to_vec();
    sorted.sort_unstable();
    let (mut worst, mut worst_from) = (0i64, start);
    let mut prev = i64::MIN;
    for i in 0..=sorted.len() {
        let next = sorted.get(i).copied().unwrap_or(i64::MAX);
        let span_from = prev.max(start);
        let span_to = next.min(end);
        if span_to - span_from > worst {
            worst = span_to - span_from;
            worst_from = span_from;
        }
        prev = next;
        if next >= end {
            break;
        }
    }
    (worst, worst_from)
}

/// A hole of at least `max_gap_ms` is `data_defect: upstream_hole` naming the
/// hole and the `maxGapMs: 0` option; 0 disables the check (14 F-26).
fn check_gap(
    asset_id: &str,
    round_ms: &[i64],
    window: Window,
    max_gap_ms: i64,
) -> Result<(), FeedError> {
    if max_gap_ms == 0 {
        return Ok(());
    }
    let (span, from) = worst_gap(round_ms, window);
    if span >= max_gap_ms {
        return Err(FeedError::new(
            FeedCause::UpstreamHole,
            format!(
                "Chainlink hole for {asset_id} from {} for {} ms (>= maxGapMs {max_gap_ms}) inside \
                 the window [{} .. {}]: an upstream Polymarket/Telonex outage, the data does not \
                 exist anywhere. Exclude the market (gap list: docs/datasets/data-coverage.md) or \
                 set feeds.chainlink.maxGapMs 0 to replay the frozen last-known price",
                iso_ms(from),
                span,
                iso_ms(window.start_ms.0),
                iso_ms(window.end_ms.0)
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::TsMs;

    const DAY: i64 = 1_789_516_800_000; // 2026-09-16

    fn win(start: i64) -> Window {
        Window {
            start_ms: TsMs(start),
            end_ms: TsMs(start + 900_000),
        }
    }

    fn day(rows: &[(i64, Option<i64>, &str)]) -> Arc<ChainlinkDay> {
        Arc::new(ChainlinkDay::from_rows(
            UtcDay::of_ms(DAY),
            "btcusd",
            rows.iter()
                .map(|(r, b, p)| (*r, *b, Some(*p), Some("btcusd"))),
        ))
    }

    // spec: 14 F-21 (membership by round in µs, order by (broadcast, round)),
    // F-22 (seed by (broadcast, round)), F-24 (round time emitted)
    #[test]
    fn two_clock_order_and_seed() {
        let t0 = DAY + 3_600_000;
        let from_us = (t0 - LOOKBACK_MS) * 1000;
        let d = day(&[
            // seed candidates: latest broadcast wins, not latest round
            (from_us - 5_000_000, Some(from_us + 900_000), "1"),
            (from_us - 1_000_000, Some(from_us + 100_000), "2"),
            // 1 µs before `from` in µs is not a member even though it floors to from-1 ms
            (from_us - 1, Some(from_us + 50_000), "3"),
            (from_us, Some(from_us + 2_000_000), "4"),
            (from_us + 1_000_000, Some(from_us + 1_500_000), "5"),
            (t0 * 1000 + 300_000_000, Some(t0 * 1000 + 300_900_000), "6"),
        ]);
        let s = build_chainlink_series("btcusd", &[d], win(t0), 320, 0).unwrap();
        assert!(s.seeded());
        let got: Vec<(i64, i64, f64)> = (0..s.len())
            .map(|i| (s.round(i), s.broadcast(i), s.price(i)))
            .collect();
        assert_eq!(
            got,
            vec![
                (
                    (from_us - 5_000_000) / 1000,
                    (from_us + 900_000) / 1000,
                    1.0
                ),
                (
                    (from_us + 1_000_000) / 1000,
                    (from_us + 1_500_000) / 1000,
                    5.0
                ),
                (from_us / 1000, (from_us + 2_000_000) / 1000, 4.0),
                (t0 + 300_000, t0 + 300_900, 6.0),
            ]
        );
        assert_eq!(s.vis(1), (from_us + 1_500_000) / 1000 + 320);
    }

    // spec: 14 F-26 (gap check), F-27 (zero rows), F-25 (validation)
    #[test]
    fn gaps_and_defects() {
        let t0 = DAY + 3_600_000;
        let us = |ms: i64| ms * 1000;
        // rounds at t0-1s and t0+300s: the window's first 300 s are stale.
        let d = day(&[
            (us(t0 - 1000), Some(us(t0)), "1"),
            (us(t0 + 300_000), Some(us(t0 + 301_000)), "2"),
            (us(t0 + 600_000), Some(us(t0 + 601_000)), "3"),
            (us(t0 + 899_000), Some(us(t0 + 900_000)), "4"),
        ]);
        assert_eq!(
            worst_gap(&[t0 - 1000, t0 + 300_000], win(t0)),
            (600_000, t0 + 300_000)
        );
        let e = build_chainlink_series("btcusd", std::slice::from_ref(&d), win(t0), 0, 300_000)
            .unwrap_err();
        assert_eq!(e.cause, FeedCause::UpstreamHole);
        assert!(e.message.contains("maxGapMs 0") && e.message.contains("300000 ms"));
        assert!(
            build_chainlink_series("btcusd", std::slice::from_ref(&d), win(t0), 0, 300_001).is_ok()
        );
        assert!(build_chainlink_series("btcusd", std::slice::from_ref(&d), win(t0), 0, 0).is_ok());
        // No round before the window: the span runs from start.
        assert_eq!(worst_gap(&[t0 + 10], win(t0)), (899_990, t0 + 10));
        assert_eq!(worst_gap(&[], win(t0)), (900_000, t0));

        let empty = day(&[]);
        let e = build_chainlink_series("btcusd", &[empty], win(t0), 0, 0).unwrap_err();
        assert_eq!(e.cause, FeedCause::Corrupt);
        let null_bc = day(&[(us(t0), None, "1")]);
        let e = build_chainlink_series("btcusd", &[null_bc], win(t0), 0, 0).unwrap_err();
        assert!(e.message.contains("server_timestamp_us"));
        let bad_px = day(&[(us(t0), Some(us(t0)), "abc")]);
        assert!(build_chainlink_series("btcusd", &[bad_px], win(t0), 0, 0)
            .unwrap_err()
            .message
            .contains("price"));
        let foreign = Arc::new(ChainlinkDay::from_rows(
            UtcDay::of_ms(DAY),
            "btcusd",
            [(us(t0), Some(us(t0)), Some("1"), Some("ethusd"))],
        ));
        assert!(build_chainlink_series("btcusd", &[foreign], win(t0), 0, 0)
            .unwrap_err()
            .message
            .contains("asset_id"));
        // A defective row outside the series is not raised (F-25 covers the series).
        let far = day(&[
            (us(DAY + 10), None, "1"),
            (us(DAY + 20), Some(us(DAY + 21)), "1"),
            (us(t0), Some(us(t0)), "2"),
        ]);
        assert!(build_chainlink_series("btcusd", &[far], win(t0), 0, 0).is_ok());
    }
}
