// spec: 10 §9.4 C1–C4, 10 §3.3 R5/R6/R9, 12 §7.5, 12 §9.4, 12 §9.5, 12 §9.6, 11 §4, 60 INV-1/2/3/7
//
// G2 row "capital C1–C4". The data tests recompute every derived number of
// vectors/capital.json with the exact decimal helper so that a wrong
// derivation is caught before C2 binds the scenarios to the testkit.

use pmb_conformance::decimal::{Dec, Rounding};
use pmb_conformance::vectors::{self, rows, s};
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

macro_rules! skeleton {
    ($name:ident, $id:literal, $todo:literal) => {
        #[test]
        #[ignore = "C2: needs pmb-sdk testkit"]
        fn $name() {
            let r = row($id);
            let _ = &r;
            todo!($todo);
        }
    };
}

// spec: 10 C1, 12 §7.5 — reserved after OrderSubmitted equals the vector (read capital().reserved in the callback)
skeleton!(
    c1_ts_compat_reservation_in_session,
    "c1-ts-compat-reservation",
    "C2: capital().reserved == 5.4744 inside the OrderSubmitted callback"
);
skeleton!(
    c1_ts_compat_post_only_in_session,
    "c1-ts-compat-post-only",
    "C2: reserved == 5.3"
);
skeleton!(
    c1_realistic_share_sized_in_session,
    "c1-realistic-share-sized",
    "C2/G3: reserved == 5.47437 on the F3 fixture market"
);
skeleton!(
    c1_realistic_collateral_in_session,
    "c1-realistic-collateral-sized",
    "C2/G3: Order::buy_spend(Up, 0.53, usdc!(10)).fok() reserves 10.693"
);
// spec: 10 C1 exception — reservation_dust never rejects an accepted order
skeleton!(
    c1_reservation_dust_counted_not_rejected,
    "c1-reservation-dust",
    "C2/G3: multi-level fill; diagnostics.anomalies.reservation_dust > 0, order completes"
);
// spec: 12 §7.5 (exact compare, no 1e-8 tolerance)
skeleton!(
    funding_exact_boundary,
    "funding-exact-boundary-accept",
    "C2: starting 5.4744 accepts; 5.474399 rejects with the exact reject string"
);
skeleton!(
    funding_cascade_visibility,
    "funding-second-order-sees-first-reservation",
    "C2: second order in the same list sees the first reservation"
);
// spec: 10 C2 (realistic SELL reserves shares)
skeleton!(
    c2_sell_reserves_shares,
    "c2-realistic-sell-reserves-shares",
    "C2/G3: sellable drops while the SELL rests; InsufficientInventory on over-sell"
);
// spec: 13 TC-C4 (ts-compat naked sells; oversold_qty)
skeleton!(
    c2_ts_compat_naked_sell,
    "c2-ts-compat-no-inventory-check",
    "C2: position clamps at 0, proceeds credited, oversold_qty == 5"
);
// spec: 10 C3 (release on authoritative final quantity)
skeleton!(
    c3_partial_then_cancel,
    "c3-release-partial-then-terminal",
    "C2: reserved 5.4744 -> 3.2846 -> 0 across the steps"
);
skeleton!(
    c3_killed_releases,
    "c3-killed-releases",
    "C2: reserved back to 0 in the OrderDone(Killed) callback"
);
skeleton!(
    c3_rejected_releases,
    "c3-rejected-releases",
    "C2: exchange-origin reject releases; engine-origin never reserved"
);
skeleton!(
    c3_zero_reserved_at_end,
    "c3-session-end-zero-reserved",
    "C2: final capital().reserved == 0"
);
// spec: 10 C4, 12 §9.6 — identity on real sessions, incl. the TS merge-PnL bug not copied
skeleton!(
    c4_identity_sessions,
    "c4-pnl-identity-taker-buy-win",
    "C2: run win/lose/sell/split/merge vectors; assert MarketStats and trace final.unrounded"
);
skeleton!(
    c4_merge_realizes_not_ts_bug,
    "c4-merge-realizes",
    "C2: split 5 + merge 5 -> pnl 0.00 (TS would give -5.00)"
);
// spec: 12 §7.3 (merge clamp, pending merges), 10 N4
skeleton!(merge_clamp_and_zero, "merge-clamp-pending", "C2: merge 100000 -> PositionsMerged{{7}}; second in list -> InsufficientPairs (realistic) / no event (ts-compat)");
skeleton!(
    split_insufficient_and_zero,
    "split-insufficient",
    "C2: split 100000 -> SplitFailed(InsufficientCollateral); split 0 -> SplitFailed(InvalidSize)"
);
// spec: 12 §9.4 (per-market allowance isolation)
skeleton!(
    per_market_allowance_isolated,
    "per-market-allowance",
    "C2: two markets; capital().starting == 500 in both"
);
// spec: 60 INV-1 (cash conservation after every delivered event)
skeleton!(
    inv1_cash_conservation,
    "inv1-cash-conservation",
    "C2: replay a mixed scenario; recompute cash from delivered movements in every callback"
);
