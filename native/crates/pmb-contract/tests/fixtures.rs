//! Contract fixtures (21 §3 CI item 4, §19): valid jobs and results
//! deserialize, validate and reserialize unchanged; every invalid case is
//! rejected at the expected stage with the expected cause.

use std::fs;
use std::path::{Path, PathBuf};

use pmb_contract::{EngineJob, EngineResult, ModelConfig};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

fn contract_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contract")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    out.sort();
    assert!(!out.is_empty(), "no fixtures in {}", dir.display());
    out
}

/// Parses, validates and checks that reserialization is lossless.
fn round_trip<T, F>(text: &str, validate: F) -> T
where
    T: DeserializeOwned + Serialize,
    F: Fn(&T) -> Result<(), pmb_contract::ContractError>,
{
    let parsed: T = serde_json::from_str(text).expect("valid fixture deserializes");
    validate(&parsed).expect("valid fixture validates");
    let again = serde_json::to_string(&parsed).unwrap();
    let a: Value = serde_json::from_str(text).unwrap();
    let b: Value = serde_json::from_str(&again).unwrap();
    assert_eq!(a, b, "reserialization changed the document");
    // Idempotent byte form.
    let reparsed: T = serde_json::from_str(&again).unwrap();
    assert_eq!(serde_json::to_string(&reparsed).unwrap(), again);
    parsed
}

fn set_pointer(doc: &mut Value, pointer: &str, value: Value) {
    let (parent, key) = pointer.rsplit_once('/').unwrap();
    let target = if parent.is_empty() {
        doc
    } else {
        doc.pointer_mut(parent)
            .unwrap_or_else(|| panic!("no parent {parent}"))
    };
    match target {
        Value::Object(m) => {
            m.insert(key.to_owned(), value);
        }
        Value::Array(a) => a[key.parse::<usize>().unwrap()] = value,
        _ => panic!("pointer {pointer} parent is not a container"),
    }
}

fn remove_pointer(doc: &mut Value, pointer: &str) {
    let (parent, key) = pointer.rsplit_once('/').unwrap();
    let target = doc.pointer_mut(parent).unwrap();
    target
        .as_object_mut()
        .unwrap()
        .remove(key)
        .expect("removed");
}

fn run_invalid_cases<T, F>(dir: &Path, validate: F)
where
    T: DeserializeOwned,
    F: Fn(&T) -> Result<(), pmb_contract::ContractError>,
{
    let cases: Value = serde_json::from_str(&read(&dir.join("cases.json"))).unwrap();
    let base: Value =
        serde_json::from_str(&read(&dir.join(cases["base"].as_str().unwrap()))).unwrap();
    let list = cases["cases"].as_array().unwrap();
    assert!(list.len() >= 10);
    for case in list {
        let name = case["name"].as_str().unwrap();
        let mut doc = base.clone();
        if let Some(set) = case.get("set").and_then(Value::as_object) {
            for (ptr, v) in set {
                set_pointer(&mut doc, ptr, v.clone());
            }
        }
        if let Some(rm) = case.get("remove").and_then(Value::as_array) {
            for ptr in rm {
                remove_pointer(&mut doc, ptr.as_str().unwrap());
            }
        }
        let text = serde_json::to_string(&doc).unwrap();
        let expect = case["expect"].as_str().unwrap();
        let parsed = serde_json::from_str::<T>(&text);
        match expect {
            "schema" => assert!(
                parsed.is_err(),
                "case {name:?}: expected a schema rejection"
            ),
            other => {
                let cause = other.strip_prefix("validate:").expect("expect form");
                let parsed =
                    parsed.unwrap_or_else(|e| panic!("case {name:?}: unexpected schema error {e}"));
                let err = validate(&parsed).expect_err(name);
                assert_eq!(err.cause, cause, "case {name:?}: wrong cause ({err})");
            }
        }
    }
}

