//! Contract fixtures (21 §3 CI item 4, §19): valid jobs and results
//! deserialize, validate and reserialize unchanged; every invalid case is
//! rejected at the expected stage with the expected cause.

use std::fs;
use std::path::{Path, PathBuf};

use pmb_contract::{ContractError, EngineJob, EngineResult, ModelConfig};
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
    F: Fn(&T) -> Result<(), ContractError>,
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
        Value::Array(a) => {
            let i = key.parse::<usize>().unwrap();
            if i == a.len() {
                a.push(value);
            } else {
                a[i] = value;
            }
        }
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

/// Applies every invalid case of `dir/cases.json` to its base document and
/// checks the class and cause that `parse` reports (21 §19, 20 §4).
fn run_invalid_cases<T>(dir: &Path, parse: fn(&str) -> Result<T, ContractError>) {
    let cases: Value = serde_json::from_str(&read(&dir.join("cases.json"))).unwrap();
    let base: Value =
        serde_json::from_str(&read(&dir.join(cases["base"].as_str().unwrap()))).unwrap();
    let list = cases["cases"].as_array().unwrap();
    assert!(list.len() >= 10);
    let mut names = std::collections::BTreeSet::new();
    for case in list {
        let name = case["name"].as_str().unwrap();
        assert!(names.insert(name), "duplicate case name {name:?}");
        assert!(
            case["rule"].as_str().is_some_and(|r| !r.is_empty()),
            "{name}: rule"
        );
        assert!(
            matches!(case["jsonSchema"].as_str(), Some("reject" | "accept")),
            "{name}: jsonSchema"
        );
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
        let err = match parse(&text) {
            Ok(_) => panic!("case {name:?}: accepted"),
            Err(e) => e,
        };
        let class = case["expect"]["class"].as_str().unwrap();
        let cause = case["expect"]["cause"].as_str().unwrap();
        assert_eq!(
            (err.class.as_str(), err.cause),
            (class, cause),
            "case {name:?}: got {err}"
        );
    }
}

#[test]
fn valid_jobs_round_trip() {
    // spec: 21 §3 CI item 4
    for path in json_files(&contract_dir().join("fixtures/jobs/valid")) {
        let text = read(&path);
        let job: EngineJob = round_trip(&text, EngineJob::validate);
        assert!(!job.run.candidates.is_empty());
        EngineJob::parse(&text).expect("parse");
    }
}

#[test]
fn invalid_jobs_are_rejected_with_their_cause() {
    // spec: 21 §19 (Rust ingress), §5.1 causes, 20 §4.1
    run_invalid_cases(
        &contract_dir().join("fixtures/jobs/invalid"),
        EngineJob::parse,
    );
}

#[test]
fn valid_results_round_trip() {
    // spec: 21 §3 CI item 4
    for path in json_files(&contract_dir().join("fixtures/results/valid")) {
        let text = read(&path);
        round_trip::<EngineResult, _>(&text, EngineResult::validate);
        EngineResult::parse(&text).expect("parse");
    }
}

