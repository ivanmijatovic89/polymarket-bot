// spec: 11 §5.1 FE1–FE3, 11 §5.2 FC1–FC4 (test-vector table), 11 §5.3 F0–F3 (FT1, FT2), 10 R8, 60 §7.4
//
// G3 data tables (60 §10.2 "Fee curves, eras and rounding (11 §5)"). The
// data tests evaluate the curves exactly with src/decimal.rs and check the
// dated era table; the session tests are G3 (realistic) skeletons.

use pmb_conformance::decimal::{Dec, Rounding};
use pmb_conformance::time::parse_iso_utc;
use pmb_conformance::vectors::{self, rows, s};
use serde_json::Value;

fn curves() -> Value {
    vectors::load("fee_curves")
}

fn eras() -> Value {
    vectors::load("fee_eras")
}

/// 11 §5.1/5.2: exact decimal evaluation, one HalfAwayFromZero rounding to dp.
fn fee(family: &str, rate: &str, exponent: u32, dp: u32, c: &str, p: &str) -> Dec {
    let c = Dec::parse(c);
    let p = Dec::parse(p);
    let rate = Dec::parse(rate);
    let pq = p.mul(&Dec::parse("1").sub(&p)).pow(exponent);
    let exact = match family {
        "PriceWeighted" => c.mul(&p).mul(&rate).mul(&pq),
        "Symmetric" => c.mul(&rate).mul(&pq),
        other => panic!("unknown family {other}"),
    };
    exact.round(dp, Rounding::HalfAwayFromZero)
}

fn curve_fee(cur: &Value, c: &str, p: &str) -> Dec {
    let v = fee(
        s(cur, "family"),
        s(cur, "rate"),
        cur["exponent"].as_u64().unwrap() as u32,
        cur["dp"].as_u64().unwrap() as u32,
        c,
        p,
    );
    if let Some(floor) = cur.get("floor").and_then(Value::as_str) {
        if v.cmp_num(&Dec::parse(floor)) == std::cmp::Ordering::Less {
            return Dec::parse("0");
        }
    }
    v
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&curves());
    vectors::assert_well_formed(&eras());
}

// spec: 11 §5.2 test-vector table (all 7 rows × 4 columns)
#[test]
fn fee_table_rows() {
    let f = curves();
    for r in rows(&f) {
        for (col, curve) in [
            ("era1", "era1"),
            ("era3", "era3"),
            ("ts_compat", "ts_compat"),
            ("wip_wrong", "wip_wrong"),
        ] {
            let got = curve_fee(&f["curves"][curve], s(r, "C"), s(r, "p"));
            let want = Dec::parse(s(r, col));
            assert!(
                got.eq_num(&want),
                "{} {col}: got {got}, spec {want}",
                vectors::id(r)
            );
        }
    }
    // FE2: the WIP formula is 2× too high at p = 0.5 and symmetric where era 1 is not.
    let era1 = |c: &str, p: &str| curve_fee(&f["curves"]["era1"], c, p);
    let wip = |c: &str, p: &str| curve_fee(&f["curves"]["wip_wrong"], c, p);
    assert!(wip("100", "0.50").eq_num(&era1("100", "0.50").mul(&Dec::parse("2"))));
    assert!(
        wip("5", "0.01").eq_num(&wip("5", "0.99")),
        "WIP is symmetric in p"
    );
    assert!(
        !era1("5", "0.01").eq_num(&era1("5", "0.99")),
        "era 1 is price-weighted, not symmetric"
    );
}

// spec: 11 FE1/FE2 — peak checks: Symmetric 0.07 at p = 0.5 is 1.75 per 100 shares; era-1 peak 1.5625% of notional
#[test]
fn peak_values() {
    assert!(fee("Symmetric", "0.07", 1, 5, "100", "0.5").eq_num(&Dec::parse("1.75")));
    let e1 = fee("PriceWeighted", "0.25", 2, 5, "100", "0.5");
    assert!(e1.eq_num(&Dec::parse("0.78125")));
    // fraction of notional (50 USDC): 0.78125 / 50 = 1.5625 %
    assert!(e1.eq_num(&Dec::parse("50").mul(&Dec::parse("0.015625"))));
}

