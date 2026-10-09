//! Unit tests of the tape (16 §7.5): v1 → typed rows → tape → typed rows
//! round trips, the reader stream on both paths (NT-6 b), the fallback rules
//! (NT-5), the writer (NT-4) and the disk budget (NT-7).
//!
//! Scratch files go under `native/target/tmp/pmb-tape-unit/` (inside the
//! checkout) and are removed when each test ends. The committed fixture is regenerated with
//! `cargo test -p pmb-tape -- --ignored regenerate_fixture` on a host that has
//! the dataset.

use crate::codec::{self, col, Decoder, EncodeOptions, TapeError, V1Identity};
use crate::compare::{digest, first_difference};
use crate::store::{
    self, convert_one, load_tape, stat_identity, Budget, ConvertOptions, ConvertOutcome, Fallback,
    Stop,
};
use crate::typed::{Unconvertible, DICT_CAP};
use crate::v1::{read_v1, Batch};
use crate::{read_market, replay, InputPath, MarketStream};
use bytes::Bytes;
use parquet::basic::{Compression, GzipLevel};
use parquet::column::writer::ColumnWriter;
use parquet::data_type::ByteArray;
use parquet::file::properties::WriterProperties;
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::file::writer::SerializedFileWriter;
use parquet::schema::parser::parse_message_type;
use pmb_replay::{read_telonex_delta, TelonexInput};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

const UP: &str = "1111";
const DOWN: &str = "2222";
const MARKET: &str = "0xmarket";

const V1_MESSAGE: &str = "message schema {
  required int64 ingest_seq;
  required int64 ts_local_ms;
  optional int64 ts_exchange_ms;
  required binary event_type (UTF8);
  required binary market (UTF8);
  optional binary asset0_id (UTF8);
  optional binary asset1_id (UTF8);
  optional int32 asset_index;
  repeated binary bid_prices (UTF8);
  repeated binary bid_sizes (UTF8);
  repeated binary ask_prices (UTF8);
  repeated binary ask_sizes (UTF8);
  repeated int32 change_asset_indexes;
  repeated int32 change_side_codes;
  repeated binary change_prices (UTF8);
  repeated binary change_sizes (UTF8);
}";

/// One v1 row with its raw strings.
#[derive(Clone, Debug, Default)]
pub(crate) struct RawRow {
    pub ingest_seq: i64,
    pub ts_local: i64,
    pub ts_exchange: Option<i64>,
    pub event_type: String,
    pub market: String,
    pub asset0: Option<String>,
    pub asset1: Option<String>,
    pub asset_index: Option<i32>,
    pub bid_prices: Vec<String>,
    pub bid_sizes: Vec<String>,
    pub ask_prices: Vec<String>,
    pub ask_sizes: Vec<String>,
    pub change_assets: Vec<i32>,
    pub change_sides: Vec<i32>,
    pub change_prices: Vec<String>,
    pub change_sizes: Vec<String>,
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn base(seq: i64, ts: i64) -> RawRow {
    RawRow {
        ingest_seq: seq,
        ts_local: ts + 5,
        ts_exchange: Some(ts),
        market: MARKET.into(),
        asset0: Some(UP.into()),
        asset1: Some(DOWN.into()),
        ..RawRow::default()
    }
}

fn book(seq: i64, ts: i64, idx: i32, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> RawRow {
    RawRow {
        event_type: "book".into(),
        asset_index: Some(idx),
        bid_prices: bids.iter().map(|l| l.0.to_string()).collect(),
        bid_sizes: bids.iter().map(|l| l.1.to_string()).collect(),
        ask_prices: asks.iter().map(|l| l.0.to_string()).collect(),
        ask_sizes: asks.iter().map(|l| l.1.to_string()).collect(),
        ..base(seq, ts)
    }
}

fn change(seq: i64, ts: i64, changes: &[(i32, i32, &str, &str)]) -> RawRow {
    RawRow {
        event_type: "price_change".into(),
        change_assets: changes.iter().map(|c| c.0).collect(),
        change_sides: changes.iter().map(|c| c.1).collect(),
        change_prices: changes.iter().map(|c| c.2.to_string()).collect(),
        change_sizes: changes.iter().map(|c| c.3.to_string()).collect(),
        ..base(seq, ts)
    }
}

fn opt_levels<T: Clone>(rows: &[RawRow], f: impl Fn(&RawRow) -> Option<T>) -> (Vec<T>, Vec<i16>) {
    let mut vals = Vec::new();
    let mut def = Vec::new();
    for r in rows {
        match f(r) {
            Some(v) => {
                vals.push(v);
                def.push(1);
            }
            None => def.push(0),
        }
    }
    (vals, def)
}

fn rep_levels<T: Clone>(
    rows: &[RawRow],
    f: impl Fn(&RawRow) -> Vec<T>,
) -> (Vec<T>, Vec<i16>, Vec<i16>) {
    let (mut vals, mut def, mut rep) = (Vec::new(), Vec::new(), Vec::new());
    for r in rows {
        let v = f(r);
        if v.is_empty() {
            def.push(0);
            rep.push(0);
        }
        for (j, x) in v.into_iter().enumerate() {
            vals.push(x);
            def.push(1);
            rep.push(if j == 0 { 0 } else { 1 });
        }
    }
    (vals, def, rep)
}

fn ba(s: &str) -> ByteArray {
    ByteArray::from(s.as_bytes().to_vec())
}

/// Writes a version-1 telonex-delta file (GZIP, `rows_per_group` rows per group).
pub(crate) fn write_v1(path: &Path, rows: &[RawRow], rows_per_group: usize) {
    write_v1_with(
        path,
        rows,
        rows_per_group,
        Compression::GZIP(GzipLevel::default()),
    )
}

/// [`write_v1`] with another codec (the reader does not depend on it; the
/// generated corpus skips GZIP, which is slow in debug builds).
pub(crate) fn write_v1_with(
    path: &Path,
    rows: &[RawRow],
    rows_per_group: usize,
    compression: Compression,
) {
    let schema = Arc::new(parse_message_type(V1_MESSAGE).unwrap());
    let props = Arc::new(
        WriterProperties::builder()
            .set_compression(compression)
            .build(),
    );
    let file = std::fs::File::create(path).unwrap();
    let mut w = SerializedFileWriter::new(file, schema, props).unwrap();
    for chunk in rows.chunks(rows_per_group.max(1)) {
        let mut rg = w.next_row_group().unwrap();
        let mut idx = 0;
        while let Some(mut c) = rg.next_column().unwrap() {
            match c.untyped() {
                ColumnWriter::Int64ColumnWriter(cw) => {
                    if idx == 2 {
                        let (v, d) = opt_levels(chunk, |r| r.ts_exchange);
                        cw.write_batch(&v, Some(&d), None).unwrap();
                    } else {
                        let v: Vec<i64> = chunk
                            .iter()
                            .map(|r| if idx == 0 { r.ingest_seq } else { r.ts_local })
                            .collect();
                        cw.write_batch(&v, None, None).unwrap();
                    }
                }
                ColumnWriter::Int32ColumnWriter(cw) => match idx {
                    7 => {
                        let (v, d) = opt_levels(chunk, |r| r.asset_index);
                        cw.write_batch(&v, Some(&d), None).unwrap();
                    }
                    12 | 13 => {
                        let (v, d, rp) = rep_levels(chunk, |r| {
                            if idx == 12 {
                                r.change_assets.clone()
                            } else {
                                r.change_sides.clone()
                            }
                        });
                        cw.write_batch(&v, Some(&d), Some(&rp)).unwrap();
                    }
                    _ => unreachable!(),
                },
                ColumnWriter::ByteArrayColumnWriter(cw) => match idx {
                    3 | 4 => {
                        let v: Vec<ByteArray> = chunk
                            .iter()
                            .map(|r| ba(if idx == 3 { &r.event_type } else { &r.market }))
                            .collect();
                        cw.write_batch(&v, None, None).unwrap();
                    }
                    5 | 6 => {
                        let (v, d) = opt_levels(chunk, |r| {
                            if idx == 5 { &r.asset0 } else { &r.asset1 }
                                .as_deref()
                                .map(ba)
                        });
                        cw.write_batch(&v, Some(&d), None).unwrap();
                    }
                    8..=11 | 14 | 15 => {
                        let (v, d, rp) = rep_levels(chunk, |r| {
                            let l = match idx {
                                8 => &r.bid_prices,
                                9 => &r.bid_sizes,
                                10 => &r.ask_prices,
                                11 => &r.ask_sizes,
                                14 => &r.change_prices,
                                _ => &r.change_sizes,
                            };
                            l.iter().map(|s| ba(s)).collect()
                        });
                        cw.write_batch(&v, Some(&d), Some(&rp)).unwrap();
                    }
                    _ => unreachable!(),
                },
                _ => unreachable!(),
            }
            c.close().unwrap();
            idx += 1;
        }
        rg.close().unwrap();
    }
    w.close().unwrap();
}

/// Reads a v1 file back into raw rows (fixture generator).
fn read_raw(path: &Path) -> Vec<RawRow> {
    let data = Bytes::from(std::fs::read(path).unwrap());
    let reader = SerializedFileReader::new(data).unwrap();
    let mut b = Batch::new();
    let mut out = Vec::new();
    let s = |v: &ByteArray| String::from_utf8(v.data().to_vec()).unwrap();
    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g).unwrap();
        let n = rg.metadata().num_rows() as usize;
        b.read(rg.as_ref(), n).unwrap();
        for r in 0..n {
            let dl = |k: usize| b.decimals[k].row(r).iter().map(s).collect::<Vec<_>>();
            out.push(RawRow {
                ingest_seq: *b.ingest_seq.get(r).unwrap(),
                ts_local: *b.ts_local.get(r).unwrap(),
                ts_exchange: b.ts_exchange.get(r).copied(),
                event_type: s(b.event_type.get(r).unwrap()),
                market: s(b.market.get(r).unwrap()),
                asset0: b.asset0.get(r).map(s),
                asset1: b.asset1.get(r).map(s),
                asset_index: b.asset_index.get(r).copied(),
                bid_prices: dl(0),
                bid_sizes: dl(1),
                ask_prices: dl(2),
                ask_sizes: dl(3),
                change_assets: b.ints[0].row(r).to_vec(),
                change_sides: b.ints[1].row(r).to_vec(),
                change_prices: dl(4),
                change_sizes: dl(5),
            });
        }
    }
    out
}

