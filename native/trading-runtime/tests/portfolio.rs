//! Unit tests and a test-only differential adapter. Production uses typed events.
use polymarket_runtime::math;
use polymarket_runtime::portfolio::*;
use serde_json::{json, Value};

fn event(value: Value) -> AccountEvent {
    serde_json::from_value(value).unwrap()
}
fn order(id: &str, size: f64) -> Value {
    json!({"clientOrderId":id,"assetId":"up","side":"BUY","price":0.6,"size":size,
        "remaining":size,"filled":0,"state":"requested","createdAtMs":1000,"updatedAtMs":1000})
}
fn apply(portfolio: &mut Portfolio, value: Value) {
    portfolio.apply(&event(value));
}
fn snapshot(portfolio: &mut Portfolio) -> Value {
    serde_json::to_value(portfolio.snapshot()).unwrap()
}

#[test]
fn observation_clock_and_snapshot_cache() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 9_000_000.0).unwrap();
    assert_eq!(p.snapshot().now_ms, 9_000_000.0);
    let rebuilds = p.snapshot_rebuilds();
    p.snapshot();
    assert_eq!(p.snapshot_rebuilds(), rebuilds);
    p.initialize_clock(f64::NAN);
    assert_eq!(p.snapshot_rebuilds(), rebuilds);
    p.initialize_clock(1000.0);
    assert_eq!(p.snapshot().now_ms, 1000.0);
    p.initialize_clock(2000.0);
    assert_eq!(p.snapshot().now_ms, 1000.0);
    apply(
        &mut p,
        json!({"kind":"cancel_failed","tsMs":900,"operation":"cancel_order","reason":"failure"}),
    );
    assert_eq!(p.snapshot().now_ms, 1000.0);
    assert_eq!(p.snapshot_rebuilds(), rebuilds + 2);
}
#[test]
fn buffered_fill_replays_on_open_without_double_cash_or_history_update() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    apply(
        &mut p,
        json!({"kind":"order_submitted","tsMs":1000,"order":order("a",10.0)}),
    );
    apply(
        &mut p,
        json!({"kind":"fill","fill":{"id":"f","tsMs":1001,"clientOrderId":"a","orderId":"x","assetId":"up","side":"BUY","price":0.6,"size":3}}),
    );
    assert_eq!(p.get_open_order("a").unwrap().filled, 0.0);
    apply(
        &mut p,
        json!({"kind":"order_open","tsMs":1002,"clientOrderId":"a","orderId":"x"}),
    );
    assert_eq!(p.get_open_order("a").unwrap().filled, 3.0);
    let s = snapshot(&mut p);
    assert_eq!(s["ordersByClientId"]["a"]["sizeMatched"], 0.0);
    assert_eq!(s["capital"]["cash"], 498.2);
}
#[test]
fn unresolved_cancel_retains_commitment_and_late_fill_reconciles_once() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    apply(
        &mut p,
        json!({"kind":"order_submitted","tsMs":1000,"order":order("a",800.0)}),
    );
    apply(
        &mut p,
        json!({"kind":"order_accepted","tsMs":1001,"clientOrderId":"a","orderId":"x"}),
    );
    apply(
        &mut p,
        json!({"kind":"order_done","tsMs":1002,"clientOrderId":"a","orderId":"x","reason":"canceled"}),
    );
    assert_eq!(p.reserved_cash(), 493.44);
    apply(
        &mut p,
        json!({"kind":"ws_order_update","tsMs":1003,"order":{"orderId":"x","event":"CANCELLATION","status":"CANCELED","originalSize":800,"sizeMatched":300}}),
    );
    assert_eq!(p.reserved_cash(), 185.04);
    let fill = json!({"kind":"fill","fill":{"id":"f","tsMs":1004,"orderId":"x","assetId":"up","side":"BUY","price":0.6,"size":300,"liquidity":"TAKER","feeRateBps":700}});
    apply(&mut p, fill.clone());
    apply(&mut p, fill);
    let s = snapshot(&mut p);
    assert_eq!(s["capital"]["cash"], 314.96);
    assert_eq!(s["capital"]["reservedCash"], 0.0);
    assert_eq!(s["recentFills"].as_array().unwrap().len(), 1);
}
#[test]
fn fees_rounding_capital_validation_and_sell_clamp() {
    assert!(validate_starting_capital(-1.0).is_err());
    assert!(validate_starting_capital(f64::NAN).is_err());
    assert_eq!(validate_starting_capital(0.0), Ok(0.0));
    assert_eq!(math::compute_taker_fee(700.0, 0.5, 100.0), 1.75);
    assert_eq!(math::compute_taker_fee(700.0, 0.6, 100.0), 1.68);
    assert_eq!(math::compute_taker_fee(700.0, 0.0, 100.0), 0.0);
    assert_eq!(math::compute_taker_fee(700.0, 1.0, 100.0), 0.0);
    assert_eq!(math::compute_taker_fee(f64::INFINITY, 0.5, 100.0), 0.0);
    assert_eq!(round8(-0.000000005), -0.0);
    assert!(round8(-0.000000005).is_sign_negative());
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    apply(
        &mut p,
        json!({"kind":"fill","fill":{"id":"b","tsMs":1,"assetId":"up","side":"BUY","price":0.5,"size":100,"liquidity":"TAKER","feeRateBps":700}}),
    );
    apply(
        &mut p,
        json!({"kind":"fill","fill":{"id":"s","tsMs":2,"assetId":"up","side":"SELL","price":0.6,"size":100,"liquidity":"TAKER","feeRateBps":700}}),
    );
    assert_eq!(p.snapshot().realized_pnl_total, 6.57);
    assert!(p.snapshot().positions_by_asset_id.is_empty());
}
#[test]
fn invalid_fill_does_not_consume_id_but_invalid_merge_does() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    let mut fill: Fill = serde_json::from_value(
        json!({"id":"f","tsMs":1,"assetId":"up","side":"BUY","price":0.5,"size":1}),
    )
    .unwrap();
    fill.price = f64::NAN;
    p.apply(&AccountEvent::Fill { fill: fill.clone() });
    fill.price = 0.5;
    p.apply(&AccountEvent::Fill { fill });
    assert_eq!(p.snapshot().recent_fills.len(), 1);
    apply(
        &mut p,
        json!({"kind":"positions_merged","id":"m","tsMs":2,"assetIdA":"up","assetIdB":"up","size":2}),
    );
    apply(
        &mut p,
        json!({"kind":"positions_merged","id":"m","tsMs":3,"assetIdA":"up","assetIdB":"down","size":2}),
    );
    assert_eq!(p.snapshot().capital.cash, 499.5);
}
#[test]
fn snapshot_clones_are_explicit_historical_values_and_cache_is_reused() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    apply(
        &mut p,
        json!({"kind":"order_submitted","tsMs":1,"order":order("a",10.0)}),
    );
    let historical = p.snapshot().clone();
    let generation = p.snapshot_rebuilds();
    p.snapshot();
    assert_eq!(p.snapshot_rebuilds(), generation);
    apply(
        &mut p,
        json!({"kind":"order_accepted","tsMs":2,"clientOrderId":"a","orderId":"x"}),
    );
    assert_eq!(
        historical.open_orders_by_client_id.get("a").unwrap().state,
        OrderState::Requested
    );
    assert_eq!(
        p.snapshot()
            .open_orders_by_client_id
            .get("a")
            .unwrap()
            .state,
        OrderState::Open
    );
    // TS stale OpenOrder aliases differ; the differential report keeps this
    // SDK/consumer dependency open rather than treating clone parity as proven.
}

