//! Direct simulator scenarios (13 §11): the converted TS post-only suite
//! (`src/trading/execution/BacktestExecution.postOnly.test.ts`, 60 §7.3) at
//! the adapter boundary, the fill unit, trace records, scheduler and
//! latency behavior, composition checks, end-of-stream discard, the exact
//! early exit and contract invariants X3/X7 on generated streams.

use pmb_contract::vocab::{
    DepletionModel, FeeModel as FeeAxis, LatencyModel as LatencyAxis, MakerModel, ReportsModel,
    TakerDelayModel,
};
use pmb_core::event::{AccountEvent, AccountEventKind, CancelCause, DoneReason, RejectReason};
use pmb_core::fill::Liquidity;
use pmb_core::ids::{OrderKey, TradeSeq};
use pmb_core::order::{OrderSize, OrderType, Side};
use pmb_core::seed::{market_seed, Entity, EntityKind, EntityRng, RunSeed, StreamSeed};
use pmb_core::{MarketEvent, Outcome, Price, Qty, TsMs, Usdc};

use super::super::book_overlay::RestingOrder;
use super::super::compat;
use super::super::simulator::{ExchangeTruth, Models, Simulator};
use super::{req, ts_compat_config, ts_compat_market, Harness};
use crate::core_rules::CoreRules;
use crate::exec::{CancelScope, EventQueue, ExecCtx, Execution};
use crate::trace::{ExecTraceRecord, LifecycleTransition};

const START: i64 = 1_000;
const EXPIRE: i64 = START + 60_000;
const P40: i64 = 400_000;
const P50: i64 = 500_000;
const P60: i64 = 600_000;
const Q2: i64 = 2_000_000;
const Q10: i64 = 10_000_000;

fn kinds(evs: &[AccountEvent]) -> Vec<&'static str> {
    evs.iter().map(|e| e.kind.ts_kind()).collect()
}

/// The TS suite's book: one level of size 2 per side (`postOnly.test.ts:30-49`).
fn post_only_book(h: &mut Harness, bid: Option<i64>, ask: Option<i64>) {
    let b: Vec<_> = bid.map(|p| (p, Q2)).into_iter().collect();
    let a: Vec<_> = ask.map(|p| (p, Q2)).into_iter().collect();
    h.book(Outcome::Up, &b, &a);
}

fn post_only_order(side: Side, ty: OrderType, price: i64) -> pmb_core::order::OrderRequest {
    let mut r = req(Outcome::Up, side, price, Q10, ty);
    r.post_only = true;
    if ty == OrderType::Gtd {
        r.expire_at_ms = Some(TsMs(EXPIRE));
    }
    r
}

/// Places `orders` as one command (`batch`) or one command each (`single`):
/// both paths are the same placement path (10 N2).
fn place_all(
    h: &mut Harness,
    t: i64,
    names: &[&str],
    orders: &[pmb_core::order::OrderRequest],
    batch: bool,
) -> Vec<OrderKey> {
    let keys: Vec<OrderKey> = names
        .iter()
        .zip(orders)
        .map(|(n, r)| h.record(n, *r, t))
        .collect();
    if batch {
        h.place(t, &keys);
    } else {
        for k in &keys {
            h.place(t, std::slice::from_ref(k));
        }
    }
    keys
}

const SIDES: [Side; 2] = [Side::Buy, Side::Sell];
const RESTING: [OrderType; 2] = [OrderType::Gtc, OrderType::Gtd];

#[test]
fn post_only_non_crossing_rests() {
    // spec: 11 §4 post-only, 13 §5.1 taker steps 1–2 and 4;
    // postOnly.test.ts "non-crossing post-only rests and retains its flag"
    for batch in [false, true] {
        for side in SIDES {
            for ty in RESTING {
                let mut h = Harness::compat(0);
                post_only_book(&mut h, Some(P40), Some(P60));
                place_all(
                    &mut h,
                    START,
                    &["order-1"],
                    &[post_only_order(side, ty, P50)],
                    batch,
                );
                let evs = h.events();
                assert_eq!(
                    kinds(&evs),
                    ["order_accepted", "settlement_update", "order_open"]
                );
                let r = h.sim.resting();
                assert_eq!(r.len(), 1);
                assert_eq!(r[0].remaining, Qty::from_micros(Q10));
                assert!(!evs
                    .iter()
                    .any(|e| matches!(e.kind, AccountEventKind::Fill(_))));
            }
        }
    }
}

#[test]
fn post_only_crossing_rejects_entirely() {
    // spec: 11 §4 (equality crosses), 13 §5.1 taker step 1;
    // postOnly.test.ts "crossing post-only rejects entirely (equality=…)"
    for batch in [false, true] {
        for side in SIDES {
            for ty in RESTING {
                for equality in [false, true] {
                    let mut h = Harness::compat(0);
                    post_only_book(&mut h, Some(P40), Some(P60));
                    let price = match (side, equality) {
                        (Side::Buy, true) => P60,
                        (Side::Buy, false) => 700_000,
                        (Side::Sell, true) => P40,
                        (Side::Sell, false) => 300_000,
                    };
                    let k = place_all(
                        &mut h,
                        START,
                        &["order-1"],
                        &[post_only_order(side, ty, price)],
                        batch,
                    )[0];
                    let evs = h.events();
                    assert_eq!(evs.len(), 1);
                    assert_eq!(evs[0].at, TsMs(START));
                    let AccountEventKind::OrderRejected { order, reason, .. } = evs[0].kind else {
                        panic!("expected a rejection, got {:?}", evs[0].kind);
                    };
                    assert_eq!(order, Some(k));
                    assert_eq!(reason, RejectReason::PostOnlyWouldCross);
                    assert!(h.sim.resting().is_empty());
                    // A crossed book on the next tick fills nothing.
                    post_only_book(&mut h, Some(800_000), Some(200_000));
                    h.tick(START + 1);
                    assert!(h.events().is_empty());
                    // Reusing the rejected cid reaches execution again (new key).
                    post_only_book(&mut h, Some(P40), Some(P60));
                    place_all(
                        &mut h,
                        START + 2,
                        &["order-1"],
                        &[post_only_order(side, ty, P50)],
                        batch,
                    );
                    assert!(kinds(&h.events()).contains(&"order_accepted"));
                }
            }
        }
    }
}

