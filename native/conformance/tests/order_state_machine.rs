// spec: 10 §8.1, 10 §8.2 (one test per row), 10 §8.3 S1–S6, 10 §8.4, 13 §5.1, 13 §6.7
//
// G2 row "Order state machine (one test per row of 10 §8.2)". The row tests
// drive the row's input through pmb_sdk::testkit (ts-compat, delay 0) and
// assert the row's delivered sequence (the `ts_compat_events` of
// vectors/order_state_machine.json) and the OrderView state seen inside the
// callbacks. Rows that exist only in the realistic profile (6–11, 14, 16, 21)
// or live (20) stay ignored: the engine refuses `Profile::Realistic` until
// M3b (D57) and they are C4 scope.

mod common;

use common::*;
use pmb_conformance::vectors::{self, rows};
use pmb_sdk::prelude::*;
use serde_json::Value;
use std::collections::BTreeSet;

fn file() -> Value {
    vectors::load("order_state_machine")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("row {id} missing"))
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 10 §8.1 — the state sets and the TS lifecycle mapping (10 §8.4)
#[test]
fn state_sets_and_ts_mapping() {
    let f = file();
    let non_terminal = strs(&f["states"]["non_terminal"]);
    let terminal = strs(&f["states"]["terminal"]);
    assert_eq!(non_terminal, ["InFlight", "Delayed", "Live", "Unknown"]);
    assert_eq!(
        terminal,
        ["Filled", "Canceled", "Expired", "Killed", "Rejected"]
    );
    let m = f["states"]["ts_lifecycle_mapping"].as_object().unwrap();
    for s in ["InFlight", "Delayed", "Unknown"] {
        assert_eq!(m[s], "requested");
    }
    assert_eq!(m["Live(filled=0)"], "open");
    assert_eq!(m["Live(filled>0)"], "partially_filled");
    for t in &terminal {
        assert_eq!(
            m[t.as_str()],
            t.to_lowercase(),
            "{t} maps to its lower-case name"
        );
    }
    // The SDK enum agrees with the table (10 §8.4 ts_state).
    assert_eq!(OrderState::InFlight.ts_state(false), "requested");
    assert_eq!(OrderState::Live.ts_state(false), "open");
    assert_eq!(OrderState::Live.ts_state(true), "partially_filled");
    assert_eq!(OrderState::Filled.ts_state(true), "filled");
    assert_eq!(OrderState::Expired.ts_state(false), "expired");
    assert_eq!(OrderState::Killed.ts_state(false), "killed");
    assert!(OrderState::Filled.is_terminal() && !OrderState::Live.is_terminal());
}

// spec: 10 §8.2 — every row's target state is a known state (or a match/no-order marker)
#[test]
fn rows_reference_known_states() {
    let f = file();
    let known: BTreeSet<String> = strs(&f["states"]["non_terminal"])
        .into_iter()
        .chain(strs(&f["states"]["terminal"]))
        .collect();
    let mut ids = Vec::new();
    for r in rows(&f) {
        ids.push(vectors::id(r).to_string());
        let to = r["to"].as_str();
        if let Some(to) = to {
            let states: Vec<&str> = to
                .split(['|', '/', '+', '('])
                .map(|t| t.trim())
                .filter(|t| !t.is_empty())
                .collect();
            let head = states[0].split_whitespace().next().unwrap();
            assert!(
                known.contains(head) || head == "match" || head == "unchanged",
                "{}: unknown target state {head:?}",
                vectors::id(r)
            );
        }
        for p in strs(&r["profiles"]) {
            assert!(
                ["ts-compat", "realistic", "live"].contains(&p.as_str()),
                "{}: profile {p}",
                vectors::id(r)
            );
        }
    }
    // 21 rows of 10 §8.2, in order.
    let want: Vec<String> = (1..=21).map(|n| format!("r{n:02}")).collect();
    assert_eq!(ids, want);
}

// spec: 10 S1 — each terminal row names exactly one terminal event
#[test]
fn terminal_rows_name_one_terminal_event() {
    let f = file();
    let terminal = strs(&f["states"]["terminal"]);
    for r in rows(&f) {
        let Some(to) = r["to"].as_str() else { continue };
        let head = to
            .split(|c| c == ' ' || c == '(' || c == '|')
            .next()
            .unwrap();
        if terminal.iter().any(|t| t == head) && !to.contains('|') {
            let events = strs(&r["events"]);
            let terminal_events = events
                .iter()
                .filter(|e| e.starts_with("OrderDone") || e.starts_with("OrderRejected"))
                .count();
            assert_eq!(terminal_events, 1, "{}: events {events:?}", vectors::id(r));
            assert!(
                events.last().unwrap().starts_with("OrderDone")
                    || events.last().unwrap().starts_with("OrderRejected"),
                "{}: the terminal event comes last",
                vectors::id(r)
            );
        }
    }
}

