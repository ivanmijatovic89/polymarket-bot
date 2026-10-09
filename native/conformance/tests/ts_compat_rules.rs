// spec: 11 §4, 11 §3 (ts-compat column), 11 §12, 13 §5.1, 13 §5.2, 12 §7.4, 10 R8/R9
//
// G2 row "ts-compat rule values (11 §4)". The data tests pin the transcribed
// constants and recompute the fee numbers; the behaviors are testkit
// sessions in the ts-compat profile.

use pmb_conformance::decimal::{Dec, Rounding};
use pmb_conformance::vectors::{self, rows};
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
    assert!(rv["max_place_batch"].is_null(), "unbounded (PLAN A-04)");
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

// spec: 11 §4 row 1 (fee on TAKER fills, 4 dp, floor), 13 TC-E7
skeleton!(
    tc_fee_taker,
    "tc-fee-taker",
    "C2: FillView.fee == 0.1744; feesPaid 0.17"
);
skeleton!(
    tc_fee_maker_zero,
    "tc-fee-maker-zero",
    "C2: maker fill fee 0"
);
skeleton!(
    tc_fee_every_date,
    "tc-fee-every-date",
    "C2: 2025-12 market still charges 0.175"
);
skeleton!(tc_fee_floor, "tc-fee-floor", "C2: fee 0 for 0.05 @ 0.01");
skeleton!(
    tc_fee_4dp_tie,
    "tc-fee-4dp-tie",
    "C2: exact tie rounds away: 0.1754"
);
// spec: 11 §4 row 2 (reservation fee at the limit unless post-only)
skeleton!(
    tc_reservation_fee,
    "tc-reservation-fee",
    "C2: reserved 5.4744"
);
skeleton!(
    tc_reservation_post_only,
    "tc-reservation-post-only",
    "C2: reserved 5.3"
);
// spec: 11 §4 row 3 (no tick/bounds/min/precision validation), 12 §7.4
skeleton!(
    tc_no_tick_validation,
    "tc-no-tick-validation",
    "C2: off-tick, sub-minimum and 0.999999 all accepted"
);
skeleton!(
    tc_only_positivity,
    "tc-only-positivity",
    "C2: InvalidPrice / InvalidSize only"
);
skeleton!(
    tc_post_only_fok,
    "tc-post-only-fok",
    "C2: PostOnlyRequiresResting via the job path (builder makes it unrepresentable)"
);
// spec: 11 §4 row 4 (GTD decision-time offset; exact expiry)
skeleton!(
    tc_gtd_decision_offset,
    "tc-gtd-decision-offset",
    "C2: T+60000 accepted, T+59999 rejected"
);
skeleton!(
    tc_gtd_exact_expiry,
    "tc-gtd-exact-expiry",
    "C2: expires at E, before fills on that tick"
);
// spec: 11 §4 row 5 (no taker delay)
skeleton!(
    tc_no_taker_delay,
    "tc-no-taker-delay",
    "C2: no OrderDelayed ever"
);
// spec: 11 §4 rows 6–7 (caps)
skeleton!(tc_no_batch_cap, "tc-no-batch-cap", "C2: 16 accepted");
skeleton!(
    tc_cancel_id_cap_3000,
    "tc-cancel-id-cap-3000",
    "C2: 3000 ok, 3001 CancelFailed (PLAN A-15 on the reason)"
);
// spec: 11 §4 row 8 (post-only at execution; equality crosses; empty side accepts)
skeleton!(
    tc_post_only_equality_crosses,
    "tc-post-only-equality-crosses",
    "C2: 0.60 rejected, 0.59 rests, SELL at bid rejected"
);
skeleton!(
    tc_post_only_empty_side_accepts,
    "tc-post-only-empty-side-accepts",
    "C2: no asks -> accepted"
);
skeleton!(
    tc_post_only_checked_at_execution,
    "tc-post-only-checked-at-execution",
    "C2: delay 140; rejected against the execution-time book"
);
// spec: 13 TC-C14 (no self-cross), TC-C4 (naked sell), TC-C9 (inclusive gate), TC-C13 (no end action), TC-E8, TC-E9
skeleton!(
    tc_no_self_cross_check,
    "tc-no-self-cross-check",
    "C2: no SelfCross in ts-compat"
);
skeleton!(
    tc_naked_sell,
    "tc-naked-sell",
    "C2: fills, clamps, oversold_qty 5"
);
skeleton!(
    tc_window_gate_inclusive,
    "tc-window-gate-inclusive",
    "C2: ticks at start and end dispatched; eventsProcessed 4"
);
skeleton!(
    tc_no_action_at_end,
    "tc-no-action-at-end",
    "C2: order Live at the end, queued cancel discarded"
);
skeleton!(
    tc_compat_status_events,
    "tc-compat-status-events",
    "C2: Matched/Confirmed updates, never Mined"
);
skeleton!(
    tc_split_merge_sync,
    "tc-split-merge-sync",
    "C2: synchronous PositionsSplit/PositionsMerged"
);
// spec: 13 §7.3, 21 §8 C4 (pinned values; any other value invalid_input)
skeleton!(
    tc_model_config_pinned,
    "tc-model-config-pinned",
    "C2: binary rejects a ts-compat job with models.latency exact"
);
// spec: 11 §13.8, 11 FT1 (ts-compat outputs rules: null)
skeleton!(
    tc_outputs_rules_null,
    "tc-outputs-rules-null",
    "C2: MarketStats.rules null; echo.rulesTableVersion still copied"
);
