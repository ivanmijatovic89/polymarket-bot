use polymarket_runtime::stats::aggregate;
use serde_json::{json, Value};

const START: i64 = 1_609_459_200_000;
const DAY: i64 = 86_400_000;
fn market(pnl: f64, timestamp: i64) -> Value {
    json!({"marketId":"market","slug":"btc-updown-15m-1609459200","finalOutcome":"UP",
        "pnl":pnl,"feesPaid":0.0,"tradeCount":1,"tradeAsMaker":0,"tradeAsTaker":1,
        "avgEntryPriceUp":null,"avgEntryPriceDown":null,"upShares":0.0,"downShares":0.0,
        "mergableShares":0.0,"cost":0.0,"splitCost":0.0,"intentMeta":[],"marketStartMs":timestamp})
}
fn run(markets: Vec<Value>) -> Value {
    aggregate(&json!({"markets":markets,"initialCapital":1000})).expect("valid fixture")
}
fn number(value: &Value, key: &str) -> f64 {
    value[key].as_f64().expect("number")
}

#[test]
fn empty_batch_has_fields_but_no_segments() {
    let result = run(vec![]);
    assert_eq!(number(&result["batchStats"], "marketsTotal"), 0.0);
    assert_eq!(number(&result["batchStats"], "capitalFinal"), 1000.0);
    assert!(result["batchStats"]["qualitySystem"].is_null());
    assert_eq!(result["segments"], json!([]));
}
#[test]
fn zero_pnl_preserves_current_win_and_loss_streaks() {
    let rows = [1.0, 0.0, 2.0, -1.0, 0.0, -2.0]
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let mut m = market(*p, START + i as i64 * DAY);
            if *p == 0.0 {
                m["skipReason"] = json!("no_in_window_activity");
            }
            m
        })
        .collect();
    let result = run(rows);
    let stats = &result["batchStats"];
    assert_eq!(number(stats, "streakMaxWin"), 2.0);
    assert_eq!(number(stats, "streakMaxWinPnl"), 3.0);
    assert_eq!(number(stats, "streakMaxLose"), 2.0);
    assert_eq!(number(stats, "streakMaxLosePnl"), -3.0);
    assert_eq!(number(stats, "marketsFlatWithTrades"), 2.0);
    assert_eq!(number(stats, "marketsNoInWindowActivity"), 2.0);
}
#[test]
fn batch_uses_input_order_while_segments_sort_stably() {
    let result = run(vec![
        market(1.0, START + DAY),
        market(-1.0, START),
        market(2.0, START + 2 * DAY),
    ]);
    assert_eq!(number(&result["batchStats"], "streakMaxWin"), 1.0);
    assert_eq!(number(&result["segments"][0]["stats"], "streakMaxWin"), 2.0);
    let tied = run(vec![
        market(1.0, START),
        market(-1.0, START),
        market(2.0, START),
    ]);
    assert_eq!(tied["batchStats"], tied["segments"][0]["stats"]);
}
#[test]
fn busy_union_excludes_idle_gaps_and_ignores_reversed_intervals() {
    let intervals = [(0, 10), (5, 15), (15, 20), (30, 40), (60, 50)];
    let rows = intervals
        .iter()
        .map(|(start, end)| {
            let mut m = market(1.0, START);
            m["execution"] = json!({"durationMs":10,"startedAtMs":start,"finishedAtMs":end});
            m
        })
        .collect();
    let result = run(rows);
    assert_eq!(number(&result["batchStats"], "durationTotalMs"), 50.0);
    assert_eq!(number(&result["batchStats"], "durationWallClockMs"), 30.0);
}
#[test]
fn rounding_ties_and_the_predecessor_of_half_match_javascript() {
    for (pnl, expected) in [
        (0.005, 0.01),
        (-0.005, 0.0),
        (0.004999999999999999, 0.0),
        (-0.015, -0.01),
    ] {
        let result = run(vec![market(pnl, START)]);
        assert_eq!(number(&result["batchStats"], "pnlTotal"), expected);
    }
}
#[test]
fn iso_week_year_and_all_tail_boundaries_are_retained() {
    let result = run(vec![market(1.0, START)]);
    assert_eq!(result["segments"][2]["segmentKey"], json!("2020-W53"));
    let result = run((0..6000)
        .map(|i| market((i % 3) as f64 - 1.0, START + i * 900_000))
        .collect());
    let tails: Vec<_> = result["segments"]
        .as_array()
        .expect("segments")
        .iter()
        .filter(|s| s["segmentKind"] == "last_n")
        .map(|s| s["segmentKey"].as_str().expect("key"))
        .collect();
    assert_eq!(tails, vec!["500", "1000", "3000", "6000"]);
}
#[test]
fn invalid_numbers_dates_and_overflow_are_structured_errors() {
    for (key, value) in [
        ("pnl", json!("1")),
        ("feesPaid", Value::Null),
        ("tradeCount", json!(-1)),
        ("marketStartMs", json!(1e30)),
    ] {
        let mut m = market(1.0, START);
        m[key] = value;
        let error =
            aggregate(&json!({"markets":[m],"initialCapital":1000})).expect_err("invalid fixture");
        assert_eq!(error.code, "invalid_request");
        assert!(!error.retryable);
    }
    assert!(aggregate(&json!({"markets":[market(1e308,START)],"initialCapital":1000})).is_err());
    let mut m = market(1.0, START);
    m["execution"] = json!({"durationMs":1,"startedAtMs":null,"finishedAtMs":10});
    assert!(aggregate(&json!({"markets":[m],"initialCapital":1000})).is_err());
}
#[test]
fn additional_metadata_is_accepted_without_mutation() {
    let mut m = market(1.0, START);
    m["futureMetadata"] = json!({"exact":"0.123456789123456789"});
    let input = json!({"markets":[m],"initialCapital":1000});
    let copy = input.clone();
    aggregate(&input).expect("valid additional metadata");
    assert_eq!(input, copy);
}

#[test]
fn nonfinite_standard_deviation_does_not_become_zero_quality() {
    let result = run(vec![market(1e200, START), market(-1e200, START)]);
    assert!(result["batchStats"]["qualitySystem"].is_null());
    assert!(result["batchStats"]["qualityTrade"].is_null());
    let constant = run(vec![market(10.0, START), market(10.0, START)]);
    assert!(constant["batchStats"]["qualitySystem"].is_null());
}

#[test]
fn complete_javascript_date_range_and_clipped_boundary_ordinals_are_supported() {
    for timestamp in [
        -8_300_000_000_000_000,
        8_300_000_000_000_000,
        -8_640_000_000_000_000,
        8_640_000_000_000_000,
    ] {
        let result = run(vec![market(1.0, timestamp)]);
        assert_eq!(result["segments"].as_array().expect("segments").len(), 4);
    }
    let min = run(vec![market(1.0, -8_640_000_000_000_000)]);
    assert_eq!(min["segments"][2]["segmentKey"], json!("-271821-WNaN"));
    assert_eq!(
        min["segments"][2]["segmentOrd"],
        json!(-8_640_000_086_400_000_i64)
    );
    assert!(min["segments"][3]["segmentOrd"].is_null());
    for timestamp in [-8_640_000_000_000_001, 8_640_000_000_000_001] {
        assert!(
            aggregate(&json!({"markets":[market(1.0,timestamp)],"initialCapital":1000})).is_err()
        );
    }
}
