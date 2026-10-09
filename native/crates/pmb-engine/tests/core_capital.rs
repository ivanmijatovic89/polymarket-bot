//! `src/trading/capital.test.ts` converted to Rust fixture tests (60 §7.3):
//! reservation at emission, funding inside cascades, release on
//! authoritative final quantities, split/merge funding and the per-market
//! allowance. Only observable events and the capital view are asserted (R4).
//! Live-adapter cases (`LiveExecution`, REST/WS reconciliation) are M9 and
//! not converted; the TS `queued` intent mode has no Rust counterpart.

mod core_support;

use std::sync::Mutex;

use core_support::*;
use pmb_core::event::AccountEventKind;
use pmb_core::fill::Capital;
use pmb_core::{OrderType, Outcome};
use pmb_engine::strategy::AccountEvent as AuthorEvent;
use pmb_engine::Ctx;

const BIDS: &[(f64, f64)] = &[(0.6, 2000.0)];

fn asks(ask: f64, size: f64) -> Vec<(f64, f64)> {
    vec![(ask, size)]
}

fn cap(h: &H) -> Capital {
    h.ledger().capital()
}

fn capital(cash: f64, reserved: f64) -> Capital {
    Capital {
        starting: u(500.0),
        cash: u(cash),
        reserved: u(reserved),
    }
}

