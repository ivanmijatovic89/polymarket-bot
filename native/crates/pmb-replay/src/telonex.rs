//! Telonex `delta-typed` market Parquet → ordered market events.
//!
//! Mirrors TS `replayTelonexDeltaParquetForMarket`: one event per row in file
//! order, `book` and `price_change` only. A row is skipped (no event, no tick)
//! when its market is blank, `ts_exchange_ms` is null or negative, the event
//! type is unknown, a book's asset index does not resolve, or a price change
//! has no resolvable change. The row's asset index refers to the row's own
//! `asset0_id` / `asset1_id` columns (file order of first appearance, NOT
//! the UP/DOWN outcome order).
//!
//! Reading is column-wise per row group; asset ids are interned once.

use crate::pq::{self, Column};
use anyhow::{bail, ensure, Context, Result};
use parquet::data_type::{ByteArray, ByteArrayType, Int32Type, Int64Type};
use parquet::file::reader::FileReader;
use pmb_core::fixed::SCALE;
use pmb_core::fixed::{Price, Qty};
use pmb_core::market::{Level, MarketEvent, PriceChange};
use pmb_core::model::{AssetId, ConditionId, Side, TsMs};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// One replayed market event with its row timestamps.
#[derive(Clone, Debug, PartialEq)]
pub struct MarketRecord {
    pub event: MarketEvent,
    /// Exchange timestamp (`ts_exchange_ms`): the engine time of the tick.
    pub ts_ms: TsMs,
    /// Recorder receive time (`ts_local_ms`) when the row has one (> 0).
    pub local_ts_ms: Option<TsMs>,
    pub ingest_seq: i64,
}

impl MarketRecord {
    /// Clock for external-feed visibility (TS `feedClockMs`): the local
    /// receive time, clamped up to the exchange time; the exchange time when
    /// the row has no local time.
    pub fn feed_clock_ms(&self) -> TsMs {
        feed_clock_ms(self.ts_ms, self.local_ts_ms)
    }
}

/// TS `feedClockMs` for a real market tick.
pub fn feed_clock_ms(exchange_ms: TsMs, local_ms: Option<TsMs>) -> TsMs {
    match local_ms {
        Some(local) if local > 0 => local.max(exchange_ms),
        _ => exchange_ms,
    }
}

/// All market events of one file, in replay order.
#[derive(Clone, Debug, Default)]
pub struct MarketTape {
    pub path: PathBuf,
    /// Condition id from the `market` column.
    pub market: Option<ConditionId>,
    /// Distinct asset ids in order of first appearance in the file.
    pub file_assets: Vec<AssetId>,
    pub records: Vec<MarketRecord>,
    /// Parquet rows read.
    pub rows: usize,
}

impl MarketTape {
    /// Rows that produced no event.
    pub fn skipped_rows(&self) -> usize {
        self.rows - self.records.len()
    }
}

const COLUMNS: [&str; 16] = [
    "ingest_seq",
    "ts_local_ms",
    "ts_exchange_ms",
    "event_type",
    "market",
    "asset0_id",
    "asset1_id",
    "asset_index",
    "bid_prices",
    "bid_sizes",
    "ask_prices",
    "ask_sizes",
    "change_asset_indexes",
    "change_side_codes",
    "change_prices",
    "change_sizes",
];

/// Decoded columns of one row group (buffers reused across row groups).
struct Batch {
    ingest_seq: Column<i64>,
    ts_local: Column<i64>,
    ts_exchange: Column<i64>,
    event_type: Column<ByteArray>,
    market: Column<ByteArray>,
    asset0: Column<ByteArray>,
    asset1: Column<ByteArray>,
    asset_index: Column<i32>,
    bid_prices: Column<ByteArray>,
    bid_sizes: Column<ByteArray>,
    ask_prices: Column<ByteArray>,
    ask_sizes: Column<ByteArray>,
    change_assets: Column<i32>,
    change_sides: Column<i32>,
    change_prices: Column<ByteArray>,
    change_sizes: Column<ByteArray>,
}

