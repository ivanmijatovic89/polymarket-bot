// The cancellation suite body, included by `tests/core_cancellation.rs` once per
// execution adapter (see there).
use super::core_support::*;
use pmb_core::event::{AccountEventKind, CancelCause, DoneReason};
use pmb_core::ids::ExchangeOrderId;
use pmb_core::{OrderType, Outcome};
use pmb_engine::config::RiskLimits;
use pmb_engine::CoreRules;

const BIDS: &[(f64, f64)] = &[(0.4, 2.0)];

fn asks(ask: f64) -> Vec<(f64, f64)> {
    vec![(ask, 2.0)]
}

fn order(cid: &str) -> Ord {
    Ord::buy(cid, 10.0, 0.5)
}

fn harness(exec: MockExec) -> HB {
    let mut cfg = config(CoreRules::TsCompat);
    cfg.starting_capital = u(1000.0);
    mk(cfg, exec, Script::default())
}

/// Seeds buy-up, sell-up and buy-down (cancellation.test.ts `seed`).
fn seed(h: &mut HB) {
    h.send(
        vec![
            Cmd::Place(order("buy-up")),
            Cmd::Place(Ord::sell("sell-up", 10.0, 0.5)),
            Cmd::Place(order("buy-down").outcome(Outcome::Down)),
        ],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
}

#[test]
fn selected_batch_resolves_and_deduplicates_and_preserves_unrelated_orders() {
    // spec: 12 §7.3 CancelBatch resolution (duplicates removed), §7.6 dedupe
    // and cid release (cancellation.test.ts:141, backtest runtime)
    let mut h = harness(MockExec::sync());
    seed(&mut h);
    let k = h.current("buy-up").unwrap();
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![
            Ref::Cid("buy-up".into()),
            Ref::Cid("buy-up".into()),
            Ref::Ex(ExchangeOrderId::Sim(k)),
            Ref::Cid("buy-down".into()),
        ])],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-down", "buy-up"]);
    assert_eq!(h.open_cids(), vec!["sell-up"]);
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(0.0));
    // Untargeted orders keep their dedupe; canceled ids can be used again.
    let from = h.n_events();
    h.send(
        vec![Cmd::Place(Ord::sell("sell-up", 10.0, 0.5))],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert!(h.since(from).is_empty());
    assert_eq!(h.s.om().counters().duplicate_active_cid, 1);
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    assert_eq!(h.since(from)[0].kind.ts_kind(), "order_submitted");
}

#[test]
fn scoped_cancellation_by_market_and_outcome() {
    // spec: 12 §7.3 CancelMarket (scope resolved when the cancel takes
    // effect) (cancellation.test.ts:164)
    for (scope, expected) in [
        (None, vec!["buy-down", "buy-up", "sell-up"]),
        (Some(Outcome::Up), vec!["buy-up", "sell-up"]),
    ] {
        let mut h = harness(MockExec::sync());
        seed(&mut h);
        let from = h.n_events();
        h.send(vec![Cmd::CancelMarket(scope)], 1000, BIDS, &asks(0.6))
            .unwrap();
        assert_eq!(h.done_cids(from), expected);
    }
}

#[test]
fn references_unknown_client_and_missing_exchange_id() {
    // spec: 12 §7.3 (unknown cid → UnknownClientOrder; unacknowledged target
    // → MissingExchangeOrderId, TC-C6) (cancellation.test.ts:327)
    let mut h = harness(MockExec::delayed(100));
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![
            Ref::Cid("unknown".into()),
            Ref::Cid("buy-up".into()),
        ])],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(
        h.cancel_failures(from),
        vec!["unknown_client_order", "missing_exchange_order_id"]
    );
    assert_eq!(h.open_cids(), vec!["buy-up"]);
    h.tick(1100, BIDS, &asks(0.6)).unwrap();
    let k = h.current("buy-up").unwrap();
    assert_eq!(h.ledger().order(k).ts_state(), "open");
}

#[test]
fn conflicting_client_and_exchange_ids_fail() {
    // spec: 10 §7.3 N1, 12 §7.3 ConflictingRefs
    let mut h = harness(MockExec::sync());
    h.send(
        vec![
            Cmd::Place(order("a")),
            Cmd::Place(order("b").outcome(Outcome::Down)),
        ],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    let kb = h.current("b").unwrap();
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![Ref::Both(
            "a".into(),
            ExchangeOrderId::Sim(kb),
        )])],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(h.cancel_failures(from), vec!["conflicting_refs"]);
    assert_eq!(h.open_cids(), vec!["a", "b"]);
}

