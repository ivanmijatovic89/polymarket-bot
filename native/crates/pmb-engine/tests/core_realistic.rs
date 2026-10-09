//! Realistic core rules (12 §5.4 D23, §7.2 first principles, §7.3 deferred
//! cancels, §7.4 `ExchangeRules` validation and the self-cross block, §7.5
//! funding, §8.1 risk, §10 lifecycle), the tick interest filter (16 §9.4),
//! interests (30 §4.1) and the trace emission points (12 §12). The realistic
//! simulator is M3b; these tests use the compat-like mock.

mod core_support;

use core_support::*;
use pmb_core::event::{AccountEventKind, CancelCause, DoneReason};
use pmb_core::fill::SettlementStatus;
use pmb_core::{OrderType, Outcome};
use pmb_engine::config::RiskLimits;
use pmb_engine::envelope::Control;
use pmb_engine::strategy::{EventFlags, Interests, TickInterest};
use pmb_engine::window::SessionState;
use pmb_engine::{CoreRules, EngineConfig};

fn real() -> EngineConfig {
    config(CoreRules::Realistic)
}

const BIDS: &[(f64, f64)] = &[(0.4, 100.0)];
const ASKS: &[(f64, f64)] = &[(0.6, 100.0)];

#[test]
fn window_gate_warming_active_and_counting_before_the_gate() {
    // spec: 12 §5.4 realistic (now ∈ [start, end)), §10 Warming → Active,
    // 21 §15 (counted before the gate)
    let mut h = H::new(real(), MockExec::sync(), Script::default());
    h.tick(-10, BIDS, ASKS).unwrap();
    assert_eq!(h.s.state(), SessionState::Warming);
    h.tick(0, BIDS, ASKS).unwrap();
    assert_eq!(h.s.state(), SessionState::Active);
    h.tick(899_999, BIDS, ASKS).unwrap();
    h.tick(900_000, BIDS, ASKS).unwrap();
    let ticks = h.s.stats().ticks;
    assert_eq!(ticks.events_processed(), 4);
    assert_eq!(ticks.strategy_ticks, 2);
    let log = h.log();
    assert_eq!(log.len(), 2);
    assert!(log[0].starts_with("tick seq=0 now=0 "));
    assert!(log[1].starts_with("tick seq=1 now=899999 "));
}

#[test]
fn realistic_dedupe_runs_before_validation() {
    // spec: 12 §7.2 (dedupe at step 2, before validation), §7.6
    let mut h = H::new(real(), MockExec::sync(), Script::default());
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    // An invalid re-send of the active cid is dropped, not rejected.
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.505))], 1, BIDS, ASKS)
        .unwrap();
    assert!(h.rejections().is_empty());
    assert_eq!(h.s.om().counters().duplicate_active_cid, 1);
}