impl Batch {
    fn new() -> Self {
        Self {
            ingest_seq: Column::new(),
            ts_local: Column::new(),
            ts_exchange: Column::new(),
            event_type: Column::new(),
            market: Column::new(),
            asset0: Column::new(),
            asset1: Column::new(),
            asset_index: Column::new(),
            bid_prices: Column::new(),
            bid_sizes: Column::new(),
            ask_prices: Column::new(),
            ask_sizes: Column::new(),
            change_assets: Column::new(),
            change_sides: Column::new(),
            change_prices: Column::new(),
            change_sizes: Column::new(),
        }
    }

    fn read(
        &mut self,
        rg: &dyn parquet::file::reader::RowGroupReader,
        cols: &[usize; 16],
        rows: usize,
    ) -> Result<()> {
        self.ingest_seq.read::<Int64Type>(rg, cols[0], rows)?;
        self.ts_local.read::<Int64Type>(rg, cols[1], rows)?;
        self.ts_exchange.read::<Int64Type>(rg, cols[2], rows)?;
        self.event_type.read::<ByteArrayType>(rg, cols[3], rows)?;
        self.market.read::<ByteArrayType>(rg, cols[4], rows)?;
        self.asset0.read::<ByteArrayType>(rg, cols[5], rows)?;
        self.asset1.read::<ByteArrayType>(rg, cols[6], rows)?;
        self.asset_index.read::<Int32Type>(rg, cols[7], rows)?;
        self.bid_prices.read::<ByteArrayType>(rg, cols[8], rows)?;
        self.bid_sizes.read::<ByteArrayType>(rg, cols[9], rows)?;
        self.ask_prices.read::<ByteArrayType>(rg, cols[10], rows)?;
        self.ask_sizes.read::<ByteArrayType>(rg, cols[11], rows)?;
        self.change_assets.read::<Int32Type>(rg, cols[12], rows)?;
        self.change_sides.read::<Int32Type>(rg, cols[13], rows)?;
        self.change_prices.read::<ByteArrayType>(rg, cols[14], rows)?;
        self.change_sizes.read::<ByteArrayType>(rg, cols[15], rows)?;
        Ok(())
    }
}

/// Interns asset ids (≤ 2 per market) and checks them against the job's assets.
struct Assets<'a> {
    expected: Option<&'a [AssetId; 2]>,
    seen: Vec<AssetId>,
}

impl Assets<'_> {
    fn intern(&mut self, bytes: &[u8]) -> Result<AssetId> {
        if let Some(a) = self.seen.iter().find(|a| a.as_str().as_bytes() == bytes) {
            return Ok(a.clone());
        }
        let s = std::str::from_utf8(bytes).context("asset id is not UTF-8")?;
        let id = match self.expected {
            Some(expected) => match expected.iter().find(|a| a.as_str() == s) {
                Some(a) => a.clone(),
                None => bail!(
                    "asset {s} is not one of the market's assets [{}, {}]",
                    expected[0].as_str(),
                    expected[1].as_str()
                ),
            },
            None => AssetId(Arc::from(s)),
        };
        self.seen.push(id.clone());
        Ok(id)
    }

    /// Asset of the row's `asset{index}_id` column (TS `assetIdForIndex`).
    fn for_index(&mut self, b: &Batch, r: usize, index: i32) -> Result<Option<AssetId>> {
        let col = match index {
            0 => &b.asset0,
            1 => &b.asset1,
            _ => return Ok(None),
        };
        match col.get(r).map(ByteArray::data) {
            Some(bytes) if !is_blank(bytes) => self.intern(bytes).map(Some),
            _ => Ok(None),
        }
    }
}

fn is_blank(b: &[u8]) -> bool {
    b.iter().all(u8::is_ascii_whitespace)
}

