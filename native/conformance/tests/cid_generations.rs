// spec: 10 §6 (OrderKey, CancelOp, FillKey), 10 S4, 12 §7.1, 12 §7.3, 13 §5.1 Cancels, 13 §5.4, 30 §5.2, 60 §5.10
//
// G2 row "cid generations". Keys are read from the trace event records
// (`"order": k`, the engine key the testkit renders) zipped with the
// strategy's own callback order (22 §3.3: each event record is written just
// before its callback), and from the FillView carried by Fill events.

mod common;

use common::*;
use pmb_conformance::vectors::{self, rows};
use pmb_sdk::prelude::*;
use serde_json::Value;

fn file() -> Value {
    vectors::load("cid_generations")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} missing"))
}

#[test]
fn vectors_well_formed() {
    let f = file();
    vectors::assert_well_formed(&f);
    for r in rows(&f) {
        assert!(r.get("expect").is_some(), "{}", vectors::id(r));
    }
}

// spec: 10 §6 — FillKey.seq starts at 1 per order; TradeSeq dense from 0
#[test]
fn fill_key_and_trade_seq_shape() {
    let r = row("cg-08-fill-key-per-generation");
    let keys = r["expect"]["fill_keys"].as_array().unwrap();
    assert_eq!(keys[0]["order"], 0);
    assert_eq!(keys[0]["seq"], 1);
    assert_eq!(keys[1]["order"], 1);
    assert_eq!(keys[1]["seq"], 1);
    let trades: Vec<i64> = r["expect"]["trade_seqs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    assert_eq!(trades, [0, 1]);
}

type TickFn = Box<dyn FnMut(&Ctx, &mut Intents, &mut Recorder) + Send>;
type EventFn = Box<dyn FnMut(&Ctx, &AccountEvent, &mut Intents, &mut Recorder) + Send>;

struct Cg {
    rec: Recorder,
    tick: TickFn,
    event: EventFn,
}

impl Cg {
    fn ticks(tick: impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static) -> Cg {
        Cg {
            rec: Recorder::default(),
            tick: Box::new(tick),
            event: Box::new(|_, _, _, _| {}),
        }
    }
}

impl Script for Cg {
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) {
        self.rec.tick(ctx);
        (self.tick)(ctx, out, &mut self.rec);
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, out: &mut Intents) {
        self.rec.event(ctx, ev);
        (self.event)(ctx, ev, out, &mut self.rec);
    }
}

/// `(cid, key)` of every OrderSubmitted, zipping callbacks with trace records.
fn submissions(run: &pmb_sdk::testkit::TestRun, rec: &Recorder) -> Vec<(String, i64)> {
    let cids: Vec<String> = rec
        .seen
        .iter()
        .filter(|e| e.kind == "order_submitted")
        .map(|e| e.cid.clone().unwrap())
        .collect();
    let keys: Vec<i64> = events_of(run, "order_submitted")
        .iter()
        .map(|e| e["order"].as_i64().unwrap())
        .collect();
    assert_eq!(cids.len(), keys.len());
    cids.into_iter().zip(keys).collect()
}

/// The cited TS scenario's book: bid 0.4 / ask 0.6; a later ask 0.4 fills the resting 0.5 BUY.
fn ts_market() -> pmb_sdk::testkit::TestMarket {
    let mut m = market();
    m.book(
        t(1000),
        Outcome::Up,
        &[(price!(0.4), qty!(100))],
        &[(price!(0.6), qty!(100))],
    );
    m
}

