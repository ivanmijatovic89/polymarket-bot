// spec: 11 §4, 11 §3 (ts-compat column), 11 §12, 13 §5.1, 13 §5.2, 12 §7.4, 10 R8/R9
//
// G2 row "ts-compat rule values (11 §4)". The data tests pin the transcribed
// constants and recompute the fee numbers; the behaviors are testkit
// sessions in the ts-compat profile.

mod common;

use common::*;
use pmb_conformance::decimal::{Dec, Rounding};
use pmb_conformance::vectors::{self, rows};
use pmb_sdk::prelude::*;
use serde_json::Value;

fn file() -> Value {
    vectors::load("ts_compat_rules")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} missing"))
}

fn fee4(p: &str, q: &str) -> Dec {
    let p = Dec::parse(p);
    let v = Dec::parse("0.07")
        .mul(&p)
        .mul(&Dec::parse("1").sub(&p))
        .mul(&Dec::parse(q))
        .round(4, Rounding::HalfAwayFromZero);
    if v.cmp_num(&Dec::parse("0.0001")) == std::cmp::Ordering::Less {
        Dec::parse("0")
    } else {
        v
    }
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 11 §3 (ts-compat column), 11 §4
#[test]
fn rules_view_constants() {
    let f = file();
    let rv = &f["rules_view"];
    assert_eq!(rv["gtd_min_lead_ms"], 60000);
    assert_eq!(rv["gtd_early_expiry_ms"], 0);
    assert_eq!(rv["max_cancel_ids"], 3000);
    assert!(
        rv["max_place_batch"].is_null(),
        "unbounded: batch_cap() is None in ts-compat (D59)"
    );
    assert_eq!(rv["taker_delay_enabled"], false);
    assert!(rv["min_size_resting"].is_null() && rv["min_notional_market"].is_null());
    assert_eq!(rv["validate"], false);
    assert!(rv["output_rules"].is_null());
    for k in ["feeEra", "feeCurve", "feeSource"] {
        assert!(rv["output_fee_fields"][k].is_null());
    }
}

// spec: 11 §4 row 1, 13 TC-E7, 10 R8 — the fee numbers of the behaviors
#[test]
fn fee_behavior_numbers() {
    assert_eq!(fee4("0.53", "10").to_plain(), "0.1744");
    assert!(fee4("0.53", "10")
        .round(2, Rounding::HalfAwayFromZero)
        .eq_num(&Dec::parse("0.17")));
    assert_eq!(fee4("0.50", "10").to_plain(), "0.1750");
    assert!(fee4("0.01", "0.05").is_zero());
    assert_eq!(fee4("0.50", "10.02").to_plain(), "0.1754"); // exact 0.17535 tie
    let r = row("tc-fee-taker");
    assert!(Dec::parse(r["expect"]["fill_fee"].as_str().unwrap()).eq_num(&fee4("0.53", "10")));
    let r = row("tc-fee-4dp-tie");
    assert!(Dec::parse(r["expect"]["fill_fee"].as_str().unwrap()).eq_num(&fee4("0.50", "10.02")));
    let r = row("tc-fee-every-date");
    assert!(Dec::parse(r["expect"]["fill_fee"].as_str().unwrap()).eq_num(&fee4("0.50", "10")));
}

// spec: 13 §7.3 — the pinned ts-compat ModelConfig execution values
#[test]
fn pinned_execution_values() {
    let r = row("tc-model-config-pinned");
    let m = &r["expect"]["accepted_models"];
    assert_eq!(
        m,
        &serde_json::json!({ "latency": "compat", "fee": "flat_700bps_4dp", "takerDelay": "off", "depletion": "none", "maker": "worst_queue", "reports": "compat" })
    );
    assert_eq!(r["expect"]["accepted_other"]["sellGate"], "Matched");
}

// ---------------------------------------------------------------------------
// Behaviors (testkit sessions, ts-compat, delay 0).
// ---------------------------------------------------------------------------

type TickFn = Box<dyn FnMut(&Ctx, &mut Intents, &mut Recorder) + Send>;

struct Tc {
    rec: Recorder,
    tick: TickFn,
    cids: Vec<ClientOrderId>,
}

impl Tc {
    fn new(tick: impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static) -> Tc {
        Tc {
            rec: Recorder::default(),
            tick: Box::new(tick),
            cids: Vec::new(),
        }
    }
}

impl Script for Tc {
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) {
        self.rec.tick(ctx);
        (self.tick)(ctx, out, &mut self.rec);
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, _out: &mut Intents) {
        self.rec.event(ctx, ev);
    }
}