#[test]
fn object_iteration_matches_snapshot_numeric_key_order() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    for id in ["10", "2", "a", "01", "4294967295", "0"] {
        apply(
            &mut p,
            json!({"kind":"order_submitted","tsMs":1,"order":order(id,1.0)}),
        );
    }
    let actual: Vec<_> = p
        .snapshot()
        .open_orders_by_client_id
        .object_iter()
        .map(|(key, _)| key)
        .collect();
    assert_eq!(actual, ["0", "2", "10", "a", "01", "4294967295"]);
    let insertion: Vec<_> = p
        .snapshot()
        .open_orders_by_client_id
        .iter()
        .map(|(key, _)| key)
        .collect();
    assert_eq!(insertion, ["10", "2", "a", "01", "4294967295", "0"]);
}

#[test]
fn done_event_accepts_only_terminal_reasons() {
    for reason in ["filled", "canceled", "expired", "killed"] {
        let value = json!({"kind":"order_done","tsMs":1,"reason":reason});
        assert!(serde_json::from_value::<AccountEvent>(value).is_ok());
    }
    for reason in [
        "requested",
        "open",
        "partially_filled",
        "rejected",
        "cancelled",
        "unknown",
        "",
    ] {
        let value = json!({"kind":"order_done","tsMs":1,"reason":reason});
        assert!(serde_json::from_value::<AccountEvent>(value).is_err());
    }
}

