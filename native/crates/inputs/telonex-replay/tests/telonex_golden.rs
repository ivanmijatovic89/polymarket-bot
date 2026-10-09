//! spec: 15 §2.1, §4.2, I-V1, I-V6; 60 §7.2, §12 FX-5 — telonex-delta decode
//! and book reconstruction against the TS golden
//! (`native/fixtures/gen/telonex_book_gen.ts`). Committed fixture markets
//! (`source: fixture`) are always checked, also in CI; dataset markets
//! (`source: data`) are checked by the ignored test on hosts with `data/`,
//! which fails when a file is absent.

use domain::{MarketEvent, Outcome};
use orderbook::{MarketBooks, OutcomeBook, Side};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use telonex_replay::{
    read_telonex_delta, EventBatch, InputFile, InputFormat, TelonexInput, TelonexReader,
    TelonexTape,
};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../..")
        .canonicalize()
        .unwrap()
}

fn golden() -> Value {
    let g: Value = serde_json::from_slice(
        &std::fs::read(repo_root().join("native/fixtures/golden/telonex/telonex_book_golden.json"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        g["header"]["generator"].as_str(),
        Some("native/fixtures/gen/telonex_book_gen.ts")
    );
    g
}

fn path_of(m: &Value) -> PathBuf {
    let rel = m["file"].as_str().unwrap();
    match m["source"].as_str().unwrap() {
        "fixture" => repo_root().join("native/fixtures/golden/telonex").join(rel),
        "data" => repo_root().join("data").join(rel),
        other => panic!("source {other}"),
    }
}

fn top(b: Option<&OutcomeBook>, side: Side) -> (usize, String) {
    match b {
        None => (0, String::new()),
        Some(b) => {
            let s = b.side(side);
            let v: Vec<String> = s
                .levels()
                .take(3)
                .map(|l| format!("{}:{}", l.price.micros(), l.size.micros()))
                .collect();
            (s.len(), v.join(","))
        }
    }
}

fn read(m: &Value) -> TelonexTape {
    let path = path_of(m);
    let toks: Vec<&str> = m["tokens"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t.as_str().unwrap())
        .collect();
    // Golden token order is first-seen order; map it to UP/DOWN as given.
    let input = TelonexInput {
        tokens: [toks[0], toks[1]],
        condition_id: None,
    };
    let file = InputFile {
        path: &path,
        bytes: std::fs::metadata(&path).unwrap().len(),
        sha256: None,
        format: InputFormat {
            name: "telonex-delta-typed",
            version: 1,
        },
    };
    let tape = read_telonex_delta(&file, input).unwrap();
    // I-V6: the streaming form yields the same events and counters.
    let mut reader = TelonexReader::open(&file, input).unwrap();
    let mut batch = EventBatch::default();
    let mut i = 0;
    loop {
        batch.clear();
        if !reader.decode_next(&mut batch).unwrap() {
            break;
        }
        for ev in batch.events() {
            assert_eq!(ev, tape.event(i), "{}: streaming event {i}", path.display());
            i += 1;
        }
    }
    assert_eq!(i, tape.len());
    assert_eq!(reader.meta(), &tape.meta);
    tape
}

/// Replays `m` through `MarketBooks` and compares with the TS golden.
fn check_market(m: &Value) {
    let path = path_of(m);
    let tape = read(m);
    let mut books = MarketBooks::new();
    let mut seen: Vec<Outcome> = Vec::new();
    let mut hash = Sha256::new();
    let mut head = Vec::new();
    for ev in tape.events() {
        let ty = match ev.event {
            MarketEvent::Book { outcome, .. } => {
                if !seen.contains(&outcome) {
                    seen.push(outcome);
                }
                "book"
            }
            MarketEvent::PriceChange { changes } => {
                for c in changes {
                    if !seen.contains(&c.outcome) {
                        seen.push(c.outcome);
                    }
                }
                "price_change"
            }
            _ => unreachable!(),
        };
        books.apply(Some(ev.exchange_ts), &ev.event);
        let snapshot_ts = books.snapshot_ts().expect("timestamped").0;
        let mut parts = vec![snapshot_ts.to_string(), ty.to_string()];
        for &o in &seen {
            let (nb, tb) = top(books.get(o), Side::Bid);
            let (na, ta) = top(books.get(o), Side::Ask);
            parts.push(format!("{nb}/{na}"));
            parts.push(tb);
            parts.push(ta);
        }
        let line = parts.join("|");
        hash.update(line.as_bytes());
        hash.update(b"\n");
        if head.len() < 40 {
            head.push(line);
        }
    }
    let want_head: Vec<&str> = m["head"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.as_str().unwrap())
        .collect();
    assert_eq!(head, want_head, "{}", path.display());
    assert_eq!(
        tape.len() as u64,
        m["rows"].as_u64().unwrap(),
        "{}",
        path.display()
    );
    let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(digest, m["sha256"].as_str().unwrap(), "{}", path.display());
}

fn markets(source: &str) -> Vec<Value> {
    golden()["markets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["source"] == source)
        .cloned()
        .collect()
}

#[test]
fn fixture_markets_match_ts_golden() {
    let ms = markets("fixture");
    assert!(ms.len() >= 3, "{} fixture markets", ms.len());
    for m in &ms {
        check_market(m);
    }
}

#[test]
#[ignore = "needs the dataset under <repo>/data; run with --ignored on a host that has it"]
fn data_markets_match_ts_golden() {
    let ms = markets("data");
    assert!(!ms.is_empty());
    for m in &ms {
        let path = path_of(m);
        assert!(path.exists(), "{} is absent on this host", path.display());
        check_market(m);
    }
}
