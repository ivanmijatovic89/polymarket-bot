//! The testkit (30 §15, feature `testkit`, dev-dependency only).
//!
//! A [`TestMarket`] is a scripted market: book snapshots and price changes
//! at chosen exchange times. [`TestMarket::run`] runs one strategy over it
//! through the **real** engine: the job is parsed and validated by the
//! runtime, the inputs decoded by its static-tape seam, and the market is
//! driven by the runtime's `run_session` over `Session` + `Simulator` (the
//! window gate, cascades, end of stream and finalize). There is no second,
//! simplified simulator (30 §15). The run's engine events are captured
//! in memory in the record shapes of the parity trace (22 §3.2):
//! [`TestRun::trace`] gives a `header`, `tick` records with `seq` and
//! `cause`, the `intent` records of every strategy callback (`src` `tick`
//! or `account`), account `event` records and a `final` record.
//!
//! The `event` records name the order by its engine key (`"order": k`)
//! instead of its cid, because the engine's trace event carries keys only.
// D-PENDING: the runtime's ParityTraceSink cannot render `intent` and
// `event` records yet (its own D-PENDING, feature `parity_trace` absent),
// so the testkit renders them itself in the 22 §3.2 shapes; cids of events
// need the resolved event view in `TraceEvent::AccountEvent`
// (crossStreamNeeds). Switch to the runtime sink once it renders both.
//!
//! ```
//! use pmb_sdk::prelude::*;
//! use pmb_sdk::testkit::{Profile, TestMarket};
//!
//! #[derive(Params, Clone, Debug)]
//! struct NoParams;
//!
//! struct BuyOnce(bool);
//!
//! impl Strategy for BuyOnce {
//!     type Params = NoParams;
//!     const ID: &'static str = "doc-buy-once";
//!     fn requirements(_p: &NoParams) -> Requirements {
//!         Requirements::new()
//!     }
//!     fn new(_p: &NoParams, _m: &MarketInfo) -> Self {
//!         BuyOnce(false)
//!     }
//!     fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
//!         if let (false, Some(ask)) = (self.0, ctx.book(Outcome::Up).best_ask()) {
//!             out.place(Order::buy(Outcome::Up, ask.price, qty!(5)).fok().cid(cid!("b1")));
//!             self.0 = true;
//!         }
//!         Ok(())
//!     }
//! }
//!
//! let start = TsMs(1_760_140_800_000);
//! let mut m = TestMarket::btc_15m(start).profile(Profile::TsCompat).starting_capital(usdc!(100));
//! m.book(TsMs(start.0 + 1_000), Outcome::Up, &[(price!(0.48), qty!(50))], &[(price!(0.52), qty!(50))]);
//! let run = m.run::<BuyOnce>(&NoParams);
//! let intents: Vec<_> = run.records("intent").collect();
//! assert_eq!(intents.len(), 1);
//! assert_eq!(intents[0]["cid"], "b1");
//! assert!(run.records("event").any(|e| e["kind"] == "fill"));
//! assert_eq!(run.records("final").count(), 1);
//! ```
//!
//! Not yet provided (30 §15), each needing engine or runtime support first:
//! feed inputs (`binance_trade`, `price_to_beat` fail loud until the feed
//! wiring merges, TODO(feeds-merge)), trade prints, time advance and data
//! gaps as inputs, the committed fixture markets of 60, the realistic
//! profile (M3b), `assert_group_equivalent`, `assert_interests_equivalent`
//! and `bench`.

use pmb_contract::vocab::Profile as ContractProfile;
use pmb_core::event::AccountEventKind;
use pmb_core::fixed::format_micros;
use pmb_core::market_event::{LevelUpdate, PriceSize, QuoteSide};
use pmb_core::order::{Intent, OrderRef, OrderRequest, OrderSize, Side};
use pmb_core::rules::RulesTableVersion;
use pmb_core::seed::{market_seed, RunSeed};
use pmb_core::{ExchangeOrderId, Outcome, Price, Qty, TsMs, Usdc};
use pmb_engine::clock::DecisionOrigin;
use pmb_engine::config::EngineConfig;
use pmb_engine::exec::sim::Simulator;
use pmb_engine::strategy::Intents;
use pmb_engine::trace::{TraceEvent, TraceSink};
use pmb_engine::Strategy;
use pmb_runtime::backend::{run_session, Deadline, RunCtx, RunFailure};
use pmb_runtime::inputs::{build_static_inputs, StaticEvent, StaticTape};
use pmb_runtime::job::parse_job;
use pmb_runtime::run::{on_job_thread, DEFAULT_STACK_MB};
use pmb_runtime::StrategyParams;
use serde_json::{json, Map, Value};

