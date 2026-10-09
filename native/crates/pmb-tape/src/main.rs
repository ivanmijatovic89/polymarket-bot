//! `pmb-tape`: the only writer of derived native tapes (16 §7.5 NT-4).
//!
//! ```text
//! pmb-tape convert --data-root <dir> --tape-root <dir> --set <manifest.json>
//!                  [--cap-gb 40] [--min-free-gb 10] [--zstd-level 3]
//! pmb-tape verify  --data-root <dir> --tape-root <dir> --set <manifest.json>
//! pmb-tape bench   --data-root <dir> --tape-root <dir> --set <manifest.json>
//!                  [--reps 3] [--json <out.json>]
//! pmb-tape info    <tape-file>
//! ```
//!
//! `convert` writes tapes newest market first within the per-host cap and the
//! free-disk floor (NT-7). `verify` proves NT-4 and NT-6 (b) per market: the
//! v1 source still matches the manifest, the tape is valid, its typed rows
//! equal the rows parsed from v1, and the event stream (kind, outcome,
//! levels, both timestamps, skip and anomaly counters) equals the v1
//! reader's. `bench` times v1 vs tape decode (ABBA interleaved, 16 §13.5).

use anyhow::{bail, ensure, Context, Result};
use bytes::Bytes;
use pmb_replay::{read_telonex_delta, TelonexInput};
use pmb_tape::codec::{Decoder, EncodeOptions};
use pmb_tape::compare::{digest, first_difference};
use pmb_tape::manifest::{Manifest, Market};
use pmb_tape::store::{
    self, hex, sha256, Budget, ConvertOptions, ConvertOutcome, DEFAULT_CAP_BYTES,
    DEFAULT_MIN_FREE_BYTES,
};
use pmb_tape::{
    load_tape, read_market, read_tape_stream, replay, tape_path, InputPath, MarketStream,
};
use std::collections::BTreeMap;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::Instant;

const USAGE: &str = "usage:
  pmb-tape convert --data-root <dir> --tape-root <dir> --set <manifest.json> [--cap-gb N] [--min-free-gb N] [--zstd-level N]
  pmb-tape verify  --data-root <dir> --tape-root <dir> --set <manifest.json>
  pmb-tape bench   --data-root <dir> --tape-root <dir> --set <manifest.json> [--reps N] [--json <out.json>]
  pmb-tape info    <tape-file>";

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
    tape_path(tape_root, &m.symbol, &m.timeframe, &mk.slug).map_err(anyhow::Error::msg)
}