fn at_tick(
    seq: u64,
    mut f: impl FnMut(&mut Intents) + Send + 'static,
) -> impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static {
    move |ctx, out, _| {
        if ctx.tick().seq == seq {
            f(out)
        }
    }
}

fn fee_of(rec: &Recorder, cid: &str) -> (String, String) {
    let fill = rec
        .of(cid)
        .into_iter()
        .find(|e| e.kind == "fill")
        .expect("fill");
    let fee = fill
        .debug
        .split("fee: Usdc(")
        .nth(1)
        .unwrap()
        .split(')')
        .next()
        .unwrap()
        .to_string();
    let liq = fill
        .debug
        .split("liquidity: ")
        .nth(1)
        .unwrap()
        .split(',')
        .next()
        .unwrap()
        .to_string();
    (fee, liq)
}

/// Expected fee text as the SDK's Debug renders it (trailing zeros trimmed).
fn fee_text(v: &str) -> String {
    let d = Dec::parse(v).to_plain();
    let d = if d.contains('.') {
        d.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        d
    };
    if d.is_empty() {
        "0".into()
    } else {
        d
    }
}

// spec: 11 §4 row 1 (fee on TAKER fills, 4 dp, floor), 13 TC-E7
#[test]
fn tc_fee_taker() {
    let r = row("tc-fee-taker");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.53), qty!(50))],
    );
    let (run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.53), qty!(10))
                    .fok()
                    .cid(cid!("f")),
            )
        })),
    );
    assert_eq!(
        fee_of(&s.rec, "f"),
        (
            fee_text(r["expect"]["fill_fee"].as_str().unwrap()),
            "Taker".into()
        )
    );
    assert_eq!(
        micros(&final_field(&run, "fees_paid").unwrap()),
        micros("0.1744")
    );
}

// spec: 11 §4 row 1 (TAKER only), 13 §5.1 WorstQueueCompat (fee 0), 60 INV-10
#[test]
fn tc_fee_maker_zero() {
    let r = row("tc-fee-maker-zero");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.53), qty!(50))],
    );
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.49), qty!(5));
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.50), qty!(10))
                    .post_only()
                    .cid(cid!("m")),
            )
        })),
    );
    assert_eq!(
        fee_of(&s.rec, "m"),
        ("0".into(), "Maker".into()),
        "{:?}",
        r["expect"]
    );
    let fill = s
        .rec
        .of("m")
        .into_iter()
        .find(|e| e.kind == "fill")
        .unwrap();
    assert!(
        fill.debug.contains("price: Price(0.5), qty: Qty(10)"),
        "{}",
        fill.debug
    );
}

// spec: 11 §4 row 1 (every date, incl. before 2026-01-05), 13 TC-E7
#[test]
fn tc_fee_every_date() {
    let r = row("tc-fee-every-date");
    let start = TsMs(1_764_547_200_000);
    let mut m =
        pmb_sdk::testkit::TestMarket::btc_15m(start).profile(pmb_sdk::testkit::Profile::TsCompat);
    assert_eq!(m.slug(), "btc-updown-15m-1764547200");
    m.book(
        TsMs(start.0 + 1000),
        Outcome::Up,
        &[(price!(0.40), qty!(50))],
        &[(price!(0.50), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(0, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.50), qty!(10))
                    .fok()
                    .cid(cid!("f")),
            )
        })),
    );
    assert_eq!(
        fee_of(&s.rec, "f").0,
        fee_text(r["expect"]["fill_fee"].as_str().unwrap())
    );
}