#[test]
fn opaque_json_metadata_uses_javascript_numbers_and_key_order() {
    let value = r#"{"kind":"order_submitted","tsMs":1,"order":{"clientOrderId":"a","assetId":"up","side":"BUY","price":0.5,"size":1,"remaining":1,"filled":0,"state":"requested","createdAtMs":1,"updatedAtMs":1,"meta":{"2":{"nonce":9007199254740993},"1":18446744073709551615,"a":[-9007199254740993,123456789012345678901234567890123456789]},"opaqueOrder":{"10":1,"2":2,"nonce":9007199254740993}}}"#;
    let event: AccountEvent = serde_json::from_str(value).unwrap();
    let AccountEvent::OrderSubmitted { order, .. } = &event else {
        panic!("fixture kind");
    };
    let meta = order.meta.as_ref().unwrap();
    assert!(meta["2"]["nonce"].is_f64());
    assert_ne!(meta["2"]["nonce"].as_u64(), Some(9007199254740993));
    assert_eq!(meta["2"]["nonce"].as_f64(), Some(9007199254740992.0));
    assert_eq!(meta["a"][0].as_f64(), Some(-9007199254740992.0));
    assert_eq!(
        meta.as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["1", "2", "a"]
    );
    assert_eq!(
        order.extensions["opaqueOrder"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["2", "10", "nonce"]
    );
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    p.apply(&event);
    assert_eq!(
        p.snapshot()
            .orders_by_client_id
            .get("a")
            .unwrap()
            .meta
            .as_ref()
            .unwrap()["2"]["nonce"]
            .as_f64(),
        Some(9007199254740992.0)
    );
}

fn pointer_key(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}
fn opaque_object_keys(value: &Value) -> Value {
    fn visit(value: &Value, path: &str, opaque: bool, result: &mut serde_json::Map<String, Value>) {
        match value {
            Value::Array(children) => {
                for (index, child) in children.iter().enumerate() {
                    visit(child, &format!("{path}/{index}"), opaque, result);
                }
            }
            Value::Object(children) => {
                if opaque {
                    result.insert(path.to_owned(), json!(children.keys().collect::<Vec<_>>()));
                }
                for (key, child) in children {
                    let child_opaque = opaque
                        || [
                            "meta",
                            "intentMeta",
                            "opaqueOrder",
                            "opaqueFill",
                            "opaqueSplit",
                            "adapterTrace",
                            "executionReceipt",
                        ]
                        .contains(&key.as_str());
                    visit(
                        child,
                        &format!("{path}/{}", pointer_key(key)),
                        child_opaque,
                        result,
                    );
                }
            }
            _ => {}
        }
    }
    let mut result = serde_json::Map::new();
    visit(value, "", false, &mut result);
    Value::Object(result)
}

#[test]
fn control_metadata_and_extensions_preserve_negative_zero_internally() {
    let value = r#"{"kind":"fill","fill":{"id":"f","tsMs":1,"assetId":"up","side":"BUY","price":0.5,"size":1,"intentMeta":{"negativeZero":-0},"opaqueFill":{"nested":[-0.0,0]}}}"#;
    let event: AccountEvent = serde_json::from_str(value).unwrap();
    let AccountEvent::Fill { fill } = &event else {
        panic!("fixture kind");
    };
    assert_eq!(
        fill.intent_meta.as_ref().unwrap()["negativeZero"]
            .as_f64()
            .unwrap()
            .to_bits(),
        (-0.0_f64).to_bits()
    );
    assert_eq!(
        fill.extensions["opaqueFill"]["nested"][0]
            .as_f64()
            .unwrap()
            .to_bits(),
        (-0.0_f64).to_bits()
    );
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    p.apply(&event);
    assert_eq!(
        p.snapshot().recent_fills[0].intent_meta.as_ref().unwrap()["negativeZero"]
            .as_f64()
            .unwrap()
            .to_bits(),
        (-0.0_f64).to_bits()
    );
}
fn opaque_number_bits(value: &Value, all_numbers: bool) -> Value {
    fn visit(value: &Value, path: &str, opaque: bool, result: &mut serde_json::Map<String, Value>) {
        match value {
            Value::Number(number) if opaque => {
                result.insert(
                    path.to_owned(),
                    json!(format!("{:016x}", number.as_f64().unwrap().to_bits())),
                );
            }
            Value::Array(children) => {
                for (index, child) in children.iter().enumerate() {
                    visit(child, &format!("{path}/{index}"), opaque, result);
                }
            }
            Value::Object(children) => {
                for (key, child) in children {
                    let child_opaque = opaque
                        || [
                            "meta",
                            "intentMeta",
                            "opaqueOrder",
                            "opaqueFill",
                            "opaqueSplit",
                            "adapterTrace",
                            "executionReceipt",
                        ]
                        .contains(&key.as_str());
                    visit(
                        child,
                        &format!("{path}/{}", pointer_key(key)),
                        child_opaque,
                        result,
                    );
                }
            }
            _ => {}
        }
    }
    let mut result = serde_json::Map::new();
    visit(value, "", all_numbers, &mut result);
    Value::Object(result)
}

// Read numeric state before JSON serialization can turn nonfinite values into null.
fn snapshot_number_bits(snapshot: &PortfolioSnapshot) -> Value {
    struct Probe(serde_json::Map<String, Value>);
    impl Probe {
        fn number(&mut self, path: &str, value: f64) {
            self.0
                .insert(path.to_owned(), json!(format!("{:016x}", value.to_bits())));
        }
        fn optional(&mut self, path: &str, value: Option<f64>) {
            if let Some(value) = value {
                self.number(path, value);
            }
        }
        fn json(&mut self, path: &str, value: &Value) {
            match value {
                Value::Number(value) => self.number(path, value.as_f64().unwrap()),
                Value::Array(values) => {
                    for (index, value) in values.iter().enumerate() {
                        self.json(&format!("{path}/{index}"), value);
                    }
                }
                Value::Object(values) => {
                    for (key, value) in values {
                        self.json(&format!("{path}/{}", pointer_key(key)), value);
                    }
                }
                _ => {}
            }
        }
        fn metadata(&mut self, path: &str, value: &Option<Value>) {
            if let Some(value) = value {
                self.json(path, value);
            }
        }
        fn extensions(&mut self, path: &str, values: &serde_json::Map<String, Value>) {
            for (key, value) in values {
                self.json(&format!("{path}/{}", pointer_key(key)), value);
            }
        }
    }
    let mut probe = Probe(serde_json::Map::new());
    probe.number(
        "/capital/startingCapital",
        snapshot.capital.starting_capital,
    );
    probe.number("/capital/cash", snapshot.capital.cash);
    probe.number("/capital/reservedCash", snapshot.capital.reserved_cash);
    probe.number("/capital/availableCash", snapshot.capital.available_cash);
    probe.number("/nowMs", snapshot.now_ms);
    probe.number("/realizedPnlTotal", snapshot.realized_pnl_total);
    for (id, position) in snapshot.positions_by_asset_id.object_iter() {
        let path = format!("/positionsByAssetId/{}", pointer_key(id));
        probe.number(&format!("{path}/qty"), position.qty);
        probe.optional(&format!("{path}/avgEntryPrice"), position.avg_entry_price);
        probe.number(&format!("{path}/costBasis"), position.cost_basis);
    }
    for (id, order) in snapshot.open_orders_by_client_id.object_iter() {
        let path = format!("/openOrdersByClientId/{}", pointer_key(id));
        for (field, value) in [
            ("price", order.price),
            ("size", order.size),
            ("remaining", order.remaining),
            ("filled", order.filled),
            ("createdAtMs", order.created_at_ms),
            ("updatedAtMs", order.updated_at_ms),
        ] {
            probe.number(&format!("{path}/{field}"), value);
        }
        probe.optional(&format!("{path}/expireAtMs"), order.expire_at_ms);
        probe.metadata(&format!("{path}/meta"), &order.meta);
        probe.extensions(&path, &order.extensions);
    }
    for (id, order) in snapshot.ws_open_orders_by_order_id.object_iter() {
        let path = format!("/wsOpenOrdersByOrderId/{}", pointer_key(id));
        for (field, value) in [
            ("price", order.price),
            ("originalSize", order.original_size),
            ("sizeMatched", order.size_matched),
        ] {
            probe.optional(&format!("{path}/{field}"), value);
        }
        probe.number(&format!("{path}/updatedAtMs"), order.updated_at_ms);
    }
    for (id, order) in snapshot.orders_by_client_id.object_iter() {
        let path = format!("/ordersByClientId/{}", pointer_key(id));
        for (field, value) in [
            ("price", order.price),
            ("originalSize", order.original_size),
            ("sizeMatched", order.size_matched),
            ("remaining", order.remaining),
        ] {
            probe.optional(&format!("{path}/{field}"), value);
        }
        probe.number(
            &format!("{path}/tradeStatusRank"),
            f64::from(order.trade_status_rank),
        );
        probe.number(&format!("{path}/updatedAtMs"), order.updated_at_ms);
        probe.metadata(&format!("{path}/meta"), &order.meta);
    }
    for (index, fill) in snapshot.recent_fills.iter().enumerate() {
        let path = format!("/recentFills/{index}");
        for (field, value) in [
            ("tsMs", fill.ts_ms),
            ("price", fill.price),
            ("size", fill.size),
        ] {
            probe.number(&format!("{path}/{field}"), value);
        }
        probe.optional(&format!("{path}/feeRateBps"), fill.fee_rate_bps);
        probe.metadata(&format!("{path}/intentMeta"), &fill.intent_meta);
        probe.extensions(&path, &fill.extensions);
    }
    for (index, split) in snapshot.recent_splits.iter().enumerate() {
        let path = format!("/recentSplits/{index}");
        for (field, value) in [
            ("tsMs", split.ts_ms),
            ("size", split.size),
            ("splitCost", split.split_cost),
        ] {
            probe.number(&format!("{path}/{field}"), value);
        }
        probe.extensions(&path, &split.extensions);
    }
    Value::Object(probe.0)
}

#[test]
fn derived_nonfinite_snapshot_numbers_are_probed_before_json_projection() {
    let mut portfolio = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    apply(
        &mut portfolio,
        json!({"kind":"fill","fill":{"id":"overflow","tsMs":1,
        "assetId":"up","side":"BUY","price":1e308,"size":1e308,"liquidity":"MAKER"}}),
    );
    let current = portfolio.snapshot();
    let bits = snapshot_number_bits(current);
    for path in ["/capital/cash", "/capital/availableCash"] {
        assert_eq!(bits[path], "fff0000000000000");
    }
    for path in [
        "/positionsByAssetId/up/qty",
        "/positionsByAssetId/up/avgEntryPrice",
        "/positionsByAssetId/up/costBasis",
    ] {
        assert_eq!(bits[path], "7ff0000000000000");
    }
    // JSON-compatible output still uses null, independently of the diagnostic.
    assert_eq!(
        serde_json::to_value(current).unwrap()["capital"]["cash"],
        Value::Null
    );
}

fn run_case(case: &Value) -> Value {
    let input = &case["input"];
    let options = PortfolioOptions {
        starting_capital: input["options"]["startingCapital"]
            .as_f64()
            .unwrap_or(DEFAULT_STARTING_CAPITAL),
        max_recent_fills: input["options"]["maxRecentFills"].as_f64().unwrap_or(500.0),
    };
    let mut p = match Portfolio::new(options, input["initialNowMs"].as_f64().unwrap_or(9000000.0)) {
        Ok(p) => p,
        Err(message) => return json!({"name":case["name"],"result":{"error":message}}),
    };
    // Parse all account events once, outside the typed state transition loop.
    let steps = input["steps"].as_array().unwrap();
    let typed: Vec<Option<AccountEvent>> = steps
        .iter()
        .map(|step| {
            step.get("event")
                .map(|value| serde_json::from_value(value.clone()).unwrap())
        })
        .collect();
    let mut snapshots = Vec::new();
    let mut cache_reuse = Vec::new();
    let mut map_keys = Vec::new();
    let mut encoded_events = Vec::new();
    let mut opaque_keys = Vec::new();
    let mut opaque_bits = Vec::new();
    let mut snapshot_number_bits = Vec::new();
    fn capture(
        p: &mut Portfolio,
        snapshots: &mut Vec<Value>,
        reuse: &mut Vec<bool>,
        keys: &mut Vec<Value>,
        opaque_keys: &mut Vec<Value>,
        opaque_bits: &mut Vec<Value>,
        snapshot_number_bits: &mut Vec<Value>,
    ) {
        let value = snapshot(p);
        opaque_keys.push(opaque_object_keys(&value));
        opaque_bits.push(opaque_number_bits(&value, false));
        snapshot_number_bits.push(self::snapshot_number_bits(p.snapshot()));
        let count = p.snapshot_rebuilds();
        p.snapshot();
        reuse.push(count == p.snapshot_rebuilds());
        let mut mapping = serde_json::Map::new();
        for name in [
            "positionsByAssetId",
            "openOrdersByClientId",
            "wsOpenOrdersByOrderId",
            "ordersByClientId",
            "marketByAssetId",
        ] {
            mapping.insert(
                name.to_owned(),
                json!(value[name].as_object().unwrap().keys().collect::<Vec<_>>()),
            );
        }
        keys.push(Value::Object(mapping));
        snapshots.push(value);
    }
    capture(
        &mut p,
        &mut snapshots,
        &mut cache_reuse,
        &mut map_keys,
        &mut opaque_keys,
        &mut opaque_bits,
        &mut snapshot_number_bits,
    );
    for (step, event) in steps.iter().zip(typed) {
        if let Some(event) = event {
            encoded_events.push(serde_json::to_value(&event).unwrap());
            p.apply(&event);
        } else if let Some(clock) = step.get("initializeClock") {
            p.initialize_clock(clock.as_f64().unwrap());
        }
        if step["capture"].as_bool() != Some(false) {
            capture(
                &mut p,
                &mut snapshots,
                &mut cache_reuse,
                &mut map_keys,
                &mut opaque_keys,
                &mut opaque_bits,
                &mut snapshot_number_bits,
            );
        }
    }
    json!({"name":case["name"],"result":{"snapshots":snapshots,"cacheReuse":cache_reuse,"mapKeys":map_keys,"encodedEvents":encoded_events,"opaqueKeys":opaque_keys,"opaqueBits":opaque_bits,"snapshotNumberBits":snapshot_number_bits}})
}
#[test]
#[ignore = "test-only adapter invoked by scripts/rust-migration/portfolio-differential.py"]
fn differential_fixture_driver() {
    let input = std::env::var("PMB_PORTFOLIO_FIXTURE_INPUT").expect("fixture input path required");
    let output =
        std::env::var("PMB_PORTFOLIO_FIXTURE_OUTPUT").expect("fixture output path required");
    let document: Value = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    let results: Vec<_> = document["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(run_case)
        .collect();
    std::fs::write(output, serde_json::to_vec(&results).unwrap()).unwrap();
}

#[test]
fn signed_zero_ties_use_javascript_semantics_in_public_snapshots() {
    for (first, second, expected) in [
        (0.0, -0.0, 0.0_f64),
        (-0.0, 0.0, 0.0_f64),
        (-0.0, -0.0, -0.0_f64),
    ] {
        let mut p = Portfolio::new(PortfolioOptions::default(), first).unwrap();
        p.apply(&AccountEvent::AccountStreamStatus {
            ts_ms: first,
            source: AccountStreamSource::UserWs,
            status: AccountStreamStatus::Connected,
            info: None,
        });
        p.apply(&AccountEvent::AccountStreamStatus {
            ts_ms: second,
            source: AccountStreamSource::UserWs,
            status: AccountStreamStatus::Connected,
            info: None,
        });
        assert_eq!(p.snapshot().now_ms.to_bits(), expected.to_bits());
    }
}
