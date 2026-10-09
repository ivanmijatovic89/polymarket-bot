//! spec: 15 §4.1 I-11–I-13, §4.2 I-15–I-20, §8, §9, §10 I-V1, I-V3 and I-V6;
//! 60 §7.1 GF-5, §7.2 "Telonex row decode, crafted skip rows" — the reader
//! against the crafted fixtures of `native/fixtures/gen/telonex_crafted_gen.ts`:
//! the event stream equals what the TS `replayTelonexDeltaParquetForMarket`
//! hands to `onSnapshot`, the book after the last event equals the TS book,
//! the counters equal the spec expectations recorded with each file, and
//! refused files yield the documented error class and cause. Every place
//! where the spec value differs from TS names its proposed classification
//! (`expect.divergence`, GF-5).

use domain::fixed::parse_decimal;
use domain::{MarketEvent, Outcome, PriceSize, QuoteSide};
use orderbook::MarketBooks;
use serde_json::Value;
use sha2::Digest;
use std::path::{Path, PathBuf};
use telonex_replay::telonex::TelonexDiagnostics;
use telonex_replay::{
    read_telonex_delta, EventBatch, InputError, InputFile, InputFormat, TelonexInput,
    TelonexReader, TelonexTape,
};

const V1: InputFormat<'static> = InputFormat {
    name: "telonex-delta-typed",
    version: 1,
};

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/golden/telonex")
        .canonicalize()
        .unwrap()
}

