//! L0 micro benchmarks of the telonex-delta input path (16 §7, §13.2 L0):
//!
//! - `columns16`: raw Parquet page decode of all 16 v1 columns with
//!   `read_records` (decompression + level/value decode; the 16 §2.2 row
//!   "column decode incl. decompression"),
//! - `file_to_tape`: the whole reader, `read_telonex_delta` (open, footer,
//!   decode, decimal parse, tape build),
//! - `decimal_parse`: `parse_decimal` over every price/size string of the
//!   file (bids, asks, changes),
//! - `book_apply_tops`: replaying the decoded tape into `MarketBooks` with
//!   the top-change bit (BK-7) and both outcomes' best bid/ask per event.
//!
//! Inputs: the markets of the committed decode fixture
//! (`native/fixtures/decode/telonex_book_golden.json`) and `heavy-1`
//! (`btc-updown-15m-1780925400`, 16 §13.1), each only when its file exists
//! under the data root (`PMB_BENCH_DATA_ROOT`, default `<repo>/data`); a
//! missing file is skipped with a message. Files are read through the
//! page cache (warm after criterion's warm-up).
//! Run: `cargo bench -p pmb-replay --bench decode`.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use parquet::data_type::{ByteArrayType, DataType, Int32Type, Int64Type};
use parquet::file::reader::{FileReader, RowGroupReader, SerializedFileReader};
use parquet::schema::types::ColumnDescriptor;
use pmb_book::{Level, MarketBooks, Side};
use pmb_core::fixed::parse_decimal;
use pmb_core::{parse_slug, MarketEvent, Outcome, QuoteSide};
use pmb_replay::telonex::file_asset_ids;
use pmb_replay::{read_telonex_delta, TelonexInput, TelonexTape};
use std::fs::File;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::Duration;

const HEAVY_1: &str = "btc-updown-15m-1780925400";
const DECIMAL_COLUMNS: [&str; 6] = [
    "bid_prices",
    "bid_sizes",
    "ask_prices",
    "ask_sizes",
    "change_prices",
    "change_sizes",
];

struct Market {
    label: String,
    path: PathBuf,
    tokens: [String; 2],
    rows: u64,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repository root")
}

fn data_root() -> PathBuf {
    match std::env::var_os("PMB_BENCH_DATA_ROOT") {
        Some(p) => PathBuf::from(p),
        None => repo_root().join("data"),
    }
}

/// Canonical local path of a converted file
/// (`data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet`,
/// `src/telonex/localOutputPath.ts`), relative to the data root.
fn delta_typed_rel(slug: &str) -> PathBuf {
    let info = parse_slug(slug).unwrap_or_else(|e| panic!("bench slug {slug}: {e}"));
    PathBuf::from("events/telonex/delta-typed")
        .join(info.symbol.as_str())
        .join(info.timeframe.as_str())
        .join(format!("{slug}.parquet"))
}

fn markets() -> Vec<Market> {
    let data = data_root();
    let golden_path = repo_root().join("native/fixtures/decode/telonex_book_golden.json");
    let golden: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&golden_path).unwrap_or_else(|e| panic!("{}: {e}", golden_path.display())),
    )
    .expect("decode fixture JSON");
    let mut out = Vec::new();
    for m in golden["markets"].as_array().expect("markets array") {
        let rel = m["file"].as_str().expect("file");
        let path = data.join(rel);
        let slug = Path::new(rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("slug file name");
        if !path.exists() {
            eprintln!(
                "skip fixture market (no file on this host): {}",
                path.display()
            );
            continue;
        }
        let toks: Vec<String> = m["tokens"]
            .as_array()
            .expect("tokens")
            .iter()
            .map(|t| t.as_str().expect("token").to_string())
            .collect();
        out.push(Market {
            label: format!("fixture/{slug}"),
            path,
            tokens: [toks[0].clone(), toks[1].clone()],
            rows: 0,
        });
    }
    let heavy = data.join(delta_typed_rel(HEAVY_1));
    if heavy.exists() {
        let ids = file_asset_ids(&heavy).expect("heavy-1 asset ids");
        assert!(ids.len() == 2, "heavy-1: expected 2 asset ids, got {ids:?}");
        out.push(Market {
            label: format!("heavy-1/{HEAVY_1}"),
            path: heavy,
            tokens: [ids[0].clone(), ids[1].clone()],
            rows: 0,
        });
    } else {
        eprintln!("skip heavy-1 (no file on this host): {}", heavy.display());
    }
    for m in &mut out {
        m.rows = read(m).diagnostics.rows_read;
    }
    out
}

