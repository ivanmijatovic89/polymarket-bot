use market::{verify_market, MarketEngine};
use polymarket_runtime::{market, market_json};
use serde_json::{json, Value};
fn book(timestamp: &str, asset: &str) -> Value {
    json!({"event_type":"book","market":"m","asset_id":asset,"timestamp":timestamp,"hash":"h",
        "bids":[{"price":"0.4","size":"3"}],"asks":[{"price":"0.6","size":"2"}]})
}
fn change(asset: &str, price: &str, size: &str, side: &str) -> Value {
    json!({"asset_id":asset,"price":price,"size":size,"side":side,"hash":"","best_bid":"","best_ask":""})
}
#[test]
fn bootstrap_reset_and_metadata_ticks_preserve_warm_state() {
    let mut engine = MarketEngine::new(Some(["up".into(), "down".into()]), 10.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    let result = engine
        .handle_decoded(&[book("1", "up"), book("2", "down")], &source, true)
        .expect("bootstrap");
    assert!(result.ticks.is_empty());
    assert_eq!(engine.inspection().expect("inspection")["isWarm"], true);
    let trade = json!({"event_type":"last_trade_price","market":"m","asset_id":"up","timestamp":"3","price":"0.9","size":"7","side":"SELL"});
    let result = engine
        .handle_decoded(&[trade], &source, false)
        .expect("trade");
    assert!(result.ticks.is_empty());
    assert_eq!(
        engine.snapshot().expect("snapshot")["byAssetId"]["up"]["bestBid"],
        0.4
    );
    engine.reset();
    assert_eq!(
        engine.inspection().expect("inspection")["missingBooks"],
        json!(["up", "down"])
    );
}
#[test]
fn a_multi_asset_delta_emits_one_tick_after_both_books_change() {
    let mut engine = MarketEngine::new(None, 2.0).expect("config");
    let source = json!({"kind":"parquet","filePath":"fixture","ingestSeq":"900719925474099312345"});
    engine
        .handle_decoded(&[book("1", "up"), book("2", "down")], &source, false)
        .expect("books");
    let msg = json!({"event_type":"price_change","market":"m","timestamp":"3","price_changes":[change("up","0.45","4","BUY"),change("down","0.55","5","SELL")]});
    let frame = engine
        .handle_decoded(&[msg], &source, false)
        .expect("delta");
    assert_eq!(frame.ticks.len(), 1);
    assert_eq!(frame.ticks[0].snapshot["byAssetId"]["up"]["bestBid"], 0.45);
    assert_eq!(
        frame.ticks[0].snapshot["byAssetId"]["down"]["bestAsk"],
        0.55
    );
    assert_eq!(frame.ticks[0].source["ingestSeq"], "900719925474099312345");
}
#[test]
fn invalid_later_change_retains_partial_state_without_emitting_a_tick() {
    let mut engine = MarketEngine::new(None, 10.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    engine
        .handle_decoded(&[book("1", "up")], &source, false)
        .expect("book");
    let msg = json!({"event_type":"price_change","market":"m","timestamp":"2","price_changes":[change("up","0.5","6","BUY"),change("up","bad","7","BUY")]});
    let error = engine
        .handle_decoded(&[msg], &source, false)
        .expect_err("invalid delta");
    assert!(error.ticks.is_empty());
    let bids = &engine.snapshot().expect("snapshot")["byAssetId"]["up"]["bids"];
    assert_eq!(
        *bids,
        json!([{"price":0.4,"size":3.0},{"price":0.5,"size":6.0}])
    );
}
#[test]
fn duplicate_prices_replace_size_and_source_sequences_remain_exact() {
    let mut msg = book("100.9", "up");
    msg["bids"] =
        json!([{"price":"0.4","size":"1"},{"price":"0.40","size":"9"},{"price":"0.5","size":"2"}]);
    let input = json!({"operations":[{"kind":"decoded","messages":[msg,book("99","down")],"source":{"kind":"live","attempt":2,"ingestSeq":"+0009007199254740993"}}]});
    let result = verify_market(&input).expect("fixture");
    assert_eq!(result["steps"][0]["ticks"][0]["source"]["frameIndex"], 0);
    assert_eq!(
        result["steps"][0]["ticks"][1]["source"]["ingestSeq"],
        "9007199254740993"
    );
    assert_eq!(
        result["final"]["snapshot"]["byAssetId"]["up"]["bids"][1]["size"],
        9.0
    );
    assert_eq!(result["final"]["snapshot"]["timestamp"], 99.0);
}
#[test]
fn invalid_raw_frames_and_markers_are_ignored() {
    let result=verify_market(&json!({"operations":[{"kind":"raw","rawJson":"{broken"},{"kind":"raw","rawJson":"[{\"event_type\":\"disconnect\"},null,7]"}]})).expect("fixture");
    for step in result["steps"].as_array().expect("steps") {
        assert_eq!(step["ticks"], json!([]));
        assert!(step["message"].is_null());
    }
}
#[test]
fn portable_input_contract_rejects_invalid_configuration_without_panicking() {
    for input in [
        json!({"expectedAssetIds":["up"],"operations":[]}),
        json!({"operations":null}),
        json!({"operations":[{"kind":"unknown"}]}),
    ] {
        assert_eq!(
            verify_market(&input).expect_err("invalid config").code,
            "invalid_request"
        );
    }
}
#[test]
fn raw_numeric_literals_preserve_js_number_domain_and_ordinary_reserved_keys() {
    let messages = market::decode_frame(
        r#"{"event_type":"book","timestamp":9007199254740993,"extra":{"$serde_json::private::Number":"1e400","number":1e400,"negative":-1e400,"underflow":-1e-9999}}"#,
    );
    assert_eq!(messages.len(), 1);
    assert_eq!(
        messages[0].get("timestamp"),
        Some(&market::JsValue::Number(9007199254740992.0))
    );
    let extra = messages[0].get("extra").expect("metadata");
    assert_eq!(
        extra
            .get("$serde_json::private::Number")
            .and_then(market::JsValue::as_str),
        Some("1e400")
    );
    assert_eq!(
        extra.get("number"),
        Some(&market::JsValue::Number(f64::INFINITY))
    );
    assert_eq!(
        extra.get("negative"),
        Some(&market::JsValue::Number(f64::NEG_INFINITY))
    );
    assert!(
        serde_json::from_str::<Value>(&extra.to_json_string()).expect("numeric view")["number"]
            .is_null()
    );
    assert_eq!(extra.get("underflow"), Some(&market::JsValue::Number(-0.0)));
    let mut engine = MarketEngine::new(None, 10.0).expect("config");
    let result=engine.handle_raw(r#"{"event_type":"book","market":"m","asset_id":"up","timestamp":1,"bids":[],"asks":[],"extra":1e400}"#,&json!({"kind":"live","attempt":1}),false).expect("book");
    assert_eq!(
        result.ticks[0].msg.get("extra"),
        Some(&market::JsValue::Number(f64::INFINITY))
    );
    assert_eq!(
        result.message.expect("returned message").get("extra"),
        Some(&market::JsValue::Number(f64::INFINITY))
    );
}
#[test]
fn invalid_json_number_grammar_does_not_become_valid_after_conversion() {
    for number in [
        "01", "1e", "+1", "1.", "-.1", "0x1", "1e+", "--1", ".1", "NaN", "Infinity",
    ] {
        let raw = format!(r#"{{"event_type":"book","extra":{number}}}"#);
        assert!(
            market::decode_frame(&raw).is_empty(),
            "invalid literal {number}"
        );
    }
    let messages = market::decode_frame(r#"{"event_type":"book","extra":"\ud83d\ude00"}"#);
    assert_eq!(
        messages[0].get("extra").and_then(market::JsValue::as_str),
        Some("😀")
    );
}
#[test]
fn utf16_strings_keys_and_json_projection_are_lossless() {
    let values =
        market::decode_frame(r#"{"event_type":"book","extra":{"\ud800":"a\udfffb","valid":"😀"}}"#);
    let extra = values[0].get("extra").expect("metadata");
    let key = extra.as_object().expect("object")[0].0.clone();
    assert_eq!(key.units(), vec![0xd800]);
    assert_eq!(key.json(), r#""\ud800""#);
    assert_eq!(
        extra.as_object().expect("object")[0].1,
        market::JsValue::String(market::JsString::Utf16(vec![97, 0xdfff, 98]))
    );
    let normalized = market::JsValue::from_value(json!({"2":9007199254740993u64,"1":1,"01":3}));
    assert_eq!(
        normalized
            .as_object()
            .expect("object")
            .iter()
            .map(|(key, _)| key.as_str().expect("ASCII"))
            .collect::<Vec<_>>(),
        vec!["1", "2", "01"]
    );
    assert_eq!(normalized["2"], 9007199254740992.0);
}
#[test]
fn borrowed_book_depth_preserves_partial_mutations_and_nonfinite_derived_metrics() {
    let mut engine = MarketEngine::new(None, 3.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    engine
        .handle_decoded(&[book("1", "up")], &source, false)
        .expect("book");
    let view = engine.book("up").expect("borrowed book");
    assert_eq!(view.depth_levels, 3.0);
    assert_eq!(view.bids_depth, &[3.0]);
    assert_eq!(view.asks_depth, &[2.0]);
    assert_eq!(view.timestamp, 1.0);
    assert_eq!(view.asset_id.and_then(market::JsValue::as_str), Some("up"));
    assert_eq!(view.market.and_then(market::JsValue::as_str), Some("m"));
    assert_eq!(view.bids[0].price, 0.4);
    assert_eq!(view.asks[0].size, 2.0);
    let bad = json!({"event_type":"price_change","market":"m","timestamp":"2","price_changes":[change("up","0.5","6","BUY"),change("up","bad","7","BUY")]});
    engine
        .handle_decoded(&[bad], &source, false)
        .expect_err("partial mutation");
    assert_eq!(engine.book("up").expect("view").bids_depth, &[3.0, 9.0]);
    assert_eq!(engine.books().count(), 1);
    let raw = r#"{"event_type":"book","market":"m","asset_id":"up","timestamp":3,"bids":[{"price":1e308,"size":1e308},{"price":9e307,"size":1e308}],"asks":[{"price":1e308,"size":1}]}"#;
    engine
        .handle_raw(raw, &source, false)
        .expect("large finite levels");
    assert_eq!(
        engine.book("up").expect("view").bids_depth[1],
        f64::INFINITY
    );
    assert_eq!(
        engine.snapshot().expect("snapshot")["byAssetId"]["up"]["mid"],
        market::JsValue::Number(f64::INFINITY)
    );
}
#[test]
fn map_keys_canonicalize_best_zero_but_keep_level_and_metadata_sign_bits() {
    let mut engine = MarketEngine::new(None, 2.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    engine.handle_raw(r#"{"event_type":"book","market":"m","asset_id":"up","timestamp":-0,"bids":[{"price":-0,"size":1}],"asks":[{"price":0,"size":1}],"extra":-0}"#,&source,false).expect("book");
    let view = engine.book("up").expect("view");
    assert_eq!(view.bids[0].price.to_bits(), (-0.0f64).to_bits());
    assert_eq!(view.best_bid.expect("best").to_bits(), 0.0f64.to_bits());
    assert_eq!(view.best_ask.expect("best").to_bits(), 0.0f64.to_bits());
    assert_eq!(view.mid.expect("mid").to_bits(), 0.0f64.to_bits());
    assert_eq!(view.spread.expect("spread").to_bits(), 0.0f64.to_bits());
    let snapshot = engine.snapshot().expect("snapshot");
    match snapshot["byAssetId"]["up"]["bestBid"] {
        market::JsValue::Number(value) => assert_eq!(value.to_bits(), 0.0f64.to_bits()),
        _ => panic!("numeric best"),
    }
    let normalized = market_json::normalize_control_value(
        json!({"zero":-0.0,"wide":9007199254740993u64,"nested":{"zero":-0.0}}),
    );
    assert_eq!(
        normalized["zero"].as_f64().expect("zero").to_bits(),
        (-0.0f64).to_bits()
    );
    assert_eq!(
        normalized["nested"]["zero"]
            .as_f64()
            .expect("zero")
            .to_bits(),
        (-0.0f64).to_bits()
    );
    assert!(normalized["wide"].as_number().expect("wide").is_f64());
    assert_eq!(normalized["wide"].as_f64(), Some(9007199254740992.0));
}
#[test]
#[ignore = "Explicitly invoked by the independent pinned TypeScript differential runner"]
fn differential_driver() {
    let source = std::env::var("RUST_MARKET_FIXTURE_INPUT").expect("input path");
    let output = std::env::var("RUST_MARKET_FIXTURE_OUTPUT").expect("output path");
    let source: Value = serde_json::from_slice(&std::fs::read(source).expect("read fixtures"))
        .expect("fixture JSON");
    let results = market::JsValue::array(
        source["cases"]
            .as_array()
            .expect("cases")
            .iter()
            .map(|case| {
                market::JsValue::object(vec![
                    (
                        "name".into(),
                        market::JsValue::from_value(case["name"].clone()),
                    ),
                    (
                        "result".into(),
                        verify_market(&case["input"]).expect("valid fixture contract"),
                    ),
                ])
            })
            .collect(),
    );
    std::fs::write(output, results.to_json_string()).expect("write result");
}