// spec: 10 §6 OrderKey (dense from 0; engine rejects consume no key), 12 §9.2, D61
#[test]
fn cg01_dense_keys() {
    let r = row("cg-01-dense-keys");
    assert_eq!(r["expect"]["keys"]["a"], 0);
    assert_eq!(r["expect"]["keys"]["c"], 1);
    let m = ts_market();
    let (run, s) = run(
        &m,
        Cg::ticks(|ctx, out, _| {
            if ctx.tick().seq == 0 {
                out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("a")));
                out.place(Order::buy(Outcome::Up, price!(0.5), Qty::ZERO).cid(cid!("b")));
                out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("c")));
            }
        }),
    );
    assert_eq!(
        submissions(&run, &s.rec),
        [("a".to_string(), 0), ("c".to_string(), 1)]
    );
    let b = s
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "order_rejected")
        .unwrap();
    assert!(
        b.debug.contains("order: None") && b.debug.contains("InvalidSize"),
        "{}",
        b.debug
    );
    // The simulator exchange id is `sim-{key}` (D61: opaque to the strategy, but it is rendered).
    let acc = s
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "order_accepted" && e.cid.as_deref() == Some("c"))
        .unwrap();
    assert!(
        acc.debug.contains("exchange_id: Some(Sim(OrderKey(1)))"),
        "{}",
        acc.debug
    );
}

// spec: 10 S4, 12 §7.1; cancellation.test.ts 'client ID reuse creates distinct exchange identities …'
#[test]
fn cg02_reuse_after_fill() {
    let r = row("cg-02-reuse-after-fill-two-generations");
    assert_eq!(r["expect"]["generations"], 2);
    let mut m = ts_market();
    m.price_change(t(1100), Outcome::Up, Side::Sell, price!(0.4), qty!(100));
    m.price_change(t(1200), Outcome::Up, Side::Sell, price!(0.4), Qty::ZERO);
    m.price_change(t(1300), Outcome::Up, Side::Sell, price!(0.4), qty!(100));
    let mut script = Cg::ticks(|ctx, out, _| {
        if ctx.now() == t(1000) || ctx.now() == t(1200) {
            out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("buy-up")));
        }
    });
    // orders() inside every callback: generation 2's OrderOpen must show "Filled,Live"
    // (the tick at t=1300 fills generation 2 before its own on_tick, D69).
    script.event = Box::new(|ctx, ev, _, rec| {
        let p = ctx.portfolio();
        let all: Vec<String> = p
            .orders()
            .map(|o| format!("{}:{:?}", p.cid_str(o), o.state()))
            .collect();
        rec.ticks.push((
            90,
            ctx.now().0,
            format!("{}={}", ev.ts_kind(), all.join(",")),
        ));
    });
    let (run, s) = run(&m, script);
    assert_eq!(
        submissions(&run, &s.rec),
        [("buy-up".to_string(), 0), ("buy-up".to_string(), 1)]
    );
    let fills: Vec<&Seen> = s.rec.seen.iter().filter(|e| e.kind == "fill").collect();
    assert_eq!(fills.len(), 2);
    assert_eq!(fills[1].pos_up, 20_000_000);
    assert!(
        s.rec.ticks.iter().any(|(k, ts, v)| *k == 90
            && *ts == t(1200).0
            && v == "order_open=buy-up:Filled,buy-up:Live"),
        "{:?}",
        s.rec.ticks
    );
    let last = s
        .rec
        .ticks
        .iter()
        .filter(|(k, _, _)| *k == 90)
        .last()
        .unwrap();
    assert_eq!(last.2, "order_done=buy-up:Filled,buy-up:Filled");
    assert_eq!(
        events_of(&run, "fill")[1]["order"],
        1,
        "the second fill belongs to generation 2's key"
    );
}

// spec: 13 §5.1 Cancels, 12 §7.1 — delayed cancel bound to the old generation
#[test]
#[ignore = "C2-gap: the testkit has no ModelConfig override (compatLatency.delayMs 100 needed); D71 also drops delay > 0 from parity"]
fn cg03_delayed_cancel_old_generation() {
    let _ = row("cg-03-delayed-cancel-bound-to-old-generation");
    todo!("needs compatLatency.delayMs = 100");
}