fn golden() -> Value {
    serde_json::from_slice(
        &std::fs::read(golden_dir().join("telonex_crafted_golden.json")).unwrap(),
    )
    .unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

/// Micros of a TS decimal string (TS `String(number)` for book values).
fn micros(v: &Value) -> i64 {
    parse_decimal(s(v)).unwrap().micros
}

fn tokens(f: &Value) -> [String; 2] {
    [
        s(&f["tokens"][0]).to_string(),
        s(&f["tokens"][1]).to_string(),
    ]
}

fn outcome(tokens: &[String; 2], asset: &Value) -> Outcome {
    if s(asset) == tokens[0] {
        Outcome::Up
    } else {
        assert_eq!(s(asset), tokens[1]);
        Outcome::Down
    }
}

fn file(f: &Value) -> PathBuf {
    golden_dir().join(s(&f["file"]))
}

fn input_file<'a>(path: &'a Path, f: &Value, sha256: Option<&'a str>) -> InputFile<'a> {
    InputFile {
        path,
        bytes: f["bytes"].as_u64().unwrap(),
        sha256,
        format: V1,
    }
}

fn read(f: &Value) -> Result<TelonexTape, InputError> {
    let t = tokens(f);
    let path = file(f);
    let input = TelonexInput {
        tokens: [&t[0], &t[1]],
        // The file stores `0xC0FFEE`: condition ids compare case-insensitively.
        condition_id: Some("0xc0ffee"),
    };
    read_telonex_delta(&input_file(&path, f, None), input)
}

fn counters(d: &TelonexDiagnostics) -> Vec<(&'static str, u64)> {
    let k = &d.skipped;
    vec![
        ("rowsRead", d.rows_read),
        ("blankMarket", k.blank_market),
        ("noExchangeTs", k.no_exchange_ts),
        ("otherEventType", k.other_event_type),
        ("unresolvedBookAsset", k.unresolved_book_asset),
        ("emptyPriceChange", k.empty_price_change),
        ("droppedChanges", d.dropped_changes),
        ("inexactDecimal", d.inexact_decimal),
        ("exchangeClockBackwards", d.exchange_clock_backwards),
        ("localClockBackwards", d.local_clock_backwards),
        ("localBehindExchange", d.local_behind_exchange),
        ("ingestSeqBackwards", d.ingest_seq_backwards),
        ("duplicateRows", d.duplicate_rows),
        ("raggedRows", d.ragged_rows),
        ("offGridPrices", d.off_grid_prices),
    ]
}

fn assert_stream(name: &str, f: &Value, tape: &TelonexTape) {
    let t = tokens(f);
    let drop: Vec<usize> = f["expect"]["dropTsEvents"]
        .as_array()
        .map(|a| a.iter().map(|v| v.as_u64().unwrap() as usize).collect())
        .unwrap_or_default();
    let all = f["ts"]["events"].as_array().unwrap();
    assert!(drop.iter().all(|&i| i < all.len()), "{name}: dropTsEvents");
    let want: Vec<&Value> = all
        .iter()
        .enumerate()
        .filter(|(i, _)| !drop.contains(i))
        .map(|(_, v)| v)
        .collect();
    assert_eq!(tape.len(), want.len(), "{name}: event count");
    let levels = |v: &Value| -> Vec<(i64, i64)> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|l| (micros(&l[0]), micros(&l[1])))
            .collect()
    };
    let pairs = |ls: &[PriceSize]| -> Vec<(i64, i64)> {
        ls.iter()
            .map(|l| (l.price.micros(), l.size.micros()))
            .collect()
    };
    for (i, (ev, w)) in tape.events().zip(want).enumerate() {
        let at = format!("{name} event {i}");
        assert_eq!(
            ev.exchange_ts.0,
            w["ts"].as_i64().unwrap(),
            "{at}: exchange ts"
        );
        assert_eq!(
            ev.local_ts.map(|t| t.0),
            w["local"].as_i64(),
            "{at}: local ts"
        );
        match ev.event {
            MarketEvent::Book {
                outcome: o,
                bids,
                asks,
            } => {
                assert_eq!(s(&w["kind"]), "book", "{at}");
                assert_eq!(o, outcome(&t, &w["asset"]), "{at}: outcome");
                assert_eq!(pairs(bids), levels(&w["bids"]), "{at}: bids");
                assert_eq!(pairs(asks), levels(&w["asks"]), "{at}: asks");
            }
            MarketEvent::PriceChange { changes } => {
                assert_eq!(s(&w["kind"]), "price_change", "{at}");
                let want: Vec<_> = w["changes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| {
                        let side = match s(&c[1]) {
                            "BUY" => QuoteSide::Bid,
                            "SELL" => QuoteSide::Ask,
                            x => panic!("{x}"),
                        };
                        (outcome(&t, &c[0]), side, micros(&c[2]), micros(&c[3]))
                    })
                    .collect();
                let got: Vec<_> = changes
                    .iter()
                    .map(|c| (c.outcome, c.side, c.price.micros(), c.size.micros()))
                    .collect();
                assert_eq!(got, want, "{at}: changes");
            }
            other => panic!("{at}: unexpected {other:?}"),
        }
    }
}

type Book = Vec<(String, Vec<(i64, i64)>, Vec<(i64, i64)>)>;

/// The reader's book after the last event: (token, bids, asks) per listed outcome.
fn rust_final_book(tape: &TelonexTape, t: &[String; 2]) -> Book {
    let mut books = MarketBooks::new();
    for ev in tape.events() {
        books.apply(Some(ev.exchange_ts), &ev.event);
    }
    let mut out: Book = Outcome::ALL
        .iter()
        .filter_map(|&o| {
            let b = books.get(o)?;
            let side = |s: &orderbook::BookSide| {
                s.levels()
                    .map(|l| (l.price.micros(), l.size.micros()))
                    .collect()
            };
            Some((t[o.index()].clone(), side(&b.bids), side(&b.asks)))
        })
        .collect();
    out.sort();
    out
}

/// A golden book (`{token: {bids, asks}}`), values as micros or TS strings.
fn golden_book(v: &Value) -> Book {
    let side = |v: &Value| -> Vec<(i64, i64)> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|l| {
                let m = |x: &Value| x.as_i64().unwrap_or_else(|| micros(x));
                (m(&l[0]), m(&l[1]))
            })
            .collect()
    };
    let mut out: Book = v
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, b)| (k.clone(), side(&b["bids"]), side(&b["asks"])))
        .collect();
    out.sort();
    out
}