// spec: 10 §8.2 forbidden patterns — each cites a clause and a profile set
#[test]
fn forbidden_list_well_formed() {
    let f = file();
    let mut ids = BTreeSet::new();
    for fb in f["forbidden"].as_array().unwrap() {
        assert!(ids.insert(fb["id"].as_str().unwrap().to_string()));
        assert!(fb["spec"].as_str().map_or(false, |s| !s.is_empty()));
        assert!(fb["pattern"].as_str().map_or(false, |s| !s.is_empty()));
        assert!(!strs(&fb["profiles"]).is_empty());
    }
    assert!(ids.contains("f-s1-absorbing"));
    assert!(ids.contains("f-ts-compat-cancel-acked"));
}

// ---------------------------------------------------------------------------
// Scripted rows (ts-compat, delay 0). One strategy type drives every row: it
// issues the row's intents from `on_tick` by tick index and records every
// callback.
// ---------------------------------------------------------------------------

type TickFn = Box<dyn FnMut(&Ctx, &mut Intents, &mut Recorder) + Send>;

struct Row {
    rec: Recorder,
    on_tick: TickFn,
}

impl Row {
    fn new(f: impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static) -> Row {
        Row {
            rec: Recorder::default(),
            on_tick: Box::new(f),
        }
    }
}

impl Script for Row {
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) {
        self.rec.tick(ctx);
        (self.on_tick)(ctx, out, &mut self.rec);
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, _out: &mut Intents) {
        self.rec.event(ctx, ev);
    }
}

/// UP book bid 0.48 / ask 0.52 × 50 at `t(1000)` (DOWN the complement).
fn standard_market() -> pmb_sdk::testkit::TestMarket {
    let mut m = market();
    books(&mut m, t(1000), price!(0.48), price!(0.52), qty!(50));
    m
}

/// Kinds of the callbacks about `cid`, with the settlement status and done
/// reason appended where the vector distinguishes them.
fn kinds(rec: &Recorder, cid: &str) -> Vec<String> {
    rec.of(cid)
        .iter()
        .map(|s| match s.kind.as_str() {
            "settlement_update" => {
                let st = if s.debug.contains("status: Matched") {
                    "Matched"
                } else if s.debug.contains("status: Confirmed") {
                    "Confirmed"
                } else if s.debug.contains("status: Mined") {
                    "Mined"
                } else {
                    "?"
                };
                let fill = if s.debug.contains("fill: None") {
                    "fill: None"
                } else {
                    "fill: Some"
                };
                format!("settlement_update({st}, {fill})")
            }
            "order_done" => {
                let r = if s.debug.contains("reason: Filled") {
                    "Filled"
                } else if s.debug.contains("reason: Killed") {
                    "Killed"
                } else if s.debug.contains("reason: Expired") {
                    "Expired"
                } else if s.debug.contains("reason: Canceled") {
                    "Canceled"
                } else {
                    "?"
                };
                format!("order_done({r})")
            }
            "order_rejected" => {
                let r = s.debug.split("reason: ").nth(1).unwrap_or("?");
                let r = r.trim_end_matches(" }").split(['{', ' ']).next().unwrap();
                format!("order_rejected({r})")
            }
            k => k.to_string(),
        })
        .collect()
}

// spec: 10 §8.2 row 1 — intent passes validation, dedupe, risk and funding → InFlight, OrderSubmitted first
#[test]
fn r01_submitted() {
    let r = row("r01");
    assert_eq!(strs(&r["ts_compat_events"]), ["OrderSubmitted"]);
    let m = standard_market();
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.47), qty!(5)).cid(cid!("a")));
            }
        }),
    );
    let a = s.rec.of("a");
    assert_eq!(
        a[0].kind, "order_submitted",
        "the first event for the cid is OrderSubmitted"
    );
    assert_eq!(
        a[0].state.as_deref(),
        Some("InFlight"),
        "12 §9.2: InFlight inside that callback"
    );
    assert_eq!(a[0].remaining, Some(5_000_000));
}

