//! Params and requirements of the feed exerciser (60 §5.8, 30 §9, §10).

use native_strategies::feed_exerciser::{
    dwell_gate_config, time_window_gate_config, time_window_volatility_config, FeedExerciser,
    FeedExerciserParams,
};
use pmb_sdk::prelude::*;

fn params(args: &[&str]) -> Result<FeedExerciserParams, ParamError> {
    FeedExerciserParams::from_cli(args.iter().copied())
}

#[test]
fn chainlink_defaults_to_true_and_the_rest_is_required() {
    // spec: 60 §5.8 (`chainlink` defaults to true), 30 §9 rules 1, 6
    let p = params(&["tickOnUpdate=true", "trade=false", "ta=false"]).unwrap();
    assert!(p.chainlink);
    assert_eq!(
        p.normalized_json(),
        r#"{"chainlink":true,"ta":false,"tickOnUpdate":true,"trade":false}"#
    );
    let err = params(&["chainlink=false"]).unwrap_err();
    let mut paths: Vec<&str> = err.issues().iter().map(|i| i.path()).collect();
    paths.sort_unstable();
    assert_eq!(paths, ["/ta", "/tickOnUpdate", "/trade"]);
    assert!(params(&["tickOnUpdate=1", "trade=false", "ta=false"]).is_err());
    assert!(params(&["tickOnUpdate=true", "trade=false", "ta=false", "tick=true"]).is_err());
}

#[test]
fn trade_true_is_refused_until_m2() {
    // spec: 60 §5.8 (`trade: true` runs schedule v2, M2 per 01 §4.1),
    // 00 R14 (no silent substitution)
    let err = params(&["tickOnUpdate=false", "trade=true", "ta=false"]).unwrap_err();
    assert_eq!(err.issues().len(), 1);
    assert_eq!(err.issues()[0].path(), "/trade");
    assert!(err.issues()[0].message().contains("M2"));
}

#[test]
fn requirements_follow_the_params() {
    // spec: 60 §5.8 (Binance, Chainlink only when `chainlink`, price to beat,
    // tickOnUpdate per the param; TechnicalIndicators only when `ta`)
    let req = |args: &[&str]| FeedExerciser::requirements(&params(args).unwrap());
    let base = ["tickOnUpdate=false", "trade=false", "ta=false"];
    let feed = FeedOptions::default();
    let expected = Requirements::new()
        .binance_spot(feed.clone())
        .chainlink(feed)
        .price_to_beat()
        .time_window_volatility(time_window_volatility_config())
        .dwell_gate(dwell_gate_config())
        .time_window_gate(time_window_gate_config());
    assert_eq!(req(&base), expected);

    let ticking = FeedOptions {
        tick_on_update: true,
        ..FeedOptions::default()
    };
    let expected_ticking = Requirements::new()
        .binance_spot(ticking.clone())
        .chainlink(ticking)
        .price_to_beat()
        .time_window_volatility(time_window_volatility_config())
        .dwell_gate(dwell_gate_config())
        .time_window_gate(time_window_gate_config());
    assert_eq!(
        req(&["tickOnUpdate=true", "trade=false", "ta=false"]),
        expected_ticking
    );

    let no_chainlink = req(&[
        "tickOnUpdate=false",
        "trade=false",
        "ta=false",
        "chainlink=false",
    ]);
    assert_eq!(
        no_chainlink,
        Requirements::new()
            .binance_spot(FeedOptions::default())
            .price_to_beat()
            .time_window_volatility(time_window_volatility_config())
            .dwell_gate(dwell_gate_config())
            .time_window_gate(time_window_gate_config())
    );

    let ta = req(&["tickOnUpdate=false", "trade=false", "ta=true"]);
    assert_eq!(
        ta,
        expected.technical_indicators(TechnicalIndicatorsConfig::default())
    );
}
