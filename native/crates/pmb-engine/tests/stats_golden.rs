//! Stats contract, skip taxonomy, `intentMeta` and `eventsByType` against the
//! TS golden (spec: 60 §7.1 GF-1/GF-2, §7.2 row "Stats contract, skip
//! taxonomy, intentMeta, eventsByType"; 21 §11-§16), end to end: the
//! pmb-replay telonex-delta reader over the committed fixture files →
//! `SharedMarket` books → `Session<Scripted, Simulator, NoTrace>` under
//! ts-compat → `EngineMarketOutput` (12 §4.1, §5.1; 13 §5).
//!
//! Golden and fixture files: `native/fixtures/golden/stats/`, written by
//! `native/fixtures/gen/stats_gen.ts` (TS `runSingleMarket` with the same
//! script). Tolerance (60 §7.2): money within 1e-4 USDC at the persisted
//! precision, everything else exact.

use std::path::PathBuf;
use std::sync::Arc;

use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::result::EngineMarketOutput;
use pmb_contract::vocab::InputMode;
use pmb_core::fixed::parse_decimal;
use pmb_core::ids::{CidKey, ClientOrderId, ConditionId, TokenId};
use pmb_core::market::MarketVersion;
use pmb_core::order::{OrderRequest, OrderType, Side};
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
use serde_json::Value;
use sha2::{Digest, Sha256};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

fn golden() -> Value {
    let p = repo_root().join("native/fixtures/golden/stats/stats_golden.json");
    serde_json::from_slice(&std::fs::read(&p).expect("stats golden")).expect("golden json")
}

fn micros(v: &Value) -> i64 {
    let text = match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => panic!("not a number: {other}"),
    };
    let d = parse_decimal(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
    assert!(!d.inexact, "{text} has more than 6 decimals");
    d.micros
}

