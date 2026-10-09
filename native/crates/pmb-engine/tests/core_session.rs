//! Session-level rules: the driver and fault isolation (12 §2.1, §11),
//! engine faults from adapter contract violations (12 §9.8), guards and
//! operator controls (12 §8.3), the capital cap (12 §9.4), stale books
//! (12 §5.2), `Ctx` semantics (12 §6.5) and finalize with `intentMeta`
//! (21 §11, §16).

mod core_support;

use std::sync::Arc;

use core_support::*;
use pmb_core::event::{AccountEventKind, CancelCause, DoneReason};
use pmb_core::fill::{Fill, Liquidity};
use pmb_core::ids::{FillKey, OrderKey, TradeSeq};
use pmb_core::order::Side;
use pmb_core::{FinalOutcome, MarketEvent, Outcome, QuoteSide};
use pmb_engine::envelope::{Control, GuardTrip, OperatorCommand, Source};
use pmb_engine::session::{drive, SessionFault, StrategyFaultCause};
use pmb_engine::{CoreRules, Envelope, Payload};

const BIDS: &[(f64, f64)] = &[(0.4, 100.0)];
const ASKS: &[(f64, f64)] = &[(0.6, 100.0)];

#[test]
fn drive_steps_every_session_and_isolates_a_faulted_candidate() {
    // spec: 12 §2.1 (driver applies, then steps every session), §11 (the
    // candidate stops; other candidates continue), 21 §13
    let mut market = market();
    let healthy = Arc::new(Script::default());
    let faulty = Arc::new(Script {
        panic_at_tick: Some(1),
        ..Script::default()
    });
    let mut sessions = vec![
        S::new(
            &faulty,
            &market,
            config(CoreRules::TsCompat),
            MockExec::sync(),
            Rec::default(),
        )
        .unwrap(),
        S::new(
            &healthy,
            &market,
            config(CoreRules::TsCompat),
            MockExec::sync(),
            Rec::default(),
        )
        .unwrap(),
    ];
    let (b, a) = (lv(BIDS), lv(ASKS));
    let envs: Vec<Envelope<'_>> = (0..3)
        .map(|i| Envelope {
            seq: i + 1,
            at: t(i as i64 * 10),
            exchange_ts: Some(t(i as i64 * 10)),
            recv_wall: None,
            recv_mono: None,
            source: Source::MarketWs,
            payload: Payload::Market(MarketEvent::Book {
                outcome: Outcome::Up,
                bids: &b,
                asks: &a,
            }),
        })
        .collect();
    drive(&mut market, &mut sessions, &envs);
    assert!(matches!(
        sessions[0].fault(),
        Some(SessionFault::Strategy {
            cause: StrategyFaultCause::Panic { .. },
            tick_seq: 1,
            ..
        })
    ));
    assert!(sessions[1].fault().is_none());
    assert_eq!(healthy.log.lock().unwrap().len(), 3);
    assert_eq!(faulty.log.lock().unwrap().len(), 1);
    // Both sessions counted the ticks they processed.
    assert_eq!(sessions[1].stats().ticks.events_processed(), 3);
}

