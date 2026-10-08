//! Plugin outputs vs the TypeScript plugins on deterministic sequences.
//! Fixture: `tests/fixtures/plugins_golden.json`, produced by
//! `tests/fixtures/plugins_gen.ts` running the real TS plugins.

use super::*;
use crate::fixed::{Price, Qty};
use crate::market::Book;
use crate::model::AssetId;
use serde_json::Value;

const GOLDEN: &str = include_str!("../../tests/fixtures/plugins_golden.json");

fn book(bid_cents: &Value, ask_cents: &Value, ts: i64) -> Book {
    let mut b = Book {
        ts_ms: ts,
        initialized: true,
        ..Book::default()
    };
    if let Some(c) = bid_cents.as_i64() {
        b.bids.insert(Price::from_micros(c * 10_000), Qty::from_micros(100_000_000));
    }
    if let Some(c) = ask_cents.as_i64() {
        b.asks.insert(Price::from_micros(c * 10_000), Qty::from_micros(100_000_000));
    }
    b
}

fn market(up: &str, down: &str, start_ms: i64) -> MarketInfo {
    MarketInfo {
        slug: Some(format!("btc-updown-15m-{}", start_ms / 1000)),
        condition_id: None,
        assets: [AssetId::new(up), AssetId::new(down)],
        start_ms: Some(start_ms),
        end_ms: Some(start_ms + 900_000),
    }
}

/// Structural JSON equality with a float tolerance.
fn assert_json_close(path: &str, got: &Value, want: &Value) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            let tol = 1e-12 * a.abs().max(b.abs()).max(1.0);
            assert!((a - b).abs() <= tol, "{path}: got {a}, want {b}");
        }
        (Value::Object(a), Value::Object(b)) => {
            let ka: Vec<_> = a.keys().collect();
            let kb: Vec<_> = b.keys().collect();
            assert_eq!(ka, kb, "{path}: keys differ");
            for (k, v) in b {
                assert_json_close(&format!("{path}.{k}"), &a[k], v);
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}: length differs");
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                assert_json_close(&format!("{path}[{i}]"), x, y);
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}

fn request_for(name: &str) -> PluginRequest {
    match name {
        "mid_vol_bid_dwell_gate" => PluginRequest {
            time_window_volatility: Some(TimeWindowVolatilityConfig {
                windows: [("1s", 1000), ("5s", 5000), ("30s", 30000)]
                    .into_iter()
                    .map(|(k, v)| (k.to_owned(), v))
                    .collect(),
                track_price: VolPrice::Mid,
            }),
            dwell_gate: Some(DwellGateConfig {
                from: 0.6,
                to: 0.4,
                required_ms: 3000,
                track_price: BidOrAsk::Bid,
            }),
            time_window_gate: Some(TimeWindowGateConfig {
                allow_after_ms: 10_000,
                disable_after_ms: 400_000,
            }),
            ..PluginRequest::default()
        },
        "bid_vol_ask_dwell" => PluginRequest {
            time_window_volatility: Some(TimeWindowVolatilityConfig {
                windows: [("w2", 2000), ("w10", 10000)]
                    .into_iter()
                    .map(|(k, v)| (k.to_owned(), v))
                    .collect(),
                track_price: VolPrice::Bid,
            }),
            dwell_gate: Some(DwellGateConfig {
                from: 0.3,
                to: 0.7,
                required_ms: 1500,
                track_price: BidOrAsk::Ask,
            }),
            ..PluginRequest::default()
        },
        other => panic!("unknown scenario {other}"),
    }
}

#[test]
fn plugin_sequences_match_typescript() {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let (up, down) = (
        golden["upAsset"].as_str().unwrap(),
        golden["downAsset"].as_str().unwrap(),
    );
    for sc in golden["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let info = market(up, down, sc["marketStartMs"].as_i64().unwrap());
        let mut set = PluginSet::new(&request_for(name), &info, &PluginDeps::default()).unwrap();
        let mut books = MarketBooks::new(info.assets.clone());
        let expected = sc["expected"].as_array().unwrap();
        let mut next = expected.iter().peekable();
        let mut compared = 0;
        for (i, t) in sc["ticks"].as_array().unwrap().iter().enumerate() {
            let ts = t["ts"].as_i64().unwrap();
            let synthetic = t["synthetic"].as_bool().unwrap();
            if !synthetic {
                books.books[0] = book(&t["up"]["bid"], &t["up"]["ask"], ts);
                books.books[1] = book(&t["down"]["bid"], &t["down"]["ask"], ts);
                books.ts_ms = ts;
            }
            let snap = set.on_tick(&books, ts, synthetic, &FeedsSnapshot::default());
            if let Some(e) = next.next_if(|e| e["i"].as_u64() == Some(i as u64)) {
                let got = serde_json::to_value(snap).unwrap();
                assert_json_close(&format!("{name}#{i}"), &got, &e["snapshot"]);
                compared += 1;
            }
        }
        assert_eq!(compared, expected.len(), "{name}: not every expected tick was compared");
        assert!(compared > 50);
    }
}