#[test]
fn exchange_rules_validation_reasons() {
    // spec: 12 §7.4 realistic column, 11 §7–§8 (tick, minimum size, GTD lead,
    // post-only on market orders)
    let mut h = H::new(real(), MockExec::sync(), Script::default());
    h.send(
        vec![
            Cmd::Place(Ord::buy("tick", 10.0, 0.505)),
            Cmd::Place(Ord::buy("small", 4.0, 0.5)),
            Cmd::Place(Ord::buy("gtd", 10.0, 0.5).gtd(t(179_000))),
            Cmd::Place(Ord::sell("po", 10.0, 0.5).ty(OrderType::Fok).post_only()),
            Cmd::Place(Ord::buy("ok", 10.0, 0.5).gtd(t(181_000))),
        ],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    let codes: Vec<String> = h
        .rejections()
        .iter()
        .map(|r| r.split('(').next().unwrap().to_string())
        .collect();
    assert_eq!(
        codes,
        vec![
            "invalid_tick",
            "size_below_minimum",
            "gtd_lead_too_short",
            "post_only_requires_gtc_or_gtd"
        ]
    );
    assert_eq!(h.open_cids(), vec!["ok"]);
}

#[test]
fn self_cross_block_direct_and_complementary() {
    // spec: 12 §7.4 self-cross block (D54, 10 N6); not in ts-compat (TC-C14)
    for rules in [CoreRules::Realistic, CoreRules::TsCompat] {
        let mut exec = MockExec::sync();
        exec.accept_only = true;
        let mut h = H::new(config(rules), exec, Script::default());
        h.send(vec![Cmd::Split(q(20.0))], 0, BIDS, ASKS).unwrap();
        h.send(
            vec![
                Cmd::Place(Ord::buy("bu", 10.0, 0.5)),
                Cmd::Place(Ord::sell("su", 10.0, 0.5)),
                Cmd::Place(Ord::buy("bd", 10.0, 0.5).outcome(Outcome::Down)),
                Cmd::Place(Ord::buy("bd2", 10.0, 0.49).outcome(Outcome::Down)),
            ],
            1,
            BIDS,
            ASKS,
        )
        .unwrap();
        let codes: Vec<String> = h
            .rejections()
            .iter()
            .map(|r| r.split('(').next().unwrap().to_string())
            .collect();
        match rules {
            CoreRules::Realistic => {
                assert_eq!(codes, vec!["self_cross", "self_cross"]);
                assert_eq!(h.open_cids(), vec!["bd2", "bu"]);
            }
            CoreRules::TsCompat => assert!(codes.is_empty()),
        }
    }
}

#[test]
fn realistic_sell_needs_settled_inventory() {
    // spec: 12 §7.5 (SELL size ≤ sellable), §9.3 (sell gate Mined); ts-compat
    // has no inventory check (TC-C4)
    let mut exec = MockExec::sync();
    exec.fill_status = Some(SettlementStatus::Matched);
    let mut h = H::new(real(), exec, Script::default());
    h.send(
        vec![Cmd::Place(Ord::sell("naked", 10.0, 0.4))],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    assert_eq!(
        h.rejections(),
        vec!["insufficient_inventory(required=10,available=0)"]
    );
    // Bought shares at MATCHED are below the Mined gate.
    h.send(vec![Cmd::Place(Ord::buy("b", 10.0, 0.6))], 1, BIDS, ASKS)
        .unwrap();
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(10.0));
    h.send(vec![Cmd::Place(Ord::sell("s", 10.0, 0.4))], 2, BIDS, ASKS)
        .unwrap();
    assert_eq!(h.rejections().len(), 2);
    let mut ts = H::ts_compat(MockExec::sync());
    ts.send(
        vec![Cmd::Place(Ord::sell("naked", 10.0, 0.4))],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    assert!(ts.rejections().is_empty());
    assert_eq!(ts.ledger().counters().oversold_qty, 10_000_000);
}

#[test]
fn loss_stop_blocks_buys_but_allows_exits_in_realistic_only() {
    // spec: 12 §8.1 (loss stop blocks BUYs and splits; SELLs allowed) vs
    // §8.2 TC-C3 (blocks every placement)
    for rules in [CoreRules::Realistic, CoreRules::TsCompat] {
        let mut cfg = config(rules);
        cfg.risk = RiskLimits {
            max_loss_stop: u(0.5),
            ..RiskLimits::TS_DEFAULTS
        };
        let mut exec = MockExec::sync();
        exec.fill_status = Some(SettlementStatus::Mined);
        let mut h = H::new(cfg, exec, Script::default());
        h.send(vec![Cmd::Place(Ord::buy("b", 20.0, 0.6))], 0, BIDS, ASKS)
            .unwrap();
        h.send(vec![Cmd::Place(Ord::sell("s", 10.0, 0.4))], 1, BIDS, ASKS)
            .unwrap();
        assert!(h.ledger().realized_pnl() <= u(-0.5));
        h.send(
            vec![
                Cmd::Place(Ord::buy("b2", 5.0, 0.6)),
                Cmd::Place(Ord::sell("s2", 5.0, 0.4)),
            ],
            2,
            BIDS,
            ASKS,
        )
        .unwrap();
        let codes: Vec<String> = h
            .rejections()
            .iter()
            .map(|r| r.split('(').next().unwrap().to_string())
            .collect();
        match rules {
            CoreRules::Realistic => assert_eq!(codes, vec!["risk_loss_stop"]),
            CoreRules::TsCompat => assert_eq!(codes, vec!["risk_loss_stop", "risk_loss_stop"]),
        }
    }
}

#[test]
fn realistic_open_order_limit_counts_undelivered_submissions() {
    // spec: 12 §8.1 (records emitted earlier in the same list count at once)
    let mut cfg = real();
    cfg.risk.max_open_orders = 1;
    let mut h = H::new(cfg, MockExec::delayed(100), Script::default());
    h.send(
        vec![
            Cmd::Place(Ord::buy("a", 10.0, 0.5)),
            Cmd::Place(Ord::buy("b", 10.0, 0.4).outcome(Outcome::Down)),
        ],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    assert_eq!(h.rejections(), vec!["risk_max_open_orders(max=1)"]);
}

#[test]
fn batch_over_the_cap_rejects_every_order() {
    // spec: 12 §7.3 PlaceBatch (realistic cap 15, TC-C12)
    let mut h = H::new(real(), MockExec::sync(), Script::default());
    let orders = (0..16)
        .map(|i| Ord::buy(&format!("o{i}"), 5.0, 0.3))
        .collect();
    h.send(vec![Cmd::Batch(orders)], 0, BIDS, ASKS).unwrap();
    assert_eq!(h.rejections().len(), 16);
    assert!(h
        .rejections()
        .iter()
        .all(|r| r == "batch_too_large(max_15_orders)"));
    assert!(h.s.exec().commands.is_empty());
}

#[test]
fn cancel_of_an_unacknowledged_order_is_deferred_until_the_ack() {
    // spec: 12 §7.3 deferred cancels (realistic), 10 §8.1 CancelState::Deferred
    let mut h = H::new(real(), MockExec::delayed(100), Script::default());
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    h.send(vec![Cmd::Cancel("a".into())], 10, BIDS, ASKS)
        .unwrap();
    assert_eq!(h.s.exec().commands.len(), 1, "cancel held");
    assert!(h.cancel_failures(0).is_empty());
    // The ack is delivered at 100; the deferred cancel is dispatched then.
    h.tick(100, BIDS, ASKS).unwrap();
    assert_eq!(h.s.exec().commands.len(), 2);
    assert!(h.s.exec().commands[1].starts_with("Cancel"));
    let from = h.n_events();
    h.tick(200, BIDS, ASKS).unwrap();
    assert_eq!(h.done_cids(from), vec!["a"]);
}

#[test]
fn deferred_cancel_resolves_silently_when_the_target_ends_first() {
    // spec: 12 §7.3 (if the target becomes terminal first, the deferred
    // cancel resolves silently), 10 §8.1
    let mut h = H::new(real(), MockExec::delayed(100), Script::default());
    // A post-only BUY that will cross at arrival: rejected with no ack.
    h.send(
        vec![Cmd::Place(Ord::buy("a", 10.0, 0.6).post_only())],
        0,
        BIDS,
        &[(0.7, 100.0)],
    )
    .unwrap();
    h.send(vec![Cmd::Cancel("a".into())], 10, BIDS, ASKS)
        .unwrap();
    h.tick(100, BIDS, ASKS).unwrap();
    let k = h.current("a").unwrap();
    assert_eq!(h.ledger().order(k).ts_state(), "rejected");
    h.tick(200, BIDS, ASKS).unwrap();
    assert_eq!(h.s.exec().commands.len(), 1, "the cancel was never sent");
    assert!(h.cancel_failures(0).is_empty());
}

#[test]
fn window_end_cancels_resting_orders_and_stops_callbacks() {
    // spec: 12 §5.4 realistic, §10 Closing, §8.3 engine-originated intents
    let mut h = H::new(real(), MockExec::sync(), Script::default());
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.5))], 0, BIDS, ASKS)
        .unwrap();
    let callbacks = h.log().len();
    let from = h.n_events();
    h.control(900_000, Control::WindowEnd).unwrap();
    assert_eq!(h.s.state(), SessionState::Closing);
    assert_eq!(h.done_cids(from), vec!["a"]);
    match h.events().last().unwrap().kind {
        AccountEventKind::OrderDone {
            reason: DoneReason::Canceled(CancelCause::WindowEnd),
            ..
        } => {}
        ref other => panic!("{other:?}"),
    }
    assert_eq!(h.log().len(), callbacks, "no callbacks while Closing");
    assert_eq!(h.ledger().capital().reserved, u(0.0));
    // ts-compat has no window-end envelope (TC-C13).
    let mut ts = H::ts_compat(MockExec::sync());
    assert!(ts.control(900_000, Control::WindowEnd).is_err());
}