// spec: 11 §4 row 1 (result < 0.0001 → 0)
#[test]
fn tc_fee_floor() {
    let _ = row("tc-fee-floor");
    let mut m = market();
    up_book(&mut m, t(1000), &[], &[(price!(0.01), qty!(50))]);
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.01), qty!(0.05))
                    .fok()
                    .cid(cid!("f")),
            )
        })),
    );
    assert_eq!(fee_of(&s.rec, "f").0, "0");
}

// spec: 10 R8 (4 dp HalfAwayFromZero from the exact value), 60 §3.5 PE-R3
#[test]
fn tc_fee_4dp_tie() {
    let r = row("tc-fee-4dp-tie");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.50), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.50), qty!(10.02))
                    .fok()
                    .cid(cid!("f")),
            )
        })),
    );
    assert_eq!(
        fee_of(&s.rec, "f").0,
        fee_text(r["expect"]["fill_fee"].as_str().unwrap())
    );
}

// spec: 11 §4 row 2 (reservation fee at the limit unless post-only)
#[test]
fn tc_reservation_fee() {
    let r = row("tc-reservation-fee");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(Order::buy(Outcome::Up, price!(0.53), qty!(10)).cid(cid!("a")))
        })),
    );
    assert_eq!(
        s.rec.of("a")[0].reserved,
        micros(r["expect"]["reserved_after_submit"].as_str().unwrap())
    );
}
#[test]
fn tc_reservation_post_only() {
    let r = row("tc-reservation-post-only");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.53), qty!(10))
                    .post_only()
                    .cid(cid!("a")),
            )
        })),
    );
    assert_eq!(
        s.rec.of("a")[0].reserved,
        micros(r["expect"]["reserved_after_submit"].as_str().unwrap())
    );
}

// spec: 11 §4 row 3 (no tick/bounds/min/precision validation), 12 §7.4, 13 TC-C1
#[test]
fn tc_no_tick_validation() {
    let _ = row("tc-no-tick-validation");
    let mut m = market();
    up_book(&mut m, t(1000), &[(price!(0.10), qty!(50))], &[]);
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(Order::buy(Outcome::Up, price!(0.123457), qty!(5)).cid(cid!("offtick")));
            out.place(Order::buy(Outcome::Up, price!(0.5), qty!(0.001)).cid(cid!("tiny")));
            out.place(Order::buy(Outcome::Up, price!(0.999999), qty!(5)).cid(cid!("edge")));
        })),
    );
    for c in ["offtick", "tiny", "edge"] {
        assert_eq!(
            s.rec.kinds_of(c),
            [
                "order_submitted",
                "order_accepted",
                "settlement_update",
                "order_open"
            ],
            "{c}"
        );
    }
    assert!(!s.rec.seen.iter().any(|e| e.kind == "order_rejected"));
}

// spec: 11 §4 row 3 (only positivity), 10 §10.2, 60 §5.3 x19/x20
#[test]
fn tc_only_positivity() {
    let r = row("tc-only-positivity");
    assert_eq!(r["expect"]["no_order_submitted"], true);
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(Order::buy(Outcome::Up, Price::ZERO, qty!(5)).cid(cid!("p0")));
            out.place(Order::buy(Outcome::Up, price!(0.5), Qty::ZERO).cid(cid!("s0")));
        })),
    );
    let kinds: Vec<&str> = s.rec.seen.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, ["order_rejected", "order_rejected"]);
    assert!(
        s.rec.seen[0].debug.contains("InvalidPrice") && s.rec.seen[1].debug.contains("InvalidSize")
    );
    let reasons: Vec<&Value> = run.records("event").map(|e| &e["reason"]).collect();
    assert_eq!(
        reasons,
        [&Value::from("invalid_price"), &Value::from("invalid_size")]
    );
    assert_eq!(RejectReason::InvalidPrice.code(), "invalid_price");
    assert_eq!(RejectReason::InvalidSize.code(), "invalid_size");
}

// spec: 12 §7.4, 10 §10.2 PostOnlyRequiresResting
#[test]
#[ignore = "C2-gap: a post-only FOK is unrepresentable through the SDK builders (30 §7.1 typestate: LimitOrder<true> has no .fok()); only reachable via the job/raw path"]
fn tc_post_only_fok() {
    let _ = row("tc-post-only-fok");
    todo!("needs a raw OrderRequest or an EngineJob through the binary");
}