#[test]
fn post_only_checks_the_dispatch_book_after_latency() {
    // spec: 13 §5.1 (queued actions run against the post-event book);
    // postOnly.test.ts "checks the dispatch book after latency"
    for batch in [false, true] {
        for side in SIDES {
            for becomes_crossing in [true, false] {
                let mut h = Harness::compat(100);
                let (safe, crossing) = ((Some(P40), Some(P60)), (Some(P50), Some(P50)));
                let (initial, fin) = if becomes_crossing {
                    (safe, crossing)
                } else {
                    (crossing, safe)
                };
                post_only_book(&mut h, initial.0, initial.1);
                place_all(
                    &mut h,
                    START,
                    &["order-1"],
                    &[post_only_order(side, OrderType::Gtc, P50)],
                    batch,
                );
                assert!(h.events().is_empty());
                post_only_book(&mut h, fin.0, fin.1);
                h.tick(START + 99);
                assert!(h.events().is_empty());
                h.tick(START + 100);
                let evs = h.events();
                if becomes_crossing {
                    assert_eq!(kinds(&evs), ["order_rejected"]);
                    assert_eq!(evs[0].at, TsMs(START + 100));
                    assert!(h.sim.resting().is_empty());
                    h.tick(START + 101);
                    assert!(h.events().is_empty());
                    post_only_book(&mut h, safe.0, safe.1);
                    place_all(
                        &mut h,
                        START + 101,
                        &["order-1"],
                        &[post_only_order(side, OrderType::Gtc, P50)],
                        batch,
                    );
                    assert!(h.events().is_empty());
                    h.tick(START + 201);
                    assert!(kinds(&h.events()).contains(&"order_accepted"));
                } else {
                    assert_eq!(
                        kinds(&evs),
                        ["order_accepted", "settlement_update", "order_open"]
                    );
                }
            }
        }
    }
}

#[test]
fn post_only_accepts_empty_opposite_side_or_missing_book() {
    // spec: 11 §4 (an empty opposite side accepts); postOnly.test.ts
    // "accepts an empty opposing side or a missing book"
    for batch in [false, true] {
        for side in SIDES {
            for book in [true, false] {
                let mut h = Harness::compat(0);
                if book {
                    post_only_book(&mut h, None, None);
                }
                place_all(
                    &mut h,
                    START,
                    &["order-1"],
                    &[post_only_order(side, OrderType::Gtc, P50)],
                    batch,
                );
                assert!(kinds(&h.events()).contains(&"order_open"));
            }
        }
    }
}

#[test]
fn post_only_resting_order_uses_worst_queue_without_recheck() {
    // spec: 13 §5.1 WorstQueueCompat (TC-E5: strictly through, whole remainder, fee 0);
    // postOnly.test.ts "resting … uses worst_queue maker fills without rechecking post-only"
    // (the TS `touch_or_better` mode is not a ts-compat model, 13 §7.3)
    for batch in [false, true] {
        for side in SIDES {
            let mut h = Harness::compat(0);
            post_only_book(&mut h, Some(P40), Some(P60));
            let k = place_all(
                &mut h,
                START,
                &["order-1"],
                &[post_only_order(side, OrderType::Gtc, P50)],
                batch,
            )[0];
            h.events();
            post_only_book(&mut h, Some(P50), Some(P50));
            h.tick(START + 1);
            assert!(h.events().is_empty(), "touch does not fill");
            post_only_book(&mut h, Some(P60), Some(P40));
            h.tick(START + 2);
            let evs = h.events();
            assert_eq!(kinds(&evs), ["fill", "order_done"]);
            let AccountEventKind::Fill(f) = evs[0].kind else {
                unreachable!()
            };
            assert_eq!(f.liquidity, Liquidity::Maker);
            assert_eq!(f.price, Price::from_micros(P50));
            assert_eq!(f.qty, Qty::from_micros(Q10));
            assert_eq!(f.fee, Usdc::ZERO);
            assert_eq!(f.key.order, k);
            assert!(h.sim.resting().is_empty());
        }
    }
}

