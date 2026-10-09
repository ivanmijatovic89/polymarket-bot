//! `pmb-tape`: the only writer of derived native tapes (16 §7.5 NT-4).
//!
//! ```text
//! pmb-tape convert --data-root <dir> --tape-root <dir> --set <manifest.json>
//!                  [--cap-gb 40] [--min-free-gb 10] [--zstd-level 3]
//! pmb-tape verify  --data-root <dir> --tape-root <dir> --set <manifest.json>
//! pmb-tape bench   --data-root <dir> --tape-root <dir> --set <manifest.json>
//!                  [--reps 3] [--json <out.json>] [--configs <list>]
//!                  [--qos default|utility|background] [--label non-idle|idle-window]
//! pmb-tape m19-convert --data-root <dir> --tape-root <dir> --set <manifest.json>
//! pmb-tape info    <tape-file>
//! ```
//!
//! `convert` writes tapes newest market first within the per-host cap and the
//! free-disk floor (NT-7). `verify` proves NT-4 and NT-6 (b) per market: the
//! v1 source still matches the manifest, the tape is valid, its typed rows
//! equal the rows parsed from v1, and the event stream (kind, outcome,
//! levels, both timestamps, skip and anomaly counters) equals the v1
//! reader's. `bench` times v1 vs tape decode (ABBA interleaved, 16 §13.5)
//! and records the host, build, set and QoS conditions with every run;
//! `m19-convert` writes the M-19 alternative encoding that `bench --configs
//! ...,pq-full,pq-rows` times against the tape.

use anyhow::{bail, ensure, Context, Result};
use bytes::Bytes;
use pmb_replay::{read_telonex_delta, InputFile, InputFormat, TelonexInput};
use pmb_tape::codec::{Decoder, EncodeOptions};
use pmb_tape::compare::{digest, first_difference};
use pmb_tape::manifest::{Manifest, Market};
use pmb_tape::store::{
    self, hex, sha256, Budget, ConvertOptions, ConvertOutcome, ExpectedSource, MarketKey,
    DEFAULT_CAP_BYTES, DEFAULT_MIN_FREE_BYTES,
};
use pmb_tape::{
    load_tape, read_market, read_tape_stream, replay, tape_path, InputPath, MarketStream,
};
use std::collections::BTreeMap;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::Instant;

const USAGE: &str = "usage:
  pmb-tape convert     --data-root <dir> --tape-root <dir> --set <manifest.json> [--cap-gb N] [--min-free-gb N] [--zstd-level N]
  pmb-tape verify      --data-root <dir> --tape-root <dir> --set <manifest.json>
  pmb-tape bench       --data-root <dir> --tape-root <dir> --set <manifest.json> [--reps N] [--json <out.json>]
                       [--configs v1,tape,tape-full,tape-rows,pq-full,pq-rows] [--qos default|utility|background]
                       [--label non-idle|idle-window]
  pmb-tape m19-convert --data-root <dir> --tape-root <dir> --set <manifest.json> [--zstd-level N]
                       [--variant delta|plain-dict]
  pmb-tape info        <tape-file>";

struct Args {
    data_root: PathBuf,
    tape_root: PathBuf,
    set: PathBuf,
    flags: BTreeMap<String, String>,
}

fn parse_args(argv: &[String], extra: &[&str]) -> Result<Args> {
    let mut flags = BTreeMap::new();
    let mut i = 0;
    while i < argv.len() {
        let k = argv[i]
            .strip_prefix("--")
            .with_context(|| format!("unexpected argument {}\n{USAGE}", argv[i]))?;
        ensure!(
            ["data-root", "tape-root", "set"].contains(&k) || extra.contains(&k),
            "unknown flag --{k}\n{USAGE}"
        );
        let v = argv
            .get(i + 1)
            .with_context(|| format!("--{k} needs a value"))?;
        ensure!(
            flags.insert(k.to_string(), v.clone()).is_none(),
            "--{k} given twice"
        );
        i += 2;
    }
    let mut take = |k: &str| -> Result<PathBuf> {
        let v = flags
            .remove(k)
            .with_context(|| format!("--{k} is required\n{USAGE}"))?;
        let p = PathBuf::from(v);
        ensure!(
            p.is_absolute() || k == "set",
            "--{k} must be an absolute path"
        );
        Ok(p)
    };
    Ok(Args {
        data_root: take("data-root")?,
        tape_root: take("tape-root")?,
        set: take("set")?,
        flags,
    })
}

fn flag<T: std::str::FromStr>(a: &Args, k: &str, default: T) -> Result<T> {
    match a.flags.get(k) {
        None => Ok(default),
        Some(v) => v
            .parse()
            .map_err(|_| anyhow::anyhow!("--{k}: invalid value {v}")),
    }
}