static SEQ: AtomicU32 = AtomicU32::new(0);

/// A scratch directory inside the checkout's target dir, removed on drop.
pub(crate) struct Scratch(PathBuf);

impl std::ops::Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A fresh scratch directory inside the checkout's target dir.
fn scratch(name: &str) -> Scratch {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/tmp/pmb-tape-unit")
        .join(format!(
            "{name}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    Scratch(dir)
}

fn key(slug: &str) -> store::MarketKey<'_> {
    store::MarketKey {
        format: "telonex-delta-typed",
        format_version: 1,
        symbol: "btc",
        timeframe: "15m",
        slug,
    }
}

/// The tape root of a tape at its derived path.
fn root_of(tape: &Path) -> PathBuf {
    tape.ancestors().nth(5).unwrap().to_path_buf()
}

fn input() -> TelonexInput<'static> {
    TelonexInput {
        format_version: 1,
        tokens: [UP, DOWN],
        condition_id: None,
    }
}

fn opts() -> ConvertOptions {
    ConvertOptions {
        encode: EncodeOptions {
            block_rows: 7,
            zstd_level: 3,
        },
        tool_sha256: [7; 32],
    }
}

fn budget(root: &Path) -> Budget {
    Budget::new(root, u64::MAX, 0).unwrap()
}

fn identity(path: &Path) -> V1Identity {
    let (bytes, mtime_ns) = stat_identity(path).unwrap();
    V1Identity {
        bytes,
        mtime_ns,
        sha256: store::sha256(&std::fs::read(path).unwrap()),
    }
}

/// Every reader rule in a few rows: skips, drops, nulls, anomalies, flags.
fn synthetic_rows() -> Vec<RawRow> {
    let mut rows = vec![
        book(
            1,
            1000,
            0,
            &[("0.50", "100"), ("0.49", "20.5")],
            &[("0.51", "7")],
        ),
        book(
            2,
            1000,
            1,
            &[("0.48", "3")],
            &[("0.52", "1e2"), ("0.53", "0.1234567")],
        ),
        change(
            3,
            1001,
            &[(0, 0, "0.50", "0"), (1, 1, "0.52", "12.0000005")],
        ),
        // Dropped changes: bad side code, unresolved asset index; one kept.
        change(
            4,
            1002,
            &[(0, 2, "0.5", "1"), (3, 0, "0.5", "1"), (1, 0, "0.47", "9")],
        ),
        // Every change dropped → empty price change, skipped.
        change(5, 1003, &[(0, 7, "0.5", "1")]),
        // Large and negative values, exponents (width 8, no common scale).
        change(
            7,
            1005,
            &[
                (0, 1, "0.999999", "123456789012.345678"),
                (1, 0, "1E-6", "-5"),
            ],
        ),
    ];
    // Unequal list lengths: only the paired prefix is read.
    let mut r = book(6, 1004, 0, &[("0.40", "1"), ("0.39", "2")], &[("0.6", "1")]);
    r.bid_prices.push("0.38".into());
    r.ask_sizes.push("3".into());
    rows.push(r);
    let mut r = book(8, 1006, 0, &[], &[]);
    r.market = "   ".into(); // blank market → skipped
    rows.push(r);
    let mut r = book(9, 1007, 0, &[("0.1", "1")], &[]);
    r.ts_exchange = None; // null exchange time → skipped
    rows.push(r);
    rows.push(book(10, -1, 0, &[("0.1", "1")], &[])); // negative exchange time
    let mut r = book(11, 1008, 0, &[("0.1", "1")], &[]);
    r.asset_index = None; // unresolved book asset (null index)
    rows.push(r);
    rows.push(book(12, 1009, 5, &[("0.1", "1")], &[])); // unresolved index 5
    let mut r = book(13, 1010, 0, &[("0.2", "1")], &[]);
    r.asset1 = Some(format!("  {DOWN} ")); // whitespace-padded id
    rows.push(r);
    let mut r = book(13, 1011, 1, &[("0.2", "1")], &[]); // ingest_seq repeats
    r.asset0 = None; // null asset0 column still resolves asset1
    rows.push(r);
    let mut r = change(14, 990, &[(0, 0, "0.3", "4")]); // exchange clock back
    r.ts_local = 900; // local behind exchange and stepping back
    rows.push(r);
    let mut r = change(15, 1012, &[(1, 1, "0.6", "5")]);
    r.ts_local = 0; // no local time
    rows.push(r);
    let mut r = book(16, 1013, 0, &[("0.3", "1")], &[]);
    r.asset0 = Some(String::new()); // blank asset column does not resolve
    rows.push(r);
    rows.push(change(
        17,
        1014,
        &[(0, 0, "0.31", "2"), (0, 1, "0.69", "3")],
    ));
    rows
}

fn v1_stream(path: &Path, inp: &TelonexInput<'_>) -> MarketStream {
    MarketStream::V1(read_telonex_delta(path, inp).unwrap())
}

