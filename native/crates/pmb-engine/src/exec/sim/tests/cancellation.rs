//! Backtest cases of `src/trading/cancellation.test.ts` (60 §7.3, M1
//! backtest cases; 13 §11 "delayed cancel binding and `cancel_market` at
//! execution") converted to the adapter boundary: the OM's resolution is
//! replaced by the keys it would dispatch (12 §7.3, TC-C5), and assertions
//! on portfolio internals become assertions on emitted events (R4).

use pmb_core::event::{AccountEventKind, DoneReason};
use pmb_core::order::{OrderType, Side};
use pmb_core::{Outcome, Qty};

use super::{req, Harness};
use crate::exec::CancelScope;

const BID: (i64, i64) = (400_000, 2_000_000);

/// The suite's book: bid 0.4 × 2, ask `ask` × 2 (`cancellation.test.ts:41-56`).
fn book(h: &mut Harness, ask: i64) {
    h.book(Outcome::Up, &[BID], &[(ask, 2_000_000)]);
}

fn buy_up(h: &mut Harness, t: i64) -> pmb_core::ids::OrderKey {
    h.record(
        "buy-up",
        req(Outcome::Up, Side::Buy, 500_000, 10_000_000, OrderType::Gtc),
        t,
    )
}

#[test]
fn scope_is_evaluated_at_execution_including_placements_during_latency() {
    // spec: 13 §5.1 (CancelMarket resolves its scope at execution), TC-E1;
    // cancellation.test.ts "backtest scope is evaluated at execution time"
    let mut h = Harness::compat(100);
    book(&mut h, 600_000);
    let k = buy_up(&mut h, 1_000);
    h.place(1_000, &[k]);
    h.cancel_scope(1_050, CancelScope::Market);
    h.tick(1_100);
    assert_eq!(h.sim.resting().len(), 1);
    h.tick(1_149);
    assert_eq!(h.sim.resting().len(), 1);
    h.events();
    h.tick(1_150);
    assert_eq!(h.take_rendered(), ["1150 done buy-up canceled 0"]);
    assert!(h.sim.resting().is_empty());
}

#[test]
fn partial_taker_fill_during_cancel_latency_cancels_only_the_remainder() {
    // spec: 13 §5.1 (worst-queue leaves the remainder at equality; filled = size − remaining);
    // cancellation.test.ts "partial taker fill during cancellation latency"
    let mut h = Harness::compat(100);
    book(&mut h, 600_000);
    let k = buy_up(&mut h, 1_000);
    h.place(1_000, &[k]);
    h.cancel_scope(1_050, CancelScope::Outcome(Outcome::Up));
    book(&mut h, 500_000);
    h.tick(1_100);
    assert_eq!(
        h.take_rendered(),
        [
            "1100 accepted buy-up",
            "1100 status buy-up MATCHED 0",
            "1100 fill buy-up#1 TAKER 0.5 2 fee=0.035",
            "1100 open buy-up",
        ]
    );
    assert_eq!(h.sim.resting()[0].remaining, Qty::from_micros(8_000_000));
    h.tick(1_150);
    assert_eq!(h.take_rendered(), ["1150 done buy-up canceled 2"]);
}

#[test]
fn full_fill_before_a_delayed_cancel_has_a_single_terminal_event() {
    // spec: 13 X7, TC-C10 (a cancel whose target is terminal at execution emits nothing);
    // cancellation.test.ts "backtest full fill before batch cancellation"
    let mut h = Harness::compat(100);
    book(&mut h, 600_000);
    let k = buy_up(&mut h, 1_000);
    h.place(1_000, &[k]);
    h.tick(1_100);
    h.events();
    h.cancel(1_110, &[k]);
    book(&mut h, 400_000);
    h.tick(1_150);
    assert_eq!(
        h.take_rendered(),
        [
            "1150 fill buy-up#1 MAKER 0.5 10 fee=0",
            "1150 done buy-up filled 10",
        ]
    );
    h.tick(1_210);
    assert!(h.events().is_empty());
}

#[test]
fn completed_fills_and_fok_kills_stay_terminal_when_canceled_again() {
    // spec: TC-C10, 13 X7; cancellation.test.ts "backtest completed fills and FOK kills
    // remain terminal when canceled again"
    let mut h = Harness::compat(0);
    book(&mut h, 600_000);
    let killed = h.record(
        "killed",
        req(Outcome::Up, Side::Buy, 500_000, 10_000_000, OrderType::Fok),
        1_000,
    );
    h.place(1_000, &[killed]);
    let k = buy_up(&mut h, 1_000);
    h.place(1_000, &[k]);
    book(&mut h, 400_000);
    h.tick(1_100);
    h.events();
    h.cancel(1_101, &[killed, k]);
    assert!(h.events().is_empty());
}

#[test]
fn delayed_cancel_cannot_cancel_a_reused_cid_generation() {
    // spec: 13 §5.1 and TC-C5 (a cancel is bound to the decision-time key), 10 §6
    // (a reused cid gets a new OrderKey); cancellation.test.ts "delayed cancel_order
    // cannot cancel a new submission with a reused client ID"
    let mut h = Harness::compat(100);
    book(&mut h, 600_000);
    let first = buy_up(&mut h, 1_000);
    h.place(1_000, &[first]);
    h.tick(1_100);
    h.cancel(1_100, &[first]);
    book(&mut h, 400_000);
    h.tick(1_101);
    assert!(h
        .events()
        .iter()
        .any(|e| matches!(e.kind, AccountEventKind::OrderDone { order, reason: DoneReason::Filled, .. } if order == first)));
    book(&mut h, 600_000);
    let second = buy_up(&mut h, 1_102);
    h.place(1_102, &[second]);
    h.tick(1_300);
    let evs = h.events();
    assert!(
        !evs.iter()
            .any(|e| matches!(e.kind, AccountEventKind::OrderDone { .. })),
        "the delayed cancel of the first generation must not end the second: {evs:?}"
    );
    assert_eq!(h.sim.resting()[0].key, second);
}

#[test]
fn reused_cids_and_repeated_takers_get_distinct_fill_keys() {
    // spec: 10 §6 (OrderKey per submission; FillKey = (order, seq)), 13 §4.5;
    // cancellation.test.ts "client ID reuse creates distinct exchange identities" and
    // "repeated immediate taker fills retain unique IDs"
    let mut h = Harness::compat(0);
    book(&mut h, 400_000);
    let mut keys = Vec::new();
    for t in [1_000, 1_100] {
        let k = h.record(
            "fok",
            req(Outcome::Up, Side::Buy, 500_000, 2_000_000, OrderType::Fok),
            t,
        );
        h.place(t, &[k]);
        keys.push(k);
    }
    let fills: Vec<_> = h
        .events()
        .into_iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::Fill(f) => Some(f.key),
            _ => None,
        })
        .collect();
    assert_eq!(fills.len(), 2);
    assert_ne!(fills[0], fills[1]);
    assert_eq!((fills[0].order, fills[1].order), (keys[0], keys[1]));
}