/// Execution profile of a test run (30 §15 "profile selection").
#[non_exhaustive]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Profile {
    /// Reproduces TS execution (the default until G3).
    TsCompat,
    /// Current Polymarket rules. The engine refuses it until M3b (D57), so
    /// a run fails loud.
    Realistic,
}

impl Profile {
    fn contract(self) -> ContractProfile {
        match self {
            Profile::TsCompat => ContractProfile::TsCompat,
            Profile::Realistic => ContractProfile::Realistic,
        }
    }
}

/// A scripted feed input, kept until the feed wiring merges.
#[derive(Clone, Debug, PartialEq)]
enum FeedInput {
    BinanceTrade,
    PriceToBeat,
}

/// A scripted market (30 §15).
#[derive(Clone, Debug)]
pub struct TestMarket {
    start: TsMs,
    profile: Profile,
    capital: Usdc,
    tape: StaticTape,
    feeds: Vec<(TsMs, FeedInput)>,
}

/// Length of a 15-minute window.
const M15_MS: i64 = 900_000;

impl TestMarket {
    /// A BTC 15m up/down market whose window starts at `start` (a multiple
    /// of 15 minutes): slug `btc-updown-15m-{start / 1000}`, ts-compat,
    /// starting capital 500 USDC, no inputs.
    ///
    /// # Panics
    ///
    /// When `start` is not on a 15-minute boundary.
    pub fn btc_15m(start: TsMs) -> TestMarket {
        assert!(
            start.0 > 0 && start.0 % M15_MS == 0,
            "TestMarket::btc_15m: start {} ms is not on a 15-minute boundary",
            start.0
        );
        TestMarket {
            start,
            profile: Profile::TsCompat,
            capital: Usdc::from_micros(500_000_000),
            tape: StaticTape::new(),
            feeds: Vec::new(),
        }
    }

    /// The execution profile (default ts-compat).
    pub fn profile(mut self, profile: Profile) -> TestMarket {
        self.profile = profile;
        self
    }

    /// Per-market starting capital (default 500 USDC).
    pub fn starting_capital(mut self, capital: Usdc) -> TestMarket {
        self.capital = capital;
        self
    }

    /// A full `book` snapshot of one outcome at exchange time `at`: one
    /// strategy tick when inside the window. Levels are given best first.
    pub fn book(
        &mut self,
        at: TsMs,
        outcome: Outcome,
        bids: &[(Price, Qty)],
        asks: &[(Price, Qty)],
    ) -> &mut TestMarket {
        let levels = |l: &[(Price, Qty)]| {
            l.iter()
                .map(|&(price, size)| PriceSize { price, size })
                .collect()
        };
        self.tape.push(
            at,
            StaticEvent::Book {
                outcome,
                bids: levels(bids),
                asks: levels(asks),
            },
        );
        self
    }

    /// A `price_change` of one level at exchange time `at`: one strategy
    /// tick when inside the window. `Side::Buy` is the bid ladder,
    /// `Side::Sell` the ask ladder; size 0 removes the level.
    pub fn price_change(
        &mut self,
        at: TsMs,
        outcome: Outcome,
        side: Side,
        price: Price,
        size: Qty,
    ) -> &mut TestMarket {
        let side = match side {
            Side::Buy => QuoteSide::Bid,
            Side::Sell => QuoteSide::Ask,
        };
        self.tape.push(
            at,
            StaticEvent::PriceChange(vec![LevelUpdate {
                outcome,
                side,
                price,
                size,
            }]),
        );
        self
    }

    /// One Binance aggTrade at `at`.
    ///
    /// TODO(feeds-merge): recorded now, refused by [`TestMarket::run`]
    /// until the feed wiring merges (fail loud, R14).
    pub fn binance_trade(&mut self, at: TsMs, _price: f64) -> &mut TestMarket {
        self.feeds.push((at, FeedInput::BinanceTrade));
        self
    }

    /// The price-to-beat key, visible from `at`.
    ///
    /// TODO(feeds-merge): recorded now, refused by [`TestMarket::run`]
    /// until the feed wiring merges (fail loud, R14).
    pub fn price_to_beat(&mut self, at: TsMs, _value: f64) -> &mut TestMarket {
        self.feeds.push((at, FeedInput::PriceToBeat));
        self
    }

    /// The market slug.
    pub fn slug(&self) -> String {
        format!("btc-updown-15m-{}", self.start.0 / 1_000)
    }