#[test]
fn invalid_results_are_rejected_with_their_cause() {
    // spec: 21 §19 (Rust egress self-check), 20 §4.1
    run_invalid_cases(
        &contract_dir().join("fixtures/results/invalid"),
        EngineResult::parse,
    );
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

// D-PENDING: 21 §6.3 lists `0` / `20` as the built-in compatLatency default
// (the TS env default of BACKTEST_LATENCY_JITTER), while 13 §7.4, which owns
// the defaults file's execution content, puts compatLatency 0/0 in it; chose
// 0/0 for the committed default config and its pinned hash (jitter applies
// only when delay > 0, 13 §5.1, so both resolve to the same behavior).
/// 21 §6.3: the defaults file holds one complete ModelConfig per profile
/// without `seed`; with the default seed 0 (10 RNG-1) each one is the
/// committed `<profile>-default.json` that CI item 6 pins (D57: ts-compat
/// only until M3b).
#[test]
fn defaults_file_resolves_to_the_committed_default_configs() {
    // spec: 21 §6.3, §3 CI item 6, D57
    let defaults: Value =
        serde_json::from_str(&read(&contract_dir().join("defaults/model-config-v1.json"))).unwrap();
    let profiles = defaults.as_object().expect("one object per profile");
    assert_eq!(
        profiles.keys().map(String::as_str).collect::<Vec<_>>(),
        ["ts-compat"],
        "D57: realistic lands in M3b"
    );
    for (profile, config) in profiles {
        let mut config = config.clone();
        let obj = config.as_object_mut().unwrap();
        assert_eq!(obj["profile"], Value::String(profile.clone()));
        assert!(
            !obj.contains_key("seed"),
            "{profile}: defaults carry no seed"
        );
        obj.insert("seed".into(), Value::from(0));
        let resolved: ModelConfig = serde_json::from_value(config).unwrap();
        resolved.validate().unwrap();
        let committed: ModelConfig = serde_json::from_str(&read(
            &contract_dir().join(format!("model-configs/{profile}-default.json")),
        ))
        .unwrap();
        assert_eq!(resolved, committed, "{profile}");
    }
}

/// 21 §3 CI item 1: the committed schema bundle and hash fixture equal the
/// generated ones (`cargo run -p pmb-contract --bin export-schema -- --check`).
#[test]
fn committed_schema_bundle_is_current() {
    // spec: 21 §3 (Schema files, CI item 1), 20 §5.2
    if let Err(problems) = pmb_contract::schema::check(&contract_dir()) {
        panic!("{problems}");
    }
}

const TS_COMPAT_DEFAULT_SHA256: &str =
    "bbfed555689b864250b628498d5679e74b3e7fcbba7f775b206ff7669413af7e";

/// 21 §19 Rust egress against the job (the §12 facts): a result built for
/// the job passes; each echoed fact that differs fails `self_check`.
#[test]
fn result_validates_against_its_job() {
    // spec: 21 §19 (Rust egress), §12, §11 finalOutcome
    let job = EngineJob::parse(&read(
        &contract_dir().join("fixtures/jobs/valid/telonex-delta-ts-compat.json"),
    ))
    .unwrap();
    let base: EngineResult = serde_json::from_str(&read(
        &contract_dir().join("fixtures/results/valid/ok-ts-compat.json"),
    ))
    .unwrap();
    let sha = job.run.model_config.sha256().unwrap();
    let matching = |mutate: &dyn Fn(&mut EngineResult)| {
        let mut r = base.clone();
        r.candidates.truncate(1);
        r.candidates[0].key = job.run.candidates[0].key.clone();
        r.candidates[0].model_config_sha256 = sha.clone();
        let echo = r.echo.as_mut().unwrap();
        echo.model_config_sha256 = sha.clone();
        mutate(&mut r);
        r.result_digest = r.compute_digest().unwrap();
        r.validate_against(&job)
    };
    matching(&|_| {}).unwrap();
    type Mutation<'a> = (&'a str, &'a dyn Fn(&mut EngineResult));
    let mutations: [Mutation; 4] = [
        ("seed", &|r| {
            r.echo.as_mut().unwrap().seed = pmb_contract::SafeU64::new(1).unwrap()
        }),
        ("strategyId", &|r| {
            r.echo.as_mut().unwrap().strategy_id = "other".into()
        }),
        ("candidate key", &|r| r.candidates[0].key = "other".into()),
        ("finalOutcome", &|r| {
            let o = r.candidates[0].output.as_mut().unwrap();
            o.market_stats.as_mut().unwrap().final_outcome = pmb_contract::vocab::Outcome::Down;
        }),
    ];
    for (name, mutate) in mutations {
        let e = matching(mutate).expect_err(name);
        assert_eq!(
            (e.class.as_str(), e.cause),
            ("invalid_output", "self_check"),
            "{name}"
        );
    }
}

/// 20 §5.2: the `schema` document holds the bundle and its contractSha256.
#[test]
fn schema_subcommand_document() {
    // spec: 20 §5.2, 21 §3
    let doc = pmb_contract::schema::schema_document().unwrap();
    assert_eq!(doc["type"], "schema");
    let hashes: Value =
        serde_json::from_str(&read(&contract_dir().join("fixtures/hashes.json"))).unwrap();
    assert_eq!(doc["contractSha256"], hashes["contractSha256"]);
    let stems: Vec<&str> = doc["schemas"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        stems,
        [
            "engineJob",
            "engineResult",
            "modelConfig",
            "serveIn",
            "serveOut"
        ]
    );
}

/// 20 §6.2 serve messages: `in` lines parse and reserialize unchanged,
/// `invalidIn` lines are fatal `invalid_input: schema` errors.
#[test]
fn serve_message_fixtures() {
    // spec: 20 §6.2, 21 §3 CI item 4
    let doc: Value =
        serde_json::from_str(&read(&contract_dir().join("fixtures/serve/messages.json"))).unwrap();
    for msg in doc["in"].as_array().unwrap() {
        let line = serde_json::to_string(msg).unwrap();
        let parsed = pmb_contract::serve::ServeIn::parse_line(&line)
            .unwrap_or_else(|e| panic!("{line}: {e}"));
        let again: Value = serde_json::to_value(&parsed).unwrap();
        assert_eq!(&again, msg, "reserialization changed {line}");
    }
    for case in doc["invalidIn"].as_array().unwrap() {
        let line = serde_json::to_string(&case["message"]).unwrap();
        let e = pmb_contract::serve::ServeIn::parse_line(&line).expect_err(&line);
        assert_eq!(
            (e.class.as_str(), e.cause),
            ("invalid_input", "schema"),
            "{line}"
        );
    }
}