#[test]
fn a_returned_strategy_error_is_a_strategy_fault_with_its_message() {
    // spec: 30 §12 (Err(StrategyError): cause error, message preserved)
    let script = Script {
        error_at_tick: Some(0),
        ..Script::default()
    };
    let mut h = H::new(config(CoreRules::TsCompat), MockExec::sync(), script);
    match h.tick(0, BIDS, ASKS).unwrap_err() {
        SessionFault::Strategy {
            cause: StrategyFaultCause::Error { message },
            callback: "onMarketTick",
            ..
        } => assert_eq!(message, "bad state"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn an_adapter_event_for_an_unknown_order_is_an_engine_fault() {
    // spec: 12 §9.8, §11 (ledger invariant violation → engine_fault), 13 X3
    let mut exec = MockExec::sync();
    exec.timed.push((
        t(5),
        AccountEventKind::Fill(Fill {
            key: FillKey {
                order: OrderKey::new(42),
                seq: 1,
            },
            trade: TradeSeq::new(1),
            outcome: Outcome::Up,
            side: Side::Buy,
            price: p(0.5),
            qty: q(1.0),
            fee: u(0.0),
            liquidity: Liquidity::Taker,
            at: t(5),
            exchange_ts: None,
            late: false,
        }),
    ));
    let mut h = H::new(config(CoreRules::TsCompat), exec, Script::default());
    h.tick(0, BIDS, ASKS).unwrap();
    match h.tick(10, BIDS, ASKS).unwrap_err() {
        SessionFault::Engine { message } => {
            assert!(message.contains("unknown order 42"), "{message}")
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn kill_switch_cancels_everything_and_stops_strategy_calls() {
    // spec: 12 §8.3 (engine-originated CancelAll with cause KillSwitch,
    // halts the strategy), 50 §10.4 (stop strategy calls; keep applying
    // account events)
    let mut h = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    let from = h.n_events();
    h.control(5, Control::Operator(OperatorCommand::KillSwitch))
        .unwrap();
    assert_eq!(h.done_cids(from), vec!["a"]);
    assert!(matches!(
        h.events().last().unwrap().kind,
        AccountEventKind::OrderDone {
            reason: DoneReason::Canceled(CancelCause::KillSwitch),
            ..
        }
    ));
    assert_eq!(h.s.om().halt(), pmb_engine::om::Halt::KillSwitch);
    // The strategy is not called again: its queued intents stay unread and
    // no tick is dispatched.
    let ticks = h.log().len();
    let dispatched = h.s.stats().ticks.strategy_ticks;
    h.send(vec![Cmd::Place(Ord::buy("b", 10.0, 0.5))], 10, BIDS, ASKS)
        .unwrap();
    assert_eq!(h.log().len(), ticks);
    assert_eq!(h.s.stats().ticks.strategy_ticks, dispatched);
    assert!(h.rejections().is_empty());
    assert!(h.current("b").is_none());
    // A session-loss guard trip is a kill switch (50 §10.2).
    let mut g = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    g.control(0, Control::Guard(GuardTrip::SessionLoss))
        .unwrap();
    g.send(vec![Cmd::Place(Ord::buy("b", 10.0, 0.5))], 10, BIDS, ASKS)
        .unwrap();
    assert!(g.log().is_empty());
    assert!(g.current("b").is_none());
}

#[test]
fn reject_burst_halts_placements_and_splits_but_keeps_callbacks_and_cancels() {
    // spec: 12 §7.2 step 1 (StrategyHalted), §7.3 SplitPositions row (halt
    // and guards first), 50 §10.2 reject_burst (strategy keeps receiving
    // events; cancels stay allowed)
    let mut h = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    h.control(5, Control::Guard(GuardTrip::RejectBurst))
        .unwrap();
    let from = h.n_events();
    h.send(
        vec![
            Cmd::Place(Ord::buy("b", 10.0, 0.5)),
            Cmd::Split(q(5.0)),
            Cmd::Merge(q(1.0)),
            Cmd::Cancel("a".into()),
        ],
        10,
        BIDS,
        ASKS,
    )
    .unwrap();
    let kinds: Vec<&str> = h.since(from).iter().map(|e| e.kind.ts_kind()).collect();
    assert_eq!(h.rejections(), vec!["strategy_halted"]);
    assert!(h.since(from).iter().any(|e| matches!(
        e.kind,
        AccountEventKind::SplitFailed {
            reason: pmb_core::event::SplitMergeFailReason::StrategyHalted,
            ..
        }
    )));
    // The merge is not halted (it fails on pairs, not on the halt).
    assert!(h.since(from).iter().any(|e| matches!(
        e.kind,
        AccountEventKind::MergeFailed {
            reason: pmb_core::event::SplitMergeFailReason::InsufficientPairs,
            ..
        }
    )));
    assert_eq!(h.done_cids(from), vec!["a"], "{kinds:?}");
    assert!(h.ledger().pending_ops().is_empty());
    // Other guards reject placements and splits with `KillSwitch` (D-PENDING
    // in `Halt::Guard`) and keep the strategy running.
    let mut g = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    g.control(0, Control::Guard(GuardTrip::OrderRate)).unwrap();
    g.send(
        vec![Cmd::Place(Ord::buy("b", 10.0, 0.5)), Cmd::Split(q(5.0))],
        10,
        BIDS,
        ASKS,
    )
    .unwrap();
    assert_eq!(g.rejections(), vec!["kill_switch"]);
    assert!(g.events().iter().any(|e| matches!(
        e.kind,
        AccountEventKind::SplitFailed {
            reason: pmb_core::event::SplitMergeFailReason::KillSwitch,
            ..
        }
    )));
    // A later kill switch is not downgraded by a weaker guard.
    g.control(20, Control::Operator(OperatorCommand::KillSwitch))
        .unwrap();
    g.control(30, Control::Guard(GuardTrip::RejectBurst))
        .unwrap();
    assert_eq!(g.s.om().halt(), pmb_engine::om::Halt::KillSwitch);
}

#[test]
fn guards_and_adoption_are_refused_where_unsupported() {
    // spec: D28 (ts-compat is backtest-only; guards are paper/live), 12 §10
    // AdoptPositions (adopted shares must leave `sellable`), R14
    let mut h = H::new(
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Script::default(),
    );
    assert!(matches!(
        h.control(0, Control::Guard(GuardTrip::SessionLoss)),
        Err(SessionFault::Engine { .. })
    ));
    let mut r = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    match r.control(0, Control::AdoptPositions) {
        Err(SessionFault::Engine { message }) => assert!(message.contains("AdoptPositions")),
        other => panic!("{other:?}"),
    }
}

#[test]
fn operator_cancel_order_targets_the_current_generation() {
    // spec: 12 §3.2 Operator(cancel_order{cid}), §8.3 (engine-originated
    // cancels carry their cause and go through the OM pipeline)
    let mut h = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    let cid = h.s.cids().get("a").unwrap();
    let from = h.n_events();
    h.control(5, Control::Operator(OperatorCommand::CancelOrder { cid }))
        .unwrap();
    assert_eq!(h.done_cids(from), vec!["a"]);
    assert!(matches!(
        h.events().last().unwrap().kind,
        AccountEventKind::OrderDone {
            reason: DoneReason::Canceled(CancelCause::Operator),
            ..
        }
    ));
    // A known terminal target is skipped: no command, no event (12 §7.3).
    let commands = h.s.exec().commands.len();
    let from = h.n_events();
    h.control(6, Control::Operator(OperatorCommand::CancelOrder { cid }))
        .unwrap();
    assert!(h.since(from).is_empty());
    assert_eq!(h.s.exec().commands.len(), commands);
}

#[test]
fn operator_cancel_of_an_unacknowledged_order_is_deferred_until_its_ack() {
    // spec: 12 §7.3 (realistic CancelOrder resolved like CancelBatch: an
    // unacknowledged target is Deferred, dispatched when OrderAccepted is
    // delivered; "never guess an unacknowledged exchange id"), §8.3
    let mut h = H::new(
        config(CoreRules::Realistic),
        MockExec::delayed(100),
        Script::default(),
    );
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    let k = h.current("a").unwrap();
    assert!(!h.ledger().order(k).acknowledged());
    let cid = h.s.cids().get("a").unwrap();
    let commands = h.s.exec().commands.len();
    h.control(5, Control::Operator(OperatorCommand::CancelOrder { cid }))
        .unwrap();
    assert_eq!(h.s.exec().commands.len(), commands, "deferred, not sent");
    assert_eq!(
        h.ledger().order(k).cancel_state(),
        pmb_core::state::CancelState::Deferred
    );
    // The ack arrives with the next real tick; the deferred cancel follows.
    let from = h.n_events();
    h.tick(200, BIDS, ASKS).unwrap();
    h.tick(400, BIDS, ASKS).unwrap();
    assert_eq!(h.done_cids(from), vec!["a"], "{:?}", h.kinds());
    assert!(h.since(from).iter().any(|e| matches!(
        e.kind,
        AccountEventKind::OrderDone {
            reason: DoneReason::Canceled(CancelCause::Operator),
            ..
        }
    )));
}

#[test]
fn capital_cap_bounds_available() {
    // spec: 12 §9.4 (available = min(cash − reservations, cap)), D31
    let mut h = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    h.control(0, Control::CapitalCap(u(3.0))).unwrap();
    assert_eq!(h.ledger().available(), u(3.0));
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 1, BIDS, ASKS)
        .unwrap();
    let r = h.rejections();
    assert_eq!(r.len(), 1);
    assert!(r[0].starts_with("insufficient_capital("), "{r:?}");
    assert!(r[0].ends_with(",available=3)"), "{r:?}");
}

#[test]
fn stale_book_events_are_counted_but_not_dispatched_in_realistic() {
    // spec: 12 §5.2 stale books (realistic), 15 I-6f; ts-compat has no stale
    // state
    let mut h = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    h.tick(0, BIDS, ASKS).unwrap();
    h.control(5, Control::DataGap(Some(Outcome::Up))).unwrap();
    h.price_change(10, &[(Outcome::Up, QuoteSide::Bid, 0.41, 5.0)])
        .unwrap();
    assert_eq!(h.log().len(), 1);
    h.tick(20, BIDS, ASKS).unwrap();
    assert_eq!(h.log().len(), 2);
    assert_eq!(h.s.stats().ticks.events_processed(), 3);
}

#[test]
fn ctx_exposes_profile_rules_book_and_portfolio() {
    // spec: 12 §6.5 (rules(): ts-compat rules of 11 §4; book(o): recorded
    // book; warmed() always true), 30 §5
    for rules in [CoreRules::TsCompat, CoreRules::Realistic] {
        let script = Script {
            on_tick: Some(Box::new(|ctx, _out, log| {
                log.lock().unwrap().push(format!(
                    "min={:?} ask={:?} warmed={} cash={} slug={}",
                    ctx.rules().min_order_size().map(|q| q.to_string()),
                    ctx.book(Outcome::Up).best_ask().map(|l| l.price),
                    ctx.warmed(),
                    ctx.portfolio().capital().cash,
                    ctx.market().slug,
                ));
            })),
            ..Script::default()
        };
        let mut h = H::new(config(rules), MockExec::sync(), script);
        h.tick(0, BIDS, ASKS).unwrap();
        // D59: `None` in ts-compat.
        let min = match rules {
            CoreRules::TsCompat => "None",
            CoreRules::Realistic => "Some(\"5\")",
        };
        assert_eq!(
            h.log()[1],
            format!("min={min} ask=Some(Price(0.6)) warmed=true cash=500 slug={SLUG}")
        );
    }
}

#[test]
fn finalize_builds_stats_and_first_fill_intent_meta() {
    // spec: 21 §11 MarketStats fields, §16 intentMeta (first fill per cid,
    // fill order, unfilled orders excluded), 12 §9.6
    let mut h = H::new(
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Script::default(),
    );
    h.send(
        vec![
            Cmd::Place(Ord::buy("a", 10.0, 0.6).meta("first")),
            Cmd::Place(Ord::buy("rest", 10.0, 0.3).meta("never")),
        ],
        0,
        BIDS,
        &[(0.6, 5.0), (0.62, 100.0)],
    )
    .unwrap();
    let m = h.market.clone();
    let out = h.s.finalize(&m, FinalOutcome::new(Outcome::Up)).unwrap();
    let st = &out.stats;
    assert_eq!(st.trade_count, 1);
    assert_eq!(st.shares[Outcome::Up], 5_000_000);
    assert_eq!(
        st.buy_vwap[Outcome::Up],
        (600_000i128 * 5_000_000, 5_000_000)
    );
    assert_eq!(st.intent_meta.len(), 1);
    assert_eq!(out.metas.get(st.intent_meta[0]), r#"{"leg":"first"}"#);
    // pnl = cash change + 5 × 1 (Up wins).
    assert_eq!(st.pnl, st.cash_end - st.cash_start + u(5.0));
    assert_eq!(out.acc.counters.orders_placed, 2);
}

#[test]
fn oversized_meta_is_rejected() {
    // spec: 12 §7.4 (order meta ≤ 16 KiB → MetaTooLarge), 21 §16
    let mut h = H::new(
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Script::default(),
    );
    let big = "x".repeat(17 * 1024);
    h.send(
        vec![Cmd::Place(Ord::buy("a", 10.0, 0.3).meta(&big))],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    assert_eq!(h.rejections(), vec!["meta_too_large"]);
    assert!(h.ledger().orders().is_empty());
}

#[test]
fn rejected_placements_never_store_their_meta() {
    // spec: 10 §7.5 (meta stored once for the order that carries it), 12
    // §14 P1, R8: a meta-carrying placement re-sent every tick while
    // underfunded leaves the session meta store unchanged.
    let mut h = H::new(
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Script::default(),
    );
    for i in 0..20 {
        h.send(
            vec![Cmd::Place(Ord::buy("big", 1500.0, 0.5).meta("entry"))],
            i * 10,
            BIDS,
            ASKS,
        )
        .unwrap();
    }
    assert_eq!(h.rejections().len(), 20);
    // An accepted order stores its meta exactly once.
    h.send(
        vec![Cmd::Place(Ord::buy("ok", 1.0, 0.5).meta("small"))],
        300,
        BIDS,
        ASKS,
    )
    .unwrap();
    let m = h.market.clone();
    let out = h.s.finalize(&m, FinalOutcome::new(Outcome::Up)).unwrap();
    assert_eq!(out.metas.len(), 1);
    assert_eq!(
        out.metas.get(pmb_core::MetaId::new(0)),
        r#"{"leg":"small"}"#
    );
}

#[test]
fn naked_sell_excess_reaches_the_output_diagnostics() {
    // spec: 12 §9.5 TC-C4 (counts the excess in the diagnostic
    // oversold_qty), 21 §10 diagnostics.anomalies, R14 (recorded in the
    // output)
    let mut h = H::new(
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Script::default(),
    );
    h.send(
        vec![Cmd::Place(
            Ord::sell("naked", 5.0, 0.4).ty(pmb_core::OrderType::Fok),
        )],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(0.0));
    let m = h.market.clone();
    let out = h.s.finalize(&m, FinalOutcome::new(Outcome::Up)).unwrap();
    assert_eq!(out.diagnostics.ledger.oversold_qty, 5_000_000);
    let a = pmb_engine::output::engine_anomalies(&out.diagnostics).unwrap();
    assert!(a.contains_key("oversold_qty"), "{a:?}");
}

#[test]
fn ts_compat_end_of_stream_counts_discarded_actions() {
    // spec: 13 §5.1 TC-C13 (undue actions are discarded at end of stream),
    // 12 §14 P12 (scheduled-action counters always on)
    let mut h = H::sim(
        config(CoreRules::TsCompat),
        MockExec::delayed(500),
        Script::default(),
    );
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    let m = h.market.clone();
    h.s.end_of_stream(&m).unwrap();
    let out = h.s.finalize(&m, FinalOutcome::new(Outcome::Up)).unwrap();
    assert_eq!(out.diagnostics.exec.actions_discarded, 1);
    let a = pmb_engine::output::engine_anomalies(&out.diagnostics).unwrap();
    assert!(a.contains_key("actions_discarded"), "{a:?}");
}

fn paper() -> pmb_engine::EngineConfig {
    config(CoreRules::Realistic)
        .with_run_mode(pmb_engine::config::RunMode::Paper)
        .unwrap()
}

#[test]
fn paper_panic_cancels_the_market_and_keeps_applying_events() {
    // spec: 12 §11 paper column (D32: CancelMarket{Market} with cause
    // StrategyPanic, strategy halted until rotation, exchange events keep
    // being applied), 30 §12
    let script = Script {
        panic_at_tick: Some(1),
        ..Script::default()
    };
    let mut h = H::new(paper(), MockExec::sync(), script);
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    let from = h.n_events();
    h.tick(10, BIDS, ASKS).unwrap();
    assert!(h.s.fault().is_none());
    assert_eq!(h.s.strategy_halts().len(), 1);
    assert!(matches!(
        h.s.strategy_halts()[0],
        SessionFault::Strategy {
            cause: StrategyFaultCause::Panic { .. },
            ..
        }
    ));
    assert_eq!(h.done_cids(from), vec!["a"]);
    assert!(h.since(from).iter().any(|e| matches!(
        e.kind,
        AccountEventKind::OrderDone {
            reason: DoneReason::Canceled(CancelCause::StrategyPanic),
            ..
        }
    )));
    assert_eq!(h.s.om().halt(), pmb_engine::om::Halt::StrategyHalted);
    // Later inputs are still stepped (no callbacks): the session finalizes.
    let log = h.log().len();
    h.tick(20, BIDS, ASKS).unwrap();
    assert_eq!(h.log().len(), log);
    let m = h.market.clone();
    assert!(h.s.finalize(&m, FinalOutcome::new(Outcome::Up)).is_ok());
}

#[test]
fn paper_cascade_limit_applies_every_remaining_event_without_callbacks() {
    // spec: 12 §6.3 paper ("as a strategy panic ... every remaining queued
    // event is still applied to the ledger without callbacks; events are
    // never dropped", 10 S5), 50 §10.2 max_cascade_events
    // Marketable GTC BUYs (the mock models share-sized orders only).
    let take = |c: &str| Cmd::Place(Ord::buy(c, 5.0, 0.7));
    let cmds = || vec![take("a"), take("b"), take("c")];
    // Reference: the same input with an ample budget.
    let mut full = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    full.send(cmds(), 0, BIDS, ASKS).unwrap();
    let mut cfg = paper();
    cfg.max_events_per_drain = 3;
    let mut h = H::new(cfg, MockExec::sync(), Script::default());
    h.send(cmds(), 0, BIDS, ASKS).unwrap();
    assert!(matches!(
        h.s.strategy_halts(),
        [SessionFault::Strategy {
            cause: StrategyFaultCause::CascadeLimit { deliveries: 3, .. },
            ..
        }]
    ));
    // Every fill reached the ledger, as in the reference run.
    assert_eq!(
        h.ledger().position(Outcome::Up),
        full.ledger().position(Outcome::Up)
    );
    assert_eq!(h.ledger().capital(), full.ledger().capital());
    assert!(h.ledger().active_keys().is_empty());
    // The same budget in backtest stops the candidate.
    let mut cfg = config(CoreRules::Realistic);
    cfg.max_events_per_drain = 3;
    let mut b = H::new(cfg, MockExec::sync(), Script::default());
    assert!(b.send(cmds(), 0, BIDS, ASKS).is_err());
}

#[test]
fn paper_requires_the_realistic_rules() {
    // spec: D28 (paper runs the realistic rules), R14
    assert!(config(CoreRules::TsCompat)
        .with_run_mode(pmb_engine::config::RunMode::Paper)
        .is_err());
    let mut cfg = config(CoreRules::TsCompat);
    cfg.run_mode = pmb_engine::config::RunMode::Paper;
    let script = Arc::new(Script::default());
    assert!(matches!(
        S::new(&script, &market(), cfg, MockExec::sync(), Rec::default()),
        Err(SessionFault::Engine { .. })
    ));
}

#[test]
fn a_panicking_strategy_drop_fails_only_its_candidate() {
    // spec: 30 §12 (the instance is poisoned and dropped inside
    // catch_unwind), 12 §11 (a candidate's panic never stops the driver or
    // the other candidates)
    struct Bomb;
    impl Drop for Bomb {
        fn drop(&mut self) {
            panic!("drop bomb");
        }
    }
    impl pmb_engine::Strategy for Bomb {
        type Params = ();
        const ID: &'static str = "core-drop-bomb.v1";
        fn requirements(_p: &()) -> pmb_engine::strategy::Requirements {
            pmb_engine::strategy::Requirements::new()
        }
        fn new(_p: &(), _m: &pmb_core::MarketInfo) -> Self {
            Bomb
        }
        fn on_tick(
            &mut self,
            _ctx: &pmb_engine::Ctx,
            _out: &mut pmb_engine::Intents,
        ) -> pmb_engine::StrategyResult {
            Err(pmb_engine::StrategyError::new("stop"))
        }
    }
    let mut market = market();
    let mut sessions = vec![pmb_engine::Session::<Bomb, MockExec, Rec>::new(
        &(),
        &market,
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Rec::default(),
    )
    .unwrap()];
    let (b, a) = (lv(BIDS), lv(ASKS));
    let env = Envelope {
        seq: 1,
        at: t(0),
        exchange_ts: Some(t(0)),
        recv_wall: None,
        recv_mono: None,
        source: Source::MarketWs,
        payload: Payload::Market(pmb_core::MarketEvent::Book {
            outcome: Outcome::Up,
            bids: &b,
            asks: &a,
        }),
    };
    // The error drops the instance; its panicking Drop is contained.
    drive(&mut market, &mut sessions, std::slice::from_ref(&env));
    assert!(matches!(
        sessions[0].fault(),
        Some(SessionFault::Strategy {
            cause: StrategyFaultCause::Error { .. },
            ..
        })
    ));
}

fn timed_fill(k: OrderKey, ms: i64, side: Side, outcome: Outcome) -> AccountEventKind {
    AccountEventKind::Fill(Fill {
        key: FillKey { order: k, seq: 1 },
        trade: TradeSeq::new(1),
        outcome,
        side,
        price: p(0.5),
        qty: q(1.0),
        fee: u(0.0),
        liquidity: Liquidity::Maker,
        at: t(ms),
        exchange_ts: None,
        late: false,
    })
}

#[test]
fn a_fill_after_the_terminal_event_reaches_the_strategy_flagged_late() {
    // spec: 10 §8.2 (late fill: applied and flagged `late`), 30 §8 FillView,
    // 12 §12 (the trace records the delivered event)
    let k = OrderKey::new(0);
    let mut exec = MockExec::sync();
    exec.accept_only = true;
    exec.timed.push((
        t(100),
        AccountEventKind::OrderDone {
            order: k,
            reason: DoneReason::Canceled(CancelCause::Exchange),
            filled: None,
        },
    ));
    exec.timed
        .push((t(200), timed_fill(k, 200, Side::Buy, Outcome::Up)));
    let script = Script {
        on_event: Some(Box::new(|_ctx, ev, _out, log| {
            if let pmb_engine::strategy::AccountEvent::Fill { fill, .. } = ev {
                log.lock().unwrap().push(format!("late={}", fill.late));
            }
        })),
        ..Script::default()
    };
    let mut h = H::new(config(CoreRules::Realistic), exec, script);
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    assert_eq!(h.current("a"), Some(k));
    h.tick(300, BIDS, ASKS).unwrap();
    assert!(h.log().iter().any(|l| l == "late=true"), "{:?}", h.log());
    assert!(h.ledger().fills()[0].late);
    let traced = h
        .events()
        .iter()
        .find_map(|e| match e.kind {
            AccountEventKind::Fill(f) => Some(f),
            _ => None,
        })
        .unwrap();
    assert!(traced.late);
}

#[test]
fn a_fill_on_the_wrong_outcome_or_side_is_an_engine_fault() {
    // spec: 13 §2.4 X3/X5 (adapter contract), 12 §9.8, §11 (engine_fault),
    // R14
    for (side, outcome) in [(Side::Sell, Outcome::Up), (Side::Buy, Outcome::Down)] {
        let k = OrderKey::new(0);
        let mut exec = MockExec::sync();
        exec.accept_only = true;
        exec.timed.push((t(100), timed_fill(k, 100, side, outcome)));
        let mut h = H::new(config(CoreRules::Realistic), exec, Script::default());
        h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
            .unwrap();
        match h.tick(300, BIDS, ASKS) {
            Err(SessionFault::Engine { message }) => {
                assert!(message.contains("outcome or side"), "{message}")
            }
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn realistic_open_order_limit_counts_a_fully_filled_record_until_its_terminal() {
    // spec: 12 §8.1 Open orders ("non-terminal own records (InFlight,
    // Delayed, Live, Unknown) + 1 > maxOpenOrders")
    let k = OrderKey::new(0);
    let mut exec = MockExec::sync();
    exec.accept_only = true;
    // The order fills completely; its OrderDone is not delivered.
    let mut fill = timed_fill(k, 100, Side::Buy, Outcome::Up);
    if let AccountEventKind::Fill(f) = &mut fill {
        f.qty = q(10.0);
    }
    exec.timed.push((t(100), fill));
    let mut cfg = config(CoreRules::Realistic);
    cfg.risk.max_open_orders = 1;
    let mut h = H::new(cfg, exec, Script::default());
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    h.send(vec![Cmd::Place(Ord::buy("b", 10.0, 0.5))], 200, BIDS, ASKS)
        .unwrap();
    assert!(h.ledger().order(k).fully_filled());
    assert_eq!(h.rejections(), vec!["risk_max_open_orders(max=1)"]);
}
