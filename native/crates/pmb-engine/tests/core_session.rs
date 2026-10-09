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
fn kill_switch_cancels_everything_and_rejects_new_placements() {
    // spec: 12 §8.3 (KillSwitch rejections, engine-originated CancelAll,
    // halt), §7.2 step 1
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
    h.send(vec![Cmd::Place(Ord::buy("b", 10.0, 0.5))], 10, BIDS, ASKS)
        .unwrap();
    assert_eq!(h.rejections(), vec!["kill_switch"]);
    // A guard trip has the same effect (12 §8.3).
    let mut g = H::new(
        config(CoreRules::Realistic),
        MockExec::sync(),
        Script::default(),
    );
    g.control(0, Control::Guard(GuardTrip::RejectBurst))
        .unwrap();
    g.send(vec![Cmd::Place(Ord::buy("b", 10.0, 0.5))], 10, BIDS, ASKS)
        .unwrap();
    assert_eq!(g.rejections(), vec!["kill_switch"]);
}

#[test]
fn operator_cancel_order_targets_the_current_generation() {
    // spec: 12 §3.2 Operator(cancel_order{cid}), §8.3 (engine-originated
    // cancels carry their cause)
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
                    "min={} ask={:?} warmed={} cash={} slug={}",
                    ctx.rules().min_order_size(),
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
        let min = match rules {
            CoreRules::TsCompat => "0",
            CoreRules::Realistic => "5",
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
