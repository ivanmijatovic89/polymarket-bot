//! The `run` pipeline in process, over the committed fixture market
//! (`tests/fixtures/`) with an in-test engine backend: valid
//! `EngineResult`s, byte-identical deterministic sections, the parity
//! trace, every exit class the pipeline raises, and `selftest`.

mod common;

use std::io::Read;
use std::time::{Duration, Instant};

use common::{fixture_market, synthetic_job, FakeBackend, Fickle, Idle, Mode, PanicsInNew};
use pmb_contract::result::EngineResult;
use pmb_contract::vocab::TraceLevel;
use pmb_contract::vocab::{ErrorClass, ResultStatus, SkipReason, StatsSkipReason};
use pmb_engine::Strategy;
use pmb_runtime::cli::dispatch;
use pmb_runtime::inputs::build_inputs;
use pmb_runtime::job::{parse_job, plan_job, OutputOverrides, TraceRequest};
use pmb_runtime::run::{deterministic_json, execute_plan, run_job_bytes, JobClock, RunOutcome};
use pmb_runtime::{EngineBackend, EngineError, UnwiredSimulator};
use serde_json::Value;

const IDLE: FakeBackend = FakeBackend::new(Mode::Idle);

fn run_value<T>(job: &Value, backend: &FakeBackend, overrides: &OutputOverrides) -> RunOutcome
where
    T: pmb_engine::Strategy,
    T::Params: pmb_runtime::StrategyParams,
{
    let bytes = serde_json::to_vec(job).unwrap();
    run_job_bytes::<T, FakeBackend>(&bytes, overrides, backend, &JobClock::start())
}

fn reparse(o: &RunOutcome) -> EngineResult {
    // The document validates against the contract types (strict serde).
    let doc = o.document();
    let r: EngineResult = serde_json::from_str(&doc).unwrap();
    r.validate().unwrap();
    assert_eq!(r.compute_digest().unwrap(), r.result_digest);
    r
}

