// spec: 10 §9.4 C1–C4, 10 §3.3 R5/R6/R9, 12 §7.5, 12 §9.4, 12 §9.5, 12 §9.6, 11 §4, 60 INV-1/2/3/7
//
// G2 row "capital C1–C4". The data tests recompute every derived number of
// vectors/capital.json with the exact decimal helper so that a wrong
// derivation is caught before C2 binds the scenarios to the testkit.

mod common;

use common::*;
use pmb_conformance::decimal::{Dec, Rounding};
use pmb_conformance::vectors::{self, rows, s};
use pmb_sdk::prelude::*;
use serde_json::Value;

fn file() -> Value {
    vectors::load("capital")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} missing"))
}

fn d(t: &str) -> Dec {
    Dec::parse(t)
}

/// ts-compat fee at the limit: round4(0.07 × p × (1 − p) × size), < 0.0001 → 0
/// (11 §4, src/trading/fees.ts:18-42).
fn fee_ts_compat(p: &Dec, q: &Dec) -> Dec {
    let v = d("0.07")
        .mul(p)
        .mul(&d("1").sub(p))
        .mul(q)
        .round(4, Rounding::HalfAwayFromZero);
    if v.cmp_num(&d("0.0001")) == std::cmp::Ordering::Less {
        d("0")
    } else {
        v
    }
}

/// Realistic F3 fee: round5(0.07 × p × (1 − p) × size) (11 §5.2).
fn fee_f3(p: &Dec, q: &Dec) -> Dec {
    d("0.07")
        .mul(p)
        .mul(&d("1").sub(p))
        .mul(q)
        .round(5, Rounding::HalfAwayFromZero)
}

/// ts-compat BUY reservation (10 R9, capital.ts:16-28).
fn reservation_ts_compat(p: &Dec, q: &Dec, post_only: bool) -> Dec {
    let notional = p.mul(q).round(6, Rounding::HalfAwayFromZero);
    if post_only {
        notional
    } else {
        notional.add(&fee_ts_compat(p, q))
    }
}