// spec: 11 §4 row 4 (GTD decision-time offset)
#[test]
fn tc_gtd_decision_offset() {
    let _ = row("tc-gtd-decision-offset");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(|ctx, out, _| {
            if ctx.tick().seq == 1 {
                let now = ctx.now();
                out.place(
                    Order::buy(Outcome::Up, price!(0.5), qty!(5))
                        .gtd(TsMs(now.0 + 60_000))
                        .cid(cid!("ok")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.5), qty!(5))
                        .gtd(TsMs(now.0 + 59_999))
                        .cid(cid!("soon")),
                );
            }
        }),
    );
    assert_eq!(s.rec.kinds_of("ok")[0], "order_submitted");
    let rej = s
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "order_rejected")
        .unwrap();
    assert!(
        rej.debug
            .contains("GtdExpiryTooSoon { min_offset_ms: 60000 }"),
        "{}",
        rej.debug
    );
    assert_eq!(
        RejectReason::GtdExpiryTooSoon {
            min_offset_ms: 60_000
        }
        .code(),
        "gtd_expireAtMs_too_soon"
    );
}

// spec: 11 §4 row 4 (expires exactly at expireAtMs; expiry checked before fills), 13 §5.1
#[test]
fn tc_gtd_exact_expiry() {
    let r = row("tc-gtd-exact-expiry");
    assert!(r["expect"]["at_E"].as_str().unwrap().contains("NO fill"));
    let e = t(1000 + 60_000);
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    m.price_change(
        TsMs(e.0 - 1),
        Outcome::Up,
        Side::Sell,
        price!(0.55),
        qty!(5),
    );
    m.price_change(e, Outcome::Up, Side::Sell, price!(0.45), qty!(5));
    let (_run, s) = run(
        &m,
        Tc::new(move |ctx, out, rec| {
            if ctx.tick().seq == 1 {
                out.place(
                    Order::buy(Outcome::Up, price!(0.5), qty!(5))
                        .gtd(e)
                        .cid(cid!("g")),
                );
            }
            if ctx.now().0 == e.0 - 1 {
                rec.ticks.push((
                    90,
                    0,
                    format!("{:?}", ctx.portfolio().order(&cid!("g")).unwrap().state()),
                ));
            }
        }),
    );
    assert_eq!(
        s.rec.ticks.iter().find(|(k, _, _)| *k == 90).unwrap().2,
        "Live"
    );
    let g = s.rec.of("g");
    assert!(!g.iter().any(|x| x.kind == "fill"));
    let done = g.last().unwrap();
    assert!(
        done.debug.contains("reason: Expired") && done.at == e.0,
        "{}",
        done.debug
    );
}

// spec: 11 §4 row 5 (no taker delay), 13 TC-E10
#[test]
fn tc_no_taker_delay() {
    let _ = row("tc-no-taker-delay");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(Order::buy(Outcome::Up, price!(0.60), qty!(5)).cid(cid!("m")))
        })),
    );
    let fill = s
        .rec
        .of("m")
        .into_iter()
        .find(|e| e.kind == "fill")
        .unwrap();
    assert_eq!(
        (fill.seq, fill.at),
        (1, t(1000).0),
        "fills at execution on the same tick"
    );
    assert!(!run.records("event").any(|e| e["kind"] == "order_delayed"));
}

// spec: 11 §4 row 6 (no batch cap), 13 TC-C12, 60 §5.5 (b16)
#[test]
fn tc_no_batch_cap() {
    let _ = row("tc-no-batch-cap");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let mut s = Tc::new(|_, _, _| {});
    s.cids = (0..16)
        .map(|i| ClientOrderId::new(&format!("b{i}")).unwrap())
        .collect();
    let cids = s.cids.clone();
    s.tick = Box::new(move |ctx, out, _| {
        if ctx.tick().seq == 1 {
            let orders: Vec<LimitOrder<true>> = cids
                .iter()
                .map(|c| {
                    Order::buy(Outcome::Up, price!(0.01), qty!(1))
                        .post_only()
                        .cid(c.clone())
                })
                .collect();
            out.place_batch(orders.iter().map(LimitOrder::batch_item));
        }
    });
    let (run, s) = run(&m, s);
    assert_eq!(
        s.rec
            .seen
            .iter()
            .filter(|e| e.kind == "order_submitted")
            .count(),
        16
    );
    assert!(!s.rec.seen.iter().any(|e| e.kind == "order_rejected"));
    let intent = run.records("intent").next().unwrap();
    assert_eq!(intent["kind"], "place_batch");
    assert_eq!(intent["orders"].as_array().unwrap().len(), 16);
}

