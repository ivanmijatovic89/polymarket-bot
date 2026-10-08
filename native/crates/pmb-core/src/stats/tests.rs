//! `compute_market_stats` vs the TypeScript `computeMarketStats`.
//! Fixture: `tests/fixtures/stats_golden.json` (from `stats_gen.ts`).

use super::*;
use crate::fixed::{parse_micros, Price};
use crate::model::{ClientOrderId, IntentMeta};
use serde_json::Value;
use std::sync::Arc;

const GOLDEN: &str = include_str!("../../tests/fixtures/stats_golden.json");

fn micros(v: &Value) -> i64 {
    parse_micros(&v.to_string()).unwrap_or_else(|| panic!("not a decimal: {v}"))
}

fn fill(i: usize, t: &Value) -> Fill {
    Fill {
        id: Arc::from(format!("f{i}")),
        ts_ms: 1_000 + i as i64,
        market: None,
        asset_id: AssetId::new(t["assetId"].as_str().unwrap()),
        side: serde_json::from_value(t["side"].clone()).unwrap(),
        price: Price::from_micros(micros(&t["price"])),
        size: Qty::from_micros(micros(&t["size"])),
        fee: Usdc::from_micros(micros(&t["fee"])),
        client_order_id: t["clientOrderId"].as_str().map(ClientOrderId::new),
        order_id: None,
        liquidity: serde_json::from_value(t["liquidity"].clone()).ok(),
        meta: t["intentMeta"]
            .as_object()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect::<IntentMeta>()),
    }
}

#[test]
fn market_stats_match_typescript() {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let up = AssetId::new(golden["upAsset"].as_str().unwrap());
    let down = AssetId::new(golden["downAsset"].as_str().unwrap());
    for c in golden["cases"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let trades: Vec<Fill> = c["trades"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, t)| fill(i, t))
            .collect();
        let splits: Vec<SplitRecord> = c["splits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| SplitRecord {
                size: Qty::from_micros(micros(&s["size"])),
                cost: Usdc::from_micros(micros(&s["splitCost"])),
            })
            .collect();
        let positions: BTreeMap<AssetId, Position> = c["positions"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(a, p)| {
                (
                    AssetId::new(a),
                    Position {
                        qty: Qty::from_micros(micros(&p["qty"])),
                        cost_basis: Usdc::from_micros(micros(&p["costBasis"])),
                    },
                )
            })
            .collect();
        let stats = compute_market_stats(&MarketStatsInput {
            market_id: "0xmarket",
            slug: "btc-updown-15m-1760140800",
            trades: &trades,
            splits: &splits,
            positions: &positions,
            realized_pnl: Usdc::from_micros(micros(&c["realizedPnl"])),
            final_outcome: serde_json::from_value(c["finalOutcome"].clone()).unwrap(),
            up_asset: &up,
            down_asset: &down,
        });
        let got = serde_json::to_value(&stats).unwrap();
        let want = &c["expected"];
        let (go, wo) = (got.as_object().unwrap(), want.as_object().unwrap());
        let mut gk: Vec<_> = go.keys().collect();
        let mut wk: Vec<_> = wo.keys().collect();
        gk.sort();
        wk.sort();
        assert_eq!(gk, wk, "{name}: field names");
        for (k, w) in wo {
            let g = &go[k];
            match (g.as_f64(), w.as_f64()) {
                (Some(a), Some(b)) => assert!((a - b).abs() < 1e-9, "{name}.{k}: got {a}, want {b}"),
                _ => assert_eq!(g, w, "{name}.{k}"),
            }
        }
        // Round-trips through the TS JSON shape.
        let back: MarketStats = serde_json::from_value(want.clone()).unwrap();
        assert_eq!(back.final_outcome, stats.final_outcome);
    }
}