// spec: 11 FC3 — exact 5-dp tie rounds away from zero (half-up == half-away for fees ≥ 0)
#[test]
fn exact_tie_rounds_away() {
    let exact = Dec::parse("5")
        .mul(&Dec::parse("0.07"))
        .mul(&Dec::parse("0.01"))
        .mul(&Dec::parse("0.99"));
    assert_eq!(exact.to_plain(), "0.003465");
    assert_eq!(
        exact.round(5, Rounding::HalfAwayFromZero).to_plain(),
        "0.00347"
    );
    assert_eq!(
        exact.round(4, Rounding::HalfAwayFromZero).to_plain(),
        "0.0035"
    );
}

// spec: 11 §5.3 — era windows are contiguous, ordered, and their epochs match the ISO labels
#[test]
fn era_table_contiguous_and_dated() {
    let f = eras();
    let rs = rows(&f);
    assert_eq!(rs.len(), 4);
    let ids: Vec<&str> = rs.iter().map(vectors::id).collect();
    assert_eq!(ids, ["F0", "F1", "F2", "F3"]);
    for (i, r) in rs.iter().enumerate() {
        if let Some(from) = r["from_iso"].as_str() {
            assert_eq!(
                parse_iso_utc(from),
                r["from_ms"].as_i64().unwrap(),
                "{} from",
                vectors::id(r)
            );
        }
        if let Some(to) = r["to_iso"].as_str() {
            assert_eq!(
                parse_iso_utc(to),
                r["to_ms"].as_i64().unwrap(),
                "{} to",
                vectors::id(r)
            );
        }
        if i + 1 < rs.len() {
            assert_eq!(
                r["to_ms"],
                rs[i + 1]["from_ms"],
                "{} -> {} contiguous",
                vectors::id(r),
                vectors::id(&rs[i + 1])
            );
        }
    }
    assert!(rs[0]["from_ms"].is_null() && rs[3]["to_ms"].is_null());
    assert_eq!(rs[0]["curve"], "none");
    assert_eq!(rs[1]["curve"], "price_weighted:0.25:2:5");
    assert_eq!(rs[2]["curve"], "symmetric:0.07:1:5");
    assert_eq!(rs[3]["curve"], "symmetric:0.07:1:5");
}

fn era_for(f: &Value, market_start_ms: i64) -> String {
    for r in rows(f) {
        let from = r["from_ms"].as_i64().unwrap_or(i64::MIN);
        let to = r["to_ms"].as_i64().unwrap_or(i64::MAX);
        if from <= market_start_ms && market_start_ms < to {
            return vectors::id(r).to_string();
        }
    }
    panic!("no era for {market_start_ms}")
}

// spec: 11 §5.3 (keyed by market start, [from, to))
#[test]
fn era_lookups() {
    let f = eras();
    for l in f["lookups"].as_array().unwrap() {
        let Some(start) = l["market_start_ms"].as_i64() else {
            continue;
        };
        if let Some(slug) = l["market_slug"].as_str() {
            let epoch: i64 = slug.rsplit('-').next().unwrap().parse().unwrap();
            assert_eq!(epoch * 1000, start, "{} slug epoch", l["id"]);
            assert_eq!(epoch % 300, 0, "{} slug epoch on the grid", l["id"]);
        }
        assert_eq!(
            era_for(&f, start),
            l["expected_era"].as_str().unwrap(),
            "{}",
            l["id"]
        );
    }
}

// spec: 11 FC1, FC2, 60 INV-10 — fee computed once per fill and summed; maker 0
#[test]
#[ignore = "G3: needs pmb-sdk testkit (realistic profile)"]
fn fc1_fee_once_per_fill() {
    todo!("G3: FillView.fee equals the rules' fee; feesPaid == Σ fill.fee; maker fills 0");
}

// spec: 11 §5.3 FT1 — realistic outputs feeEra/feeCurve/feeSource; ts-compat null
#[test]
#[ignore = "G3: needs the artifact binary"]
fn ft1_output_fields() {
    todo!("G3: run one market per era with the empty rules record -> feeEra F0..F3, feeCurve text, feeSource fallback");
}

// spec: 11 FE3 — snapshot mapping cases of fee_curves.json `rules[fe3-snapshot-mapping]`
#[test]
#[ignore = "G3: needs the artifact binary"]
fn fe3_snapshot_mapping() {
    let f = curves();
    let cases = f["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == "fe3-snapshot-mapping")
        .unwrap()["cases"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(cases, 7);
    todo!("G3: market.rules.captured variants -> curve / fallback / invalid_input");
}

// spec: 11 FT2 (D51) — mixed eras allowed; fee_curve_differs_from_era counted
#[test]
#[ignore = "G3: needs the artifact binary"]
fn ft2_mixed_eras() {
    todo!("G3");
}