#[test]
fn synthetic_round_trip_and_stream_equality() {
    let dir = scratch("synthetic");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let rows = read_v1(Bytes::from(std::fs::read(&v1).unwrap())).unwrap();
    assert_eq!(rows.len(), synthetic_rows().len());
    assert!(rows.decimals.iter().any(|d| !d.inexact.is_empty()));
    let tape = codec::encode(&rows, identity(&v1), [1; 32], &opts().encode).unwrap();
    let (h, back) = Decoder::new().unwrap().decode(&tape).unwrap();
    assert_eq!(back, rows, "typed rows survive the round trip");
    assert!(h.blocks.len() > 1, "small blocks exercise block boundaries");
    assert_eq!(h.rows, rows.len() as u64);
    assert_eq!(h.tool_sha256, [1; 32]);

    let a = v1_stream(&v1, &input());
    let b = MarketStream::Tape(replay(&back, &input()).unwrap());
    assert_eq!(first_difference(&a, &b), None);
    assert_eq!(digest(&a), digest(&b));
    let d = a.diagnostics();
    assert_eq!(d.rows_read, synthetic_rows().len() as u64);
    assert_eq!(d.skipped.blank_market, 1);
    assert_eq!(d.skipped.no_exchange_ts, 2);
    assert_eq!(d.skipped.unresolved_book_asset, 3);
    assert_eq!(d.skipped.empty_price_change, 1);
    assert_eq!(d.dropped_changes, 3);
    assert_eq!(d.inexact_decimal, 2);
    assert!(d.ingest_seq_backwards >= 1);
    assert!(d.exchange_clock_backwards >= 1);
    assert!(d.local_clock_backwards >= 1);
    assert!(d.local_behind_exchange >= 1);
}

#[test]
fn every_frame_has_a_checksum() {
    let dir = scratch("checksum");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 100);
    let rows = read_v1(Bytes::from(std::fs::read(&v1).unwrap())).unwrap();
    let tape = codec::encode(&rows, identity(&v1), [0; 32], &opts().encode).unwrap();
    let h = Decoder::new().unwrap().header(&tape).unwrap();
    for b in &h.blocks {
        for c in &b.cols {
            let at = (h.data_offset + c.offset) as usize;
            assert_eq!(&tape[at..at + 4], &[0x28, 0xB5, 0x2F, 0xFD]);
            assert_ne!(tape[at + 4] & 0x04, 0, "Content_Checksum_flag");
        }
    }
}

#[test]
fn empty_and_extreme_values_round_trip() {
    let mut t = crate::typed::TypedRows::default();
    let tape = codec::encode(
        &t,
        V1Identity {
            bytes: 0,
            mtime_ns: 0,
            sha256: [0; 32],
        },
        [0; 32],
        &EncodeOptions::default(),
    )
    .unwrap();
    let (h, back) = Decoder::new().unwrap().decode(&tape).unwrap();
    assert_eq!((h.rows, h.blocks.len()), (0, 0));
    assert_eq!(back, t);

    // i64 extremes in delta columns wrap losslessly; null exchange times.
    for (i, (seq, ts)) in [(i64::MIN, i64::MAX), (i64::MAX, i64::MIN), (0, 0), (-1, 1)]
        .into_iter()
        .enumerate()
    {
        t.ingest_seq.push(seq);
        t.ts_local_ms.push(ts);
        t.ts_exchange_ms.push(if i == 2 { 0 } else { ts });
        t.flags.push(if i == 2 {
            crate::typed::row_flags::TS_EXCHANGE_NULL
        } else {
            0
        });
        t.event_type.push(0);
        t.market.push(0);
        t.asset0.push(crate::typed::NULL_ID);
        t.asset1.push(0);
        t.asset_index.push(i32::MIN + i as i32);
        for d in &mut t.decimals {
            d.values.extend([i64::MIN, i64::MAX, 0, 10_000]);
            d.offsets.push(d.values.len() as u32);
        }
        for l in &mut t.ints {
            l.values.extend([i32::MIN, i32::MAX]);
            l.offsets.push(l.values.len() as u32);
        }
    }
    t.dict.push(b"m".to_vec());
    t.decimals[0].inexact = vec![1, 6];
    for block_rows in [1, 3, 65_536] {
        let tape = codec::encode(
            &t,
            V1Identity {
                bytes: 1,
                mtime_ns: -5,
                sha256: [9; 32],
            },
            [0; 32],
            &EncodeOptions {
                block_rows,
                zstd_level: 1,
            },
        )
        .unwrap();
        let (h, back) = Decoder::new().unwrap().decode(&tape).unwrap();
        assert_eq!(back, t, "block_rows {block_rows}");
        assert_eq!(h.v1.mtime_ns, -5);
    }
}

#[test]
fn decimal_scale_is_lossless() {
    let mut t = crate::typed::TypedRows::default();
    t.dict.push(b"m".to_vec());
    for (i, v) in [520_000i64, 10_000, 0, -30_000, 1_000_000]
        .into_iter()
        .enumerate()
    {
        t.ingest_seq.push(i as i64);
        t.ts_local_ms.push(0);
        t.ts_exchange_ms.push(0);
        t.flags.push(0);
        t.event_type.push(1);
        t.market.push(0);
        t.asset0.push(crate::typed::NULL_ID);
        t.asset1.push(crate::typed::NULL_ID);
        t.asset_index.push(0);
        for d in &mut t.decimals {
            d.values.push(v);
            d.offsets.push(d.values.len() as u32);
        }
        for l in &mut t.ints {
            l.offsets.push(0);
        }
    }
    let tape = codec::encode(
        &t,
        V1Identity {
            bytes: 0,
            mtime_ns: 0,
            sha256: [0; 32],
        },
        [0; 32],
        &EncodeOptions::default(),
    )
    .unwrap();
    let (h, back) = Decoder::new().unwrap().decode(&tape).unwrap();
    assert_eq!(back, t);
    let c = h.blocks[0].cols[col::DEC_VALUES];
    assert_eq!(
        (c.scale, c.width),
        (4, 1),
        "0.01 grid stored as 1-byte hundredths"
    );
}

#[test]
fn unknown_event_type_stays_v1() {
    let dir = scratch("event-type");
    let v1 = dir.join("m.parquet");
    let mut rows = synthetic_rows();
    let mut r = change(99, 2000, &[]);
    r.event_type = "last_trade_price".into();
    rows.push(r);
    write_v1(&v1, &rows, 100);
    let tape = dir.join("tapes/m.pmbtape");
    let mut root = budget(&dir.join("tapes"));
    let mut dec = Decoder::new().unwrap();
    let out = convert_one(&v1, &tape, None, &opts(), &mut root, &mut dec).unwrap();
    assert_eq!(
        out,
        ConvertOutcome::Unconvertible(Unconvertible::EventType("last_trade_price".into()))
    );
    assert!(!tape.exists());
    // The market still reads, from v1, with the row counted as skipped.
    let (s, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::V1(Fallback::Missing));
    assert_eq!(s.diagnostics().skipped.other_event_type, 1);
}

#[test]
fn unparseable_decimal_stays_v1() {
    let dir = scratch("decimal");
    let v1 = dir.join("m.parquet");
    let mut rows = synthetic_rows();
    let mut r = book(99, 2000, 0, &[("abc", "1")], &[]);
    r.market = String::new(); // the v1 reader never parses it (blank market)
    rows.push(r);
    write_v1(&v1, &rows, 100);
    let err = read_v1(Bytes::from(std::fs::read(&v1).unwrap())).unwrap_err();
    assert_eq!(err.label(), "decimal");
    assert!(read_telonex_delta(&v1, &input()).is_ok());
}

#[test]
fn dictionary_overflow_stays_v1() {
    let dir = scratch("dict");
    let v1 = dir.join("m.parquet");
    let mut rows = synthetic_rows();
    for i in 0..DICT_CAP {
        let mut r = book(100 + i as i64, 3000, 0, &[], &[]);
        r.market = String::new(); // skipped before asset resolution
        r.asset0 = Some(format!("foreign-{i}"));
        rows.push(r);
    }
    write_v1(&v1, &rows, 64);
    let tape = dir.join("tapes/m.pmbtape");
    let mut dec = Decoder::new().unwrap();
    let out = convert_one(
        &v1,
        &tape,
        None,
        &opts(),
        &mut budget(&dir.join("tapes")),
        &mut dec,
    )
    .unwrap();
    assert_eq!(
        out,
        ConvertOutcome::Unconvertible(Unconvertible::DictionaryOverflow)
    );
    assert!(!tape.exists());
    let (_, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::V1(Fallback::Missing));
}