fn tool_sha() -> Result<[u8; 32]> {
    let exe = std::env::current_exe().context("locate own binary")?;
    Ok(sha256(&std::fs::read(&exe).with_context(|| {
        format!("read own binary {}", exe.display())
    })?))
}

fn market_tape(m: &Manifest, mk: &Market, tape_root: &Path) -> Result<PathBuf> {
    let key = MarketKey {
        format: &m.format.name,
        format_version: m.format.version,
        symbol: &m.symbol,
        timeframe: &m.timeframe,
        slug: &mk.slug,
    };
    tape_path(tape_root, &key).map_err(anyhow::Error::msg)
}

fn input<'a>(mk: &'a Market) -> TelonexInput<'a> {
    TelonexInput {
        tokens: [mk.tokens.up.as_str(), mk.tokens.down.as_str()],
        condition_id: None,
    }
}

/// The job input of a manifest market (15 §9): the manifest's format and
/// size, and its sha256 when `sha256` is set (the bench passes none, as
/// before the reader verified inputs, so v1 timings exclude hashing).
fn job_file<'a>(m: &'a Manifest, mk: &'a Market, v1: &'a Path, sha256: bool) -> InputFile<'a> {
    InputFile {
        path: v1,
        bytes: mk.bytes,
        sha256: sha256.then_some(mk.sha256.as_str()),
        format: InputFormat {
            name: &m.format.name,
            version: m.format.version,
        },
    }
}