#[test]
fn crafted_files_match_ts_and_spec() {
    let g = golden();
    assert_eq!(
        s(&g["header"]["generator"]),
        "native/fixtures/gen/telonex_crafted_gen.ts"
    );
    let divergences = g["divergences"].as_object().unwrap();
    let mut checked = 0;
    for f in g["files"].as_array().unwrap() {
        let name = s(&f["name"]);
        let expect = &f["expect"];
        let ts_error = f["ts"].get("error").is_some();
        let divergence = expect.get("divergence").map(s);
        if let Some(d) = divergence {
            assert!(
                divergences.contains_key(d),
                "{name}: unknown divergence {d}"
            );
        }
        // The committed file is the one the TS oracle replayed.
        let bytes = std::fs::read(file(f)).unwrap();
        let sha: String = sha2::Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            sha,
            s(&f["sha256"]),
            "{name}: committed file differs from the golden"
        );
        let res = read(f);
        if let Some(e) = expect.get("error") {
            let got = res.expect_err(name);
            assert_eq!(
                (got.class.as_str(), got.cause),
                (s(&e["class"]), s(&e["cause"])),
                "{name}: {got}"
            );
            // GF-5: refusing a file that TS replays is a classified divergence.
            assert_eq!(
                divergence.is_some(),
                !ts_error,
                "{name}: a refused file needs a divergence exactly when TS replays it"
            );
        } else {
            assert!(!ts_error, "{name}: TS throws but the reader replays");
            let tape = res.unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_stream(name, f, &tape);
            let want = &expect["counters"];
            for (k, v) in counters(tape.diagnostics()) {
                assert_eq!(
                    v,
                    want.get(k).and_then(Value::as_u64).unwrap_or(0),
                    "{name}: {k}"
                );
            }
            assert_eq!(tape.meta.file_bytes, f["bytes"].as_u64().unwrap());
            assert!(!tape.meta.sha256_verified);
            if !tape.is_empty() {
                assert_eq!(tape.meta.market, "0xC0FFEE", "{name}: market as stored");
            }
            // The book after the last event: TS (quantized to micros), or the
            // spec value where they differ (GF-5).
            let t = tokens(f);
            let rust = rust_final_book(&tape, &t);
            let ts = golden_book(&f["ts"]["finalBook"]);
            match expect.get("finalBook") {
                Some(spec) => {
                    assert_eq!(rust, golden_book(spec), "{name}: final book (spec)");
                    assert_ne!(rust, ts, "{name}: the recorded divergence is gone");
                }
                None => assert_eq!(rust, ts, "{name}: final book (TS)"),
            }
            let differs = expect.get("finalBook").is_some() || expect.get("dropTsEvents").is_some();
            assert_eq!(
                divergence.is_some(),
                differs,
                "{name}: divergence annotation"
            );
        }
        checked += 1;
    }
    assert!(checked >= 24, "{checked} files");
}

fn by_name<'a>(g: &'a Value, name: &str) -> &'a Value {
    g["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["name"] == name)
        .unwrap()
}

#[test]
fn ts_errors_are_rust_errors() {
    // spec: 15 I-18, I-20 — files on which TS throws are refused by Rust.
    let g = golden();
    for name in ["market_changes", "bad_decimal"] {
        let f = by_name(&g, name);
        assert!(f["ts"]["error"].is_string(), "{name}: TS throws");
        assert!(read(f).is_err(), "{name}");
    }
}

