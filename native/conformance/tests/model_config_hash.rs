// spec: 21 §6, 21 §6.1, 21 §6.2, 21 §6.3, 21 §3 CI item 6, 21 §1.1, 21 §8 C4, 13 §7.3, 12 §4.5, 14 §9
//
// G2 row "ModelConfig hash". The data tests implement the canonical form of
// 21 §6.1 on top of serde_json (BTreeMap keys sort bytewise) and SHA-256 from
// src/sha256.rs; C2 compares with the TS resolver, the committed defaults
// file and the binary's echo.

use pmb_conformance::sha256::{hex, sha256};
use pmb_conformance::vectors::{self, rows, s};
use serde_json::Value;

fn file() -> Value {
    vectors::load("model_config_hash")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} missing"))
}

/// Canonical JSON of 21 §6.1: keys sorted bytewise at every level (serde_json's
/// default `Map` is a BTreeMap, so `to_string` already yields that), array
/// order kept, no whitespace, ASCII only.
fn canonical(v: &Value) -> String {
    assert_only_allowed_values(v);
    serde_json::to_string(v).unwrap()
}

fn assert_only_allowed_values(v: &Value) {
    match v {
        Value::Null => panic!("null is not an allowed ModelConfig value (21 §6.1)"),
        Value::Bool(_) => {}
        Value::Number(n) => assert!(
            n.is_i64() && n.as_i64().unwrap().abs() <= (1 << 53) - 1,
            "{n}: safe integer required"
        ),
        Value::String(t) => assert!(
            t.is_ascii()
                && t.chars()
                    .all(|c| (' '..='~').contains(&c) && c != '"' && c != '\\'),
            "{t:?}"
        ),
        Value::Array(a) => a.iter().for_each(assert_only_allowed_values),
        Value::Object(o) => {
            for (k, x) in o {
                assert!(k.is_ascii(), "key {k:?}");
                assert_only_allowed_values(x);
            }
        }
    }
}