// spec: 10 §8.2 row 2, 12 §7.2, 10 §10.2 — engine rejection: no OrderSubmitted, no record, no key consumed
#[test]
fn r02_engine_reject() {
    let r = row("r02");
    assert_eq!(strs(&r["events"]), ["OrderRejected{origin: Engine}"]);
    let mut m = standard_market().starting_capital(usdc!(1));
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, rec| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.47), Qty::ZERO).cid(cid!("size0")));
                out.place(Order::buy(Outcome::Up, Price::ZERO, qty!(5)).cid(cid!("price0")));
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(10)).cid(cid!("nocap")));
                out.place(Order::buy(Outcome::Up, price!(0.10), qty!(1)).cid(cid!("ok")));
            }
            if ctx.tick().seq == 3 {
                let p = ctx.portfolio();
                for c in ["size0", "price0", "nocap"] {
                    rec.ticks.push((
                        99,
                        0,
                        format!("{c}:{}", p.order(&ClientOrderId::new(c).unwrap()).is_some()),
                    ));
                }
            }
        }),
    );
    let rejected: Vec<&Seen> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.kind == "order_rejected")
        .collect();
    assert_eq!(rejected.len(), 3, "{:?}", s.rec.tags());
    assert!(
        rejected[0].debug.contains("reason: InvalidSize")
            && rejected[0].debug.contains("order: None")
    );
    assert!(
        rejected[1].debug.contains("reason: InvalidPrice")
            && rejected[1].debug.contains("order: None")
    );
    assert!(
        rejected[2].debug.contains("reason: InsufficientCapital")
            && rejected[2].debug.contains("order: None"),
        "{}",
        rejected[2].debug
    );
    // No OrderSubmitted precedes a rejection; the valid order's record is key 0 (no key consumed).
    assert_eq!(
        s.rec.kinds_of("ok"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open"
        ]
    );
    assert_eq!(event_kinds(&run)[0], ("order_rejected".to_string(), None));
    let subs = events_of(&run, "order_submitted");
    assert_eq!(subs.len(), 1);
    assert_eq!(
        subs[0]["order"], 0,
        "engine rejections consume no OrderKey (10 §6)"
    );
    // No record exists for the rejected cids (12 §9.2).
    for c in ["size0", "price0", "nocap"] {
        assert!(
            s.rec
                .ticks
                .iter()
                .any(|(k, _, v)| *k == 99 && v == &format!("{c}:false")),
            "{:?}",
            s.rec.ticks
        );
    }
}

// spec: 10 §8.2 row 3 — exchange rejection at arrival (post-only cross; equality crosses in ts-compat, 11 §4)
#[test]
fn r03_exchange_reject() {
    let r = row("r03");
    assert_eq!(
        strs(&r["ts_compat_events"]),
        ["OrderSubmitted", "OrderRejected(PostOnlyWouldCross)"]
    );
    let m = standard_market();
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(5))
                        .post_only()
                        .cid(cid!("po")),
                );
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "po"),
        ["order_submitted", "order_rejected(PostOnlyWouldCross)"]
    );
    let rej = &s.rec.of("po")[1];
    assert_eq!(
        rej.state.as_deref().map(|st| st.starts_with("Rejected")),
        Some(true),
        "{:?}",
        rej.state
    );
    assert_eq!(
        rej.reserved, 0,
        "C3: the reservation is released on the keyed rejection"
    );
    let rejected = events_of(&run, "order_rejected");
    assert_eq!(
        rejected[0]["order"], 0,
        "exchange-origin rejections are keyed"
    );
    assert_eq!(rejected[0]["reason"], "post_only_would_cross");
}

// spec: 10 §8.2 row 4 — arrives, not marketable → OrderAccepted, SettlementUpdate{Matched}, OrderOpen → Live
#[test]
fn r04_rests() {
    let r = row("r04");
    assert_eq!(strs(&r["ts_compat_events"]).len(), 4);
    let m = standard_market();
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "a"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched, fill: None)",
            "order_open"
        ]
    );
    let a = s.rec.of("a");
    assert_eq!(
        a[1].state.as_deref(),
        Some("InFlight"),
        "accepted but not yet open"
    );
    assert_eq!(a[3].state.as_deref(), Some("Live"));
    assert_eq!(a[3].remaining, Some(5_000_000));
}