#[test]
fn post_only_cancellation_and_gtd_expiry() {
    // spec: 13 §5.1 cancels (TC-C5) and GTD expiry first, exactly at expire_at (TC-E5);
    // postOnly.test.ts "cancellation and GTD expiration retain existing semantics"
    for batch in [false, true] {
        for side in SIDES {
            let mut h = Harness::compat(0);
            post_only_book(&mut h, Some(P40), Some(P60));
            let first = place_all(
                &mut h,
                START,
                &["order-1"],
                &[post_only_order(side, OrderType::Gtc, P50)],
                batch,
            )[0];
            h.events();
            h.cancel(START + 1, &[first]);
            let evs = h.events();
            assert_eq!(evs.len(), 1);
            assert_eq!(evs[0].at, TsMs(START + 1));
            assert!(matches!(
                evs[0].kind,
                AccountEventKind::OrderDone {
                    order,
                    reason: DoneReason::Canceled(CancelCause::Strategy(_)),
                    filled: Some(f),
                } if order == first && f.is_zero()
            ));
            post_only_book(&mut h, Some(800_000), Some(200_000));
            h.tick(START + 2);
            assert!(h.events().is_empty());
            post_only_book(&mut h, Some(P40), Some(P60));
            let second = place_all(
                &mut h,
                START + 3,
                &["order-1"],
                &[post_only_order(side, OrderType::Gtd, P50)],
                batch,
            )[0];
            h.events();
            h.tick(EXPIRE - 1);
            assert!(h.events().is_empty());
            // Expiry wins over a potential maker fill on the expiry tick.
            post_only_book(&mut h, Some(800_000), Some(200_000));
            h.tick(EXPIRE);
            let evs = h.events();
            assert_eq!(evs.len(), 1);
            assert_eq!(
                evs[0],
                AccountEvent {
                    at: TsMs(EXPIRE),
                    kind: AccountEventKind::OrderDone {
                        order: second,
                        reason: DoneReason::Expired,
                        filled: Some(Qty::ZERO),
                    },
                }
            );
        }
    }
}

#[test]
fn ordinary_orders_without_post_only_take_liquidity() {
    // spec: 13 §5.1 taker steps 3–4 (TC-E3, TC-E4); postOnly.test.ts
    // "omitted/false flags preserve ordinary behavior" (Rust has no omitted flag)
    for batch in [false, true] {
        for side in SIDES {
            for ty in [OrderType::Gtc, OrderType::Gtd, OrderType::Fok] {
                let mut h = Harness::compat(0);
                post_only_book(&mut h, Some(P40), Some(P60));
                let price = if side == Side::Buy { 700_000 } else { 300_000 };
                let mut r = req(Outcome::Up, side, price, Q10, ty);
                if ty == OrderType::Gtd {
                    r.expire_at_ms = Some(TsMs(EXPIRE));
                }
                place_all(&mut h, START, &["order-1"], &[r], batch);
                let evs = h.events();
                assert!(!kinds(&evs).contains(&"order_rejected"));
                if ty == OrderType::Fok {
                    assert!(evs.iter().any(|e| matches!(
                        e.kind,
                        AccountEventKind::OrderDone {
                            reason: DoneReason::Killed,
                            ..
                        }
                    )));
                } else {
                    let f = evs
                        .iter()
                        .find_map(|e| match e.kind {
                            AccountEventKind::Fill(f) => Some(f),
                            _ => None,
                        })
                        .expect("taker fill");
                    assert_eq!(f.liquidity, Liquidity::Taker);
                    assert_eq!(f.qty, Qty::from_micros(Q2));
                    assert_eq!(h.sim.resting()[0].remaining, Qty::from_micros(8_000_000));
                }
            }
        }
    }
}

#[test]
fn mixed_batch_is_answered_per_order() {
    // spec: 10 N2, 13 §5.1 (per order of a Place, in batch order); postOnly.test.ts
    // "mixed batch independently accepts, rejects, and fills orders" (the
    // post-only FOK entry is an OM validation reject, 12 §7.4, and never reaches here)
    let mut h = Harness::compat(0);
    post_only_book(&mut h, Some(P40), Some(P60));
    let mut ordinary = req(Outcome::Up, Side::Buy, 700_000, Q10, OrderType::Gtc);
    ordinary.post_only = false;
    let names = [
        "safe-buy",
        "crossing-buy",
        "safe-sell",
        "crossing-sell",
        "ordinary",
    ];
    let orders = [
        post_only_order(Side::Buy, OrderType::Gtc, P50),
        post_only_order(Side::Buy, OrderType::Gtc, P60),
        post_only_order(Side::Sell, OrderType::Gtd, P50),
        post_only_order(Side::Sell, OrderType::Gtc, P40),
        ordinary,
    ];
    let keys = place_all(&mut h, START, &names, &orders, true);
    let evs = h.events();
    let rejected: Vec<_> = evs
        .iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::OrderRejected { order, .. } => order,
            _ => None,
        })
        .collect();
    assert_eq!(rejected, vec![keys[1], keys[3]]);
    let accepted: Vec<_> = evs
        .iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::OrderAccepted { order } => Some(order),
            _ => None,
        })
        .collect();
    assert_eq!(accepted, vec![keys[0], keys[2], keys[4]]);
    let resting: Vec<_> = h.sim.resting().iter().map(|o| o.key).collect();
    assert_eq!(resting, vec![keys[0], keys[2], keys[4]]);
    let fills: Vec<_> = evs
        .iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::Fill(f) => Some(f),
            _ => None,
        })
        .collect();
    assert_eq!(fills.len(), 1);
    assert_eq!(fills[0].key.order, keys[4]);
    assert_eq!(fills[0].liquidity, Liquidity::Taker);
}

