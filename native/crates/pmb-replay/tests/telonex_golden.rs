//! spec: 15 §2.1, §4.2; 60 §7.2 — telonex-delta decode and book reconstruction
//! against the TS golden (`native/fixtures/decode/telonex_book_gen.ts`).
//! Markets whose data file is absent on this host are skipped and reported.

use pmb_book::{Level, MarketBooks, OutcomeBook, Side};
use pmb_core::{MarketEvent, Outcome, QuoteSide};
use pmb_replay::{read_telonex_delta, TelonexInput};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
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

#[test]
fn telonex_book_matches_ts_golden() {
    let root = repo_root();
    let golden: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("native/fixtures/decode/telonex_book_golden.json")).unwrap(),
    )
    .unwrap();
    let mut checked = 0;
    for m in golden["markets"].as_array().unwrap() {
        let path = root.join("data").join(m["file"].as_str().unwrap());
        if !path.exists() {
            eprintln!("skip (no data on this host): {}", path.display());
            continue;
        }
        let toks: Vec<&str> = m["tokens"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect();
        // Golden token order is first-seen order; map it to UP/DOWN as given.
        let input = TelonexInput {
            format_version: 1,
            tokens: [toks[0], toks[1]],
            condition_id: None,
        };
        let tape = read_telonex_delta(&path, &input).unwrap();
        let mut books = MarketBooks::new();
        let mut seen: Vec<Outcome> = Vec::new();
        let mut hash = Sha256::new();
        let mut head = Vec::new();
        for ev in tape.events() {
            let ty = match ev.event {
                MarketEvent::Book {
                    outcome,
                    bids,
                    asks,
                } => {
                    if !seen.contains(&outcome) {
                        seen.push(outcome);
                    }
                    let lv = |p: &pmb_core::PriceSize| Level {
                        price: p.price,
                        size: p.size,
                    };
                    books.apply_snapshot(outcome, bids.iter().map(lv), asks.iter().map(lv));
                    "book"
                }
                MarketEvent::PriceChange { changes } => {
                    for c in changes {
                        if !seen.contains(&c.outcome) {
                            seen.push(c.outcome);
                        }
                        let side = match c.side {
                            QuoteSide::Bid => Side::Bid,
                            QuoteSide::Ask => Side::Ask,
                        };
                        books.apply_level(c.outcome, side, c.price, c.size);
                    }
                    "price_change"
                }
                _ => unreachable!(),
            };
            let mut parts = vec![ev.exchange_ts.0.to_string(), ty.to_string()];
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
        checked += 1;
    }
    eprintln!("checked {checked} markets");
}
