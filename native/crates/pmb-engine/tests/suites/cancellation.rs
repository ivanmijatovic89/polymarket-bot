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
    assert_eq!(h.cancel_failures(from), vec!["conflicting_order_reference"]);
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

// ---------------------------------------------------------------------------
// The TS view of cancel resolution inside cascades (12 §7.3, §15 "Cancel
// reference resolution"; `cancellation.ts:61-127`, `Portfolio.ts:593-878`;
// R5). Scenarios reproduced with a TS probe (Portfolio + OrderManager +
// BacktestExecution) by the reviewers of ws/core.
// ---------------------------------------------------------------------------

fn cancel_on_completing_fill(cid: &'static str) -> Script {
    Script {
        on_event: Some(Box::new(move |ctx, ev, out, _log| {
            if let pmb_engine::strategy::AccountEvent::Fill { order, .. } = ev {
                if ctx.portfolio().cid_str(order) == cid && order.fully_filled() {
                    out.push(Cmd::CancelBatch(vec![Ref::Cid(cid.into())]));
                }
            }
        })),
        ..Script::default()
    }
}

#[test]
fn cancel_from_the_completing_fill_callback_is_an_unknown_client_order() {
    // spec: 12 §7.3 CancelBatch (unknown cid → UnknownClientOrder), §9.2
    // (the order leaves the open orders when filled reaches its size), R5.
    // TS removes the order from `openOrdersByClientId` on the full fill
    // while its history keeps the non-terminal lifecycle, so
    // `resolveCancelBatch` emits `unknown_client_order` (TS probe:
    // `[{kind:"cancel_failed",reason:"unknown_client_order",clientOrderId:"buy-up"}]`).
    let mut cfg = config(CoreRules::TsCompat);
    cfg.starting_capital = u(1000.0);
    let mut h = mk(cfg, MockExec::sync(), cancel_on_completing_fill("buy-up"));
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    let from = h.n_events();
    // The ask moves through the resting BUY: a maker fill, then OrderDone.
    h.tick(1100, &[(0.3, 50.0)], &[(0.45, 50.0)]).unwrap();
    let kinds: Vec<&str> = h.since(from).iter().map(|e| e.kind.ts_kind()).collect();
    let fill_at = kinds.iter().position(|k| *k == "fill").expect("filled");
    assert_eq!(h.cancel_failures(from), vec!["unknown_client_order"]);
    // The failure is queued behind the sibling OrderDone (12 §6.2).
    assert_eq!(kinds.last(), Some(&"cancel_failed"), "{kinds:?}");
    assert!(kinds[fill_at..].contains(&"order_done"), "{kinds:?}");
    assert!(h.open_cids().is_empty());
}

#[test]
fn cancel_of_a_reused_cid_before_its_new_submission_is_delivered_is_silent() {
    // spec: 12 §7.3 CancelBatch (known terminal → skipped silently), §7.1
    // (generations), TC-C2 step 4, R5. Generation 1 of `x` is a killed FOK;
    // generation 2 is placed in the same tick list after `y`, and the
    // `OrderSubmitted(y)` callback cancels `x` while generation 2's
    // submission is still queued. TS resolves against the delivered
    // history (gen 1, `killed`) and skips (TS probe: `[]`).
    let script = Script {
        on_event: Some(Box::new(move |ctx, ev, out, _log| {
            if let pmb_engine::strategy::AccountEvent::OrderSubmitted { order, .. } = ev {
                if ctx.portfolio().cid_str(order) == "y" {
                    out.push(Cmd::CancelBatch(vec![Ref::Cid("x".into())]));
                }
            }
        })),
        ..Script::default()
    };
    let mut cfg = config(CoreRules::TsCompat);
    cfg.starting_capital = u(1000.0);
    let mut h = mk(cfg, MockExec::sync(), script);
    // Generation 1: a FOK BUY below the ask is killed.
    h.send(
        vec![Cmd::Place(order("x").ty(OrderType::Fok))],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    let gen1 = h.current("x").unwrap();
    assert!(h.ledger().order(gen1).state().is_terminal());
    let from = h.n_events();
    h.send(
        vec![
            Cmd::Place(order("y").outcome(Outcome::Down)),
            Cmd::Place(order("x")),
        ],
        1010,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert!(h.cancel_failures(from).is_empty(), "{:?}", h.kinds());
    let gen2 = h.current("x").unwrap();
    assert_ne!(gen1, gen2);
    assert_eq!(h.open_cids(), vec!["x", "y"]);
}

#[test]
fn both_refs_follow_the_ts_conflict_rules() {
    // spec: 10 §7.3 N1, 12 §7.3 (conflicting refs), TC-C10;
    // `cancellation.ts:85-99`: an unknown cid with the exchange id of an
    // open order of another cid conflicts; a matching pair cancels.
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
    let ka = h.current("a").unwrap();
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![Ref::Both(
            "ghost".into(),
            ExchangeOrderId::Sim(ka),
        )])],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(h.cancel_failures(from), vec!["conflicting_order_reference"]);
    assert_eq!(h.open_cids(), vec!["a", "b"]);
    // An unknown cid with an id that names nothing: TS forwards it and its
    // simulator finds nothing (TC-C10): no event.
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![Ref::Both(
            "ghost".into(),
            unknown_exchange_id(),
        )])],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert!(h.since(from).iter().all(|e| e.kind.ts_kind() != "cancel_failed"));
    // A matching pair cancels.
    let from = h.n_events();
    h.send(
        vec![Cmd::CancelBatch(vec![Ref::Both(
            "a".into(),
            ExchangeOrderId::Sim(ka),
        )])],
        1000,
        BIDS,
        &asks(0.6),
    )
    .unwrap();
    assert_eq!(h.done_cids(from), vec!["a"]);
}

#[test]
fn empty_batch_and_known_completed_orders_produce_no_duplicate_terminal() {
    // spec: 12 §7.3 CancelBatch (known terminal → skipped silently; nothing
    // resolved → no dispatch) (cancellation.test.ts:198, backtest runtime)
    let mut h = harness(MockExec::sync());
    h.send(vec![Cmd::Place(order("buy-up"))], 1000, BIDS, &asks(0.6))
        .unwrap();
    let from = h.n_events();
    h.send(vec![Cmd::CancelBatch(vec![])], 1000, BIDS, &asks(0.6))
        .unwrap();
    assert!(h.since(from).is_empty());
    let cancel = || vec![Cmd::CancelBatch(vec![Ref::Cid("buy-up".into())])];
    h.send(cancel(), 1000, BIDS, &asks(0.6)).unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    let from = h.n_events();
    h.send(cancel(), 1000, BIDS, &asks(0.6)).unwrap();
    assert!(h.since(from).is_empty());
}

#[test]
fn single_and_account_wide_cancellation_still_work() {
    // spec: 12 §7.3 CancelOrder (TC-C5) and CancelAll (cancellation.test.ts:209,
    // backtest runtime)
    let mut h = harness(MockExec::sync());
    seed(&mut h);
    let from = h.n_events();
    h.send(vec![Cmd::Cancel("buy-up".into())], 1000, BIDS, &asks(0.6))
        .unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-up"]);
    let from = h.n_events();
    h.send(vec![Cmd::CancelAll], 1000, BIDS, &asks(0.6)).unwrap();
    assert_eq!(h.done_cids(from), vec!["buy-down", "sell-up"]);
    assert!(h.open_cids().is_empty());
}