/// Market start epoch from the slug suffix (for newest-first ordering).
fn slug_epoch(slug: &str) -> u64 {
    slug.rsplit('-')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn load_avg() -> String {
    std::process::Command::new("sysctl")
        .args(["-n", "vm.loadavg"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "n/a".into())
}

fn convert(a: &Args) -> Result<()> {
    let m = Manifest::load(&a.set)?;
    let gb = 1_000_000_000u64;
    let gb_flag = |k: &str, default: u64| -> Result<u64> {
        flag(a, k, default / gb)?
            .checked_mul(gb)
            .with_context(|| format!("--{k} is too large"))
    };
    let cap = gb_flag("cap-gb", DEFAULT_CAP_BYTES)?;
    let min_free = gb_flag("min-free-gb", DEFAULT_MIN_FREE_BYTES)?;
    let level = flag(a, "zstd-level", pmb_tape::codec::DEFAULT_ZSTD_LEVEL)?;
    let opts = ConvertOptions {
        encode: EncodeOptions {
            zstd_level: level,
            ..EncodeOptions::default()
        },
        tool_sha256: tool_sha()?,
    };
    // NT-8: never write through the read-only data links or into the fleet
    // copy; checked before anything is created.
    let inputs = m
        .markets
        .iter()
        .map(|mk| mk.v1_path(&a.data_root))
        .collect::<Result<Vec<_>>>()?;
    let resolved =
        store::check_tape_root(&a.tape_root, &a.data_root, &inputs).map_err(anyhow::Error::msg)?;
    let (stale, stale_bytes) = store::sweep_stale_tmp(&a.tape_root)
        .with_context(|| format!("sweep {}", a.tape_root.display()))?;
    if stale > 0 {
        println!(
            "  removed {stale} stale temporary files ({stale_bytes} bytes) of dead converters"
        );
    }
    let mut budget = Budget::new(&a.tape_root, cap, min_free)?;
    println!(
        "pmb-tape convert: set {} ({} markets), tape root {} -> {} ({} bytes used, cap {cap}), free {} (floor {min_free}), tool {}",
        m.name,
        m.markets.len(),
        a.tape_root.display(),
        resolved.display(),
        budget.used_bytes,
        budget.free_bytes,
        hex(&opts.tool_sha256)
    );
    let mut order: Vec<&Market> = m.markets.iter().collect();
    order.sort_by(|x, y| {
        slug_epoch(&y.slug)
            .cmp(&slug_epoch(&x.slug))
            .then(y.slug.cmp(&x.slug))
    });
    let mut decoder = Decoder::new()?;
    let (mut written, mut skipped, mut other) = (0u32, 0u32, 0u32);
    let mut changed: Vec<String> = Vec::new();
    let (mut v1_total, mut tape_total) = (0u64, 0u64);
    let started = Instant::now();
    for mk in order {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(&m, mk, &a.tape_root)?;
        let expected = ExpectedSource {
            bytes: mk.bytes,
            sha256: mk.sha256_bytes()?,
        };
        let t0 = Instant::now();
        let out = store::convert_one(
            &v1,
            &tape,
            Some(&expected),
            &opts,
            &mut budget,
            &mut decoder,
        )
        .with_context(|| format!("convert {}", mk.slug))?;
        let ms = t0.elapsed().as_secs_f64() * 1e3;
        match &out {
            ConvertOutcome::Written {
                tape_bytes,
                v1_bytes,
                rows,
                levels,
            } => {
                written += 1;
                v1_total += v1_bytes;
                tape_total += tape_bytes;
                println!(
                    "  written {} rows {rows} levels {levels} v1 {v1_bytes} tape {tape_bytes} ({:.1}%) {ms:.1} ms",
                    mk.slug,
                    100.0 * *tape_bytes as f64 / *v1_bytes as f64
                );
            }
            ConvertOutcome::SkippedValid { tape_bytes } => {
                skipped += 1;
                v1_total += mk.bytes;
                tape_total += tape_bytes;
                println!("  valid   {} tape {tape_bytes}", mk.slug);
            }
            ConvertOutcome::Unconvertible(u) => {
                other += 1;
                println!("  v1-only {} ({}): {u}", mk.slug, u.label());
            }
            ConvertOutcome::NewerFormat(v) => {
                other += 1;
                println!(
                    "  newer   {}: tape format v{v} at the path is newer than this tool's; left alone",
                    mk.slug
                );
            }
            ConvertOutcome::Raced => {
                other += 1;
                println!("  raced   {}: v1 changed during conversion", mk.slug);
            }
            ConvertOutcome::SourceChanged { bytes, sha256 } => {
                changed.push(mk.slug.clone());
                println!(
                    "  CHANGED {}: v1 is {bytes} bytes sha256 {} (manifest {} / {}); not converted",
                    mk.slug,
                    hex(sha256),
                    mk.bytes,
                    mk.sha256
                );
            }
            ConvertOutcome::Stopped(stop) => {
                println!("  STOP at {}: {stop:?} limit reached", mk.slug);
                break;
            }
        }
    }
    println!(
        "pmb-tape convert: {written} written, {skipped} already valid, {other} not converted; v1 {v1_total} bytes, tape {tape_total} bytes ({:.1}%); tape root now {} bytes; {:.1} s",
        if v1_total > 0 { 100.0 * tape_total as f64 / v1_total as f64 } else { 0.0 },
        budget.used_bytes,
        started.elapsed().as_secs_f64()
    );
    // A changed source invalidates the frozen set (16 §13.1).
    ensure!(
        changed.is_empty(),
        "{} source file(s) differ from the manifest {}: {changed:?}",
        changed.len(),
        a.set.display()
    );
    Ok(())
}

fn verify(a: &Args) -> Result<()> {
    let m = Manifest::load(&a.set)?;
    let mut decoder = Decoder::new()?;
    let mut failures = Vec::new();
    let (mut events, mut rows_total) = (0u64, 0u64);
    for mk in &m.markets {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(&m, mk, &a.tape_root)?;
        let result = (|| -> Result<String> {
            // The v1 source still matches the frozen manifest (16 §13.1).
            let data = std::fs::read(&v1).with_context(|| format!("read {}", v1.display()))?;
            let sha = sha256(&data);
            ensure!(
                data.len() as u64 == mk.bytes && sha == mk.sha256_bytes()?,
                "v1 source changed: {} bytes sha256 {} (manifest {} / {})",
                data.len(),
                hex(&sha),
                mk.bytes,
                mk.sha256
            );
            let (header, tape_rows) = load_tape(&mut decoder, &tape, &v1, Some(&sha))
                .map_err(|f| anyhow::anyhow!("no valid tape at {}: {f}", tape.display()))?;
            // NT-4 again: typed rows from the tape equal those parsed from v1.
            let v1_rows = pmb_tape::v1::read_v1(Bytes::from(data))
                .map_err(|u| anyhow::anyhow!("v1 not convertible: {u}"))?;
            ensure!(
                tape_rows == v1_rows,
                "typed rows differ between tape and v1"
            );
            // NT-6 (b): engine event streams of both paths are identical.
            let inp = input(mk);
            let file = job_file(&m, mk, &v1, true);
            let from_v1 = read_telonex_delta(&file, inp).map(MarketStream::V1);
            let from_tape = replay(&tape_rows, &inp, &v1).map(MarketStream::Tape);
            let (x, y) = match (from_v1, from_tape) {
                (Ok(x), Ok(y)) => (x, y),
                (Err(e1), Err(e2)) if e1 == e2 => {
                    return Ok(format!("both paths fail identically: {e1}"))
                }
                (x, y) => bail!("paths disagree: v1 {:?} vs tape {:?}", x.err(), y.err()),
            };
            if let Some(diff) = first_difference(&x, &y) {
                bail!("event streams differ: {diff}");
            }
            // The production lookup takes the tape path (block-streamed
            // decode and replay) and yields the same stream.
            let (streamed, path) = read_market(&file, Some(&tape), &inp, &mut decoder)
                .map_err(|e| anyhow::anyhow!("read_market: {e}"))?;
            ensure!(path == InputPath::Tape, "read_market fell back: {path:?}");
            if let Some(diff) = first_difference(&x, &streamed) {
                bail!("block-streamed tape stream differs: {diff}");
            }
            events += x.len() as u64;
            rows_total += header.rows;
            let d = x.diagnostics();
            Ok(format!(
                "rows {} events {} skipped {} inexact {} digest {}",
                header.rows,
                x.len(),
                d.skipped.total(),
                d.inexact_decimal,
                hex(&digest(&x))
            ))
        })();
        match result {
            Ok(line) => println!("  ok   {} {line}", mk.slug),
            Err(e) => {
                println!("  FAIL {}: {e:#}", mk.slug);
                failures.push(mk.slug.clone());
            }
        }
    }
    println!(
        "pmb-tape verify: set {} — {} of {} markets identical on both paths ({rows_total} rows, {events} events)",
        m.name,
        m.markets.len() - failures.len(),
        m.markets.len()
    );
    ensure!(failures.is_empty(), "verify failed for {failures:?}");
    Ok(())
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Config {
    /// `pmb_replay::read_telonex_delta` (today's v1 path).
    V1,
    /// `read_tape_stream`: tape decoded block by block into reused buffers
    /// and replayed per block (the executor path; `read_market` uses it).
    Tape,
    /// `load_tape` (whole-file typed rows) then `replay`.
    TapeFull,
    /// `load_tape` only: tape file to typed rows (the decode phase).
    TapeRows,
    /// M-19 Parquet INT64 + ZSTD file to typed rows, then `replay`.
    PqFull,
    /// M-19 Parquet INT64 + ZSTD file to typed rows only.
    PqRows,
}

const ALL_CONFIGS: [Config; 6] = [
    Config::V1,
    Config::Tape,
    Config::TapeFull,
    Config::TapeRows,
    Config::PqFull,
    Config::PqRows,
];
const DEFAULT_CONFIGS: &str = "v1,tape,tape-full,tape-rows";

impl Config {
    fn name(self) -> &'static str {
        match self {
            Config::V1 => "v1",
            Config::Tape => "tape",
            Config::TapeFull => "tape-full",
            Config::TapeRows => "tape-rows",
            Config::PqFull => "pq-full",
            Config::PqRows => "pq-rows",
        }
    }

    /// The input file this configuration reads (16 §13.5 "input path").
    fn input_path(self) -> &'static str {
        match self {
            Config::V1 => "v1 (telonex-delta Parquet)",
            Config::Tape | Config::TapeFull | Config::TapeRows => "tape (pmb-tape v1)",
            Config::PqFull | Config::PqRows => "m19 (Parquet INT64 + ZSTD typed rows)",
        }
    }

    fn uses_m19(self) -> bool {
        matches!(self, Config::PqFull | Config::PqRows)
    }
}

fn parse_configs(list: &str) -> Result<Vec<Config>> {
    let mut out = Vec::new();
    for name in list.split(',') {
        let cfg = ALL_CONFIGS
            .into_iter()
            .find(|c| c.name() == name)
            .with_context(|| {
                format!(
                    "--configs: unknown configuration {name:?} (known: {})",
                    ALL_CONFIGS.map(Config::name).join(",")
                )
            })?;
        ensure!(!out.contains(&cfg), "--configs: {name} given twice");
        out.push(cfg);
    }
    Ok(out)
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n == 0 {
        f64::NAN
    } else if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

/// One timed pass of one configuration over the set.
struct Pass {
    cfg: Config,
    ms: Vec<f64>,
    load: String,
}

/// Path of a market's M-19 file under the tape root.
fn m19_path(m: &Manifest, mk: &Market, tape_root: &Path) -> Result<PathBuf> {
    Ok(market_tape(m, mk, &tape_root.join(M19_DIR))?.with_extension("parquet"))
}

const M19_DIR: &str = "m19-parquet-int64";

/// One pass over the set; returns per-market ms (decode to the engine
/// event stream, or to typed rows for the `-rows` configurations; file read
/// included; the result is dropped inside the timing).
fn bench_pass(
    cfg: Config,
    m: &Manifest,
    a: &Args,
    decoder: &mut Decoder,
    pq: &mut pmb_tape::m19::Reader,
) -> Result<Vec<f64>> {
    let mut ms = Vec::with_capacity(m.markets.len());
    for mk in &m.markets {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(m, mk, &a.tape_root)?;
        let alt = m19_path(m, mk, &a.tape_root)?;
        let inp = input(mk);
        let fail = |e: &dyn std::fmt::Display| anyhow::anyhow!("{} {}: {e}", cfg.name(), mk.slug);
        let t0 = Instant::now();
        let n = match cfg {
            Config::V1 => read_telonex_delta(&job_file(m, mk, &v1, false), inp)
                .map_err(|e| fail(&e))?
                .len(),
            Config::Tape => read_tape_stream(decoder, &tape, &v1, None, &inp)
                .map_err(|e| fail(&e))?
                .map_err(|e| fail(&e))?
                .len(),
            Config::TapeFull => {
                let (_, rows) = load_tape(decoder, &tape, &v1, None).map_err(|e| fail(&e))?;
                replay(&rows, &inp, &v1).map_err(|e| fail(&e))?.len()
            }
            Config::TapeRows => load_tape(decoder, &tape, &v1, None)
                .map_err(|e| fail(&e))?
                .1
                .len(),
            Config::PqFull | Config::PqRows => {
                let data = std::fs::read(&alt).map_err(|e| fail(&e))?;
                let (_, rows) = pq.read(Bytes::from(data)).map_err(|e| fail(&e))?;
                if cfg == Config::PqFull {
                    replay(&rows, &inp, &v1).map_err(|e| fail(&e))?.len()
                } else {
                    rows.len()
                }
            }
        };
        black_box(n);
        ms.push(t0.elapsed().as_secs_f64() * 1e3);
    }
    Ok(ms)
}

/// Output of a host command, trimmed ("n/a" when it cannot run).
fn cmd_out(prog: &str, args: &[&str]) -> String {
    std::process::Command::new(prog)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "n/a".into())
}

/// Top processes by CPU (the `ps` check of 16 §13.5).
fn ps_snapshot() -> Vec<String> {
    cmd_out("ps", &["-Ao", "pid,pcpu,pmem,comm", "-r"])
        .lines()
        .take(16)
        .map(str::to_string)
        .collect()
}

/// Effective QoS of this process from its scheduling priority (`ps -o pri`:
/// 31 default, 20 utility, 4 background on macOS).
fn effective_qos() -> (i64, &'static str) {
    let pri = cmd_out("ps", &["-o", "pri=", "-p", &std::process::id().to_string()])
        .parse()
        .unwrap_or(-1);
    let label = match pri {
        31.. => "default",
        20 => "utility",
        4 => "background",
        _ => "other",
    };
    (pri, label)
}

/// Host and build facts recorded with every bench row (16 §13.5).
fn conditions(a: &Args, m: &Manifest, exe_sha: &str, threads: usize) -> Result<serde_json::Value> {
    let (pri, effective) = effective_qos();
    let requested = a.flags.get("qos").map_or("undeclared", String::as_str);
    ensure!(
        ["undeclared", "default", "utility", "background"].contains(&requested),
        "--qos must be default, utility or background"
    );
    ensure!(
        requested == "undeclared" || requested == effective,
        "--qos {requested} declared, but the effective priority is {pri} ({effective}); run it under `taskpolicy -c {requested}`"
    );
    let label = a.flags.get("label").map_or("non-idle", String::as_str);
    ensure!(
        ["non-idle", "idle-window"].contains(&label),
        "--label must be non-idle or idle-window"
    );
    let set_bytes = std::fs::read(&a.set).with_context(|| format!("read {}", a.set.display()))?;
    let sysctl = |k: &str| cmd_out("sysctl", &["-n", k]);
    Ok(serde_json::json!({
        "label": label,
        "host": cmd_out("hostname", &["-s"]),
        "chip": sysctl("machdep.cpu.brand_string"),
        "perfCores": sysctl("hw.perflevel0.physicalcpu"),
        "effCores": sysctl("hw.perflevel1.physicalcpu"),
        "memBytes": sysctl("hw.memsize"),
        "macos": format!("{} ({})", cmd_out("sw_vers", &["-productVersion"]), cmd_out("sw_vers", &["-buildVersion"])),
        "power": cmd_out("pmset", &["-g", "batt"]).lines().next().unwrap_or("n/a").to_string(),
        "lowPowerMode": cmd_out("pmset", &["-g"]).lines().find(|l| l.contains("lowpowermode")).map(|l| l.split_whitespace().last().unwrap_or("").to_string()),
        "rustc": env!("PMB_TAPE_RUSTC"),
        "profile": format!("{} (opt-level {}, debug {})", env!("PMB_TAPE_BUILD_PROFILE"), env!("PMB_TAPE_BUILD_OPT_LEVEL"), env!("PMB_TAPE_BUILD_DEBUG")),
        "canonicalBuild": false,
        "binarySha256": exe_sha,
        "setManifest": { "path": a.set.display().to_string(), "sha256": hex(&sha256(&set_bytes)) },
        "modelConfig": { "path": m.model_config.path, "sha256": m.model_config.sha256, "usedByDecode": false },
        "threads": threads,
        "qos": { "requested": requested, "effective": effective, "effectivePri": pri },
        "cacheBudget": "none: no in-process cache; OS page cache warmed by one discarded pass per configuration",
        "dataRoot": a.data_root.display().to_string(),
        "tapeRoot": a.tape_root.display().to_string(),
    }))
}

/// Before anything is timed: every v1 source still has the manifest's bytes
/// and sha256, and every tape is valid for exactly that file (16 §13.1,
/// NT-5). Returns the bytes and wall ms of these file reads, the first of
/// the sitting (the cold-read note of 16 §13.5; the page cache is not
/// purged, so "cold" is not guaranteed).
fn check_sources(m: &Manifest, a: &Args, decoder: &mut Decoder) -> Result<(u64, f64)> {
    let (mut bytes, mut read_ms) = (0u64, 0f64);
    let mut bad = Vec::new();
    for mk in &m.markets {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(m, mk, &a.tape_root)?;
        let t0 = Instant::now();
        let data = std::fs::read(&v1).with_context(|| format!("read {}", v1.display()))?;
        let buf = std::fs::read(&tape).with_context(|| format!("read {}", tape.display()))?;
        read_ms += t0.elapsed().as_secs_f64() * 1e3;
        bytes += (data.len() + buf.len()) as u64;
        let sha = sha256(&data);
        let expected = mk.sha256_bytes()?;
        if data.len() as u64 != mk.bytes || sha != expected {
            bad.push(format!(
                "{}: v1 source changed ({} bytes sha256 {}; manifest {} / {})",
                mk.slug,
                data.len(),
                hex(&sha),
                mk.bytes,
                mk.sha256
            ));
            continue;
        }
        let tape_ok = decoder
            .header(&buf)
            .map_err(store::Fallback::Invalid)
            .and_then(|h| store::check_tape_identity(&h, &v1, Some(&expected)));
        if let Err(f) = tape_ok {
            bad.push(format!("{}: no valid tape ({f})", mk.slug));
        }
    }
    ensure!(
        bad.is_empty(),
        "refusing to time set {}: {}",
        m.name,
        bad.join("; ")
    );
    Ok((bytes, read_ms))
}

fn bench(a: &Args) -> Result<()> {
    let m = Manifest::load(&a.set)?;
    let reps: usize = flag(a, "reps", 3)?;
    ensure!(reps >= 1, "--reps must be at least 1");
    let configs = parse_configs(
        a.flags
            .get("configs")
            .map_or(DEFAULT_CONFIGS, String::as_str),
    )?;
    let with_m19 = configs.iter().any(|c| c.uses_m19());
    let exe_sha = hex(&tool_sha()?);
    let conditions = conditions(a, &m, &exe_sha, 1)?;
    let ps_start = ps_snapshot();
    let mut decoder = Decoder::new()?;
    let mut pq = pmb_tape::m19::Reader::default();
    let (first_read_bytes, first_read_ms) = check_sources(&m, a, &mut decoder)?;
    println!(
        "  sources match the manifest; first read of the sitting: {first_read_bytes} bytes in {first_read_ms:.1} ms"
    );
    // Sizes (and the M-19 files' identity when they are timed).
    let (mut v1_bytes, mut tape_bytes, mut raw_bytes, mut frame_bytes, mut m19_bytes) =
        (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut per_market = Vec::new();
    for mk in &m.markets {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(&m, mk, &a.tape_root)?;
        let buf = std::fs::read(&tape).with_context(|| format!("read {}", tape.display()))?;
        let h = decoder
            .header(&buf)
            .map_err(|e| anyhow::anyhow!("{}: {e}", mk.slug))?;
        let (vb, tb) = (std::fs::metadata(&v1)?.len(), buf.len() as u64);
        v1_bytes += vb;
        tape_bytes += tb;
        for b in &h.blocks {
            for c in &b.cols {
                raw_bytes += c.raw_len as u64;
                frame_bytes += c.comp_len as u64;
            }
        }
        let mut alt_bytes = serde_json::Value::Null;
        if with_m19 {
            let alt = m19_path(&m, mk, &a.tape_root)?;
            let data = std::fs::read(&alt).with_context(|| {
                format!("read {} (run `pmb-tape m19-convert` first)", alt.display())
            })?;
            let meta = pmb_tape::m19::Reader::meta(Bytes::from(data.clone()))
                .map_err(|e| anyhow::anyhow!("{}: {e}", alt.display()))?;
            ensure!(
                meta.v1_bytes == mk.bytes && meta.v1_sha256 == mk.sha256_bytes()?,
                "{}: M-19 file was built from another v1 file",
                mk.slug
            );
            m19_bytes += data.len() as u64;
            alt_bytes = serde_json::json!(data.len());
        }
        per_market.push((mk.slug.clone(), h.rows, h.levels(), vb, tb, alt_bytes));
    }
    println!(
        "pmb-tape bench: set {} ({} markets), reps {reps}, configs {}, binary sha256 {exe_sha}",
        m.name,
        m.markets.len(),
        configs
            .iter()
            .map(|c| c.name())
            .collect::<Vec<_>>()
            .join(",")
    );
    // One discarded warm-up pass per configuration (warm page cache).
    let load_start = load_avg();
    for &cfg in &configs {
        bench_pass(cfg, &m, a, &mut decoder, &mut pq)?;
    }
    // Interleaved, reversed every repetition (ABBA): A B C, C B A, A B C, ...
    let mut order = Vec::new();
    for r in 0..reps {
        if r % 2 == 0 {
            order.extend(configs.iter().copied());
        } else {
            order.extend(configs.iter().rev().copied());
        }
    }
    let mut runs: Vec<Pass> = Vec::new();
    for cfg in order {
        let ms = bench_pass(cfg, &m, a, &mut decoder, &mut pq)?;
        runs.push(Pass {
            cfg,
            ms,
            load: load_avg(),
        });
    }
    let load_end = load_avg();
    let ps_end = ps_snapshot();
    let mut summary = serde_json::Map::new();
    let mut medians = BTreeMap::new();
    for &cfg in &configs {
        let mine: Vec<&Pass> = runs.iter().filter(|r| r.cfg == cfg).collect();
        let mut totals: Vec<f64> = mine.iter().map(|r| r.ms.iter().sum()).collect();
        let raw_totals = totals.clone();
        let total_med = median(&mut totals);
        let (tmin, tmax) = (totals[0], totals[totals.len() - 1]);
        // Per market: median over repetitions; then the median over markets.
        let mut per: Vec<f64> = (0..m.markets.len())
            .map(|i| median(&mut mine.iter().map(|r| r.ms[i]).collect::<Vec<_>>()))
            .collect();
        let per_market_ms = per.clone();
        let market_med = median(&mut per);
        medians.insert(cfg.name(), total_med);
        println!(
            "  {:<9} total ms: median {total_med:.1} min {tmin:.1} max {tmax:.1}; per-market median {market_med:.2} ms",
            cfg.name()
        );
        summary.insert(
            cfg.name().into(),
            serde_json::json!({
                "inputPath": cfg.input_path(),
                "totalMs": { "median": total_med, "min": tmin, "max": tmax, "reps": raw_totals },
                "perMarketMedianMs": market_med,
                "perMarketMs": per_market_ms,
            }),
        );
    }
    let ratio = |x: &str, y: &str| match (medians.get(x), medians.get(y)) {
        (Some(a), Some(b)) => serde_json::json!(a / b),
        _ => serde_json::Value::Null,
    };
    println!(
        "  bytes: v1 {v1_bytes}, tape {tape_bytes} (tape/v1 {:.3}); tape frames raw {raw_bytes} -> {frame_bytes} (zstd ratio {:.2}); speedup v1/tape {}",
        tape_bytes as f64 / v1_bytes as f64,
        raw_bytes as f64 / frame_bytes.max(1) as f64,
        ratio("v1", "tape")
    );
    if with_m19 {
        println!(
            "  M-19: m19 bytes {m19_bytes} (m19/tape {:.3}); pq-rows/tape-rows {}; pq-full/tape-full {}",
            m19_bytes as f64 / tape_bytes as f64,
            ratio("pq-rows", "tape-rows"),
            ratio("pq-full", "tape-full")
        );
    }
    println!("  load average: start {load_start}, end {load_end}");
    if let Some(out) = a.flags.get("json") {
        let doc = serde_json::json!({
            "set": m.name,
            "markets": m.markets.len(),
            "reps": reps,
            "conditions": conditions,
            "order": runs.iter().map(|r| r.cfg.name()).collect::<Vec<_>>(),
            "loadAvgAfterPass": runs.iter().map(|r| r.load.clone()).collect::<Vec<_>>(),
            "loadAvgStart": load_start,
            "loadAvgEnd": load_end,
            "psStart": ps_start,
            "psEnd": ps_end,
            "binarySha256": exe_sha,
            "firstRead": { "bytes": first_read_bytes, "ms": first_read_ms,
                           "note": "v1 + tape file reads of the source check, the first reads of the sitting; page cache not purged" },
            "bytes": { "v1": v1_bytes, "tape": tape_bytes, "tapeOverV1": tape_bytes as f64 / v1_bytes as f64,
                        "tapeRawColumns": raw_bytes, "tapeFrames": frame_bytes,
                        "m19": if with_m19 { serde_json::json!(m19_bytes) } else { serde_json::Value::Null } },
            "speedupMedianTotal": ratio("v1", "tape"),
            "ratios": { "pqRowsOverTapeRows": ratio("pq-rows", "tape-rows"),
                         "pqFullOverTapeFull": ratio("pq-full", "tape-full"),
                         "tapeRowsOverTapeFull": ratio("tape-rows", "tape-full") },
            "results": summary,
            "perMarket": per_market.iter().map(|(s, r, l, v, t, q)| serde_json::json!({
                "slug": s, "rows": r, "levels": l, "v1Bytes": v, "tapeBytes": t, "m19Bytes": q })).collect::<Vec<_>>(),
        });
        std::fs::write(out, serde_json::to_string_pretty(&doc)? + "\n")
            .with_context(|| format!("write {out}"))?;
        println!("  wrote {out}");
    }
    Ok(())
}

/// Writes the M-19 alternative of every market's typed rows (from its valid
/// tape) under `<tape root>/m19-parquet-int64/`, after a round-trip check.
fn m19_convert(a: &Args) -> Result<()> {
    let m = Manifest::load(&a.set)?;
    let inputs = m
        .markets
        .iter()
        .map(|mk| mk.v1_path(&a.data_root))
        .collect::<Result<Vec<_>>>()?;
    store::check_tape_root(&a.tape_root, &a.data_root, &inputs).map_err(anyhow::Error::msg)?;
    let level = flag(a, "zstd-level", pmb_tape::codec::DEFAULT_ZSTD_LEVEL)?;
    let variant_name = a.flags.get("variant").map_or("delta", String::as_str);
    let variant = pmb_tape::m19::Variant::parse(variant_name)
        .with_context(|| format!("--variant must be plain-dict or delta (got {variant_name})"))?;
    let mut decoder = Decoder::new()?;
    let mut pq = pmb_tape::m19::Reader::default();
    let (mut tape_total, mut m19_total) = (0u64, 0u64);
    for mk in &m.markets {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(&m, mk, &a.tape_root)?;
        let (h, rows) = load_tape(&mut decoder, &tape, &v1, Some(&mk.sha256_bytes()?))
            .map_err(|f| anyhow::anyhow!("{}: no valid tape ({f})", mk.slug))?;
        let encoded = pmb_tape::m19::encode(&rows, &h.v1, level, variant)
            .map_err(|e| anyhow::anyhow!("{}: {e}", mk.slug))?;
        let (_, back) = pq
            .read(Bytes::from(encoded.clone()))
            .map_err(|e| anyhow::anyhow!("{}: decode of the fresh file: {e}", mk.slug))?;
        ensure!(back == rows, "{}: M-19 round trip mismatch", mk.slug);
        let out = m19_path(&m, mk, &a.tape_root)?;
        let dir = out.parent().context("m19 path has no parent")?;
        std::fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
        let tmp = out.with_extension(format!("parquet.tmp.{}", std::process::id()));
        std::fs::write(&tmp, &encoded).with_context(|| format!("write {}", tmp.display()))?;
        std::fs::rename(&tmp, &out).with_context(|| format!("rename {}", out.display()))?;
        let tb = std::fs::metadata(&tape)?.len();
        tape_total += tb;
        m19_total += encoded.len() as u64;
        println!(
            "  m19 {} tape {tb} m19 {} ({:.3})",
            mk.slug,
            encoded.len(),
            encoded.len() as f64 / tb as f64
        );
    }
    println!(
        "pmb-tape m19-convert: set {} ({}) — tape {tape_total} bytes, m19 {m19_total} bytes (m19/tape {:.3})",
        m.name,
        variant.name(),
        m19_total as f64 / tape_total as f64
    );
    Ok(())
}

fn info(path: &Path) -> Result<()> {
    let buf = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let mut d = Decoder::new()?;
    let (h, rows) = d.decode(&buf).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!(
        "format v{} rows {} levels {} blocks {} dict {} bytes {}\nv1 bytes {} mtime_ns {} sha256 {}\ntool sha256 {} zstd level {}",
        h.format_version,
        h.rows,
        h.levels(),
        h.blocks.len(),
        rows.dict.len(),
        buf.len(),
        h.v1.bytes,
        h.v1.mtime_ns,
        hex(&h.v1.sha256),
        hex(&h.tool_sha256),
        h.zstd_level
    );
    // Per-column totals over all blocks: raw bytes, frame bytes, widths.
    println!("column  raw_bytes  frame_bytes  widths");
    for c in 0..pmb_tape::codec::col::COUNT {
        let (mut raw, mut comp) = (0u64, 0u64);
        let mut widths = std::collections::BTreeSet::new();
        for b in &h.blocks {
            raw += b.cols[c].raw_len as u64;
            comp += b.cols[c].comp_len as u64;
            widths.insert(b.cols[c].width);
        }
        println!("{c:>6} {raw:>10} {comp:>12}  {widths:?}");
    }
    Ok(())
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let result = match argv.first().map(String::as_str) {
        Some("convert") => parse_args(&argv[1..], &["cap-gb", "min-free-gb", "zstd-level"])
            .and_then(|a| convert(&a)),
        Some("verify") => parse_args(&argv[1..], &[]).and_then(|a| verify(&a)),
        Some("bench") => parse_args(&argv[1..], &["reps", "json", "configs", "qos", "label"])
            .and_then(|a| bench(&a)),
        Some("m19-convert") => {
            parse_args(&argv[1..], &["zstd-level", "variant"]).and_then(|a| m19_convert(&a))
        }
        Some("info") if argv.len() == 2 => info(Path::new(&argv[1])),
        _ => Err(anyhow::anyhow!("{USAGE}")),
    };
    if let Err(e) = result {
        eprintln!("pmb-tape: {e:#}");
        std::process::exit(1);
    }
}