fn candles(rows: &Value) -> Vec<Candle> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|r| Candle {
            open_time: r[0].as_i64().unwrap(),
            open: r[1].as_f64().unwrap(),
            high: r[2].as_f64().unwrap(),
            low: r[3].as_f64().unwrap(),
            close: r[4].as_f64().unwrap(),
            volume: r[5].as_f64().unwrap(),
            close_time: r[6].as_i64().unwrap(),
        })
        .collect()
}

#[test]
fn technical_indicators_match_typescript() {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let ta = &golden["ta"];
    assert!(ta["expected"].is_object(), "TS fixture produced no TA snapshot");
    let source = MemoryCandleSource {
        h1: candles(&ta["h1"]),
        m15: candles(&ta["m15"]),
    };
    let deps = PluginDeps {
        candles: Some(Arc::new(source)),
    };
    let slug = ta["slug"].as_str().unwrap();
    let start: i64 = slug.rsplit('-').next().unwrap().parse::<i64>().unwrap() * 1000;
    let info = market("A", "B", start);
    let req = PluginRequest {
        technical_indicators: Some(TechnicalIndicatorsConfig::default()),
        ..PluginRequest::default()
    };
    let mut set = PluginSet::new(&req, &info, &deps).unwrap();
    let books = MarketBooks::new(info.assets.clone());
    // Synthetic ticks never trigger the computation.
    assert!(set
        .on_tick(&books, start, true, &FeedsSnapshot::default())
        .technical_indicators
        .is_none());
    let snap = set.on_tick(&books, start + 10, false, &FeedsSnapshot::default());
    let got = serde_json::to_value(&snap.technical_indicators).unwrap();
    assert_json_close("ta", &got, &ta["expected"]);
}

#[test]
fn technical_indicators_require_a_candle_source() {
    let req = PluginRequest {
        technical_indicators: Some(TechnicalIndicatorsConfig::default()),
        ..PluginRequest::default()
    };
    let info = market("A", "B", 1_760_140_800_000);
    assert!(PluginSet::new(&req, &info, &PluginDeps::default()).is_err());
}

#[test]
fn technical_indicators_misaligned_candles_yield_none() {
    let start = 1_760_140_800_000;
    // 15m candles end one window early -> misalignment -> no snapshot, no retry.
    let mk = |interval: i64, last_open: i64, n: i64| -> Vec<Candle> {
        (0..n)
            .map(|i| {
                let open_time = last_open - (n - 1 - i) * interval;
                Candle {
                    open_time,
                    open: 100.0,
                    high: 101.0,
                    low: 99.0,
                    close: 100.5,
                    volume: 1.0,
                    close_time: open_time + interval - 1,
                }
            })
            .collect()
    };
    let source = MemoryCandleSource {
        h1: mk(3_600_000, start - 3_600_000, 200),
        m15: mk(900_000, start - 1_800_000, 60),
    };
    let deps = PluginDeps {
        candles: Some(Arc::new(source)),
    };
    let req = PluginRequest {
        technical_indicators: Some(TechnicalIndicatorsConfig::default()),
        ..PluginRequest::default()
    };
    let info = market("A", "B", start);
    let mut set = PluginSet::new(&req, &info, &deps).unwrap();
    let books = MarketBooks::new(info.assets.clone());
    assert!(set
        .on_tick(&books, start, false, &FeedsSnapshot::default())
        .technical_indicators
        .is_none());
}

#[test]
fn snapshot_is_cached_between_ticks() {
    let info = market("A", "B", 1_000_000);
    let req = request_for("mid_vol_bid_dwell_gate");
    let mut set = PluginSet::new(&req, &info, &PluginDeps::default()).unwrap();
    let mut books = MarketBooks::new(info.assets.clone());
    books.books[0] = book(&Value::from(50), &Value::from(52), 1_000_100);
    books.books[1] = book(&Value::from(48), &Value::from(50), 1_000_100);
    let first = set
        .on_tick(&books, 1_000_100, false, &FeedsSnapshot::default())
        .clone();
    assert_eq!(set.snapshot(), &first);
    // A synthetic tick leaves the volatility windows untouched but moves the gates.
    let after = set
        .on_tick(&books, 1_020_000, true, &FeedsSnapshot::default())
        .clone();
    assert_eq!(after.time_window_volatility, first.time_window_volatility);
    assert_ne!(after.time_window_gate, first.time_window_gate);
}