// spec: 12 §7.1, 13 §6.6 (realistic: CancelFailed(ExchangeNotCanceled) for the old key)
#[test]
#[ignore = "C4 (G3): realistic-only; the engine refuses Profile::Realistic until M3b (D57)"]
fn cg04_realistic_in_flight_cancel() {
    let _ = row("cg-04-realistic-in-flight-cancel-old-generation");
    todo!("G3");
}

// spec: 12 §7.1 (cid -> current OrderKey), 12 §7.3
#[test]
fn cg05_cancel_targets_current() {
    let _ = row("cg-05-cancel-targets-current-generation");
    let mut m = ts_market();
    m.price_change(t(1100), Outcome::Up, Side::Sell, price!(0.4), qty!(100));
    m.price_change(t(1200), Outcome::Up, Side::Sell, price!(0.4), Qty::ZERO);
    m.price_change(t(1300), Outcome::Up, Side::Buy, price!(0.4), qty!(90));
    let (run, s) = run(
        &m,
        Cg::ticks(|ctx, out, rec| {
            if ctx.now() == t(1000) || ctx.now() == t(1200) {
                out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("x")));
            }
            if ctx.now() == t(1300) {
                out.cancel(&cid!("x"));
                let p = ctx.portfolio();
                let all: Vec<String> = p.orders().map(|o| format!("{:?}", o.state())).collect();
                rec.ticks.push((90, 0, all.join(",")));
            }
        }),
    );
    let done = events_of(&run, "order_done");
    assert_eq!(done.len(), 2);
    assert_eq!(
        (done[0]["order"].as_i64(), done[0]["reason"].as_str()),
        (Some(0), Some("filled"))
    );
    assert_eq!(
        (done[1]["order"].as_i64(), done[1]["reason"].as_str()),
        (Some(1), Some("canceled")),
        "generation 2 is canceled"
    );
    let last = s.rec.seen.last().unwrap();
    assert!(last.state.as_deref().unwrap().starts_with("Canceled"));
    assert_eq!(
        s.rec.ticks.iter().find(|(k, _, _)| *k == 90).unwrap().2,
        "Filled,Live",
        "generation 1 unchanged"
    );
}

// spec: 12 §7.3 (known terminal -> skipped silently), 60 §5.3 x6
#[test]
fn cg06_cancel_known_terminal() {
    let r = row("cg-06-cancel-known-terminal-silent");
    assert_eq!(r["expect"]["ts_compat"], "no event");
    let mut m = ts_market();
    m.price_change(t(1100), Outcome::Up, Side::Sell, price!(0.6), qty!(90));
    let (run, s) = run(
        &m,
        Cg::ticks(|ctx, out, _| {
            if ctx.now() == t(1000) {
                out.place(
                    Order::buy(Outcome::Up, price!(0.55), qty!(10))
                        .fok()
                        .cid(cid!("x6")),
                );
            }
            if ctx.now() == t(1100) {
                out.cancel(&cid!("x6"));
            }
        }),
    );
    let x6 = s.rec.of("x6");
    assert!(x6.last().unwrap().debug.contains("reason: Killed"));
    let after: Vec<&Value> = run.records("event").filter(|e| e["seq"] == 1).collect();
    assert!(
        after.is_empty(),
        "no event for a cancel of a known terminal order: {after:?}"
    );
    assert!(!s.rec.seen.iter().any(|e| e.kind == "cancel_failed"));
}

// spec: 12 §7.3 (unknown cid -> CancelFailed(UnknownClientOrder)); D71 (TC-C5/TC-C10 not reproduced: the realistic rule in every profile)
#[test]
#[ignore = "C2-fail: 12 §7.3 + D71, cancel_order of a never-placed cid: observed no event at all; expected CancelFailed(UnknownClientOrder) (TS string unknown_client_order)"]
fn cg07_cancel_never_placed() {
    let r = row("cg-07-cancel-never-placed");
    assert!(r["expect"]["realistic"]
        .as_str()
        .unwrap()
        .contains("UnknownClientOrder"));
    let m = ts_market();
    let (run, s) = run(
        &m,
        Cg::ticks(|ctx, out, _| {
            if ctx.now() == t(1000) {
                out.cancel(&cid!("x-never"));
            }
        }),
    );
    let failed: Vec<&Seen> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.kind == "cancel_failed")
        .collect();
    assert_eq!(failed.len(), 1, "observed callbacks: {:?}", s.rec.tags());
    assert!(
        failed[0].debug.contains("UnknownClientOrder"),
        "{}",
        failed[0].debug
    );
    assert_eq!(
        events_of(&run, "cancel_failed")[0]["reason"],
        "unknown_client_order"
    );
}