#[test]
fn fill_unit_trades_and_fill_keys() {
    // spec: 13 §4.5 F-U1/F-U2 (one taker fill per level, one trade per walk, one per maker fill),
    // 10 §6 (FillKey.seq from 1 per order; TradeSeq dense from 0), 12 §9.5 (fee carried)
    let mut h = Harness::compat(0);
    h.book(
        Outcome::Up,
        &[(P40, Q2)],
        &[(550_000, 3_000_000), (P60, 4_000_000)],
    );
    let a = h.record(
        "a",
        req(Outcome::Up, Side::Buy, P60, Q10, OrderType::Gtc),
        START,
    );
    let b = h.record(
        "b",
        req(Outcome::Up, Side::Sell, 380_000, 1_000_000, OrderType::Fok),
        START,
    );
    h.place(START, &[a, b]);
    h.book(Outcome::Up, &[(P40, Q2)], &[(590_000, 1_000_000)]);
    h.tick(START + 1);
    let fills: Vec<_> = h
        .events()
        .into_iter()
        .filter_map(|e| match e.kind {
            AccountEventKind::Fill(f) => Some(f),
            _ => None,
        })
        .collect();
    let got: Vec<_> = fills
        .iter()
        .map(|f| {
            (
                f.key.order,
                f.key.seq,
                f.trade,
                f.liquidity,
                f.qty.micros(),
                f.fee.micros(),
            )
        })
        .collect();
    assert_eq!(
        got,
        vec![
            (a, 1, TradeSeq::new(0), Liquidity::Taker, 3_000_000, 52_000),
            (a, 2, TradeSeq::new(0), Liquidity::Taker, 4_000_000, 67_200),
            (b, 1, TradeSeq::new(1), Liquidity::Taker, 1_000_000, 16_800),
            (a, 3, TradeSeq::new(2), Liquidity::Maker, 3_000_000, 0),
        ]
    );
    assert!(fills.iter().all(|f| !f.late && f.exchange_ts == Some(f.at)));
}

#[test]
fn fak_kills_the_remainder_and_never_rests() {
    // spec: 13 §5.1 taker step 5 (FAK: walk, kill the remainder, never rest; no TS oracle)
    let mut h = Harness::compat(0);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let part = h.record(
        "part",
        req(Outcome::Up, Side::Buy, P60, 5_000_000, OrderType::Fak),
        START,
    );
    let full = h.record(
        "full",
        req(Outcome::Up, Side::Buy, P60, 1_000_000, OrderType::Fak),
        START,
    );
    let none = h.record(
        "none",
        req(Outcome::Up, Side::Buy, 500_000, 1_000_000, OrderType::Fak),
        START,
    );
    h.place(START, &[part, full, none]);
    assert_eq!(
        h.take_rendered(),
        [
            "1000 accepted part",
            "1000 status part MATCHED 0",
            "1000 fill part#1 TAKER 0.6 2 fee=0.0336",
            "1000 done part killed 2",
            "1000 accepted full",
            "1000 status full MATCHED 0",
            "1000 fill full#1 TAKER 0.6 1 fee=0.0168",
            "1000 done full filled 1",
            "1000 accepted none",
            "1000 status none MATCHED 0",
            "1000 done none killed 0",
        ]
    );
    assert!(h.sim.resting().is_empty());
}

#[test]
#[should_panic(expected = "ts-compat orders are share-sized")]
fn collateral_size_is_an_engine_fault_in_ts_compat() {
    // spec: 10 O3 (ts-compat sizes every order in shares), R14 (fail loud)
    let mut h = Harness::compat(0);
    h.book(Outcome::Up, &[], &[(P60, Q2)]);
    let mut r = req(Outcome::Up, Side::Buy, P60, Q2, OrderType::Fok);
    r.size = OrderSize::Collateral(Usdc::from_micros(1_000_000));
    let k = h.record("c", r, START);
    h.place(START, &[k]);
}

#[test]
fn jittered_actions_release_in_execute_at_order() {
    // spec: 13 §5.1 (one compat_jitter draw per submit, entity = submit count;
    // queued actions sorted by (execute_at, seq)), 10 RNG-7 (jitter −34, −78, −52)
    let mut cfg = ts_compat_config(100, 100);
    cfg.market_seed = market_seed(RunSeed::ZERO, super::SLUG);
    let mut h = Harness::new(cfg);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let a = h.record(
        "a",
        req(Outcome::Up, Side::Buy, 410_000, 1_000_000, OrderType::Gtc),
        START,
    );
    let b = h.record(
        "b",
        req(Outcome::Up, Side::Buy, 420_000, 1_000_000, OrderType::Gtc),
        START,
    );
    let c = h.record(
        "c",
        req(Outcome::Up, Side::Buy, 430_000, 1_000_000, OrderType::Gtc),
        START,
    );
    h.place(START, &[a]); // submit 0 → 1066
    h.place(START, &[b]); // submit 1 → 1022
    h.place(START, &[c]); // submit 2 → 1048
    assert_eq!(
        h.sim.next_due(),
        None,
        "compat latency releases at market events"
    );
    h.tick(1021);
    assert!(h.events().is_empty());
    h.tick(1048);
    assert_eq!(
        h.take_rendered(),
        [
            "1048 accepted b",
            "1048 status b MATCHED 0",
            "1048 open b",
            "1048 accepted c",
            "1048 status c MATCHED 0",
            "1048 open c",
        ]
    );
    h.tick(1066);
    assert_eq!(h.take_rendered()[0], "1066 accepted a");
    let d = h.sim.diagnostics();
    assert_eq!((d.actions_scheduled, d.actions_run), (3, 3));
}