/// Realistic share-sized BUY reservation (10 C1, R5 Ceil).
fn reservation_realistic_shares(p: &Dec, q: &Dec, post_only: bool) -> Dec {
    let notional = p.mul(q).round(6, Rounding::Ceil);
    if post_only {
        notional
    } else {
        notional.add(&fee_f3(p, q))
    }
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 10 R9 (ts-compat), 11 §4 row 2, 12 §7.5
#[test]
fn c1_ts_compat_reservation_vectors() {
    for id in [
        "c1-ts-compat-reservation",
        "c1-ts-compat-post-only",
        "c1-ts-compat-resting-still-fee",
        "c1-ts-compat-notional-half-away",
    ] {
        let r = row(id);
        let o = &r["order"];
        let got = reservation_ts_compat(
            &d(s(o, "limit")),
            &d(s(o, "size")),
            o["post_only"].as_bool().unwrap(),
        );
        assert!(
            got.eq_num(&d(s(&r, "expected_reservation"))),
            "{id}: got {got}"
        );
    }
}

// spec: 10 C1 (share-sized), 10 R5 (Ceil)
#[test]
fn c1_realistic_share_sized_reservation_vectors() {
    for id in [
        "c1-realistic-notional-ceil",
        "c1-realistic-share-sized",
        "c1-realistic-post-only-notional-only",
    ] {
        let r = row(id);
        let o = &r["order"];
        let got = reservation_realistic_shares(
            &d(s(o, "limit")),
            &d(s(o, "size")),
            o["post_only"].as_bool().unwrap(),
        );
        assert!(
            got.eq_num(&d(s(&r, "expected_reservation"))),
            "{id}: got {got}"
        );
    }
    // bound check of c1-realistic-share-sized: a fill at 0.50 costs less than the reservation
    let fill_cost = d("0.50").mul(&d("10")).add(&fee_f3(&d("0.50"), &d("10")));
    assert!(fill_cost.eq_num(&d("5.175")));
    assert!(fill_cost.cmp_num(&d("5.47437")) == std::cmp::Ordering::Less);
}

// spec: 10 C1 (collateral-sized BUY: amount + amount × rate × (1 − tick))
#[test]
fn c1_realistic_collateral_sized_reservation() {
    let r = row("c1-realistic-collateral-sized");
    let amount = d(s(&r["order"], "amount"));
    let tick = d(s(&r, "tick"));
    let bound = amount.mul(&d("0.07")).mul(&d("1").sub(&tick));
    let got = amount.add(&bound);
    assert!(got.eq_num(&d(s(&r, "expected_reservation"))), "got {got}");
    // Derivation check: the fee of (amount / p) shares at p is 0.7 × (1 − p), decreasing in p,
    // so the maximum over [tick, limit] is at p = tick.
    for p in ["0.01", "0.02", "0.25", "0.53"] {
        let shares_fee = d("0.7").mul(&d("1").sub(&d(p)));
        assert!(
            shares_fee.cmp_num(&bound) != std::cmp::Ordering::Greater,
            "p = {p}"
        );
    }
}

// spec: 12 §7.5 (exact comparison), 10 §10.2 (reject string)
#[test]
fn funding_boundary_vectors() {
    let accept = row("funding-exact-boundary-accept");
    let reserve = reservation_ts_compat(
        &d(s(&accept["order"], "limit")),
        &d(s(&accept["order"], "size")),
        false,
    );
    assert!(reserve.cmp_num(&d(s(&accept, "starting_capital"))) != std::cmp::Ordering::Greater);
    let reject = row("funding-one-micro-short-reject");
    assert!(reserve.cmp_num(&d(s(&reject, "starting_capital"))) == std::cmp::Ordering::Greater);
    assert_eq!(
        s(&reject, "reject_ts_string"),
        "insufficient_capital(required=5.4744,available=5.474399)"
    );
    // the second-order vector: required 5.000001 (both roundings agree on a half-micro tie)
    let second = row("funding-second-order-sees-first-reservation");
    let o2 = &second["orders"][1];
    let exact = d(s(o2, "limit")).mul(&d(s(o2, "size")));
    assert!(exact.eq_num(&d("5.0000005")));
    assert!(exact.round(6, Rounding::Ceil).eq_num(&d("5.000001")));
    assert!(exact
        .round(6, Rounding::HalfAwayFromZero)
        .eq_num(&d("5.000001")));
}

// spec: 10 C3, 12 §9.4 (outstanding = max(0, final.unwrap_or(size) − delivered filled))
#[test]
fn c3_release_partial_then_terminal_steps() {
    let r = row("c3-release-partial-then-terminal");
    let steps = r["steps"].as_array().unwrap();
    let limit = d("0.53");
    // step 0: full reservation
    assert!(reservation_ts_compat(&limit, &d("10"), false).eq_num(&d(s(&steps[0], "reserved"))));
    // step 1: fill 4 @ 0.52 taker
    let fee = fee_ts_compat(&d("0.52"), &d("4"));
    assert!(fee.eq_num(&d("0.0699")));
    let cash = d("500").sub(&d("0.52").mul(&d("4"))).sub(&fee);
    assert!(cash.eq_num(&d(s(&steps[1], "cash"))), "cash {cash}");
    let reserved = reservation_ts_compat(&limit, &d("6"), false);
    assert!(
        reserved.eq_num(&d(s(&steps[1], "reserved"))),
        "reserved {reserved}"
    );
    // step 2: terminal releases everything
    assert!(d(s(&steps[2], "reserved")).is_zero());
    assert!(d(s(&steps[2], "cash")).eq_num(&cash));
}

/// Checks `pnl == cash_end − starting + Σ qty × payout == realized + settlement − Σ basis − split_cost`.
fn assert_identity(
    id: &str,
    cash_end: &Dec,
    starting: &Dec,
    settlement: &Dec,
    realized: &Dec,
    basis: &Dec,
    split_cost: &Dec,
    pnl: &Dec,
) {
    let lhs = cash_end.sub(starting).add(settlement);
    let rhs = realized.add(settlement).sub(basis).sub(split_cost);
    assert!(lhs.eq_num(pnl), "{id}: cash-based pnl {lhs} != {pnl}");
    assert!(rhs.eq_num(pnl), "{id}: decomposition {rhs} != {pnl}");
}

// spec: 10 C4, 12 §9.5, 12 §9.6, 60 INV-7
#[test]
fn c4_identity_taker_buy_vectors() {
    let fee = fee_ts_compat(&d("0.50"), &d("10"));
    assert!(fee.eq_num(&d("0.175")));
    let basis = d("5").add(&fee);
    let cash_end = d("500").sub(&basis);
    let win = row("c4-pnl-identity-taker-buy-win");
    assert!(cash_end.eq_num(&d(s(&win["expected"], "cash_end"))));
    assert_identity(
        "win",
        &cash_end,
        &d("500"),
        &d("10"),
        &d("0"),
        &basis,
        &d("0"),
        &d("4.825"),
    );
    assert_eq!(win["expected"]["pnl_micros"].as_i64(), Some(4_825_000));
    assert_eq!(
        d("4.825").round(2, Rounding::HalfAwayFromZero).to_plain(),
        s(&win["expected"], "pnl_rounded")
    );
    let lose = row("c4-pnl-identity-taker-buy-lose");
    assert_identity(
        "lose",
        &cash_end,
        &d("500"),
        &d("0"),
        &d("0"),
        &basis,
        &d("0"),
        &d(s(&lose["expected"], "pnl")),
    );
    assert_eq!(
        d("-5.175").round(2, Rounding::HalfAwayFromZero).to_plain(),
        s(&lose["expected"], "pnl_rounded")
    );
}

// spec: 12 §9.5 (SELL fill: removed basis R10, realized R11)
#[test]
fn c4_sell_realized_vector() {
    let r = row("c4-sell-realized");
    let e = &r["expected"];
    let buy_fee = fee_ts_compat(&d("0.50"), &d("10"));
    let basis0 = d("5").add(&buy_fee); // 5.175
    let sell_fee = fee_ts_compat(&d("0.60"), &d("4"));
    assert!(sell_fee.eq_num(&d(s(e, "sell_fee"))));
    let removed = basis0
        .mul(&d("4"))
        .mul(&d("0.1"))
        .round(6, Rounding::HalfAwayFromZero); // × 4 / 10
    assert!(removed.eq_num(&d(s(e, "removed_basis"))));
    let proceeds = d("0.60").mul(&d("4"));
    let realized = proceeds.sub(&sell_fee).sub(&removed);
    assert!(realized.eq_num(&d(s(e, "realized"))), "realized {realized}");
    let basis_after = basis0.sub(&removed);
    assert!(basis_after.eq_num(&d(s(e, "basis_after"))));
    let cash_end = d("500").sub(&basis0).add(&proceeds).sub(&sell_fee);
    assert!(cash_end.eq_num(&d(s(e, "cash_end"))), "cash_end {cash_end}");
    assert_identity(
        "sell",
        &cash_end,
        &d("500"),
        &d("0"),
        &realized,
        &basis_after,
        &d("0"),
        &d(s(e, "pnl")),
    );
    assert_eq!(
        d(s(e, "pnl"))
            .round(2, Rounding::HalfAwayFromZero)
            .to_plain(),
        s(e, "pnl_rounded")
    );
}

// spec: 12 §9.5 (split: zero basis; merge: realizes size − removed basis)
#[test]
fn c4_split_and_merge_vectors() {
    let split = row("c4-split-zero-basis");
    let e = &split["expected"];
    assert_identity(
        "split",
        &d(s(e, "cash_after_split")),
        &d("500"),
        &d("5"),
        &d("0"),
        &d("0"),
        &d(s(e, "split_cost")),
        &d(s(e, "pnl")),
    );
    let merge = row("c4-merge-realizes");
    let e = &merge["expected"];
    assert_identity(
        "merge",
        &d(s(e, "cash_end")),
        &d("500"),
        &d("0"),
        &d(s(e, "realized")),
        &d("0"),
        &d(s(e, "split_cost")),
        &d(s(e, "pnl")),
    );
    let avg = row("c4-merge-average-cost");
    let e = &avg["expected"];
    let basis_up0 = d("5").add(&fee_ts_compat(&d("0.50"), &d("10")));
    let basis_down0 = d("4").add(&fee_ts_compat(&d("0.40"), &d("10")));
    assert!(basis_down0.eq_num(&d("4.168")));
    let cash_after_buys = d("500").sub(&basis_up0).sub(&basis_down0);
    assert!(cash_after_buys.eq_num(&d(s(e, "cash_after_buys"))));
    let removed_up = basis_up0
        .mul(&d("0.4"))
        .round(6, Rounding::HalfAwayFromZero);
    let removed_down = basis_down0
        .mul(&d("0.4"))
        .round(6, Rounding::HalfAwayFromZero);
    assert!(removed_up.eq_num(&d(s(e, "removed_up"))));
    assert!(removed_down.eq_num(&d(s(e, "removed_down"))));
    let realized = d("4").sub(&removed_up).sub(&removed_down);
    assert!(realized.eq_num(&d(s(e, "realized"))));
    let basis = basis_up0
        .sub(&removed_up)
        .add(&basis_down0.sub(&removed_down));
    let cash_end = cash_after_buys.add(&d("4"));
    assert!(cash_end.eq_num(&d(s(e, "cash_after_merge"))));
    assert_identity(
        "merge-avg",
        &cash_end,
        &d("500"),
        &d("6"),
        &realized,
        &basis,
        &d("0"),
        &d(s(e, "pnl")),
    );
}

// spec: 12 §9.4 (sale proceeds available immediately; turnover may exceed capital)
#[test]
fn turnover_vector_arithmetic() {
    let cost = d("5").add(&fee_ts_compat(&d("0.50"), &d("10")));
    let proceeds = d("5").sub(&fee_ts_compat(&d("0.50"), &d("10")));
    let available = d("6").sub(&cost).add(&proceeds);
    assert!(available.eq_num(&d("5.65")));
    assert!(available.cmp_num(&cost) != std::cmp::Ordering::Less);
}

// ---------------------------------------------------------------------------
// Sessions (ts-compat, delay 0) through the testkit.
// ---------------------------------------------------------------------------

type TickFn = Box<dyn FnMut(&Ctx, &mut Intents, &mut Recorder) + Send>;

struct Cap {
    rec: Recorder,
    tick: TickFn,
    /// Σ cost of delivered PositionsSplit (for the identity).
    split_cost: i64,
    /// Running cash recomputed from delivered movements (INV-1).
    expected_cash: i64,
    starting: i64,
    identity_checks: usize,
}

impl Cap {
    fn new(
        starting: Usdc,
        tick: impl FnMut(&Ctx, &mut Intents, &mut Recorder) + Send + 'static,
    ) -> Cap {
        Cap {
            rec: Recorder::default(),
            tick: Box::new(tick),
            split_cost: 0,
            expected_cash: starting.micros(),
            starting: starting.micros(),
            identity_checks: 0,
        }
    }
}

impl Script for Cap {
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) {
        self.rec.tick(ctx);
        (self.tick)(ctx, out, &mut self.rec);
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, _out: &mut Intents) {
        self.rec.event(ctx, ev);
        // INV-1: cash == starting + Σ delivered movements.
        match ev {
            AccountEvent::Fill { fill, .. } => {
                let notional = fill
                    .price
                    .notional(fill.qty, pmb_sdk::prelude::Rounding::HalfAwayFromZero)
                    .unwrap()
                    .micros();
                match fill.side {
                    Side::Buy => self.expected_cash -= notional + fill.fee.micros(),
                    Side::Sell => self.expected_cash += notional - fill.fee.micros(),
                }
            }
            AccountEvent::PositionsSplit { cost, .. } => {
                self.expected_cash -= cost.micros();
                self.split_cost += cost.micros();
            }
            AccountEvent::PositionsMerged { size, .. } => self.expected_cash += size.micros(),
            _ => {}
        }
        let p = ctx.portfolio();
        assert_eq!(
            p.capital().cash.micros(),
            self.expected_cash,
            "INV-1 after {}",
            ev.ts_kind()
        );
        assert_eq!(p.capital().starting.micros(), self.starting);
        // C4 / INV-7 without the payout term: cash − starting == realized − Σ basis − split_cost.
        let basis = p.position(Outcome::Up).cost_basis.micros()
            + p.position(Outcome::Down).cost_basis.micros();
        assert_eq!(
            p.capital().cash.micros() - self.starting,
            p.realized_pnl().micros() - basis - self.split_cost,
            "PnL identity after {} (12 §9.6)",
            ev.ts_kind()
        );
        self.identity_checks += 1;
    }
}