#[test]
fn rejects_616_80_before_dispatch_then_affordable_buy_fills() {
    // spec: 12 §7.5 funding, §9.4 reservation (capital.test.ts:153)
    let mut h = H::ts_compat(MockExec::delayed(140));
    h.send(
        vec![Cmd::Place(Ord::buy("too-large", 1000.0, 0.6))],
        1000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert!(h.s.exec().commands.is_empty(), "no dispatch");
    assert_eq!(
        h.rejections(),
        vec!["insufficient_capital(required=616.8,available=500)"]
    );
    h.send(
        vec![Cmd::Place(Ord::buy("a", 800.0, 0.6))],
        1001,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(h.s.exec().commands.len(), 1);
    assert_eq!(cap(&h).reserved, u(493.44));
    // Not yet executed (1001 + 140 > 1100).
    h.tick(1100, BIDS, &asks(0.6, 2000.0)).unwrap();
    assert_eq!(cap(&h).cash, u(500.0));
    h.tick(1200, BIDS, &asks(0.6, 2000.0)).unwrap();
    assert_eq!(cap(&h), capital(6.56, 0.0));
    assert_eq!(h.ledger().available(), u(6.56));
}

#[test]
fn batches_and_separate_intents_reserve_each_accepted_buy_before_dispatch() {
    // spec: 12 §7.3 PlaceBatch, §9.1 (capital.test.ts:196)
    for batch in [false, true] {
        let mut h = H::ts_compat(MockExec::sync());
        let orders = vec![Ord::buy("a", 600.0, 0.6), Ord::buy("b", 600.0, 0.6)];
        let cmds = if batch {
            vec![Cmd::Batch(orders)]
        } else {
            orders.into_iter().map(Cmd::Place).collect()
        };
        h.send(cmds, 1000, BIDS, &asks(0.8, 2000.0)).unwrap();
        assert_eq!(h.open_cids(), vec!["a"]);
        assert_eq!(h.ledger().available(), u(129.92));
        let rejected: Vec<_> = h
            .events()
            .iter()
            .filter_map(|e| match e.kind {
                AccountEventKind::OrderRejected { cid, .. } => {
                    Some(h.s.cids().resolve(cid).to_string())
                }
                _ => None,
            })
            .collect();
        assert_eq!(rejected, vec!["b"]);
    }
}

#[test]
fn account_callbacks_see_undelivered_submissions_without_double_counting() {
    // spec: 12 §9.1 (reservations exist from decision time), 12 §6.2
    // (capital.test.ts:208)
    let seen = std::sync::Arc::new(Mutex::new(None));
    let seen2 = seen.clone();
    let script = Script {
        on_event: Some(Box::new(move |ctx: &Ctx, ev: &AuthorEvent, out, _log| {
            if let AuthorEvent::OrderSubmitted { order, .. } = ev {
                if ctx.portfolio().cid_str(order) == "a" {
                    *seen2.lock().unwrap() = Some(ctx.portfolio().capital().available());
                    out.push(Cmd::Place(Ord::buy("callback", 15.0, 0.6)));
                }
            }
        })),
        ..Script::default()
    };
    let mut h = H::new(
        config(pmb_engine::CoreRules::TsCompat),
        MockExec::sync(),
        script,
    );
    h.send(
        vec![
            Cmd::Place(Ord::buy("a", 400.0, 0.6)),
            Cmd::Place(Ord::buy("b", 400.0, 0.6)),
        ],
        1000,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(*seen.lock().unwrap(), Some(u(6.56)));
    assert_eq!(h.ledger().available(), u(6.56));
    assert_eq!(
        h.rejections(),
        vec!["insufficient_capital(required=9.252,available=6.56)"]
    );
}

#[test]
fn partial_fill_spends_part_of_reservation_and_delayed_cancel_releases_the_rest() {
    // spec: 12 §9.4 (outstanding = final − delivered filled; release on an
    // authoritative final quantity) (capital.test.ts:221)
    let mut h = H::ts_compat(MockExec::delayed(140));
    h.send(
        vec![Cmd::Place(Ord::buy("a", 800.0, 0.6))],
        1000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    h.tick(1200, BIDS, &asks(0.6, 300.0)).unwrap();
    assert_eq!(cap(&h), capital(314.96, 308.4));
    assert_eq!(h.ledger().available(), u(6.56));
    h.send(
        vec![Cmd::Cancel("a".into())],
        1201,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).reserved, u(308.4));
    h.tick(1400, BIDS, &asks(0.8, 2000.0)).unwrap();
    assert_eq!(h.ledger().available(), u(314.96));
    assert_eq!(cap(&h).reserved, u(0.0));
}

#[test]
fn rejection_fok_kill_and_expiry_release_unused_capital() {
    // spec: 12 §9.4 final-quantity table (capital.test.ts:368). TS runs this
    // fixture with `minGtdOffsetMs: 0`; ts-compat fixes the GTD lead at 60 s
    // (11 §4, TC-C1), so the expiry is moved past the lead.
    let mut h = H::ts_compat(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("fok", 800.0, 0.6).ty(OrderType::Fok))],
        1000,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(h.ledger().available(), u(500.0));
    h.send(
        vec![Cmd::Place(Ord::buy("expire", 800.0, 0.6).gtd(t(61_001)))],
        1001,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(h.ledger().available(), u(6.56));
    h.tick(61_001, BIDS, &asks(0.8, 2000.0)).unwrap();
    assert_eq!(h.ledger().available(), u(500.0));
    h.send(
        vec![Cmd::Place(Ord::buy("post", 800.0, 0.6).post_only())],
        61_200,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(h.ledger().available(), u(500.0));
    assert!(h
        .rejections()
        .contains(&"post_only_would_cross".to_string()));
}

#[test]
fn sale_proceeds_are_reusable_and_turnover_may_exceed_capital() {
    // spec: 12 §9.4 (sale proceeds available immediately) (capital.test.ts:395)
    let mut h = H::ts_compat(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("a", 800.0, 0.6))],
        1000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    h.send(
        vec![Cmd::Place(Ord::sell("sell", 800.0, 0.6))],
        1100,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).cash, u(473.12));
    h.send(
        vec![Cmd::Place(Ord::buy("again", 700.0, 0.6))],
        1200,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).cash, u(41.36));
    assert_eq!(h.kinds().iter().filter(|k| **k == "fill").count(), 3);
}

#[test]
fn post_only_buy_reserves_no_fee_and_unexecuted_sell_creates_no_cash() {
    // spec: 10 §9.4 C1 (post-only reserves notional), 12 §7.5 TC-C4
    // (capital.test.ts:405)
    let mut h = H::ts_compat(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("maker", 1000.0, 0.5).post_only())],
        1000,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).reserved, u(500.0));
    h.send(
        vec![Cmd::Place(Ord::sell("sell", 100.0, 0.9))],
        1100,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).cash, u(500.0));
    assert_eq!(h.ledger().available(), u(0.0));
}

