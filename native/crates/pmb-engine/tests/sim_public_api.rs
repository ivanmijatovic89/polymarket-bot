//! The simulator through the crate's public API only (13 §2.2, §3): it is
//! a `Send` `Execution` the generic session accepts, it is built from an
//! `EngineConfig` (13 §7.3, R14), and its synchronous split/merge
//! (TC-E9) work against a ledger the core owns.

use std::sync::Arc;

use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::vocab::{InputMode, MakerModel};
use pmb_core::event::AccountEventKind;
use pmb_core::ids::{ConditionId, Hash32, OpKey, TokenId};
use pmb_core::market::MarketVersion;
use pmb_core::rules::{
    ExchangeRules, FeeEraId, RulesProvenance, RulesSource, RulesTableVersion, RulesTimeline,
};
use pmb_core::seed::MarketSeed;
use pmb_core::{MarketEvent, MarketInfo, PerOutcome, Qty, TsMs, Usdc};
use pmb_engine::config::RiskLimits;
use pmb_engine::exec::sim::simulator::Simulator;
use pmb_engine::ledger::Ledger;
use pmb_engine::strategy::{Intents, Requirements};
use pmb_engine::{
    CoreRules, Ctx, EngineConfig, EventQueue, ExecCommand, ExecCtx, Execution, NoTrace, Session,
    SharedMarket, Strategy, StrategyResult,
};

struct Idle;

impl Strategy for Idle {
    type Params = ();
    const ID: &'static str = "sim-api-idle.v1";
    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }
    fn new(_p: &(), _market: &MarketInfo) -> Self {
        Idle
    }
    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

/// The session type a ts-compat backtest instantiates (12 §14 P6).
type SimSession = Session<Idle, Simulator, NoTrace>;

fn assert_send<T: Send>() {}

fn config() -> EngineConfig {
    EngineConfig {
        core_rules: CoreRules::TsCompat,
        input_mode: InputMode::TelonexDelta,
        models: ExecutionModels::TS_COMPAT,
        compat_latency: CompatLatency {
            delay_ms: 140,
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

fn market() -> SharedMarket {
    let info = MarketInfo::new(
        "btc-updown-15m-1780272000",
        ConditionId(Hash32([7; 32])),
        PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
        MarketVersion::V2,
        false,
    )
    .expect("valid slug");
    let timeline = RulesTimeline::new(
        ExchangeRules::ts_compat(),
        Vec::new(),
        RulesProvenance::all_fallback(RulesTableVersion::V1),
        RulesTableVersion::V1,
        FeeEraId::F0,
    );
    SharedMarket::new(Arc::new(info), Arc::new(timeline), RulesSource::Fallback)
}

#[test]
fn simulator_is_a_send_execution_for_the_generic_session() {
    // spec: 13 §2.2 (Execution: Send), 12 §14 P6 (Session<S, E, T>), 13 §3
    assert_send::<Simulator>();
    assert_send::<SimSession>();
    let sim = Simulator::new(&config()).expect("ts-compat");
    assert_eq!(sim.next_due(), None);
    assert_eq!(sim.book_overlay(), None);
    assert_eq!(sim.diagnostics().actions_scheduled, 0);
}

#[test]
fn config_errors_are_loud() {
    // spec: 13 §7.3 (ts-compat with a non-compat axis is invalid), R14
    let mut c = config();
    c.models.maker = MakerModel::Queue;
    let err = Simulator::new(&c).expect_err("non-compat maker");
    assert!(err.message.contains("maker=queue"), "{}", err.message);
}

#[test]
fn split_and_merge_are_synchronous_even_with_latency() {
    // spec: 13 §5.1 and TC-E9 (no latency, never failing; merge = min(requested, Up, Down))
    let m = market();
    let ledger = Ledger::new(CoreRules::TsCompat, Usdc::from_micros(500_000_000));
    let cfg = config();
    let cx = ExecCtx {
        market: &m,
        ledger: &ledger,
        config: &cfg,
    };
    let mut sim = Simulator::new(&cfg).expect("ts-compat");
    let mut q = EventQueue::new(false);
    sim.submit(
        TsMs(1_000),
        ExecCommand::Split {
            op: OpKey::new(0),
            size: Qty::from_micros(3_000_000),
        },
        &cx,
        &mut q,
    );
    // Nothing delivered yet: the merge of an empty position emits nothing.
    sim.submit(
        TsMs(1_000),
        ExecCommand::Merge {
            op: OpKey::new(1),
            size: Qty::from_micros(1_000_000),
        },
        &cx,
        &mut q,
    );
    let ev = q.pop().expect("split");
    assert_eq!(ev.at, TsMs(1_000));
    assert_eq!(
        ev.kind,
        AccountEventKind::PositionsSplit {
            op: OpKey::new(0),
            size: Qty::from_micros(3_000_000),
            cost: Usdc::from_micros(3_000_000),
        }
    );
    assert!(q.is_empty());
    assert_eq!(sim.pending_actions(), 0);
    // An idle session skips market events (16 CG-4).
    sim.on_market_event(
        TsMs(1_001),
        &MarketEvent::PriceChange { changes: &[] },
        &cx,
        &mut q,
    );
    assert_eq!(sim.diagnostics().fast_path_skips, 1);
}
