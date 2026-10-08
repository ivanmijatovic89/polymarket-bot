//! Unit tests and a test-only differential adapter. Production uses typed events.
use polymarket_runtime::math;
use polymarket_runtime::metadata::{MetadataGraph, MetadataHandle, MetadataValue};
use polymarket_runtime::portfolio::*;
use polymarket_runtime::portfolio_records::{
    fill as fill_fields, import_control_value, FillRecord, ManagedAccountEvent, OpenOrderRecord,
    PositionsSplitRecord, WsOrderUpdateRecord,
};
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
fn snapshot_membership_is_historical_while_open_order_records_stay_shared() {
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
        open_order_view(historical.open_orders_by_client_id.get("a").unwrap())
            .unwrap()
            .state,
        OrderState::Open
    );
    assert_eq!(
        open_order_view(p.snapshot().open_orders_by_client_id.get("a").unwrap())
            .unwrap()
            .state,
        OrderState::Open
    );
    assert_eq!(
        historical
            .open_orders_by_client_id
            .get("a")
            .unwrap()
            .handle(),
        p.snapshot()
            .open_orders_by_client_id
            .get("a")
            .unwrap()
            .handle()
    );
    assert_eq!(
        historical.capital.reserved_cash,
        p.snapshot().capital.reserved_cash
    );
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
    let MetadataValue::Reference(meta) = p
        .snapshot()
        .orders_by_client_id
        .get("a")
        .unwrap()
        .handle()
        .as_handle()
        .get("meta")
        .unwrap()
    else {
        panic!("meta")
    };
    let MetadataValue::Reference(two) = meta.get("2").unwrap() else {
        panic!("nested meta")
    };
    let MetadataValue::Number(nonce) = two.get("nonce").unwrap() else {
        panic!("nonce")
    };
    assert_eq!(nonce, 9007199254740992.0);
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
        match p.snapshot().recent_fills[0]
            .get(fill_fields::INTENT_META)
            .unwrap()
        {
            MetadataValue::Reference(meta) => match meta.get("negativeZero").unwrap() {
                MetadataValue::Number(n) => n.to_bits(),
                _ => panic!("number"),
            },
            _ => panic!("metadata"),
        },
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