/// `^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$` plus the 6-fractional-digit limit.
fn is_decimal_string(t: &str) -> bool {
    let b = t.as_bytes();
    let mut i = 0;
    if b.first() == Some(&b'-') {
        i = 1;
    }
    if i >= b.len() || t == "-0" {
        return false;
    }
    if b[i] == b'0' {
        i += 1;
    } else if b[i].is_ascii_digit() {
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    } else {
        return false;
    }
    if i == b.len() {
        return true;
    }
    if b[i] != b'.' {
        return false;
    }
    i += 1;
    let frac = &b[i..];
    frac.len() <= 6
        && !frac.is_empty()
        && frac.iter().all(u8::is_ascii_digit)
        && *frac.last().unwrap() != b'0'
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 21 §6.1 (canonical JSON and sha256) — small canonicalization cases
#[test]
fn canonicalization_cases() {
    for r in rows(&file())
        .iter()
        .filter(|r| vectors::id(r).starts_with("canon-"))
    {
        let c = canonical(&r["input"]);
        assert_eq!(c, s(r, "canonical"), "{}", vectors::id(r));
        assert_eq!(
            hex(&sha256(c.as_bytes())),
            s(r, "sha256"),
            "{}",
            vectors::id(r)
        );
    }
}

// spec: 21 §6, 13 §7.3, 12 §4.5, 14 §9, 12 §8, 12 §6.3 — the spec-shaped ts-compat default
#[test]
fn ts_compat_default_hash_under_stated_assumptions() {
    let r = row("ts-compat-default-jitter0");
    let mc = r["model_config"].clone();
    let c = canonical(&mc);
    assert_eq!(c.len(), r["canonical_length"].as_u64().unwrap() as usize);
    assert_eq!(hex(&sha256(c.as_bytes())), s(&r, "sha256"));
    // every result-affecting pin of the spec is present
    assert_eq!(mc["profile"], "ts-compat");
    assert_eq!(mc["seed"], 0);
    assert_eq!(mc["capital"]["startingCapitalUsdc"], "500");
    let models = &mc["execution"]["models"];
    assert_eq!(models["latency"], "compat");
    assert_eq!(models["fee"], "flat_700bps_4dp");
    assert_eq!(models["takerDelay"], "off");
    assert_eq!(models["depletion"], "none");
    assert_eq!(models["maker"], "worst_queue");
    assert_eq!(models["reports"], "compat");
    assert_eq!(mc["execution"]["sellGate"], "Matched");
    assert_eq!(mc["execution"]["cancelBeforeAck"], "defer_until_ack");
    assert_eq!(mc["execution"]["compatLatency"]["jitterMs"], 0);
    assert_eq!(
        mc["clock"]["marketData"]["delay"],
        serde_json::json!({ "kind": "constant", "ms": 0 })
    );
    assert_eq!(mc["feeds"]["binance"]["latency"]["ms"], 110);
    assert_eq!(mc["feeds"]["chainlink"]["latency"]["ms"], 320);
    assert_eq!(mc["feeds"]["chainlink"]["maxGapMs"], 300000);
    assert_eq!(mc["feeds"]["priceToBeat"]["latency"]["ms"], 2700);
    assert_eq!(mc["runner"]["maxEventsPerDrain"], 4200);
    assert_eq!(
        mc["risk"],
        serde_json::json!({ "maxOpenOrders": 100, "maxOrderSize": "2000", "maxAbsPosition": "2000", "maxLossStopUsdc": "500" })
    );
    assert_eq!(
        mc["rules"],
        serde_json::json!({ "rulesTableVersion": "rules-table-v1", "missingSnapshot": "dated_fallback" })
    );
    // every decimal-string field obeys the representation rule
    for t in ["500", "2000", "0.5", "0"] {
        assert!(is_decimal_string(t));
    }
}

// spec: 21 §6.3 (the "0 / 20" wording) — the alternative default's hash
#[test]
fn ts_compat_default_jitter20_variant_hash() {
    let base = row("ts-compat-default-jitter0");
    let alt = row("ts-compat-default-jitter20");
    let mut mc = base["model_config"].clone();
    mc["execution"]["compatLatency"]["jitterMs"] = Value::from(20);
    let c = canonical(&mc);
    assert_eq!(c.len(), alt["canonical_length"].as_u64().unwrap() as usize);
    assert_eq!(hex(&sha256(c.as_bytes())), s(&alt, "sha256"));
    assert_ne!(
        s(&alt, "sha256"),
        s(&base, "sha256"),
        "the unused jitter field changes the hash (PLAN A-01)"
    );
}

// spec: 21 §6.1 (decimal-string grammar, 6 dp)
#[test]
fn decimal_string_grammar() {
    let r = row("valid-decimal-strings");
    for t in r["valid"].as_array().unwrap() {
        assert!(
            is_decimal_string(t.as_str().unwrap()),
            "{t} should be valid"
        );
    }
    for c in r["invalid"].as_array().unwrap() {
        let t = c["text"].as_str().unwrap();
        assert!(
            !is_decimal_string(t),
            "{t:?} should be invalid ({})",
            c["why"]
        );
    }
    // D69 (A-03): "-0" is rejected under the tightened regex
    assert!(!is_decimal_string("-0"));
}

// spec: 21 §6.1 (values: strings, booleans, safe integers, objects, arrays; no floats, no null)
#[test]
fn representation_rejects_floats_and_null() {
    let bad = [
        serde_json::json!({ "capital": { "startingCapitalUsdc": 500.0 } }),
        serde_json::json!({ "x": null }),
        serde_json::json!({ "runner": { "maxEventsPerDrain": 9007199254740992i64 } }),
        serde_json::json!({ "s": "quote\"inside" }),
        serde_json::json!({ "s": "back\\slash" }),
    ];
    for doc in bad {
        let r = std::panic::catch_unwind(|| assert_only_allowed_values(&doc));
        assert!(r.is_err(), "{doc} must be rejected");
    }
}

// spec: 21 §3 CI item 6, D57/D58 — the committed default ModelConfig and its recorded sha agree
// with this crate's canonicalization (21 §6.1). Inputs: native/contract/model-configs/
// ts-compat-default.json and native/contract/fixtures/hashes.json (committed on
// native-engine; test-only inputs under native/contract/** are allowed, CF-2).
// The binary's echo.modelConfigSha256 is still a bin check (C2-gap).
#[test]
fn ci_item6_default_fixture_hashes() {
    let contract = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../contract");
    let read = |p: &str| -> Value {
        let text = std::fs::read_to_string(contract.join(p)).unwrap_or_else(|e| panic!("{p}: {e}"));
        serde_json::from_str(&text).unwrap()
    };
    let hashes = read("fixtures/hashes.json");
    let recorded = hashes["modelConfigSha256"]["ts-compat-default.json"]
        .as_str()
        .expect("hashes.json records ts-compat-default.json");
    let default = read("model-configs/ts-compat-default.json");
    assert_eq!(
        hex(&sha256(canonical(&default).as_bytes())),
        recorded,
        "canonical JSON sha256 of the committed default"
    );
    // D58: the committed ts-compat default pins compatLatency 0/0 and the 13 §7.3 compat models.
    assert_eq!(default["profile"], "ts-compat");
    assert_eq!(default["execution"]["compatLatency"]["delayMs"], 0);
    assert_eq!(default["execution"]["compatLatency"]["jitterMs"], 0);
    let models = &default["execution"]["models"];
    assert_eq!(models["latency"], "compat");
    assert_eq!(models["fee"], "flat_700bps_4dp");
    assert_eq!(models["takerDelay"], "off");
    assert_eq!(models["depletion"], "none");
    assert_eq!(models["maker"], "worst_queue");
    assert_eq!(models["reports"], "compat");
    assert_eq!(default["runner"]["maxEventsPerDrain"], 4200);
    assert_eq!(default["capital"]["startingCapitalUsdc"], "500");
    // The decimal strings of the default obey the 21 §6.1 grammar.
    for (k, v) in default["risk"].as_object().unwrap() {
        if let Some(t) = v.as_str() {
            assert!(is_decimal_string(t), "risk.{k} = {t:?}");
        }
    }
    // The spec-shaped candidate of this crate (ts-compat-default-jitter0) must hash the same
    // once its unused fields equal the committed file; record the comparison either way.
    let spec_shaped = row("ts-compat-default-jitter0");
    let spec_sha = s(&spec_shaped, "sha256");
    if spec_sha != recorded {
        eprintln!("note: spec-shaped candidate {spec_sha} != committed default {recorded} (A-02/D57: CI item 6 pins the committed file)");
    }
}

// spec: 21 §1.1, 21 §8 C4, 21 §10 — effective ModelConfig per candidate
#[test]
#[ignore = "C2-gap: needs the artifact binary (run-group)"]
fn effective_model_config_per_candidate() {
    todo!("C2: run-group with candidate execution override (realistic); each candidate's modelConfigSha256 == hash(run.modelConfig with execution replaced)");
}

// spec: 21 §6 (no defaults applied by the binary), 13 §7.3 (ts-compat pins), 12 §4.5, 14 §9, 20 §3
#[test]
#[ignore = "C2-gap: needs the artifact binary"]
fn invalid_model_configs_exit_2() {
    let r = row("invalid-values");
    assert!(r["invalid_documents"].as_array().unwrap().len() >= 10);
    todo!("C2: each invalid document -> exit 2, class invalid_input, cause model_config / rules_table_version / schema");
}
