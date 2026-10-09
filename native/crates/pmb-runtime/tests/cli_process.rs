//! Process-level behavior of a strategy binary built on the production
//! path (`src/bin/fixture.rs`): exactly one stdout document (G1), exit codes
//! and classes (20 §4), the stderr reason line, PMB_LOG (G2), EPIPE (G8).

mod common;

use std::io::Write;
use std::process::{Command, Output, Stdio};

use common::{fixture_market, synthetic_job};
use pmb_contract::result::EngineResult;
use serde_json::Value;

const BIN: &str = env!("CARGO_BIN_EXE_pmb-runtime-fixture");
const STRATEGY_ID: &str = "runtime-fixture-idle.v1";

fn cmd() -> Command {
    let mut c = Command::new(BIN);
    // G6: the shim's exact environment.
    c.env_clear()
        .env("TZ", "UTC")
        .env("LANG", "C")
        .env("RUST_BACKTRACE", "1");
    c
}

fn run(args: &[&str], stdin: Option<&[u8]>) -> Output {
    let mut c = cmd();
    c.args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn().unwrap();
    if let Some(bytes) = stdin {
        child.stdin.take().unwrap().write_all(bytes).unwrap();
    }
    child.wait_with_output().unwrap()
}

/// Exactly one JSON document on stdout (G1).
fn document(o: &Output) -> Value {
    let text = String::from_utf8(o.stdout.clone()).unwrap();
    assert_eq!(text.lines().count(), 1, "one stdout line: {text}");
    serde_json::from_str(text.trim_end()).unwrap()
}

/// The last stderr line on a non-zero exit (20 §4).
fn reason(o: &Output) -> String {
    let text = String::from_utf8(o.stderr.clone()).unwrap();
    let last = text.lines().last().unwrap_or_default().to_string();
    assert!(!last.is_empty() && last.chars().count() <= 1000, "{text}");
    last
}

fn code(o: &Output) -> i32 {
    o.status.code().expect("exited normally")
}