    /// Runs `S` with `params` over this market (one candidate).
    ///
    /// # Panics
    ///
    /// When the run fails (invalid params, a strategy fault, an engine
    /// error); the message is the run's reason line. Use
    /// [`TestMarket::try_run`] to inspect failures.
    #[track_caller]
    pub fn run<S>(&self, params: &S::Params) -> TestRun
    where
        S: Strategy,
        S::Params: StrategyParams,
    {
        match self.try_run::<S>(params) {
            Ok(r) => r,
            Err(e) => panic!("testkit run of {} failed: {e}", S::ID),
        }
    }

    /// Runs `S` with `params` over this market; `Err` is the run's reason
    /// line (20 §4) when the run or the candidate failed.
    pub fn try_run<S>(&self, params: &S::Params) -> Result<TestRun, String>
    where
        S: Strategy,
        S::Params: StrategyParams,
    {
        if let Some((at, f)) = self.feeds.first() {
            return Err(format!(
                "feed input {f:?} at {} ms: feeds are not wired into this engine build yet \
                 (TODO(feeds-merge))",
                at.0
            ));
        }
        // The path `describe`/`run` take (30 §4 rule 3, 20 §5.1): params
        // parsed, bounded, validated and normalized idempotently, then
        // `requirements` and `interests` evaluated, each behind the catch
        // boundary. The run uses the evaluated params, never the caller's.
        let normalized = params.to_normalized();
        let evaluated = pmb_runtime::describe::evaluate::<S>(&normalized).map_err(|errs| {
            let errs: Vec<String> = errs.iter().map(|e| e.to_json().to_string()).collect();
            format!("invalid params for {}: [{}]", S::ID, errs.join(","))
        })?;
        if evaluated.normalized != normalized {
            return Err(format!(
                "params of {} do not round-trip: given {}, normalized {}",
                S::ID,
                Value::Object(normalized),
                Value::Object(evaluated.normalized)
            ));
        }
        let params = &evaluated.params;
        let job = self.job::<S>(params)?;
        let job = parse_job(job.as_bytes()).map_err(|e| e.reason())?;
        job.validate().map_err(|e| format!("job: {e:?}"))?;
        let market_text = job.market.condition_id.clone();
        let decoded =
            build_static_inputs(&job, RulesTableVersion::V1, self.tape.clone(), market_text)
                .map_err(|e| e.reason())?;
        let mc = &job.run.model_config;
        let seed = RunSeed::new(mc.seed.get()).map_err(|e| format!("seed: {e:?}"))?;
        let cfg = EngineConfig::from_model_config(
            mc,
            job.run.input_mode,
            market_seed(seed, &decoded.info.slug),
        )
        .map_err(|e| format!("model_config: {}", e.message))?;
        let exec = Simulator::new(&cfg).map_err(|e| format!("model_config: {}", e.message))?;
        let deadline = Deadline::after_ms(u64::from(job.budget.wall_ms));
        let cx = RunCtx {
            inputs: &decoded,
            run_seed: mc.seed.get(),
            input_mode: job.run.input_mode,
            deadline: &deadline,
        };
        let mut capture = Capture::new(S::ID, self.profile, &self.slug());
        let run = on_job_thread(DEFAULT_STACK_MB << 20, || {
            run_session::<S, Simulator, &mut Capture>(&cx, params, cfg, exec, &mut capture)
        })
        .map_err(|e| e.reason())?;
        match run {
            Ok(_) => Ok(TestRun {
                trace: capture.finish(),
            }),
            Err(RunFailure::Strategy {
                cause,
                message,
                callback,
                seq,
                ..
            }) => Err(format!(
                "strategy_fault: {cause}: {message} (callback {callback}, tick seq {seq})"
            )),
            Err(RunFailure::Group(e)) => Err(e.reason()),
        }
    }

    /// The job document of one run: the runtime's embedded selftest job
    /// (20 §5.3) with this market, profile, capital and the strategy's
    /// normalized params.
    fn job<S>(&self, params: &S::Params) -> Result<String, String>
    where
        S: Strategy,
        S::Params: StrategyParams,
    {
        let mut v: Value = serde_json::from_str(pmb_runtime::selftest::SELFTEST_JOB)
            .map_err(|e| format!("embedded job: {e}"))?;
        let start = self.start.0;
        v["run"]["strategyId"] = Value::String(S::ID.to_string());
        v["run"]["candidates"][0]["key"] = Value::String("testkit".into());
        v["run"]["candidates"][0]["params"] = Value::Object(params.to_normalized());
        let mc = &mut v["run"]["modelConfig"];
        mc["profile"] = Value::String(self.profile.contract().as_str().to_string());
        mc["capital"]["startingCapitalUsdc"] =
            Value::String(pmb_core::fixed::format_micros(self.capital.micros()));
        let market = &mut v["market"];
        market["slug"] = Value::String(self.slug());
        market["window"]["startMs"] = Value::from(start);
        market["window"]["endMs"] = Value::from(start + M15_MS);
        market["input"]["path"] = Value::String(format!("/pmb-testkit/{}.parquet", self.slug()));
        Ok(v.to_string())
    }
}

