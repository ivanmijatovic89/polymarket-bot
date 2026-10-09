// spec: 11 §9, 11 §3 (max_place_batch, max_cancel_ids), 10 §7.3, 12 §7.3, 11 K7, 13 TC-C12, 60 §5.3 (360, 370, 380)
//
// G3 data table (60 §10.2 "caps (11 §9)") plus the ts-compat cap rows of
// 11 §4 that belong to G2.

use pmb_conformance::vectors::{self, rows};
use serde_json::Value;

fn file() -> Value {
    vectors::load("caps")
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
    vectors::assert_well_formed(&file());
}

// spec: 11 §9, 11 §3, 11 §4 — the constants per profile
#[test]
fn cap_constants() {
    let f = file();
    let c = &f["constants"];
    assert_eq!(c["realistic"]["max_place_batch"], 15);
    assert_eq!(c["realistic"]["max_cancel_ids"], 1000);
    assert!(
        c["realistic"]["cancel_market_cap"].is_null() && c["realistic"]["cancel_all_cap"].is_null()
    );
    assert!(
        c["ts_compat"]["max_place_batch"].is_null(),
        "no batch cap in the TS simulator"
    );
    assert_eq!(c["ts_compat"]["max_cancel_ids"], 3000);
    assert_eq!(
        c["live_rate_limit_not_modeled"]["post_orders_per_10s"],
        2000
    );
}

// spec: 11 §9 — the at-cap / over-cap rows agree with the constants
#[test]
fn boundary_rows_consistent() {
    let f = file();
    let c = &f["constants"];
    assert_eq!(
        row("batch-15-realistic")["entries"],
        c["realistic"]["max_place_batch"]
    );
    assert_eq!(
        row("batch-16-realistic")["entries"].as_i64().unwrap(),
        c["realistic"]["max_place_batch"].as_i64().unwrap() + 1
    );
    assert_eq!(
        row("cancel-batch-1000-realistic")["ids"],
        c["realistic"]["max_cancel_ids"]
    );
    assert_eq!(
        row("cancel-batch-1001-realistic")["ids"].as_i64().unwrap(),
        c["realistic"]["max_cancel_ids"].as_i64().unwrap() + 1
    );
    assert_eq!(
        row("cancel-batch-3000-ts-compat")["ids"],
        c["ts_compat"]["max_cancel_ids"]
    );
    assert_eq!(
        row("cancel-batch-3001-ts-compat")["ids"].as_i64().unwrap(),
        c["ts_compat"]["max_cancel_ids"].as_i64().unwrap() + 1
    );
    assert_eq!(
        row("batch-16-realistic")["reject_ts_string"],
        "batch_too_large(max_15_orders)"
    );
}

macro_rules! skeleton {
    ($name:ident, $id:literal, $gate:literal, $todo:literal) => {
        #[test]
        #[ignore = $gate]
        fn $name() {
            let r = row($id);
            let _ = &r;
            todo!($todo);
        }
    };
}

// spec: 11 §9 (1..=15 accepted), 60 §5.3 n=360
skeleton!(
    batch_15_realistic,
    "batch-15-realistic",
    "G3: needs pmb-sdk testkit (realistic profile)",
    "G3: 15 accepted, one Place dispatch"
);
// spec: 11 §9 (16 → BatchTooLarge for every order, nothing dispatched), 60 §5.5 (b16)
skeleton!(
    batch_16_realistic,
    "batch-16-realistic",
    "G3: needs pmb-sdk testkit (realistic profile)",
    "G3: 16 × OrderRejected(BatchTooLarge{{15}}), no OrderSubmitted"
);
// spec: 11 §4 (no batch cap), TC-C12 — G2
skeleton!(
    batch_16_ts_compat,
    "batch-16-ts-compat",
    "C2: needs pmb-sdk testkit",
    "C2: 16 OrderSubmitted"
);
// spec: 10 §7.3 (entries independent), 60 §5.3 n=440
skeleton!(
    batch_per_entry_independent,
    "batch-per-entry-independent",
    "C2: needs pmb-sdk testkit",
    "C2: x16b InvalidSize without OrderSubmitted; x16a proceeds"
);
// spec: 11 §9 (≤ 1,000 ids), 10 §10.2 TooManyIds
skeleton!(
    cancel_batch_1001_realistic,
    "cancel-batch-1001-realistic",
    "G3: needs pmb-sdk testkit (realistic profile)",
    "G3: CancelFailed(TooManyIds) for the whole intent"
);
// spec: 11 §4 (3,000), cancellation.ts:69 — G2
skeleton!(
    cancel_batch_3001_ts_compat,
    "cancel-batch-3001-ts-compat",
    "C2: needs pmb-sdk testkit",
    "C2: CancelFailed(TooManyIds) serialized invalid_cancel_batch_size (D62)"
);
// spec: 60 §5.3 n=380 (mixed known/unknown)
skeleton!(
    cancel_batch_mixed,
    "cancel-batch-mixed",
    "C2: needs pmb-sdk testkit",
    "C2: profile-specific per-ref results"
);
// spec: 11 §9 (no id cap on cancel_market / cancel_all)
skeleton!(
    cancel_market_and_all_no_cap,
    "cancel-market-no-cap",
    "C2: needs pmb-sdk testkit",
    "C2: 2000 resting orders canceled by one cancel_all"
);
// spec: 10 §7.3 (PlaceBatch 1..=N) — empty batch (PLAN A-05)
skeleton!(
    batch_empty,
    "batch-0-entries",
    "C2: needs pmb-sdk testkit",
    "C2 (D60): empty batch writes no intent: no event, no trace record, no dispatch"
);
