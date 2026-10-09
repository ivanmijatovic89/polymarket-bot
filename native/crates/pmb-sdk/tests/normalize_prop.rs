//! Property tests: normalization is idempotent and lossless (30 §9 rule 6,
//! 20 §5.1 `describe(describe(p).params).params == describe(p).params`).

mod common;

use pmb_sdk::prelude::*;
// Both preludes export a `Strategy`; the proptest one is meant here.
use proptest::prelude::*;
use proptest::strategy::Strategy;

#[derive(ParamEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leg {
    Maker,
    Taker,
}

#[derive(Params, Clone, Debug, PartialEq)]
pub struct Inner {
    #[param(default = 1, min = 0, max = 5)]
    pub depth_frac: f64,
}

#[derive(Params, Clone, Debug, PartialEq)]
pub struct P {
    pub size: Qty,
    #[param(min = 0.01, max = 0.99)]
    pub max_price: Price,
    #[param(exclusive_min = 0)]
    pub stake_usd: Usdc,
    #[param(exclusive_min = 0)]
    pub stake_min_usd: Option<f64>,
    #[param(min = 1)]
    pub max_trades: u32,
    pub cooldown: DurMs,
    pub sigma: f64,
    pub leg: Leg,
    pub dry: bool,
    pub label: String,
    pub ids: Vec<String>,
    pub fee: Rate,
    pub window: Option<Vec<i64>>,
    #[param(flatten)]
    pub inner: Inner,
}

fn finite() -> impl Strategy<Value = f64> {
    any::<f64>().prop_filter("finite", |v| v.is_finite())
}

fn positive() -> impl Strategy<Value = f64> {
    finite().prop_filter("positive", |v| *v > 0.0)
}

/// Largest params integer (21 §18 N2).
const SAFE: i64 = (1 << 53) - 1;
/// Largest micros of 15 significant digits (30 §9 rule 6).
const FIXED_15: i64 = 999_999_999_999_999;

prop_compose! {
    fn params()(
        size in -FIXED_15..=FIXED_15,
        max_price in 10_000i64..=990_000,
        stake_usd in 1i64..=FIXED_15,
        stake_min_usd in proptest::option::of(positive()),
        max_trades in 1u32..,
        cooldown in 0i64..=SAFE,
        sigma in finite(),
        taker in any::<bool>(),
        dry in any::<bool>(),
        label in any::<String>(),
        ids in proptest::collection::vec(any::<String>(), 0..3),
        fee in 0i64..=1_000_000,
        window in proptest::option::of(proptest::collection::vec(-SAFE..=SAFE, 0..3)),
        depth_frac in 0.0f64..=5.0,
    ) -> P {
        P {
            size: Qty::from_micros(size),
            max_price: Price::from_micros(max_price),
            stake_usd: Usdc::from_micros(stake_usd),
            stake_min_usd,
            max_trades,
            cooldown: pmb_sdk::__private::dur_ms(cooldown),
            // Parsing maps -0 to 0 (30 §9 table); generate canonical values.
            sigma: if sigma == 0.0 { 0.0 } else { sigma },
            leg: if taker { Leg::Taker } else { Leg::Maker },
            dry,
            label,
            ids,
            fee: Rate::from_micros(fee),
            window,
            inner: Inner { depth_frac: if depth_frac == 0.0 { 0.0 } else { depth_frac } },
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    // spec: 30 §9 rule 6 (idempotent, exact), rule 10 (values compare
    // equal), 21 §18 N2 (stored params read back through f64 are unchanged)
    #[test]
    fn normalize_round_trips(p in params()) {
        let n = p.normalized_json();
        let back = P::from_json_str(&n).unwrap();
        prop_assert_eq!(&back, &p);
        prop_assert_eq!(back.normalized_json(), n.clone());
        // TS stores the normalized params with JSON.parse/JSON.stringify:
        // every number becomes an f64 and is written back from it.
        let stored = P::from_json_str(&common::through_ts_storage(&n)).unwrap();
        prop_assert_eq!(stored.normalized_json(), n.clone());
        prop_assert!(pmb_sdk::params::normalized_eq(&n, &back.normalized_json()).unwrap());
        // Keys are sorted bytewise.
        let v: serde_json::Value = serde_json::from_str(&n).unwrap();
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        let mut sorted = keys.clone();
        sorted.sort();
        prop_assert_eq!(keys, sorted);
    }
}