/// The in-memory trace sink of a test run (22 §3.2 record shapes).
struct Capture {
    records: Vec<Value>,
}

fn decimal(micros: i64) -> Value {
    format_micros(micros)
        .parse()
        .expect("a fixed-point decimal is a JSON number")
}

fn asset(o: Option<Outcome>) -> Value {
    o.map_or(Value::Null, |o| Value::from(o.index()))
}

fn ts(t: Option<TsMs>) -> Value {
    t.map_or(Value::Null, |t| Value::from(t.0))
}

/// The order fields of 22 §3.2 (`place_limit`, `place_batch` orders).
fn order_fields(m: &mut Map<String, Value>, cid: &str, r: &OrderRequest) {
    m.insert("cid".into(), Value::from(cid));
    m.insert("asset".into(), asset(Some(r.outcome)));
    m.insert("side".into(), Value::from(r.side.as_str()));
    m.insert("price".into(), decimal(r.price.micros()));
    match r.size {
        OrderSize::Shares(q) => m.insert("size".into(), decimal(q.micros())),
        OrderSize::Collateral(u) => m.insert("amountUsdc".into(), decimal(u.micros())),
    };
    m.insert("orderType".into(), Value::from(r.order_type.as_str()));
    m.insert("postOnly".into(), Value::from(r.post_only));
    m.insert("expireAtMs".into(), ts(r.expire_at_ms));
}

fn exchange_id(e: ExchangeOrderId) -> Value {
    Value::from(format!("{e:?}"))
}

impl Capture {
    fn new(strategy: &str, profile: Profile, slug: &str) -> Capture {
        let header = json!({
            "t": "header",
            "format": "pmb-parity-trace",
            "version": 2,
            "engine": "native",
            "testkit": true,
            "strategy": strategy,
            "profile": profile.contract().as_str(),
            "slug": slug,
            "candidateKey": "testkit",
            "level": "decisions",
        });
        Capture {
            records: vec![header],
        }
    }

    fn finish(self) -> Vec<Value> {
        self.records
    }

    fn intents(&mut self, seq: u64, src: &str, out: &Intents) {
        for i in 0..out.len() {
            let Some(intent) = out.get(i) else { break };
            let mut m = Map::new();
            m.insert("t".into(), Value::from("intent"));
            m.insert("seq".into(), Value::from(seq));
            m.insert("src".into(), Value::from(src));
            match intent {
                Intent::PlaceLimit(r) => {
                    m.insert("kind".into(), Value::from("place_limit"));
                    order_fields(&mut m, out.local_cid_text(r.cid), r);
                }
                Intent::PlaceBatch(rs) => {
                    m.insert("kind".into(), Value::from("place_batch"));
                    let orders = rs
                        .iter()
                        .map(|r| {
                            let mut o = Map::new();
                            order_fields(&mut o, out.local_cid_text(r.cid), r);
                            Value::Object(o)
                        })
                        .collect();
                    m.insert("orders".into(), Value::Array(orders));
                }
                Intent::CancelOrder(r) => {
                    m.insert("kind".into(), Value::from("cancel_order"));
                    Capture::cancel_ref(&mut m, out, r, "cid");
                }
                Intent::CancelBatch(refs) => {
                    m.insert("kind".into(), Value::from("cancel_batch"));
                    let cids = refs
                        .iter()
                        .map(|r| match *r {
                            OrderRef::Cid(k) | OrderRef::Both(k, _) => {
                                Value::from(out.local_cid_text(k))
                            }
                            OrderRef::Exchange(e) => exchange_id(e),
                        })
                        .collect();
                    m.insert("cids".into(), Value::Array(cids));
                }
                Intent::CancelMarket(o) => {
                    m.insert("kind".into(), Value::from("cancel_market"));
                    m.insert("asset".into(), asset(o));
                }
                Intent::CancelAll => {
                    m.insert("kind".into(), Value::from("cancel_all"));
                }
                Intent::SplitPositions { size } => {
                    m.insert("kind".into(), Value::from("split_positions"));
                    m.insert("size".into(), decimal(size.micros()));
                }
                Intent::MergePositions { size } => {
                    m.insert("kind".into(), Value::from("merge_positions"));
                    m.insert("size".into(), decimal(size.micros()));
                }
            }
            self.records.push(Value::Object(m));
        }
    }