/// Converts the synthetic file and returns (scratch dir, v1, tape, decoder).
fn converted(name: &str) -> (Scratch, PathBuf, PathBuf, Decoder) {
    let dir = scratch(name);
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let tape = store::tape_path(&dir.join("tapes"), &key("m")).unwrap();
    let mut dec = Decoder::new().unwrap();
    let out = convert_one(
        &v1,
        &tape,
        None,
        &opts(),
        &mut budget(&dir.join("tapes")),
        &mut dec,
    )
    .unwrap();
    assert!(matches!(out, ConvertOutcome::Written { .. }), "{out:?}");
    (dir, v1, tape, dec)
}

fn assert_fallback(v1: &Path, tape: &Path, dec: &mut Decoder, label: &str) {
    let (s, path) = read_market(v1, Some(tape), None, &input(), dec).unwrap();
    match &path {
        InputPath::V1(f) => assert_eq!(f.label(), label, "{f}"),
        InputPath::Tape => panic!("expected a fallback ({label})"),
    }
    assert_eq!(first_difference(&s, &v1_stream(v1, &input())), None);
}

#[test]
fn valid_tape_is_used_and_skipped_on_reconvert() {
    let (_dir, v1, tape, mut dec) = converted("valid");
    let (s, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
    assert_eq!(first_difference(&s, &v1_stream(&v1, &input())), None);
    let sha = identity(&v1).sha256;
    let (_, path) = read_market(&v1, Some(&tape), Some(&sha), &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
    let out = convert_one(
        &v1,
        &tape,
        None,
        &opts(),
        &mut budget(&root_of(&tape)),
        &mut dec,
    )
    .unwrap();
    assert!(
        matches!(out, ConvertOutcome::SkippedValid { .. }),
        "{out:?}"
    );
}

#[test]
fn corrupted_frame_falls_back_to_v1() {
    let (_dir, v1, tape, mut dec) = converted("corrupt");
    let good = std::fs::read(&tape).unwrap();
    let h = dec.header(&good).unwrap();
    // Flip one byte inside the largest data frame (past its header).
    let c = h.blocks[0]
        .cols
        .iter()
        .max_by_key(|c| c.comp_len)
        .copied()
        .unwrap();
    let mut bad = good.clone();
    let at = (h.data_offset + c.offset) as usize + c.comp_len as usize / 2 + 3;
    bad[at] ^= 0x40;
    std::fs::write(&tape, &bad).unwrap();
    assert!(matches!(
        load_tape(&mut dec, &tape, &v1, None),
        Err(Fallback::Invalid(TapeError::Frame(_)))
    ));
    assert_fallback(&v1, &tape, &mut dec, "invalid");
    // Corrupt meta frame.
    let mut bad = good.clone();
    bad[24 + 6] ^= 0x01;
    std::fs::write(&tape, &bad).unwrap();
    assert_fallback(&v1, &tape, &mut dec, "invalid");
    // Truncated file and trailing garbage.
    std::fs::write(&tape, &good[..good.len() - 3]).unwrap();
    assert_fallback(&v1, &tape, &mut dec, "invalid");
    let mut long = good.clone();
    long.push(0);
    std::fs::write(&tape, &long).unwrap();
    assert_fallback(&v1, &tape, &mut dec, "invalid");
    // Bad magic and an unsupported format version.
    let mut bad = good.clone();
    bad[0] = b'X';
    std::fs::write(&tape, &bad).unwrap();
    assert_fallback(&v1, &tape, &mut dec, "invalid");
    let mut bad = good.clone();
    bad[8..12].copy_from_slice(&2u32.to_le_bytes());
    std::fs::write(&tape, &bad).unwrap();
    assert_fallback(&v1, &tape, &mut dec, "version");
    // An empty file.
    std::fs::write(&tape, b"").unwrap();
    assert_fallback(&v1, &tape, &mut dec, "invalid");
    // Restored, it is used again.
    std::fs::write(&tape, &good).unwrap();
    let (_, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
}

#[test]
fn stale_tape_falls_back_and_is_rebuilt() {
    let (_dir, v1, tape, mut dec) = converted("stale");
    // A job sha256 that differs from the tape's v1 identity.
    assert_fallback_sha(&v1, &tape, &mut dec);
    // The v1 file is touched (mtime changes): stale, then rebuilt.
    let f = std::fs::File::options().write(true).open(&v1).unwrap();
    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000))
        .unwrap();
    drop(f);
    assert_fallback(&v1, &tape, &mut dec, "stale");
    let root = root_of(&tape);
    let out = convert_one(&v1, &tape, None, &opts(), &mut budget(&root), &mut dec).unwrap();
    assert!(matches!(out, ConvertOutcome::Written { .. }), "{out:?}");
    let (_, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
}

fn assert_fallback_sha(v1: &Path, tape: &Path, dec: &mut Decoder) {
    let (s, path) = read_market(v1, Some(tape), Some(&[0xAB; 32]), &input(), dec).unwrap();
    assert!(
        matches!(path, InputPath::V1(Fallback::Stale(_))),
        "{path:?}"
    );
    assert_eq!(first_difference(&s, &v1_stream(v1, &input())), None);
}

#[test]
fn input_errors_are_identical_on_both_paths() {
    let (_dir, v1, tape, mut dec) = converted("errors");
    let foreign = TelonexInput {
        format_version: 1,
        tokens: [UP, "9999"],
        condition_id: None,
    };
    let wrong_cid = TelonexInput {
        condition_id: Some("0xother"),
        ..input()
    };
    let right_cid = TelonexInput {
        condition_id: Some("0XMARKET"),
        ..input()
    };
    let bad_version = TelonexInput {
        format_version: 2,
        ..input()
    };
    for inp in [&foreign, &wrong_cid, &bad_version] {
        let e1 = read_telonex_delta(&v1, inp).unwrap_err();
        let e2 = read_market(&v1, Some(&tape), None, inp, &mut dec)
            .err()
            .unwrap();
        assert_eq!(e1, e2);
    }
    let (s, path) = read_market(&v1, Some(&tape), None, &right_cid, &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
    assert_eq!(first_difference(&s, &v1_stream(&v1, &right_cid)), None);
    // A missing v1 file is the v1 reader's error even with a valid tape.
    let gone = v1.with_file_name("missing.parquet");
    let e = read_market(&gone, Some(&tape), None, &input(), &mut dec)
        .err()
        .unwrap();
    assert_eq!(e.cause, "input_missing");
}

#[test]
fn cap_and_free_disk_floor_stop_conversion() {
    let dir = scratch("budget");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let root = dir.join("tapes");
    let tape = store::tape_path(&root, &key("m")).unwrap();
    let mut dec = Decoder::new().unwrap();
    let mut cap = Budget::new(&root, 10, 0).unwrap();
    let out = convert_one(&v1, &tape, None, &opts(), &mut cap, &mut dec).unwrap();
    assert_eq!(out, ConvertOutcome::Stopped(Stop::Cap));
    assert!(!tape.exists());
    let mut floor = Budget::new(&root, u64::MAX, u64::MAX).unwrap();
    let out = convert_one(&v1, &tape, None, &opts(), &mut floor, &mut dec).unwrap();
    assert_eq!(out, ConvertOutcome::Stopped(Stop::FreeDisk));
    assert!(!tape.exists());
    let mut ok = Budget::new(&root, u64::MAX, 0).unwrap();
    let out = convert_one(&v1, &tape, None, &opts(), &mut ok, &mut dec).unwrap();
    let ConvertOutcome::Written { tape_bytes, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(ok.used_bytes, tape_bytes);
    assert!(store::free_bytes(&root).unwrap() > 0);
}

#[test]
fn tape_paths_are_plain_and_versioned() {
    let root = Path::new("/tapes");
    assert_eq!(
        store::tape_path(root, &key("btc-updown-15m-1")).unwrap(),
        Path::new("/tapes/telonex-delta-typed-v1/tape-v1/btc/15m/btc-updown-15m-1.pmbtape")
    );
    // The input format comes from the job, not a constant.
    let v2 = store::MarketKey {
        format_version: 2,
        ..key("m")
    };
    assert_eq!(
        store::tape_path(root, &v2).unwrap(),
        Path::new("/tapes/telonex-delta-typed-v2/tape-v1/btc/15m/m.pmbtape")
    );
    for bad in ["", "..", "a/b", "x y"] {
        assert!(store::tape_path(root, &key(bad)).is_err(), "{bad:?}");
        let k = store::MarketKey {
            format: bad,
            ..key("m")
        };
        assert!(store::tape_path(root, &k).is_err(), "format {bad:?}");
    }
}

#[test]
fn newer_tape_format_is_not_overwritten() {
    let (_dir, v1, tape, mut dec) = converted("newer");
    let mut newer = std::fs::read(&tape).unwrap();
    newer[8..12].copy_from_slice(&(codec::FORMAT_VERSION + 1).to_le_bytes());
    std::fs::write(&tape, &newer).unwrap();
    let out = convert_one(
        &v1,
        &tape,
        None,
        &opts(),
        &mut budget(&root_of(&tape)),
        &mut dec,
    )
    .unwrap();
    assert_eq!(out, ConvertOutcome::NewerFormat(codec::FORMAT_VERSION + 1));
    assert_eq!(std::fs::read(&tape).unwrap(), newer, "left alone");
    assert_fallback(&v1, &tape, &mut dec, "version");
}

/// Committed CI fixture: a slice of a real market plus crafted anomaly rows.
pub(crate) const FIXTURE: &str = "tests/fixtures/telonex-mini.parquet";

#[test]
#[ignore = "regenerates the committed fixture from the local dataset"]
fn regenerate_fixture() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let src = root
        .join("../../../data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1785028500.parquet");
    let all = read_raw(&src);
    let mid = all.len() / 2;
    let mut rows: Vec<RawRow> = all[..1200].to_vec();
    rows.extend_from_slice(&all[mid..mid + 1800]);
    let tokens = pmb_replay::telonex::file_asset_ids(&src).unwrap();
    let (t0, t1) = (tokens[0].clone(), tokens[1].clone());
    let last = rows.last().unwrap().clone();
    let ts = last.ts_exchange.unwrap();
    let mk = |f: &dyn Fn(&mut RawRow)| {
        let mut r = last.clone();
        f(&mut r);
        r
    };
    rows.extend([
        mk(&|r| r.market = " ".into()),
        mk(&|r| r.ts_exchange = None),
        mk(&|r| r.ts_exchange = Some(-5)),
        mk(&|r| {
            r.event_type = "book".into();
            r.asset_index = Some(4);
        }),
        mk(&|r| {
            r.event_type = "price_change".into();
            r.change_assets = vec![0, 9];
            r.change_sides = vec![3, 0];
            r.change_prices = strings(&["0.5", "0.5"]);
            r.change_sizes = strings(&["1", "1"]);
        }),
        mk(&|r| {
            r.event_type = "price_change".into();
            r.ingest_seq -= 10;
            r.ts_exchange = Some(ts - 1000);
            r.ts_local = ts - 2000;
            r.change_assets = vec![0, 1];
            r.change_sides = vec![0, 1];
            r.change_prices = strings(&["0.5000004", "0.51"]);
            r.change_sizes = strings(&["10.1234565", "2e1"]);
        }),
        mk(&|r| {
            r.event_type = "book".into();
            r.asset0 = Some(format!(" {t0} "));
            r.asset1 = Some(t1.clone());
            r.asset_index = Some(0);
            r.bid_prices = strings(&["0.45", "0.44", "0.43"]);
            r.bid_sizes = strings(&["10", "20"]);
            r.ask_prices = strings(&["0.55"]);
            r.ask_sizes = strings(&["5.0000005"]);
        }),
    ]);
    let out = root.join(FIXTURE);
    write_v1(&out, &rows, 1000);
    eprintln!("wrote {} ({} rows)", out.display(), rows.len());
}

#[test]
fn block_streamed_read_equals_v1_at_every_block_size() {
    let dir = scratch("streamed");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 4);
    let want = v1_stream(&v1, &input());
    let mut dec = Decoder::new().unwrap();
    for block_rows in [1, 2, 7, 65_536] {
        let tape = dir.join(format!("b{block_rows}.pmbtape"));
        let o = ConvertOptions {
            encode: EncodeOptions {
                block_rows,
                zstd_level: 1,
            },
            tool_sha256: [0; 32],
        };
        let out = convert_one(&v1, &tape, None, &o, &mut budget(&dir), &mut dec).unwrap();
        assert!(matches!(out, ConvertOutcome::Written { .. }), "{out:?}");
        let s = store::read_tape_stream(&mut dec, &tape, &v1, None, &input())
            .unwrap()
            .unwrap();
        let got = MarketStream::Tape(s);
        assert_eq!(
            first_difference(&want, &got),
            None,
            "block_rows {block_rows}"
        );
        // A foreign token fails identically on both paths, whatever the block.
        let foreign = TelonexInput {
            format_version: 1,
            tokens: ["nope", DOWN],
            condition_id: None,
        };
        let e1 = read_telonex_delta(&v1, &foreign).unwrap_err();
        let e2 = store::read_tape_stream(&mut dec, &tape, &v1, None, &foreign)
            .unwrap()
            .unwrap_err();
        assert_eq!(e1, e2);
    }
}

/// Rewrites the meta frame of a tape and re-compresses it with its checksum
/// on (prefix fixed up), so only the post-checksum validation can reject it.
fn tamper_meta(tape: &[u8], f: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let u32_at = |at: usize| u32::from_le_bytes(tape[at..at + 4].try_into().unwrap()) as usize;
    let (comp_len, raw_len) = (u32_at(12), u32_at(16));
    let mut meta = zstd::bulk::decompress(&tape[20..20 + comp_len], raw_len).unwrap();
    f(&mut meta);
    let mut c = zstd::bulk::Compressor::new(3).unwrap();
    c.set_parameter(zstd::zstd_safe::CParameter::ChecksumFlag(true))
        .unwrap();
    let frame = c.compress(&meta).unwrap();
    let mut out = tape[..12].to_vec();
    out.extend((frame.len() as u32).to_le_bytes());
    out.extend((meta.len() as u32).to_le_bytes());
    out.extend(&frame);
    out.extend(&tape[20 + comp_len..]);
    out
}

/// Meta offsets (codec.rs `write_meta`).
const META_ROWS: usize = 88;
const META_LIST_VALUES: usize = 96;
const META_INEXACT: usize = 160;
const META_DICT: usize = 208;

fn put_u64(m: &mut [u8], at: usize, v: u64) {
    m[at..at + 8].copy_from_slice(&v.to_le_bytes());
}

fn put_u32(m: &mut [u8], at: usize, v: u32) {
    m[at..at + 4].copy_from_slice(&v.to_le_bytes());
}

/// Offset of block `b`'s record in the meta frame.
fn meta_block(h: &codec::TapeHeader, b: usize) -> usize {
    let dict: usize = h.dict.iter().map(|e| 4 + e.len()).sum();
    let block = 4 + 24 + col::COUNT * 18;
    META_DICT + 4 + dict + 8 + b * block
}

/// Offset of column `c` of block `b` (offset u64, comp_len u32, raw_len u32, width, scale).
fn meta_col(h: &codec::TapeHeader, b: usize, c: usize) -> usize {
    meta_block(h, b) + 4 + 24 + c * 18
}

#[test]
fn checksum_valid_meta_with_inconsistent_counts_falls_back() {
    let (_dir, v1, tape, mut dec) = converted("tampered-meta");
    let good = std::fs::read(&tape).unwrap();
    let h = dec.header(&good).unwrap();
    let bids = h.list_values[crate::typed::dec::BID_PRICES];
    let dv = col::DEC_VALUES + crate::typed::dec::BID_PRICES;
    type Edit = Box<dyn Fn(&mut Vec<u8>)>;
    let cases: Vec<(&str, Edit)> = vec![
        // The reviewed panics: header counts far above the blocks' data.
        (
            "list value count 1<<62",
            Box::new(|m| put_u64(m, META_LIST_VALUES, 1 << 62)),
        ),
        (
            "list value count 1<<60",
            Box::new(|m| put_u64(m, META_LIST_VALUES, 1 << 60)),
        ),
        (
            "bid + ask counts overflow u64",
            Box::new(|m| {
                put_u64(m, META_LIST_VALUES, u64::MAX);
                put_u64(m, META_LIST_VALUES + 16, u64::MAX);
            }),
        ),
        (
            "inexact count 1<<62",
            Box::new(|m| put_u64(m, META_INEXACT, 1 << 62)),
        ),
        (
            "row count 1<<40",
            Box::new(|m| put_u64(m, META_ROWS, 1 << 40)),
        ),
        (
            "row count u64::MAX",
            Box::new(|m| put_u64(m, META_ROWS, u64::MAX)),
        ),
        // Dictionary length beyond the cap, and one entry short.
        (
            "dictionary of 300",
            Box::new(|m| put_u32(m, META_DICT, 300)),
        ),
        (
            "dictionary one short",
            Box::new(move |m| {
                let n = u32::from_le_bytes(m[META_DICT..META_DICT + 4].try_into().unwrap());
                put_u32(m, META_DICT, n - 1);
            }),
        ),
    ];
    let h2 = h.clone();
    let mut cases = cases;
    cases.push((
        "block rows u32::MAX",
        Box::new(move |m| put_u32(m, meta_block(&h2, 0), u32::MAX)),
    ));
    let h3 = h.clone();
    cases.push((
        "value frame raw length 4 GB, header count to match",
        Box::new(move |m| {
            let at = meta_col(&h3, 0, dv) + 12;
            let width = m[at + 4] as u64;
            let raw = u32::MAX - (u32::MAX % 8);
            let old = u32::from_le_bytes(m[at..at + 4].try_into().unwrap()) as u64;
            put_u32(m, at, raw);
            let total = bids - old / width + raw as u64 / width;
            put_u64(m, META_LIST_VALUES, total);
        }),
    ));
    for (what, edit) in &cases {
        let bad = tamper_meta(&good, edit);
        std::fs::write(&tape, &bad).unwrap();
        // Whole-file decode (convert's skip check, `pmb-tape info`).
        match load_tape(&mut dec, &tape, &v1, None) {
            Err(Fallback::Invalid(_)) => {}
            other => panic!(
                "{what}: expected an invalid tape, got {:?}",
                other.map(|_| ())
            ),
        }
        // Executor path: block-streamed read falls back to v1.
        assert_fallback(&v1, &tape, &mut dec, "invalid");
        // The converter rewrites it instead of panicking.
        let root = root_of(&tape);
        let out = convert_one(&v1, &tape, None, &opts(), &mut budget(&root), &mut dec).unwrap();
        assert!(
            matches!(out, ConvertOutcome::Written { .. }),
            "{what}: {out:?}"
        );
        let (_, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
        assert_eq!(path, InputPath::Tape, "{what}");
    }
}

#[cfg(unix)]
#[test]
fn tape_root_never_resolves_into_inputs_or_the_fleet_copy() {
    use std::os::unix::fs::symlink;
    let dir = scratch("root-check");
    // A fleet working copy holding the inputs, and the checkout whose data
    // links point into it (worker-1's layout, 01 §8.1).
    let fleet = dir.join("fleet");
    std::fs::create_dir_all(fleet.join(".git")).unwrap();
    std::fs::create_dir_all(fleet.join("data/events/telonex")).unwrap();
    std::fs::create_dir_all(fleet.join("data/binance")).unwrap();
    let main = dir.join("main");
    std::fs::create_dir_all(main.join(".git")).unwrap();
    std::fs::create_dir_all(main.join("data/native-tapes")).unwrap();
    let co = dir.join("checkout");
    std::fs::create_dir_all(co.join("data")).unwrap();
    std::fs::write(co.join(".git"), "gitdir: elsewhere\n").unwrap();
    symlink(fleet.join("data/events"), co.join("data/events")).unwrap();
    symlink(fleet.join("data/binance"), co.join("data/binance")).unwrap();
    symlink(main.join("data/native-tapes"), co.join("data/native-tapes")).unwrap();
    let data = co.join("data");
    let inputs = vec![data.join("events/telonex/m.parquet")];
    let check = |root: &Path| store::check_tape_root(root, &data, &inputs);

    // The documented roots: a real directory, or a link to the main
    // checkout's real directory, also when it does not exist yet.
    let ok = check(&co.join("data/native-tapes")).unwrap();
    assert_eq!(ok, main.join("data/native-tapes").canonicalize().unwrap());
    assert!(check(&co.join("data/native-tapes/sub/dir")).is_ok());
    assert!(check(&co.join("tapes")).is_ok());

    // Through the read-only links, into the fleet copy, or around them.
    for bad in [
        co.join("data/events/native-tapes"),
        co.join("data/events"),
        co.join("data/binance/tapes"),
        fleet.join("native-tapes"),
        fleet.clone(),
        dir.to_path_buf(),
    ] {
        let e = check(&bad).unwrap_err();
        assert!(e.contains("16 NT-8"), "{}: {e}", bad.display());
    }
    // `..` in a part that does not exist yet is not resolved silently.
    assert!(check(&co.join("data/nope/../../x")).is_err());
}

#[test]
fn stale_temporary_files_are_swept_and_not_counted() {
    let dir = scratch("tmp-sweep");
    let root = dir.join("tapes");
    let sub = root.join("a/b");
    std::fs::create_dir_all(&sub).unwrap();
    let mut child = std::process::Command::new("true").spawn().unwrap();
    let dead = child.id();
    child.wait().unwrap();
    std::fs::write(sub.join(format!("m.pmbtape.tmp.{dead}")), [0u8; 100]).unwrap();
    let mine = sub.join(format!("n.pmbtape.tmp.{}", std::process::id()));
    std::fs::write(&mine, [0u8; 10]).unwrap();
    std::fs::write(sub.join("m.pmbtape"), [0u8; 7]).unwrap();
    assert_eq!(
        store::dir_bytes(&root).unwrap(),
        7,
        "tmp files are not tapes"
    );
    assert_eq!(store::sweep_stale_tmp(&root).unwrap(), (1, 100));
    assert!(mine.exists(), "a live converter's file is kept");
    assert!(sub.join("m.pmbtape").exists());
    assert_eq!(store::sweep_stale_tmp(&root).unwrap(), (0, 0));
}

#[test]
#[ignore = "checks the real worker-1 layout (read-only); needs the data links"]
fn real_layout_tape_roots() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let data = repo.join("data");
    let inputs = vec![data.join("events/telonex/delta-typed/btc/15m/x.parquet")];
    let ok = store::check_tape_root(&data.join("native-tapes"), &data, &inputs).unwrap();
    eprintln!("data/native-tapes resolves to {}", ok.display());
    for bad in ["events/native-tapes", "telonex/x", "binance/x"] {
        let e = store::check_tape_root(&data.join(bad), &data, &inputs).unwrap_err();
        eprintln!("refused data/{bad}: {e}");
    }
}

#[test]
fn convert_refuses_a_source_that_is_not_the_manifest_file() {
    let dir = scratch("expected");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let id = identity(&v1);
    let root = dir.join("tapes");
    let tape = store::tape_path(&root, &key("m")).unwrap();
    let mut dec = Decoder::new().unwrap();
    let wrong = store::ExpectedSource {
        bytes: id.bytes,
        sha256: [0xAB; 32],
    };
    let out = convert_one(
        &v1,
        &tape,
        Some(&wrong),
        &opts(),
        &mut budget(&root),
        &mut dec,
    )
    .unwrap();
    assert_eq!(
        out,
        ConvertOutcome::SourceChanged {
            bytes: id.bytes,
            sha256: id.sha256
        }
    );
    assert!(!tape.exists());
    let short = store::ExpectedSource {
        bytes: id.bytes - 1,
        sha256: id.sha256,
    };
    let out = convert_one(
        &v1,
        &tape,
        Some(&short),
        &opts(),
        &mut budget(&root),
        &mut dec,
    )
    .unwrap();
    assert!(
        matches!(out, ConvertOutcome::SourceChanged { .. }),
        "{out:?}"
    );
    let right = store::ExpectedSource {
        bytes: id.bytes,
        sha256: id.sha256,
    };
    let out = convert_one(
        &v1,
        &tape,
        Some(&right),
        &opts(),
        &mut budget(&root),
        &mut dec,
    )
    .unwrap();
    assert!(matches!(out, ConvertOutcome::Written { .. }), "{out:?}");
    let out = convert_one(
        &v1,
        &tape,
        Some(&right),
        &opts(),
        &mut budget(&root),
        &mut dec,
    )
    .unwrap();
    assert!(
        matches!(out, ConvertOutcome::SkippedValid { .. }),
        "{out:?}"
    );
    // A valid tape of the file on disk is not "valid" for another expected file.
    let out = convert_one(
        &v1,
        &tape,
        Some(&wrong),
        &opts(),
        &mut budget(&root),
        &mut dec,
    )
    .unwrap();
    assert!(
        matches!(out, ConvertOutcome::SourceChanged { .. }),
        "{out:?}"
    );
}

#[test]
fn a_source_changed_mid_conversion_is_not_written() {
    let dir = scratch("raced");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let root = dir.join("tapes");
    let tape = store::tape_path(&root, &key("m")).unwrap();
    let mut dec = Decoder::new().unwrap();
    let touch = || {
        let f = std::fs::File::options().write(true).open(&v1).unwrap();
        f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000))
            .unwrap();
    };
    let out = store::convert_one_hooked(
        &v1,
        &tape,
        None,
        &opts(),
        &mut budget(&root),
        &mut dec,
        &mut || touch(),
    )
    .unwrap();
    assert_eq!(out, ConvertOutcome::Raced);
    assert!(!tape.exists());
    assert_eq!(
        store::dir_bytes(&root).unwrap(),
        0,
        "no temporary file left"
    );
}