fn standard_market() -> pmb_sdk::testkit::TestMarket {
    let mut m = market();
    books(&mut m, t(1000), price!(0.48), price!(0.52), qty!(50));
    m
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

fn reserved_in(rec: &Recorder, kind: &str, cid: &str) -> i64 {
    rec.of(cid)
        .iter()
        .find(|e| e.kind == kind)
        .unwrap()
        .reserved
}

// spec: 10 C1 (ts-compat R9), 12 §7.5 — reserved after OrderSubmitted equals the vector
#[test]
fn c1_ts_compat_reservation_in_session() {
    let r1 = row("c1-ts-compat-reservation");
    let r2 = row("c1-ts-compat-resting-still-fee");
    let mut m = market();
    books(&mut m, t(1000), price!(0.30), price!(0.60), qty!(50));
    books(&mut m, t(2000), price!(0.30), price!(0.60), qty!(50));
    // Both intents of one list are applied at emission before the first callback runs
    // (12 §9.1), so `b` goes on a later tick to read each reservation on its own.
    let (_run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => out.place(Order::buy(Outcome::Up, price!(0.53), qty!(10)).cid(cid!("a"))),
            3 => out.place(Order::buy(Outcome::Up, price!(0.40), qty!(10)).cid(cid!("b"))),
            _ => {}
        }),
    );
    let a = reserved_in(&sc.rec, "order_submitted", "a");
    let b = reserved_in(&sc.rec, "order_submitted", "b");
    assert_eq!(
        a,
        micros(s(&r1, "expected_reservation")),
        "5.4744 in the OrderSubmitted callback"
    );
    assert_eq!(
        b - a,
        micros(s(&r2, "expected_reservation")),
        "4.168 even though the order rests"
    );
    assert_eq!(
        a,
        ts_compat_reservation(price!(0.53), qty!(10), false).micros()
    );
}

