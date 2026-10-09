//! Shared test fixtures: the committed fixture market (`tests/fixtures/`,
//! one market of the decode golden in `native/fixtures/decode/`), job
//! builders, and an in-test engine backend that stands in for the
//! pmb-engine bodies still being written.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use pmb_core::market::Window;
use pmb_core::{MarketEvent, MarketInfo, PerOutcome, TsMs, Usdc};
use pmb_engine::clock::DecisionOrigin;
use pmb_engine::stats::{FinalStats, MarketStatsAcc};
use pmb_engine::strategy::{
    Ctx, Intents, Interests, Requirements, StrategyResult, TickCause, TickInterest,
};
use pmb_engine::trace::{TraceEvent, TraceSink};
use pmb_engine::Strategy;
use pmb_runtime::backend::{Backend, CandidateRun, RunCtx, RunFailure};
use pmb_runtime::job::CandidatePlan;
use pmb_runtime::EngineError;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// The worktree root (`native/..`).
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

/// The committed fixture market (`tests/fixtures/`): a 54-row telonex-delta
/// file of the decode golden (`native/fixtures/decode/telonex_book_golden.json`),
/// copied into the crate so every host and CI run it (R12: no test passes
/// by skipping).
pub const FIXTURE_SLUG: &str = "btc-updown-5m-1770857100";
/// sha256 of the fixture file (guards against an accidental replacement).
pub const FIXTURE_SHA256: &str = "0b2d0cb9a79ae7d8c0e96fad91055b1084ff335d4d37285a2df4117955ae9e66";

/// The golden entry of the fixture market.
pub fn fixture_golden() -> Value {
    let golden: Value = serde_json::from_slice(
        &std::fs::read(repo_root().join("native/fixtures/decode/telonex_book_golden.json"))
            .unwrap(),
    )
    .unwrap();
    golden["markets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| {
            m["file"]
                .as_str()
                .unwrap()
                .ends_with(&format!("/{FIXTURE_SLUG}.parquet"))
        })
        .expect("the fixture market is in the decode golden")
        .clone()
}

/// The fixture market: (path, slug, [UP, DOWN] tokens, bytes).
pub fn fixture_market() -> (PathBuf, String, [String; 2], u64) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(format!("{FIXTURE_SLUG}.parquet"));
    assert_eq!(file_sha256(&path), FIXTURE_SHA256, "{}", path.display());
    let m = fixture_golden();
    let tokens = [
        m["tokens"][0].as_str().unwrap().to_string(),
        m["tokens"][1].as_str().unwrap().to_string(),
    ];
    let bytes = std::fs::metadata(&path).unwrap().len();
    (path, FIXTURE_SLUG.to_string(), tokens, bytes)
}