#[test]
#[should_panic(expected = "another dictionary")]
fn replayer_rejects_rows_of_another_dictionary_of_equal_length() {
    let dir = scratch("dict-contract");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let rows = read_v1(Bytes::from(std::fs::read(&v1).unwrap())).unwrap();
    let mut other = rows.clone();
    assert!(other.dict.len() >= 2);
    other.dict.swap(0, 1);
    let mut r = crate::Replayer::new(&rows.dict, &input()).unwrap();
    let _ = r.feed(&other, 0);
}

/// sha256 of the pmb-replay sources this crate mirrors: `replay.rs` mirrors
/// the reader loop, counters and error texts of `telonex.rs` (and
/// `error.rs`), `v1.rs` mirrors `pq.rs` and `check_format`. Update a pin
/// only after reviewing the mirror against the change (16 NT-2, 15 I-55).
const MIRRORED_READER: [(&str, &str); 3] = [
    (
        "telonex.rs",
        "2ff868f665797a3fbe93bad003d7c2fd1dd6bc2573e095dd8cf152690076752c",
    ),
    (
        "pq.rs",
        "29c0cd5008f78ce32f0fd5fc381bef9eb353349de571ea4016e2afd03244e037",
    ),
    (
        "error.rs",
        "d437106c6de2b9f69ec98fdbeecb6d0403190d7d822d0851945a19da57cd69d2",
    ),
];

