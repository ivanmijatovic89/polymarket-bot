// spec: 12 §6.1, 12 §6.2, 12 §6.3, 12 §6.4, 12 §4.2, 12 §5.3, 12 §9.1, 30 §4, 30 §4.1, 22 §3.3
//
// G2 row "account event ordering and cascades (12 §6)". Every vector of
// vectors/cascades.json is a scripted strategy bound to pmb_sdk::testkit
// (ts-compat, delay 0): the callback sequence is read from the strategy's own
// observations and from the trace records of `TestRun`.

mod common;

use common::*;
use pmb_conformance::vectors::{self, rows};
use pmb_sdk::prelude::*;
use serde_json::Value;

fn file() -> Value {
    vectors::load("cascades")
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
        assert!(r.get("script").is_some(), "{} has a script", vectors::id(r));
        assert!(
            r.get("expect").is_some(),
            "{} has expectations",
            vectors::id(r)
        );
        let profiles = r["profiles"].as_array().unwrap();
        assert!(!profiles.is_empty());
    }
}

// spec: 12 §6.2 — the literal ts-compat sequence of cs-01 is breadth-first
#[test]
fn cs01_literal_sequence_is_breadth_first() {
    let r = row("cs-01-breadth-first");
    let seq = r["expect"]["ts_compat_sequence"].as_array().unwrap();
    let cids: Vec<&str> = seq.iter().map(|e| e[1].as_str().unwrap()).collect();
    let last_ab = cids.iter().rposition(|c| *c == "a" || *c == "b").unwrap();
    let first_c = cids.iter().position(|c| *c == "c").unwrap();
    assert!(last_ab < first_c);
    for cid in ["a", "b", "c"] {
        let kinds: Vec<&str> = seq
            .iter()
            .filter(|e| e[1] == cid)
            .map(|e| e[0].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            [
                "order_submitted",
                "order_accepted",
                "settlement_update",
                "order_open"
            ],
            "{cid}"
        );
    }
}

// spec: 12 §6.1 — cs-04's ts-compat callback kinds for a filled FOK (13 §5.1 step 3)
#[test]
fn cs04_fok_callback_kinds() {
    let r = row("cs-04-every-event-offered");
    let kinds: Vec<&str> = r["expect"]["ts_compat_callback_kinds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k.as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched)",
            "fill",
            "order_done(Filled)",
            "settlement_update(Confirmed)"
        ]
    );
}

// ---------------------------------------------------------------------------

type TickFn = Box<dyn FnMut(&Ctx, &mut Intents, &mut Recorder) + Send>;
type EventFn = Box<dyn FnMut(&Ctx, &AccountEvent, &mut Intents, &mut Recorder) + Send>;

/// A scripted strategy with closures per callback and a recorder.
struct Cs {
    rec: Recorder,
    tick: TickFn,
    event: EventFn,
    interests: Interests,
}

impl Cs {
    fn new(
        tick: impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static,
        event: impl FnMut(&Ctx, &AccountEvent, &mut Intents, &mut Recorder) + Send + 'static,
    ) -> Cs {
        Cs {
            rec: Recorder::default(),
            tick: Box::new(tick),
            event: Box::new(event),
            interests: Interests::ALL,
        }
    }
}

impl Script for Cs {
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) {
        self.rec.tick(ctx);
        (self.tick)(ctx, out, &mut self.rec);
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, out: &mut Intents) {
        self.rec.event(ctx, ev);
        (self.event)(ctx, ev, out, &mut self.rec);
    }
    fn interests(&self) -> Interests {
        self.interests
    }
}

fn standard_market() -> pmb_sdk::testkit::TestMarket {
    let mut m = market();
    books(&mut m, t(1000), price!(0.48), price!(0.52), qty!(50));
    m
}

fn is_submitted(ev: &AccountEvent, ctx: &Ctx, cid: &str) -> bool {
    matches!(ev, AccountEvent::OrderSubmitted { order, .. } if ctx.portfolio().cid_str(order) == cid)
}