fn input<'a>(mk: &'a Market) -> TelonexInput<'a> {
    TelonexInput {
        format_version: 1,
        tokens: [mk.tokens.up.as_str(), mk.tokens.down.as_str()],
        condition_id: None,
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
    let cap = flag(a, "cap-gb", DEFAULT_CAP_BYTES / gb)? * gb;
    let min_free = flag(a, "min-free-gb", DEFAULT_MIN_FREE_BYTES / gb)? * gb;
    let level = flag(a, "zstd-level", pmb_tape::codec::DEFAULT_ZSTD_LEVEL)?;
    let opts = ConvertOptions {
        encode: EncodeOptions {
            zstd_level: level,
            ..EncodeOptions::default()
        },
        tool_sha256: tool_sha()?,
    };
    let mut budget = Budget::new(&a.tape_root, cap, min_free)?;
    println!(
        "pmb-tape convert: set {} ({} markets), tape root {} ({} bytes used, cap {cap}), free {} (floor {min_free}), tool {}",
        m.name,
        m.markets.len(),
        a.tape_root.display(),
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
    let (mut v1_total, mut tape_total) = (0u64, 0u64);
    let started = Instant::now();
    for mk in order {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(&m, mk, &a.tape_root)?;
        let t0 = Instant::now();
        let out = store::convert_one(&v1, &tape, &opts, &mut budget, &mut decoder)
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
                if *v1_bytes != mk.bytes {
                    println!(
                        "  WARNING {}: v1 is {v1_bytes} bytes, manifest says {}",
                        mk.slug, mk.bytes
                    );
                }
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
            ConvertOutcome::Raced => {
                other += 1;
                println!("  raced   {}: v1 changed during conversion", mk.slug);
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
            let from_v1 = read_telonex_delta(&v1, &inp).map(MarketStream::V1);
            let from_tape = replay(&tape_rows, &inp).map(MarketStream::Tape);
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
            let (streamed, path) = read_market(&v1, Some(&tape), Some(&sha), &inp, &mut decoder)
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

#[derive(Copy, Clone, PartialEq, Eq)]
enum Config {
    /// `pmb_replay::read_telonex_delta` (today's v1 path).
    V1,
    /// `read_tape_stream`: tape decoded block by block into reused buffers
    /// and replayed per block (the executor path; `read_market` uses it).
    Tape,
    /// `load_tape` (whole-file typed rows) then `replay`.
    TapeFull,
}

const CONFIGS: [Config; 3] = [Config::V1, Config::Tape, Config::TapeFull];

impl Config {
    fn name(self) -> &'static str {
        match self {
            Config::V1 => "v1",
            Config::Tape => "tape",
            Config::TapeFull => "tape-full",
        }
    }
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

/// One pass over the set; returns per-market ms (decode to the engine
/// event stream, file read included, result dropped inside the timing).
fn bench_pass(cfg: Config, m: &Manifest, a: &Args, decoder: &mut Decoder) -> Result<Vec<f64>> {
    let mut ms = Vec::with_capacity(m.markets.len());
    for mk in &m.markets {
        let v1 = mk.v1_path(&a.data_root)?;
        let tape = market_tape(m, mk, &a.tape_root)?;
        let inp = input(mk);
        let fail = |e: &dyn std::fmt::Display| anyhow::anyhow!("{} {}: {e}", cfg.name(), mk.slug);
        let t0 = Instant::now();
        let n = match cfg {
            Config::V1 => read_telonex_delta(&v1, &inp).map_err(|e| fail(&e))?.len(),
            Config::Tape => read_tape_stream(decoder, &tape, &v1, None, &inp)
                .map_err(|e| fail(&e))?
                .map_err(|e| fail(&e))?
                .len(),
            Config::TapeFull => {
                let (_, rows) = load_tape(decoder, &tape, &v1, None).map_err(|e| fail(&e))?;
                replay(&rows, &inp).map_err(|e| fail(&e))?.len()
            }
        };
        black_box(n);
        ms.push(t0.elapsed().as_secs_f64() * 1e3);
    }
    Ok(ms)
}

fn bench(a: &Args) -> Result<()> {
    let m = Manifest::load(&a.set)?;
    let reps: usize = flag(a, "reps", 3)?;
    ensure!(reps >= 1, "--reps must be at least 1");
    let mut decoder = Decoder::new()?;
    // Sizes.
    let (mut v1_bytes, mut tape_bytes, mut raw_bytes, mut frame_bytes) = (0u64, 0u64, 0u64, 0u64);
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
        per_market.push((mk.slug.clone(), h.rows, h.levels(), vb, tb));
    }
    let exe_sha = hex(&tool_sha()?);
    println!(
        "pmb-tape bench: set {} ({} markets), reps {reps}, binary sha256 {exe_sha}",
        m.name,
        m.markets.len()
    );
    // One discarded warm-up pass per configuration (warm page cache).
    let load_start = load_avg();
    for cfg in CONFIGS {
        bench_pass(cfg, &m, a, &mut decoder)?;
    }
    // Interleaved, reversed every repetition (ABBA): v1 tape full, full tape v1, ...
    let mut order = Vec::new();
    for r in 0..reps {
        if r % 2 == 0 {
            order.extend(CONFIGS);
        } else {
            order.extend(CONFIGS.iter().rev());
        }
    }
    let mut runs: Vec<Pass> = Vec::new();
    for cfg in order {
        let ms = bench_pass(cfg, &m, a, &mut decoder)?;
        runs.push(Pass {
            cfg,
            ms,
            load: load_avg(),
        });
    }
    let load_end = load_avg();
    let mut summary = serde_json::Map::new();
    for cfg in CONFIGS {
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
        println!(
            "  {:<9} total ms: median {total_med:.1} min {tmin:.1} max {tmax:.1}; per-market median {market_med:.2} ms",
            cfg.name()
        );
        summary.insert(
            cfg.name().into(),
            serde_json::json!({
                "totalMs": { "median": total_med, "min": tmin, "max": tmax, "reps": raw_totals },
                "perMarketMedianMs": market_med,
                "perMarketMs": per_market_ms,
            }),
        );
    }
    let speedup = summary["v1"]["totalMs"]["median"]
        .as_f64()
        .unwrap_or(f64::NAN)
        / summary["tape"]["totalMs"]["median"]
            .as_f64()
            .unwrap_or(f64::NAN);
    println!(
        "  bytes: v1 {v1_bytes}, tape {tape_bytes} (tape/v1 {:.3}); tape frames raw {raw_bytes} -> {frame_bytes} (zstd ratio {:.2}); speedup v1/tape {speedup:.2}x",
        tape_bytes as f64 / v1_bytes as f64,
        raw_bytes as f64 / frame_bytes.max(1) as f64
    );
    println!("  load average: start {load_start}, end {load_end}");
    if let Some(out) = a.flags.get("json") {
        let doc = serde_json::json!({
            "set": m.name,
            "markets": m.markets.len(),
            "reps": reps,
            "order": runs.iter().map(|r| r.cfg.name()).collect::<Vec<_>>(),
            "loadAvgAfterPass": runs.iter().map(|r| r.load.clone()).collect::<Vec<_>>(),
            "loadAvgStart": load_start,
            "loadAvgEnd": load_end,
            "binarySha256": exe_sha,
            "bytes": { "v1": v1_bytes, "tape": tape_bytes, "tapeOverV1": tape_bytes as f64 / v1_bytes as f64,
                        "tapeRawColumns": raw_bytes, "tapeFrames": frame_bytes },
            "speedupMedianTotal": speedup,
            "results": summary,
            "perMarket": per_market.iter().map(|(s, r, l, v, t)| serde_json::json!({
                "slug": s, "rows": r, "levels": l, "v1Bytes": v, "tapeBytes": t })).collect::<Vec<_>>(),
        });
        std::fs::write(out, serde_json::to_string_pretty(&doc)? + "\n")
            .with_context(|| format!("write {out}"))?;
        println!("  wrote {out}");
    }
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
        Some("bench") => parse_args(&argv[1..], &["reps", "json"]).and_then(|a| bench(&a)),
        Some("info") if argv.len() == 2 => info(Path::new(&argv[1])),
        _ => Err(anyhow::anyhow!("{USAGE}")),
    };
    if let Err(e) = result {
        eprintln!("pmb-tape: {e:#}");
        std::process::exit(1);
    }
}