/// Reads a whole `delta-typed` file. With `expected_assets`, every asset in
/// the file must be one of them (the returned events share those `AssetId`s).
pub fn read_telonex_delta(
    path: &Path,
    expected_assets: Option<&[AssetId; 2]>,
) -> Result<MarketTape> {
    let reader = pq::open(path)?;
    let mut cols = [0usize; 16];
    for (slot, name) in cols.iter_mut().zip(COLUMNS) {
        *slot = pq::require_column(&reader, path, name)?;
    }
    let total_rows = usize::try_from(reader.metadata().file_metadata().num_rows())?;
    let mut tape = MarketTape {
        path: path.to_path_buf(),
        records: Vec::with_capacity(total_rows),
        ..MarketTape::default()
    };
    let mut assets = Assets {
        expected: expected_assets,
        seen: Vec::new(),
    };
    let mut batch = Batch::new();
    for g in 0..reader.num_row_groups() {
        let rows = usize::try_from(reader.metadata().row_group(g).num_rows())?;
        let rg = reader.get_row_group(g)?;
        batch
            .read(rg.as_ref(), &cols, rows)
            .with_context(|| format!("{}: row group {g}", path.display()))?;
        for r in 0..rows {
            let row = tape.rows + r;
            decode_row(&batch, r, &mut assets, &mut tape)
                .with_context(|| format!("{}: row {row}", path.display()))?;
        }
        tape.rows += rows;
    }
    tape.file_assets = assets.seen;
    Ok(tape)
}

fn decode_row(b: &Batch, r: usize, assets: &mut Assets<'_>, tape: &mut MarketTape) -> Result<()> {
    let Some(market) = b.market.get(r).map(ByteArray::data).filter(|m| !is_blank(m)) else {
        return Ok(());
    };
    let Some(&ts_ms) = b.ts_exchange.get(r).filter(|&&t| t >= 0) else {
        return Ok(());
    };
    let event = match b.event_type.get(r).map(ByteArray::data) {
        Some(b"book") => {
            let index = b.asset_index.get(r).copied().unwrap_or(-1);
            let Some(asset_id) = assets.for_index(b, r, index)? else {
                return Ok(());
            };
            MarketEvent::Book {
                asset_id,
                ts_ms,
                bids: levels(b.bid_prices.row(r), b.bid_sizes.row(r))?,
                asks: levels(b.ask_prices.row(r), b.ask_sizes.row(r))?,
            }
        }
        Some(b"price_change") => {
            let (idx, sides) = (b.change_assets.row(r), b.change_sides.row(r));
            let (prices, sizes) = (b.change_prices.row(r), b.change_sizes.row(r));
            let n = idx.len().min(sides.len()).min(prices.len()).min(sizes.len());
            let mut changes = Vec::with_capacity(n);
            for i in 0..n {
                let side = match sides[i] {
                    0 => Side::Buy,
                    1 => Side::Sell,
                    _ => continue,
                };
                let Some(asset_id) = assets.for_index(b, r, idx[i])? else {
                    continue;
                };
                changes.push(PriceChange {
                    asset_id,
                    side,
                    price: Price(decimal(prices[i].data(), "change price")?),
                    size: Qty(decimal(sizes[i].data(), "change size")?),
                });
            }
            if changes.is_empty() {
                return Ok(());
            }
            MarketEvent::PriceChange { ts_ms, changes }
        }
        _ => return Ok(()),
    };
    match &tape.market {
        Some(m) => ensure!(
            m.0.as_bytes() == market,
            "market mismatch: expected={} got={}",
            m.0,
            String::from_utf8_lossy(market)
        ),
        None => {
            let s = std::str::from_utf8(market).context("market is not UTF-8")?;
            tape.market = Some(ConditionId(Arc::from(s)));
        }
    }
    let local = b.ts_local.get(r).copied().unwrap_or(0);
    tape.records.push(MarketRecord {
        event,
        ts_ms,
        local_ts_ms: (local > 0).then_some(local),
        ingest_seq: b.ingest_seq.get(r).copied().unwrap_or(0),
    });
    Ok(())
}