fn scratch(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("pmb-runtime-it-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn fixture_market_runs_twice_with_identical_deterministic_sections() {
    // spec: 20 G5, 21 §10 (deterministic section), §13 (zero row), §15 (eventsProcessed)
    let (path, slug, tokens, bytes) = fixture_market();
    let mut job = common::job(Idle::ID, &slug, &tokens, path.to_str().unwrap(), bytes);
    job["market"]["input"]["sha256"] = Value::String(common::file_sha256(&path));
    let a = run_value::<Idle>(&job, &IDLE, &OutputOverrides::default());
    let b = run_value::<Idle>(&job, &IDLE, &OutputOverrides::default());
    assert_eq!(a.exit_code, 0, "{:?}", a.reason);
    assert_eq!(deterministic_json(&a.result), deterministic_json(&b.result));
    assert_eq!(a.result.result_digest, b.result.result_digest);

    let r = reparse(&a);
    assert_eq!(r.status, ResultStatus::Ok);
    let echo = r.echo.as_ref().unwrap();
    assert_eq!(echo.strategy_id, Idle::ID);
    let market = r.market.as_ref().unwrap();
    assert_eq!(market.slug, slug);
    assert!(market.condition_id.as_deref().unwrap().starts_with("0x"));
    assert_eq!(
        market.rules_source,
        pmb_contract::vocab::RulesSource::Fallback
    );
    let c = &r.candidates[0];
    assert_eq!(c.status, ResultStatus::Ok);
    let out = c.output.as_ref().unwrap();
    // Every kept row of the fixture is one counted tick (15 I-19).
    assert_eq!(
        out.events_processed.get(),
        common::fixture_golden()["rows"].as_u64().unwrap()
    );
    assert_eq!(out.events_by_type.total(), out.events_processed.get());
    // No fills, no positions: the zero row of 21 §13.
    assert_eq!(out.skip_reason, Some(SkipReason::NoActivity));
    let stats = out.market_stats.as_ref().unwrap();
    assert_eq!(stats.skip_reason, Some(StatsSkipReason::NoInWindowActivity));
    assert_eq!(&stats.market_id, market.condition_id.as_ref().unwrap());
    assert_eq!(stats.trade_count, 0);
    // Non-semantic inputs never change the deterministic section (G5).
    let mut other = job.clone();
    other["budget"]["wallMs"] = Value::from(3_600_000);
    other["budget"]["threads"] = Value::from(8);
    let c2 = run_value::<Idle>(&other, &IDLE, &OutputOverrides::default());
    assert_eq!(
        deterministic_json(&a.result),
        deterministic_json(&c2.result)
    );
}

#[test]
fn parity_trace_sink_is_wired_and_does_not_change_the_result() {
    // spec: 22 §2 (observation never changes engine state), §3.1–§3.3.
    // `run` refuses trace requests until the sink renders intent and event
    // records (crate::job::trace_request); this drives the trace plumbing
    // of `execute_plan` directly so it is ready for integration.
    let (path, slug, tokens, bytes) = fixture_market();
    let d = scratch("trace");
    // gzip whatever the extension (22 §3.1).
    let trace = d.join("cand-a.jsonl");
    let job = common::job(Idle::ID, &slug, &tokens, path.to_str().unwrap(), bytes);
    let bytes_of_job = serde_json::to_vec(&job).unwrap();
    let plan = plan_job::<Idle>(
        parse_job(&bytes_of_job).unwrap(),
        &OutputOverrides::default(),
    )
    .map_err(|e| e.error)
    .unwrap();
    assert!(plan.trace.is_none());
    let inputs = build_inputs(&plan.job, plan.rules_table).unwrap();
    let plain = execute_plan::<Idle, FakeBackend>(&plan, &inputs, &IDLE, &JobClock::start());
    let mut traced_plan = plan;
    traced_plan.trace = Some(TraceRequest {
        path: trace.clone(),
        level: TraceLevel::Decisions,
    });
    let traced =
        execute_plan::<Idle, FakeBackend>(&traced_plan, &inputs, &IDLE, &JobClock::start());
    assert_eq!(plain.exit_code, 0, "{:?}", plain.reason);
    assert_eq!(traced.exit_code, 0, "{:?}", traced.reason);
    assert_eq!(
        deterministic_json(&plain.result),
        deterministic_json(&traced.result)
    );

    let mut text = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(&trace).unwrap())
        .read_to_string(&mut text)
        .unwrap();
    let lines: Vec<Value> = text
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines[0]["t"], "header");
    assert_eq!(lines[0]["version"], 2);
    assert_eq!(lines[0]["engine"], "native");
    assert_eq!(lines[0]["candidateKey"], "cand-a");
    assert_eq!(lines[0]["slug"], slug.as_str());
    let last = lines.last().unwrap();
    assert_eq!(last["t"], "final");
    let out = traced.result.candidates[0].output.as_ref().unwrap();
    assert_eq!(last["eventsProcessed"], out.events_processed.get());
    assert_eq!(last["skipReason"], "no_activity");
    assert_eq!(last["stats"]["skipReason"], "no_in_window_activity");
    assert_eq!(last["unrounded"]["pnl"], 0);
    let ticks: Vec<&Value> = lines.iter().filter(|l| l["t"] == "tick").collect();
    assert!(!ticks.is_empty());
    for (i, t) in ticks.iter().enumerate() {
        assert_eq!(t["seq"], i as u64);
    }
    assert_eq!(lines.len(), ticks.len() + 2);
    // Atomic write: nothing but the trace in the directory.
    assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
    std::fs::remove_dir_all(&d).unwrap();
}

fn assert_error(o: &RunOutcome, class: ErrorClass, cause: &str) {
    let r = reparse(o);
    let err = match (&r.error, r.candidates.first()) {
        (Some(e), _) => e.clone(),
        (None, Some(c)) => c.error.clone().expect("candidate error"),
        _ => panic!("no error in {}", o.document()),
    };
    assert_eq!(
        (err.class, err.cause.as_str()),
        (class, cause),
        "{}",
        err.message
    );
    assert_eq!(o.exit_code, class.exit_code().unwrap());
    let reason = o.reason.as_deref().unwrap();
    assert!(
        reason.starts_with(&format!("{class}: {cause}: ")),
        "{reason}"
    );
    assert!(reason.chars().count() <= 1000 && !reason.contains('\n'));
}