#[test]
fn optional_fields_serialize_like_typescript() {
    let positions = BTreeMap::new();
    let (up, down) = (AssetId::new("U"), AssetId::new("D"));
    let mut s = compute_market_stats(&MarketStatsInput {
        market_id: "m",
        slug: "s",
        trades: &[],
        splits: &[],
        positions: &positions,
        realized_pnl: Usdc::ZERO,
        final_outcome: Outcome::Up,
        up_asset: &up,
        down_asset: &down,
    });
    let v = serde_json::to_value(&s).unwrap();
    for k in ["skipReason", "execution", "recorderV4Capture"] {
        assert!(v.get(k).is_none(), "{k} must be omitted when absent");
    }
    s.skip_reason = Some(StatsSkipReason::NoInWindowActivity);
    s.execution = Some(MarketExecutionMeta {
        machine_id: "abc".into(),
        worker_child_id: None,
        started_at_ms: 1,
        finished_at_ms: 5,
        duration_ms: 4,
        events_processed: 2,
        events_by_type: BTreeMap::from([("book".to_owned(), 1), ("price_change".to_owned(), 1)]),
        commit_sha: "deadbeef".into(),
    });
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["skipReason"], "no_in_window_activity");
    assert_eq!(v["execution"]["workerChildId"], Value::Null);
    assert_eq!(v["execution"]["eventsByType"]["book"], 1);
    assert_eq!(v["execution"]["commitSha"], "deadbeef");
}

#[test]
fn pnl_rounds_half_up_like_math_round() {
    let positions = BTreeMap::new();
    let (up, down) = (AssetId::new("U"), AssetId::new("D"));
    let stats = |realized: i64| {
        compute_market_stats(&MarketStatsInput {
            market_id: "m",
            slug: "s",
            trades: &[],
            splits: &[],
            positions: &positions,
            realized_pnl: Usdc::from_micros(realized),
            final_outcome: Outcome::Up,
            up_asset: &up,
            down_asset: &down,
        })
        .pnl
    };
    assert_eq!(stats(1_005_000), 1.01);
    assert_eq!(stats(-1_005_000), -1.0);
    assert_eq!(stats(-1_005_001), -1.01);
}

#[test]
fn telonex_resolution() {
    let r = MarketResolution::from_telonex(Some("a0"), Some("a1"), Some("resolved"), Some("1")).unwrap();
    assert_eq!(r.outcome, Some(Outcome::Down));
    assert_eq!(r.up_asset(), Some("a0"));
    assert_eq!(r.down_asset(), Some("a1"));
    let r = MarketResolution::from_telonex(Some("a0"), Some("a1"), Some("resolved"), Some("0")).unwrap();
    assert_eq!(r.outcome, Some(Outcome::Up));
    let r = MarketResolution::from_telonex(Some("a0"), Some("a1"), Some("active"), Some("0")).unwrap();
    assert_eq!(r.outcome, None);
    let r = MarketResolution::from_telonex(Some("a0"), Some("a1"), Some("resolved"), Some("7")).unwrap();
    assert_eq!(r.outcome, None);
    assert!(MarketResolution::from_telonex(None, Some("a1"), None, None).is_none());
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json, serde_json::json!({"tokenMap": {"DOWN": "a1", "UP": "a0"}, "outcome": null}));
}

#[test]
fn gamma_resolution() {
    let outcomes = vec!["Up".to_owned(), "Down".to_owned()];
    let ids = vec!["t0".to_owned(), "t1".to_owned()];
    let r = MarketResolution::from_gamma(&outcomes, &ids, Some("Down")).unwrap();
    assert_eq!(r.outcome, Some(Outcome::Down));
    assert_eq!(r.up_asset(), Some("t0"));
    assert_eq!(MarketResolution::from_gamma(&outcomes, &ids, None).unwrap().outcome, None);
    let yes_no = vec!["Yes".to_owned(), "No".to_owned()];
    assert!(MarketResolution::from_gamma(&yes_no, &ids, Some("Yes")).is_none());
    assert_eq!(normalize_outcome("up"), Some(Outcome::Up));
    assert_eq!(normalize_outcome("maybe"), None);
}