fn is_open(ev: &AccountEvent, ctx: &Ctx, cid: &str) -> bool {
    matches!(ev, AccountEvent::OrderOpen { order, .. } if ctx.portfolio().cid_str(order) == cid)
}

/// The expected (kind, cid) list of a vector as `kind(cid)` tags.
fn expected_tags(r: &Value, key: &str) -> Vec<String> {
    r["expect"][key]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| format!("{}({})", e[0].as_str().unwrap(), e[1].as_str().unwrap()))
        .collect()
}

// spec: 12 §6.2 (breadth-first FIFO), 30 §4 rule 6, 22 §3.3
#[test]
fn cs01_breadth_first() {
    let r = row("cs-01-breadth-first");
    let m = standard_market();
    let (run, s) = run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 1 {
                    out.place(Order::buy(Outcome::Up, price!(0.47), qty!(5)).cid(cid!("a")));
                    out.place(Order::buy(Outcome::Down, price!(0.47), qty!(5)).cid(cid!("b")));
                }
            },
            |ctx, ev, out, _| {
                if is_submitted(ev, ctx, "a") {
                    out.place(Order::buy(Outcome::Up, price!(0.46), qty!(5)).cid(cid!("c")));
                }
            },
        ),
    );
    assert_eq!(s.rec.tags(), expected_tags(&r, "ts_compat_sequence"));
    // 22 §3.3 ordering contract: tick → its intents → events each just before the callback
    // → that callback's intents (c's place record sits right after order_submitted(a)).
    let kinds: Vec<String> = run
        .trace()
        .iter()
        .filter(|x| x["t"] == "intent" || x["t"] == "event")
        .map(|x| {
            format!(
                "{}:{}",
                x["t"].as_str().unwrap(),
                x["kind"].as_str().unwrap()
            )
        })
        .collect();
    assert_eq!(
        &kinds[..6],
        [
            "intent:place_limit",
            "intent:place_limit",
            "event:order_submitted",
            "intent:place_limit",
            "event:order_accepted",
            "event:settlement_update"
        ]
    );
    let c_intent = run.records("intent").find(|i| i["cid"] == "c").unwrap();
    assert_eq!(c_intent["src"], "account");
}

// spec: 12 §6.2 (second-level cascade), 60 §5.4 A1/A2
#[test]
fn cs02_second_level_cascade() {
    let _ = row("cs-02-second-level-cascade");
    let m = standard_market();
    let (run, s) = run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 1 {
                    out.place(Order::buy(Outcome::Up, price!(0.47), qty!(5)).cid(cid!("a")));
                    out.place(Order::buy(Outcome::Down, price!(0.47), qty!(5)).cid(cid!("b")));
                }
            },
            |ctx, ev, out, _| {
                if is_submitted(ev, ctx, "a") {
                    out.place(Order::buy(Outcome::Up, price!(0.46), qty!(5)).cid(cid!("c")));
                }
                if is_open(ev, ctx, "c") {
                    out.cancel(&cid!("a"));
                }
            },
        ),
    );
    let tags = s.rec.tags();
    let open_c = tags.iter().position(|t| t == "order_open(c)").unwrap();
    let done_a = tags.iter().position(|t| t == "order_done(a)").unwrap();
    assert!(done_a > open_c, "{tags:?}");
    assert_eq!(
        done_a,
        tags.len() - 1,
        "the cancel's event comes after every queued event: {tags:?}"
    );
    // The cancel intent is traced right after the OrderOpen(c) event record and before its result.
    let tr: Vec<&Value> = run
        .trace()
        .iter()
        .filter(|x| x["t"] == "intent" || x["t"] == "event")
        .collect();
    let i_open = tr
        .iter()
        .position(|x| x["t"] == "event" && x["kind"] == "order_open" && x["order"] == 2)
        .unwrap();
    assert_eq!(tr[i_open + 1]["kind"], "cancel_order");
    assert_eq!(tr[i_open + 1]["src"], "account");
    assert_eq!(tr[i_open + 2]["kind"], "order_done");
    assert_eq!(tr[i_open + 2]["order"], 0);
}