// spec: 10 R9 (0 fee if post-only), 10 R5 (HalfAwayFromZero notional)
#[test]
fn c1_ts_compat_post_only_in_session() {
    let r = row("c1-ts-compat-post-only");
    let r0 = row("c1-ts-compat-notional-half-away");
    let mut m = market();
    books(&mut m, t(1000), price!(0.30), price!(0.60), qty!(50));
    let (_run, sc) = run(
        &m,
        Cap::new(
            usdc!(500),
            at_tick(1, |out| {
                out.place(
                    Order::buy(Outcome::Up, price!(0.53), qty!(10))
                        .post_only()
                        .cid(cid!("po")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.333333), qty!(0.000001))
                        .post_only()
                        .cid(cid!("dust")),
                );
            }),
        ),
    );
    assert_eq!(
        reserved_in(&sc.rec, "order_submitted", "po"),
        micros(s(&r, "expected_reservation"))
    );
    let dust = reserved_in(&sc.rec, "order_submitted", "dust");
    assert_eq!(
        dust - micros(s(&r, "expected_reservation")),
        micros(s(&r0, "expected_reservation")),
        "notional 3.3e-7 rounds to 0; accepted (no precision check)"
    );
}

// spec: 10 C1 (realistic share-sized), G3
#[test]
#[ignore = "C4 (G3): realistic profile refused by the engine until M3b (D57)"]
fn c1_realistic_share_sized_in_session() {
    let _ = row("c1-realistic-share-sized");
    todo!("G3");
}
#[test]
#[ignore = "C4 (G3): realistic profile refused by the engine until M3b (D57)"]
fn c1_realistic_collateral_in_session() {
    let _ = row("c1-realistic-collateral-sized");
    todo!("G3");
}
// spec: 10 C1 exception — reservation_dust
#[test]
#[ignore = "C4 (G3): realistic fee curves; the engine refuses Profile::Realistic until M3b (D57)"]
fn c1_reservation_dust_counted_not_rejected() {
    let _ = row("c1-reservation-dust");
    todo!("G3");
}