#[test]
fn mirrored_reader_source_is_pinned() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../pmb-replay/src");
    for (file, pinned) in MIRRORED_READER {
        let sha = store::hex(&store::sha256(&std::fs::read(dir.join(file)).unwrap()));
        assert_eq!(
            sha, pinned,
            "pmb-replay/src/{file} changed: review pmb-tape's mirror of the reader \
             (src/replay.rs, src/v1.rs) against the change, extend the generated corpus \
             if a rule changed, then update MIRRORED_READER in src/tests.rs"
        );
    }
}

/// Deterministic generator (splitmix64).
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.below(100) < pct
    }
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len() as u64) as usize]
    }
}

fn gen_decimal(rng: &mut Rng) -> String {
    match rng.below(12) {
        0 => format!("0.{:07}", rng.below(10_000_000)), // 7 digits: rounded
        1 => format!("{}.{:09}", rng.below(3), rng.below(1_000_000_000)),
        2 => format!("{}e-{}", rng.below(1000), rng.below(4)),
        3 => format!("{}E{}", rng.below(50), rng.below(3)),
        4 => format!("-{}.{}", rng.below(5), rng.below(100)),
        5 => "123456789012.345678".into(),
        6 => format!("{}", rng.below(5000)),
        _ => format!("0.{:02}", rng.below(100)),
    }
}