#[test]
fn non_tick_market_events_release_nothing() {
    // spec: 13 §5.1 (queued actions run only at real ticks), 12 §5.2 (prints and tick-size changes never tick)
    let mut h = Harness::compat(10);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let k = h.record(
        "k",
        req(Outcome::Up, Side::Buy, P50, Q2, OrderType::Gtc),
        START,
    );
    h.place(START, &[k]);
    let cx = ExecCtx {
        market: &h.market,
        ledger: &h.ledger,
        config: &h.cfg,
    };
    let print = MarketEvent::LastTrade {
        outcome: Outcome::Up,
        price: Price::from_micros(P60),
        size: Qty::from_micros(Q2),
        side: None,
    };
    let tick_size = MarketEvent::TickSizeChange {
        outcome: Outcome::Up,
        tick: Price::from_micros(1_000),
    };
    h.sim
        .on_market_event(TsMs(2_000), &print, &cx, &mut h.queue);
    h.sim
        .on_market_event(TsMs(2_000), &tick_size, &cx, &mut h.queue);
    assert!(h.queue.is_empty());
    assert_eq!(h.sim.pending_actions(), 1);
}

#[test]
fn end_of_input_discards_undue_actions() {
    // spec: 13 §5.1, TC-C13 (undue actions discarded at end of stream), 12 §5.1
    let mut h = Harness::compat(100);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let k = h.record(
        "k",
        req(Outcome::Up, Side::Buy, P50, Q2, OrderType::Gtc),
        START,
    );
    h.place(START, &[k]);
    h.cancel_all(START);
    assert_eq!(h.sim.pending_actions(), 2);
    h.sim.on_end_of_input();
    assert_eq!(h.sim.pending_actions(), 0);
    assert_eq!(h.sim.next_due(), None);
    assert_eq!(h.sim.diagnostics().actions_discarded, 2);
    h.tick(5_000);
    assert!(h.events().is_empty());
    assert_eq!(h.sim.arena_len(), 0);
}

#[test]
fn idle_sessions_take_the_fast_path() {
    // spec: 13 §10, 16 CG-4 (no resting orders and no pending actions: skip the event)
    let mut h = Harness::compat(0);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    h.tick(START);
    h.tick(START + 1);
    assert_eq!(h.sim.diagnostics().fast_path_skips, 2);
    let k = h.record(
        "k",
        req(Outcome::Up, Side::Buy, P50, Q2, OrderType::Gtc),
        START,
    );
    h.place(START + 2, &[k]);
    h.tick(START + 3);
    assert_eq!(h.sim.diagnostics().fast_path_skips, 2);
}

#[test]
fn trace_records_are_built_only_when_wanted() {
    // spec: 13 §4.3 (OrderLifecycle/FillDetail stamped with the action's due time), 13 §10, 22 §2
    let mut h = Harness::compat(100);
    h.queue = EventQueue::new(true);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let k = h.record(
        "k",
        req(Outcome::Up, Side::Buy, P60, 3_000_000, OrderType::Gtd),
        START,
    );
    h.ledger.orders[k.index()].req.expire_at_ms = Some(TsMs(90_000));
    h.place(START, &[k]);
    h.tick(1_150);
    h.cancel(1_200, &[k]);
    h.tick(1_300);
    let recs: Vec<_> = h.queue.drain_trace().collect();
    let lifecycle: Vec<_> = recs
        .iter()
        .filter_map(|r| match r {
            ExecTraceRecord::Lifecycle(l) => Some((l.transition, l.at.0)),
            ExecTraceRecord::FillDetail(_) => None,
        })
        .collect();
    assert_eq!(
        lifecycle,
        vec![
            (LifecycleTransition::Scheduled, 1_100),
            (LifecycleTransition::ExchangeVisible, 1_100),
            (LifecycleTransition::Resting, 1_100),
            (LifecycleTransition::CancelEffective, 1_300),
        ]
    );
    let details: Vec<_> = recs
        .iter()
        .filter_map(|r| match r {
            ExecTraceRecord::FillDetail(d) => Some(d.fill.qty.micros()),
            ExecTraceRecord::Lifecycle(_) => None,
        })
        .collect();
    assert_eq!(details, vec![2_000_000]);
    // Untraced queues record nothing (the default sink).
    let mut q = Harness::compat(0);
    let k = q.record(
        "k",
        req(Outcome::Up, Side::Buy, P50, Q2, OrderType::Gtc),
        START,
    );
    q.place(START, &[k]);
    assert_eq!(q.queue.drain_trace().count(), 0);
}