// spec: 10 §8.2 row 5 — arrives marketable, delay 0: fills then OrderDone(Filled) or OrderOpen for the remainder
#[test]
fn r05_marketable_no_delay() {
    let r = row("r05");
    assert!(strs(&r["ts_compat_events"])
        .iter()
        .any(|e| e.starts_with("Fill")));
    // size <= depth: fills then OrderDone(Filled)
    let m = standard_market();
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.52), qty!(5)).cid(cid!("a")));
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "a"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched, fill: None)",
            "fill",
            "order_done(Filled)"
        ]
    );
    assert!(s.rec.of("a")[3].debug.contains("liquidity: Taker"));
    assert_eq!(s.rec.of("a")[4].state.as_deref(), Some("Filled"));
    // size > depth: fills then OrderOpen (remainder rests, state Live, filled 3, remaining 2)
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(3)), (price!(0.60), qty!(10))],
    );
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.52), qty!(5)).cid(cid!("a")));
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "a"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched, fill: None)",
            "fill",
            "order_open"
        ]
    );
    let open = &s.rec.of("a")[4];
    assert_eq!(open.state.as_deref(), Some("Live"));
    assert_eq!(open.filled, Some(3_000_000));
    assert_eq!(open.remaining, Some(2_000_000));
}

// spec: 10 §8.2 row 6 — Delayed (realistic, taker delay > 0)
#[test]
#[ignore = "C4 (G3): realistic-only row; the engine refuses Profile::Realistic until M3b (D57)"]
fn r06_delayed() {
    let _ = row("r06");
    todo!("G3: OrderAccepted, OrderDelayed{{release_at}}");
}
// spec: 10 §8.2 row 7 — re-validation fails at release
#[test]
#[ignore = "C4 (G3): realistic-only row; the engine refuses Profile::Realistic until M3b (D57)"]
fn r07_delayed_reject() {
    let _ = row("r07");
    todo!("G3: tick change during delay -> OrderRejected(InvalidTick)");
}
// spec: 10 §8.2 row 8 — still marketable at release
#[test]
#[ignore = "C4 (G3): realistic-only row; the engine refuses Profile::Realistic until M3b (D57)"]
fn r08_delayed_match() {
    let _ = row("r08");
    todo!("G3: Fill x n then OrderOpen or OrderDone");
}
// spec: 10 §8.2 row 9 — no longer marketable at release
#[test]
#[ignore = "C4 (G3): realistic-only row; the engine refuses Profile::Realistic until M3b (D57)"]
fn r09_delayed_rest_or_kill() {
    let _ = row("r09");
    todo!("G3: GTC -> OrderOpen; FOK -> OrderDone(Killed, 0)");
}
// spec: 10 §8.2 row 10 — cancel inside a non-cancellable delay window
#[test]
#[ignore = "C4 (G3): realistic-only row; the engine refuses Profile::Realistic until M3b (D57)"]
fn r10_delayed_cancel_fails() {
    let _ = row("r10");
    todo!("G3: CancelFailed(NotCancelableDuringDelay), order stays Delayed");
}

// spec: 10 §8.2 row 11 — partial maker fill keeps Live (realistic); unreachable in ts-compat (13 §5.1)
#[test]
fn r11_partial_maker_fill_unreachable_in_ts_compat() {
    let r = row("r11");
    assert!(r["ts_compat_note"]
        .as_str()
        .unwrap()
        .starts_with("unreachable"));
    // A resting BUY 40 @ 0.50 with a tick whose best ask (0.49) shows only 1 share:
    // WorstQueueCompat fills the whole remainder at the limit, never a partial.
    let mut m = standard_market();
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.49), qty!(1));
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(40)).cid(cid!("a")));
            }
        }),
    );
    let fills: Vec<&Seen> = s
        .rec
        .of("a")
        .into_iter()
        .filter(|e| e.kind == "fill")
        .collect();
    assert_eq!(fills.len(), 1);
    assert_eq!(
        fills[0].remaining,
        Some(0),
        "no Fill of a resting order leaves it Live in ts-compat"
    );
    assert_eq!(fills[0].filled, Some(40_000_000));
}