// spec: 12 §7.5 (exact compare, no 1e-8 tolerance), 10 §10.2 reject string
#[test]
fn funding_exact_boundary() {
    let acc = row("funding-exact-boundary-accept");
    let rej = row("funding-one-micro-short-reject");
    let order = |out: &mut Intents| {
        out.place(Order::buy(Outcome::Up, price!(0.53), qty!(10)).cid(cid!("a")))
    };
    let mut m = market();
    books(&mut m, t(1000), price!(0.30), price!(0.60), qty!(50));
    let m_acc = m.clone().starting_capital(usdc!(5.4744));
    let (_r, s1) = run(&m_acc, Cap::new(usdc!(5.4744), at_tick(1, order)));
    assert_eq!(
        s1.rec.kinds_of("a")[0],
        "order_submitted",
        "{}",
        s(&acc, "expected")
    );
    let m_rej = m.starting_capital(usdc!(5.474399));
    let (run2, s2) = run(&m_rej, Cap::new(usdc!(5.474399), at_tick(1, order)));
    let e = &s2.rec.seen[0];
    assert_eq!(e.kind, "order_rejected");
    assert!(
        e.debug
            .contains("InsufficientCapital { required: Usdc(5.4744), available: Usdc(5.474399) }"),
        "{}",
        e.debug
    );
    assert_eq!(
        events_of(&run2, "order_rejected")[0]["reason"],
        "insufficient_capital",
        "reason code in the trace (22 §3.4)"
    );
    assert_eq!(
        RejectReason::InsufficientCapital {
            required: usdc!(5.4744),
            available: usdc!(5.474399)
        }
        .code(),
        "insufficient_capital"
    );
    let _ = s(&rej, "reject_ts_string");
}

// spec: 10 §10.2 ("The trace renderer MUST reproduce those exact formats"), 21 §17 reject string
#[test]
#[ignore = "C2-fail: 10 §10.2 reject string in the trace, InsufficientCapital: observed reason \"insufficient_capital\"; expected \"insufficient_capital(required=5.4744,available=5.474399)\" (see PLAN A-21: 22 §3.4 compares the code only)"]
fn funding_reject_string_in_trace() {
    let rej = row("funding-one-micro-short-reject");
    let mut m = market().starting_capital(usdc!(5.474399));
    books(&mut m, t(1000), price!(0.30), price!(0.60), qty!(50));
    let (run2, _sc) = run(
        &m,
        Cap::new(
            usdc!(5.474399),
            at_tick(1, |out| {
                out.place(Order::buy(Outcome::Up, price!(0.53), qty!(10)).cid(cid!("a")))
            }),
        ),
    );
    assert_eq!(
        events_of(&run2, "order_rejected")[0]["reason"],
        s(&rej, "reject_ts_string")
    );
}

// spec: 12 §9.1 (commands applied at emission), 12 §7.5 — the second order sees the first reservation
#[test]
fn funding_cascade_visibility() {
    let r = row("funding-second-order-sees-first-reservation");
    let mut m = market().starting_capital(usdc!(10));
    books(&mut m, t(1000), price!(0.30), price!(0.60), qty!(50));
    let (_run, sc) = run(
        &m,
        Cap::new(
            usdc!(10),
            at_tick(1, |out| {
                out.place(
                    Order::buy(Outcome::Up, price!(0.50), qty!(10))
                        .post_only()
                        .cid(cid!("first")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.50), qty!(10.000001))
                        .post_only()
                        .cid(cid!("second")),
                );
            }),
        ),
    );
    assert_eq!(reserved_in(&sc.rec, "order_submitted", "first"), 5_000_000);
    let rej = sc
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "order_rejected")
        .expect(s(&r, "expected"));
    assert!(
        rej.debug
            .contains("InsufficientCapital { required: Usdc(5.000001), available: Usdc(5) }"),
        "{}",
        rej.debug
    );
}

// spec: 10 C2 (realistic SELL reserves shares)
#[test]
#[ignore = "C4 (G3): realistic profile refused by the engine until M3b (D57)"]
fn c2_sell_reserves_shares() {
    let _ = row("c2-realistic-sell-reserves-shares");
    todo!("G3");
}

// spec: 13 TC-C4 (ts-compat naked sells; quantity clamped at 0; full proceeds credited)
#[test]
fn c2_ts_compat_naked_sell() {
    let _ = row("c2-ts-compat-no-inventory-check");
    let m = standard_market();
    let (_run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => out.place(
                Order::buy(Outcome::Up, price!(0.52), qty!(3))
                    .fok()
                    .cid(cid!("buy3")),
            ),
            2 => {}
            _ => {}
        }),
    );
    assert_eq!(sc.rec.seen.last().unwrap().pos_up, 3_000_000);
    let mut m = standard_market();
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    let (_run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => out.place(
                Order::buy(Outcome::Up, price!(0.52), qty!(3))
                    .fok()
                    .cid(cid!("buy3")),
            ),
            3 => out.place(
                Order::sell(Outcome::Up, price!(0.48), qty!(8))
                    .fok()
                    .cid(cid!("sell8")),
            ),
            _ => {}
        }),
    );
    let sell = sc.rec.of("sell8");
    let fill = sell
        .iter()
        .find(|e| e.kind == "fill")
        .expect("naked sell fills");
    assert!(
        fill.debug.contains("qty: Qty(8)") && fill.debug.contains("liquidity: Taker"),
        "{}",
        fill.debug
    );
    assert_eq!(fill.pos_up, 0, "clamped at 0, never negative");
    let fee = ts_compat_fee(price!(0.48), qty!(8)).micros();
    let buy_fee = ts_compat_fee(price!(0.52), qty!(3)).micros();
    assert_eq!(
        fill.cash,
        500_000_000 - 1_560_000 - buy_fee + 3_840_000 - fee,
        "full proceeds credited"
    );
    assert!(sc.identity_checks > 0);
}