    fn cancel_ref(m: &mut Map<String, Value>, out: &Intents, r: OrderRef, key: &str) {
        match r {
            OrderRef::Cid(k) | OrderRef::Both(k, _) => {
                m.insert(key.into(), Value::from(out.local_cid_text(k)));
            }
            OrderRef::Exchange(e) => {
                m.insert("exchangeId".into(), exchange_id(e));
            }
        }
    }

    fn event(&mut self, seq: u64, ev: &pmb_core::event::AccountEvent) {
        let mut m = Map::new();
        m.insert("t".into(), Value::from("event"));
        m.insert("seq".into(), Value::from(seq));
        m.insert("kind".into(), Value::from(ev.kind.ts_kind()));
        m.insert("ts".into(), Value::from(ev.at.0));
        if let Some(k) = ev.kind.order() {
            m.insert("order".into(), Value::from(k.index()));
        }
        match ev.kind {
            AccountEventKind::Fill(f) => {
                m.insert("asset".into(), asset(Some(f.outcome)));
                m.insert("side".into(), Value::from(f.side.as_str()));
                m.insert("price".into(), decimal(f.price.micros()));
                m.insert("size".into(), decimal(f.qty.micros()));
                m.insert("fee".into(), decimal(f.fee.micros()));
            }
            AccountEventKind::OrderRejected { reason, .. } => {
                m.insert("reason".into(), Value::from(reason.code()));
            }
            AccountEventKind::OrderDone { reason, filled, .. } => {
                m.insert("reason".into(), Value::from(reason.as_ts_str()));
                m.insert(
                    "filledSize".into(),
                    filled.map_or(Value::Null, |q| decimal(q.micros())),
                );
            }
            AccountEventKind::CancelFailed { reason, .. } => {
                m.insert("reason".into(), Value::from(reason.code()));
            }
            AccountEventKind::PositionsSplit { size, cost, .. } => {
                m.insert("size".into(), decimal(size.micros()));
                m.insert("cost".into(), decimal(cost.micros()));
            }
            AccountEventKind::PositionsMerged { size, .. } => {
                m.insert("size".into(), decimal(size.micros()));
            }
            AccountEventKind::SplitFailed {
                requested, reason, ..
            }
            | AccountEventKind::MergeFailed {
                requested, reason, ..
            } => {
                m.insert("size".into(), decimal(requested.micros()));
                m.insert("reason".into(), Value::from(reason.code()));
            }
            _ => {}
        }
        self.records.push(Value::Object(m));
    }
}

impl TraceSink for &mut Capture {
    fn record(&mut self, ev: &TraceEvent<'_>) {
        match *ev {
            TraceEvent::TickStart {
                seq,
                cause,
                decision_ts,
                exchange_ts,
                visibility_ts,
            } => {
                let mut m = Map::new();
                m.insert("t".into(), Value::from("tick"));
                m.insert("seq".into(), Value::from(seq));
                m.insert("ts".into(), Value::from(decision_ts.0));
                m.insert("cause".into(), Value::from(cause.as_str()));
                if let Some(x) = exchange_ts {
                    m.insert("xts".into(), Value::from(x.0));
                }
                m.insert("vts".into(), Value::from(visibility_ts.0));
                self.records.push(Value::Object(m));
            }
            TraceEvent::Decision {
                seq,
                origin,
                intents,
            } => {
                let src = match origin {
                    DecisionOrigin::Tick => "tick",
                    DecisionOrigin::Account => "account",
                    // Engine-originated intents are not strategy decisions.
                    DecisionOrigin::Engine => return,
                };
                self.intents(seq, src, intents);
            }
            TraceEvent::AccountEvent { seq, event } => self.event(seq, event),
            TraceEvent::Final(f) => {
                self.records
                    .push(json!({"t": "final", "stats": format!("{f:?}")}));
            }
            TraceEvent::FeedView { .. } | TraceEvent::Exec(_) => {}
        }
    }
}

/// The outputs of one test run (30 §15).
#[derive(Clone, Debug)]
pub struct TestRun {
    trace: Vec<Value>,
}

impl TestRun {
    /// The trace records (22 §3.2 shapes) at level `decisions`, header
    /// first.
    pub fn trace(&self) -> &[Value] {
        &self.trace
    }

    /// The trace records of one type `t` (`"tick"`, `"intent"`, `"event"`,
    /// `"final"`), in trace order.
    pub fn records<'a>(&'a self, t: &'a str) -> impl Iterator<Item = &'a Value> + 'a {
        self.trace.iter().filter(move |r| r["t"] == t)
    }
}