// spec: 11 §4 row 7 (cancel-id cap 3000), D62 (TooManyIds = invalid_cancel_batch_size)
#[test]
fn tc_cancel_id_cap_3000() {
    let _ = row("tc-cancel-id-cap-3000");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    m.price_change(t(2000), Outcome::Up, Side::Buy, price!(0.40), qty!(40));
    let mut s = Tc::new(|_, _, _| {});
    s.cids = (0..3001)
        .map(|i| ClientOrderId::new(&format!("c{i}")).unwrap())
        .collect();
    let cids = s.cids.clone();
    s.tick = Box::new(move |ctx, out, _| match ctx.tick().seq {
        1 => out.cancel_batch(cids[..3000].iter().map(CancelRef::Cid)),
        2 => out.cancel_batch(cids.iter().map(CancelRef::Cid)),
        _ => {}
    });
    let (run, s) = run(&m, s);
    assert!(
        !s.rec
            .seen
            .iter()
            .any(|e| e.seq == 1 && e.debug.contains("TooManyIds")),
        "3000 refs are processed"
    );
    let too_many: Vec<&Seen> = s
        .rec
        .seen
        .iter()
        .filter(|e| e.seq == 2 && e.kind == "cancel_failed")
        .collect();
    assert_eq!(
        too_many.len(),
        1,
        "one CancelFailed for the whole 3001-ref intent: {:?}",
        s.rec.tags()
    );
    assert!(
        too_many[0].debug.contains("TooManyIds"),
        "{}",
        too_many[0].debug
    );
    let rec = run
        .records("event")
        .find(|e| e["kind"] == "cancel_failed" && e["seq"] == 2)
        .unwrap();
    assert_eq!(rec["reason"], "invalid_cancel_batch_size");
    assert_eq!(
        CancelFailReason::TooManyIds.code(),
        "invalid_cancel_batch_size"
    );
}

// spec: 11 §4 row 8 (post-only: equality crosses), 13 §5.1 step 1
#[test]
fn tc_post_only_equality_crosses() {
    let _ = row("tc-post-only-equality-crosses");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.60), qty!(5))
                    .post_only()
                    .cid(cid!("b60")),
            );
            out.place(
                Order::buy(Outcome::Up, price!(0.59), qty!(5))
                    .post_only()
                    .cid(cid!("b59")),
            );
            out.place(
                Order::sell(Outcome::Up, price!(0.40), qty!(5))
                    .post_only()
                    .cid(cid!("s40")),
            );
        })),
    );
    assert_eq!(s.rec.kinds_of("b60"), ["order_submitted", "order_rejected"]);
    assert!(s.rec.of("b60")[1].debug.contains("PostOnlyWouldCross"));
    assert_eq!(
        s.rec.kinds_of("b59"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open"
        ]
    );
    assert_eq!(s.rec.kinds_of("s40"), ["order_submitted", "order_rejected"]);
    assert!(run
        .records("event")
        .filter(|e| e["kind"] == "order_rejected")
        .all(|e| e["reason"] == "post_only_would_cross"));
}

// spec: 11 §4 row 8 (empty opposite side accepts)
#[test]
fn tc_post_only_empty_side_accepts() {
    let _ = row("tc-post-only-empty-side-accepts");
    let mut m = market();
    up_book(&mut m, t(1000), &[(price!(0.40), qty!(50))], &[]);
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.99), qty!(5))
                    .post_only()
                    .cid(cid!("po")),
            )
        })),
    );
    assert_eq!(
        s.rec.kinds_of("po"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open"
        ]
    );
}