/// Per-file injections.
struct Mode {
    /// Foreign ids only in rows the reader skips before resolving assets.
    foreign_in_skipped: bool,
    /// A foreign token in a row at this index.
    foreign_at: Option<usize>,
    /// Another market id at this index.
    market_change_at: Option<usize>,
    /// An unknown event type at this index (the file stays on v1).
    unknown_event_at: Option<usize>,
}

fn gen_rows(rng: &mut Rng, n: usize, mode: &Mode) -> Vec<RawRow> {
    let mut rows: Vec<RawRow> = Vec::with_capacity(n);
    let (mut seq, mut ex) = (0i64, 1_000_000i64);
    for i in 0..n {
        let injected = [
            mode.foreign_at,
            mode.market_change_at,
            mode.unknown_event_at,
        ]
        .contains(&Some(i));
        // Identical consecutive rows (15 §8 `duplicateRows`).
        if let Some(p) = rows.last().filter(|_| !injected) {
            if rng.chance(4) {
                rows.push(p.clone());
                continue;
            }
        }
        seq = match rng.below(100) {
            0..=3 => seq,
            4..=6 => seq - 1 - rng.below(5) as i64,
            _ => seq + 1,
        };
        ex = if rng.chance(6) {
            ex - 1 - rng.below(100) as i64
        } else {
            ex + rng.below(50) as i64
        };
        let ts_exchange = match rng.below(100) {
            0..=2 => None,
            3..=4 => Some(-1 - rng.below(10) as i64),
            _ => Some(ex),
        };
        let ts_local = match rng.below(100) {
            0..=4 => 0,
            5..=6 => -(rng.below(10) as i64),
            7..=12 => ex - 1 - rng.below(30) as i64,
            13..=16 => ex - 200 - rng.below(30) as i64,
            _ => ex + rng.below(30) as i64,
        };
        let market = match rng.below(100) {
            0..=2 => String::new(),
            3..=4 => "   ".into(),
            5..=6 => format!(" {MARKET} "),
            _ => MARKET.into(),
        };
        let pair: (Option<&str>, Option<&str>) = *rng.pick(&[
            (Some(UP), Some(DOWN)),
            (Some(UP), Some(DOWN)),
            (Some(UP), Some(DOWN)),
            (Some(DOWN), Some(UP)),
            (None, Some(DOWN)),
            (Some(UP), None),
            (Some(""), Some(UP)),
            (Some(" 1111 "), Some(DOWN)),
            (None, None),
        ]);
        let mut r = RawRow {
            ingest_seq: seq,
            ts_local,
            ts_exchange,
            market,
            asset0: pair.0.map(str::to_string),
            asset1: pair.1.map(str::to_string),
            ..RawRow::default()
        };
        let skipped_early =
            r.market.trim().is_empty() || !matches!(r.ts_exchange, Some(t) if t >= 0);
        if mode.foreign_in_skipped && skipped_early {
            r.asset0 = Some(format!("foreign-{}", rng.below(4)));
        }
        if mode.foreign_at == Some(i) {
            r.asset1 = Some("9999".into());
        }
        if mode.market_change_at == Some(i) {
            r.market = "0xother".into();
        }
        if rng.chance(45) {
            r.event_type = "book".into();
            r.asset_index =
                *rng.pick(&[None, Some(2), Some(-1), Some(0), Some(1), Some(0), Some(1)]);
            for _ in 0..rng.below(5) {
                r.bid_prices.push(gen_decimal(rng));
                r.bid_sizes.push(gen_decimal(rng));
            }
            for _ in 0..rng.below(5) {
                r.ask_prices.push(gen_decimal(rng));
                r.ask_sizes.push(gen_decimal(rng));
            }
            if rng.chance(10) {
                r.bid_prices.push(gen_decimal(rng)); // unequal list lengths
            }
            if rng.chance(10) {
                r.ask_sizes.push(gen_decimal(rng));
            }
        } else {
            r.event_type = "price_change".into();
            for _ in 0..rng.below(5) {
                r.change_assets
                    .push(*rng.pick(&[0, 1, 0, 1, 0, 1, 2, -1, 7]));
                r.change_sides
                    .push(*rng.pick(&[0, 1, 0, 1, 0, 1, 0, 1, 2, -1]));
                r.change_prices.push(gen_decimal(rng));
                r.change_sizes.push(gen_decimal(rng));
            }
            if rng.chance(10) {
                r.change_sides.pop();
            }
        }
        if mode.unknown_event_at == Some(i) {
            r.event_type = "last_trade_price".into();
        }
        rows.push(r);
    }
    rows
}

