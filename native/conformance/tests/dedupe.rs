// spec: 12 §7.6, 12 §7.2, 10 N5, 10 §10.2, 21 §10, 30 §7.1, 60 §5.5 (x10)
//
// G2 row "dedupe (12 §7.6)". The observable part of the rule — no event, no
// record, one submission per active cid, release on terminal delivery — is
// asserted through callbacks and trace records. The diagnostics counter
// `duplicate_active_cid` (21 §10) is not exposed by the testkit (C2-gap).

mod common;

use common::*;
use pmb_conformance::vectors::{self, rows};
use pmb_sdk::prelude::*;
use serde_json::Value;

fn file() -> Value {
    vectors::load("dedupe")
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
        assert!(
            r.get("script").is_some() || vectors::id(r) == "dd-14-counter-is-not-a-reason",
            "{}",
            vectors::id(r)
        );
    }
}

// spec: 10 N5, 21 §17 — duplicate_active_cid is a counter key, never a reject reason
#[test]
fn counter_is_not_a_reject_reason() {
    let voc = vectors::load("vocabularies");
    let reasons = rows(&voc)
        .iter()
        .find(|r| vectors::id(r) == "voc-reject-reason-engine")
        .unwrap();
    let names: Vec<&str> = reasons["values"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v["ts_string"].as_str())
        .collect();
    assert!(!names.contains(&"duplicate_active_cid"));
    let not_reason = reasons["not_a_reason"].as_array().unwrap();
    assert!(not_reason.iter().any(|v| v == "duplicate_active_cid"));
    let dd = row("dd-14-counter-is-not-a-reason");
    assert_eq!(
        dd["expect"]["reject_reason_vocabulary_excludes"],
        "duplicate_active_cid"
    );
}

type TickFn = Box<dyn FnMut(&Ctx, &mut Intents, &mut Recorder) + Send>;
type EventFn = Box<dyn FnMut(&Ctx, &AccountEvent, &mut Intents, &mut Recorder) + Send>;

struct Dd {
    rec: Recorder,
    tick: TickFn,
    event: EventFn,
}

impl Dd {
    fn ticks(tick: impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static) -> Dd {
        Dd {
            rec: Recorder::default(),
            tick: Box::new(tick),
            event: Box::new(|_, _, _, _| {}),
        }
    }
}

impl Script for Dd {
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) {
        self.rec.tick(ctx);
        (self.tick)(ctx, out, &mut self.rec);
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, out: &mut Intents) {
        self.rec.event(ctx, ev);
        (self.event)(ctx, ev, out, &mut self.rec);
    }
}

/// UP book bid 0.4 / ask 0.6 at t(1000) plus `n` further price-change ticks.
fn market_with_ticks(n: usize) -> pmb_sdk::testkit::TestMarket {
    let mut m = market();
    m.book(
        t(1000),
        Outcome::Up,
        &[(price!(0.4), qty!(100))],
        &[(price!(0.6), qty!(100))],
    );
    for i in 0..n {
        m.price_change(
            t(2000 + 1000 * i as i64),
            Outcome::Up,
            Side::Buy,
            price!(0.4),
            qty!(90),
        );
    }
    m
}

fn resting_x() -> LimitOrder {
    Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("x"))
}

fn count(rec: &Recorder, kind: &str, cid: &str) -> usize {
    rec.of(cid).iter().filter(|e| e.kind == kind).count()
}

// spec: 12 §7.6 (same-list duplicate dropped, counted)
#[test]
fn dd01_same_list_duplicate() {
    let r = row("dd-01-same-list-duplicate");
    assert_eq!(r["expect"]["order_submitted_count_for_x"], 1);
    let m = market_with_ticks(0);
    let (run, s) = run(
        &m,
        Dd::ticks(|_, out, _| {
            out.place(resting_x());
            out.place(resting_x());
        }),
    );
    assert_eq!(count(&s.rec, "order_submitted", "x"), 1);
    assert_eq!(
        s.rec
            .seen
            .iter()
            .filter(|e| e.kind == "order_rejected")
            .count(),
        0
    );
    assert_eq!(
        run.records("intent").count(),
        2,
        "both intents are traced (22 §3.3)"
    );
    assert_eq!(events_of(&run, "order_submitted").len(), 1);
}

// spec: 12 §7.6 (re-sent every tick)
#[test]
fn dd02_across_ticks() {
    let r = row("dd-02-across-ticks-while-active");
    assert_eq!(r["expect"]["duplicate_active_cid"], 4);
    let m = market_with_ticks(4);
    let (run, s) = run(&m, Dd::ticks(|_, out, _| out.place(resting_x())));
    assert_eq!(s.rec.ticks.len(), 5);
    assert_eq!(count(&s.rec, "order_submitted", "x"), 1);
    assert!(!s.rec.seen.iter().any(|e| e.kind == "order_rejected"));
    assert_eq!(run.records("intent").count(), 5);
    assert_eq!(
        run.records("event").count(),
        4,
        "only the first placement produces events"
    );
}