fn read(m: &Market) -> TelonexTape {
    let input = TelonexInput {
        format_version: 1,
        tokens: [m.tokens[0].as_str(), m.tokens[1].as_str()],
        condition_id: None,
    };
    read_telonex_delta(&m.path, &input).unwrap_or_else(|e| panic!("{}: {e}", m.path.display()))
}

fn open(path: &Path) -> SerializedFileReader<File> {
    let f = File::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    SerializedFileReader::new(f).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Reusable level and value buffers of the raw column decode.
#[derive(Default)]
struct Buffers {
    def: Vec<i16>,
    rep: Vec<i16>,
    i32s: Vec<i32>,
    i64s: Vec<i64>,
    bytes: Vec<parquet::data_type::ByteArray>,
}

fn read_column<D: DataType>(
    rg: &dyn RowGroupReader,
    col: usize,
    rows: usize,
    descr: &ColumnDescriptor,
    def: &mut Vec<i16>,
    rep: &mut Vec<i16>,
    values: &mut Vec<D::T>,
) -> usize {
    def.clear();
    rep.clear();
    values.clear();
    let mut reader = D::get_column_reader(rg.get_column_reader(col).expect("column reader"))
        .expect("typed column reader");
    let (max_def, max_rep) = (descr.max_def_level(), descr.max_rep_level());
    let mut records = 0;
    while records < rows {
        let (n, _, _) = reader
            .read_records(
                rows - records,
                (max_def > 0).then_some(&mut *def),
                (max_rep > 0).then_some(&mut *rep),
                values,
            )
            .expect("read_records");
        assert!(n > 0, "column {col} ended early");
        records += n;
    }
    values.len()
}

/// Decodes every column of every row group; returns the value count.
fn decode_columns(path: &Path, buf: &mut Buffers) -> usize {
    use parquet::basic::Type;
    let reader = open(path);
    let schema = reader.metadata().file_metadata().schema_descr_ptr();
    let mut values = 0;
    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g).expect("row group");
        let rows = rg.metadata().num_rows() as usize;
        for c in 0..schema.num_columns() {
            let descr = schema.column(c);
            let Buffers {
                def,
                rep,
                i32s,
                i64s,
                bytes,
            } = buf;
            values += match descr.physical_type() {
                Type::INT32 => {
                    read_column::<Int32Type>(rg.as_ref(), c, rows, &descr, def, rep, i32s)
                }
                Type::INT64 => {
                    read_column::<Int64Type>(rg.as_ref(), c, rows, &descr, def, rep, i64s)
                }
                Type::BYTE_ARRAY => {
                    read_column::<ByteArrayType>(rg.as_ref(), c, rows, &descr, def, rep, bytes)
                }
                t => panic!("unexpected physical type {t}"),
            };
        }
    }
    values
}

/// Every decimal string of the price/size columns, as one text buffer plus
/// spans, so the parse bench measures parsing and not allocation.
struct Decimals {
    text: String,
    spans: Vec<(u32, u32)>,
}

fn decimals(path: &Path) -> Decimals {
    let reader = open(path);
    let schema = reader.metadata().file_metadata().schema_descr_ptr();
    let mut buf = Buffers::default();
    let mut text = String::new();
    let mut spans = Vec::new();
    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g).expect("row group");
        let rows = rg.metadata().num_rows() as usize;
        for c in 0..schema.num_columns() {
            let descr = schema.column(c);
            if !DECIMAL_COLUMNS.contains(&descr.path().string().as_str()) {
                continue;
            }
            read_column::<ByteArrayType>(
                rg.as_ref(),
                c,
                rows,
                &descr,
                &mut buf.def,
                &mut buf.rep,
                &mut buf.bytes,
            );
            for v in &buf.bytes {
                let s = std::str::from_utf8(v.data()).expect("decimal is UTF-8");
                let start = text.len() as u32;
                text.push_str(s);
                spans.push((start, text.len() as u32));
            }
        }
    }
    Decimals { text, spans }
}