/// The two results are equal: the same event stream and counters, or the
/// same input error.
fn assert_same(
    file: usize,
    what: &str,
    want: &Result<pmb_replay::TelonexTape, pmb_replay::InputError>,
    got: Result<MarketStream, pmb_replay::InputError>,
) {
    match (want, got) {
        (Ok(w), Ok(g)) => {
            let w = MarketStream::V1(w.clone());
            assert_eq!(first_difference(&w, &g), None, "file {file} ({what})");
            assert_eq!(digest(&w), digest(&g), "file {file} ({what})");
        }
        (Err(a), Err(b)) => assert_eq!(a, &b, "file {file} ({what})"),
        (a, b) => panic!(
            "file {file} ({what}): v1 {:?} vs {:?}",
            a.as_ref().err(),
            b.err()
        ),
    }
}

/// NT-6 (b) / I-V6 against a generated corpus: every counter of the reader
/// diagnostics, every skip reason and every input error, on the v1 reader,
/// the whole-file tape replay and the block-streamed `read_market` path at
/// several block sizes. Guards the mirror in `replay.rs` (see its docs).
#[test]
fn generated_corpus_streams_are_identical_on_every_path() {
    use std::collections::{BTreeMap, BTreeSet};
    let dir = scratch("corpus");
    let mut rng = Rng(0x7A9E_C0DE_2026_1009);
    let mut fired: BTreeMap<&str, u64> = crate::replay::mirrored_counters(&Default::default())
        .into_iter()
        .map(|(k, _)| (k, 0))
        .collect();
    let mut errors: BTreeSet<&str> = BTreeSet::new();
    let (mut tape_files, mut v1_only) = (0, 0);
    let mut dec = Decoder::new().unwrap();
    let mut corpus_budget = budget(&dir);
    for f in 0..200 {
        let n = 1 + rng.below(if f % 10 == 0 { 700 } else { 90 }) as usize;
        let at = |rng: &mut Rng, pct| rng.chance(pct).then(|| rng.below(n as u64) as usize);
        let mode = Mode {
            foreign_in_skipped: rng.chance(30),
            foreign_at: at(&mut rng, 8),
            market_change_at: at(&mut rng, 6),
            unknown_event_at: at(&mut rng, 6),
        };
        let rows = gen_rows(&mut rng, n, &mode);
        let v1 = dir.join(format!("f{f}.parquet"));
        let codec = *rng.pick(&[Compression::UNCOMPRESSED, Compression::SNAPPY]);
        write_v1_with(&v1, &rows, 1 + rng.below(64) as usize, codec);
        let condition_id = *rng.pick(&[None, None, None, None, Some("0XMARKET"), Some("0xother")]);
        let inp = TelonexInput {
            format_version: if rng.chance(3) { 2 } else { 1 },
            tokens: [UP, DOWN],
            condition_id,
        };
        let want = read_telonex_delta(&v1, &inp);

        let block_rows = *rng.pick(&[1u32, 2, 5, 16, 64, 65_536]);
        let o = ConvertOptions {
            encode: EncodeOptions {
                block_rows,
                zstd_level: 1,
            },
            tool_sha256: [0; 32],
        };
        let tape = dir.join(format!("f{f}.pmbtape"));
        let out = convert_one(&v1, &tape, None, &o, &mut corpus_budget, &mut dec).unwrap();
        let typed = read_v1(Bytes::from(std::fs::read(&v1).unwrap()));
        match (&typed, mode.unknown_event_at) {
            (Ok(t), None) => {
                assert!(
                    matches!(out, ConvertOutcome::Written { .. }),
                    "file {f}: {out:?}"
                );
                let (_, back) = dec.decode(&std::fs::read(&tape).unwrap()).unwrap();
                assert_eq!(&back, t, "file {f}: typed rows survive the tape");
                assert_same(
                    f,
                    "whole-file tape",
                    &want,
                    replay(&back, &inp).map(MarketStream::Tape),
                );
                tape_files += 1;
            }
            (Err(Unconvertible::EventType(_)), Some(_)) => {
                assert!(
                    matches!(out, ConvertOutcome::Unconvertible(_)),
                    "file {f}: {out:?}"
                );
                v1_only += 1;
            }
            (t, u) => panic!(
                "file {f}: typed rows {:?} with unknown event at {u:?}",
                t.as_ref().err()
            ),
        }
        let streamed = read_market(&v1, Some(&tape), None, &inp, &mut dec);
        if let Ok((_, path)) = &streamed {
            let expect_tape = mode.unknown_event_at.is_none();
            assert_eq!(*path == InputPath::Tape, expect_tape, "file {f}: {path:?}");
        }
        assert_same(f, "read_market", &want, streamed.map(|(s, _)| s));

        match &want {
            Ok(t) => {
                for (k, v) in crate::replay::mirrored_counters(&t.diagnostics) {
                    *fired.get_mut(k).unwrap() += v;
                }
            }
            Err(e) => {
                errors.insert(match (e.cause, e.detail.as_str()) {
                    ("foreign_file", d) if d.contains("not one of the job's tokens") => {
                        "foreign token"
                    }
                    ("foreign_file", d) if d.contains("market column changes") => "market changes",
                    ("foreign_file", d) if d.contains("job condition id") => "condition id",
                    ("format_version", _) => "format version",
                    _ => panic!("file {f}: unexpected error {e}"),
                });
            }
        }
    }
    for (k, v) in &fired {
        assert!(*v > 0, "counter {k} never fired; extend the generator");
    }
    assert_eq!(
        errors.into_iter().collect::<Vec<_>>(),
        [
            "condition id",
            "foreign token",
            "format version",
            "market changes"
        ]
    );
    assert!(
        tape_files >= 100 && v1_only >= 5,
        "{tape_files} tape, {v1_only} v1-only"
    );
}

#[test]
fn m19_parquet_round_trips_typed_rows() {
    use crate::m19;
    let dir = scratch("m19");
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let rows = read_v1(Bytes::from(std::fs::read(&v1).unwrap())).unwrap();
    assert!(rows.decimals.iter().any(|d| !d.inexact.is_empty()));
    let id = identity(&v1);
    let mut reader = m19::Reader::default();
    for t in [rows, crate::typed::TypedRows::default()] {
        let bytes = m19::encode(&t, &id, 3).unwrap();
        let (meta, back) = reader.read(Bytes::from(bytes.clone())).unwrap();
        assert_eq!(back, t);
        assert_eq!((meta.v1_bytes, meta.v1_sha256), (id.bytes, id.sha256));
        assert_eq!(m19::Reader::meta(Bytes::from(bytes)).unwrap(), meta);
    }
}