// spec: 11 §4 row 8 (checked at execution time)
#[test]
#[ignore = "C2-gap: the testkit has no ModelConfig override (compatLatency.delayMs 140 needed); D71 also drops delay > 0 from parity"]
fn tc_post_only_checked_at_execution() {
    let _ = row("tc-post-only-checked-at-execution");
    todo!("needs compatLatency.delayMs = 140");
}

// spec: 13 TC-C14 (no self-cross check; own orders never in the TS book)
#[test]
fn tc_no_self_cross_check() {
    let _ = row("tc-no-self-cross-check");
    let mut m = market();
    up_book(&mut m, t(1000), &[(price!(0.40), qty!(50))], &[]);
    m.price_change(t(2000), Outcome::Up, Side::Buy, price!(0.40), qty!(40));
    let (run, s) = run(
        &m,
        Tc::new(|ctx, out, _| match ctx.tick().seq {
            1 => out.place(Order::buy(Outcome::Up, price!(0.55), qty!(5)).cid(cid!("own-buy"))),
            2 => out.place(Order::sell(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("sell"))),
            _ => {}
        }),
    );
    assert_eq!(
        s.rec.kinds_of("own-buy"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open"
        ]
    );
    assert_eq!(
        s.rec.kinds_of("sell"),
        [
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open"
        ],
        "no SelfCross; the SELL never matches the own BUY"
    );
    assert!(!run.records("event").any(|e| e["kind"] == "fill"));
}

// spec: 13 TC-C4 (naked sell), 12 §9.5
#[test]
fn tc_naked_sell() {
    let _ = row("tc-naked-sell");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(Order::sell(Outcome::Up, price!(0.48), qty!(5)).cid(cid!("naked")))
        })),
    );
    let fill = s
        .rec
        .of("naked")
        .into_iter()
        .find(|e| e.kind == "fill")
        .expect("accepted and filled");
    assert!(fill.debug.contains("liquidity: Taker"));
    assert_eq!(fill.pos_up, 0);
    assert_eq!(
        fill.cash,
        500_000_000 + 2_400_000 - ts_compat_fee(price!(0.48), qty!(5)).micros()
    );
}

// spec: 13 TC-C9, 12 §5.4 (ts-compat gate: tick.ts in [start, end] inclusive)
#[test]
fn tc_window_gate_inclusive() {
    let r = row("tc-window-gate-inclusive");
    assert_eq!(r["expect"]["eventsProcessed"], 4);
    let mut m = market();
    for at in [TsMs(START.0 - 1), START, END, TsMs(END.0 + 1)] {
        m.book(
            at,
            Outcome::Up,
            &[(price!(0.40), qty!(50))],
            &[(price!(0.60), qty!(50))],
        );
    }
    let (run, s) = run(&m, Tc::new(|_, _, _| {}));
    let ts: Vec<i64> = s.rec.ticks.iter().map(|(_, ts, _)| *ts).collect();
    assert_eq!(ts, [START.0, END.0], "exactly the ticks at start and end");
    let seqs: Vec<i64> = run
        .records("tick")
        .map(|x| x["seq"].as_i64().unwrap())
        .collect();
    assert_eq!(seqs, [0, 1]);
}

// spec: 13 TC-C13 (no action at market end)
#[test]
fn tc_no_action_at_end() {
    let _ = row("tc-no-action-at-end");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    m.book(
        END,
        Outcome::Up,
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (run, s) = run(
        &m,
        Tc::new(|ctx, out, rec| {
            if ctx.tick().seq == 1 {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("rest")));
            }
            rec.ticks.push((
                90,
                ctx.now().0,
                format!(
                    "{:?}",
                    ctx.portfolio().order(&cid!("rest")).map(|o| o.state())
                ),
            ));
        }),
    );
    assert!(!run.records("event").any(|e| e["kind"] == "order_done"));
    let last = s
        .rec
        .ticks
        .iter()
        .filter(|(k, _, _)| *k == 90)
        .last()
        .unwrap();
    assert_eq!((last.1, last.2.as_str()), (END.0, "Some(Live)"));
}