// spec: 12 §7.6 rule 2, 10 S4, 12 §7.1
#[test]
fn dd03_reuse_after_terminal() {
    let r = row("dd-03-reuse-after-terminal");
    assert_eq!(r["expect"]["generations"], 2);
    let m = market_with_ticks(2);
    let (run, s) = run(
        &m,
        Dd::ticks(|ctx, out, rec| match ctx.tick().seq {
            0 => out.place(resting_x()),
            1 => out.cancel(&cid!("x")),
            2 => {
                out.place(resting_x());
                let p = ctx.portfolio();
                let states: Vec<String> = p.orders().map(|o| format!("{:?}", o.state())).collect();
                rec.ticks.push((90, 0, states.join(",")));
            }
            _ => {}
        }),
    );
    assert_eq!(count(&s.rec, "order_submitted", "x"), 2);
    let subs = events_of(&run, "order_submitted");
    assert_eq!(
        (subs[0]["order"].as_i64(), subs[1]["order"].as_i64()),
        (Some(0), Some(1))
    );
    let before_second = s.rec.ticks.iter().find(|(k, _, _)| *k == 90).unwrap();
    assert!(
        before_second.2.starts_with("Canceled"),
        "{}",
        before_second.2
    );
    // After the second placement: orders() lists both generations; order(x) is generation 2.
    let x = s.rec.of("x");
    let last = x.last().unwrap();
    assert_eq!(
        (last.kind.as_str(), last.state.as_deref()),
        ("order_open", Some("Live"))
    );
}

// spec: 12 §7.6 rule 1 (ts-compat synchronous terminal releases in-list), 13 §5.1
#[test]
fn dd04_sync_terminal_releases() {
    let r = row("dd-04-sync-terminal-releases-in-list");
    assert_eq!(r["expect"]["order_submitted_count_for_x"], 2);
    let m = market_with_ticks(0);
    let (run, s) = run(
        &m,
        Dd::ticks(|_, out, _| {
            out.place(
                Order::buy(Outcome::Up, price!(0.6), qty!(5))
                    .fok()
                    .cid(cid!("x")),
            );
            out.place(resting_x());
        }),
    );
    assert_eq!(count(&s.rec, "order_submitted", "x"), 2);
    let subs = events_of(&run, "order_submitted");
    assert_eq!(subs.len(), 2);
    let x = s.rec.of("x");
    assert!(x
        .iter()
        .any(|e| e.kind == "order_done" && e.debug.contains("reason: Filled")));
    assert_eq!(x.last().unwrap().kind, "order_open");
}

// spec: 12 §7.6 (asynchronous terminal events release only when delivered)
#[test]
#[ignore = "C4 (G3): realistic-only (needs L_fill > 0); the engine refuses Profile::Realistic until M3b (D57)"]
fn dd05_realistic_deduped_until_delivered() {
    let _ = row("dd-05-realistic-deduped-until-fill-delivered");
    todo!("G3");
}

// spec: 12 §7.2 step 2 (dedupe before validation, both profiles since D71) — invalid duplicate is dropped, not rejected
#[test]
fn dd06_invalid_duplicate_dropped() {
    let r = row("dd-06-duplicate-invalid-is-dropped-not-rejected");
    assert_eq!(r["expect"]["duplicate_active_cid"], 1);
    let m = market_with_ticks(1);
    let (run, s) = run(
        &m,
        Dd::ticks(|ctx, out, _| match ctx.tick().seq {
            0 => out.place(resting_x()),
            1 => out.place(Order::buy(Outcome::Up, price!(0.5), Qty::ZERO).cid(cid!("x"))),
            _ => {}
        }),
    );
    assert!(
        !s.rec.seen.iter().any(|e| e.kind == "order_rejected"),
        "{:?}",
        s.rec.tags()
    );
    assert!(
        run.records("event").all(|e| e["seq"] == 0),
        "no event on the duplicate's tick"
    );
}

// spec: 12 §7.2 (dedupe before risk, both profiles since D71): a risk-breaching duplicate is dropped silently
#[test]
fn dd07_risk_rejection_dropped() {
    let r = row("dd-07-risk-rejection-for-active-cid-dropped");
    assert_eq!(r["expect"]["duplicate_active_cid"], 1);
    // Default risk.maxOrderSize is 2000 (21 §6.3 defaults file); 2001 breaches it.
    let m = market_with_ticks(1);
    let (run, s) = run(
        &m,
        Dd::ticks(|ctx, out, _| match ctx.tick().seq {
            0 => out.place(resting_x()),
            1 => out.place(Order::buy(Outcome::Up, price!(0.5), qty!(2001)).cid(cid!("x"))),
            _ => {}
        }),
    );
    assert!(
        !s.rec.seen.iter().any(|e| e.kind == "order_rejected"),
        "{:?}",
        s.rec.tags()
    );
    assert!(run.records("event").all(|e| e["seq"] == 0));
}