// spec: 10 C3, 12 §9.4 — reserved 5.4744 → 3.2846 (outstanding 6 at the limit) → 0 on the terminal
#[test]
fn c3_partial_then_cancel() {
    let r = row("c3-release-partial-then-terminal");
    let steps = r["steps"].as_array().unwrap();
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(4)), (price!(0.54), qty!(10))],
    );
    // The next real tick must move the UP ask above the limit (0.54 > 0.53) *before* the
    // maker scan, or WorstQueueCompat fills the remainder against the undepleted 0.52 level
    // (the free remainder fill, 13 §5.3). So: one UP book event, and the cancel on that tick.
    m.book(
        t(2000),
        Outcome::Up,
        &[(price!(0.48), qty!(50))],
        &[(price!(0.54), qty!(50))],
    );
    let (_run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => out.place(Order::buy(Outcome::Up, price!(0.53), qty!(10)).cid(cid!("a"))),
            2 => out.cancel(&cid!("a")),
            _ => {}
        }),
    );
    let a = sc.rec.of("a");
    let sub = a.iter().find(|e| e.kind == "order_submitted").unwrap();
    assert_eq!(
        (sub.reserved, sub.cash),
        (
            micros(s(&steps[0], "reserved")),
            micros(s(&steps[0], "cash"))
        )
    );
    let fill = a.iter().find(|e| e.kind == "fill").unwrap();
    assert!(
        fill.debug
            .contains("price: Price(0.52), qty: Qty(4), fee: Usdc(0.0699)"),
        "{}",
        fill.debug
    );
    assert_eq!(
        (fill.cash, fill.reserved),
        (
            micros(s(&steps[1], "cash")),
            micros(s(&steps[1], "reserved"))
        ),
        "A-11 (D69): fee of the outstanding 6 at the limit"
    );
    let done = a.last().unwrap();
    assert!(
        done.debug.contains("reason: Canceled") && done.debug.contains("filled: Some(Qty(4))"),
        "{}",
        done.debug
    );
    assert_eq!(done.reserved, 0);
    assert_eq!(done.cash, micros(s(&steps[1], "cash")));
}

// spec: 10 C3, 60 INV-3 — a killed FOK releases in its OrderDone callback, cash unchanged
#[test]
fn c3_killed_releases() {
    let _ = row("c3-killed-releases");
    let m = standard_market();
    let (_run, sc) = run(
        &m,
        Cap::new(
            usdc!(500),
            at_tick(1, |out| {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fok()
                        .cid(cid!("k")),
                );
            }),
        ),
    );
    let k = sc.rec.of("k");
    assert!(k[0].reserved > 0);
    let done = k.last().unwrap();
    assert!(done.debug.contains("reason: Killed"));
    assert_eq!((done.reserved, done.cash), (0, 500_000_000));
}

// spec: 10 C3, 12 §9.4 (OrderRejected → final 0); engine-origin rejections never reserve
#[test]
fn c3_rejected_releases() {
    let _ = row("c3-rejected-releases");
    let m = standard_market();
    let (_run, sc) = run(
        &m,
        Cap::new(
            usdc!(500),
            at_tick(1, |out| {
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(10))
                        .post_only()
                        .cid(cid!("po")),
                );
                out.place(Order::buy(Outcome::Up, price!(0.50), Qty::ZERO).cid(cid!("bad")));
            }),
        ),
    );
    let po = sc.rec.of("po");
    assert_eq!(po[0].reserved, 5_200_000, "post-only reserves the notional");
    assert_eq!(po[1].kind, "order_rejected");
    assert_eq!(
        po[1].reserved, 0,
        "released on delivery of the keyed rejection"
    );
    let bad = sc
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "order_rejected" && e.cid.is_none())
        .unwrap();
    assert_eq!(bad.reserved, 0);
}

// spec: 60 INV-3 — with every order terminal, reserved == 0 at the end
#[test]
fn c3_zero_reserved_at_end() {
    let _ = row("c3-session-end-zero-reserved");
    let mut m = standard_market();
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    books(&mut m, t(3000), price!(0.48), price!(0.52), qty!(50));
    let (_run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, rec| match ctx.tick().seq {
            1 => {
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("rest")));
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(5))
                        .fok()
                        .cid(cid!("fok")),
                );
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(60))
                        .fok()
                        .cid(cid!("kill")),
                );
            }
            3 => out.cancel(&cid!("rest")),
            5 => rec.ticks.push((
                90,
                ctx.portfolio().capital().reserved.micros(),
                "reserved".into(),
            )),
            _ => {}
        }),
    );
    let end = sc.rec.ticks.iter().find(|(k, _, _)| *k == 90).unwrap();
    assert_eq!(end.1, 0);
}