#[test]
fn valid_jobs_round_trip() {
    for path in json_files(&contract_dir().join("fixtures/jobs/valid")) {
        let job: EngineJob = round_trip(&read(&path), EngineJob::validate);
        assert!(!job.run.candidates.is_empty());
    }
}

#[test]
fn invalid_jobs_are_rejected() {
    run_invalid_cases::<EngineJob, _>(&contract_dir().join("fixtures/jobs/invalid"), |j| {
        let r = j.validate();
        if let Err(e) = &r {
            assert_eq!(e.class, pmb_contract::vocab::ErrorClass::InvalidInput);
        }
        r
    });
}

#[test]
fn valid_results_round_trip() {
    for path in json_files(&contract_dir().join("fixtures/results/valid")) {
        round_trip::<EngineResult, _>(&read(&path), EngineResult::validate);
    }
}

#[test]
fn invalid_results_are_rejected() {
    run_invalid_cases::<EngineResult, _>(&contract_dir().join("fixtures/results/invalid"), |r| {
        let res = r.validate();
        if let Err(e) = &res {
            assert_eq!(e.class, pmb_contract::vocab::ErrorClass::InvalidOutput);
        }
        res
    });
}

#[test]
fn result_digest_ignores_diagnostics() {
    let text = read(&contract_dir().join("fixtures/results/valid/ok-ts-compat.json"));
    let a: EngineResult = serde_json::from_str(&text).unwrap();
    let mut b = a.clone();
    b.diagnostics.wall_ms = pmb_contract::SafeU64::new(999).unwrap();
    assert_eq!(a.compute_digest().unwrap(), b.compute_digest().unwrap());
    b.candidates.pop();
    assert_ne!(a.compute_digest().unwrap(), b.compute_digest().unwrap());
}

/// 21 §3 CI item 6 (D57: only the ts-compat default until M3b).
#[test]
fn ts_compat_default_model_config_and_sha() {
    let text = read(&contract_dir().join("model-configs/ts-compat-default.json"));
    let mc: ModelConfig = round_trip(&text, ModelConfig::validate);
    let canonical = mc.canonical_json().unwrap();
    assert_eq!(
        canonical,
        concat!(
            r#"{"capital":{"startingCapitalUsdc":"500"},"#,
            r#""execution":{"compatLatency":{"delayMs":0,"jitterMs":0},"#,
            r#""models":{"depletion":"none","fee":"flat_700bps_4dp","latency":"compat","maker":"worst_queue","reports":"compat","takerDelay":"off"}},"#,
            r#""feeds":{"binance":{"latency":{"kind":"constant","ms":110}},"calibrationId":"feeds-2026-07-21","#,
            r#""chainlink":{"latency":{"kind":"constant","ms":320},"maxGapMs":300000},"#,
            r#""priceToBeat":{"latency":{"kind":"constant","ms":2700}}},"#,
            r#""modelConfigVersion":1,"profile":"ts-compat","#,
            r#""risk":{"maxAbsPosition":"2000","maxLossStopUsdc":"500","maxOpenOrders":100,"maxOrderSize":"2000"},"#,
            r#""rules":{"missingSnapshot":"dated_fallback","rulesTableVersion":"rules-table-v1"},"#,
            r#""runner":{"maxEventsPerDrain":4200},"seed":0}"#
        )
    );
    // The sha is pinned: TS must reproduce it (13 §7.4 hash agreement).
    assert_eq!(mc.sha256().unwrap().as_str(), TS_COMPAT_DEFAULT_SHA256);
    // The committed fixture and the job fixture with delay 140 differ.
    let job: EngineJob = serde_json::from_str(&read(
        &contract_dir().join("fixtures/jobs/valid/telonex-delta-ts-compat.json"),
    ))
    .unwrap();
    assert_ne!(job.run.model_config.sha256().unwrap(), mc.sha256().unwrap());
}

const TS_COMPAT_DEFAULT_SHA256: &str =
    "bbfed555689b864250b628498d5679e74b3e7fcbba7f775b206ff7669413af7e";