#[test]
fn describe_and_schema() {
    // spec: 20 §5.1 (describe), §5.2 (schema), §3 (capabilities), 20 §8 item 9
    let o = run(&["describe"], None);
    assert_eq!(code(&o), 0);
    let d = document(&o);
    assert_eq!(d["type"], "describe");
    assert_eq!(d["protocolVersion"], 2);
    assert_eq!(d["strategy"]["id"], STRATEGY_ID);
    assert_eq!(d["capabilities"]["realOrders"], false);
    assert_eq!(d["capabilities"]["features"], serde_json::json!([]));
    assert_eq!(
        d["capabilities"]["subcommands"],
        serde_json::json!(["describe", "schema", "selftest", "run"])
    );
    let b = &d["binary"];
    assert_eq!(b["engineVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(
        b["engineDirty"], true,
        "no builder identity in a test build"
    );
    assert_eq!(b["sdkVersion"], "0.0.0-fixture");
    assert_eq!(b["contractSha256"].as_str().unwrap().len(), 64);

    let s = run(&["schema"], None);
    assert_eq!(code(&s), 0);
    let s = document(&s);
    assert_eq!(s["type"], "schema");
    assert_eq!(s["contractSha256"], b["contractSha256"]);
    for k in ["engineJob", "engineResult", "modelConfig", "params"] {
        assert!(s["schemas"][k].is_object(), "{k}");
    }

    // Params: one valid set; an invalid one exits 2 with an error document.
    let ok = run(&["describe", "--params", "{}"], None);
    assert_eq!(code(&ok), 0);
    let ok = document(&ok);
    assert_eq!(ok["strategy"]["results"][0]["ok"], true);
    assert_eq!(
        ok["strategy"]["results"][0]["params"],
        serde_json::json!({})
    );
    assert_eq!(ok["strategy"]["results"][0]["requiredFeeds"], Value::Null);
    let bad = run(&["describe", "--params", "{\"size\":\"2\"}"], None);
    assert_eq!(code(&bad), 2);
    let e = document(&bad);
    assert_eq!(e["type"], "error");
    assert_eq!(e["error"]["class"], "invalid_input");
    assert_eq!(e["error"]["cause"], "params");
    assert_eq!(e["errors"][0]["path"], "/size");
    assert!(reason(&bad).starts_with("invalid_input: params: "));
}

#[test]
fn describe_params_file_reports_per_element() {
    // spec: 20 §5.1 (--params-file: per-element errors, exit 0)
    let dir = std::env::temp_dir().join(format!("pmb-runtime-cli-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("params.json");
    std::fs::write(&f, br#"[{}, {"x": 1}, 7]"#).unwrap();
    let o = run(&["describe", "--params-file", f.to_str().unwrap()], None);
    assert_eq!(code(&o), 0);
    let r = &document(&o)["strategy"]["results"];
    assert_eq!(r[0]["ok"], true);
    assert_eq!(r[1]["ok"], false);
    assert_eq!(r[1]["errors"][0]["path"], "/x");
    assert_eq!(r[2]["ok"], false);
    std::fs::write(&f, b"{}").unwrap();
    let o = run(&["describe", "--params-file", f.to_str().unwrap()], None);
    assert_eq!(code(&o), 2);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn bad_command_lines_exit_2_with_one_document() {
    // spec: 20 §4 (invalid_input exit 2, reason line), R14, G1
    for args in [
        &["frobnicate"][..],
        &[][..],
        &["run-group", "--job", "-"][..],
        &["serve", "--threads", "2", "--work-dir", "/tmp"][..],
        &["paper"][..],
        &["live"][..],
        &["describe", "--bogus", "1"][..],
    ] {
        let o = run(args, None);
        assert_eq!(code(&o), 2, "{args:?}");
        let d = document(&o);
        assert_eq!(d["type"], "error", "{args:?}");
        assert_eq!(d["error"]["class"], "invalid_input");
        assert!(reason(&o).starts_with("invalid_input: args: "), "{args:?}");
    }
    // `run` always prints an EngineResult, even for argument errors.
    let o = run(&["run", "--job", "jobs/relative.json"], None);
    assert_eq!(code(&o), 2);
    let r: EngineResult = serde_json::from_value(document(&o)).unwrap();
    let e = r.error.unwrap();
    assert_eq!(
        (e.class.as_str(), e.cause.as_str()),
        ("invalid_input", "path")
    );
    assert!(r.echo.is_none());
}

#[test]
fn pmb_log_is_validated_and_only_affects_stderr() {
    // spec: 20 G2 (PMB_LOG is the only verbosity knob), R14
    let o = cmd()
        .arg("schema")
        .env("PMB_LOG", "chatty")
        .output()
        .unwrap();
    assert_eq!(code(&o), 2);
    assert_eq!(document(&o)["error"]["cause"], "args");
    let quiet = cmd().arg("schema").env("PMB_LOG", "off").output().unwrap();
    let loud = cmd()
        .arg("schema")
        .env("PMB_LOG", "trace")
        .output()
        .unwrap();
    assert_eq!(quiet.stdout, loud.stdout);
    // Junk behavior env (20 §8 item 4) changes nothing.
    let junk = cmd()
        .arg("schema")
        .env("BACKTEST_LATENCY_DELAY", "999")
        .env("MAX_EVENTS_PER_DRAIN", "1")
        .env("DRY_RUN", "false")
        .output()
        .unwrap();
    assert_eq!(junk.stdout, quiet.stdout);
}

#[test]
fn run_exit_classes_from_the_real_binary() {
    // spec: 20 §4, §5.4, G3, 21 §5.1, 15 I-8
    // r2:// input → invalid_input: path (2), echo present (the job was read).
    let mut j = synthetic_job(STRATEGY_ID);
    j["market"]["input"]["path"] = Value::from("r2://bucket/x.parquet");
    let o = run(
        &["run", "--job", "-"],
        Some(&serde_json::to_vec(&j).unwrap()),
    );
    assert_eq!(code(&o), 2);
    let r: EngineResult = serde_json::from_value(document(&o)).unwrap();
    assert_eq!(r.error.as_ref().unwrap().cause, "path");
    assert!(r.echo.is_some());
    assert!(reason(&o).starts_with("invalid_input: path: "));

    // A trace request is refused (no parity_trace feature yet, 20 §3)
    // before the (absent) input is read: invalid_input: flag, not 3.
    let j = synthetic_job(STRATEGY_ID);
    let o = run(
        &[
            "run",
            "--job",
            "-",
            "--trace",
            "/tmp/pmb-runtime-never-written.jsonl.gz",
        ],
        Some(&serde_json::to_vec(&j).unwrap()),
    );
    assert_eq!(code(&o), 2);
    assert!(reason(&o).starts_with("invalid_input: flag: "));

    // Unknown job field → 2 (20 §8 item 5).
    let mut j = synthetic_job(STRATEGY_ID);
    j["run"]["surprise"] = Value::Bool(true);
    let o = run(
        &["run", "--job", "-"],
        Some(&serde_json::to_vec(&j).unwrap()),
    );
    assert_eq!(code(&o), 2);

    // Absent input → data_missing (3), message names the fix command.
    let j = synthetic_job(STRATEGY_ID);
    let o = run(
        &["run", "--job", "-"],
        Some(&serde_json::to_vec(&j).unwrap()),
    );
    assert_eq!(code(&o), 3);
    let r: EngineResult = serde_json::from_value(document(&o)).unwrap();
    let e = r.error.unwrap();
    assert_eq!(e.cause, "input_missing");
    assert!(e
        .detail
        .unwrap()
        .fix_command
        .unwrap()
        .contains("download-converted-r2-to-local"));

    let (path, slug, tokens, bytes) = fixture_market();
    // Integrity mismatch → data_defect (4).
    let mut j = common::job(
        STRATEGY_ID,
        &slug,
        &tokens,
        path.to_str().unwrap(),
        bytes - 1,
    );
    let o = run(
        &["run", "--job", "-"],
        Some(&serde_json::to_vec(&j).unwrap()),
    );
    assert_eq!(code(&o), 4);
    assert!(reason(&o).starts_with("data_defect: integrity_mismatch: "));

    // A valid job reaches the engine. Until the pmb-engine core and the
    // simulator are wired (integration), that is an engine_fault (8),
    // reported as a valid EngineResult with the market echo.
    j["market"]["input"]["bytes"] = Value::from(bytes);
    let dir = std::env::temp_dir().join(format!("pmb-runtime-job-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let job_path = dir.join("job.json");
    std::fs::write(&job_path, serde_json::to_vec(&j).unwrap()).unwrap();
    let o = run(&["run", "--job", job_path.to_str().unwrap()], None);
    assert_eq!(code(&o), 8, "{}", String::from_utf8_lossy(&o.stdout));
    let r: EngineResult = serde_json::from_value(document(&o)).unwrap();
    r.validate().unwrap();
    assert_eq!(r.error.as_ref().unwrap().class.as_str(), "engine_fault");
    assert!(r.market.is_some());
    assert!(reason(&o).starts_with("engine_fault: "));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn selftest_reports_every_check() {
    // spec: 20 §5.3. Before integration the run path reaches the unwired
    // engine, so only that check fails and the exit code is 8.
    let o = run(&["selftest"], None);
    let d = document(&o);
    assert_eq!(d["type"], "selftest");
    let checks = d["checks"].as_array().unwrap();
    assert_eq!(checks.len(), 6);
    for c in checks {
        if c["name"] != "run_path" {
            assert_eq!(c["ok"], true, "{c}");
        }
    }
    assert_eq!(code(&o), if d["ok"] == true { 0 } else { 8 });
}

#[test]
fn closed_stdout_exits_promptly() {
    // spec: 20 G8 (one-shot commands exit when stdout is closed)
    let mut child = cmd()
        .args(["run", "--job", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    drop(child.stdout.take()); // the parent stops reading
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(&synthetic_job(STRATEGY_ID)).unwrap())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_ne!(out.status.code(), Some(0));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("stdout closed"), "{err}");
}