// spec: 13 §5.1 CompatStatus (TC-E8), 10 V1, 22 §3.2
#[test]
fn tc_compat_status_events() {
    let _ = row("tc-compat-status-events");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.49), qty!(5));
    let (run, s) = run(
        &m,
        Tc::new(at_tick(1, |out| {
            out.place(
                Order::buy(Outcome::Up, price!(0.60), qty!(5))
                    .fok()
                    .cid(cid!("fok")),
            );
            out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("gtc")));
        })),
    );
    let fok: Vec<String> = s
        .rec
        .of("fok")
        .iter()
        .map(|e| {
            if e.kind == "settlement_update" {
                format!(
                    "su:{}",
                    e.debug
                        .split("status: ")
                        .nth(1)
                        .unwrap()
                        .trim_end_matches(" }")
                )
            } else {
                e.kind.clone()
            }
        })
        .collect();
    assert_eq!(
        fok,
        [
            "order_submitted",
            "order_accepted",
            "su:Matched",
            "fill",
            "order_done",
            "su:Confirmed"
        ]
    );
    assert!(
        s.rec.of("fok")[2].debug.contains("fill: None")
            && s.rec.of("fok")[5].debug.contains("fill: None")
    );
    let gtc: Vec<&str> = s.rec.of("gtc").iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(
        gtc,
        [
            "order_submitted",
            "order_accepted",
            "settlement_update",
            "order_open",
            "fill",
            "order_done"
        ],
        "nothing for the later maker fill"
    );
    assert!(!s.rec.seen.iter().any(|e| e.debug.contains("status: Mined")));
    assert_eq!(
        run.records("event")
            .filter(|e| e["kind"] == "settlement_update")
            .count(),
        3,
        "both recorded as settlement_update (22 §3.2)"
    );
    assert_eq!(SettlementStatus::Matched.as_ts_str(), "MATCHED");
    assert_eq!(SettlementStatus::Confirmed.as_ts_str(), "CONFIRMED");
    // The `status` field of the trace record is asserted by cascades::trace_event_records_carry_22_3_2_fields (C2-fail).
}

// spec: 13 TC-E9 (split/merge synchronous, never failing for a funded request)
#[test]
fn tc_split_merge_sync() {
    let _ = row("tc-split-merge-sync");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    // The merge sees only delivered shares (12 §9.1), so it goes on the next tick; a merge in
    // the same list as its split fails InsufficientPairs (12 §7.3) — see PLAN A-21.
    up_book(
        &mut m,
        t(2000),
        &[(price!(0.40), qty!(50))],
        &[(price!(0.60), qty!(50))],
    );
    let (_run, s) = run(
        &m,
        Tc::new(|ctx, out, _| match ctx.tick().seq {
            1 => out.split(qty!(5)),
            3 => out.merge(qty!(3)),
            _ => {}
        }),
    );
    let tags: Vec<(&str, u64)> = s
        .rec
        .seen
        .iter()
        .map(|e| (e.kind.as_str(), e.seq))
        .collect();
    assert_eq!(
        tags,
        [("positions_split", 1), ("positions_merged", 3)],
        "synchronous: each delivered inside its own tick's cascade"
    );
    assert!(s.rec.seen[0].debug.contains("size: Qty(5), cost: Usdc(5)"));
    assert!(s.rec.seen[1].debug.contains("size: Qty(3)"));
    assert_eq!(
        (
            s.rec.seen[1].pos_up,
            s.rec.seen[1].pos_down,
            s.rec.seen[1].cash
        ),
        (2_000_000, 2_000_000, 498_000_000)
    );
}

// spec: 13 §7.3, 21 §8 C4 (pinned values; any other value invalid_input)
#[test]
#[ignore = "C2-gap: needs the artifact binary (EngineJob with a modelConfig)"]
fn tc_model_config_pinned() {
    let _ = row("tc-model-config-pinned");
    todo!("binary");
}
// spec: 11 §13.8, 11 FT1 (ts-compat outputs rules: null)
#[test]
#[ignore = "C2-gap: needs the artifact binary (MarketStats output)"]
fn tc_outputs_rules_null() {
    let _ = row("tc-outputs-rules-null");
    todo!("binary");
}
