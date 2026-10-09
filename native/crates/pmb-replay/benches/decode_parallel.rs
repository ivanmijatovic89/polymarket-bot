//! L0 throughput of the telonex-delta reader over the `smoke-50` set at
//! T = 1, 4 and 10 threads (16 §2.3, §10.3): the E-core share of
//! multi-core throughput on a 4P + 6E host. Each iteration reads every
//! market of the set once (`read_telonex_delta`, file → tape) with T scoped
//! threads pulling markets from a shared index; throughput is rows per
//! second. With the P-cores saturated at T = 4, the E-core share is about
//! `1 - rows/s(T=4) / rows/s(T=10)`. Only a measurement inside the benchmark
//! window means anything (16 §13.5); under load it is `non-idle`.
//!
//! Inputs: `native/bench/sets/smoke-50.json` (16 §13.1), each file's size
//! and sha256 verified before measuring, resolved under
//! `PMB_BENCH_DATA_ROOT` (default `<repo>/data`). A missing market is an
//! error unless `PMB_BENCH_ALLOW_MISSING=1`.
//! Run: `cargo bench -p pmb-replay --bench decode_parallel` or
//! `npm run native:bench:l0 -- --target pmb-replay/decode_parallel`.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use pmb_replay::telonex::{file_asset_ids, FORMAT_NAME, FORMAT_VERSION};
use pmb_replay::{read_telonex_delta, InputFile, InputFormat, TelonexInput};
use sha2::{Digest, Sha256};
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

const SMOKE_50: &str = "native/bench/sets/smoke-50.json";
const THREADS: [usize; 3] = [1, 4, 10];

struct Market {
    path: PathBuf,
    tokens: [String; 2],
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repository root")
}

fn data_root() -> PathBuf {
    match std::env::var_os("PMB_BENCH_DATA_ROOT") {
        Some(p) => PathBuf::from(p),
        None => repo_root().join("data"),
    }
}

fn sha256_hex(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn markets() -> Vec<Market> {
    let allow_missing = std::env::var_os("PMB_BENCH_ALLOW_MISSING").is_some_and(|v| v == "1");
    let manifest_path = repo_root().join(SMOKE_50);
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&manifest_path)
            .unwrap_or_else(|e| panic!("{}: {e}", manifest_path.display())),
    )
    .expect("smoke-50 manifest JSON");
    let data = data_root();
    let mut out = Vec::new();
    for m in manifest["markets"].as_array().expect("manifest markets") {
        let path = data.join(m["file"].as_str().expect("file"));
        if !path.exists() {
            assert!(
                allow_missing,
                "smoke-50: {} does not exist (set PMB_BENCH_ALLOW_MISSING=1 to skip it)",
                path.display()
            );
            eprintln!("skip smoke-50 market (missing): {}", path.display());
            continue;
        }
        assert_eq!(
            sha256_hex(&path),
            m["sha256"].as_str().expect("sha256"),
            "smoke-50 {}: sha256 differs from the manifest (source changed, 16 §13.1)",
            path.display()
        );
        let ids = file_asset_ids(&path).expect("asset ids");
        assert!(
            !ids.is_empty() && ids.len() <= 2,
            "{}: expected 1 or 2 asset ids, got {ids:?}",
            path.display()
        );
        // A market with one recorded side decodes against a placeholder
        // second token; the reader counts its rows as it would in a run.
        let second = ids.get(1).cloned().unwrap_or_else(|| "0".to_string());
        out.push(Market {
            path,
            tokens: [ids[0].clone(), second],
        });
    }
    out
}

fn read_rows(m: &Market) -> u64 {
    let input = TelonexInput {
        tokens: [m.tokens[0].as_str(), m.tokens[1].as_str()],
        condition_id: None,
    };
    read_telonex_delta(&input_file(&m.path), input)
        .unwrap_or_else(|e| panic!("{}: {e}", m.path.display()))
        .diagnostics()
        .rows_read
}

/// The job input of a bench market: its size from `stat`, no sha256 (the
/// sets are verified against their manifests before measuring).
fn input_file(path: &Path) -> InputFile<'_> {
    InputFile {
        path,
        bytes: std::fs::metadata(path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .len(),
        sha256: None,
        format: InputFormat {
            name: FORMAT_NAME,
            version: FORMAT_VERSION,
        },
    }
}

/// Reads every market once with `threads` workers; returns the rows read.
fn read_all(markets: &[Market], threads: usize) -> u64 {
    let next = AtomicUsize::new(0);
    std::thread::scope(|s| {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                s.spawn(|| {
                    let mut rows = 0u64;
                    while let Some(m) = markets.get(next.fetch_add(1, Ordering::Relaxed)) {
                        rows += read_rows(m);
                    }
                    rows
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|w| w.join().expect("decode worker"))
            .sum()
    })
}

fn bench_parallel(c: &mut Criterion) {
    let markets = markets();
    assert!(!markets.is_empty(), "no smoke-50 market present");
    let rows = read_all(&markets, 1);
    eprintln!("smoke-50: {} markets, {rows} rows", markets.len());
    let mut g = c.benchmark_group("decode_parallel");
    g.sample_size(10).measurement_time(Duration::from_secs(10));
    g.throughput(Throughput::Elements(rows));
    for t in THREADS {
        g.bench_function(BenchmarkId::new("smoke-50", format!("T{t}")), |b| {
            b.iter(|| black_box(read_all(black_box(&markets), t)))
        });
    }
    g.finish();
}

criterion_group!(benches, bench_parallel);
criterion_main!(benches);