#[test]
fn pipeline_raises_each_class_with_its_exit_code() {
    // spec: 20 §4 exit codes and classes, 21 §5.1 field rules, 15 I-8, 12 §11
    let ov = OutputOverrides::default();
    let base = synthetic_job(Idle::ID);

    // invalid_input (2)
    let bytes = b"{not json".to_vec();
    let o = run_job_bytes::<Idle, FakeBackend>(&bytes, &ov, &IDLE, &JobClock::start());
    assert_error(&o, ErrorClass::InvalidInput, "schema");
    assert!(o.result.echo.is_none());
    let mut j = base.clone();
    j["extra"] = Value::Bool(true);
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "schema",
    );
    let mut j = base.clone();
    j["jobSchemaVersion"] = Value::from(2);
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "version",
    );
    let mut j = base.clone();
    j["run"]["strategyId"] = Value::from("someone-else.v1");
    let o = run_value::<Idle>(&j, &IDLE, &ov);
    assert_error(&o, ErrorClass::InvalidInput, "strategy_id");
    assert!(o.result.echo.is_some(), "echo once the job was read");
    let mut j = base.clone();
    j["market"]["input"]["path"] = Value::from("r2://bucket/x.parquet");
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "path",
    );
    let mut j = base.clone();
    j["market"]["input"]["path"] = Value::from("data/x.parquet");
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "path",
    );
    let mut j = base.clone();
    j["run"]["inputMode"] = Value::from("recorder-v4");
    j["market"]["recorderV4"] = serde_json::json!({ "manifest": {}, "allowGaps": false });
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "input_mode",
    );
    let mut j = base.clone();
    j["run"]["modelConfig"]["rules"]["rulesTableVersion"] = Value::from("rules-table-v9");
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "rules_table_version",
    );
    let mut j = base.clone();
    j["run"]["candidates"][0]["params"] = serde_json::json!({ "size": 5 });
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "params",
    );
    let mut j = base.clone();
    j["outputs"]["ledgerPath"] = Value::from("/tmp/l.jsonl.gz");
    assert_error(
        &run_value::<Idle>(&j, &IDLE, &ov),
        ErrorClass::InvalidInput,
        "flag",
    );
    let o = run_value::<Idle>(
        &base,
        &IDLE,
        &OutputOverrides {
            trace_path: Some("relative/t.jsonl".into()),
            trace_level: None,
        },
    );
    assert_error(&o, ErrorClass::InvalidInput, "path");
    // The job's own tracePath is checked even when --trace overrides it.
    let mut j = base.clone();
    j["outputs"]["tracePath"] = Value::from("r2://bucket/t.jsonl.gz");
    let o = run_value::<Idle>(
        &j,
        &IDLE,
        &OutputOverrides {
            trace_path: Some("/tmp/t.jsonl.gz".into()),
            trace_level: None,
        },
    );
    assert_error(&o, ErrorClass::InvalidInput, "path");
    // No parity_trace feature yet (20 §3): any trace request is refused
    // before the input is read (the synthetic input is absent, so a later
    // refusal would be data_missing), from the job or from the flags.
    let mut j = base.clone();
    j["outputs"]["tracePath"] = Value::from("/tmp/t.jsonl.gz");
    let o = run_value::<Idle>(&j, &IDLE, &ov);
    assert_error(&o, ErrorClass::InvalidInput, "flag");
    assert!(o
        .result
        .error
        .as_ref()
        .unwrap()
        .message
        .contains("parity_trace"));
    let o = run_value::<Idle>(
        &base,
        &IDLE,
        &OutputOverrides {
            trace_path: Some("/tmp/t.jsonl.gz".into()),
            trace_level: Some(TraceLevel::Feeds),
        },
    );
    assert_error(&o, ErrorClass::InvalidInput, "flag");
    assert!(o
        .result
        .error
        .as_ref()
        .unwrap()
        .message
        .contains("parity_trace_feeds"));
    // --trace-level without any trace path does nothing: refused (R14).
    let o = run_value::<Idle>(
        &base,
        &IDLE,
        &OutputOverrides {
            trace_path: None,
            trace_level: Some(TraceLevel::Feeds),
        },
    );
    assert_error(&o, ErrorClass::InvalidInput, "flag");

    // data_missing (3): the input is absent on this host.
    assert_error(
        &run_value::<Idle>(&base, &IDLE, &ov),
        ErrorClass::DataMissing,
        "input_missing",
    );

    {
        let (path, slug, tokens, bytes) = fixture_market();
        let good = common::job(Idle::ID, &slug, &tokens, path.to_str().unwrap(), bytes);
        // data_defect (4): integrity (15 I-8) and foreign files (I-18).
        let mut j = good.clone();
        j["market"]["input"]["bytes"] = Value::from(bytes + 1);
        assert_error(
            &run_value::<Idle>(&j, &IDLE, &ov),
            ErrorClass::DataDefect,
            "integrity_mismatch",
        );
        let mut j = good.clone();
        j["market"]["input"]["sha256"] = Value::from("0".repeat(64));
        assert_error(
            &run_value::<Idle>(&j, &IDLE, &ov),
            ErrorClass::DataDefect,
            "integrity_mismatch",
        );
        let mut j = good.clone();
        j["market"]["tokenIds"]["UP"] = Value::from("12345");
        assert_error(
            &run_value::<Idle>(&j, &IDLE, &ov),
            ErrorClass::DataDefect,
            "foreign_file",
        );
        let mut j = good.clone();
        j["market"]["input"]["format"]["version"] = Value::from(2);
        assert_error(
            &run_value::<Idle>(&j, &IDLE, &ov),
            ErrorClass::DataDefect,
            "format_version",
        );

        // timeout (5), engine_fault (8), invalid_output (6), strategy_fault (7)
        let timeout = FakeBackend::new(Mode::Group(EngineError::timeout("budget spent")));
        assert_error(
            &run_value::<Idle>(&good, &timeout, &ov),
            ErrorClass::Timeout,
            "deadline",
        );
        let panics = FakeBackend::new(Mode::EnginePanic);
        let o = run_value::<Idle>(&good, &panics, &ov);
        assert_error(&o, ErrorClass::EngineFault, "panic");
        assert!(o
            .result
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("engine invariant broken"));
        let bad = FakeBackend::new(Mode::BadStats);
        assert_error(
            &run_value::<Idle>(&good, &bad, &ov),
            ErrorClass::InvalidOutput,
            "self_check",
        );
        let pj = common::job(
            PanicsInNew::ID,
            &slug,
            &tokens,
            path.to_str().unwrap(),
            bytes,
        );
        let o = run_value::<PanicsInNew>(&pj, &IDLE, &ov);
        assert_error(&o, ErrorClass::StrategyFault, "panic");
        // A candidate fault is candidate-level: the group is ok (21 §14).
        assert_eq!(o.result.status, ResultStatus::Ok);
        let e = o.result.candidates[0].error.as_ref().unwrap();
        let detail = e.detail.as_ref().unwrap();
        assert_eq!(detail.callback.as_deref(), Some("new"));
        // No strategy tick happened before `new`: no seq or time is made up.
        assert_eq!((detail.seq, detail.ts_ms), (None, None));
        assert!(e.message.contains("strategy refuses this market"));

        // 30 §4 rule 3: requirements/interests that change between describe
        // and job start fail the job (group level), with no made-up tick.
        let fj = common::job(Fickle::ID, &slug, &tokens, path.to_str().unwrap(), bytes);
        let o = run_value::<Fickle>(&fj, &IDLE, &ov);
        assert_error(&o, ErrorClass::StrategyFault, "error");
        assert_eq!(o.result.status, ResultStatus::Error);
        assert!(o.result.candidates.is_empty());
        let e = o.result.error.as_ref().unwrap();
        assert!(e.message.contains("30 §4 rule 3"), "{}", e.message);
        assert!(e.detail.is_none(), "{:?}", e.detail);
    }
}