// spec: 12 §6.2 (ledger → OM → trace → callback), 12 §9.1, 12 §9.2
#[test]
fn cs03_ledger_applied_before_callback() {
    let _ = row("cs-03-delivery-pipeline-ledger-first");
    let mut m = standard_market();
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.49), qty!(10));
    let (_run, s) = run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 1 {
                    out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
                }
            },
            |ctx, ev, _, rec| {
                let p = ctx.portfolio();
                let in_open = p.open_orders().any(|o| p.cid_str(o) == "a");
                rec.ticks.push((
                    ctx.tick().seq,
                    ctx.now().0,
                    format!("{}:open_orders_has_a={in_open}", ev.ts_kind()),
                ));
            },
        ),
    );
    let a = s.rec.of("a");
    let sub = a.iter().find(|e| e.kind == "order_submitted").unwrap();
    assert_eq!(sub.state.as_deref(), Some("InFlight"));
    assert_eq!(
        sub.reserved,
        ts_compat_reservation(price!(0.50), qty!(5), false).micros(),
        "reservation exists from decision time"
    );
    assert!(
        s.rec
            .ticks
            .iter()
            .any(|(_, _, v)| v == "order_submitted:open_orders_has_a=true"),
        "{:?}",
        s.rec.ticks
    );
    let open = a.iter().find(|e| e.kind == "order_open").unwrap();
    assert_eq!(open.state.as_deref(), Some("Live"));
    let fill = a.iter().find(|e| e.kind == "fill").unwrap();
    assert_eq!(
        (fill.pos_up, fill.filled, fill.remaining),
        (5_000_000, Some(5_000_000), Some(0))
    );
    let done = a.iter().find(|e| e.kind == "order_done").unwrap();
    assert_eq!(done.state.as_deref(), Some("Filled"));
    assert_eq!(done.reserved, 0);
    assert!(
        s.rec
            .ticks
            .iter()
            .any(|(_, _, v)| v == "order_done:open_orders_has_a=false"),
        "{:?}",
        s.rec.ticks
    );
}

fn fok_script() -> Cs {
    Cs::new(
        |ctx, out, _| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(5))
                        .fok()
                        .cid(cid!("f")),
                );
            }
        },
        |_, _, _, _| {},
    )
}

// spec: 12 §6.1 (every delivered event is offered, incl. OrderSubmitted and every SettlementUpdate)
#[test]
fn cs04_every_event_offered() {
    let _ = row("cs-04-every-event-offered");
    let m = standard_market();
    let (run, s) = run(&m, fok_script());
    let kinds: Vec<String> = s
        .rec
        .seen
        .iter()
        .map(|e| match e.kind.as_str() {
            "settlement_update" if e.debug.contains("status: Matched") => {
                "settlement_update(Matched)".into()
            }
            "settlement_update" if e.debug.contains("status: Confirmed") => {
                "settlement_update(Confirmed)".into()
            }
            "order_done" if e.debug.contains("reason: Filled") => "order_done(Filled)".into(),
            k => k.to_string(),
        })
        .collect();
    assert_eq!(
        kinds,
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched)",
            "fill",
            "order_done(Filled)",
            "settlement_update(Confirmed)"
        ]
    );
    assert_eq!(
        s.rec.seen.len(),
        run.records("event").count(),
        "callbacks == event records (22 §3.2)"
    );
}

// spec: 30 §4.1, 16 TF-3, D69 (A-07): interests skip only the callback; trace and totals unchanged
#[test]
fn cs05_interests_skip_only_callback() {
    let _ = row("cs-05-interests-skip-only-the-callback");
    let m = standard_market();
    let (full, _) = run(&m, fok_script());
    let mut partial = fok_script();
    partial.interests = Interests {
        events: EventFlags::FILLS
            .union(EventFlags::REJECTIONS)
            .union(EventFlags::SPLIT_MERGE)
            .union(EventFlags::SETTLEMENT)
            .union(EventFlags::STREAM),
        ticks: TickInterest::All,
    };
    let (part, s) = run(&m, partial);
    let kinds: Vec<&str> = s.rec.seen.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(
        kinds,
        ["settlement_update", "fill", "settlement_update"],
        "only fill and settlement callbacks run"
    );
    assert_eq!(
        full.trace(),
        part.trace(),
        "the trace still records every delivered event (A-07, D69)"
    );
    assert_eq!(
        final_field(&full, "cash_end"),
        final_field(&part, "cash_end")
    );
}