// spec: 10 C4, 12 §9.5, 12 §9.6 — the identity on real sessions (taker buy, sell)
#[test]
fn c4_identity_sessions() {
    let win = row("c4-pnl-identity-taker-buy-win");
    let sell = row("c4-sell-realized");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.50), qty!(50))],
    );
    up_book(
        &mut m,
        t(2000),
        &[(price!(0.60), qty!(50))],
        &[(price!(0.70), qty!(50))],
    );
    let (run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => out.place(
                Order::buy(Outcome::Up, price!(0.50), qty!(10))
                    .fok()
                    .cid(cid!("buy")),
            ),
            3 => out.place(
                Order::sell(Outcome::Up, price!(0.60), qty!(4))
                    .fok()
                    .cid(cid!("sell")),
            ),
            _ => {}
        }),
    );
    let bf = sc
        .rec
        .of("buy")
        .into_iter()
        .find(|e| e.kind == "fill")
        .unwrap();
    assert!(
        bf.debug
            .contains(&format!("fee: Usdc({})", s(&win["expected"], "fee"))),
        "{}",
        bf.debug
    );
    assert_eq!(bf.cash, micros(s(&win["expected"], "cash_end")));
    let sf = sc
        .rec
        .of("sell")
        .into_iter()
        .find(|e| e.kind == "fill")
        .unwrap();
    assert!(
        sf.debug
            .contains(&format!("fee: Usdc({})", s(&sell["expected"], "sell_fee"))),
        "{}",
        sf.debug
    );
    assert_eq!(sf.cash, micros(s(&sell["expected"], "cash_end")));
    assert_eq!(sf.pos_up, 6_000_000);
    assert!(sc.identity_checks >= 10);
    // Final totals (unrounded) from the testkit's final record.
    assert_eq!(
        micros(&final_field(&run, "cash_end").unwrap()),
        micros(s(&sell["expected"], "cash_end"))
    );
}

// spec: 10 C4, 12 §9.5 (merge realizes size − removed basis; TS bug not copied), 13 §5.4
#[test]
fn c4_merge_realizes_not_ts_bug() {
    let r = row("c4-merge-realizes");
    let avg = row("c4-merge-average-cost");
    let mut m = standard_market();
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    // The split's shares exist for the OM only once PositionsSplit is delivered (12 §9.1),
    // so the merge goes on the next tick (a merge in the same list fails InsufficientPairs).
    let (run1, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => out.split(qty!(5)),
            3 => out.merge(qty!(5)),
            _ => {}
        }),
    );
    let merged = sc
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "positions_merged")
        .unwrap();
    assert_eq!(
        (merged.cash, merged.pos_up, merged.pos_down),
        (500_000_000, 0, 0)
    );
    assert_eq!(
        micros(&final_field(&run1, "cash_end").unwrap()),
        micros(s(&r["expected"], "cash_end"))
    );
    assert_eq!(
        micros(&final_field(&run1, "pnl").unwrap()),
        micros(s(&r["expected"], "pnl")),
        "TS would give -5 (classified TS bug)"
    );
    assert_eq!(
        micros(&final_field(&run1, "split_cost").unwrap()),
        micros(s(&r["expected"], "split_cost"))
    );
    // Average-cost removal: BUY UP 10 @ 0.50, BUY DOWN 10 @ 0.40, merge 4.
    let mut m = market();
    m.book(
        t(1000),
        Outcome::Up,
        &[(price!(0.45), qty!(50))],
        &[(price!(0.50), qty!(50))],
    );
    m.book(
        t(1000),
        Outcome::Down,
        &[(price!(0.35), qty!(50))],
        &[(price!(0.40), qty!(50))],
    );
    m.price_change(t(2000), Outcome::Up, Side::Buy, price!(0.45), qty!(40));
    let (run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => {
                out.place(
                    Order::buy(Outcome::Up, price!(0.50), qty!(10))
                        .fok()
                        .cid(cid!("up")),
                );
                out.place(
                    Order::buy(Outcome::Down, price!(0.40), qty!(10))
                        .fok()
                        .cid(cid!("down")),
                );
            }
            2 => out.merge(qty!(4)),
            _ => {}
        }),
    );
    let merged = sc
        .rec
        .seen
        .iter()
        .find(|e| e.kind == "positions_merged")
        .unwrap();
    assert_eq!(merged.cash, micros(s(&avg["expected"], "cash_after_merge")));
    assert_eq!(
        micros(&final_field(&run, "cash_end").unwrap()),
        micros(s(&avg["expected"], "cash_after_merge"))
    );
    assert_eq!(
        micros(&final_field(&run, "pnl").unwrap()),
        micros(s(&avg["expected"], "pnl")),
        "resolves UP: realized 0.2628 + 6 − basis 5.6058"
    );
}

// spec: 12 §7.3 (merge clamp; clamped result ≤ 0 → MergeFailed(InsufficientPairs)), 10 N4, 13 TC-C7
#[test]
fn merge_clamp_and_zero() {
    let r = row("merge-clamp-pending");
    assert!(s(&r, "expected").contains("PositionsMerged{size: 7}"));
    let mut m = standard_market();
    books(&mut m, t(2000), price!(0.48), price!(0.52), qty!(50));
    let (run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => {
                out.split(qty!(7));
                out.place(
                    Order::buy(Outcome::Up, price!(0.52), qty!(3))
                        .fok()
                        .cid(cid!("up3")),
                );
            }
            2 => {
                out.merge(qty!(100000));
                out.merge(qty!(100000));
            }
            _ => {}
        }),
    );
    let merges: Vec<&Seen> = sc
        .rec
        .seen
        .iter()
        .filter(|e| e.kind == "positions_merged" || e.kind == "merge_failed")
        .collect();
    assert_eq!(
        merges.len(),
        2,
        "12 §7.3: the clamped second merge (≤ 0 pairs) fails InsufficientPairs; observed {:?}",
        sc.rec.tags()
    );
    assert!(
        merges[0].debug.contains("PositionsMerged { at: TsMs(")
            && merges[0].debug.contains("size: Qty(7)"),
        "{}",
        merges[0].debug
    );
    assert_eq!((merges[0].pos_up, merges[0].pos_down), (3_000_000, 0));
    assert!(
        merges[1].debug.contains("MergeFailed") && merges[1].debug.contains("InsufficientPairs"),
        "{}",
        merges[1].debug
    );
    assert_eq!(events_of(&run, "positions_merged").len(), 1);
}

