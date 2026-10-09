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
        .handle_decoded_diagnostic(&[book("1", "up"), book("2", "down")], &source, true)
        .expect("bootstrap");
    assert!(result.ticks.is_empty());
    assert_eq!(engine.inspection().expect("inspection")["isWarm"], true);
    let trade = json!({"event_type":"last_trade_price","market":"m","asset_id":"up","timestamp":"3","price":"0.9","size":"7","side":"SELL"});
    let result = engine
        .handle_decoded_diagnostic(&[trade], &source, false)
        .expect("trade");
    assert!(result.ticks.is_empty());
    assert_eq!(
        engine.snapshot().expect("snapshot").trace_value()["byAssetId"]["up"]["bestBid"],
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
        .handle_decoded_diagnostic(&[book("1", "up"), book("2", "down")], &source, false)
        .expect("books");
    let msg = json!({"event_type":"price_change","market":"m","timestamp":"3","price_changes":[change("up","0.45","4","BUY"),change("down","0.55","5","SELL")]});
    let frame = engine
        .handle_decoded_diagnostic(&[msg], &source, false)
        .expect("delta");
    assert_eq!(frame.ticks.len(), 1);
    assert_eq!(
        frame.ticks[0].snapshot.trace_value()["byAssetId"]["up"]["bestBid"],
        0.45
    );
    assert_eq!(
        frame.ticks[0].snapshot.trace_value()["byAssetId"]["down"]["bestAsk"],
        0.55
    );
    assert_eq!(
        frame.ticks[0].source.diagnostic_value().unwrap()["ingestSeq"],
        "900719925474099312345"
    );
}
#[test]
fn invalid_later_change_retains_partial_state_without_emitting_a_tick() {
    let mut engine = MarketEngine::new(None, 10.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    engine
        .handle_decoded_diagnostic(&[book("1", "up")], &source, false)
        .expect("book");
    let msg = json!({"event_type":"price_change","market":"m","timestamp":"2","price_changes":[change("up","0.5","6","BUY"),change("up","bad","7","BUY")]});
    let error = engine
        .handle_decoded_diagnostic(&[msg], &source, false)
        .expect_err("invalid delta");
    assert!(error.ticks.is_empty());
    let bids = &engine.snapshot().expect("snapshot").trace_value()["byAssetId"]["up"]["bids"];
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
    let result=engine.handle_raw_diagnostic(r#"{"event_type":"book","market":"m","asset_id":"up","timestamp":1,"bids":[],"asks":[],"extra":1e400}"#,&json!({"kind":"live","attempt":1}),false).expect("book");
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
        .handle_decoded_diagnostic(&[book("1", "up")], &source, false)
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
        .handle_decoded_diagnostic(&[bad], &source, false)
        .expect_err("partial mutation");
    assert_eq!(engine.book("up").expect("view").bids_depth, &[3.0, 9.0]);
    assert_eq!(engine.books().count(), 1);
    let raw = r#"{"event_type":"book","market":"m","asset_id":"up","timestamp":3,"bids":[{"price":1e308,"size":1e308},{"price":9e307,"size":1e308}],"asks":[{"price":1e308,"size":1}]}"#;
    engine
        .handle_raw_diagnostic(raw, &source, false)
        .expect("large finite levels");
    assert_eq!(
        engine.book("up").expect("view").bids_depth[1],
        f64::INFINITY
    );
    assert_eq!(
        engine.snapshot().expect("snapshot").trace_value()["byAssetId"]["up"]["mid"],
        market::JsValue::Number(f64::INFINITY)
    );
}
#[test]
fn map_keys_canonicalize_best_zero_but_keep_level_and_metadata_sign_bits() {
    let mut engine = MarketEngine::new(None, 2.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    engine.handle_raw_diagnostic(r#"{"event_type":"book","market":"m","asset_id":"up","timestamp":-0,"bids":[{"price":-0,"size":1}],"asks":[{"price":0,"size":1}],"extra":-0}"#,&source,false).expect("book");
    let view = engine.book("up").expect("view");
    assert_eq!(view.bids[0].price.to_bits(), (-0.0f64).to_bits());
    assert_eq!(view.best_bid.expect("best").to_bits(), 0.0f64.to_bits());
    assert_eq!(view.best_ask.expect("best").to_bits(), 0.0f64.to_bits());
    assert_eq!(view.mid.expect("mid").to_bits(), 0.0f64.to_bits());
    assert_eq!(view.spread.expect("spread").to_bits(), 0.0f64.to_bits());
    let snapshot = engine.snapshot().expect("snapshot").trace_value();
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
fn retained_ticks_survive_later_frames_metadata_updates_and_reset() {
    let mut engine = MarketEngine::new(None, 2.0).expect("config");
    let source =
        json!({"kind":"live","attempt":7,"ingestSeq":"900719925474099312345","tsLocalMs":123});
    let frame = engine
        .handle_decoded_diagnostic(&[book("1", "up"), book("2", "down")], &source, false)
        .expect("frame");
    let first = &frame.ticks[0];
    let second = &frame.ticks[1];
    assert_eq!(first.snapshot.timestamp, 1.0);
    assert!(first.snapshot.book("down").is_none());
    assert_eq!(second.snapshot.timestamp, 2.0);
    assert_eq!(second.source.diagnostic_value().unwrap()["frameIndex"], 1);
    engine.handle_decoded_diagnostic(&[json!({"event_type":"price_change","market":"m","timestamp":3,"price_changes":[change("up","0.5","4","BUY")]})], &source, false).expect("later");
    assert_eq!(
        engine
            .snapshot()
            .expect("current")
            .book("up")
            .expect("book")
            .best_bid,
        Some(0.5)
    );
    assert_eq!(
        first.snapshot.book("up").expect("first book").best_bid,
        Some(0.4)
    );
    assert_eq!(
        second
            .snapshot
            .book("up")
            .expect("second book")
            .bids_depth
            .as_ref(),
        &[3.0]
    );
    engine.reset();
    assert!(engine.snapshot().expect("reset").by_asset_id.is_empty());
    assert_eq!(
        second
            .snapshot
            .book("down")
            .expect("retained down")
            .best_ask,
        Some(0.6)
    );
    assert_eq!(first.msg["asset_id"], "up");
    assert_eq!(
        first.source.diagnostic_value().unwrap()["ingestSeq"],
        "900719925474099312345"
    );
}
#[test]
fn immutable_snapshot_caches_share_unchanged_books_sides_and_depth_arrays() {
    use std::sync::Arc;
    let mut engine = MarketEngine::new(None, 2.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    engine
        .handle_decoded_diagnostic(&[book("1", "up"), book("2", "down")], &source, false)
        .expect("books");
    let before = engine.snapshot().expect("before");
    assert!(Arc::ptr_eq(&before, &engine.snapshot().expect("cached")));
    let update = json!({"event_type":"price_change","market":"m","timestamp":3,"price_changes":[change("up","0.4","9","BUY")]});
    engine
        .handle_decoded_diagnostic(&[update], &source, false)
        .expect("update");
    let after = engine.snapshot().expect("after");
    let old_up = before.book("up").expect("up");
    let new_up = after.book("up").expect("up");
    assert!(!Arc::ptr_eq(&old_up.bids, &new_up.bids));
    assert!(!Arc::ptr_eq(&old_up.bids_depth, &new_up.bids_depth));
    assert!(Arc::ptr_eq(&old_up.asks, &new_up.asks));
    assert!(Arc::ptr_eq(&old_up.asks_depth, &new_up.asks_depth));
    assert!(Arc::ptr_eq(
        &before.by_asset_id[1].book,
        &after.by_asset_id[1].book
    ));
    assert!(Arc::ptr_eq(
        old_up.asset_id.as_ref().expect("id"),
        new_up.asset_id.as_ref().expect("id")
    ));
    let noop = json!({"event_type":"price_change","market":"m","timestamp":3,"price_changes":[change("up","0.4","9","BUY")]});
    engine
        .handle_decoded_diagnostic(&[noop], &source, false)
        .expect("noop");
    assert!(Arc::ptr_eq(&after, &engine.snapshot().expect("unchanged")));
    let meta = json!({"event_type":"tick_size_change","market":"m","asset_id":"up","timestamp":4,"new_tick_size":"0.01"});
    engine
        .handle_decoded_diagnostic(&[meta], &source, false)
        .expect("metadata");
    let metadata = engine.snapshot().expect("metadata snapshot");
    let meta_up = metadata.book("up").expect("up");
    assert!(Arc::ptr_eq(&new_up.bids, &meta_up.bids));
    assert!(Arc::ptr_eq(&new_up.asks, &meta_up.asks));
    assert!(Arc::ptr_eq(&new_up.bids_depth, &meta_up.bids_depth));
    assert_eq!(meta_up.timestamp, 4.0);
    let empty = json!({"event_type":"price_change","market":"m","timestamp":5,"price_changes":[]});
    engine
        .handle_decoded_diagnostic(&[empty], &source, false)
        .expect("empty");
    let advanced = engine.snapshot().expect("advanced");
    assert!(Arc::ptr_eq(&metadata.by_asset_id, &advanced.by_asset_id));
    assert_eq!(advanced.timestamp, 5.0);
}
#[test]
fn cache_refreshes_partial_failures_without_changing_retained_ticks() {
    let mut engine = MarketEngine::new(None, 3.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    let first = engine
        .handle_decoded_diagnostic(&[book("1", "up")], &source, false)
        .expect("book")
        .ticks
        .remove(0);
    let partial = json!({"event_type":"price_change","market":"m","timestamp":2,"price_changes":[change("up","0.5","6","BUY"),change("up","bad","1","BUY")]});
    engine
        .handle_decoded_diagnostic(&[partial], &source, false)
        .expect_err("partial delta");
    let failed = engine.snapshot().expect("partial state");
    assert_eq!(
        failed.book("up").expect("up").bids_depth.as_ref(),
        &[3.0, 9.0]
    );
    assert_eq!(failed.book("up").expect("up").bids[0].price, 0.4);
    assert_eq!(first.snapshot.book("up").expect("retained").bids.len(), 1);
    let mut bad_book = book("bad", "up");
    bad_book["bids"] = json!([{"price":"0.9","size":"7"}]);
    engine
        .handle_decoded_diagnostic(&[bad_book], &source, false)
        .expect_err("timestamp after levels");
    let latest = engine.snapshot().expect("replacement partial");
    assert_eq!(latest.book("up").expect("up").bids[0].price, 0.9);
    assert_eq!(latest.book("up").expect("up").timestamp, 2.0);
    assert_eq!(failed.book("up").expect("retained failure").bids.len(), 2);
    engine.reset();
    assert_eq!(first.snapshot.book("up").expect("retained").timestamp, 1.0);
}
#[test]
fn retained_typed_snapshots_keep_nonfinite_signed_zero_and_lossless_keys() {
    let mut engine = MarketEngine::new(None, 3.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    let first = engine.handle_raw_diagnostic(r#"{"event_type":"book","market":"m\ud800","asset_id":"a\udfff","timestamp":-0,"bids":[{"price":-0,"size":1}],"asks":[{"price":0,"size":1}]}"#, &source, false).expect("zero").ticks.remove(0);
    let key = market::JsString::from_units(vec![97, 0xdfff]);
    let frozen = first.snapshot.book_key(&key).expect("UTF16 book");
    assert_eq!(first.snapshot.timestamp.to_bits(), (-0.0f64).to_bits());
    assert_eq!(frozen.timestamp.to_bits(), (-0.0f64).to_bits());
    assert_eq!(frozen.bids[0].price.to_bits(), (-0.0f64).to_bits());
    assert_eq!(frozen.best_bid.expect("best").to_bits(), 0.0f64.to_bits());
    assert_eq!(
        frozen.market.as_deref().expect("market"),
        &market::JsValue::String(market::JsString::from_units(vec![109, 0xd800]))
    );
    engine.handle_raw_diagnostic(r#"{"event_type":"book","market":"m\ud800","asset_id":"a\udfff","timestamp":2,"bids":[{"price":1e308,"size":1e308},{"price":9e307,"size":1e308}],"asks":[{"price":1e308,"size":1}]}"#, &source, false).expect("overflow");
    let overflow = engine.snapshot().expect("overflow");
    let book = overflow.book_key(&key).expect("book");
    assert_eq!(book.mid, Some(f64::INFINITY));
    assert_eq!(book.bids_depth[1], f64::INFINITY);
    assert_eq!(book.view().bids_depth[1], f64::INFINITY);
    assert_eq!(frozen.bids[0].price.to_bits(), (-0.0f64).to_bits());
    let projected = market_json::parse(&overflow.trace_value().to_json_string()).expect("JSON");
    assert!(projected["byAssetId"].as_object().expect("books")[0].1["mid"].is_null());
}
#[test]
fn typed_entry_keys_preserve_js_collisions_numeric_order_and_identity_metadata() {
    let mut engine = MarketEngine::new(None, 2.0).expect("config");
    let source = json!({"kind":"live","attempt":1});
    let mut numeric = book("1", "x");
    numeric["asset_id"] = json!(2);
    let mut object_id = book("2", "x");
    object_id["asset_id"] = json!({"tag":1});
    let result = engine
        .handle_decoded_diagnostic(
            &[
                numeric,
                object_id,
                book("3", "2"),
                book("4", "1"),
                book("5", "01"),
            ],
            &source,
            false,
        )
        .expect("identities");
    let first = &result.ticks[0].snapshot;
    let latest = &result.ticks[4].snapshot;
    assert_eq!(
        latest
            .books()
            .map(|entry| entry.key.as_str().expect("key"))
            .collect::<Vec<_>>(),
        vec!["1", "2", "[object Object]", "01"]
    );
    assert_eq!(
        first.book("2").expect("numeric id").asset_id.as_deref(),
        Some(&market::JsValue::Number(2.0))
    );
    assert_eq!(
        latest
            .book("2")
            .expect("last-write key")
            .asset_id
            .as_deref()
            .and_then(market::JsValue::as_str),
        Some("2")
    );
    let object = latest
        .book("[object Object]")
        .expect("object")
        .asset_id
        .as_deref()
        .expect("id");
    assert!(object.same_identity(&result.ticks[1].msg["asset_id"]));
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

#[test]
fn typed_sources_keep_bigint_clock_bits_utf16_and_mutable_identity() {
    use num_bigint::BigInt;
    use polymarket_runtime::{
        metadata::{MetadataGraph, MetadataValue},
        source::{SourceHandle, FILE_PATH, LOCAL_TIME_MS},
    };
    let graph = MetadataGraph::new();
    let sequence: BigInt = "900719925474099312345678901234567890".parse().unwrap();
    let path = market_json::JsString::from_units(vec![0x66, 0xd800, 0x70]);
    let source =
        SourceHandle::parquet(&graph, path.clone(), sequence.clone(), Some(f64::INFINITY)).unwrap();
    let mut engine = MarketEngine::new(None, 10.0).unwrap();
    let tick = engine
        .handle_decoded(
            &[market_json::JsValue::from_value(book("1", "up"))],
            &source,
            false,
        )
        .unwrap()
        .ticks
        .remove(0);
    assert_eq!(tick.source, source);
    assert_eq!(tick.source.sequence().unwrap(), Some(sequence));
    assert_eq!(
        tick.source
            .number(LOCAL_TIME_MS)
            .unwrap()
            .unwrap()
            .to_bits(),
        f64::INFINITY.to_bits()
    );
    assert!(
        matches!(tick.source.get(FILE_PATH).unwrap(), MetadataValue::String(value) if value == path)
    );
    source
        .set(LOCAL_TIME_MS, MetadataValue::Number(-0.0))
        .unwrap();
    assert_eq!(
        tick.source
            .number(LOCAL_TIME_MS)
            .unwrap()
            .unwrap()
            .to_bits(),
        (-0.0f64).to_bits()
    );
    source
        .set(LOCAL_TIME_MS, MetadataValue::Number(f64::NEG_INFINITY))
        .unwrap();
    assert_eq!(
        tick.source
            .number(LOCAL_TIME_MS)
            .unwrap()
            .unwrap()
            .to_bits(),
        f64::NEG_INFINITY.to_bits()
    );
    source
        .set(LOCAL_TIME_MS, MetadataValue::Number(f64::NAN))
        .unwrap();
    assert!(tick.source.number(LOCAL_TIME_MS).unwrap().unwrap().is_nan());
    let projection = tick.source.diagnostic_value().unwrap();
    assert!(projection.to_json_string().contains("\\ud800"));
    assert!(projection.to_json_string().contains("\"tsLocalMs\":null"));
}

#[test]
fn source_children_spread_current_slots_and_share_nested_edges() {
    use polymarket_runtime::{
        metadata::{MetadataGraph, MetadataValue},
        source::{SourceHandle, FRAME_INDEX, LOCAL_TIME_MS},
    };
    let graph = MetadataGraph::new();
    let nested = graph.object().unwrap();
    nested.set("value", 1.0.into()).unwrap();
    let source = SourceHandle::new_in_graph(
        &graph,
        vec![
            ("frameIndex".into(), 99.0.into()),
            ("kind".into(), "live".into()),
            ("ingestSeq".into(), MetadataValue::BigInt(9.into())),
            ("extra".into(), nested.clone().into()),
            ("tsLocalMs".into(), (-0.0).into()),
        ],
    )
    .unwrap();
    let one = source.for_frame_child(0, 2).unwrap();
    assert_ne!(one, source);
    source.set(LOCAL_TIME_MS, 12.0.into()).unwrap();
    let two = source.for_frame_child(1, 2).unwrap();
    assert_ne!(one, two);
    assert_eq!(
        one.number(LOCAL_TIME_MS).unwrap().unwrap().to_bits(),
        (-0.0f64).to_bits()
    );
    assert_eq!(two.number(LOCAL_TIME_MS).unwrap(), Some(12.0));
    assert_eq!(source.number(FRAME_INDEX).unwrap(), Some(99.0));
    assert_eq!(one.number(FRAME_INDEX).unwrap(), Some(0.0));
    assert_eq!(two.number(FRAME_INDEX).unwrap(), Some(1.0));
    assert_eq!(
        one.record()
            .as_handle()
            .keys()
            .unwrap()
            .first()
            .unwrap()
            .as_str(),
        Some("frameIndex")
    );
    nested.set("value", 7.0.into()).unwrap();
    for child in [one, two] {
        let MetadataValue::Reference(alias) = child.record().as_handle().get("extra").unwrap()
        else {
            panic!("nested handle")
        };
        assert_eq!(alias, nested);
        assert!(matches!(
            alias.get("value").unwrap(),
            MetadataValue::Number(7.0)
        ));
    }
    let legacy = SourceHandle::live(&graph, 1.0, None).unwrap();
    assert_eq!(legacy.for_frame_child(1, 3).unwrap(), legacy);
}

#[test]
fn source_graph_import_order_undefined_slots_cycles_and_ownership_are_explicit() {
    use polymarket_runtime::{
        metadata::{MetadataError, MetadataGraph, MetadataValue},
        source::{SourceHandle, INGEST_SEQ},
    };
    let graph = MetadataGraph::new();
    let other_graph = MetadataGraph::new();
    let own = SourceHandle::live(&graph, 1.0, None).unwrap();
    assert_eq!(
        SourceHandle::from_record_in_graph(&graph, own.record().clone()).unwrap(),
        own
    );
    assert!(matches!(
        SourceHandle::from_record_in_graph(&other_graph, own.record().clone()),
        Err(MetadataError::WrongGraph)
    ));
    let foreign = other_graph.object().unwrap();
    assert!(matches!(
        SourceHandle::new_in_graph(&graph, vec![("extra".into(), foreign.into())]),
        Err(MetadataError::WrongGraph)
    ));
    let source = SourceHandle::from_diagnostic_js(
        &graph,
        market_json::parse(
            r#"{"z":1,"10":2,"2":3,"ingestSeq":"-0009","extra":{"a\ud800":[-0,1e400]}}"#,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(source.sequence().unwrap(), Some((-9).into()));
    assert_eq!(
        source
            .record()
            .as_handle()
            .keys()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["2", "10", "z", "ingestSeq", "extra"]
    );
    let projected = source.diagnostic_value().unwrap();
    assert!(projected.to_json_string().contains("a\\ud800"));
    let empty =
        SourceHandle::new_in_graph(&graph, vec![("ingestSeq".into(), MetadataValue::Missing)])
            .unwrap();
    assert!(empty.has(INGEST_SEQ).unwrap());
    assert_ne!(empty.for_frame_child(1, 2).unwrap(), empty);
    assert_eq!(empty.diagnostic_value().unwrap().to_json_string(), "{}");
    source
        .record()
        .as_handle()
        .set("self", source.record().clone().into())
        .unwrap();
    assert_eq!(
        source.diagnostic_value().unwrap_err(),
        MetadataError::CircularReference
    );
}

#[test]
fn deep_source_diagnostic_import_and_projection_are_iterative() {
    use polymarket_runtime::{metadata::MetadataGraph, source::SourceHandle};
    let graph = MetadataGraph::new();
    let mut value = json!(-0.0);
    for _ in 0..2000 {
        value = Value::Array(vec![value]);
    }
    let mut properties = serde_json::Map::new();
    properties.insert("kind".into(), Value::String("live".into()));
    properties.insert("extra".into(), value);
    let source = SourceHandle::from_diagnostic(&graph, Value::Object(properties)).unwrap();
    let value = source.diagnostic_value().unwrap();
    let mut nested = &value["extra"];
    for _ in 0..2000 {
        nested = &nested.as_array().unwrap()[0];
    }
    let market_json::JsValue::Number(value) = nested else {
        panic!("Number")
    };
    assert_eq!(value.to_bits(), (-0.0f64).to_bits());
}
