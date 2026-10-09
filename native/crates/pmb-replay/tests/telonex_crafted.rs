//! spec: 15 §4.1 I-11–I-13, §4.2 I-15–I-20, §8, §9, §10 I-V1 and I-V3; 60 §7.2
//! "Telonex row decode, crafted skip rows" — the reader against the crafted
//! fixtures of `native/fixtures/decode/telonex_crafted_gen.ts`: the event
//! stream equals what the TS `replayTelonexDeltaParquetForMarket` hands to
//! `onSnapshot`, the counters equal the spec expectations recorded with each
//! file, and refused files yield the documented error class and cause.

use pmb_core::fixed::parse_decimal;
use pmb_core::{MarketEvent, Outcome, PriceSize, QuoteSide};
use pmb_replay::telonex::TelonexDiagnostics;
use pmb_replay::{
    read_telonex_delta, read_telonex_delta_with, ErrorClass, InputCheck, InputError, TelonexInput,
    TelonexTape,
};
use serde_json::Value;
use std::path::PathBuf;

fn decode_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/decode")
        .canonicalize()
        .unwrap()
}

fn golden() -> Value {
    serde_json::from_slice(
        &std::fs::read(decode_dir().join("telonex_crafted_golden.json")).unwrap(),
    )
    .unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

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
    decode_dir().join(s(&f["file"]))
}

fn read(f: &Value, check: &InputCheck) -> Result<TelonexTape, InputError> {
    let t = tokens(f);
    let input = TelonexInput {
        format_version: 1,
        tokens: [&t[0], &t[1]],
        // The file stores `0xC0FFEE`: condition ids compare case-insensitively.
        condition_id: Some("0xc0ffee"),
    };
    read_telonex_delta_with(&file(f), &input, check)
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
    ]
}

fn assert_stream(name: &str, f: &Value, tape: &TelonexTape) {
    let t = tokens(f);
    let want = f["ts"]["events"].as_array().unwrap();
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

#[test]
fn crafted_files_match_ts_and_spec() {
    let g = golden();
    assert_eq!(
        s(&g["header"]["generator"]),
        "native/fixtures/decode/telonex_crafted_gen.ts"
    );
    let mut checked = 0;
    for f in g["files"].as_array().unwrap() {
        let name = s(&f["name"]);
        let check = InputCheck {
            bytes: Some(f["bytes"].as_u64().unwrap()),
            sha256_verified: false,
        };
        let res = read(f, &check);
        if let Some(e) = f["expect"].get("error") {
            let got = res.expect_err(name);
            assert_eq!(
                (got.class.as_str(), got.cause),
                (s(&e["class"]), s(&e["cause"])),
                "{name}: {got}"
            );
        } else {
            let tape = res.unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_stream(name, f, &tape);
            let want = &f["expect"]["counters"];
            for (k, v) in counters(&tape.diagnostics) {
                assert_eq!(
                    v,
                    want.get(k).and_then(Value::as_u64).unwrap_or(0),
                    "{name}: {k}"
                );
            }
            assert_eq!(tape.file_bytes, check.bytes.unwrap());
            if !tape.is_empty() {
                assert_eq!(tape.market, "0xC0FFEE", "{name}: market as stored");
            }
        }
        checked += 1;
    }
    assert!(checked >= 16, "{checked} files");
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
        assert!(read(f, &InputCheck::default()).is_err(), "{name}");
    }
}

#[test]
fn integrity_and_identity_errors() {
    // spec: 15 I-3, I-8, I-13, I-18, §9; I-V3
    let g = golden();
    let f = by_name(&g, "asset_order");
    let bytes = f["bytes"].as_u64().unwrap();
    let e = read(
        f,
        &InputCheck {
            bytes: Some(bytes + 1),
            sha256_verified: false,
        },
    )
    .unwrap_err();
    assert_eq!(
        (e.class, e.cause),
        (ErrorClass::DataDefect, "integrity_mismatch")
    );

    let bad = by_name(&g, "bad_decimal");
    let e = read(
        bad,
        &InputCheck {
            bytes: None,
            sha256_verified: true,
        },
    )
    .unwrap_err();
    assert_eq!(
        (e.class, e.cause),
        (ErrorClass::DataDefect, "corrupt"),
        "decode failure after sha256 verification"
    );

    let t = tokens(f);
    let path = file(f);
    let input = |v: u32, cid: Option<&'static str>| TelonexInput {
        format_version: v,
        tokens: [&t[0], &t[1]],
        condition_id: cid,
    };
    let e = read_telonex_delta(&path, &input(2, None)).unwrap_err();
    assert_eq!(
        (e.class, e.cause),
        (ErrorClass::DataDefect, "format_version")
    );
    let e = read_telonex_delta(&path, &input(1, Some("0xbeef"))).unwrap_err();
    assert_eq!((e.class, e.cause), (ErrorClass::DataDefect, "foreign_file"));
    assert!(read_telonex_delta(&path, &input(1, None)).is_ok());

    let e =
        read_telonex_delta(&path.with_file_name("absent.parquet"), &input(1, None)).unwrap_err();
    assert_eq!(
        (e.class, e.cause),
        (ErrorClass::DataMissing, "input_missing")
    );
    let e = read_telonex_delta(
        &PathBuf::from("crafted/asset_order.parquet"),
        &input(1, None),
    )
    .unwrap_err();
    assert_eq!((e.class, e.cause), (ErrorClass::InvalidInput, "path"));
}

#[test]
fn asset_columns_not_outcome_order() {
    // spec: 15 I-17, 10 M3 — asset_order stores the DOWN token in asset0;
    // the same rows with the tokens in file order read as swapped outcomes.
    let g = golden();
    let f = by_name(&g, "asset_order");
    let t = tokens(f);
    let path = file(f);
    let up_first = read_telonex_delta(
        &path,
        &TelonexInput {
            format_version: 1,
            tokens: [&t[0], &t[1]],
            condition_id: None,
        },
    )
    .unwrap();
    let swapped = read_telonex_delta(
        &path,
        &TelonexInput {
            format_version: 1,
            tokens: [&t[1], &t[0]],
            condition_id: None,
        },
    )
    .unwrap();
    let first = |tape: &TelonexTape| match tape.event(0).event {
        MarketEvent::Book { outcome, .. } => outcome,
        _ => unreachable!(),
    };
    assert_eq!(first(&up_first), Outcome::Down, "asset0 is the DOWN token");
    assert_eq!(first(&swapped), Outcome::Up);
}