#[test]
fn ts_compat_rejects_every_non_compat_axis_value() {
    // spec: 13 §7.3 (ts-compat requires the compat values; invalid_input otherwise), 13 §11
    // composition checks, R14
    let base = ts_compat_config(0, 0);
    assert!(Simulator::new(&base).is_ok());
    let mut variants = Vec::new();
    for &v in LatencyAxis::ALL
        .iter()
        .filter(|&&v| v != LatencyAxis::Compat)
    {
        let mut c = base.clone();
        c.models.latency = v;
        variants.push(c);
    }
    for &v in FeeAxis::ALL
        .iter()
        .filter(|&&v| v != FeeAxis::Flat700Bps4Dp)
    {
        let mut c = base.clone();
        c.models.fee = v;
        variants.push(c);
    }
    for &v in TakerDelayModel::ALL
        .iter()
        .filter(|&&v| v != TakerDelayModel::Off)
    {
        let mut c = base.clone();
        c.models.taker_delay = v;
        variants.push(c);
    }
    for &v in DepletionModel::ALL
        .iter()
        .filter(|&&v| v != DepletionModel::None)
    {
        let mut c = base.clone();
        c.models.depletion = v;
        variants.push(c);
    }
    for &v in MakerModel::ALL
        .iter()
        .filter(|&&v| v != MakerModel::WorstQueue)
    {
        let mut c = base.clone();
        c.models.maker = v;
        variants.push(c);
    }
    for &v in ReportsModel::ALL
        .iter()
        .filter(|&&v| v != ReportsModel::Compat)
    {
        let mut c = base.clone();
        c.models.reports = v;
        variants.push(c);
    }
    assert_eq!(variants.len(), 8);
    for c in variants {
        let err = Simulator::new(&c).expect_err("non-compat axis value");
        assert!(
            err.message.starts_with("execution.models"),
            "{}",
            err.message
        );
    }
}

#[test]
fn realistic_composition_is_refused_until_m3b() {
    // spec: D57 (realistic models land in M3b), R14 (no silent fallback)
    let mut c = ts_compat_config(0, 0);
    c.core_rules = CoreRules::Realistic;
    let err = Simulator::new(&c).expect_err("realistic is M3b");
    assert!(err.message.contains("M3b"), "{}", err.message);
}

#[test]
fn parity_runs_require_zero_jitter() {
    // spec: 13 §5.5 (jitter 0; TS jitter is unseeded), 13 §5.4
    assert!(Simulator::check_parity_run(&ts_compat_config(140, 0)).is_ok());
    let err = Simulator::check_parity_run(&ts_compat_config(140, 5)).expect_err("jitter");
    assert!(err.message.contains("jitterMs"), "{}", err.message);
    let mut c = ts_compat_config(0, 0);
    c.core_rules = CoreRules::Realistic;
    assert!(Simulator::check_parity_run(&c).is_err());
}

#[test]
fn key_arena_stays_bounded_under_continuous_latency() {
    // spec: 13 X1, §10 (no steady-state growth: reused heap and key storage)
    let mut h = Harness::compat(100);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let mut max_arena = 0;
    for i in 0..20_000i64 {
        let t = START + i * 10;
        let k = h.record(
            "x",
            req(Outcome::Up, Side::Buy, 100_000, 1_000_000, OrderType::Gtc),
            t,
        );
        h.place(t, &[k]);
        h.cancel(t, &[k]);
        h.tick(t);
        h.events();
        max_arena = max_arena.max(h.sim.arena_len());
    }
    assert!(h.sim.pending_actions() > 0, "the scheduler never empties");
    assert!(max_arena <= 2 * 64 + 1_024 + 2, "arena grew to {max_arena}");
}

/// A deterministic draw source for generated streams (10 RNG-5; no wall
/// clock, no global RNG).
struct Draws {
    stream: StreamSeed,
    i: u32,
}

impl Draws {
    fn below(&mut self, n: u64) -> u64 {
        let r = EntityRng::new(self.stream, Entity::packed(EntityKind::InputRow, self.i));
        self.i += 1;
        r.uniform_below(n)
    }
}

fn random_book(d: &mut Draws, h: &mut Harness, o: Outcome) {
    let mid = 200_000 + 10_000 * d.below(60) as i64;
    let bids: Vec<_> = (0..d.below(4))
        .map(|j| {
            (
                mid - 10_000 * (j as i64 + 1),
                1_000_000 * (1 + d.below(5) as i64),
            )
        })
        .collect();
    let asks: Vec<_> = (0..d.below(4))
        .map(|j| (mid + 10_000 * j as i64, 1_000_000 * (1 + d.below(5) as i64)))
        .collect();
    h.book(o, &bids, &asks);
}

