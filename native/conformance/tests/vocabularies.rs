// spec: 21 §17, 20 §4, 20 §4.1, 20 §4.4, 10 §10.2, 10 §9.2, 12 §5.3, 11 RS4, 22 §3.2
//
// G2 row "contract vocabularies (21 §17)". The data tests check the
// transcription itself (closed sets, patterns, exit codes, drift guard); C2
// compares each set with what `schema`/`describe` of the artifact binary
// exports and with the generated JSON Schema bundle (21 §3).

use pmb_conformance::vectors::{self, rows, s};
use serde_json::Value;
use std::collections::BTreeSet;

fn file() -> Value {
    vectors::load("vocabularies")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} missing"))
}

fn values(r: &Value) -> Vec<String> {
    r["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Object(o) => o["variant"].as_str().unwrap().to_string(),
            other => panic!("unexpected value {other}"),
        })
        .collect()
}

fn matches_cause_pattern(s: &str) -> bool {
    // ^[a-z][a-z0-9_]{0,47}$
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 48
        && b[0].is_ascii_lowercase()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 21 §17 — every closed set has unique values
#[test]
fn closed_sets_have_unique_values() {
    for r in rows(&file()) {
        if r.get("values").is_none() {
            continue;
        }
        let v = values(r);
        let set: BTreeSet<&String> = v.iter().collect();
        assert_eq!(set.len(), v.len(), "{} has duplicates", vectors::id(r));
    }
}

// spec: 20 §4 — classes and exit codes
#[test]
fn error_classes_and_exit_codes() {
    let r = row("voc-error-class");
    let classes = values(&r);
    assert_eq!(
        classes,
        [
            "runtime",
            "invalid_input",
            "data_missing",
            "data_defect",
            "timeout",
            "invalid_output",
            "strategy_fault",
            "engine_fault",
            "canceled",
            "killed"
        ]
    );
    let codes = r["exit_codes"].as_object().unwrap();
    for (class, code) in [
        ("runtime", 1),
        ("invalid_input", 2),
        ("data_missing", 3),
        ("data_defect", 4),
        ("timeout", 5),
        ("invalid_output", 6),
        ("strategy_fault", 7),
        ("engine_fault", 8),
    ] {
        assert_eq!(codes[class], code, "{class}");
    }
    assert_eq!(codes["engine_fault_escaped_panic"], 101);
    assert!(codes["canceled"].is_null());
    let never: Vec<&str> = r["never_retried"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(
        never,
        [
            "invalid_input",
            "data_defect",
            "strategy_fault",
            "engine_fault",
            "invalid_output",
            "killed"
        ]
    );
}

// spec: 20 §4.1 — every known cause matches ^[a-z][a-z0-9_]{0,47}$ and is listed under a known class
#[test]
fn causes_match_pattern_and_classes() {
    let r = row("voc-error-cause");
    assert_eq!(s(&r, "pattern"), "^[a-z][a-z0-9_]{0,47}$");
    let classes = values(&row("voc-error-class"));
    let known = r["known"].as_object().unwrap();
    for (class, causes) in known {
        assert!(classes.contains(class), "class {class}");
        for c in causes.as_array().unwrap() {
            assert!(matches_cause_pattern(c.as_str().unwrap()), "cause {c}");
        }
    }
    assert!(known["timeout"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c == "deadline"));
    assert!(known["strategy_fault"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c == "cascade_limit"));
    assert!(!matches_cause_pattern("Deadline"));
    assert!(!matches_cause_pattern("a-b"));
}

// spec: 21 §14 — failure_class = every class except canceled, plus the three aggregator classes
#[test]
fn failure_class_set() {
    let fc = values(&row("voc-failure-class"));
    let classes = values(&row("voc-error-class"));
    for c in &classes {
        if c == "canceled" {
            assert!(!fc.contains(c));
        } else {
            assert!(fc.contains(c), "{c}");
        }
    }
    for extra in [
        "market_skip",
        "missing_child_result",
        "invalid_market_stats",
    ] {
        assert!(fc.contains(&extra.to_string()));
    }
}

// spec: 20 §4.4 — superseded class names never appear in this crate's vector files
#[test]
fn drift_guard_superseded_names_absent() {
    let superseded = values(&row("voc-superseded-names"));
    assert_eq!(
        superseded,
        [
            "input_invalid",
            "data_unavailable",
            "runtime_error",
            "strategy_panic",
            "executor_crash",
            "output_invalid"
        ]
    );
    for entry in std::fs::read_dir(vectors::dir()).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        // The vocabulary file lists the names once, in the drift-guard row itself.
        let allowed = path.file_name().unwrap() == "vocabularies.json";
        for name in &superseded {
            let count = text.matches(name.as_str()).count();
            if allowed {
                assert!(
                    count <= 2,
                    "{name} appears {count} times in vocabularies.json"
                );
            } else {
                assert_eq!(count, 0, "{name} appears in {}", path.display());
            }
        }
        let _ = v;
    }
}

// spec: 10 §10.2 — the TS strings of reject reasons, as the trace renderer must print them
#[test]
fn reject_reason_ts_strings() {
    let r = row("voc-reject-reason-engine");
    let find = |variant_prefix: &str| -> Option<String> {
        r["values"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["variant"].as_str().unwrap().starts_with(variant_prefix))
            .and_then(|v| v["ts_string"].as_str().map(str::to_string))
    };
    assert_eq!(find("InvalidPrice").as_deref(), Some("invalid_price"));
    assert_eq!(find("InvalidSize").as_deref(), Some("invalid_size"));
    assert_eq!(find("UnknownOutcome").as_deref(), Some("missing_assetId"));
    assert_eq!(
        find("PostOnlyRequiresResting").as_deref(),
        Some("post_only_requires_gtc_or_gtd")
    );
    assert_eq!(
        find("GtdRequiresExpiry").as_deref(),
        Some("gtd_requires_expireAtMs")
    );
    assert_eq!(
        find("GtdExpiryTooSoon").as_deref(),
        Some("gtd_expireAtMs_too_soon(min_offset_ms=60000)")
    );
    assert_eq!(
        find("InsufficientCapital").as_deref(),
        Some("insufficient_capital(required=X,available=Y)")
    );
    assert_eq!(
        find("RiskMaxOpenOrders").as_deref(),
        Some("risk_max_open_orders(max=100)")
    );
    assert_eq!(
        find("BatchTooLarge").as_deref(),
        Some("batch_too_large(max_15_orders)")
    );
    assert_eq!(find("SelfCross"), None);
    let x = row("voc-reject-reason-exchange");
    assert!(x["values"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["ts_string"] == "post_only_would_cross"));
}

// spec: 10 §9.2 — settlement status ranks and TS strings
#[test]
fn settlement_status_ranks() {
    let r = row("voc-settlement-status");
    let vals = r["values"].as_array().unwrap();
    let get = |name: &str| vals.iter().find(|v| v["variant"] == name).unwrap().clone();
    assert_eq!(get("Matched")["rank"], 1);
    assert_eq!(get("Mined")["rank"], 2);
    assert_eq!(get("Confirmed")["rank"], 3);
    assert_eq!(get("Confirmed")["terminal"], true);
    assert_eq!(get("Failed")["terminal"], true);
    assert_eq!(get("Retrying")["rank"], "keeps previous");
    for (v, ts) in [
        ("Matched", "MATCHED"),
        ("Mined", "MINED"),
        ("Confirmed", "CONFIRMED"),
        ("Retrying", "RETRYING"),
        ("Failed", "FAILED"),
    ] {
        assert_eq!(get(v)["ts_string"], ts);
    }
}

// spec: 12 §5.3, 21 §15 — tick causes
#[test]
fn tick_causes() {
    assert_eq!(
        values(&row("voc-events-by-type")),
        [
            "book",
            "price_change",
            "binance_agg_trade",
            "chainlink_round"
        ]
    );
}

// spec: 21 §3 (schema bundle), 21 §17 — the binary's exported enums equal these sets
// C2: run `<artifact> schema`, parse schemas.engineResult / engineJob / traceRecord,
// and assert each enum's values equal the vector sets (profile, inputMode,
// skipReason, rulesSource, origin, phase, captured keys, error class, feed ids).
#[test]
#[ignore = "C2-gap: needs the artifact binary (20 §5.2)"]
fn schema_enums_equal_vectors() {
    todo!("C2: compare `schema` output enums with vocabularies.json");
}

// spec: 20 §3, 20 §5.1 — describe capabilities use the closed sets
#[test]
#[ignore = "C2-gap: needs the artifact binary (20 §5.1)"]
fn describe_capabilities_closed_sets() {
    todo!("C2: capabilities.inputModes ⊆ inputMode set; profiles == {{ts-compat, realistic}}; realOrders == false");
}

// spec: 21 §17 (unknown value is a schema violation, never passed through)
#[test]
#[ignore = "C2-gap: needs the artifact binary"]
fn unknown_enum_value_is_invalid_input() {
    todo!("C2: job with profile \"fast\" or inputMode \"recorded\" -> exit 2, class invalid_input");
}