// spec: 12 §6.3 (cascade budget → strategy_fault cascade_limit), 21 §13, 20 §4.1
// Default `runner.maxEventsPerDrain` = 4200 (the testkit has no ModelConfig
// override): an unbounded chain of FOK placements from OrderSubmitted
// callbacks (6 deliveries each) must stop the candidate.
#[test]
fn cs06_cascade_budget_fault() {
    let r = row("cs-06-cascade-budget-fault");
    assert_eq!(r["expect"]["error"]["cause"], "cascade_limit");
    let m = standard_market();
    let (res, s) = try_run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 1 {
                    out.place(
                        Order::buy(Outcome::Up, price!(0.52), qty!(0.01))
                            .fok()
                            .cid(ClientOrderId::new("r0").unwrap()),
                    );
                }
            },
            |ctx, ev, out, rec| {
                if let AccountEvent::OrderSubmitted { order, .. } = ev {
                    let n: usize = ctx.portfolio().cid_str(order)[1..].parse().unwrap();
                    rec.ticks.push((n as u64, 0, "chain".into()));
                    out.place(
                        Order::buy(Outcome::Up, price!(0.52), qty!(0.01))
                            .fok()
                            .cid(ClientOrderId::new(&format!("r{}", n + 1)).unwrap()),
                    );
                }
            },
        ),
    );
    let err = res.expect_err("the candidate must fail with strategy_fault: cascade_limit");
    assert!(err.contains("strategy_fault"), "{err}");
    assert!(err.contains("cascade_limit"), "{err}");
    // D69 (A-08): the fault is raised at the (N+1)-th counted delivery; 4200 callbacks ran.
    assert_eq!(
        s.rec.seen.len(),
        4200,
        "deliveries with callbacks before the fault"
    );
}

// spec: 12 §4.2 (event_clock), 30 §5 event_clock()
#[test]
fn cs07_event_clock() {
    let _ = row("cs-07-event-clock");
    let (t0, t1, t2) = (t(1000), t(2000), t(3000));
    let mut m = market();
    m.book(
        t0,
        Outcome::Up,
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(50))],
    );
    m.price_change(t1, Outcome::Up, Side::Sell, price!(0.52), qty!(40));
    m.price_change(t2, Outcome::Up, Side::Sell, price!(0.52), qty!(30));
    let (_run, s) = run(
        &m,
        Cs::new(
            move |ctx, out, rec| {
                rec.ticks
                    .push((ctx.tick().seq, ctx.event_clock().0, "clock".into()));
                if ctx.now() == t1 {
                    out.place(
                        Order::buy(Outcome::Up, price!(0.52), qty!(1))
                            .fok()
                            .cid(cid!("f")),
                    );
                }
            },
            |_, _, _, _| {},
        ),
    );
    let clocks: Vec<i64> = s
        .rec
        .ticks
        .iter()
        .filter(|(_, _, tag)| tag == "clock")
        .map(|(_, c, _)| *c)
        .collect();
    assert_eq!(
        clocks,
        [t0.0, t0.0, t1.0],
        "set by the first tick, advanced only by account events"
    );
    assert!(
        s.rec
            .seen
            .iter()
            .all(|e| e.event_clock == t1.0 && e.at == t1.0),
        "{:?}",
        s.rec.tags()
    );
}

