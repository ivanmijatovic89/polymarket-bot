//! Skeleton shape test (M1 steps 3–4): a mock `Execution` and a minimal
//! strategy prove that the generic `Session<S, E, T>` of 12 §14 P6 compiles
//! with the trait shapes of 30 §4 and 13 §2.2.

use std::sync::Arc;

use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::vocab::InputMode;
use pmb_core::ids::{ConditionId, Hash32, TokenId};
use pmb_core::market::MarketVersion;
use pmb_core::rules::{RulesSource, RulesTableVersion, RulesTimeline};
use pmb_core::seed::MarketSeed;
use pmb_core::{MarketEvent, MarketInfo, PerOutcome, Qty, TsMs, Usdc};
use pmb_engine::config::RiskLimits;
use pmb_engine::exec::{ExecDiagnostics, TimerFired};
use pmb_engine::strategy::{Intents, Requirements};
use pmb_engine::{
    CoreRules, Ctx, EngineConfig, EventQueue, ExecCommand, ExecCtx, Execution, NoTrace, Session,
    SharedMarket, Strategy, StrategyResult,
};

/// An adapter that accepts nothing and schedules nothing.
#[derive(Default)]
struct MockExec {
    diag: ExecDiagnostics,
    submitted: u64,
}

impl Execution for MockExec {
    fn submit(
        &mut self,
        _stamp: TsMs,
        _cmd: ExecCommand<'_>,
        _cx: &ExecCtx<'_>,
        _out: &mut EventQueue,
    ) {
        self.submitted += 1;
    }
    fn next_due(&self) -> Option<TsMs> {
        None
    }
    fn run_next_due(&mut self, _cx: &ExecCtx<'_>, _out: &mut EventQueue) {}
    fn on_timer(&mut self, _t: &TimerFired, _cx: &ExecCtx<'_>, _out: &mut EventQueue) {}
    fn on_market_event(
        &mut self,
        _now: TsMs,
        _ev: &MarketEvent<'_>,
        _cx: &ExecCtx<'_>,
        _out: &mut EventQueue,
    ) {
    }
    fn diagnostics(&self) -> &ExecDiagnostics {
        &self.diag
    }
}

/// A strategy that never trades; keeps every default of 30 §4 rule 8.
struct Idle {
    ticks: u64,
}

impl Strategy for Idle {
    type Params = ();
    const ID: &'static str = "skeleton-idle.v1";

    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }
    fn new(_p: &(), _market: &MarketInfo) -> Self {
        Idle { ticks: 0 }
    }
    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
        self.ticks += 1;
        Ok(())
    }
}

type IdleSession = Session<Idle, MockExec, NoTrace>;

fn assert_send<T: Send>() {}

fn market() -> SharedMarket {
    let info = MarketInfo::new(
        "btc-updown-15m-1780272000",
        ConditionId(Hash32([7; 32])),
        PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
        MarketVersion::V2,
        false,
    )
    .expect("valid slug");
    let start = info.window.start_ms;
    let timeline = RulesTimeline::realistic_fallback(
        RulesTableVersion::V1,
        start,
        start,
        info.window.end_ms,
        [],
    );
    SharedMarket::new(Arc::new(info), Arc::new(timeline), RulesSource::Fallback)
}

fn config() -> EngineConfig {
    EngineConfig {
        core_rules: CoreRules::TsCompat,
        input_mode: InputMode::TelonexDelta,
        models: ExecutionModels::TS_COMPAT,
        compat_latency: CompatLatency {
            delay_ms: 0,
            jitter_ms: 0,
        },
        market_seed: MarketSeed(0),
        starting_capital: Usdc::from_micros(500_000_000),
        max_events_per_drain: 4_200,
        run_mode: pmb_engine::config::RunMode::Backtest,
        risk: RiskLimits {
            max_open_orders: 100,
            max_order_size: Qty::from_micros(2_000_000_000),
            max_abs_position: Qty::from_micros(2_000_000_000),
            max_loss_stop: Usdc::from_micros(500_000_000),
        },
    }
}

#[test]
fn session_shape_compiles_and_is_send() {
    // spec: 12 §2.1 (session state is Send), 12 §14 P6 (generic over S, E, T)
    assert_send::<IdleSession>();
    assert_send::<MockExec>();
    let m = market();
    assert_eq!(m.window().duration().0, 15 * 60 * 1000);
    assert_eq!(<Idle as Strategy>::ID, "skeleton-idle.v1");
    assert_eq!(Idle::interests(&()), pmb_engine::Interests::ALL);
    let mut q = EventQueue::new(false);
    let mut e = MockExec::default();
    let l = pmb_engine::ledger::Ledger::new(CoreRules::TsCompat, Usdc::ZERO);
    let c = config();
    let cx = ExecCtx {
        market: &m,
        ledger: &l,
        config: &c,
    };
    e.submit(TsMs(0), ExecCommand::Place { orders: &[] }, &cx, &mut q);
    assert_eq!(e.submitted, 1);
    assert!(q.is_empty());
    assert!(e.book_overlay().is_none());
}

#[test]
fn session_runs_an_empty_stream() {
    // spec: 12 §5.1 (end_of_stream, finalize)
    let mut m = market();
    let s =
        IdleSession::new(&(), &m, config(), MockExec::default(), NoTrace).expect("session starts");
    let mut sessions = [s];
    pmb_engine::session::drive(&mut m, &mut sessions, &[]);
    let [mut s] = sessions;
    s.end_of_stream(&m).expect("no fault");
    let out = s
        .finalize(&m, pmb_core::FinalOutcome::new(pmb_core::Outcome::Up))
        .expect("finalized");
    assert_eq!(out.acc.ticks.events_processed(), 0);
}
