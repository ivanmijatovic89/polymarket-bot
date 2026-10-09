//! `src/trading/StrategyRunner.{serial,clock,syntheticTicks}.test.ts` and
//! `src/trading/runnerConfig.test.ts` converted to Rust fixture tests
//! (60 §7.3): serial order, the TS event clock, synthetic-tick rules, the
//! cascade budget and the global open-order capacity. The TS `queued`
//! intent mode and env-driven budgets have no Rust counterpart (R7).

mod core_support;

use core_support::*;
use pmb_contract::vocab::InputMode;
use pmb_core::event::AccountEventKind;
use pmb_core::fill::Liquidity;
use pmb_core::{OrderType, Outcome};
use pmb_engine::envelope::SyntheticKind;
use pmb_engine::session::{SessionFault, StrategyFaultCause};
use pmb_engine::{CoreRules, EngineConfig};

fn ts() -> EngineConfig {
    config(CoreRules::TsCompat)
}

// ---------------------------------------------------------------------------
// StrategyRunner.serial.test.ts
// ---------------------------------------------------------------------------

#[test]
fn inputs_run_strictly_one_at_a_time_in_seq_order() {
    // spec: 12 §3.3 E1, §5.1 (serial loop) (StrategyRunner.serial.test.ts:53)
    let mut exec = MockExec::sync();
    exec.timed
        .push((t(3), AccountEventKind::StreamStatus { connected: true }));
    let mut h = H::new(ts(), exec, Script::default());
    h.tick(1, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    h.tick(2, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    // The scheduled event at 3 runs before the input stamped 4 (strict "<").
    h.tick(4, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    let log: Vec<String> = h
        .log()
        .iter()
        .map(|l| l.split(" now").next().unwrap().to_string())
        .collect();
    assert_eq!(
        log,
        vec![
            "tick seq=0",
            "tick seq=1",
            "event account_stream_status",
            "tick seq=2"
        ]
    );
}

#[test]
fn a_panicking_tick_stops_the_candidate() {
    // spec: 12 §11 (backtest: strategy_fault, never called again). TS rejects
    // the caller and keeps calling (StrategyRunner.serial.test.ts:97);
    // replaced by the fault table.
    let script = Script {
        panic_at_tick: Some(0),
        ..Script::default()
    };
    let mut h = H::new(ts(), MockExec::sync(), script);
    let err = h.tick(1, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap_err();
    match err {
        SessionFault::Strategy {
            cause: StrategyFaultCause::Panic { message },
            callback,
            ..
        } => {
            assert!(message.contains("boom at tick 0"), "{message}");
            assert_eq!(callback, "onMarketTick");
        }
        other => panic!("{other:?}"),
    }
    assert!(h.tick(2, &[(0.4, 1.0)], &[(0.6, 1.0)]).is_err());
    assert!(h.log().is_empty());
    let m = h.market.clone();
    assert!(h
        .s
        .finalize(&m, pmb_core::FinalOutcome::new(Outcome::Up))
        .is_err());
}

// ---------------------------------------------------------------------------
// StrategyRunner.clock.test.ts
// ---------------------------------------------------------------------------

fn fok_pair_run() -> (Vec<String>, Vec<String>) {
    let mut h = H::new(ts(), MockExec::sync(), Script::default());
    h.send(
        vec![
            Cmd::Place(Ord::buy("basic:a:buy:1000", 5.0, 0.3).ty(OrderType::Fok)),
            Cmd::Place(Ord::sell("basic:a:sell:1000", 5.0, 0.29).ty(OrderType::Fok)),
        ],
        1000,
        &[(0.29, 100.0)],
        &[(0.3, 100.0)],
    )
    .unwrap();
    (h.log(), h.s.trace().lines.clone())
}

#[test]
fn event_clock_and_ids_depend_on_the_tick_stream_only() {
    // spec: 12 §4.2 event_clock, K1 (no wall clock), R7
    // (StrategyRunner.clock.test.ts:38)
    let (log, trace) = fok_pair_run();
    let events: Vec<_> = log.iter().filter(|l| l.starts_with("event")).collect();
    assert!(!events.is_empty());
    assert!(events.iter().all(|l| l.ends_with("ec=1000")), "{events:?}");
    assert_eq!(fok_pair_run(), (log, trace));
}

#[test]
fn first_tick_sets_the_event_clock_and_later_ticks_do_not_advance_it() {
    // spec: 12 §4.2 (ticks do not advance the event clock), §10 (one session
    // per market) (StrategyRunner.clock.test.ts:70)
    let mut h = H::new(ts(), MockExec::sync(), Script::default());
    h.tick(1000, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    h.tick(2000, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    let mut next = H::new(ts(), MockExec::sync(), Script::default());
    next.tick(3000, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    assert_eq!(
        h.log(),
        vec![
            "tick seq=0 now=1000 ec=1000 cause=book",
            "tick seq=1 now=2000 ec=1000 cause=book"
        ]
    );
    assert_eq!(next.log(), vec!["tick seq=0 now=3000 ec=3000 cause=book"]);
}

#[test]
fn an_event_delivered_before_the_first_tick_establishes_the_clock() {
    // spec: 12 §4.2 (EventClock::on_delivered before the first tick)
    // (StrategyRunner.clock.test.ts:98). No callback runs before the first
    // dispatched tick (see the D-PENDING in `Session::call_event`).
    let mut exec = MockExec::sync();
    exec.timed
        .push((t(500), AccountEventKind::StreamStatus { connected: true }));
    let mut h = H::new(ts(), exec, Script::default());
    h.tick(1000, &[(0.4, 1.0)], &[(0.6, 1.0)]).unwrap();
    assert_eq!(h.log(), vec!["tick seq=0 now=1000 ec=500 cause=book"]);
}

// ---------------------------------------------------------------------------
// StrategyRunner.syntheticTicks.test.ts
// ---------------------------------------------------------------------------

const BID: &[(f64, f64)] = &[(0.3, 1000.0)];

fn crossed_run(synthetic: Option<SyntheticKind>) -> H {
    let mut h = H::new(ts(), MockExec::sync(), Script::default());
    h.send(
        vec![Cmd::Place(Ord::buy("c1", 100.0, 0.4))],
        1000,
        BID,
        &[(0.39, 40.0)],
    )
    .unwrap();
    if let Some(k) = synthetic {
        h.synth(1400, k).unwrap();
    }
    h.tick(2000, BID, &[(0.45, 500.0)]).unwrap();
    h
}

#[test]
fn synthetic_tick_never_maker_fills_a_resting_remainder_on_a_stale_book() {
    // spec: 12 §5.3 (synthetic ticks never run the execution model's market
    // event processing), 13 X6 (StrategyRunner.syntheticTicks.test.ts:79,
    // :206)
    let without = crossed_run(None);
    for k in [
        SyntheticKind::BinanceAggTrade,
        SyntheticKind::ChainlinkRound,
    ] {
        let with = crossed_run(Some(k));
        assert_eq!(with.ledger().position(Outcome::Up).qty, q(40.0));
        assert_eq!(
            with.ledger().position(Outcome::Up),
            without.ledger().position(Outcome::Up)
        );
        let k1 = with.current("c1").unwrap();
        assert_eq!(with.open_cids(), vec!["c1"]);
        assert_eq!(with.ledger().order(k1).remaining(), q(60.0));
        assert_eq!(with.ledger().fills(), without.ledger().fills());
        // The synthetic tick is a strategy tick but not a market event.
        assert_eq!(with.s.exec().market_events, without.s.exec().market_events);
        assert_eq!(with.s.stats().ticks.strategy_ticks, 3);
    }
}

#[test]
fn gtd_expiry_fires_on_the_next_real_tick_not_on_a_synthetic_one() {
    // spec: 12 §5.3, 13 TC-E5 (StrategyRunner.syntheticTicks.test.ts:107).
    // TS runs the fixture with `minGtdOffsetMs: 0`; ts-compat fixes the lead
    // at 60 s (11 §4), so the expiry is moved past the lead.
    let mut h = H::new(ts(), MockExec::sync(), Script::default());
    h.send(
        vec![Cmd::Place(Ord::buy("c2", 100.0, 0.2).gtd(t(61_000)))],
        1000,
        BID,
        &[(0.45, 100.0)],
    )
    .unwrap();
    assert_eq!(h.open_cids(), vec!["c2"]);
    h.synth(61_800, SyntheticKind::BinanceAggTrade).unwrap();
    assert_eq!(h.open_cids(), vec!["c2"]);
    h.tick(62_000, BID, &[(0.45, 100.0)]).unwrap();
    assert!(h.open_cids().is_empty());
}

#[test]
fn a_strategy_can_take_liquidity_on_a_synthetic_tick_stamped_with_its_time() {
    // spec: 12 §4.1 (synthetic tick.ts = S), §4.2 decision stamp, TC-C11
    // (StrategyRunner.syntheticTicks.test.ts:155)
    let script = Script::default();
    script.outbox.lock().unwrap().push_back(vec![]);
    script
        .outbox
        .lock()
        .unwrap()
        .push_back(vec![Cmd::Place(Ord::buy("c4", 10.0, 0.5))]);
    let mut h = H::new(ts(), MockExec::sync(), script);
    h.tick(1000, BID, &[(0.45, 100.0)]).unwrap();
    h.synth(1400, SyntheticKind::BinanceAggTrade).unwrap();
    let f = *h.ledger().fills().last().unwrap();
    assert_eq!(f.qty, q(10.0));
    assert_eq!(f.at, t(1400));
    assert_eq!(f.liquidity, Liquidity::Taker);
    assert_eq!(
        h.log()[1],
        "tick seq=1 now=1400 ec=1000 cause=binance_agg_trade"
    );
}

#[test]
fn synthetic_ticks_are_counted_before_the_gate() {
    // spec: 21 §15 (eventsByType keys, counted before the gate), 12 §5.3
    let mut h = H::new(ts(), MockExec::sync(), Script::default());
    // Before the window: counted, not dispatched (TC-C9 inclusive gate).
    h.synth(-5, SyntheticKind::ChainlinkRound).unwrap();
    h.tick(-1, BID, &[(0.45, 100.0)]).unwrap();
    h.tick(0, BID, &[(0.45, 100.0)]).unwrap();
    h.synth(10, SyntheticKind::BinanceAggTrade).unwrap();
    let ticks = h.s.stats().ticks;
    assert_eq!(ticks.by_cause, [2, 0, 1, 1]);
    assert_eq!(ticks.events_processed(), 4);
    assert_eq!(ticks.strategy_ticks, 2);
    assert_eq!(h.s.exec().market_events, 1, "frozen out of window");
}

// ---------------------------------------------------------------------------
// runnerConfig.test.ts
// ---------------------------------------------------------------------------

fn burst(n: usize, ty: OrderType, batch: bool, budget: u32) -> (H, Result<(), SessionFault>) {
    let mut cfg = ts();
    cfg.max_events_per_drain = budget;
    let mut h = H::new(cfg, MockExec::delayed(140), Script::default());
    let orders: Vec<Ord> = (0..n)
        .map(|i| {
            let o = Ord::buy(
                &format!("order-{i}"),
                5.0,
                if ty == OrderType::Fok { 0.7 } else { 0.5 },
            );
            if ty == OrderType::Fok {
                o.ty(OrderType::Fok)
            } else {
                o.post_only()
            }
        })
        .collect();
    let cmds = if batch {
        vec![Cmd::Batch(orders)]
    } else {
        orders.into_iter().map(Cmd::Place).collect()
    };
    let book = |a: f64| (vec![(a - 0.01, 1000.0)], vec![(a, 1000.0)]);
    let (b, a) = book(0.6);
    let mut r = h.send(cmds, 1000, &b, &a);
    for ms in [1140, 1280] {
        if r.is_ok() {
            r = h.tick(ms, &b, &a);
        }
    }
    (h, r)
}

#[test]
fn the_42_order_fill_burst_drains_within_the_default_and_250_budgets() {
    // spec: 12 §6.3 (maxEventsPerDrain bounds deliveries with callbacks)
    // (runnerConfig.test.ts:96)
    for budget in [4_200, 250, 6_000] {
        let (h, r) = burst(42, OrderType::Fok, false, budget);
        r.unwrap();
        assert_eq!(h.ledger().position(Outcome::Up).qty, q(210.0));
        assert!(h.open_cids().is_empty());
    }
}

#[test]
fn a_low_budget_fails_the_candidate_with_cascade_limit() {
    // spec: 12 §6.3 (backtest: strategy_fault cascade_limit, no MarketStats).
    // TS silently drops the queue (runnerConfig.test.ts:120): a TS bug, not
    // reproduced (13 §5.4).
    let (h, r) = burst(42, OrderType::Fok, false, 100);
    match r.unwrap_err() {
        SessionFault::Strategy {
            cause: StrategyFaultCause::CascadeLimit { deliveries, .. },
            ..
        } => assert_eq!(deliveries, 100),
        other => panic!("{other:?}"),
    }
    let m = h.market.clone();
    assert!(h
        .s
        .finalize(&m, pmb_core::FinalOutcome::new(Outcome::Up))
        .is_err());
}

#[test]
fn global_capacity_accepts_100_orders_rejects_101_and_accounts_every_fill() {
    // spec: 12 §8.2 TC-C2 (counters incremental within the list),
    // riskLimits defaults (runnerConfig.test.ts:133)
    for batch in [false, true] {
        let (mut h, r) = burst(101, OrderType::Gtc, batch, 4_200);
        r.unwrap();
        assert_eq!(h.open_cids().len(), 100);
        assert_eq!(h.rejections(), vec!["risk_max_open_orders(max=100)"]);
        h.tick(1420, &[(0.39, 1000.0)], &[(0.4, 1000.0)]).unwrap();
        assert_eq!(h.ledger().position(Outcome::Up).qty, q(500.0));
        assert!(h.open_cids().is_empty());
    }
}

#[test]
fn model_config_resolution_rejects_a_zero_budget() {
    // spec: 21 §6 (runner.maxEventsPerDrain), R14 (fail loud); replaces the
    // env validation of runnerConfig.test.ts:76
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../contract/model-configs/ts-compat-default.json"
    ))
    .unwrap();
    let mut mc: pmb_contract::ModelConfig = serde_json::from_str(&text).unwrap();
    let cfg = EngineConfig::from_model_config(
        &mc,
        InputMode::TelonexDelta,
        pmb_core::seed::MarketSeed(1),
    )
    .unwrap();
    assert_eq!(cfg.max_events_per_drain, 4_200);
    assert_eq!(cfg.starting_capital, u(500.0));
    assert_eq!(cfg.risk, pmb_engine::config::RiskLimits::TS_DEFAULTS);
    assert_eq!(cfg.core_rules, CoreRules::TsCompat);
    mc.runner.max_events_per_drain = 0;
    let err = EngineConfig::from_model_config(
        &mc,
        InputMode::TelonexDelta,
        pmb_core::seed::MarketSeed(1),
    )
    .unwrap_err();
    assert!(err.message.contains("maxEventsPerDrain"), "{}", err.message);
}

#[test]
fn ctx_now_may_step_back_after_a_synthetic_tick_in_ts_compat_only() {
    // spec: 30 §5.0 (ts-compat now() is the TS tick timestamp and can step
    // back after a synthetic tick; realistic now() is monotone), 12 §4.2,
    // 14 §12.3, TC-C11
    for rules in [CoreRules::TsCompat, CoreRules::Realistic] {
        let mut h = H::new(config(rules), MockExec::sync(), Script::default());
        h.tick(1000, BID, &[(0.45, 100.0)]).unwrap();
        h.synth(1400, SyntheticKind::BinanceAggTrade).unwrap();
        // A real row whose exchange time precedes the synthetic stamp.
        let (b, a) = (lv(BID), lv(&[(0.45, 100.0)]));
        h.env_step(
            t(1200),
            Some(t(1200)),
            pmb_engine::Payload::Market(pmb_core::MarketEvent::Book {
                outcome: Outcome::Up,
                bids: &b,
                asks: &a,
            }),
        )
        .unwrap();
        let nows: Vec<String> = h
            .log()
            .iter()
            .map(|l| l.split(' ').nth(2).unwrap().to_string())
            .collect();
        match rules {
            CoreRules::TsCompat => assert_eq!(nows, vec!["now=1000", "now=1400", "now=1200"]),
            CoreRules::Realistic => assert_eq!(nows, vec!["now=1000", "now=1400", "now=1400"]),
        }
        assert_eq!(h.s.clocks().now, t(1400), "the loop clock is monotone (K2)");
    }
}