// spec: 12 §4.2 (decision stamp), 13 TC-C8, D67, D69 (A-09)
#[test]
fn cs08_decision_stamp_ts_compat() {
    let _ = row("cs-08-decision-stamp-ts-compat");
    let (t0, t1) = (t(1000), t(31_000));
    let mut m = market();
    m.book(
        t0,
        Outcome::Up,
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(50))],
    );
    m.price_change(t1, Outcome::Up, Side::Sell, price!(0.49), qty!(10));
    let (_run, s) = run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 0 {
                    out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
                }
            },
            move |ctx, ev, out, rec| {
                if let AccountEvent::OrderDone { .. } = ev {
                    rec.ticks
                        .push((ctx.tick().seq, ctx.now().0, "in_done".into()));
                    out.place(
                        Order::buy(Outcome::Up, price!(0.45), qty!(1))
                            .gtd(TsMs(t1.0 + 60_000))
                            .cid(cid!("g1")),
                    );
                    out.place(
                        Order::buy(Outcome::Up, price!(0.45), qty!(1))
                            .gtd(TsMs(t1.0 + 59_999))
                            .cid(cid!("g2")),
                    );
                    out.place(
                        Order::buy(Outcome::Up, price!(0.45), qty!(1))
                            .gtd(TsMs(t0.0 + 60_000))
                            .cid(cid!("g3")),
                    );
                }
            },
        ),
    );
    let done = s.rec.ticks.iter().find(|(_, _, v)| v == "in_done").unwrap();
    assert_eq!(
        (done.0, done.1),
        (1, t1.0),
        "tick().seq == N and now() == T1 inside tick N's execution-step callbacks"
    );
    assert_eq!(s.rec.kinds_of("g1")[0], "order_submitted");
    let rejected: Vec<&Seen> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.kind == "order_rejected")
        .collect();
    assert_eq!(rejected.len(), 2, "{:?}", s.rec.tags());
    for e in rejected {
        assert!(
            e.debug
                .contains("GtdExpiryTooSoon { min_offset_ms: 60000 }"),
            "{}",
            e.debug
        );
    }
}

// spec: 12 §5.4, 60 INV-13, 13 TC-C9/TC-C13 — no callbacks outside the window (ts-compat)
#[test]
fn cs09_no_callbacks_outside_window() {
    let _ = row("cs-09-no-callbacks-outside-window");
    let mut m = market();
    m.book(
        t(1000),
        Outcome::Up,
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(50))],
    );
    m.price_change(END, Outcome::Up, Side::Sell, price!(0.52), qty!(40));
    m.price_change(
        TsMs(END.0 + 1),
        Outcome::Up,
        Side::Sell,
        price!(0.49),
        qty!(40),
    );
    m.price_change(
        TsMs(END.0 + 5000),
        Outcome::Up,
        Side::Sell,
        price!(0.49),
        qty!(30),
    );
    let (run, s) = run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 0 {
                    out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("a")));
                }
            },
            |_, _, _, _| {},
        ),
    );
    let tick_ts: Vec<i64> = s.rec.ticks.iter().map(|(_, ts, _)| *ts).collect();
    assert_eq!(
        tick_ts,
        [t(1000).0, END.0],
        "ticks at ts <= end only (inclusive gate)"
    );
    assert!(s.rec.seen.iter().all(|e| e.at <= END.0));
    assert!(
        !run.records("event")
            .any(|e| e["kind"] == "fill" || e["kind"] == "order_done"),
        "no matching after the window (execution frozen, 12 §5.4)"
    );
}

// spec: 22 §3.2 (event record fields), 22 §3.3 — the records the cascade tests read
#[test]
#[ignore = "C2-fail: 22 §3.2 event record fields: observed settlement_update without `status`/`sizeMatched`, fill without `liquidity`, order_rejected/order_done without `cid`; expected the per-kind fields of 22 §3.2 (the testkit renders keys instead of cids by design; the other fields are missing)"]
fn trace_event_records_carry_22_3_2_fields() {
    let m = standard_market();
    let (run, _s) = run(&m, fok_script());
    let su = events_of(&run, "settlement_update");
    assert!(su.iter().all(|e| e["status"].is_string()), "{su:?}");
    assert!(su.iter().all(|e| e["sizeMatched"].is_number()), "{su:?}");
    let fills = events_of(&run, "fill");
    assert!(
        fills.iter().all(|e| e["liquidity"].is_string()),
        "{fills:?}"
    );
}