#[test]
fn asset_columns_not_outcome_order() {
    // spec: 15 I-17, 10 M3 — asset_order stores the DOWN token in asset0;
    // the same rows with the tokens in file order read as swapped outcomes.
    let g = golden();
    let f = by_name(&g, "asset_order");
    let t = tokens(f);
    let path = file(f);
    let read_with = |tokens: [&str; 2]| {
        read_telonex_delta(
            &input_file(&path, f, None),
            TelonexInput {
                tokens,
                condition_id: None,
            },
        )
        .unwrap()
    };
    let up_first = read_with([&t[0], &t[1]]);
    let swapped = read_with([&t[1], &t[0]]);
    let first = |tape: &TelonexTape| match tape.event(0).event {
        MarketEvent::Book { outcome, .. } => outcome,
        _ => unreachable!(),
    };
    assert_eq!(first(&up_first), Outcome::Down, "asset0 is the DOWN token");
    assert_eq!(first(&swapped), Outcome::Up);
}

/// Streaming form: one batch per row group, cleared between groups.
fn stream(file: &InputFile<'_>, input: TelonexInput<'_>) -> (Vec<String>, TelonexDiagnostics) {
    let mut reader = TelonexReader::open(file, input).unwrap();
    let mut batch = EventBatch::default();
    let mut events = Vec::new();
    let mut groups = 0;
    loop {
        batch.clear();
        if !reader.decode_next(&mut batch).unwrap() {
            break;
        }
        groups += 1;
        events.extend(batch.events().map(|e| format!("{e:?}")));
    }
    assert_eq!(groups, reader.num_row_groups());
    (events, reader.meta().diagnostics)
}

#[test]
fn streaming_and_tape_forms_are_identical() {
    // spec: 15 I-4, I-V6 — both consumption forms yield the same events and
    // counters (crafted files use 5-row groups, so duplicates and clocks
    // cross row-group boundaries).
    let g = golden();
    let mut checked = 0;
    for f in g["files"].as_array().unwrap() {
        if f["expect"].get("error").is_some() {
            continue;
        }
        let t = tokens(f);
        let path = file(f);
        let input = TelonexInput {
            tokens: [&t[0], &t[1]],
            condition_id: None,
        };
        let file = input_file(&path, f, None);
        let tape = read_telonex_delta(&file, input).unwrap();
        let (events, diag) = stream(&file, input);
        let tape_events: Vec<String> = tape.events().map(|e| format!("{e:?}")).collect();
        assert_eq!(events, tape_events, "{}", s(&f["name"]));
        assert_eq!(&diag, tape.diagnostics(), "{}", s(&f["name"]));
        checked += 1;
    }
    assert!(checked >= 6, "{checked}");
}

#[test]
fn format_and_identity_errors() {
    // spec: 15 I-3, I-13, I-18, §9
    let g = golden();
    let f = by_name(&g, "asset_order");
    let t = tokens(f);
    let path = file(f);
    let input = |cid: Option<&'static str>| TelonexInput {
        tokens: [&t[0], &t[1]],
        condition_id: cid,
    };
    let with_format = |name: &'static str, version: u32| InputFile {
        format: InputFormat { name, version },
        ..input_file(&path, f, None)
    };
    for (name, version) in [
        ("telonex-delta-typed", 2),
        ("recorder-v4-compact", 1),
        ("telonex-paired", 1),
    ] {
        let e = read_telonex_delta(&with_format(name, version), input(None)).unwrap_err();
        assert_eq!(
            (e.class.as_str(), e.cause),
            ("data_defect", "format_version"),
            "{name} v{version}"
        );
    }
    let e = read_telonex_delta(&input_file(&path, f, None), input(Some("0xbeef"))).unwrap_err();
    assert_eq!((e.class.as_str(), e.cause), ("data_defect", "foreign_file"));
    assert!(read_telonex_delta(&input_file(&path, f, None), input(None)).is_ok());

    let absent = path.with_file_name("absent.parquet");
    let e = read_telonex_delta(&input_file(&absent, f, None), input(None)).unwrap_err();
    assert_eq!(
        (e.class.as_str(), e.cause),
        ("data_missing", "input_missing")
    );
    let relative = PathBuf::from("crafted/asset_order.parquet");
    let e = read_telonex_delta(&input_file(&relative, f, None), input(None)).unwrap_err();
    assert_eq!((e.class.as_str(), e.cause), ("invalid_input", "path"));
}
