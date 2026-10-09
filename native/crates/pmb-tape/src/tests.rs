//! Unit tests of the tape (16 §7.5): v1 → typed rows → tape → typed rows
//! round trips, the reader stream on both paths (NT-6 b), the fallback rules
//! (NT-5), the writer (NT-4) and the disk budget (NT-7).
//!
//! Scratch files go under `native/target/tmp/pmb-tape-unit/` (inside the
//! checkout). The committed fixture is regenerated with
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
    let schema = Arc::new(parse_message_type(V1_MESSAGE).unwrap());
    let props = Arc::new(
        WriterProperties::builder()
            .set_compression(Compression::GZIP(GzipLevel::default()))
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

/// A fresh scratch directory inside the checkout's target dir.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/tmp/pmb-tape-unit")
        .join(format!(
            "{name}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
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
    let out = convert_one(&v1, &tape, &opts(), &mut root, &mut dec).unwrap();
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

/// Converts the synthetic file and returns (v1, tape, decoder).
fn converted(name: &str) -> (PathBuf, PathBuf, Decoder) {
    let dir = scratch(name);
    let v1 = dir.join("m.parquet");
    write_v1(&v1, &synthetic_rows(), 5);
    let tape = store::tape_path(&dir.join("tapes"), "btc", "15m", "m").unwrap();
    let mut dec = Decoder::new().unwrap();
    let out = convert_one(
        &v1,
        &tape,
        &opts(),
        &mut budget(&dir.join("tapes")),
        &mut dec,
    )
    .unwrap();
    assert!(matches!(out, ConvertOutcome::Written { .. }), "{out:?}");
    (v1, tape, dec)
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
    let (v1, tape, mut dec) = converted("valid");
    let (s, path) = read_market(&v1, Some(&tape), None, &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
    assert_eq!(first_difference(&s, &v1_stream(&v1, &input())), None);
    let sha = identity(&v1).sha256;
    let (_, path) = read_market(&v1, Some(&tape), Some(&sha), &input(), &mut dec).unwrap();
    assert_eq!(path, InputPath::Tape);
    let root = tape
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let out = convert_one(&v1, &tape, &opts(), &mut budget(root), &mut dec).unwrap();
    assert!(
        matches!(out, ConvertOutcome::SkippedValid { .. }),
        "{out:?}"
    );
}

#[test]
fn corrupted_frame_falls_back_to_v1() {
    let (v1, tape, mut dec) = converted("corrupt");
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
    let (v1, tape, mut dec) = converted("stale");
    // A job sha256 that differs from the tape's v1 identity.
    assert_fallback_sha(&v1, &tape, &mut dec);
    // The v1 file is touched (mtime changes): stale, then rebuilt.
    let f = std::fs::File::options().write(true).open(&v1).unwrap();
    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000))
        .unwrap();
    drop(f);
    assert_fallback(&v1, &tape, &mut dec, "stale");
    let root = tape.ancestors().nth(4).unwrap().to_path_buf();
    let out = convert_one(&v1, &tape, &opts(), &mut budget(&root), &mut dec).unwrap();
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
    let (v1, tape, mut dec) = converted("errors");
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
    let tape = store::tape_path(&root, "btc", "15m", "m").unwrap();
    let mut dec = Decoder::new().unwrap();
    let mut cap = Budget::new(&root, 10, 0).unwrap();
    let out = convert_one(&v1, &tape, &opts(), &mut cap, &mut dec).unwrap();
    assert_eq!(out, ConvertOutcome::Stopped(Stop::Cap));
    assert!(!tape.exists());
    let mut floor = Budget::new(&root, u64::MAX, u64::MAX).unwrap();
    let out = convert_one(&v1, &tape, &opts(), &mut floor, &mut dec).unwrap();
    assert_eq!(out, ConvertOutcome::Stopped(Stop::FreeDisk));
    assert!(!tape.exists());
    let mut ok = Budget::new(&root, u64::MAX, 0).unwrap();
    let out = convert_one(&v1, &tape, &opts(), &mut ok, &mut dec).unwrap();
    let ConvertOutcome::Written { tape_bytes, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(ok.used_bytes, tape_bytes);
    assert!(store::free_bytes(&root).unwrap() > 0);
}

#[test]
fn tape_paths_are_plain() {
    let root = Path::new("/tapes");
    assert_eq!(
        store::tape_path(root, "btc", "15m", "btc-updown-15m-1").unwrap(),
        Path::new("/tapes/telonex-delta-typed-v1/btc/15m/btc-updown-15m-1.pmbtape")
    );
    for bad in ["", "..", "a/b", "x y"] {
        assert!(
            store::tape_path(root, "btc", "15m", bad).is_err(),
            "{bad:?}"
        );
    }
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
