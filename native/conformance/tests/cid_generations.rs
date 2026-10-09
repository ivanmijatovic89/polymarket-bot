// spec: 10 §6 (OrderKey, CancelOp, FillKey), 10 S4, 12 §7.1, 12 §7.3, 13 §5.1 Cancels, 13 §5.4, 30 §5.2, 60 §5.10
//
// G2 row "cid generations". The ts-compat scenarios are transcriptions of
// the TS tests 60 §5.10 cites (src/trading/cancellation.test.ts:768-958);
// the live ones are G4 outlines.

use pmb_conformance::vectors::{self, rows};
use serde_json::Value;

fn file() -> Value {
    vectors::load("cid_generations")
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
        let profiles = r["profiles"].as_array().unwrap();
        assert!(!profiles.is_empty(), "{}", vectors::id(r));
    }
}

// spec: 10 §6 — FillKey.seq starts at 1 per order; TradeSeq dense from 0
#[test]
fn fill_key_and_trade_seq_shape() {
    let r = row("cg-08-fill-key-per-generation");
    let keys = r["expect"]["fill_keys"].as_array().unwrap();
    assert_eq!(keys[0]["order"], 0);
    assert_eq!(keys[1]["order"], 1);
    assert!(keys.iter().all(|k| k["seq"] == 1));
    let trades: Vec<u64> = r["expect"]["trade_seqs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t.as_u64().unwrap())
        .collect();
    assert_eq!(trades, [0, 1]);
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

// spec: 10 §6 OrderKey (dense from 0; engine rejects consume no key), 12 §9.2
skeleton!(
    cg01_dense_keys,
    "cg-01-dense-keys",
    "C2: a -> 0, b rejected without key, c -> 1, read from the ledger (D61: never from sim-N ids)"
);
// spec: 10 S4, 12 §7.1; cancellation.test.ts 'backtest client ID reuse creates distinct exchange identities …'
skeleton!(
    cg02_reuse_after_fill,
    "cg-02-reuse-after-fill-two-generations",
    "C2: two generations, position 20, orders() lists both"
);
// spec: 13 §5.1 Cancels (bound at decision time), 12 §7.1; cancellation.test.ts 'delayed cancel … cannot cancel a new submission'
skeleton!(
    cg03_delayed_cancel_old_generation,
    "cg-03-delayed-cancel-bound-to-old-generation",
    "C2: delay 100; queued cancel finds gen 1 terminal -> no event; gen 2 Live"
);
// spec: 12 §7.1, 13 §6.6 (realistic: CancelFailed(ExchangeNotCanceled) for the old key)
skeleton!(
    cg04_realistic_in_flight_cancel,
    "cg-04-realistic-in-flight-cancel-old-generation",
    "C2/G3: CancelFailed for gen 1's CancelOp; gen 2 untouched"
);
// spec: 12 §7.1 (cid -> current OrderKey)
skeleton!(
    cg05_cancel_targets_current,
    "cg-05-cancel-targets-current-generation",
    "C2: gen 2 canceled; gen 1 record unchanged"
);
// spec: 12 §7.3 (known terminal skipped silently), TC-C5/TC-C10, 60 §5.3 x6
skeleton!(
    cg06_cancel_known_terminal,
    "cg-06-cancel-known-terminal-silent",
    "C2: no event in both profiles"
);
// spec: 12 §7.3 (UnknownClientOrder), TC-C5, 60 §5.3 x-never
skeleton!(
    cg07_cancel_never_placed,
    "cg-07-cancel-never-placed",
    "C2: ts-compat no event; realistic CancelFailed(UnknownClientOrder)"
);
// spec: 10 §6 FillKey/TradeSeq
skeleton!(
    cg08_fill_keys,
    "cg-08-fill-key-per-generation",
    "C2: ledger records (22 §4) show FillKey{{0,1}}, FillKey{{1,1}}, TradeSeq 0, 1"
);
// spec: 12 §7.1, 10 §8.2 row 21 (live late fill)
skeleton!(
    cg09_late_fill_old_generation_live,
    "cg-09-late-fill-old-generation-live",
    "G4: mock exchange late fill"
);
// spec: 12 §7.1 (old events cannot change a replacement; live)
skeleton!(
    cg10_old_events_cannot_change_replacement,
    "cg-10-old-events-cannot-change-replacement-live",
    "G4"
);
// spec: 10 S5, 10 I3 (fill before ack, WS/REST dedupe; live)
skeleton!(cg11_fill_before_ack, "cg-11-fill-before-ack-live", "G4");
// spec: 10 §6 (session scope), 12 §10
skeleton!(
    cg12_keys_session_scoped,
    "cg-12-generation-keys-are-session-scoped",
    "C2: two markets in one run-group; each x is OrderKey 0"
);