#[test]
fn splits_consume_funding_before_dispatch_and_merges_return_collateral_once() {
    // spec: 12 §7.3 split/merge, §9.4, §9.5 (capital.test.ts:413)
    let mut h = H::ts_compat(MockExec::sync());
    h.send(
        vec![
            Cmd::Split(q(300.0)),
            Cmd::Split(q(300.0)),
            Cmd::Place(Ord::buy("blocked", 400.0, 0.6)),
        ],
        1000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    let count = |h: &H, k: &str| h.kinds().iter().filter(|x| **x == k).count();
    assert_eq!(count(&h, "positions_split"), 1);
    assert_eq!(count(&h, "split_failed"), 1);
    assert_eq!(
        h.rejections(),
        vec!["insufficient_capital(required=246.72,available=200)"]
    );
    assert_eq!(cap(&h).cash, u(200.0));
    h.send(vec![Cmd::Merge(q(300.0))], 1100, BIDS, &asks(0.6, 2000.0))
        .unwrap();
    assert_eq!(count(&h, "positions_merged"), 1);
    assert_eq!(cap(&h).cash, u(500.0));
    h.send(
        vec![Cmd::Place(Ord::buy("reuse", 800.0, 0.6))],
        1200,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).cash, u(6.56));
}

#[test]
fn same_timestamp_splits_have_distinct_operations() {
    // spec: 10 §6 OpKey (capital.test.ts:437, the backtest half)
    let mut h = H::ts_compat(MockExec::sync());
    h.send(
        vec![Cmd::Split(q(100.0)), Cmd::Split(q(100.0))],
        1000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&h).cash, u(300.0));
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(200.0));
    let ops: Vec<_> = h
        .events()
        .iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::PositionsSplit { op, .. } => Some(op),
            _ => None,
        })
        .collect();
    assert_eq!(ops.len(), 2);
    assert_ne!(ops[0], ops[1]);
}

#[test]
fn pending_split_cash_is_visible_to_callbacks_and_merges_cannot_reuse_pending_pairs() {
    // spec: 12 §9.1, §7.3 (merge clamped by pending merges) (capital.test.ts:461)
    let seen = std::sync::Arc::new(Mutex::new(None));
    let seen2 = seen.clone();
    let script = Script {
        on_event: Some(Box::new(move |ctx: &Ctx, ev: &AuthorEvent, out, _log| {
            if let AuthorEvent::OrderSubmitted { .. } = ev {
                *seen2.lock().unwrap() = Some(ctx.portfolio().capital().available());
                out.push(Cmd::Place(Ord::buy("callback", 400.0, 0.6)));
            }
        })),
        ..Script::default()
    };
    let mut h = H::new(
        config(pmb_engine::CoreRules::TsCompat),
        MockExec::sync(),
        script,
    );
    h.send(
        vec![
            Cmd::Place(Ord::buy("resting", 100.0, 0.6)),
            Cmd::Split(q(300.0)),
        ],
        1000,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    assert_eq!(*seen.lock().unwrap(), Some(u(138.32)));
    assert_eq!(h.ledger().available(), u(138.32));
    h.send(
        vec![Cmd::Merge(q(300.0)), Cmd::Merge(q(300.0))],
        1100,
        BIDS,
        &asks(0.8, 2000.0),
    )
    .unwrap();
    let merged = h
        .kinds()
        .iter()
        .filter(|k| **k == "positions_merged")
        .count();
    assert_eq!(merged, 1);
    assert!(h.kinds().contains(&"merge_failed"));
    assert_eq!(cap(&h).cash, u(500.0));
}

#[test]
fn each_market_session_has_its_own_allowance() {
    // spec: 12 §10 (events of an old market never reach a newer session or
    // its allowance), §9.4 per-market allowance (capital.test.ts:531-596)
    let mut old = H::ts_compat(MockExec::sync());
    old.send(
        vec![Cmd::Place(Ord::buy("buy-old", 100.0, 0.6))],
        1000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&old).cash, u(438.32));
    let mut new = H::ts_compat(MockExec::sync());
    new.tick(2000, BIDS, &asks(0.6, 2000.0)).unwrap();
    assert_eq!(cap(&new).cash, u(500.0));
    assert!(new.ledger().fills().is_empty());
    new.send(
        vec![Cmd::Place(Ord::buy("buy-new", 100.0, 0.6))],
        3000,
        BIDS,
        &asks(0.6, 2000.0),
    )
    .unwrap();
    assert_eq!(cap(&new).cash, u(438.32));
    assert_eq!(cap(&old).cash, u(438.32));
}
