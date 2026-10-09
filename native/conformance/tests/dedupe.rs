// spec: 12 §7.6, 12 §7.2, 10 N5, 10 §10.2, 21 §10, 30 §7.1, 60 §5.5 (x10)
//
// G2 row "dedupe (12 §7.6)". Every vector of vectors/dedupe.json is a
// scripted strategy; C2 binds them to the testkit and reads
// diagnostics.anomalies.duplicate_active_cid plus the delivered events.

use pmb_conformance::vectors::{self, rows};
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
        assert!(
            r.get("expect").is_some(),
            "{} has expectations",
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

macro_rules! skeleton {
    ($name:ident, $id:literal, $todo:literal) => {
        #[test]
        #[ignore = "C2: needs pmb-sdk testkit"]
        fn $name() {
            let r = row($id);
            let _script = r["script"].as_str().unwrap();
            todo!($todo);
        }
    };
}

// spec: 12 §7.6 (same-list duplicate dropped, counted)
skeleton!(
    dd01_same_list_duplicate,
    "dd-01-same-list-duplicate",
    "C2: one OrderSubmitted, no OrderRejected, duplicate_active_cid == 1"
);
// spec: 12 §7.6 (re-sent every tick)
skeleton!(
    dd02_across_ticks,
    "dd-02-across-ticks-while-active",
    "C2: 1 submission over 5 ticks, counter 4"
);
// spec: 12 §7.6 rule 2, 10 S4
skeleton!(
    dd03_reuse_after_terminal,
    "dd-03-reuse-after-terminal",
    "C2: second generation accepted after OrderDone delivered"
);
// spec: 12 §7.6 rule 1 (ts-compat synchronous terminal releases in-list)
skeleton!(
    dd04_sync_terminal_releases,
    "dd-04-sync-terminal-releases-in-list",
    "C2: FOK filled synchronously then re-place in the same list accepted"
);
// spec: 12 §7.6 (asynchronous terminal events release only when delivered)
skeleton!(
    dd05_realistic_deduped_until_delivered,
    "dd-05-realistic-deduped-until-fill-delivered",
    "C2/G3: dropped until the fill report is delivered"
);
// spec: 12 §7.2 (dedupe position per profile) — invalid duplicate is dropped, not rejected
skeleton!(
    dd06_invalid_duplicate_dropped,
    "dd-06-duplicate-invalid-is-dropped-not-rejected",
    "C2: no InvalidSize reject, counter 1"
);
// spec: 12 §7.2 ts-compat step 2 (risk rejection for an active cid dropped)
skeleton!(
    dd07_risk_rejection_dropped,
    "dd-07-risk-rejection-for-active-cid-dropped",
    "C2: maxOrderSize 10; no event, counter 1"
);
// spec: 60 §5.5 x10 at 320 (delay 0: in-list completion releases)
skeleton!(
    dd08_cancel_replace_delay0,
    "dd-08-x10-cancel-and-replace-delay0",
    "C2: cancel completes synchronously; replacement accepted"
);
// spec: 60 §5.5 x10 at 320 (queued cancel leaves it deduped)
skeleton!(
    dd09_cancel_replace_delayed,
    "dd-09-x10-cancel-and-replace-delayed",
    "C2: delay 140; replacement dropped, accepted after OrderDone delivered"
);
// spec: 60 §5.5 x10 at 330
skeleton!(
    dd10_replace_active_dropped,
    "dd-10-x10-replace-active",
    "C2: no event, no event trace record, counter +1"
);
// spec: 12 §7.6 (new session starts with no active cids)
skeleton!(
    dd11_new_session_no_active_cids,
    "dd-11-new-session-no-active-cids",
    "C2: market 2 accepts x; OrderKey 0"
);
// spec: 12 §7.3 (cancels never deduped)
skeleton!(
    dd12_cancels_never_deduped,
    "dd-12-cancels-never-deduped",
    "C2: two CancelOps; profile-specific second result (PLAN A-12)"
);
// spec: 12 §7.3 (splits/merges never deduped)
skeleton!(
    dd13_splits_never_deduped,
    "dd-13-splits-never-deduped",
    "C2: two PositionsSplit"
);
// spec: 21 §10 (diagnostics counter location)
skeleton!(
    dd14_counter_in_diagnostics,
    "dd-14-counter-is-not-a-reason",
    "C2: EngineResult.diagnostics.anomalies.duplicate_active_cid present after dd-01"
);
// spec: 12 §7.6 rule 3 (full fill delivery releases before the callback)
skeleton!(
    dd15_full_fill_releases_before_callback,
    "dd-15-om-terminal-on-full-fill-delivery",
    "C2: re-place inside the Fill callback accepted (PLAN A-13)"
);