// spec: 10 §8.2 row 12 — maker fill completes the size: Fill(MAKER, limit, remainder, fee 0), OrderDone(Filled)
#[test]
fn r12_maker_fill_completes() {
    let r = row("r12");
    assert_eq!(strs(&r["ts_compat_events"]).len(), 2);
    let mut m = standard_market();
    // best ask == limit does not fill (strictly through, 13 §5.1); below it does.
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.50), qty!(10));
    m.price_change(t(3000), Outcome::Up, Side::Sell, price!(0.49), qty!(1));
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
            }
        }),
    );
    let a = s.rec.of("a");
    let fill = a.iter().find(|e| e.kind == "fill").expect("maker fill");
    assert_eq!(
        fill.at,
        t(3000).0,
        "no fill on the tick whose ask equals the limit"
    );
    assert!(fill.debug.contains("liquidity: Maker"), "{}", fill.debug);
    assert!(
        fill.debug
            .contains("price: Price(0.5), qty: Qty(5), fee: Usdc(0)"),
        "{}",
        fill.debug
    );
    assert_eq!(
        kinds(&s.rec, "a")[4..],
        ["fill".to_string(), "order_done(Filled)".to_string()]
    );
    assert_eq!(a.last().unwrap().state.as_deref(), Some("Filled"));
    let f = events_of(&run, "fill");
    assert_eq!(f.len(), 1);
    assert_eq!(f[0]["fee"], 0);
}

// spec: 10 §8.2 row 13, 13 §5.1 Cancels (TC-C5) — ts-compat cancel: OrderDone(Canceled(Strategy(op)), filled), no CancelAcked
#[test]
fn r13_cancel_ts_compat() {
    let r = row("r13");
    assert_eq!(
        strs(&r["ts_compat_events"]),
        ["OrderDone(Canceled, filled)"]
    );
    let mut m = standard_market();
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
            }
            if ctx.tick().seq == 3 {
                out.cancel(&cid!("a"));
            }
        }),
    );
    let a = s.rec.of("a");
    let done = a.last().unwrap();
    assert_eq!(done.kind, "order_done");
    assert!(
        done.debug.contains("reason: Canceled(Strategy("),
        "{}",
        done.debug
    );
    assert!(
        done.debug.contains("filled: Some(Qty(0))"),
        "{}",
        done.debug
    );
    assert!(done.state.as_deref().unwrap().starts_with("Canceled"));
    assert_eq!(
        done.seq, 3,
        "synchronous with delay 0: delivered inside the cancelling tick's cascade"
    );
    assert!(!s.rec.seen.iter().any(|e| e.kind == "cancel_acked"));
    assert!(
        !run.records("event").any(|e| e["kind"] == "cancel_acked"),
        "never CancelAcked in ts-compat (22 §3.2)"
    );
    assert_eq!(events_of(&run, "order_done")[0]["reason"], "canceled");
}

// spec: 10 §8.2 row 14 — realistic cancel: CancelAcked then OrderDone
#[test]
#[ignore = "C4 (G3): realistic-only row; the engine refuses Profile::Realistic until M3b (D57)"]
fn r14_cancel_realistic() {
    let _ = row("r14");
    todo!("G3: CancelAcked and OrderDone(Canceled, filled) in either order");
}

// spec: 10 §8.2 row 15, 11 §4 (GTD) — ts-compat expiry exactly at expire_at, checked before fills on that tick
#[test]
fn r15_gtd_expiry() {
    let r = row("r15");
    assert_eq!(strs(&r["ts_compat_events"]), ["OrderDone(Expired, filled)"]);
    let expire = t(1000 + 60_000);
    let mut m = standard_market();
    m.price_change(
        TsMs(expire.0 - 1),
        Outcome::Up,
        Side::Sell,
        price!(0.51),
        qty!(10),
    );
    m.price_change(expire, Outcome::Up, Side::Sell, price!(0.49), qty!(10)); // crosses the limit too
    let (_run, s) = run(
        &m,
        Row::new(move |ctx, out, rec| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.50), qty!(5))
                        .gtd(expire)
                        .cid(cid!("g")),
                );
            }
            if ctx.tick().seq == 2 {
                let st = format!("{:?}", ctx.portfolio().order(&cid!("g")).unwrap().state());
                rec.ticks.push((98, ctx.now().0, st));
            }
        }),
    );
    assert!(
        s.rec
            .ticks
            .iter()
            .any(|(k, ts, st)| *k == 98 && *ts == expire.0 - 1 && st == "Live"),
        "{:?}",
        s.rec.ticks
    );
    let g = s.rec.of("g");
    assert!(
        !g.iter().any(|e| e.kind == "fill"),
        "expiry is checked before fills on that tick"
    );
    let done = g.last().unwrap();
    assert_eq!(done.kind, "order_done");
    assert!(done.debug.contains("reason: Expired"), "{}", done.debug);
    assert_eq!(done.at, expire.0, "expires exactly at expire_at");
    assert_eq!(done.state.as_deref(), Some("Expired"));
}