#[test]
fn same_intent_list_can_place_and_then_cancel_the_synchronously_acked_order() {
    // spec: 12 §7.2 TC-C2 step 4 (an OrderAccepted returned synchronously
    // acknowledges the key for cancel resolution later in the same call)
    // (cancellation.test.ts:362)
    let mut h = harness(MockExec::sync());
    let from = h.n_events();
    h.send(
        vec![
            Cmd::Place(order("buy-up")),
            Cmd::CancelBatch(vec![Ref::Cid("buy-up".into())]),
        ],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    assert!(h.open_cids().is_empty());
}

#[test]
fn scope_is_evaluated_at_execution_time() {
    // spec: 12 §7.3 CancelMarket, 13 §5.1 compat cancels
    // (cancellation.test.ts:373)
    let mut h = harness(MockExec::delayed(100));
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    h.send(vec![Cmd::CancelMarket(None)], 1050, BIDS, &asks(0.6))
        .unwrap();
    h.tick(1100, BIDS, &asks(0.6)).unwrap();
    assert_eq!(h.open_cids(), vec!["buy-up"]);
    h.tick(1149, BIDS, &asks(0.6)).unwrap();
    assert_eq!(h.open_cids(), vec!["buy-up"]);
    let from = h.n_events();
    h.tick(1150, BIDS, &asks(0.6)).unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    assert!(h.open_cids().is_empty());
}

#[test]
fn partial_taker_fill_during_cancel_latency_keeps_accounting() {
    // spec: 12 §9.2 (OrderDone with filled; position, fees, PnL kept)
    // (cancellation.test.ts:385)
    let mut h = harness(MockExec::delayed(100));
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    h.send(
        vec![Cmd::CancelMarket(Some(Outcome::Up))],
        1050,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    let from = h.n_events();
    h.tick(1100, BIDS, &asks(0.5)).unwrap();
    assert_eq!(
        h.since(from)
            .iter()
            .filter(|e| e.kind.ts_kind() == "fill")
            .count(),
        1
    );
    let k = h.current("buy-up").unwrap();
    assert_eq!(h.ledger().order(k).remaining(), q(8.0));
    let before = (h.ledger().position(Outcome::Up), h.ledger().realized_pnl());
    assert_eq!(before.0.qty, q(2.0));
    assert!(before.0.cost_basis > u(1.0));
    let from = h.n_events();
    h.tick(1150, BIDS, &asks(0.5)).unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    assert_eq!(
        (h.ledger().position(Outcome::Up), h.ledger().realized_pnl()),
        before
    );
    assert_eq!(h.ledger().order(k).filled(), q(2.0));
    assert!(h.open_cids().is_empty());
}

#[test]
fn full_fill_before_batch_cancel_prevents_duplicate_terminal_and_keeps_dedupe() {
    // spec: 13 TC-C10 (cancel of a non-resting target: no event), 12 §7.6
    // (cancellation.test.ts:405)
    let mut h = harness(MockExec::delayed(100));
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    h.tick(1100, BIDS, &asks(0.6)).unwrap();
    h.send(
        vec![Cmd::CancelBatch(vec![Ref::Cid("buy-up".into())])],
        1110,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    let from = h.n_events();
    h.send(vec![Cmd::Place(order("buy-up"))], 1111, BIDS, &asks(0.6))
        .unwrap();
    assert!(h.since(from).is_empty(), "deduped while active");
    let from = h.n_events();
    h.tick(1150, BIDS, &asks(0.4)).unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    let from = h.n_events();
    h.tick(1210, BIDS, &asks(0.6)).unwrap();
    assert!(h.since(from).is_empty());
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(10.0));
}

#[test]
fn cancel_requests_do_not_release_risk_capacity() {
    // spec: 12 §8.2 TC-C2 (whole-list risk pass before any handler; cancels
    // pass through and free nothing) (cancellation.test.ts:540)
    let cancels = [
        Cmd::Cancel("buy-up".into()),
        Cmd::CancelAll,
        Cmd::CancelBatch(vec![Ref::Cid("buy-up".into())]),
        Cmd::CancelMarket(None),
    ];
    for cancel in cancels {
        let mut cfg = config(CoreRules::TsCompat);
        cfg.starting_capital = u(1000.0);
        cfg.risk = RiskLimits {
            max_open_orders: 1,
            max_order_size: q(100.0),
            max_abs_position: q(100.0),
            max_loss_stop: u(500.0),
        };
        let mut h = mk(cfg, MockExec::sync(), Script::default());
        h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
            .unwrap();
        h.send(
            vec![cancel.clone(), Cmd::Place(order("replacement"))],
            1001,
            BIDS,
            &asks(0.6),
        )
        .unwrap();
        assert_eq!(h.rejections(), vec!["risk_max_open_orders(max=1)"]);
        assert!(h.current("replacement").is_none());
        // The cancel itself was dispatched and executed.
        assert!(h.open_cids().is_empty(), "{cancel:?}");
    }
}

#[test]
fn filled_and_killed_orders_stay_terminal_when_canceled_again() {
    // spec: 12 §7.3 (known terminal skipped silently), TC-C10
    // (cancellation.test.ts:604)
    let mut h = harness(MockExec::sync());
    h.send(
        vec![Cmd::Place(order("killed").ty(OrderType::Fok))],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(
        h.ledger().order(h.current("killed").unwrap()).ts_state(),
        "killed"
    );
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    h.tick(1100, BIDS, &asks(0.4)).unwrap();
    assert_eq!(
        h.ledger().order(h.current("buy-up").unwrap()).ts_state(),
        "filled"
    );
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![
            Ref::Cid("killed".into()),
            Ref::Cid("buy-up".into()),
            Ref::Ex(unknown_exchange_id()),
        ])],
        1200,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert!(h.since(from).is_empty(), "{:?}", h.since(from));
}

#[test]
fn oversized_cancel_batch_fails_before_dispatch() {
    // spec: 12 §7.3 cap (ts-compat 3000, TC-C12) (cancellation.test.ts:653)
    let mut h = harness(MockExec::sync());
    let refs = (0..3001).map(|_| Ref::Ex(unknown_exchange_id())).collect();
    let from = h.n_events();
    h.send(vec![Cmd::CancelBatch(refs)], 1000, BIDS, &asks(0.6))
        .unwrap();
    assert_eq!(h.cancel_failures(from), vec!["invalid_cancel_batch_size"]);
    if let Some(m) = h.s.exec().mock() {
        assert!(m.commands.is_empty());
    }
}

#[test]
fn partial_fill_then_selected_cancel_by_exchange_id_closes_only_the_remainder() {
    // spec: 12 §7.3, §9.2 (cancellation.test.ts:665)
    let mut h = harness(MockExec::delayed(100));
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    h.tick(1100, BIDS, &asks(0.5)).unwrap();
    let k = h.current("buy-up").unwrap();
    let before = h.ledger().position(Outcome::Up);
    h.send(
        vec![Cmd::CancelBatch(vec![Ref::Ex(ExchangeOrderId::Sim(k))])],
        1101,
        BIDS,
        &asks(0.5),
    )
    .unwrap();
    let from = h.n_events();
    h.tick(1200, BIDS, &asks(0.5)).unwrap();
    assert!(h.since(from).is_empty());
    h.tick(1201, BIDS, &asks(0.5)).unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    assert_eq!(h.ledger().position(Outcome::Up), before);
    assert_eq!(h.ledger().order(k).filled(), q(2.0));
    match h.events().last().unwrap().kind {
        AccountEventKind::OrderDone {
            reason: DoneReason::Canceled(CancelCause::Strategy(_)),
            filled,
            ..
        } => assert_eq!(filled, Some(q(2.0))),
        ref other => panic!("{other:?}"),
    }
}

#[test]
fn cid_reuse_creates_distinct_generations_and_counts_both_fills() {
    // spec: 12 §7.1 (cid → current OrderKey; earlier keys stay in the ledger)
    // (cancellation.test.ts:806)
    let mut h = harness(MockExec::sync());
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    let first = h.current("buy-up").unwrap();
    h.tick(1100, BIDS, &asks(0.4)).unwrap();
    h.send(vec![Cmd::Place(order("buy-up"))], 1200, BIDS, &asks(0.6))
        .unwrap();
    let second = h.current("buy-up").unwrap();
    assert_ne!(first, second);
    h.tick(1300, BIDS, &asks(0.4)).unwrap();
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(20.0));
    assert_eq!(h.ledger().orders().len(), 2);
}

#[test]
fn delayed_cancel_order_is_bound_to_the_decision_time_generation() {
    // spec: 13 TC-C5 (CancelOrder bound to the cid's key current at decision
    // time; it never hits a newer generation)
    let mut h = harness(MockExec::delayed(100));
    h.send(vec![Cmd::Place(order("a"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    h.tick(1100, BIDS, &asks(0.6)).unwrap();
    let old = h.current("a").unwrap();
    h.send(vec![Cmd::Cancel("a".into())], 1110, BIDS, &asks(0.6))
        .unwrap();
    // Filled before the cancel arrives; the cid is released on delivery.
    h.tick(1150, BIDS, &asks(0.4)).unwrap();
    h.send(vec![Cmd::Place(order("a"))], 1160, BIDS, &asks(0.6))
        .unwrap();
    let new = h.current("a").unwrap();
    assert_ne!(old, new);
    h.tick(1260, BIDS, &asks(0.6)).unwrap();
    assert_eq!(h.open_cids(), vec!["a"], "the replacement survives");
}