// spec: 12 §6.4, 12 §5.2, 14 P-4 (previous tick's plugin snapshot)
#[test]
#[ignore = "C2-gap: the testkit's Requirements has no plugin builders yet (stand-in) and PluginsView is empty"]
fn cs10_plugin_snapshot_previous_tick() {
    let _ = row("cs-10-plugin-snapshot-previous-tick");
    todo!("D69: tick().seq == N, book N, plugins()/feeds() of tick N-1; needs a plugin through Requirements");
}

// spec: 12 §5.3 (synthetic ticks never run the execution step), 14 F-36
#[test]
#[ignore = "C2-gap: TestMarket::binance_trade is refused by run until the feed wiring merges (TODO(feeds-merge))"]
fn cs11_synthetic_tick_no_execution() {
    let _ = row("cs-11-synthetic-tick-no-execution");
    todo!("needs scripted feed updates with tick_on_update");
}

// spec: 30 §4 rule 4 (fresh instance per market), 12 §6.1
#[test]
fn cs12_fresh_instance_per_market() {
    let _ = row("cs-12-fresh-instance-per-market");
    let counter = |ctx: &Ctx, _: &mut Intents, rec: &mut Recorder| {
        rec.ticks.push((ctx.tick().seq, 0, "n".into()));
    };
    let m1 = standard_market();
    let mut m2 = TestMarket2::next();
    books(
        &mut m2,
        TsMs(START.0 + 900_000 + 1000),
        price!(0.48),
        price!(0.52),
        qty!(50),
    );
    // `common::run` asserts Strategy::new ran exactly once per market.
    let (_r1, s1) = run(&m1, Cs::new(counter, |_, _, _, _| {}));
    let (_r2, s2) = run(&m2, Cs::new(counter, |_, _, _, _| {}));
    let n = |s: &Cs| {
        s.rec
            .ticks
            .iter()
            .filter(|(_, _, tag)| tag == "n")
            .map(|(seq, _, _)| *seq)
            .collect::<Vec<_>>()
    };
    assert_eq!(n(&s1), [0, 1]);
    assert_eq!(n(&s2), [0, 1], "the counter starts at 0 in each market");
}

/// The following 15m market (for two-session tests).
struct TestMarket2;
impl TestMarket2 {
    fn next() -> pmb_sdk::testkit::TestMarket {
        pmb_sdk::testkit::TestMarket::btc_15m(TsMs(START.0 + 900_000))
            .profile(pmb_sdk::testkit::Profile::TsCompat)
    }
}

// spec: 12 §6.1 (engine-origin events offered), 60 §5.4 A1
#[test]
fn cs13_engine_origin_events_offered() {
    let _ = row("cs-13-engine-origin-events-offered");
    let m = standard_market();
    let (_run, s) = run(
        &m,
        Cs::new(
            |ctx, out, _| {
                if ctx.tick().seq == 1 {
                    out.place(Order::buy(Outcome::Up, price!(0.47), qty!(5)).cid(cid!("x11")));
                }
            },
            |ctx, ev, out, _| {
                if is_submitted(ev, ctx, "x11") {
                    out.place(Order::buy(Outcome::Up, price!(0.46), qty!(5)).cid(cid!("x11-sib")));
                }
                if is_open(ev, ctx, "x11-sib") {
                    out.cancel(&cid!("x11"));
                }
            },
        ),
    );
    assert_eq!(
        s.rec.tags(),
        [
            "order_submitted(x11)",
            "order_accepted(x11)",
            "settlement_update(x11)",
            "order_open(x11)",
            "order_submitted(x11-sib)",
            "order_accepted(x11-sib)",
            "settlement_update(x11-sib)",
            "order_open(x11-sib)",
            "order_done(x11)"
        ]
    );
}