// spec: 10 §6 FillKey/TradeSeq — per generation, read from the FillView of cg-02
#[test]
fn cg08_fill_keys() {
    let _ = row("cg-08-fill-key-per-generation");
    let mut m = ts_market();
    m.price_change(t(1100), Outcome::Up, Side::Sell, price!(0.4), qty!(100));
    m.price_change(t(1200), Outcome::Up, Side::Sell, price!(0.4), Qty::ZERO);
    m.price_change(t(1300), Outcome::Up, Side::Sell, price!(0.4), qty!(100));
    let (_run, s) = run(
        &m,
        Cg::ticks(|ctx, out, _| {
            if ctx.now() == t(1000) || ctx.now() == t(1200) {
                out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("buy-up")));
            }
        }),
    );
    let fills: Vec<&Seen> = s.rec.seen.iter().filter(|e| e.kind == "fill").collect();
    assert_eq!(fills.len(), 2);
    assert!(
        fills[0]
            .debug
            .contains("key: FillKey { order: OrderKey(0), seq: 1 }, trade: TradeSeq(0)"),
        "{}",
        fills[0].debug
    );
    assert!(
        fills[1]
            .debug
            .contains("key: FillKey { order: OrderKey(1), seq: 1 }, trade: TradeSeq(1)"),
        "{}",
        fills[1].debug
    );
}

// spec: 12 §7.1, 10 §8.2 row 21 (live late fill)
#[test]
#[ignore = "C4 (G4): live-only (user-WS mapping, 50 §8.2)"]
fn cg09_late_fill_old_generation() {
    let _ = row("cg-09-late-fill-old-generation-live");
    todo!("G4");
}
// spec: 12 §7.1 (old events cannot change a replacement; live)
#[test]
#[ignore = "C4 (G4): live-only"]
fn cg10_old_events_cannot_change_replacement() {
    let _ = row("cg-10-old-events-cannot-change-replacement-live");
    todo!("G4");
}
// spec: 10 S5, 10 I3 (fill before ack, WS/REST dedupe; live)
#[test]
#[ignore = "C4 (G4): live-only"]
fn cg11_fill_before_ack() {
    let _ = row("cg-11-fill-before-ack-live");
    todo!("G4");
}

// spec: 10 §6 (session scope), 12 §10 — keys restart at 0 per session
#[test]
fn cg12_keys_session_scoped() {
    let _ = row("cg-12-generation-keys-are-session-scoped");
    let place = |ctx: &Ctx, out: &mut Intents, _: &mut Recorder| {
        if ctx.tick().seq == 0 {
            out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("x")));
        }
    };
    let m1 = ts_market();
    let mut m2 = pmb_sdk::testkit::TestMarket::btc_15m(TsMs(START.0 + 900_000))
        .profile(pmb_sdk::testkit::Profile::TsCompat);
    m2.book(
        TsMs(START.0 + 900_000 + 1000),
        Outcome::Up,
        &[(price!(0.4), qty!(100))],
        &[(price!(0.6), qty!(100))],
    );
    let (r1, s1) = run(&m1, Cg::ticks(place));
    let (r2, s2) = run(&m2, Cg::ticks(place));
    assert_eq!(submissions(&r1, &s1.rec), [("x".to_string(), 0)]);
    assert_eq!(
        submissions(&r2, &s2.rec),
        [("x".to_string(), 0)],
        "each session's x is generation 1 with OrderKey 0"
    );
}