#[test]
fn realistic_end_of_stream_drains_the_scheduler_without_callbacks() {
    // spec: 12 §5.1 end_of_stream (realistic), TC-C13 (ts-compat discards)
    for rules in [CoreRules::Realistic, CoreRules::TsCompat] {
        let mut exec = MockExec::sync();
        exec.timed.push((
            t(5_000),
            AccountEventKind::StreamStatus { connected: false },
        ));
        let mut h = H::new(config(rules), exec, Script::default());
        h.tick(0, BIDS, ASKS).unwrap();
        let m = h.market.clone();
        h.s.end_of_stream(&m).unwrap();
        let n = h
            .kinds()
            .iter()
            .filter(|k| **k == "account_stream_status")
            .count();
        assert_eq!(n, usize::from(rules == CoreRules::Realistic));
        assert_eq!(h.log().len(), 1, "no callbacks at end of stream");
    }
}

#[test]
fn tick_interest_filter_skips_unchanged_tops_and_wakes_on_events() {
    // spec: 16 §9.4 TF-2 (a)–(c), TF-3 (only the callback is skipped), TF-6
    let script = Script {
        interests: Some(Interests {
            events: EventFlags::ALL,
            ticks: TickInterest::TopOfBook,
        }),
        ..Script::default()
    };
    let mut h = H::new(config(CoreRules::TsCompat), MockExec::sync(), script);
    h.tick(0, BIDS, ASKS).unwrap(); // (a) first in-window tick
    h.tick(1, BIDS, ASKS).unwrap(); // unchanged: skipped
    h.tick(2, &[(0.4, 50.0)], ASKS).unwrap(); // size only: skipped
    h.tick(3, &[(0.41, 50.0)], ASKS).unwrap(); // (b) price changed
    let ticks = h.s.stats().ticks;
    assert_eq!(ticks.strategy_ticks, 4);
    assert_eq!(ticks.strategy_ticks_skipped, 2);
    assert_eq!(ticks.events_processed(), 4);
    assert_eq!(h.log().len(), 2);
    // TF-3: skipped ticks still emit TickStart and an empty Decision.
    let lines = &h.s.trace().lines;
    assert_eq!(
        lines.iter().filter(|l| l.starts_with("tick_start")).count(),
        4
    );
    assert_eq!(
        lines.iter().filter(|l| l.starts_with("decision")).count(),
        4
    );
    // (c) an account event delivered since the last call wakes the next tick.
    h.script
        .outbox
        .lock()
        .unwrap()
        .push_back(vec![Cmd::Place(Ord::buy("a", 10.0, 0.3))]);
    h.tick(4, &[(0.42, 50.0)], ASKS).unwrap();
    h.tick(5, &[(0.42, 50.0)], ASKS).unwrap();
    h.tick(6, &[(0.42, 50.0)], ASKS).unwrap();
    assert_eq!(h.log().iter().filter(|l| l.starts_with("tick")).count(), 4);
}