// spec: 10 §8.2 row 16 — window end / market close cancels (realistic); ts-compat: nothing (TC-C13)
#[test]
fn r16_window_end_ts_compat_no_action() {
    let r = row("r16");
    assert!(r["scenario"]
        .as_str()
        .unwrap()
        .contains("ts-compat: NO action"));
    let mut m = standard_market();
    books(&mut m, END, price!(0.48), price!(0.52), qty!(50));
    books(
        &mut m,
        TsMs(END.0 + 1000),
        price!(0.48),
        price!(0.52),
        qty!(50),
    );
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, rec| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
            }
            let st = format!("{:?}", ctx.portfolio().order(&cid!("a")).map(|o| o.state()));
            rec.ticks.push((97, ctx.now().0, st));
        }),
    );
    assert!(
        !run.records("event").any(|e| e["kind"] == "order_done"),
        "ts-compat leaves the order Live at the end"
    );
    let last = s
        .rec
        .ticks
        .iter()
        .filter(|(k, _, _)| *k == 97)
        .last()
        .unwrap();
    assert_eq!(last.2, "Some(Live)");
    assert!(s.rec.seen.iter().all(|e| e.kind != "order_done"));
}

// spec: 10 §8.2 row 17 — market order fill complete (FOK): Fill x n, OrderDone(Filled), then SettlementUpdate{Confirmed}
#[test]
fn r17_market_order_filled() {
    let r = row("r17");
    assert_eq!(strs(&r["ts_compat_events"]).len(), 6);
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(3)), (price!(0.53), qty!(10))],
    );
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.53), qty!(5))
                        .fok()
                        .cid(cid!("f")),
                );
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "f"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched, fill: None)",
            "fill",
            "fill",
            "order_done(Filled)",
            "settlement_update(Confirmed, fill: None)"
        ]
    );
    let f = s.rec.of("f");
    assert!(
        f[3].debug.contains("price: Price(0.52), qty: Qty(3)"),
        "{}",
        f[3].debug
    );
    assert!(
        f[4].debug.contains("price: Price(0.53), qty: Qty(2)"),
        "{}",
        f[4].debug
    );
    assert_eq!(f[5].state.as_deref(), Some("Filled"));
    assert_eq!(f[6].state.as_deref(), Some("Filled"));
}

// spec: 10 §8.2 row 18 — FOK killed: no fills, OrderDone(Killed, filled 0)
#[test]
fn r18_fok_killed() {
    let r = row("r18");
    assert_eq!(strs(&r["ts_compat_events"]).len(), 4);
    let m = standard_market();
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fok()
                        .cid(cid!("k")),
                );
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "k"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched, fill: None)",
            "order_done(Killed)"
        ]
    );
    let done = s.rec.of("k")[3];
    assert!(
        done.debug.contains("filled: Some(Qty(0))") || done.debug.contains("filled: None"),
        "{}",
        done.debug
    );
    assert_eq!(done.filled, Some(0));
    assert_eq!(done.state.as_deref(), Some("Killed"));
    assert_eq!(done.reserved, 0, "C3: released on the terminal event");
    assert_eq!(events_of(&run, "fill").len(), 0);
    assert!(
        !run.records("event").any(|e| e["kind"] == "order_open"),
        "FOK never rests (S-forbidden)"
    );
}

// spec: 10 §8.2 row 19, 10 §7.1 (FAK) — partial fill then killed; never OrderOpen
#[test]
fn r19_fak_killed() {
    let r = row("r19");
    assert_eq!(
        strs(&r["events"]),
        ["Fill x k", "OrderDone(Killed, filled)"]
    );
    let m = standard_market();
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fak()
                        .cid(cid!("k")),
                );
            }
        }),
    );
    assert_eq!(
        kinds(&s.rec, "k"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched, fill: None)",
            "fill",
            "order_done(Killed)"
        ]
    );
    let done = s.rec.of("k")[4];
    assert_eq!(done.filled, Some(50_000_000));
    assert!(
        done.debug.contains("filled: Some(Qty(50))"),
        "{}",
        done.debug
    );
    assert_eq!(done.state.as_deref(), Some("Killed"));
    assert_eq!(done.reserved, 0);
    assert!(!run.records("event").any(|e| e["kind"] == "order_open"));
}