#[test]
fn selftest_passes_with_a_working_engine() {
    // spec: 20 §5.3 (embedded checks; run path twice, identical deterministic bytes)
    let (doc, ok) = pmb_runtime::selftest::selftest::<Idle, FakeBackend>(&IDLE, 8 << 20);
    assert!(ok, "{doc}");
    assert_eq!(doc["type"], "selftest");
    let names: Vec<&str> = doc["checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "fixed_point_rounding",
            "seed_vectors",
            "fee_curve_ts_compat",
            "contract_bundle",
            "run_path",
            "serve_path"
        ]
    );
    // The same through the CLI dispatcher: exit 0, one document.
    let o = dispatch::<Idle, FakeBackend>(
        &["selftest".to_string()],
        &mut std::io::empty(),
        &IDLE,
        "0.0.0",
    );
    assert_eq!(o.exit_code, 0);
    assert!(o.reason.is_none());
    let v: Value = serde_json::from_str(&o.document).unwrap();
    assert_eq!(v["ok"], true);
    // A broken engine makes selftest fail with exit 8.
    let broken = FakeBackend::new(Mode::EnginePanic);
    let o = dispatch::<Idle, FakeBackend>(
        &["selftest".to_string()],
        &mut std::io::empty(),
        &broken,
        "0.0.0",
    );
    assert_eq!(o.exit_code, 8);
}

