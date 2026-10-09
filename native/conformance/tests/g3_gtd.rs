// spec: 11 §8 GT1–GT5, 10 §7.4 GD1–GD4, 10 §3.3 R13, 11 §4 (GTD), 12 §7.4, 13 §6.6, 30 §5 gtd_expiration
//
// G3 data table (60 §10.2 "GTD (11 §8)") plus the ts-compat GTD rows that
// belong to G2 (11 §4). The data tests reproduce the arithmetic of every
// vector; the behaviors are testkit skeletons.

use pmb_conformance::vectors::{self, rows};
use serde_json::Value;

fn file() -> Value {
    vectors::load("gtd")
}

fn constants(f: &Value, profile: &str) -> (i64, i64) {
    match profile {
        "realistic" => (
            f["constants"]["realistic"]["min_lead_ms"].as_i64().unwrap(),
            f["constants"]["realistic"]["early_expiry_ms"]
                .as_i64()
                .unwrap(),
        ),
        "ts-compat" => (
            f["constants"]["ts_compat"]["decision_offset_ms"]
                .as_i64()
                .unwrap(),
            f["constants"]["ts_compat"]["early_expiry_ms"]
                .as_i64()
                .unwrap(),
        ),
        other => panic!("{other}"),
    }
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 11 §3, 11 §8, 11 §4 — the constants
#[test]
fn constants_as_specified() {
    let f = file();
    assert_eq!(constants(&f, "realistic"), (180_000, 60_000));
    assert_eq!(constants(&f, "ts-compat"), (60_000, 0));
}

// spec: 11 GT1, 10 R13 — stated seconds = floor(expire_at_ms / 1000)
#[test]
fn gt1_floor_to_seconds() {
    for r in rows(&file()) {
        let (Some(ms), Some(s)) = (r["expire_at_ms"].as_i64(), r["stated_s"].as_i64()) else {
            continue;
        };
        assert_eq!(ms.div_euclid(1000), s, "{}", vectors::id(r));
    }
}

// spec: 11 GT2 — lead check at exchange arrival on the floored seconds
#[test]
fn gt2_lead_check() {
    let f = file();
    let (lead, _) = constants(&f, "realistic");
    for r in rows(&f) {
        if r["profile"] != "realistic" {
            continue;
        }
        let (Some(arrival), Some(stated_s), Some(accepted)) = (
            r["arrival_exchange_ms"].as_i64(),
            r["stated_s"].as_i64(),
            r["accepted"].as_bool(),
        ) else {
            continue;
        };
        let ok = stated_s * 1000 >= arrival + lead;
        assert_eq!(ok, accepted, "{}", vectors::id(r));
        if !accepted {
            assert_eq!(
                r["reject"],
                "GtdLeadTooShort{min_lead_ms: 180000}",
                "{}",
                vectors::id(r)
            );
        }
    }
}

// spec: 11 GT3 — effective expiry = stated_s × 1000 − 60 000
#[test]
fn gt3_effective_expiry() {
    let f = file();
    let (_, early) = constants(&f, "realistic");
    for r in rows(&f) {
        let Some(eff) = r["effective_expiry_exchange_ms"].as_i64() else {
            continue;
        };
        assert_eq!(
            r["stated_s"].as_i64().unwrap() * 1000 - early,
            eff,
            "{}",
            vectors::id(r)
        );
    }
}

// spec: 10 GD3, 30 §5 — gtd_expiration(lifetime) = now + early_expiry + lifetime
#[test]
fn gd3_recipe() {
    let f = file();
    for r in rows(&f) {
        let Some(lifetime) = r["lifetime_ms"].as_i64() else {
            continue;
        };
        let (_, early) = constants(&f, r["profile"].as_str().unwrap());
        let got = r["now_ms"].as_i64().unwrap() + early + lifetime;
        assert_eq!(
            got,
            r["expected_expire_at_ms"].as_i64().unwrap(),
            "{}",
            vectors::id(r)
        );
    }
    // The realistic recipe passes GT2 at an arrival at or before `now`.
    let r = rows(&f)
        .iter()
        .find(|r| vectors::id(r) == "gd3-recipe-realistic")
        .unwrap();
    let stated = r["expected_expire_at_ms"]
        .as_i64()
        .unwrap()
        .div_euclid(1000)
        * 1000;
    assert!(stated >= r["now_ms"].as_i64().unwrap() + 180_000);
}

// spec: 11 §4 (ts-compat: expire_at ≥ stamp + 60 000)
#[test]
fn ts_compat_decision_offset() {
    let f = file();
    let (offset, _) = constants(&f, "ts-compat");
    for r in rows(&f) {
        if r["profile"] != "ts-compat" {
            continue;
        }
        let (Some(stamp), Some(exp), Some(accepted)) = (
            r["stamp_ms"].as_i64(),
            r["expire_at_ms"].as_i64(),
            r["accepted"].as_bool(),
        ) else {
            continue;
        };
        assert_eq!(exp >= stamp + offset, accepted, "{}", vectors::id(r));
    }
}

// spec: 10 GD4 — x3 (lead 120 s) accepted in ts-compat, rejected in realistic
#[test]
fn gd4_x3_both_profiles() {
    let f = file();
    let tc = rows(&f)
        .iter()
        .find(|r| vectors::id(r) == "gd4-x3-ts-compat")
        .unwrap();
    let re = rows(&f)
        .iter()
        .find(|r| vectors::id(r) == "gd4-x3-realistic")
        .unwrap();
    assert_eq!(tc["accepted"], true);
    assert_eq!(re["accepted"], false);
    assert_eq!(tc["expire_at_ms"], re["expire_at_ms"]);
}

// spec: 11 GT2 — GtdLeadTooShort at arrival (realistic)
#[test]
#[ignore = "G3: needs pmb-sdk testkit (realistic profile)"]
fn gt2_lead_at_arrival() {
    todo!("G3: exact-pass, floor-fails and too-short vectors as sessions; xnow = now − skew (12 §4.4)");
}

// spec: 11 GT3, 13 §6.6 — expiry 60 s early at exchange time
#[test]
#[ignore = "G3: needs pmb-sdk testkit (realistic profile)"]
fn gt3_expires_early() {
    todo!("G3: OrderDone(Expired, filled) at stated − 60 s + skew on the loop clock");
}

// spec: 11 §4 — ts-compat decision-time check and exact expiry (G2)
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn ts_compat_gtd_sessions() {
    todo!("C2: tc-gtd-exact-offset-pass, tc-gtd-one-ms-short, tc-gtd-expiry-tick-rule, expire-at-ignored-non-gtd");
}

// spec: 10 GD3, 30 §5 — ctx.gtd_expiration(lifetime)
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn gd3_ctx_helper() {
    todo!("C2: ctx.gtd_expiration(DurMs(120000)) == now + early + 120000 in both profiles");
}
