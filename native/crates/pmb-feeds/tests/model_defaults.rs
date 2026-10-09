//! The `feeds-2026-07-21` defaults of the feed layer equal the `feeds`
//! object of the committed ts-compat model config (14 §9, F-48, F-57; 21
//! §6.3, D57). The calibration file `native/contract/calibrations/feeds/
//! feeds-2026-07-21.json` (F-57) is owned by the contract step; once it is
//! committed, it gets the same check.

use pmb_feeds::{FeedsModel, Latency};
use serde_json::{json, Value};
use std::path::Path;

fn constant_ms(l: Latency) -> i64 {
    match l {
        Latency::Constant(d) => d.0,
    }
}

/// The 14 §9 `feeds` object for `m` under `calibration_id`.
fn feeds_object(calibration_id: &str, m: &FeedsModel) -> Value {
    json!({
        "calibrationId": calibration_id,
        "binance": { "latency": { "kind": "constant", "ms": constant_ms(m.binance) } },
        "chainlink": {
            "latency": { "kind": "constant", "ms": constant_ms(m.chainlink) },
            "maxGapMs": m.chainlink_max_gap_ms
        },
        "priceToBeat": { "latency": { "kind": "constant", "ms": constant_ms(m.price_to_beat) } }
    })
}

// spec: 14 §9 (defaults 110 / 320 + maxGapMs 300000 / 2700, constant
// kinds, calibrationId feeds-2026-07-21), F-48 (ts-compat uses the defaults)
#[test]
fn ts_compat_default_feeds_equal_the_engine_defaults() {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../contract/model-configs/ts-compat-default.json");
    let cfg: Value = serde_json::from_slice(&std::fs::read(&p).expect("read model config"))
        .expect("parse model config");
    assert_eq!(
        cfg["feeds"],
        feeds_object("feeds-2026-07-21", &FeedsModel::DEFAULTS_2026_07_21)
    );
    assert!(FeedsModel::DEFAULTS_2026_07_21.validate().is_ok());
}