#[test]
fn run_through_the_dispatcher_reads_stdin() {
    // spec: 20 §5.4 (`--job -`), G1 (exactly one document), G11 (job thread)
    let (path, slug, tokens, bytes) = fixture_market();
    let job = common::job(Idle::ID, &slug, &tokens, path.to_str().unwrap(), bytes);
    let text = serde_json::to_vec(&job).unwrap();
    let args: Vec<String> = ["run", "--job", "-", "--stack-mb", "4"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let o = dispatch::<Idle, FakeBackend>(&args, &mut &text[..], &IDLE, "0.0.0");
    assert_eq!(o.exit_code, 0, "{:?}", o.reason);
    assert_eq!(o.document.lines().count(), 1);
    let r: EngineResult = serde_json::from_str(&o.document).unwrap();
    r.validate().unwrap();
}

#[test]
fn production_backend_refuses_before_engine_code_until_integration() {
    // spec: 20 §4 (a missing capability is invalid_input, never an alerting
    // engine_fault), R14. Drives EngineBackend::run_candidate end to end on
    // the embedded selftest market: the refusal comes before EngineConfig
    // resolution and session construction (both todo!() before integration).
    let backend = EngineBackend::new(UnwiredSimulator);
    let o = pmb_runtime::selftest::run_embedded::<Idle, EngineBackend<UnwiredSimulator>>(
        &backend,
        8 << 20,
    )
    .unwrap();
    assert_error(&o, ErrorClass::InvalidInput, "profile");
    assert!(
        o.result.market.is_some(),
        "refused after the market was read"
    );
}

#[test]
fn spent_budget_times_out_through_the_real_deadline_check() {
    // spec: 20 §6.3 S4 (the budget counts from job start, decoding included),
    // §4 (timeout: deadline, exit 5). The backend would panic if it ran.
    let (path, slug, tokens, bytes) = fixture_market();
    let job = common::job(Idle::ID, &slug, &tokens, path.to_str().unwrap(), bytes);
    let budget_ms = job["budget"]["wallMs"].as_u64().unwrap();
    let ago = Duration::from_millis(budget_ms + 1_000);
    let clock = JobClock::started_at(
        Instant::now().checked_sub(ago).unwrap(),
        pmb_runtime::log::wall_ms() - (budget_ms + 1_000),
    );
    let never = FakeBackend::new(Mode::EnginePanic);
    let o = run_job_bytes::<Idle, FakeBackend>(
        &serde_json::to_vec(&job).unwrap(),
        &OutputOverrides::default(),
        &never,
        &clock,
    );
    assert_error(&o, ErrorClass::Timeout, "deadline");
    assert!(o.result.market.is_some());
    // The same job with a fresh clock reaches the backend.
    let o = run_job_bytes::<Idle, FakeBackend>(
        &serde_json::to_vec(&job).unwrap(),
        &OutputOverrides::default(),
        &never,
        &JobClock::start(),
    );
    assert_error(&o, ErrorClass::EngineFault, "panic");
}