// spec: 10 §8.2 row 20 — Unknown resolved by reconciliation (live)
#[test]
#[ignore = "C4 (G4): live-only row (50 §8.2)"]
fn r20_unknown_reconciled() {
    let _ = row("r20");
    todo!("G4: mock exchange ambiguous POST then reconciliation");
}
// spec: 10 §8.2 row 21 — late fill after terminal (live; realistic when latencies differ)
#[test]
#[ignore = "C4 (G3/G4): needs report latencies that differ (13 §6.7) or the live adapter"]
fn r21_late_fill() {
    let _ = row("r21");
    todo!("G4/G3: Fill flagged late; state unchanged; cash and position updated");
}

// spec: 10 S1, S2, S4, S6; 10 §8.2 forbidden patterns (see vectors `forbidden`)
// Every ts-compat scenario of this file is replayed in one session and the
// delivered events are scanned for the forbidden patterns.
#[test]
fn forbidden_patterns_absent_from_all_traces() {
    let f = file();
    assert!(f["forbidden"].as_array().unwrap().len() >= 15);
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(3)), (price!(0.53), qty!(50))],
    );
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.52), qty!(3));
    m.price_change(t(61_000), Outcome::Up, Side::Sell, price!(0.49), qty!(3));
    m.price_change(t(62_000), Outcome::Up, Side::Sell, price!(0.52), qty!(3));
    let (run, s) = run(
        &m,
        Row::new(|ctx, out, _| match ctx.tick().seq {
            1 => {
                out.place(Order::buy(Outcome::Up, price!(0.47), qty!(5)).cid(cid!("gtc-rest")));
                out.place(Order::buy(Outcome::Up, price!(0.47), Qty::ZERO).cid(cid!("size0")));
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(5))
                        .post_only()
                        .cid(cid!("po")),
                );
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("maker")));
                out.place(Order::buy(Outcome::Up, price!(0.53), qty!(5)).cid(cid!("cross")));
                out.place(
                    Order::buy(Outcome::Up, price!(0.53), qty!(5))
                        .fok()
                        .cid(cid!("fok")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fok()
                        .cid(cid!("fok-kill")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fak()
                        .cid(cid!("fak")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.50), qty!(5))
                        .gtd(t(61_000))
                        .cid(cid!("gtd")),
                );
            }
            2 => {
                out.cancel(&cid!("gtc-rest"));
                out.place(Order::buy(Outcome::Up, price!(0.47), qty!(5)).cid(cid!("gtc-rest")));
            }
            _ => {}
        }),
    );
    // Order types per cid, for the type-specific patterns.
    let order_type = |cid: &str| -> &str {
        match cid {
            "fok" | "fok-kill" => "FOK",
            "fak" => "FAK",
            "gtd" => "GTD",
            _ => "GTC",
        }
    };
    // Per order key: terminal count, events after terminal, fills, open-for-market-type.
    let mut terminal_seen: std::collections::BTreeMap<i64, usize> = Default::default();
    for e in run.records("event") {
        let kind = e["kind"].as_str().unwrap();
        assert!(
            kind != "order_delayed" && kind != "cancel_acked",
            "f-ts-compat: {kind} never in a ts-compat trace"
        );
        let Some(key) = e["order"].as_i64() else {
            continue;
        };
        if let Some(n) = terminal_seen.get(&key) {
            // After the terminal event only late fills (10 S5) and the ts-compat
            // SettlementUpdate{Confirmed} of a filled FOK (13 §5.1 step 3; A-16/D69) may follow.
            assert!(
                (kind == "fill" || kind == "settlement_update") && *n == 1,
                "f-s1-absorbing: {kind} for key {key} after its terminal event"
            );
        }
        if kind == "order_done" || kind == "order_rejected" {
            *terminal_seen.entry(key).or_default() += 1;
            assert_eq!(
                terminal_seen[&key], 1,
                "exactly one terminal event per key (S1)"
            );
        }
    }
    // Callback-level checks keyed by cid (state, type, fill sums).
    let mut fills: std::collections::BTreeMap<String, i64> = Default::default();
    for e in &s.rec.seen {
        let Some(cid) = &e.cid else { continue };
        let ty = order_type(cid);
        match e.kind.as_str() {
            "order_open" => assert!(ty == "GTC" || ty == "GTD", "FOK/FAK never rest: {cid}"),
            "order_done" => {
                if e.debug.contains("reason: Killed") {
                    assert!(
                        ty == "FOK" || ty == "FAK",
                        "Killed only for market types: {cid}"
                    );
                }
                if e.debug.contains("reason: Expired") {
                    assert_eq!(ty, "GTD", "Expired only for GTD: {cid}");
                }
                assert!(e.filled.unwrap() <= 60_000_000);
            }
            "fill" => {
                let q: i64 = e
                    .debug
                    .split("qty: Qty(")
                    .nth(1)
                    .unwrap()
                    .split(')')
                    .next()
                    .unwrap()
                    .parse::<f64>()
                    .map(|v| (v * 1e6).round() as i64)
                    .unwrap();
                *fills.entry(cid.clone()).or_default() += q;
                assert!(
                    e.state.as_deref() != Some("Rejected"),
                    "no Fill for a Rejected order"
                );
            }
            _ => {}
        }
    }
    for (cid, q) in &fills {
        let size = if cid.starts_with("fok-kill") || cid == "fak" {
            60_000_000
        } else {
            5_000_000
        };
        assert!(*q <= size, "fill sum over size for {cid}");
    }
    // Sanity: the scenario exercised the rows it claims to.
    assert!(s
        .rec
        .seen
        .iter()
        .any(|e| e.kind == "order_rejected" && e.debug.contains("PostOnlyWouldCross")));
    assert!(s
        .rec
        .of("gtd")
        .iter()
        .any(|e| e.debug.contains("reason: Expired")));
    assert!(s
        .rec
        .of("fak")
        .iter()
        .any(|e| e.debug.contains("reason: Killed")));
    assert!(s
        .rec
        .of("maker")
        .iter()
        .any(|e| e.kind == "fill" && e.debug.contains("liquidity: Maker")));
}