fn levels(prices: &[ByteArray], sizes: &[ByteArray]) -> Result<Vec<Level>> {
    prices
        .iter()
        .zip(sizes)
        .map(|(p, s)| {
            Ok(Level {
                price: Price(decimal(p.data(), "book price")?),
                size: Qty(decimal(s.data(), "book size")?),
            })
        })
        .collect()
}

/// Decimal string → micro units. Fast path for plain decimals; anything else
/// (exponent notation, whitespace) goes through `f64` parsing.
fn decimal(bytes: &[u8], what: &str) -> Result<i64> {
    if let Some(v) = parse_plain_decimal(bytes) {
        return Ok(v);
    }
    let s = std::str::from_utf8(bytes).ok().map(str::trim);
    match s.and_then(|s| s.parse::<f64>().ok()).filter(|v| v.is_finite()) {
        Some(v) => Ok((v * SCALE as f64).round() as i64),
        None => bail!("invalid {what}: {:?}", String::from_utf8_lossy(bytes)),
    }
}

/// `[-]digits[.digits]` → micro units, rounding half up past 6 decimals.
fn parse_plain_decimal(b: &[u8]) -> Option<i64> {
    let (neg, b) = match b.split_first() {
        Some((b'-', rest)) => (true, rest),
        _ => (false, b),
    };
    let mut i = 0;
    let mut int: i64 = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        int = int.checked_mul(10)?.checked_add(i64::from(b[i] - b'0'))?;
        i += 1;
    }
    let mut digits = i;
    let mut frac: i64 = 0;
    let mut frac_digits = 0;
    let mut round_up = false;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            let d = i64::from(b[i] - b'0');
            if frac_digits < 6 {
                frac = frac * 10 + d;
                frac_digits += 1;
            } else if frac_digits == 6 {
                round_up = d >= 5;
                frac_digits += 1;
            }
            digits += 1;
            i += 1;
        }
    }
    if i != b.len() || digits == 0 {
        return None;
    }
    for _ in frac_digits.min(6)..6 {
        frac *= 10;
    }
    let v = int
        .checked_mul(SCALE)?
        .checked_add(frac + i64::from(round_up))?;
    Some(if neg { -v } else { v })
}

#[cfg(test)]
mod tests {
    use super::*;
    use parquet::file::properties::WriterProperties;
    use parquet::file::writer::SerializedFileWriter;
    use parquet::schema::parser::parse_message_type;
    use std::fs::File;

    #[test]
    fn decimals() {
        assert_eq!(parse_plain_decimal(b"0.01"), Some(10_000));
        assert_eq!(parse_plain_decimal(b"302"), Some(302_000_000));
        assert_eq!(parse_plain_decimal(b"12.5"), Some(12_500_000));
        assert_eq!(parse_plain_decimal(b".5"), Some(500_000));
        assert_eq!(parse_plain_decimal(b"5."), Some(5_000_000));
        assert_eq!(parse_plain_decimal(b"-0.25"), Some(-250_000));
        assert_eq!(parse_plain_decimal(b"0.0000015"), Some(2));
        assert_eq!(parse_plain_decimal(b"0.0000014999"), Some(1));
        assert_eq!(parse_plain_decimal(b""), None);
        assert_eq!(parse_plain_decimal(b"."), None);
        assert_eq!(parse_plain_decimal(b"1e-3"), None);
        assert_eq!(decimal(b"1e-3", "x").unwrap(), 1_000);
        assert_eq!(decimal(b" 2 ", "x").unwrap(), 2_000_000);
        assert!(decimal(b"abc", "x").is_err());
        assert!(decimal(b"NaN", "x").is_err());
    }

