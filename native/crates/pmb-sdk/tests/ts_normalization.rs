//! Rehearsal of golden PG-1 (30 §9 rule 9) on the derive: a struct that
//! mirrors the Zod `ConfigSchema` of `overnight-opus55-lagsnipe.v15`
//! (artifact 304eceb3…ab8, `data/strategy-artifacts/304eceb3…ab8.mjs:5-52`)
//! normalizes to values equal (rule 10) to the TS Zod-normalized params.
//!
//! The TS strings come from `fixtures/lagsnipe_params_golden.json`, written
//! by `fixtures/lagsnipe_params_gen.ts` with
//! `JSON.stringify(definition.schema.parse(input))` on the bundle (60 §7.1
//! GF-1/GF-2). The real PG-1 golden (stored `backtest_runs.params` of the
//! 60 §6.3 run) is a test of the `native/strategies` port (31 §7.1 gate 4).

use pmb_sdk::params::normalized_eq;
use pmb_sdk::prelude::*;

#[derive(Params, Clone, Debug, PartialEq)]
pub struct LagsnipeV15Params {
    #[param(default = 2e3, exclusive_min = 0)]
    pub lookback_ms: f64,
    #[param(default = 20, exclusive_min = 0)]
    pub move_usd: f64,
    #[param(default = 0.04, min = 0, max = 0.5)]
    pub min_edge: f64,
    /// Per-sqrt-second log vol used to translate a price move into probability.
    #[param(default = 1e-4, exclusive_min = 0)]
    pub sigma: f64,
    #[param(default = 840, exclusive_min = 0)]
    pub max_remaining_sec: f64,
    #[param(default = 10, min = 0)]
    pub min_remaining_sec: f64,
    #[param(default = 30, exclusive_min = 0)]
    pub stake_usd: f64,
    /// Stake at minEdge; defaults to stakeUsd (flat stake).
    #[param(exclusive_min = 0)]
    pub stake_min_usd: Option<f64>,
    #[param(default = 0.12, exclusive_min = 0, max = 1)]
    pub full_edge: f64,
    #[param(default = 3, min = 1)]
    pub max_trades: i64,
    #[param(default = 5e3, min = 0)]
    pub cooldown_ms: f64,
    #[param(default = 0.1, min = 0.01, max = 0.99)]
    pub min_price: f64,
    #[param(default = 0.9, min = 0.01, max = 0.99)]
    pub max_price: f64,
    #[param(default = 0.01, min = 0, max = 0.1)]
    pub slippage: f64,
    #[param(default = 0.04, min = 0, max = 1)]
    pub max_spread: f64,
    #[param(default = 1, min = 0, max = 5)]
    pub depth_frac: f64,
    #[param(default = 0, min = 0)]
    pub move_k: f64,
    #[param(default = 20, exclusive_min = 0)]
    pub move_min_usd: f64,
    #[param(default = 60, min = 5)]
    pub min_vol_sec: f64,
    #[param(default = 0, min = 0, max = 1)]
    pub sigma_adapt: f64,
    #[param(default = 3e-5, exclusive_min = 0)]
    pub sigma_min: f64,
    #[param(default = 0, min = 0)]
    pub max_rv: f64,
    #[param(default = -1, min = -1, max = 0.5)]
    pub abs_edge: f64,
    #[param(default = -1, min = -1, max = 0.5)]
    pub abs_hi: f64,
    #[param(default = 1, min = 0, max = 1)]
    pub abs_lo_frac: f64,
    #[param(default = -1, min = -1, max = 0.5)]
    pub fill_edge: f64,
    #[param(default = -1, min = -1, max = 0.1)]
    pub depth_slip: f64,
    #[param(default = -1, min = -1, max = 0.5)]
    pub rev_edge: f64,
    #[param(default = -1, min = -1, max = 0.5)]
    pub add_edge: f64,
    #[param(default = 15e3, exclusive_min = 0)]
    pub trend_ms: f64,
    #[param(default = -1, min = -1, max = 10)]
    pub trend_min: f64,
    #[param(default = 0.03, min = 0, max = 0.2)]
    pub imb_cents: f64,
    #[param(default = -1, min = -1, max = 1)]
    pub min_imb: f64,
}

const GOLDEN: &str = include_str!("fixtures/lagsnipe_params_golden.json");

/// `definition.schema.parse(..)` of the bundle for `case`.
fn ts(case: &str) -> String {
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).unwrap();
    golden["normalized"][case].as_str().unwrap().to_owned()
}

fn check(p: &LagsnipeV15Params, ts: &str) {
    let n = p.normalized_json();
    assert!(normalized_eq(&n, ts).unwrap(), "rust {n}\n  ts {ts}");
    // Idempotence, also when starting from the TS rendering.
    let from_ts = LagsnipeV15Params::from_json_str(ts).unwrap();
    assert_eq!(&from_ts, p);
    assert_eq!(from_ts.normalized_json(), n);
}

// spec: 30 §9 rule 9 (a)-like: defaults normalize to the TS defaults
#[test]
fn defaults_match_ts() {
    check(&LagsnipeV15Params::from_cli([]).unwrap(), &ts("defaults"));
}

// spec: 30 §9 rule 9 (b): an input with stakeMinUsd set, as CLI strings and as typed JSON
#[test]
fn set_values_match_ts() {
    let cli = LagsnipeV15Params::from_cli([
        "stakeMinUsd=12",
        "maxTrades=5",
        "sigma=0.0002",
        "minPrice=0.15",
        "absEdge=-0.5",
        "lookbackMs=1500",
    ])
    .unwrap();
    check(&cli, &ts("setCli"));
    let typed = LagsnipeV15Params::from_json_str(
        r#"{"stakeMinUsd":12,"maxTrades":5,"sigma":2e-4,"minPrice":0.15,"absEdge":-0.5,"lookbackMs":1500}"#,
    )
    .unwrap();
    check(&typed, &ts("setTyped"));
}

// spec: 30 §9 rule 9 (c): typed null and the CLI string "null" normalize to absent.
// (TS Zod rejects both: z.coerce turns null into 0 and "null" into NaN; the
// Rust rule is the normative one.)
#[test]
fn null_is_absent() {
    let typed = LagsnipeV15Params::from_json_str(r#"{"stakeMinUsd":null}"#).unwrap();
    let cli = LagsnipeV15Params::from_cli(["stakeMinUsd=null"]).unwrap();
    check(&typed, &ts("defaults"));
    check(&cli, &ts("defaults"));
}

// spec: 30 §9 rule 2: the Zod bounds hold (maxTrades .min(1), sigma .positive())
#[test]
fn bounds_match_zod() {
    assert!(LagsnipeV15Params::from_cli(["maxTrades=0"]).is_err());
    assert!(LagsnipeV15Params::from_cli(["sigma=0"]).is_err());
    assert!(LagsnipeV15Params::from_cli(["absEdge=-1"]).is_ok());
    assert!(LagsnipeV15Params::from_cli(["absEdge=-1.01"]).is_err());
}
