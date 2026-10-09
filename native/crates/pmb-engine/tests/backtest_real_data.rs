//! Real-data smoke run of the integrated ts-compat backtest path (M1 steps
//! 3–4): the pmb-replay reader over the real telonex-delta markets listed in
//! the decode golden (`native/fixtures/decode/telonex_book_golden.json`),
//! `BacktestMarket` with a rule-based strategy that places, cancels and
//! fills, and `market_output` with its egress self-check (21 §19).
//!
//! Asserts: no fault, the self-check passes, `eventsProcessed` equals the
//! kept rows (21 §15, 15 I-19), and the serialized output is byte-identical
//! across runs and inside a candidate group (R7). Markets whose data file is
//! absent on this host are skipped and reported, like the decode test. The
//! throughput is printed (R8), not asserted.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::vocab::InputMode;
use pmb_core::ids::{CidKey, ClientOrderId, ConditionId, TokenId};
use pmb_core::market::MarketVersion;
use pmb_core::order::{OrderRequest, Side};
use pmb_core::rules::{
    ExchangeRules, FeeEraId, RulesProvenance, RulesSource, RulesTableVersion, RulesTimeline,
};
use pmb_core::seed::MarketSeed;
use pmb_core::{FinalOutcome, MarketInfo, Outcome, PerOutcome, Price, Qty, Usdc};
use pmb_engine::config::RiskLimits;
use pmb_engine::strategy::{Meta, MetaValue, Requirements};
use pmb_engine::{
    market_output, BacktestMarket, CoreRules, Ctx, EngineConfig, Intents, NoTrace, OutputContext,
    SharedMarket, Strategy, StrategyResult,
};
use pmb_replay::{read_telonex_delta, TelonexInput};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

/// Every 40th strategy tick: a taker BUY at the best ask (meta) and a
/// resting BUY one tick under the best bid; the resting order is canceled 20
/// ticks later; every 160th tick a taker SELL of half the Up position.
struct Smoke;

fn cid(prefix: &str, seq: u64) -> ClientOrderId {
    ClientOrderId::new(&format!("{prefix}{seq}")).expect("cid")
}

impl Strategy for Smoke {
    type Params = ();
    const ID: &'static str = "smoke-real-data.v1";

    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }

    fn new(_p: &(), _market: &MarketInfo) -> Self {
        Smoke
    }

    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        let seq = ctx.tick().seq;
        let book = ctx.book(Outcome::Up);
        let tick = Price::from_micros(10_000);
        match seq % 40 {
            0 => {
                if let Some(a) = book.best_ask().filter(|a| a.price.micros() < 900_000) {
                    let mut m = Meta::new();
                    m.push("seq", MetaValue::I64(seq as i64));
                    m.push("ask", MetaValue::F64(a.price.micros() as f64 / 1e6));
                    let req = OrderRequest::gtc(
                        CidKey::new(0),
                        Outcome::Up,
                        Side::Buy,
                        a.price,
                        Qty::from_micros(5_000_000),
                    );
                    out.place_request(&cid("t", seq), req, Some(m));
                }
                if let Some(b) = book.best_bid().filter(|b| b.price > tick) {
                    let req = OrderRequest::gtc(
                        CidKey::new(0),
                        Outcome::Up,
                        Side::Buy,
                        Price::from_micros(b.price.micros() - tick.micros()),
                        Qty::from_micros(5_000_000),
                    );
                    out.place_request(&cid("m", seq), req, None);
                }
            }
            20 => out.cancel(&cid("m", seq - 20)),
            _ => {}
        }
        if seq % 160 == 80 {
            let held = ctx.portfolio().position(Outcome::Up).qty;
            if let Some(b) = book.best_bid() {
                let half = Qty::from_micros(held.micros() / 2);
                if half.micros() > 0 {
                    let req =
                        OrderRequest::gtc(CidKey::new(0), Outcome::Up, Side::Sell, b.price, half);
                    out.place_request(&cid("s", seq), req, None);
                }
            }
        }
        Ok(())
    }
}