#[test]
fn generated_streams_keep_contract_invariants() {
    // spec: 13 X3 (events name their key; fills carry a fee), X4/R7 (byte-identical re-run),
    // X7 (exactly one terminal event per key), 10 S2 (filled ≤ size), 10 §6 (FillKey.seq
    // strictly increasing per order)
    let (mut fills, mut cancels, mut makers) = (0, 0, 0);
    for seed in 0..40u64 {
        let run = |seed: u64| {
            let mut d = Draws {
                stream: StreamSeed(seed),
                i: 0,
            };
            let mut h = Harness::compat((d.below(3) * 50) as u32);
            let mut all = Vec::new();
            for step in 0..300i64 {
                let t = START + step * 7;
                match d.below(8) {
                    0..=2 => {
                        let o = if d.below(2) == 0 {
                            Outcome::Up
                        } else {
                            Outcome::Down
                        };
                        random_book(&mut d, &mut h, o);
                        h.tick(t);
                    }
                    3..=5 => {
                        let n = 1 + d.below(3);
                        let mut keys = Vec::new();
                        for _ in 0..n {
                            let o = if d.below(2) == 0 {
                                Outcome::Up
                            } else {
                                Outcome::Down
                            };
                            let side = if d.below(2) == 0 {
                                Side::Buy
                            } else {
                                Side::Sell
                            };
                            let ty = [
                                OrderType::Gtc,
                                OrderType::Gtd,
                                OrderType::Fok,
                                OrderType::Fak,
                            ][d.below(4) as usize];
                            let mut r = req(
                                o,
                                side,
                                100_000 + 10_000 * d.below(80) as i64,
                                1_000_000 * (1 + d.below(6) as i64),
                                ty,
                            );
                            r.post_only = ty.is_resting() && d.below(3) == 0;
                            if ty == OrderType::Gtd {
                                r.expire_at_ms = Some(TsMs(t + 60_000 + 7 * d.below(50) as i64));
                            }
                            keys.push(h.record("g", r, t));
                        }
                        h.place(t, &keys);
                    }
                    6 => {
                        let n = h.ledger.orders.len() as u64;
                        if n > 0 {
                            let k = OrderKey::new(d.below(n) as u32);
                            h.cancel(t, &[k]);
                        }
                    }
                    _ => match d.below(3) {
                        0 => h.cancel_all(t),
                        1 => h.cancel_scope(t, CancelScope::Outcome(Outcome::Up)),
                        _ => h.cancel_scope(t, CancelScope::Market),
                    },
                }
                all.extend(h.events());
            }
            h.sim.on_end_of_input();
            (all, h.ledger.orders.len())
        };
        let (events, n_orders) = run(seed);
        assert_eq!(events, run(seed).0, "re-run differs (seed {seed})");
        let mut terminal = vec![false; n_orders];
        let mut filled = vec![0i64; n_orders];
        let mut last_seq = vec![0u32; n_orders];
        for e in &events {
            let k = e
                .kind
                .order()
                .expect("every simulator event names its order (X3)");
            // After the terminal event only the compat FOK `Confirmed` status
            // may follow (13 §5.1 taker step 3); never a second terminal (X7).
            if terminal[k.index()] {
                assert!(
                    matches!(e.kind, AccountEventKind::SettlementUpdate { .. }),
                    "{:?} after the terminal event of {k:?} (seed {seed})",
                    e.kind
                );
            }
            match e.kind {
                AccountEventKind::Fill(f) => {
                    fills += 1;
                    makers += usize::from(f.liquidity == Liquidity::Maker);
                }
                AccountEventKind::OrderDone {
                    reason: DoneReason::Canceled(_),
                    ..
                } => cancels += 1,
                _ => {}
            }
            if let AccountEventKind::Fill(f) = e.kind {
                assert!(f.key.seq > last_seq[k.index()]);
                last_seq[k.index()] = f.key.seq;
                filled[k.index()] += f.qty.micros();
                assert!(!f.fee.is_negative());
            }
            if let AccountEventKind::OrderDone {
                filled: Some(q), ..
            } = e.kind
            {
                assert_eq!(
                    q.micros(),
                    filled[k.index()],
                    "OrderDone carries the filled quantity (10 S3)"
                );
            }
            if e.kind.is_terminal() {
                terminal[k.index()] = true;
            }
        }
    }
    // The generated streams exercise taker and maker fills and cancels.
    assert!(
        fills > 100 && makers > 10 && cancels > 10,
        "{fills} {makers} {cancels}"
    );
}

#[test]
fn early_exit_matches_the_full_maker_scan() {
    // spec: 13 §5.1 (an early exit is allowed when the emitted events are identical), 13 §10
    let cfg = ts_compat_config(0, 0);
    let models = Models::ts_compat(&cfg);
    for seed in 0..300u64 {
        let mut d = Draws {
            stream: StreamSeed(seed ^ 0x5eed),
            i: 0,
        };
        let mut h = Harness::compat(0);
        h.market = ts_compat_market();
        for o in Outcome::ALL {
            if d.below(4) > 0 {
                random_book(&mut d, &mut h, o);
            }
        }
        let mut truth = ExchangeTruth::default();
        for k in 0..d.below(5) as u32 {
            let size = Qty::from_micros(1_000_000 * (1 + d.below(5) as i64));
            truth.resting.push(RestingOrder {
                key: OrderKey::new(k),
                outcome: if d.below(2) == 0 {
                    Outcome::Up
                } else {
                    Outcome::Down
                },
                side: if d.below(2) == 0 {
                    Side::Buy
                } else {
                    Side::Sell
                },
                price: Price::from_micros(100_000 + 10_000 * d.below(80) as i64),
                size,
                remaining: size,
                expire_at: (d.below(3) == 0).then(|| TsMs(START + d.below(3) as i64 - 1)),
                fill_seq: 0,
            });
        }
        let cx = ExecCtx {
            market: &h.market,
            ledger: &h.ledger,
            config: &cfg,
        };
        let (mut a, mut b) = (truth.clone(), truth);
        let (mut qa, mut qb) = (EventQueue::new(true), EventQueue::new(true));
        compat::maker_scan(&models, &mut a, &cx, TsMs(START), &mut qa);
        compat::maker_scan_full(&models, &mut b, &cx, TsMs(START), &mut qb);
        let ea: Vec<_> = std::iter::from_fn(|| qa.pop()).collect();
        let eb: Vec<_> = std::iter::from_fn(|| qb.pop()).collect();
        assert_eq!(ea, eb, "seed {seed}");
        assert_eq!(a.resting.as_slice(), b.resting.as_slice());
    }
}