/// sha256 of a file, lowercase hex.
pub fn file_sha256(path: &Path) -> String {
    let d = Sha256::digest(std::fs::read(path).unwrap());
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// A valid ts-compat telonex-delta job for `strategy_id`.
pub fn job(
    strategy_id: &str,
    slug: &str,
    tokens: &[String; 2],
    input_path: &str,
    bytes: u64,
) -> Value {
    let start: u64 = slug.rsplit('-').next().unwrap().parse().unwrap();
    let tf_ms: u64 = if slug.contains("-15m-") {
        900_000
    } else {
        300_000
    };
    json!({
        "jobSchemaVersion": 1,
        "run": {
            "strategyId": strategy_id,
            "inputMode": "telonex-delta",
            "modelConfig": {
                "modelConfigVersion": 1,
                "profile": "ts-compat",
                "seed": 0,
                "capital": { "startingCapitalUsdc": "500" },
                "execution": {
                    "models": {
                        "latency": "compat", "fee": "flat_700bps_4dp", "takerDelay": "off",
                        "depletion": "none", "maker": "worst_queue", "reports": "compat"
                    },
                    "compatLatency": { "delayMs": 0, "jitterMs": 0 }
                },
                "feeds": {
                    "calibrationId": "feeds-2026-07-21",
                    "binance": { "latency": { "kind": "constant", "ms": 110 } },
                    "chainlink": { "latency": { "kind": "constant", "ms": 320 }, "maxGapMs": 300000 },
                    "priceToBeat": { "latency": { "kind": "constant", "ms": 2700 } }
                },
                "runner": { "maxEventsPerDrain": 4200 },
                "risk": {
                    "maxOpenOrders": 100, "maxOrderSize": "2000",
                    "maxAbsPosition": "2000", "maxLossStopUsdc": "500"
                },
                "rules": { "rulesTableVersion": "rules-table-v1", "missingSnapshot": "dated_fallback" }
            },
            "candidates": [{ "key": "cand-a", "index": 0, "params": {}, "execution": null }]
        },
        "market": {
            "slug": slug,
            "conditionId": null,
            "window": { "startMs": start * 1000, "endMs": start * 1000 + tf_ms },
            "tokenIds": { "UP": tokens[0], "DOWN": tokens[1] },
            "outcome": "UP",
            "rules": { "snapshotParserVersion": null, "captured": {}, "disagreements": 0 },
            "feedAvailability": { "priceToBeat": null },
            "input": {
                "path": input_path, "bytes": bytes, "sha256": null,
                "format": { "name": "telonex-delta-typed", "version": 1 }
            },
            "recorderV4": null,
            "ownActivity": null,
            "feedFiles": []
        },
        "outputs": { "tracePath": null, "traceLevel": "decisions", "ledgerPath": null },
        "budget": { "wallMs": 600000, "threads": 1 }
    })
}

/// A job whose input does not need to exist (for failures before decode).
pub fn synthetic_job(strategy_id: &str) -> Value {
    job(
        strategy_id,
        "btc-updown-15m-1780272000",
        &["1111".to_string(), "2222".to_string()],
        "/nonexistent/pmb-runtime-tests/btc-updown-15m-1780272000.parquet",
        10,
    )
}

/// Never trades.
pub struct Idle;

impl Strategy for Idle {
    type Params = ();
    const ID: &'static str = "runtime-test-idle.v1";

    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }
    fn new(_p: &(), _m: &MarketInfo) -> Self {
        Idle
    }
    fn on_tick(&mut self, _c: &Ctx, _o: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

/// Panics when created for a market (a strategy fault in `new`).
pub struct PanicsInNew;

impl Strategy for PanicsInNew {
    type Params = ();
    const ID: &'static str = "runtime-test-panics.v1";

    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }
    fn new(_p: &(), _m: &MarketInfo) -> Self {
        panic!("strategy refuses this market")
    }
    fn on_tick(&mut self, _c: &Ctx, _o: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

/// Calls of `Fickle::interests`.
static FICKLE_CALLS: AtomicU32 = AtomicU32::new(0);

/// Its interests change after the first evaluation, breaking 30 §4 rule 3
/// (requirements and interests are pure functions of the params).
pub struct Fickle;

impl Strategy for Fickle {
    type Params = ();
    const ID: &'static str = "runtime-test-fickle.v1";

    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }
    fn interests(_p: &()) -> Interests {
        if FICKLE_CALLS.fetch_add(1, Ordering::SeqCst) == 0 {
            Interests::ALL
        } else {
            Interests {
                ticks: TickInterest::TopOfBook,
                ..Interests::ALL
            }
        }
    }
    fn new(_p: &(), _m: &MarketInfo) -> Self {
        Fickle
    }
    fn on_tick(&mut self, _c: &Ctx, _o: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

/// What the in-test backend does.
#[derive(Clone, Debug)]
pub enum Mode {
    /// Count ticks, emit trace events for in-window ticks, no trading.
    Idle,
    /// Fail the job with this error (engine fault, deadline, ...).
    Group(EngineError),
    /// Panic inside engine code.
    EnginePanic,
    /// Return stats that break the 21 §19 egress identities.
    BadStats,
}

/// In-test engine backend. It stands in for `pmb_engine::Session` (whose
/// bodies are `todo!()` on this branch): it creates the strategy instance
/// inside a catch boundary, counts ticks before the window gate (21 §15),
/// applies the ts-compat telonex window `[start, end]` (21 §5.2), and emits
/// `TickStart` and empty `Decision` events to the sink (22 §2).
pub struct FakeBackend {
    pub mode: Mode,
}

impl FakeBackend {
    pub const fn new(mode: Mode) -> FakeBackend {
        FakeBackend { mode }
    }
}

fn zero_stats() -> FinalStats {
    FinalStats {
        pnl: Usdc::ZERO,
        trade_count: 0,
        trade_as_maker: 0,
        trade_as_taker: 0,
        fees_paid: Usdc::ZERO,
        buy_vwap: PerOutcome::new((0, 0), (0, 0)),
        shares: PerOutcome::new(0, 0),
        cost: Usdc::ZERO,
        split_cost: Usdc::ZERO,
        cash_end: Usdc::from_micros(500_000_000),
        cash_start: Usdc::from_micros(500_000_000),
        intent_meta: Vec::new(),
    }
}

fn in_window(w: Window, t: TsMs) -> bool {
    t >= w.start_ms && t <= w.end_ms
}

impl<T: Strategy> Backend<T> for FakeBackend {
    fn run_candidate<K: TraceSink>(
        &self,
        cx: &RunCtx<'_>,
        cand: &CandidatePlan<T::Params>,
        mut sink: K,
    ) -> Result<CandidateRun, RunFailure> {
        match &self.mode {
            Mode::Group(e) => return Err(RunFailure::Group(e.clone())),
            Mode::EnginePanic => panic!("engine invariant broken"),
            Mode::Idle | Mode::BadStats => {}
        }
        let _strategy = pmb_runtime::panic::catch(|| T::new(&cand.params, &cx.inputs.info))
            .map_err(|p| RunFailure::Strategy {
                cause: "panic",
                message: p.message,
                callback: "new",
                seq: 0,
                at: TsMs(0),
            })?;
        let mut acc = MarketStatsAcc::default();
        let window = cx.inputs.info.window;
        let empty = Intents::new();
        let mut seq = 0u64;
        for i in 0..cx.inputs.tape.len() {
            if i % 4096 == 0 && cx.deadline.expired() {
                return Err(RunFailure::Group(cx.deadline.error()));
            }
            let ev = cx.inputs.tape.event(i);
            let cause = match ev.event {
                MarketEvent::Book { .. } => TickCause::Book,
                MarketEvent::PriceChange { .. } => TickCause::PriceChange,
                _ => continue,
            };
            acc.ticks.record(cause);
            if !in_window(window, ev.exchange_ts) {
                continue;
            }
            acc.ticks.strategy_ticks += 1;
            sink.record(&TraceEvent::TickStart {
                seq,
                cause,
                decision_ts: ev.exchange_ts,
                exchange_ts: Some(ev.exchange_ts),
                visibility_ts: ev.exchange_ts,
            });
            sink.record(&TraceEvent::Decision {
                seq,
                origin: DecisionOrigin::Tick,
                intents: &empty,
            });
            seq += 1;
        }
        let mut stats = zero_stats();
        if matches!(self.mode, Mode::BadStats) {
            stats.trade_count = 2;
            stats.trade_as_taker = 1;
            stats.shares = PerOutcome::new(1_000_000, 0);
        }
        sink.record(&TraceEvent::Final(&stats));
        Ok(CandidateRun {
            stats,
            counted_tick_seen: acc.ticks.events_processed() > 0,
            acc,
            intent_meta: Vec::new(),
            skew_ms: None,
        })
    }
}