    pub(crate) struct Row<'a> {
        pub seq: i64,
        pub local: i64,
        pub exchange: Option<i64>,
        pub event: &'a str,
        pub market: &'a str,
        pub a0: Option<&'a str>,
        pub a1: Option<&'a str>,
        pub asset_index: Option<i32>,
        pub bids: Vec<(&'a str, &'a str)>,
        pub asks: Vec<(&'a str, &'a str)>,
        pub changes: Vec<(i32, i32, &'a str, &'a str)>,
    }

    impl Default for Row<'_> {
        fn default() -> Self {
            Row {
                seq: 0,
                local: 0,
                exchange: Some(0),
                event: "price_change",
                market: "0xmarket",
                a0: Some("A"),
                a1: Some("B"),
                asset_index: None,
                bids: vec![],
                asks: vec![],
                changes: vec![],
            }
        }
    }

    /// Writes a delta-typed file with the converter's schema (parquetjs shape).
    pub(crate) fn write_delta_file(path: &Path, rows: &[Row<'_>]) {
        let schema = parse_message_type(
            "message root {
                REQUIRED INT64 ingest_seq;
                REQUIRED INT64 ts_local_ms;
                OPTIONAL INT64 ts_exchange_ms;
                REQUIRED BINARY event_type (UTF8);
                REQUIRED BINARY market (UTF8);
                OPTIONAL BINARY asset0_id (UTF8);
                OPTIONAL BINARY asset1_id (UTF8);
                OPTIONAL INT32 asset_index;
                REPEATED BINARY bid_prices (UTF8);
                REPEATED BINARY bid_sizes (UTF8);
                REPEATED BINARY ask_prices (UTF8);
                REPEATED BINARY ask_sizes (UTF8);
                REPEATED INT32 change_asset_indexes;
                REPEATED INT32 change_side_codes;
                REPEATED BINARY change_prices (UTF8);
                REPEATED BINARY change_sizes (UTF8);
            }",
        )
        .unwrap();
        let props = Arc::new(WriterProperties::builder().build());
        let mut w =
            SerializedFileWriter::new(File::create(path).unwrap(), Arc::new(schema), props)
                .unwrap();
        // Two row groups to exercise buffer reuse.
        for chunk in rows.chunks(rows.len().div_ceil(2).max(1)) {
            let mut rg = w.next_row_group().unwrap();
            let mut col = 0;
            while let Some(mut c) = rg.next_column().unwrap() {
                write_col(&mut c, col, chunk);
                c.close().unwrap();
                col += 1;
            }
            rg.close().unwrap();
        }
        w.close().unwrap();
    }

    fn write_col(c: &mut parquet::file::writer::SerializedColumnWriter<'_>, col: usize, rows: &[Row<'_>]) {
        use parquet::data_type::{ByteArrayType as B, Int32Type as I32, Int64Type as I64};
        let ba = |s: &str| ByteArray::from(s);
        let opt = |v: Vec<Option<ByteArray>>| -> (Vec<ByteArray>, Vec<i16>) {
            let def = v.iter().map(|x| i16::from(x.is_some())).collect();
            (v.into_iter().flatten().collect(), def)
        };
        // (values, def, rep) for a repeated column
        fn rep<T>(lists: Vec<Vec<T>>) -> (Vec<T>, Vec<i16>, Vec<i16>) {
            let (mut vals, mut def, mut reps) = (vec![], vec![], vec![]);
            for l in lists {
                if l.is_empty() {
                    def.push(0);
                    reps.push(0);
                }
                for (i, v) in l.into_iter().enumerate() {
                    vals.push(v);
                    def.push(1);
                    reps.push(i16::from(i > 0));
                }
            }
            (vals, def, reps)
        }
        match col {
            0 => {
                let v: Vec<i64> = rows.iter().map(|r| r.seq).collect();
                c.typed::<I64>().write_batch(&v, None, None).unwrap();
            }
            1 => {
                let v: Vec<i64> = rows.iter().map(|r| r.local).collect();
                c.typed::<I64>().write_batch(&v, None, None).unwrap();
            }
            2 => {
                let def: Vec<i16> = rows.iter().map(|r| i16::from(r.exchange.is_some())).collect();
                let v: Vec<i64> = rows.iter().filter_map(|r| r.exchange).collect();
                c.typed::<I64>().write_batch(&v, Some(&def), None).unwrap();
            }
            3 | 4 => {
                let v: Vec<ByteArray> = rows
                    .iter()
                    .map(|r| ba(if col == 3 { r.event } else { r.market }))
                    .collect();
                c.typed::<B>().write_batch(&v, None, None).unwrap();
            }
            5 | 6 => {
                let (v, def) = opt(rows
                    .iter()
                    .map(|r| (if col == 5 { r.a0 } else { r.a1 }).map(ba))
                    .collect());
                c.typed::<B>().write_batch(&v, Some(&def), None).unwrap();
            }
            7 => {
                let def: Vec<i16> = rows.iter().map(|r| i16::from(r.asset_index.is_some())).collect();
                let v: Vec<i32> = rows.iter().filter_map(|r| r.asset_index).collect();
                c.typed::<I32>().write_batch(&v, Some(&def), None).unwrap();
            }
            8..=11 => {
                let (v, d, rp) = rep(rows
                    .iter()
                    .map(|r| {
                        let side = if col < 10 { &r.bids } else { &r.asks };
                        side.iter()
                            .map(|(p, s)| ba(if col % 2 == 0 { p } else { s }))
                            .collect()
                    })
                    .collect());
                c.typed::<B>().write_batch(&v, Some(&d), Some(&rp)).unwrap();
            }
            12 | 13 => {
                let (v, d, rp) = rep(rows
                    .iter()
                    .map(|r| r.changes.iter().map(|ch| if col == 12 { ch.0 } else { ch.1 }).collect())
                    .collect());
                c.typed::<I32>().write_batch(&v, Some(&d), Some(&rp)).unwrap();
            }
            _ => {
                let (v, d, rp) = rep(rows
                    .iter()
                    .map(|r| r.changes.iter().map(|ch| ba(if col == 14 { ch.2 } else { ch.3 })).collect())
                    .collect());
                c.typed::<B>().write_batch(&v, Some(&d), Some(&rp)).unwrap();
            }
        }
    }

    pub(crate) fn temp_path(name: &str) -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!("pmb-replay-{}-{n}-{name}", std::process::id()))
    }

    #[test]
    fn reads_rows_in_file_order_with_ts_semantics() {
        let path = temp_path("delta.parquet");
        let rows = vec![
            Row {
                seq: 1,
                local: 105,
                exchange: Some(100),
                event: "book",
                a1: None,
                asset_index: Some(0),
                bids: vec![("0.40", "10"), ("0.41", "2.5")],
                asks: vec![("0.60", "3")],
                ..Row::default()
            },
            Row {
                seq: 2,
                local: 0,
                exchange: Some(101),
                event: "book",
                asset_index: Some(1),
                ..Row::default()
            },
            // null exchange ts → skipped
            Row {
                seq: 3,
                exchange: None,
                changes: vec![(0, 0, "0.4", "1")],
                ..Row::default()
            },
            // unknown asset index / side code are dropped; row kept
            Row {
                seq: 4,
                local: 99,
                exchange: Some(102),
                changes: vec![(0, 0, "0.40", "0"), (2, 0, "0.1", "1"), (1, 5, "0.5", "1"), (1, 1, "0.55", "7")],
                ..Row::default()
            },
            // no valid change → skipped
            Row {
                seq: 5,
                exchange: Some(103),
                changes: vec![(3, 0, "0.1", "1")],
                ..Row::default()
            },
            // unknown event type → skipped
            Row {
                seq: 6,
                exchange: Some(104),
                event: "tick_size_change",
                ..Row::default()
            },
            // blank market → skipped
            Row {
                seq: 7,
                exchange: Some(105),
                market: " ",
                changes: vec![(0, 0, "0.4", "1")],
                ..Row::default()
            },
            // book with asset index whose column is absent → skipped
            Row {
                seq: 8,
                exchange: Some(106),
                event: "book",
                a1: None,
                asset_index: Some(1),
                ..Row::default()
            },
        ];
        write_delta_file(&path, &rows);
        let tape = read_telonex_delta(&path, None).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tape.rows, 8);
        assert_eq!(tape.skipped_rows(), 5);
        assert_eq!(tape.market.as_ref().unwrap().0.as_ref(), "0xmarket");
        assert_eq!(
            tape.file_assets,
            vec![AssetId::new("A"), AssetId::new("B")]
        );
        let seqs: Vec<i64> = tape.records.iter().map(|r| r.ingest_seq).collect();
        assert_eq!(seqs, vec![1, 2, 4]);
        let r0 = &tape.records[0];
        assert_eq!((r0.ts_ms, r0.local_ts_ms, r0.feed_clock_ms()), (100, Some(105), 105));
        match &r0.event {
            MarketEvent::Book { asset_id, bids, asks, .. } => {
                assert_eq!(asset_id.as_str(), "A");
                assert_eq!(bids.len(), 2);
                assert_eq!(bids[1].size, Qty(2_500_000));
                assert_eq!(asks[0].price, Price(600_000));
            }
            e => panic!("{e:?}"),
        }
        assert_eq!(tape.records[1].local_ts_ms, None);
        assert_eq!(tape.records[1].feed_clock_ms(), 101);
        let r2 = &tape.records[2];
        // local clock behind exchange clock is clamped up
        assert_eq!((r2.local_ts_ms, r2.feed_clock_ms()), (Some(99), 102));
        match &r2.event {
            MarketEvent::PriceChange { changes, ts_ms } => {
                assert_eq!(*ts_ms, 102);
                assert_eq!(changes.len(), 2);
                assert_eq!(changes[0].asset_id.as_str(), "A");
                assert_eq!(changes[0].size, Qty::ZERO);
                assert_eq!((changes[1].asset_id.as_str(), changes[1].side), ("B", Side::Sell));
            }
            e => panic!("{e:?}"),
        }
        // interned: events share the same allocation
        if let (MarketEvent::Book { asset_id: a, .. }, MarketEvent::PriceChange { changes, .. }) =
            (&tape.records[0].event, &tape.records[2].event)
        {
            assert!(Arc::ptr_eq(&a.0, &changes[0].asset_id.0));
        }
    }

    #[test]
    fn validates_expected_assets_and_market() {
        let path = temp_path("assets.parquet");
        write_delta_file(
            &path,
            &[Row {
                exchange: Some(1),
                changes: vec![(0, 0, "0.4", "1")],
                ..Row::default()
            }],
        );
        let ok = [AssetId::new("B"), AssetId::new("A")];
        let tape = read_telonex_delta(&path, Some(&ok)).unwrap();
        match &tape.records[0].event {
            MarketEvent::PriceChange { changes, .. } => assert!(Arc::ptr_eq(&changes[0].asset_id.0, &ok[1].0)),
            e => panic!("{e:?}"),
        }
        let bad = [AssetId::new("X"), AssetId::new("Y")];
        let err = read_telonex_delta(&path, Some(&bad)).unwrap_err();
        assert!(format!("{err:#}").contains("not one of the market's assets"));
        std::fs::remove_file(&path).ok();

        let path = temp_path("market.parquet");
        write_delta_file(
            &path,
            &[
                Row {
                    exchange: Some(1),
                    changes: vec![(0, 0, "0.4", "1")],
                    ..Row::default()
                },
                Row {
                    exchange: Some(2),
                    market: "0xother",
                    changes: vec![(0, 0, "0.4", "1")],
                    ..Row::default()
                },
            ],
        );
        let err = read_telonex_delta(&path, None).unwrap_err();
        assert!(format!("{err:#}").contains("market mismatch"));
        std::fs::remove_file(&path).ok();
    }
}
