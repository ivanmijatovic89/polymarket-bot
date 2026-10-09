//! The `pmb-tape` binary end to end on the committed fixture: `convert`,
//! `verify` and `bench` refuse sources that differ from the frozen manifest
//! (16 §13.1), `verify` fails without a valid tape, and `convert` refuses a
//! tape root inside the inputs (16 NT-8).

use pmb_replay::telonex::file_asset_ids;
use pmb_tape::store::{hex, sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// A scratch checkout under Cargo's test tmp dir, removed on drop.
struct Checkout(PathBuf);

impl Drop for Checkout {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/telonex-mini.parquet")
}

/// data/telonex/m.parquet (a copy of the fixture) and a one-market manifest.
fn checkout(name: &str) -> Checkout {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("pmb-tape-cli-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("data/telonex")).unwrap();
    std::fs::copy(fixture(), root.join("data/telonex/m.parquet")).unwrap();
    let co = Checkout(root);
    write_manifest(&co, None);
    co
}

fn write_manifest(co: &Checkout, sha_override: Option<&str>) {
    let v1 = co.0.join("data/telonex/m.parquet");
    let data = std::fs::read(&v1).unwrap();
    let tokens = file_asset_ids(&v1).unwrap();
    let sha = sha_override.map_or_else(|| hex(&sha256(&data)), str::to_string);
    let m = serde_json::json!({
        "benchSetVersion": 1, "name": "cli", "description": "cli test",
        "createdAt": "2026-10-09T00:00:00Z", "inputMode": "telonex-delta",
        "format": { "name": "telonex-delta-typed", "version": 1 },
        "symbol": "btc", "timeframe": "15m", "strategy": "none", "params": {},
        "modelConfig": { "path": "none", "sha256": "none" }, "selection": {},
        "totals": { "markets": 1, "bytes": data.len(), "rows": 3007 },
        "markets": [{ "slug": "m", "file": "data/telonex/m.parquet", "bytes": data.len(),
                      "sha256": sha, "rows": 3007,
                      "tokens": { "up": tokens[0], "down": tokens[1] } }],
    });
    std::fs::write(co.0.join("set.json"), m.to_string()).unwrap();
}

fn run(co: &Checkout, cmd: &str, tape_root: &Path, extra: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pmb-tape"))
        .arg(cmd)
        .arg("--data-root")
        .arg(co.0.join("data"))
        .arg("--tape-root")
        .arg(tape_root)
        .arg("--set")
        .arg(co.0.join("set.json"))
        .args(extra)
        .output()
        .unwrap()
}

fn text(o: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}

fn tape_file(tapes: &Path) -> PathBuf {
    tapes.join("telonex-delta-typed-v1/tape-v2/btc/15m/m.pmbtape")
}

#[test]
fn convert_verify_bench_round_trip_and_refusals() {
    let co = checkout("main");
    let tapes = co.0.join("tapes");

    // A missing tape fails verify.
    let o = run(&co, "verify", &tapes, &[]);
    assert!(!o.status.success(), "{}", text(&o));
    assert!(text(&o).contains("no valid tape"), "{}", text(&o));

    let o = run(&co, "convert", &tapes, &[]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(tape_file(&tapes).exists());
    let o = run(&co, "verify", &tapes, &[]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(
        text(&o).contains("1 of 1 markets identical"),
        "{}",
        text(&o)
    );
    let o = run(&co, "m19-convert", &tapes, &[]);
    assert!(o.status.success(), "{}", text(&o));
    let json = co.0.join("bench.json");
    let all = "v1,tape,tape-full,tape-rows,pq-full,pq-rows";
    let o = run(
        &co,
        "bench",
        &tapes,
        &[
            "--reps",
            "2",
            "--configs",
            all,
            "--json",
            json.to_str().unwrap(),
        ],
    );
    assert!(o.status.success(), "{}", text(&o));
    let doc: serde_json::Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
    assert_eq!(doc["markets"], 1);
    assert_eq!(
        doc["order"].as_array().unwrap().len(),
        12,
        "ABBA over 6 configs"
    );
    let c = &doc["conditions"];
    for k in [
        "host",
        "chip",
        "macos",
        "rustc",
        "profile",
        "binarySha256",
        "qos",
        "threads",
    ] {
        assert!(!c[k].is_null(), "condition {k} missing: {c}");
    }
    assert_eq!(c["label"], "non-idle");
    assert_eq!(c["setManifest"]["sha256"].as_str().unwrap().len(), 64);
    assert!(doc["bytes"]["m19"].as_u64().unwrap() > 0);
    assert!(!doc["psStart"].as_array().unwrap().is_empty());
    let o = run(&co, "bench", &tapes, &["--configs", "v1,nope"]);
    assert!(!o.status.success() && text(&o).contains("unknown configuration"));

    // The manifest names another file: every subcommand refuses it.
    write_manifest(&co, Some(&"ab".repeat(32)));
    for cmd in ["verify", "bench"] {
        let o = run(
            &co,
            cmd,
            &tapes,
            &["--reps", "1"][..if cmd == "bench" { 2 } else { 0 }],
        );
        assert!(!o.status.success(), "{cmd}: {}", text(&o));
        assert!(text(&o).contains("source changed"), "{cmd}: {}", text(&o));
    }
    std::fs::remove_file(tape_file(&tapes)).unwrap();
    let o = run(&co, "convert", &tapes, &[]);
    assert!(!o.status.success(), "{}", text(&o));
    assert!(text(&o).contains("CHANGED"), "{}", text(&o));
    assert!(
        !tape_file(&tapes).exists(),
        "nothing written for a changed source"
    );
}

#[test]
fn convert_refuses_a_tape_root_inside_the_inputs() {
    let co = checkout("root");
    let inside = co.0.join("data/telonex/tapes");
    let o = run(&co, "convert", &inside, &[]);
    assert!(!o.status.success(), "{}", text(&o));
    assert!(text(&o).contains("16 NT-8"), "{}", text(&o));
    assert!(!inside.exists(), "nothing created");
    let o = run(&co, "convert", &co.0.join("data/telonex/m.parquet/x"), &[]);
    assert!(!o.status.success(), "{}", text(&o));
}

#[test]
fn oversized_cap_flags_are_errors() {
    let co = checkout("cap");
    let o = run(
        &co,
        "convert",
        &co.0.join("tapes"),
        &["--cap-gb", "18446744074"],
    );
    assert!(!o.status.success(), "{}", text(&o));
    assert!(text(&o).contains("--cap-gb is too large"), "{}", text(&o));
}