#[test]
fn declared_event_interests_skip_callbacks_but_not_the_ledger() {
    // spec: 30 §4.1 (a skipped callback is equivalent to one that returned no
    // intents), 12 §6.1
    let script = Script {
        interests: Some(Interests {
            events: EventFlags::FILLS,
            ticks: TickInterest::All,
        }),
        ..Script::default()
    };
    let mut h = H::new(config(CoreRules::TsCompat), MockExec::sync(), script);
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.6))], 0, BIDS, ASKS)
        .unwrap();
    let events: Vec<String> = h
        .log()
        .into_iter()
        .filter(|l| l.starts_with("event"))
        .collect();
    assert_eq!(events.len(), 1);
    assert!(events[0].starts_with("event fill"));
    assert!(h.kinds().len() > 1);
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(10.0));
}

#[test]
fn trace_emission_points_follow_the_cascade() {
    // spec: 12 §12 (TickStart before the execution step; FeedView; Decision
    // after every callback; AccountEvent before its callback), §6.2
    let mut h = H::new(
        config(CoreRules::TsCompat),
        MockExec::sync(),
        Script::default(),
    );
    h.send(vec![Cmd::Place(Ord::buy("a", 10.0, 0.3))], 0, BIDS, ASKS)
        .unwrap();
    assert_eq!(
        h.s.trace().lines,
        vec![
            "tick_start 0 book 0",
            "feed_view 0",
            "decision 0 Tick 1",
            "account 0 order_submitted",
            "decision 0 Account 0",
            "account 0 order_accepted",
            "decision 0 Account 0",
            "account 0 settlement_update",
            "decision 0 Account 0",
            "account 0 order_open",
            "decision 0 Account 0",
        ]
    );
}

#[test]
fn breadth_first_cascade_delivers_siblings_before_new_results() {
    // spec: 12 §6.2 (intents from the callback for event k append after
    // events already queued) (StrategyRunner.ts:551, 568-595)
    let script = Script {
        on_event: Some(Box::new(|ctx, ev, out, _log| {
            if let pmb_engine::strategy::AccountEvent::OrderSubmitted { order, .. } = ev {
                if ctx.portfolio().cid_str(order) == "a" {
                    out.push(Cmd::Place(Ord::buy("child", 10.0, 0.3)));
                }
            }
        })),
        ..Script::default()
    };
    let mut h = H::new(config(CoreRules::TsCompat), MockExec::sync(), script);
    h.send(
        vec![
            Cmd::Place(Ord::buy("a", 10.0, 0.3)),
            Cmd::Place(Ord::buy("b", 10.0, 0.31)),
        ],
        0,
        BIDS,
        ASKS,
    )
    .unwrap();
    let submitted: Vec<String> = h
        .events()
        .iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::OrderSubmitted { order } => Some(h.cid_of(order)),
            _ => None,
        })
        .collect();
    assert_eq!(submitted, vec!["a", "b", "child"]);
    // "child" was decided at the tick's stamp (TC-C8).
    let k = h.current("child").unwrap();
    assert_eq!(h.ledger().order(k).created_at(), t(0));
}