// spec: 10 S3, 12 §9.4 (authoritative final quantity table)
#[test]
fn s3_final_quantity_table() {
    let f = file();
    let inv = f["invariants"].as_array().unwrap();
    assert!(inv.iter().any(|i| i["id"] == "s3-filled-authoritative"));
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(3)), (price!(0.60), qty!(50))],
    );
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    let (_run, s) = run(
        &m,
        Row::new(|ctx, out, _| match ctx.tick().seq {
            1 => {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(5))
                        .post_only()
                        .cid(cid!("rejected")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fok()
                        .cid(cid!("killed")),
                );
                out.place(Order::buy(Outcome::Up, price!(0.52), qty!(3)).cid(cid!("filled")));
                out.place(Order::buy(Outcome::Up, price!(0.52), qty!(5)).cid(cid!("partial")));
            }
            3 => out.cancel(&cid!("partial")),
            _ => {}
        }),
    );
    let last = |cid: &str| s.rec.of(cid).last().copied().unwrap().clone();
    // Rejected → final 0 (reservation released, nothing filled).
    let r = last("rejected");
    assert_eq!((r.kind.as_str(), r.filled), ("order_rejected", Some(0)));
    // Killed without fills → delivered filled (0).
    let k = last("killed");
    assert_eq!((k.kind.as_str(), k.filled), ("order_done", Some(0)));
    // Filled → size.
    let fi = last("filled");
    assert_eq!(
        (fi.kind.as_str(), fi.filled, fi.remaining),
        ("order_done", Some(3_000_000), Some(0))
    );
    assert!(fi.debug.contains("reason: Filled"));
    // OrderDone(Canceled) with filled → max(filled, delivered): 0 here, the taker depth was
    // consumed by the earlier order of the same tick (TC-E3: no depletion, so 'partial'
    // also took the 3 @ 0.52 — the same recorded level; filled 3 of 5).
    let p = last("partial");
    assert_eq!(p.kind, "order_done");
    assert!(p.debug.contains("reason: Canceled"), "{}", p.debug);
    assert_eq!(
        p.filled,
        Some(3_000_000),
        "authoritative final quantity = max(reported, delivered)"
    );
    assert!(p.debug.contains("filled: Some(Qty(3))"), "{}", p.debug);
    assert_eq!(
        p.reserved, 0,
        "every terminal path releases the reservation (12 §9.8 item 2)"
    );
}