fn book_side(s: QuoteSide) -> Side {
    match s {
        QuoteSide::Bid => Side::Bid,
        QuoteSide::Ask => Side::Ask,
    }
}

/// Replays the tape into fresh books: apply, top-change bit, both tops.
fn replay(tape: &TelonexTape) -> (u64, i64) {
    let mut books = MarketBooks::new();
    let mut changed = 0u64;
    let mut acc = 0i64;
    let lv = |p: &pmb_core::PriceSize| Level {
        price: p.price,
        size: p.size,
    };
    for ev in tape.events() {
        let top = match ev.event {
            MarketEvent::Book {
                outcome,
                bids,
                asks,
            } => books
                .apply_snapshot(outcome, bids.iter().map(lv), asks.iter().map(lv))
                .any(),
            MarketEvent::PriceChange { changes } => {
                let mut any = false;
                for c in changes {
                    any |= books
                        .apply_level(c.outcome, book_side(c.side), c.price, c.size)
                        .any();
                }
                any
            }
            _ => false,
        };
        changed += u64::from(top);
        for o in Outcome::ALL {
            acc = acc.wrapping_add(books.best_bid(o).map_or(0, |l| l.price.micros()));
            acc = acc.wrapping_add(books.best_ask(o).map_or(0, |l| l.size.micros()));
        }
    }
    (changed, acc)
}

fn bench_decode(c: &mut Criterion) {
    let markets = markets();
    if markets.is_empty() {
        eprintln!("no bench market present under {}", data_root().display());
        return;
    }
    for m in &markets {
        let bytes = std::fs::metadata(&m.path).map(|x| x.len()).unwrap_or(0);
        eprintln!(
            "market {}: {} rows, {} bytes, {}",
            m.label,
            m.rows,
            bytes,
            m.path.display()
        );
    }

    let mut g = c.benchmark_group("columns16");
    g.sample_size(10).measurement_time(Duration::from_secs(5));
    let mut buf = Buffers::default();
    for m in &markets {
        g.throughput(Throughput::Elements(m.rows));
        g.bench_function(BenchmarkId::from_parameter(&m.label), |b| {
            b.iter(|| black_box(decode_columns(black_box(&m.path), &mut buf)))
        });
    }
    g.finish();

    let mut g = c.benchmark_group("file_to_tape");
    g.sample_size(10).measurement_time(Duration::from_secs(5));
    for m in &markets {
        g.throughput(Throughput::Elements(m.rows));
        g.bench_function(BenchmarkId::from_parameter(&m.label), |b| {
            b.iter(|| black_box(read(black_box(m)).len()))
        });
    }
    g.finish();

    let mut g = c.benchmark_group("decimal_parse");
    g.sample_size(10).measurement_time(Duration::from_secs(5));
    for m in &markets {
        let d = decimals(&m.path);
        eprintln!("market {}: {} decimal strings", m.label, d.spans.len());
        g.throughput(Throughput::Elements(d.spans.len() as u64));
        g.bench_function(BenchmarkId::from_parameter(&m.label), |b| {
            b.iter(|| {
                let mut acc = 0i64;
                let mut inexact = 0u32;
                for &(s, e) in &d.spans {
                    let v = parse_decimal(black_box(&d.text[s as usize..e as usize]))
                        .expect("telonex decimals parse");
                    acc = acc.wrapping_add(v.micros);
                    inexact += u32::from(v.inexact);
                }
                black_box((acc, inexact))
            })
        });
    }
    g.finish();

    let mut g = c.benchmark_group("book_apply_tops");
    g.sample_size(10).measurement_time(Duration::from_secs(5));
    for m in &markets {
        let tape = read(m);
        let (changed, _) = replay(&tape);
        eprintln!(
            "market {}: {} kept events, {} change a top of book",
            m.label,
            tape.len(),
            changed
        );
        g.throughput(Throughput::Elements(tape.len() as u64));
        g.bench_function(BenchmarkId::from_parameter(&m.label), |b| {
            b.iter(|| black_box(replay(black_box(&tape))))
        });
    }
    g.finish();
}

criterion_group!(benches, bench_decode);
criterion_main!(benches);