// spec: 60 §5.5 x10 at 320 (delay 0: in-list completion releases)
#[test]
fn dd08_cancel_replace_delay0() {
    let r = row("dd-08-x10-cancel-and-replace-delay0");
    assert_eq!(r["expect"]["duplicate_active_cid"], 0);
    let m = market_with_ticks(1);
    let (run, s) = run(
        &m,
        Dd::ticks(|ctx, out, _| match ctx.tick().seq {
            0 => out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("x10"))),
            1 => {
                out.cancel(&cid!("x10"));
                out.place(Order::buy(Outcome::Up, price!(0.45), qty!(10)).cid(cid!("x10")));
            }
            _ => {}
        }),
    );
    let tags: Vec<String> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.seq == 1)
        .map(|e| e.kind.clone())
        .collect();
    assert_eq!(
        tags,
        [
            "order_done",
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open"
        ]
    );
    let subs = events_of(&run, "order_submitted");
    assert_eq!(subs[1]["order"], 1, "generation 2");
}

// spec: 60 §5.5 x10 at 320 (queued cancel leaves it deduped)
#[test]
#[ignore = "C2-gap: the testkit has no ModelConfig override (compatLatency.delayMs 140 needed); D71 also drops delay > 0 from parity"]
fn dd09_cancel_replace_delayed() {
    let _ = row("dd-09-x10-cancel-and-replace-delayed");
    todo!("needs compatLatency.delayMs = 140");
}

// spec: 60 §5.5 x10 at 330 — replacing an active generation 2 is dropped
#[test]
fn dd10_replace_active_dropped() {
    let _ = row("dd-10-x10-replace-active");
    let m = market_with_ticks(2);
    let (run, s) = run(
        &m,
        Dd::ticks(|ctx, out, _| match ctx.tick().seq {
            0 => out.place(Order::buy(Outcome::Up, price!(0.5), qty!(10)).cid(cid!("x10"))),
            1 => {
                out.cancel(&cid!("x10"));
                out.place(Order::buy(Outcome::Up, price!(0.45), qty!(10)).cid(cid!("x10")));
            }
            2 => out.place(Order::buy(Outcome::Up, price!(0.44), qty!(10)).cid(cid!("x10"))),
            _ => {}
        }),
    );
    assert!(
        !s.rec.seen.iter().any(|e| e.seq == 2),
        "no event on the replace tick: {:?}",
        s.rec.tags()
    );
    assert!(run.records("event").all(|e| e["seq"] != 2));
    assert_eq!(
        run.records("intent").filter(|i| i["seq"] == 2).count(),
        1,
        "the intent itself is traced"
    );
    assert_eq!(count(&s.rec, "order_submitted", "x10"), 2);
}

// spec: 12 §7.6 (a new session starts with no active cids), 12 §10, 30 §4 rule 4
#[test]
fn dd11_new_session_no_active_cids() {
    let _ = row("dd-11-new-session-no-active-cids");
    let place = |ctx: &Ctx, out: &mut Intents, _: &mut Recorder| {
        if ctx.tick().seq == 0 {
            out.place(resting_x());
        }
    };
    let m1 = market_with_ticks(0);
    let mut m2 = pmb_sdk::testkit::TestMarket::btc_15m(TsMs(START.0 + 900_000))
        .profile(pmb_sdk::testkit::Profile::TsCompat);
    m2.book(
        TsMs(START.0 + 900_000 + 1000),
        Outcome::Up,
        &[(price!(0.4), qty!(100))],
        &[(price!(0.6), qty!(100))],
    );
    let (r1, s1) = run(&m1, Dd::ticks(place));
    assert_eq!(
        s1.rec.of("x").last().unwrap().state.as_deref(),
        Some("Live"),
        "x rests at the end of market 1"
    );
    let (r2, s2) = run(&m2, Dd::ticks(place));
    assert_eq!(
        count(&s2.rec, "order_submitted", "x"),
        1,
        "accepted in the new session"
    );
    assert_eq!(events_of(&r1, "order_submitted")[0]["order"], 0);
    assert_eq!(
        events_of(&r2, "order_submitted")[0]["order"],
        0,
        "keys are per session"
    );
}