// spec: 12 §7.3 (split funding), 10 N4, 13 TC-C7 (ts-compat merge 0 → no event)
#[test]
fn split_insufficient_and_zero() {
    let _ = row("split-insufficient");
    let _ = row("split-zero");
    let _ = row("merge-zero");
    let m = standard_market();
    let (run, sc) = run(
        &m,
        Cap::new(
            usdc!(500),
            at_tick(1, |out| {
                out.split(qty!(100000));
                out.split(Qty::ZERO);
                out.merge(Qty::ZERO);
            }),
        ),
    );
    let kinds: Vec<String> = sc
        .rec
        .seen
        .iter()
        .map(|e| {
            format!(
                "{}:{}",
                e.kind,
                e.debug
                    .split("reason: ")
                    .nth(1)
                    .unwrap_or("")
                    .trim_end_matches(" }")
            )
        })
        .collect();
    assert_eq!(
        kinds,
        [
            "split_failed:InsufficientCollateral",
            "split_failed:InvalidSize"
        ],
        "merge 0 → no event in ts-compat (TC-C7)"
    );
    assert_eq!(run.records("intent").count(), 3);
    assert_eq!(run.records("event").count(), 2);
}

// spec: 12 §9.4 (isolated per-market allowance), 21 §6.3
#[test]
fn per_market_allowance_isolated() {
    let _ = row("per-market-allowance");
    let spend = |ctx: &Ctx, out: &mut Intents, rec: &mut Recorder| {
        rec.ticks.push((
            90,
            ctx.portfolio().capital().starting.micros(),
            format!("cash={}", ctx.portfolio().capital().cash.micros()),
        ));
        if ctx.tick().seq == 0 {
            out.place(
                Order::buy(Outcome::Up, price!(0.6), qty!(100))
                    .fok()
                    .cid(cid!("spend")),
            );
        }
    };
    let mut m1 = market();
    m1.book(
        t(1000),
        Outcome::Up,
        &[(price!(0.4), qty!(100))],
        &[(price!(0.6), qty!(100))],
    );
    let mut m2 = pmb_sdk::testkit::TestMarket::btc_15m(TsMs(START.0 + 900_000))
        .profile(pmb_sdk::testkit::Profile::TsCompat);
    m2.book(
        TsMs(START.0 + 900_000 + 1000),
        Outcome::Up,
        &[(price!(0.4), qty!(100))],
        &[(price!(0.6), qty!(100))],
    );
    let (_r1, s1) = run(&m1, Cap::new(usdc!(500), spend));
    assert_eq!(
        s1.rec.seen.last().unwrap().cash,
        500_000_000 - 60_000_000 - ts_compat_fee(price!(0.6), qty!(100)).micros()
    );
    let (_r2, s2) = run(&m2, Cap::new(usdc!(500), spend));
    let first = s2.rec.ticks.iter().find(|(k, _, _)| *k == 90).unwrap();
    assert_eq!(
        (first.1, first.2.as_str()),
        (500_000_000, "cash=500000000"),
        "market 2 starts from its own allowance"
    );
}

// spec: 60 INV-1 (cash conservation after every delivered event) — a mixed scenario; `Cap` recomputes cash in every callback
#[test]
fn inv1_cash_conservation() {
    let _ = row("inv1-cash-conservation");
    let mut m = market();
    up_book(
        &mut m,
        t(1000),
        &[(price!(0.48), qty!(50))],
        &[(price!(0.52), qty!(4)), (price!(0.54), qty!(10))],
    );
    m.price_change(t(2000), Outcome::Up, Side::Sell, price!(0.49), qty!(10));
    up_book(
        &mut m,
        t(3000),
        &[(price!(0.60), qty!(50))],
        &[(price!(0.70), qty!(50))],
    );
    let (_run, sc) = run(
        &m,
        Cap::new(usdc!(500), |ctx, out, _| match ctx.tick().seq {
            1 => {
                out.place(Order::buy(Outcome::Up, price!(0.53), qty!(10)).cid(cid!("partial")));
                out.place(Order::buy(Outcome::Up, price!(0.50), qty!(5)).cid(cid!("maker")));
                out.split(qty!(3));
            }
            // seq 4 is the UP book of t(3000) (bid 0.60); the price_change at t(2000) already
            // filled both resting orders (free remainder fill, 13 §5.3), so the cancel is a no-op.
            4 => {
                out.cancel(&cid!("partial"));
                out.place(
                    Order::sell(Outcome::Up, price!(0.60), qty!(7))
                        .fok()
                        .cid(cid!("sell")),
                );
                out.merge(qty!(2));
            }
            _ => {}
        }),
    );
    assert!(sc.identity_checks >= 15, "{}", sc.identity_checks);
    assert!(sc
        .rec
        .seen
        .iter()
        .any(|e| e.kind == "fill" && e.debug.contains("liquidity: Maker")));
    assert!(sc.rec.seen.iter().any(|e| e.kind == "positions_merged"));
    assert!(sc.rec.of("sell").iter().any(|e| e.kind == "fill"));
}