#[test]
fn no_exchange_validation_taker_delay_or_market_close() {
    // spec: 13 TC-E10 (no taker delay, no arrival re-validation, no market-closed
    // rejection), 11 §4 (tick, bounds, minimum size and precision not validated)
    let mut h = Harness::compat(0);
    let end = h.market.window().end_ms.0;
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    // Off-tick price, sub-minimum size, after the window end, marketable.
    let k = h.record(
        "k",
        req(Outcome::Up, Side::Buy, 605_500, 1_234, OrderType::Gtc),
        end + 5_000,
    );
    h.place(end + 5_000, &[k]);
    assert_eq!(
        h.take_rendered(),
        [
            "1780272905000 accepted k",
            "1780272905000 status k MATCHED 0",
            "1780272905000 fill k#1 TAKER 0.6 0.001234 fee=0",
            "1780272905000 done k filled 0.001234",
        ]
    );
}

#[test]
fn batches_have_no_cap_in_the_simulator() {
    // spec: 13 TC-C12, 11 §4 (no batch cap in the simulator; the OM owns caps)
    let mut h = Harness::compat(0);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let keys: Vec<_> = (0..40)
        .map(|i| {
            h.record(
                "b",
                req(
                    Outcome::Up,
                    Side::Buy,
                    100_000 + i * 1_000,
                    1_000_000,
                    OrderType::Gtc,
                ),
                START,
            )
        })
        .collect();
    h.place(START, &keys);
    assert_eq!(h.sim.resting().len(), 40);
    let opens = h
        .events()
        .iter()
        .filter(|e| matches!(e.kind, AccountEventKind::OrderOpen { .. }))
        .count();
    assert_eq!(opens, 40);
}

#[test]
fn own_orders_never_match_each_other() {
    // spec: 13 TC-C14 (no self-cross check: own orders are never in the TS book, the walk
    // and the maker rule see recorded levels only), 13 §4.2
    let mut h = Harness::compat(0);
    h.book(Outcome::Up, &[(300_000, Q2)], &[(700_000, Q2)]);
    let sell = h.record(
        "s",
        req(Outcome::Up, Side::Sell, P50, Q2, OrderType::Gtc),
        START,
    );
    let buy = h.record(
        "b",
        req(Outcome::Up, Side::Buy, P60, Q2, OrderType::Gtc),
        START,
    );
    h.place(START, &[sell, buy]);
    h.tick(START + 1);
    let evs = h.events();
    assert!(!evs
        .iter()
        .any(|e| matches!(e.kind, AccountEventKind::Fill(_))));
    assert_eq!(h.sim.resting().len(), 2);
}

#[test]
fn compat_never_reports_due_times_or_timer_work() {
    // spec: 13 §5.1 (next_due() returns None; queued actions only at market events),
    // 13 §2.3 (Journaled timers are not a ts-compat mode, D28)
    let mut h = Harness::compat(50);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    let k = h.record(
        "k",
        req(Outcome::Up, Side::Buy, P50, Q2, OrderType::Gtc),
        START,
    );
    h.place(START, &[k]);
    assert_eq!(h.sim.next_due(), None);
    let cx = ExecCtx {
        market: &h.market,
        ledger: &h.ledger,
        config: &h.cfg,
    };
    h.sim.run_next_due(&cx, &mut h.queue);
    assert!(h.queue.is_empty());
    assert_eq!(h.sim.pending_actions(), 1);
    assert_eq!(
        h.sim.mode(),
        super::super::scheduler::SchedulerMode::SelfTimed
    );
}

/// Measures the maker scan with and without the early exit on a quiet
/// book (13 §10: the early exit is measured; 13 §5.1: identical events,
/// checked by `early_exit_matches_the_full_maker_scan`). Run with
/// `cargo test --release -p pmb-engine -- --ignored maker_scan_early_exit_speed --nocapture`.
#[test]
#[ignore = "timing measurement, run on demand"]
fn maker_scan_early_exit_speed() {
    let cfg = ts_compat_config(0, 0);
    let models = Models::ts_compat(&cfg);
    let mut h = Harness::compat(0);
    h.book(Outcome::Up, &[(P40, Q2)], &[(P60, Q2)]);
    h.book(Outcome::Down, &[(P40, Q2)], &[(P60, Q2)]);
    let mut truth = ExchangeTruth::default();
    for k in 0..4u32 {
        let size = Qty::from_micros(Q10);
        truth.resting.push(RestingOrder {
            key: OrderKey::new(k),
            outcome: if k % 2 == 0 {
                Outcome::Up
            } else {
                Outcome::Down
            },
            side: if k < 2 { Side::Buy } else { Side::Sell },
            price: Price::from_micros(if k < 2 { 450_000 } else { 650_000 }),
            size,
            remaining: size,
            expire_at: None,
            fill_seq: 0,
        });
    }
    let cx = ExecCtx {
        market: &h.market,
        ledger: &h.ledger,
        config: &cfg,
    };
    let mut q = EventQueue::new(false);
    let n = 2_000_000;
    let t0 = std::time::Instant::now();
    for i in 0..n {
        compat::maker_scan(&models, &mut truth, &cx, TsMs(START + i), &mut q);
    }
    let fast = t0.elapsed();
    let t1 = std::time::Instant::now();
    for i in 0..n {
        compat::maker_scan_full(&models, &mut truth, &cx, TsMs(START + i), &mut q);
    }
    let full = t1.elapsed();
    assert!(q.is_empty());
    println!(
        "maker scan, 4 resting orders, quiet book: early exit {:.1} ns/tick, full scan {:.1} ns/tick",
        fast.as_nanos() as f64 / n as f64,
        full.as_nanos() as f64 / n as f64
    );
}
