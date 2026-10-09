// spec: 10 §4 (Q1, Q2, Q3), 10 §3.1 R-1, 10 §3.3 R14/R15, 21 §11, 21 §18 N1/N5
//
// G2 row "output quantization (10 §4)". The data tests run today against an
// independent decimal implementation (src/decimal.rs); the testkit tests
// reproduce each Q3 row as a real session and read the emitted MarketStats.

use pmb_conformance::decimal::{Dec, Rounding};
use pmb_conformance::vectors::{self, rows, s};
use serde_json::Value;

fn file() -> Value {
    vectors::load("output_quantization")
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 10 §4 Q3 (table rows 1–6) and the HalfAwayFromZero rule
#[test]
fn q3_rows_round_half_away_from_zero() {
    for row in rows(&file()) {
        let exact = Dec::parse(s(row, "exact"));
        let dp = vectors::i(row, "dp") as u32;
        let got = exact.round(dp, Rounding::HalfAwayFromZero);
        let want = Dec::parse(s(row, "rust"));
        assert!(
            got.eq_num(&want),
            "{}: {} rounded to {dp} dp -> {} (spec: {})",
            vectors::id(row),
            exact,
            got,
            want
        );
        // Rendering: exactly dp fractional digits, no exponent, no -0 (Q2).
        let rendered = got.to_plain();
        assert_eq!(rendered, s(row, "rust"), "{} rendering", vectors::id(row));
        assert!(!rendered.contains('e') && !rendered.contains('E'));
        assert!(!rendered.starts_with("-0.00") && rendered != "-0");
    }
}

// spec: 10 §4 Q3 — the TS value differs on every table row (intended, D08)
#[test]
fn q3_rows_differ_from_ts_as_documented() {
    for row in rows(&file()) {
        if !vectors::id(row).starts_with("q3-") {
            continue;
        }
        let ts = Dec::parse(s(row, "ts"));
        let rust = Dec::parse(s(row, "rust"));
        assert!(
            !ts.eq_num(&rust),
            "{}: the spec lists this row as a TS/Rust difference",
            vectors::id(row)
        );
        // The difference is exactly one unit of the last place.
        let diff = rust.sub(&ts);
        let ulp = Dec::parse("0.01");
        assert!(
            diff.eq_num(&ulp) || diff.eq_num(&ulp.neg()),
            "{}: difference must be one 0.01 step",
            vectors::id(row)
        );
    }
}

// spec: 10 §3.1 R-1 — there is no "half toward +inf" mode; −1.005 → −1.01
#[test]
fn r1_negative_tie_rounds_away_from_zero() {
    let v = Dec::parse("-1.005").round(2, Rounding::HalfAwayFromZero);
    assert_eq!(v.to_plain(), "-1.01");
    let v = Dec::parse("-0.125").round(2, Rounding::HalfAwayFromZero);
    assert_eq!(v.to_plain(), "-0.13");
}

// spec: 10 §4 fields table (dp and nullability per MarketStats field)
#[test]
fn fields_table_matches_spec() {
    let f = file();
    let fields = f["fields"].as_array().expect("fields");
    let dp_of = |name: &str| -> (u32, bool) {
        let e = fields
            .iter()
            .find(|e| e["field"] == name)
            .unwrap_or_else(|| panic!("field {name} missing"));
        (
            e["dp"].as_u64().unwrap() as u32,
            e["nullable"].as_bool().unwrap(),
        )
    };
    for money in [
        "pnl",
        "feesPaid",
        "cost",
        "splitCost",
        "upShares",
        "downShares",
        "mergableShares",
    ] {
        assert_eq!(dp_of(money), (2, false), "{money}");
    }
    for avg in ["avgEntryPriceUp", "avgEntryPriceDown"] {
        assert_eq!(dp_of(avg), (4, true), "{avg}");
    }
    for int in ["tradeCount", "tradeAsMaker", "tradeAsTaker"] {
        assert_eq!(dp_of(int), (0, false), "{int}");
    }
}

// spec: 10 §4 Q3 rows 1–6 as real sessions (ts-compat, maker fills, fee 0)
// C2: for every row with a `scenario`:
//   let m = TestMarket::btc_15m(1_780_272_000_000).profile(TsCompat);
//   place a post-only GTC BUY at scenario.price/size, then push a book whose
//   best ask is strictly below the limit (WorstQueueCompat fills the whole
//   remainder as MAKER, fee 0), settle with scenario.outcome, and assert
//   final MarketStats.pnl == row.rust and trace `final.unrounded.pnl` == exact.
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn q3_rows_as_sessions() {
    let f = file();
    let scenarios: Vec<&Value> = rows(&f)
        .iter()
        .filter(|r| r.get("scenario").is_some())
        .collect();
    assert_eq!(scenarios.len(), 6);
    todo!("C2: drive each Q3 scenario through pmb_sdk::testkit and compare MarketStats.pnl");
}

// spec: 10 §4 Q1 (D08): a fresh run and an --extend recomputed from DB decimals agree
// C2: black-box: run a fixture job, feed its MarketStats through the TS
// `decimal(14,4)` round trip (string -> parse -> string) and assert identity.
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn q1_values_at_or_below_column_scale() {
    todo!("C2: every emitted money/share value has <= 2 fractional digits, avg entry <= 4");
}

// spec: 10 §4 R14 — avgEntryPrice is one rounding from the exact rational
// C2: BUY fills 1 @ 0.5, 1 @ 0.5, 1 @ 0.6 (vector extra-avg-entry-exact-rational)
// and 1 @ 0.5 + 1 @ 0.5625 (extra-avg-entry-4dp-tie); assert the 4-dp output.
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn r14_avg_entry_price_single_rounding() {
    todo!("C2");
}