fn config() -> EngineConfig {
    EngineConfig {
        core_rules: CoreRules::TsCompat,
        input_mode: InputMode::TelonexDelta,
        models: ExecutionModels::TS_COMPAT,
        compat_latency: CompatLatency {
            delay_ms: 140,
            jitter_ms: 30,
        },
        market_seed: MarketSeed(7),
        starting_capital: Usdc::from_micros(500_000_000),
        max_events_per_drain: 4_200,
        run_mode: pmb_engine::config::RunMode::Backtest,
        risk: RiskLimits::TS_DEFAULTS,
    }
}

#[test]
fn real_telonex_markets_run_end_to_end_deterministically() {
    // spec: 12 §4.1, §5.1; 21 §15, §19; 00 R7
    let root = repo_root();
    let golden: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("native/fixtures/decode/telonex_book_golden.json")).unwrap(),
    )
    .unwrap();
    let mut ran = 0;
    for m in golden["markets"].as_array().unwrap() {
        let rel = m["file"].as_str().unwrap();
        let path = root.join("data").join(rel);
        if !path.exists() {
            eprintln!("skip (no data on this host): {}", path.display());
            continue;
        }
        let toks: Vec<&str> = m["tokens"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect();
        if toks.len() != 2 {
            eprintln!("skip (one-sided market): {rel}");
            continue;
        }
        let tape = read_telonex_delta(
            &path,
            &TelonexInput {
                format_version: 1,
                tokens: [toks[0], toks[1]],
                condition_id: None,
            },
        )
        .unwrap();
        let slug = path.file_stem().unwrap().to_str().unwrap();
        let info = MarketInfo::new(
            slug,
            ConditionId::parse(&tape.market).expect("condition id"),
            PerOutcome::new(
                TokenId::parse(toks[0]).unwrap(),
                TokenId::parse(toks[1]).unwrap(),
            ),
            MarketVersion::V2,
            false,
        )
        .unwrap();
        let run = |candidates: usize| {
            let timeline = RulesTimeline::new(
                ExchangeRules::ts_compat(),
                Vec::new(),
                RulesProvenance::all_fallback(RulesTableVersion::V1),
                RulesTableVersion::V1,
                FeeEraId::F0,
            );
            let market = SharedMarket::new(
                Arc::new(info.clone()),
                Arc::new(timeline),
                RulesSource::Fallback,
            );
            let mut bm = BacktestMarket::<Smoke, NoTrace>::new(market);
            for _ in 0..candidates {
                bm.add_candidate(&(), config(), NoTrace).unwrap();
            }
            let t0 = Instant::now();
            bm.run_telonex(tape.events());
            let fin = FinalOutcome::new(Outcome::Up);
            let (_m, results) = bm.finish(fin);
            let elapsed = t0.elapsed();
            let cx = OutputContext {
                info: &info,
                outcome: fin,
                core_rules: CoreRules::TsCompat,
                rules: None,
            };
            let outs: Vec<Vec<u8>> = results
                .into_iter()
                .map(|r| {
                    let o = market_output(&cx, &r.expect("no fault")).expect("self-check");
                    assert_eq!(o.events_processed.get(), tape.len() as u64, "{rel}");
                    serde_json::to_vec(&o).unwrap()
                })
                .collect();
            (outs, elapsed)
        };
        let (a, elapsed) = run(1);
        let (b, _) = run(1);
        assert_eq!(a, b, "{rel}: two runs differ");
        let (g, _) = run(2);
        assert!(
            g.iter().all(|o| *o == a[0]),
            "{rel}: group candidate differs"
        );
        let out: serde_json::Value = serde_json::from_slice(&a[0]).unwrap();
        eprintln!(
            "{rel}: {} rows in {:?} ({:.0} rows/s, debug build); trades {}",
            tape.len(),
            elapsed,
            tape.len() as f64 / elapsed.as_secs_f64(),
            out["marketStats"]["tradeCount"]
        );
        ran += 1;
    }
    eprintln!("real-data markets run: {ran}");
    // A host with the Telonex data link must run at least one market, so a
    // broken path or a renamed file cannot turn this test into a no-op; a
    // host without the link (CI) skips explicitly.
    if root.join("data/telonex").exists() {
        assert!(
            ran > 0,
            "data/telonex exists but no golden market file was found"
        );
    } else {
        eprintln!("skip: data/telonex is absent on this host");
    }
}
