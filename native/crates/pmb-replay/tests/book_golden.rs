//! spec: 15 §2.1 I-6a–I-6f, §8 `deltaBeforeBook`; 60 §7.2 "Book semantics"
//! — `pmb_book::MarketBooks` against the TS `MarketOrderBookEngine` golden
//! (`native/fixtures/gen/book_gen.ts` → `native/fixtures/golden/book/`).
//! Lives in pmb-replay because pmb-book has no JSON dev-dependency.

use pmb_book::MarketBooks;
use pmb_core::fixed::parse_decimal;
use pmb_core::{LevelUpdate, MarketEvent, Outcome, Price, PriceSize, Qty, QuoteSide, TsMs};
use serde_json::Value;
use std::path::PathBuf;

fn golden() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/golden/book/book_golden.json");
    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

fn micros(v: &Value) -> i64 {
    let d = parse_decimal(s(v)).unwrap();
    assert!(!d.inexact, "golden decimals have at most 6 digits");
    d.micros
}

fn outcome(v: &Value) -> Outcome {
    match s(v) {
        "UP" => Outcome::Up,
        "DOWN" => Outcome::Down,
        other => panic!("asset {other}"),
    }
}

fn side(v: &Value) -> QuoteSide {
    match s(v) {
        "BUY" => QuoteSide::Bid,
        "SELL" => QuoteSide::Ask,
        other => panic!("side {other}"),
    }
}

fn levels(v: &Value) -> Vec<PriceSize> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|l| PriceSize {
            price: Price::from_micros(micros(&l[0])),
            size: Qty::from_micros(micros(&l[1])),
        })
        .collect()
}

/// `priceMicros:sizeMicros` levels joined by `,` (empty string: no levels).
fn pairs(v: &Value) -> Vec<(i64, i64)> {
    s(v).split(',')
        .filter(|l| !l.is_empty())
        .map(|l| {
            let (p, q) = l.split_once(':').unwrap();
            (p.parse().unwrap(), q.parse().unwrap())
        })
        .collect()
}

fn apply(books: &mut MarketBooks, msg: &Value) {
    let ty = s(&msg["type"]);
    if ty == "reset" {
        books.reset(None);
        return;
    }
    let ts = Some(TsMs(s(&msg["ts"]).parse::<i64>().unwrap()));
    match ty {
        "book" => {
            let (bids, asks) = (levels(&msg["bids"]), levels(&msg["asks"]));
            let ev = MarketEvent::Book {
                outcome: outcome(&msg["asset"]),
                bids: &bids,
                asks: &asks,
            };
            books.apply(ts, &ev);
        }
        "price_change" => {
            let changes: Vec<LevelUpdate> = msg["changes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| LevelUpdate {
                    outcome: outcome(&c[0]),
                    side: side(&c[1]),
                    price: Price::from_micros(micros(&c[2])),
                    size: Qty::from_micros(micros(&c[3])),
                })
                .collect();
            books.apply(ts, &MarketEvent::PriceChange { changes: &changes });
        }
        "last_trade_price" => {
            let ev = MarketEvent::LastTrade {
                outcome: outcome(&msg["asset"]),
                price: Price::from_micros(micros(&msg["price"])),
                size: Qty::from_micros(micros(&msg["size"])),
                side: Some(side(&msg["side"])),
            };
            books.apply(ts, &ev);
        }
        "tick_size_change" => {
            let ev = MarketEvent::TickSizeChange {
                outcome: outcome(&msg["asset"]),
                tick: Price::from_micros(micros(&msg["tick"])),
            };
            books.apply(ts, &ev);
        }
        other => panic!("message type {other}"),
    }
}

#[test]
fn books_match_ts_golden() {
    let g = golden();
    assert_eq!(
        s(&g["header"]["generator"]),
        "native/fixtures/gen/book_gen.ts"
    );
    let mut steps = 0;
    for sc in g["scenarios"].as_array().unwrap() {
        let name = s(&sc["name"]);
        let mut books = MarketBooks::new();
        for (i, step) in sc["steps"].as_array().unwrap().iter().enumerate() {
            apply(&mut books, &step["msg"]);
            let want = &step["expect"];
            let at = format!("{name} step {i}");
            assert_eq!(
                books.snapshot_ts().map_or(0, |t| t.0),
                want["timestamp"].as_i64().unwrap(),
                "{at}: snapshot time (I-6d)"
            );
            assert_eq!(
                books.counters.delta_before_book,
                want["deltaBeforeBook"].as_u64().unwrap(),
                "{at}: deltaBeforeBook"
            );
            let listed = want["books"].as_object().unwrap();
            for o in Outcome::ALL {
                match listed.get(o.label()) {
                    None => assert!(books.get(o).is_none(), "{at}: {o:?} listed (I-6e)"),
                    Some(b) => {
                        let got = books
                            .get(o)
                            .unwrap_or_else(|| panic!("{at}: {o:?} not listed"));
                        let lv = |side: &pmb_book::BookSide| -> Vec<(i64, i64)> {
                            side.levels()
                                .map(|l| (l.price.micros(), l.size.micros()))
                                .collect()
                        };
                        assert_eq!(lv(&got.bids), pairs(&b["bids"]), "{at}: {o:?} bids");
                        assert_eq!(lv(&got.asks), pairs(&b["asks"]), "{at}: {o:?} asks");
                        assert_eq!(
                            books.outcome_ts(o).map_or(0, |t| t.0),
                            b["timestamp"].as_i64().unwrap(),
                            "{at}: {o:?} timestamp"
                        );
                    }
                }
            }
            steps += 1;
        }
    }
    assert!(steps > 300, "golden has {steps} steps");
}