// spec: 12 §7.3 (cancels never deduped), 10 §6 CancelOp dense; D71 (TC-C10 not reproduced: OM resolution)
#[test]
fn dd12_cancels_never_deduped() {
    let _ = row("dd-12-cancels-never-deduped");
    let m = market_with_ticks(1);
    let (run, s) = run(
        &m,
        Dd::ticks(|ctx, out, _| match ctx.tick().seq {
            0 => out.place(resting_x()),
            1 => {
                out.cancel(&cid!("x"));
                out.cancel(&cid!("x"));
            }
            _ => {}
        }),
    );
    assert_eq!(
        run.records("intent")
            .filter(|i| i["kind"] == "cancel_order")
            .count(),
        2,
        "both cancels are traced (never deduped)"
    );
    let done: Vec<&Seen> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.kind == "order_done")
        .collect();
    assert_eq!(done.len(), 1);
    assert!(
        done[0].debug.contains("Canceled(Strategy(CancelOp"),
        "{}",
        done[0].debug
    );
    // The second cancel finds x terminal in the OM (synchronous delay-0 result of the first):
    // known terminal → skipped silently (12 §7.3); no CancelFailed.
    assert!(
        !s.rec.seen.iter().any(|e| e.kind == "cancel_failed"),
        "{:?}",
        s.rec.tags()
    );
}

// spec: 12 §7.3 (splits/merges never deduped)
#[test]
fn dd13_splits_never_deduped() {
    let r = row("dd-13-splits-never-deduped");
    assert!(r["expect"]["events"]
        .as_str()
        .unwrap()
        .starts_with("two PositionsSplit"));
    let m = market_with_ticks(0);
    let (run, s) = run(
        &m,
        Dd::ticks(|_, out, _| {
            out.split(qty!(5));
            out.split(qty!(5));
        }),
    );
    let splits: Vec<&Seen> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.kind == "positions_split")
        .collect();
    assert_eq!(splits.len(), 2, "{:?}", s.rec.tags());
    for sp in &splits {
        assert!(
            sp.debug.contains("size: Qty(5), cost: Usdc(5)"),
            "{}",
            sp.debug
        );
    }
    assert_eq!(
        (splits[1].pos_up, splits[1].pos_down, splits[1].cash),
        (10_000_000, 10_000_000, 490_000_000)
    );
    assert_eq!(events_of(&run, "positions_split").len(), 2);
}

// spec: 21 §10 (diagnostics counter location)
#[test]
#[ignore = "C2-gap: EngineResult.diagnostics (anomalies.duplicate_active_cid) is not exposed by the testkit; needs the binary"]
fn dd14_counter_in_diagnostics() {
    let _ = row("dd-14-counter-is-not-a-reason");
    todo!("read diagnostics.anomalies.duplicate_active_cid from an EngineResult");
}

// spec: 12 §7.6 rule 3 (full fill delivery releases before the callback), D69 (A-13)
#[test]
fn dd15_full_fill_releases_before_callback() {
    let _ = row("dd-15-om-terminal-on-full-fill-delivery");
    let mut m = market_with_ticks(0);
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.4), qty!(100));
    let mut s = Dd::ticks(|ctx, out, _| {
        if ctx.tick().seq == 0 {
            out.place(resting_x());
        }
    });
    // Re-place once, at a price that does not cross the new best ask (0.4), so the
    // generation-2 order rests instead of cascading fills.
    let mut replaced = false;
    s.event = Box::new(move |_, ev, out, _| {
        if let (AccountEvent::Fill { .. }, false) = (ev, replaced) {
            out.place(Order::buy(Outcome::Up, price!(0.35), qty!(10)).cid(cid!("x")));
            replaced = true;
        }
    });
    let (run, s) = run(&m, s);
    let subs = events_of(&run, "order_submitted");
    assert_eq!(
        subs.len(),
        2,
        "the re-place inside the Fill callback is accepted as generation 2: {:?}",
        s.rec.tags()
    );
    assert_eq!(subs[1]["order"], 1);
    // Delivery order: fill(gen 1) → order_done(gen 1) → [sub, acc, su, open](gen 2): the
    // re-place is handled after the Fill callback and its events queue behind the already
    // queued OrderDone (breadth-first, 12 §6.2).
    let kinds: Vec<(String, Option<i64>)> = event_kinds(&run)
        .into_iter()
        .filter(|(_, k)| k.is_some())
        .collect();
    let i_fill = kinds
        .iter()
        .position(|(k, o)| k == "fill" && *o == Some(0))
        .unwrap();
    assert_eq!(kinds[i_fill + 1], ("order_done".to_string(), Some(0)));
    assert_eq!(kinds[i_fill + 2], ("order_submitted".to_string(), Some(1)));
    assert_eq!(kinds.last().unwrap(), &("order_open".to_string(), Some(1)));
}