fn graph_keys(handle: &MetadataHandle) -> Vec<polymarket_runtime::market_json::JsString> {
    if handle.is_array() {
        handle
            .index_keys()
            .unwrap()
            .into_iter()
            .map(|index| index.to_string().as_str().into())
            .collect()
    } else {
        handle.keys().unwrap()
    }
}
fn graph_number_bits(
    value: MetadataValue,
    path: &str,
    opaque: bool,
    result: &mut serde_json::Map<String, Value>,
) {
    let mut work = vec![(value, path.to_owned(), opaque, Vec::<MetadataHandle>::new())];
    while let Some((value, path, opaque, ancestors)) = work.pop() {
        match value {
            MetadataValue::Number(number) if opaque => {
                result.insert(path, json!(format!("{:016x}", number.to_bits())));
            }
            MetadataValue::Reference(handle) => {
                assert!(
                    !ancestors.contains(&handle),
                    "numeric diagnostic cannot project cycles"
                );
                let mut ancestors = ancestors;
                ancestors.push(handle.clone());
                for key in graph_keys(&handle).into_iter().rev() {
                    let key = key
                        .as_str()
                        .expect("finite Unicode diagnostic key")
                        .to_owned();
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
                    let child = if handle.is_array() {
                        handle.get_index(key.parse().unwrap()).unwrap()
                    } else {
                        handle.get(key.as_str()).unwrap()
                    };
                    work.push((
                        child,
                        format!("{path}/{}", pointer_key(&key)),
                        child_opaque,
                        ancestors.clone(),
                    ));
                }
            }
            _ => {}
        }
    }
}
fn current_opaque_bits(snapshot: &PortfolioSnapshot, value: &Value) -> Value {
    let Value::Object(mut bits) = opaque_number_bits(value, false) else {
        unreachable!()
    };
    for (id, order) in snapshot.open_orders_by_client_id.object_iter() {
        graph_number_bits(
            order.handle().as_handle().clone().into(),
            &format!("/openOrdersByClientId/{}", pointer_key(id)),
            false,
            &mut bits,
        );
    }
    for (id, order) in snapshot.orders_by_client_id.object_iter() {
        graph_number_bits(
            order.handle().as_handle().clone().into(),
            &format!("/ordersByClientId/{}", pointer_key(id)),
            false,
            &mut bits,
        );
    }
    for (id, position) in snapshot.positions_by_asset_id.object_iter() {
        graph_number_bits(
            position.handle().as_handle().clone().into(),
            &format!("/positionsByAssetId/{}", pointer_key(id)),
            false,
            &mut bits,
        );
    }
    for (index, fill) in snapshot.recent_fills.iter().enumerate() {
        graph_number_bits(
            fill.handle().as_handle().clone().into(),
            &format!("/recentFills/{index}"),
            false,
            &mut bits,
        );
    }
    for (index, split) in snapshot.recent_splits.iter().enumerate() {
        graph_number_bits(
            split.handle().as_handle().clone().into(),
            &format!("/recentSplits/{index}"),
            false,
            &mut bits,
        );
    }
    Value::Object(bits)
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
        graph_number_bits(
            position.handle().as_handle().clone().into(),
            &format!("/positionsByAssetId/{}", pointer_key(id)),
            true,
            &mut probe.0,
        );
    }
    for (id, order) in snapshot.open_orders_by_client_id.object_iter() {
        graph_number_bits(
            order.handle().as_handle().clone().into(),
            &format!("/openOrdersByClientId/{}", pointer_key(id)),
            true,
            &mut probe.0,
        );
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
        graph_number_bits(
            order.handle().as_handle().clone().into(),
            &format!("/ordersByClientId/{}", pointer_key(id)),
            true,
            &mut probe.0,
        );
    }
    for (index, fill) in snapshot.recent_fills.iter().enumerate() {
        graph_number_bits(
            fill.handle().as_handle().clone().into(),
            &format!("/recentFills/{index}"),
            true,
            &mut probe.0,
        );
    }
    for (index, split) in snapshot.recent_splits.iter().enumerate() {
        graph_number_bits(
            split.handle().as_handle().clone().into(),
            &format!("/recentSplits/{index}"),
            true,
            &mut probe.0,
        );
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

fn graph_property_keys(
    value: MetadataValue,
    path: &str,
    result: &mut serde_json::Map<String, Value>,
) {
    let mut work = vec![(value, path.to_owned())];
    while let Some((value, path)) = work.pop() {
        if let MetadataValue::Reference(handle) = value {
            let keys = graph_keys(&handle);
            result.insert(
                path.clone(),
                json!(keys.iter().map(|x| x.as_str().unwrap()).collect::<Vec<_>>()),
            );
            for key in keys {
                let name = key.as_str().unwrap();
                let child = if handle.is_array() {
                    handle.get_index(name.parse().unwrap()).unwrap()
                } else {
                    handle.get(name).unwrap()
                };
                work.push((child, format!("{path}/{}", pointer_key(name))));
            }
        }
    }
}
fn all_property_keys(value: &Value) -> serde_json::Map<String, Value> {
    let mut result = serde_json::Map::new();
    let mut work = vec![(value, String::new())];
    while let Some((value, path)) = work.pop() {
        match value {
            Value::Object(values) => {
                result.insert(path.clone(), json!(values.keys().collect::<Vec<_>>()));
                for (key, value) in values {
                    work.push((value, format!("{path}/{}", pointer_key(key))));
                }
            }
            Value::Array(values) => {
                result.insert(
                    path.clone(),
                    json!((0..values.len()).map(|n| n.to_string()).collect::<Vec<_>>()),
                );
                for (index, value) in values.iter().enumerate() {
                    work.push((value, format!("{path}/{index}")));
                }
            }
            _ => {}
        }
    }
    result
}
fn snapshot_property_keys(snapshot: &PortfolioSnapshot, value: &Value) -> Value {
    let mut keys = all_property_keys(value);
    for (id, order) in snapshot.open_orders_by_client_id.object_iter() {
        graph_property_keys(
            order.handle().as_handle().clone().into(),
            &format!("/openOrdersByClientId/{}", pointer_key(id)),
            &mut keys,
        );
    }
    for (id, order) in snapshot.orders_by_client_id.object_iter() {
        graph_property_keys(
            order.handle().as_handle().clone().into(),
            &format!("/ordersByClientId/{}", pointer_key(id)),
            &mut keys,
        );
    }
    for (id, position) in snapshot.positions_by_asset_id.object_iter() {
        graph_property_keys(
            position.handle().as_handle().clone().into(),
            &format!("/positionsByAssetId/{}", pointer_key(id)),
            &mut keys,
        );
    }
    for (index, fill) in snapshot.recent_fills.iter().enumerate() {
        graph_property_keys(
            fill.handle().as_handle().clone().into(),
            &format!("/recentFills/{index}"),
            &mut keys,
        );
    }
    for (index, split) in snapshot.recent_splits.iter().enumerate() {
        graph_property_keys(
            split.handle().as_handle().clone().into(),
            &format!("/recentSplits/{index}"),
            &mut keys,
        );
    }
    Value::Object(keys)
}
fn allocate_managed(graph: &MetadataGraph, event: &Value) -> ManagedAccountEvent {
    let envelope = graph.object().unwrap();
    for (key, value) in event.as_object().unwrap() {
        let graph_value = if key == "fill" || key == "split" || key == "order" {
            let properties = value
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| {
                    (
                        key.as_str().into(),
                        import_control_value(graph, value).unwrap(),
                    )
                })
                .collect();
            if key == "fill" {
                FillRecord::new(graph, properties)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone()
                    .into()
            } else if key == "order" && event["kind"] == "order_submitted" {
                OpenOrderRecord::new(graph, properties)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone()
                    .into()
            } else if key == "order" {
                WsOrderUpdateRecord::new(graph, properties)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone()
                    .into()
            } else {
                PositionsSplitRecord::new(graph, properties)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone()
                    .into()
            }
        } else {
            import_control_value(graph, value).unwrap()
        };
        envelope.set(key.as_str(), graph_value).unwrap();
    }
    ManagedAccountEvent::from_envelope(envelope)
}
fn graph_path(mut value: MetadataValue, path: &[Value]) -> MetadataValue {
    for key in path {
        let MetadataValue::Reference(handle) = value else {
            panic!("object path")
        };
        let key = key.as_str().unwrap();
        value = if handle.is_array() {
            handle.get_index(key.parse().unwrap()).unwrap()
        } else {
            handle.get(key).unwrap()
        };
    }
    value
}
struct AliasMap<T>(Vec<(String, T)>);
impl<T> AliasMap<T> {
    fn get(&self, id: &str) -> Option<&T> {
        self.0
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value)
    }
    fn contains_key(&self, id: &str) -> bool {
        self.get(id).is_some()
    }
    fn insert(&mut self, id: String, value: T) {
        if let Some((_, current)) = self.0.iter_mut().find(|(key, _)| key == &id) {
            *current = value;
        } else {
            self.0.push((id, value));
        }
    }
    fn iter(&self) -> impl Iterator<Item = (&str, &T)> {
        self.0.iter().map(|(id, value)| (id.as_str(), value))
    }
}
fn alias_selection(
    selection: &Value,
    events: &AliasMap<ManagedAccountEvent>,
    snapshots: &AliasMap<(PortfolioSnapshot, u64)>,
) -> MetadataValue {
    let id = selection["id"].as_str().unwrap();
    let path = selection["path"].as_array().unwrap();
    if selection["root"] == "event" {
        return graph_path(events.get(id).unwrap().envelope().clone().into(), path);
    }
    let snapshot = &snapshots.get(id).unwrap().0;
    let name = path[1].as_str().unwrap();
    let value = match path[0].as_str().unwrap() {
        "openOrdersByClientId" => snapshot
            .open_orders_by_client_id
            .get(name)
            .unwrap()
            .handle()
            .as_handle()
            .clone()
            .into(),
        "ordersByClientId" => snapshot
            .orders_by_client_id
            .get(name)
            .unwrap()
            .handle()
            .as_handle()
            .clone()
            .into(),
        "positionsByAssetId" => snapshot
            .positions_by_asset_id
            .get(name)
            .unwrap()
            .handle()
            .as_handle()
            .clone()
            .into(),
        "recentFills" => snapshot.recent_fills[name.parse::<usize>().unwrap()]
            .handle()
            .as_handle()
            .clone()
            .into(),
        "recentSplits" => snapshot.recent_splits[name.parse::<usize>().unwrap()]
            .handle()
            .as_handle()
            .clone()
            .into(),
        _ => panic!("record identity outside first integrated stage"),
    };
    graph_path(value, &path[2..])
}
fn payload_identities(
    snapshot: &PortfolioSnapshot,
    events: &AliasMap<ManagedAccountEvent>,
) -> Value {
    let identify = |handle: &MetadataHandle, key: &str| {
        let expected_kind = if key == "fill" {
            "fill"
        } else {
            "positions_split"
        };
        events
            .iter()
            .filter_map(|(id, event)| {
                if !matches!(event.envelope().get("kind").unwrap(), MetadataValue::String(kind) if kind.matches(expected_kind)) { return None; }
                match event.envelope().get(key).unwrap() {
                    MetadataValue::Reference(payload) if &payload == handle => Some(id),
                    _ => None,
                }
            })
            .collect::<Vec<_>>()
    };
    json!({"fills":snapshot.recent_fills.iter().map(|fill|identify(fill.handle().as_handle(),"fill")).collect::<Vec<_>>(),
        "splits":snapshot.recent_splits.iter().map(|split|identify(split.handle().as_handle(),"split")).collect::<Vec<_>>()})
}
fn raw_alias_scenario(p: &mut Portfolio, operations: &[Value]) -> Value {
    let graph = p.graph().clone();
    let mut events: AliasMap<ManagedAccountEvent> = AliasMap(Vec::new());
    let mut snapshots: AliasMap<(PortfolioSnapshot, u64)> = AliasMap(Vec::new());
    let mut observations = Vec::new();
    for operation in operations {
        match operation["op"].as_str().unwrap() {
            "allocate" => {
                let id = operation["id"].as_str().unwrap();
                assert!(!events.contains_key(id));
                events.insert(id.to_owned(), allocate_managed(&graph, &operation["event"]));
            }
            "set" | "delete" | "link" => {
                let path = operation["path"].as_array().unwrap();
                let value = graph_path(
                    events
                        .get(operation["id"].as_str().unwrap())
                        .unwrap()
                        .envelope()
                        .clone()
                        .into(),
                    &path[..path.len() - 1],
                );
                let MetadataValue::Reference(handle) = value else {
                    panic!("mutation target")
                };
                let key = path.last().unwrap().as_str().unwrap();
                if operation["op"] == "delete" {
                    handle.delete(key).unwrap();
                } else {
                    let value = if operation["op"] == "link" {
                        alias_selection(&operation["source"], &events, &snapshots)
                    } else {
                        operation
                            .get("value")
                            .map(|value| import_control_value(&graph, value).unwrap())
                            .unwrap_or(MetadataValue::Missing)
                    };
                    handle.set(key, value).unwrap();
                }
            }
            "apply" => {
                p.apply_managed(events.get(operation["id"].as_str().unwrap()).unwrap())
                    .unwrap();
            }
            "retain" => {
                let snapshot = p.snapshot().clone();
                snapshots.insert(
                    operation["id"].as_str().unwrap().to_owned(),
                    (snapshot, p.snapshot_rebuilds()),
                );
            }
            "same" => {
                let left = alias_selection(&operation["left"], &events, &snapshots);
                let right = alias_selection(&operation["right"], &events, &snapshots);
                let same = match (left, right) {
                    (MetadataValue::Reference(a), MetadataValue::Reference(b)) => a == b,
                    _ => panic!("identity probe targets references"),
                };
                observations.push(json!({"label":operation["label"],"same":same}));
            }
            "observe" => {
                let current = p.snapshot().clone();
                let generation = p.snapshot_rebuilds();
                let value = serde_json::to_value(&current).unwrap();
                let retained:serde_json::Map<_,_>=snapshots.iter().map(|(id,(snapshot,retained_generation))|{
                    let value=serde_json::to_value(snapshot).unwrap();
                    (id.to_owned(),json!({"snapshot":value,"snapshotNumberBits":snapshot_number_bits(snapshot),"keys":snapshot_property_keys(snapshot,&value),"sameAsCurrent":*retained_generation==generation,"payloadIdentities":payload_identities(snapshot,&events)}))
                }).collect();
                let event_values: serde_json::Map<_, _> = events
                    .iter()
                    .map(|(id, event)| {
                        let raw = event.envelope().clone();
                        let mut bits = serde_json::Map::new();
                        let mut keys = serde_json::Map::new();
                        graph_number_bits(raw.clone().into(), "", true, &mut bits);
                        graph_property_keys(raw.clone().into(), "", &mut keys);
                        let value: Value =
                            serde_json::from_str(&raw.stringify().unwrap().unwrap()).unwrap();
                        (
                            id.to_owned(),
                            json!({"value":value,"numberBits":bits,"keys":keys}),
                        )
                    })
                    .collect();
                observations.push(json!({"label":operation["label"],"current":value,"currentNumberBits":snapshot_number_bits(&current),"currentKeys":snapshot_property_keys(&current,&value),"currentPayloadIdentities":payload_identities(&current,&events),"retained":retained,"events":event_values}));
            }
            _ => panic!("unknown alias operation"),
        }
    }
    Value::Array(observations)
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
    let managed: Vec<Option<ManagedAccountEvent>> = steps
        .iter()
        .map(|step| {
            if input["managedEvents"].as_bool() == Some(true) {
                step.get("event")
                    .map(|value| allocate_managed(p.graph(), value))
            } else {
                None
            }
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
        opaque_bits.push(current_opaque_bits(p.snapshot(), &value));
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
    for ((step, event), managed) in steps.iter().zip(typed).zip(managed) {
        if let Some(event) = event {
            encoded_events.push(serde_json::to_value(&event).unwrap());
            if let Some(managed) = managed {
                p.apply_managed(&managed).unwrap();
            } else {
                p.apply(&event);
            }
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
    let mut result = json!({"snapshots":snapshots,"cacheReuse":cache_reuse,"mapKeys":map_keys,"encodedEvents":encoded_events,"opaqueKeys":opaque_keys,"opaqueBits":opaque_bits,"snapshotNumberBits":snapshot_number_bits});
    if let Some(operations) = input.get("rawAliasOperations") {
        result["rawAliasObservations"] = raw_alias_scenario(&mut p, operations.as_array().unwrap());
    }
    json!({"name":case["name"],"result":result})
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

#[test]
fn managed_fill_current_fields_and_retained_history_share_one_record() {
    let graph = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let event = allocate_managed(
        &graph,
        &json!({"kind":"fill","fill":{"id":"first","tsMs":1,"assetId":"up","side":"BUY","price":0.5,"size":2,"liquidity":"MAKER"}}),
    );
    let MetadataValue::Reference(payload) = event.envelope().get("fill").unwrap() else {
        panic!("fill")
    };
    payload.set("size", 3.0.into()).unwrap();
    payload.set("price", 0.4.into()).unwrap();
    p.apply_managed(&event).unwrap();
    let old = p.snapshot().clone();
    let generation = p.snapshot_rebuilds();
    assert_eq!(old.capital.cash, 498.8);
    assert_eq!(
        position_view(old.positions_by_asset_id.get("up").unwrap())
            .unwrap()
            .qty,
        3.0
    );
    assert_eq!(old.recent_fills[0].handle().as_handle(), &payload);
    payload.set("size", 8.0.into()).unwrap();
    payload.set("price", 1.0.into()).unwrap();
    assert_eq!(p.snapshot_rebuilds(), generation);
    assert_eq!(p.snapshot().capital.cash, 498.8);
    assert_eq!(
        old.recent_fills[0].number(fill_fields::SIZE).unwrap(),
        Some(8.0)
    );
    p.apply_managed(&event).unwrap(); // Same current id remains idempotent.
    assert_eq!(p.snapshot().capital.cash, 498.8);
    assert_eq!(p.snapshot().recent_fills.len(), 1);
    payload.set("id", "second".into()).unwrap();
    p.apply_managed(&event).unwrap();
    let current = p.snapshot();
    assert_eq!(current.capital.cash, 490.8);
    assert_eq!(
        position_view(current.positions_by_asset_id.get("up").unwrap())
            .unwrap()
            .qty,
        11.0
    );
    assert_eq!(current.recent_fills.len(), 2);
    assert_eq!(
        current.recent_fills[0].handle(),
        current.recent_fills[1].handle()
    );
    assert_eq!(old.recent_fills.len(), 1);
}
#[test]
fn managed_split_and_fill_keep_shared_metadata_and_null_presence() {
    let graph = MetadataGraph::new();
    let meta = graph.object().unwrap();
    meta.set("probe", "original".into()).unwrap();
    let mut p = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let fill = allocate_managed(
        &graph,
        &json!({"kind":"fill","fill":{"id":"f","tsMs":1,"assetId":"up","side":"BUY","price":0.5,"size":2,"intentMeta":null}}),
    );
    let split = allocate_managed(
        &graph,
        &json!({"kind":"positions_split","split":{"id":"s","tsMs":2,"assetIdA":"up","assetIdB":"down","size":1,"splitCost":1}}),
    );
    let MetadataValue::Reference(raw_fill) = fill.envelope().get("fill").unwrap() else {
        panic!("fill")
    };
    let MetadataValue::Reference(raw_split) = split.envelope().get("split").unwrap() else {
        panic!("split")
    };
    assert!(matches!(
        raw_fill.get("intentMeta").unwrap(),
        MetadataValue::Null
    ));
    raw_fill.set("intentMeta", meta.clone().into()).unwrap();
    raw_split
        .set("executionReceipt", meta.clone().into())
        .unwrap();
    p.apply_managed(&fill).unwrap();
    p.apply_managed(&split).unwrap();
    let old = p.snapshot().clone();
    meta.set("probe", "mutated".into()).unwrap();
    let value = serde_json::to_value(&old).unwrap();
    assert_eq!(value["recentFills"][0]["intentMeta"]["probe"], "mutated");
    assert_eq!(
        value["recentSplits"][0]["executionReceipt"]["probe"],
        "mutated"
    );
    raw_fill.set("intentMeta", MetadataValue::Missing).unwrap();
    assert!(old.recent_fills[0].has(fill_fields::INTENT_META).unwrap());
    assert!(serde_json::to_value(&old).unwrap()["recentFills"][0]
        .get("intentMeta")
        .is_none());
    raw_fill.delete("intentMeta").unwrap();
    assert!(!old.recent_fills[0].has(fill_fields::INTENT_META).unwrap());
}
#[test]
fn cross_session_managed_event_rejected_before_cache_or_accounting_changes() {
    let graph = MetadataGraph::new();
    let other = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    p.snapshot();
    let generation = p.snapshot_rebuilds();
    let event = allocate_managed(
        &other,
        &json!({"kind":"fill","fill":{"id":"f","tsMs":1,"assetId":"up","side":"BUY","price":0.5,"size":2}}),
    );
    assert_eq!(
        p.apply_managed(&event),
        Err(PortfolioIngressError::Graph(
            polymarket_runtime::metadata::MetadataError::WrongGraph
        ))
    );
    assert_eq!(p.snapshot_rebuilds(), generation);
    assert_eq!(p.snapshot().capital.cash, 500.0);
    assert_eq!(p.snapshot().now_ms, 0.0);
}
#[test]
fn raw_history_pruning_drops_membership_but_retained_roots_survive_collection() {
    let graph = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(
        &graph,
        PortfolioOptions {
            max_recent_fills: 1.0,
            ..PortfolioOptions::default()
        },
        0.0,
    )
    .unwrap();
    let first = allocate_managed(
        &graph,
        &json!({"kind":"fill","fill":{"id":"0","tsMs":1,"assetId":"up","side":"BUY","price":0.0,"size":1}}),
    );
    p.apply_managed(&first).unwrap();
    let old = p.snapshot().clone();
    drop(first);
    for index in 1..1000 {
        let event = allocate_managed(
            &graph,
            &json!({"kind":"fill","fill":{"id":index.to_string(),"tsMs":index,"assetId":"up","side":"BUY","price":0.0,"size":1}}),
        );
        p.apply_managed(&event).unwrap();
        drop(event);
        graph.collect_step(64).unwrap();
    }
    graph.collect_full().unwrap();
    assert!(graph.stats().live_nodes < 10);
    old.recent_fills[0]
        .set(fill_fields::SIZE, 44.0.into())
        .unwrap();
    assert_eq!(
        serde_json::to_value(&old).unwrap()["recentFills"][0]["size"],
        44.0
    );
    assert_eq!(p.snapshot().recent_fills.len(), 1);
    assert_eq!(
        p.snapshot().recent_fills[0]
            .number(fill_fields::SIZE)
            .unwrap(),
        Some(1.0)
    );
}

#[test]
fn managed_all_lifecycle_kinds_resolve_current_envelope_fields() {
    let graph = MetadataGraph::new();
    let mut managed = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let mut reference = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    let rows = [
        json!({"kind":"order_submitted","tsMs":1,"order":order("a",10.0)}),
        json!({"kind":"order_accepted","tsMs":2,"clientOrderId":"a","orderId":"x"}),
        json!({"kind":"order_open","tsMs":3,"orderId":"x"}),
        json!({"kind":"ws_order_update","tsMs":4,"order":{"orderId":"x","event":"UPDATE","status":"MATCHED","sizeMatched":2,"originalSize":10}}),
        json!({"kind":"fill","fill":{"id":"f","tsMs":5,"assetId":"up","clientOrderId":"a","orderId":"x","side":"BUY","price":0.6,"size":2,"liquidity":"MAKER"}}),
        json!({"kind":"positions_split","split":{"id":"s","tsMs":6,"assetIdA":"up","assetIdB":"down","size":2,"splitCost":2}}),
        json!({"kind":"positions_merged","id":"m","tsMs":7,"assetIdA":"up","assetIdB":"down","size":1}),
        json!({"kind":"cancel_failed","tsMs":8,"operation":"cancel_order","clientOrderId":"a","reason":"failure"}),
        json!({"kind":"merge_failed","tsMs":9,"assetIdA":"up","assetIdB":"down","requestedSize":1,"reason":"failure"}),
        json!({"kind":"split_failed","tsMs":10,"assetIdA":"up","assetIdB":"down","requestedSize":1,"reason":"failure"}),
        json!({"kind":"account_stream_status","tsMs":11,"source":"user_ws","status":"disconnected","info":"reconnect"}),
        json!({"kind":"order_done","tsMs":12,"clientOrderId":"a","orderId":"x","reason":"canceled","filledSize":2}),
        json!({"kind":"order_submitted","tsMs":13,"order":order("b",1.0)}),
        json!({"kind":"order_rejected","tsMs":14,"clientOrderId":"b","reason":"adapter_error"}),
    ];
    for mut row in rows {
        let raw = allocate_managed(&graph, &row);
        assert_eq!(raw.kind().unwrap().as_str(), row["kind"].as_str());
        // Prove admission did not capture detached timestamp fields.
        let key = if row["kind"] == "fill" {
            Some("fill")
        } else if row["kind"] == "positions_split" {
            Some("split")
        } else {
            None
        };
        let original = if let Some(key) = key {
            row[key]["tsMs"].as_f64().unwrap()
        } else {
            row["tsMs"].as_f64().unwrap()
        };
        let current = original + 100.0;
        if let Some(key) = key {
            let MetadataValue::Reference(payload) = raw.payload(key).unwrap() else {
                panic!("payload")
            };
            payload.set("tsMs", current.into()).unwrap();
            row[key]["tsMs"] = json!(current);
        } else {
            raw.envelope().set("tsMs", current.into()).unwrap();
            row["tsMs"] = json!(current);
        }
        assert_eq!(raw.timestamp_ms().unwrap().to_bits(), current.to_bits());
        managed.apply_managed(&raw).unwrap();
        reference.apply(&event(row));
        assert_eq!(snapshot(&mut managed), snapshot(&mut reference));
        assert_eq!(
            snapshot_number_bits(managed.snapshot()),
            snapshot_number_bits(reference.snapshot())
        );
    }
}