fn outcome(v: &Value) -> Outcome {
    match v.as_str() {
        Some("UP") => Outcome::Up,
        Some("DOWN") => Outcome::Down,
        other => panic!("bad outcome {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// The scripted strategy (the TS twin is `scriptedDefinition` in stats_gen.ts)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum Step {
    Place {
        cid: ClientOrderId,
        req: OrderRequest,
        meta: Option<Meta>,
    },
    Cancel(ClientOrderId),
    Split(Qty),
}

/// Script: intents per 0-based strategy-tick index (21 §1.1).
type Script = Vec<(u64, Vec<Step>)>;

fn meta_of(v: &Value) -> Meta {
    let mut m = Meta::new();
    for (k, x) in v.as_object().expect("meta object") {
        let mv = match x {
            Value::Bool(b) => MetaValue::Bool(*b),
            Value::String(s) => MetaValue::Str(s.as_str().into()),
            Value::Number(n) => match n.as_i64() {
                Some(i) => MetaValue::I64(i),
                None => MetaValue::F64(n.as_f64().expect("finite")),
            },
            other => panic!("unsupported meta value {other}"),
        };
        m.push(k, mv);
    }
    m
}

fn parse_script(v: &Value) -> Script {
    v.as_array()
        .expect("script")
        .iter()
        .map(|s| {
            let tick = s["tick"].as_u64().expect("tick");
            let steps = s["intents"]
                .as_array()
                .expect("intents")
                .iter()
                .map(|i| {
                    let cid = || ClientOrderId::new(i["cid"].as_str().expect("cid")).expect("cid");
                    match i["kind"].as_str().expect("kind") {
                        "place" => {
                            let side = match i["side"].as_str() {
                                Some("BUY") => Side::Buy,
                                Some("SELL") => Side::Sell,
                                other => panic!("side {other:?}"),
                            };
                            let mut req = OrderRequest::gtc(
                                CidKey::new(0),
                                outcome(&i["outcome"]),
                                side,
                                Price::from_micros(micros(&i["price"])),
                                Qty::from_micros(micros(&i["size"])),
                            );
                            req.order_type = match i["orderType"].as_str() {
                                Some("GTC") => OrderType::Gtc,
                                Some("FOK") => OrderType::Fok,
                                other => panic!("order type {other:?}"),
                            };
                            req.post_only = i["postOnly"].as_bool().unwrap_or(false);
                            Step::Place {
                                cid: cid(),
                                req,
                                meta: i.get("meta").map(meta_of),
                            }
                        }
                        "cancel" => Step::Cancel(cid()),
                        "split" => Step::Split(Qty::from_micros(micros(&i["size"]))),
                        other => panic!("unknown intent kind {other}"),
                    }
                })
                .collect();
            (tick, steps)
        })
        .collect()
}

struct Scripted {
    script: Script,
}

impl Strategy for Scripted {
    type Params = Script;
    const ID: &'static str = "stats-golden-script.v1";

    fn requirements(_p: &Script) -> Requirements {
        Requirements::new()
    }

    fn new(p: &Script, _market: &MarketInfo) -> Self {
        Scripted { script: p.clone() }
    }

    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        let seq = ctx.tick().seq;
        for (_, steps) in self.script.iter().filter(|(t, _)| *t == seq) {
            for s in steps {
                match s {
                    Step::Place { cid, req, meta } => out.place_request(cid, *req, meta.clone()),
                    Step::Cancel(cid) => out.cancel(cid),
                    Step::Split(q) => out.split(*q),
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// One case end to end
// ---------------------------------------------------------------------------

fn config(case: &Value) -> EngineConfig {
    let lat = &case["latency"];
    EngineConfig {
        core_rules: CoreRules::TsCompat,
        input_mode: InputMode::TelonexDelta,
        models: ExecutionModels::TS_COMPAT,
        compat_latency: CompatLatency {
            delay_ms: lat["delayMs"].as_u64().expect("delay") as u32,
            jitter_ms: lat["jitterMs"].as_u64().expect("jitter") as u32,
        },
        market_seed: MarketSeed(0),
        starting_capital: Usdc::from_micros(micros(&case["startingCapital"])),
        max_events_per_drain: 4_200,
        risk: RiskLimits::TS_DEFAULTS,
    }
}

fn market_info(case: &Value) -> MarketInfo {
    let tok = |o: &str| TokenId::parse(case["tokens"][o].as_str().expect("token")).expect("token");
    MarketInfo::new(
        case["slug"].as_str().expect("slug"),
        ConditionId::parse(case["conditionId"].as_str().expect("cid")).expect("condition id"),
        PerOutcome::new(tok("UP"), tok("DOWN")),
        MarketVersion::V2,
        false,
    )
    .expect("slug")
}

fn shared_market(info: MarketInfo) -> SharedMarket {
    let timeline = RulesTimeline::new(
        ExchangeRules::ts_compat(),
        Vec::new(),
        RulesProvenance::all_fallback(RulesTableVersion::V1),
        RulesTableVersion::V1,
        FeeEraId::F0,
    );
    SharedMarket::new(Arc::new(info), Arc::new(timeline), RulesSource::Fallback)
}

/// Reader → driver → `candidates` sessions → output, per candidate.
fn run_case(case: &Value, candidates: usize) -> Vec<EngineMarketOutput> {
    let path = repo_root().join(case["parquet"].as_str().expect("parquet"));
    let up = case["tokens"]["UP"].as_str().expect("UP");
    let down = case["tokens"]["DOWN"].as_str().expect("DOWN");
    let tape = read_telonex_delta(
        &path,
        &TelonexInput {
            format_version: 1,
            tokens: [up, down],
            condition_id: case["conditionId"].as_str(),
        },
    )
    .unwrap_or_else(|e| panic!("{}: {e:?}", path.display()));
    let info = market_info(case);
    let script = parse_script(&case["script"]);
    let mut m = BacktestMarket::<Scripted, NoTrace>::new(shared_market(info.clone()));
    for _ in 0..candidates {
        m.add_candidate(&script, config(case), NoTrace)
            .expect("candidate");
    }
    m.run_telonex(tape.events());
    let fin = FinalOutcome::new(outcome(&case["outcome"]));
    let (_market, results) = m.finish(fin);
    let cx = OutputContext {
        info: &info,
        outcome: fin,
        core_rules: CoreRules::TsCompat,
        rules: None,
    };
    results
        .into_iter()
        .map(|r| {
            let out = r.unwrap_or_else(|f| panic!("session fault: {f:?}"));
            market_output(&cx, &out).unwrap_or_else(|e| panic!("output: {e:?}"))
        })
        .collect()
}

const MONEY: [&str; 4] = ["pnl", "feesPaid", "cost", "splitCost"];

/// Compares one Rust output to the TS expectation (60 §7.2 tolerance).
fn assert_matches(name: &str, rust: &EngineMarketOutput, ts: &Value) {
    let mut r = serde_json::to_value(rust).expect("serialize");
    let mut t = ts.clone();
    // Money: within 1e-4 USDC at the persisted precision.
    if let (Some(rs), Some(tsx)) = (
        r.get_mut("marketStats").and_then(Value::as_object_mut),
        t.get_mut("marketStats").and_then(Value::as_object_mut),
    ) {
        // 21 §11: `rules` is null in ts-compat and absent on TS rows.
        assert_eq!(rs.remove("rules"), Some(Value::Null), "{name}: rules");
        for k in MONEY {
            let (a, b) = (micros(&rs[k]), micros(&tsx[k]));
            assert!((a - b).abs() <= 100, "{name}: {k} rust {a} ts {b} (micros)");
            rs.remove(k);
            tsx.remove(k);
        }
        // Exact at 4 dp / 2 dp: compare as micros so 0.4 == 0.40.
        for k in [
            "avgEntryPriceUp",
            "avgEntryPriceDown",
            "upShares",
            "downShares",
            "mergableShares",
        ] {
            let (a, b) = (&rs[k], &tsx[k]);
            if a.is_null() || b.is_null() {
                assert_eq!(a, b, "{name}: {k}");
            } else {
                assert_eq!(micros(a), micros(b), "{name}: {k}");
            }
            rs.remove(k);
            tsx.remove(k);
        }
    }
    // Everything else exact: ids, outcome, counts, intentMeta, skip reasons,
    // eventsProcessed and eventsByType.
    assert_eq!(r, t, "{name}");
}

#[test]
fn stats_match_the_ts_golden_end_to_end() {
    // spec: 60 §7.2 (stats contract, skip taxonomy, intentMeta, eventsByType),
    // 21 §11, §13, §15, §16
    let g = golden();
    let cases = g["content"]["cases"].as_array().expect("cases");
    assert!(cases.len() >= 5, "golden lost cases");
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let out = run_case(case, 1);
        assert_matches(name, &out[0], &case["expected"]);
    }
}

#[test]
fn golden_header_is_gf2() {
    // spec: 60 §7.1 GF-2 — header {generator, generatorSha256, contentPin}
    let g = golden();
    let h = g["header"].as_object().expect("header");
    let keys: Vec<&str> = h.keys().map(String::as_str).collect();
    assert_eq!(keys, ["contentPin", "generator", "generatorSha256"]);
    assert_eq!(h["generator"], "native/fixtures/gen/stats_gen.ts");
    for k in ["contentPin", "generatorSha256"] {
        let s = h[k].as_str().expect(k);
        assert!(
            s.len() >= 40 && s.bytes().all(|b| b.is_ascii_hexdigit()),
            "{k}"
        );
    }
    // The committed fixture files are the ones the golden was made from.
    for case in g["content"]["cases"].as_array().expect("cases") {
        let p = repo_root().join(case["parquet"].as_str().expect("parquet"));
        let bytes = std::fs::read(&p).expect("fixture");
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            case["parquetSha256"].as_str().expect("sha"),
            "{}",
            p.display()
        );
    }
}

#[test]
fn end_to_end_output_is_byte_identical_across_runs_and_groups() {
    // spec: 00 R7 (byte-identical output for the same input, inside or
    // outside a candidate group), 12 §2.1, 21 §10
    let g = golden();
    for case in g["content"]["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().expect("name");
        let a = serde_json::to_vec(&run_case(case, 1)[0]).expect("ser");
        let b = serde_json::to_vec(&run_case(case, 1)[0]).expect("ser");
        assert_eq!(a, b, "{name}: two runs differ");
        for (i, o) in run_case(case, 3).iter().enumerate() {
            let c = serde_json::to_vec(o).expect("ser");
            assert_eq!(a, c, "{name}: candidate {i} of a group differs");
        }
    }
}

#[test]
fn the_activity_case_places_cancels_and_fills() {
    // spec: 60 §7.2; the e2e fixture exercises place, cancel, taker and maker
    // fills, a split and the inclusive window end under ts-compat (12 §5.4
    // TC-C9, 13 §5.1)
    let g = golden();
    let case = g["content"]["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .find(|c| c["name"] == "activity")
        .expect("activity case");
    let o = &run_case(case, 1)[0];
    let s = o.market_stats.as_ref().expect("full row");
    assert_eq!(o.skip_reason, None);
    assert_eq!(
        (s.trade_count, s.trade_as_maker, s.trade_as_taker),
        (4, 1, 3)
    );
    assert_eq!(
        s.intent_meta.len(),
        2,
        "first fill per cid; unfilled y1 excluded"
    );
    assert_eq!(s.split_cost.micros(), 5_000_000);
    assert_eq!(o.events_processed.get(), 10);
}
