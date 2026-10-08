//! Test-only fixture adapter for the bounded intent/risk/cancel ports.
use intent::*;
use polymarket_runtime::metadata::{MetadataGraph, MetadataValue};
use polymarket_runtime::{cancellation, intent, market_json, portfolio, risk};
use portfolio::{AccountEvent, Portfolio, PortfolioOptions};
use serde_json::{json, Value};

#[test]
fn input_fields_preserve_absent_null_and_invalid_types() {
    let absent: CancelMarket = serde_json::from_value(json!({})).unwrap();
    let null: CancelMarket = serde_json::from_value(json!({"market":null})).unwrap();
    assert!(absent.market.is_absent());
    assert!(matches!(null.market, InputField::Invalid(ref value) if value.is_null()));
    assert_eq!(
        cancellation::validate_cancel_scope(&absent),
        Some("missing_cancel_scope")
    );
    assert_eq!(
        cancellation::validate_cancel_scope(&null),
        Some("invalid_cancel_market")
    );
}
#[test]
fn capital_overlay_borrows_the_original_history() {
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    let snapshot = p.snapshot();
    let mut capital = snapshot.capital.clone();
    capital.available_cash = 12.0;
    let view = PortfolioView {
        snapshot: &snapshot,
        capital_override: Some(&capital),
    };
    assert_eq!(view.capital().available_cash, 12.0);
    assert!(std::ptr::eq(
        &view.snapshot.orders_by_client_id,
        &snapshot.orders_by_client_id
    ));
}
#[test]
fn metadata_handles_keep_identity_during_risk_filtering() {
    let value = json!({"clientOrderId":"a","assetId":"up","side":"BUY","price":0.5,"size":1,"orderType":"GTC"});
    let order: PlaceOrder<Value> = serde_json::from_value(value).unwrap();
    let graph = MetadataGraph::new();
    let handle = graph.object().unwrap();
    let tape = graph.object().unwrap();
    tape.set("observation", MetadataValue::Number(1.0)).unwrap();
    handle
        .set("pairLeagueTape", MetadataValue::Reference(tape.clone()))
        .unwrap();
    let shared = PlaceOrder {
        client_order_id: order.client_order_id,
        asset_id: order.asset_id,
        side: order.side,
        price: order.price,
        size: order.size,
        order_type: order.order_type,
        post_only: order.post_only,
        meta: InputField::Valid(MetadataValue::Reference(handle.clone())),
        expire_at_ms: order.expire_at_ms,
        reason: order.reason,
        extensions: Default::default(),
    };
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    let snapshot = p.snapshot();
    let limits = risk::RiskLimits {
        max_open_orders: 1.0,
        ..Default::default()
    };
    let batch = PlaceBatch {
        orders: vec![shared.clone(), shared],
        reason: InputField::Absent,
        extensions: Default::default(),
    };
    let decision = risk::enforce_risk_limits(
        0.0,
        &[Intent::PlaceBatch(batch)],
        Some((&snapshot).into()),
        Some(&limits),
    );
    let Intent::PlaceBatch(allowed) = &decision.allowed[0] else {
        panic!()
    };
    assert_eq!(allowed.orders.len(), 1);
    let MetadataValue::Reference(result) = allowed.orders[0].meta.valid().unwrap() else {
        panic!()
    };
    // Mutating nested Observer-style state after risk filtering must remain visible.
    tape.set("observation", MetadataValue::Number(7.0)).unwrap();
    let MetadataValue::Reference(observed_tape) = result.get("pairLeagueTape").unwrap() else {
        panic!()
    };
    assert!(matches!(
        observed_tape.get("observation").unwrap(),
        MetadataValue::Number(7.0)
    ));
    result.set("later", MetadataValue::Bool(true)).unwrap();
    assert!(matches!(
        handle.get("later").unwrap(),
        MetadataValue::Bool(true)
    ));
}
fn numeric_bits(value: &Value) -> Value {
    fn visit(v: &Value, path: String, out: &mut serde_json::Map<String, Value>) {
        match v {
            Value::Number(n) => {
                out.insert(
                    path,
                    json!(format!("{:016x}", n.as_f64().unwrap().to_bits())),
                );
            }
            Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    visit(x, format!("{path}/{i}"), out)
                }
            }
            Value::Object(o) => {
                for (k, x) in o {
                    visit(
                        x,
                        format!("{path}/{}", k.replace('~', "~0").replace('/', "~1")),
                        out,
                    )
                }
            }
            _ => {}
        }
    }
    let mut out = serde_json::Map::new();
    visit(value, String::new(), &mut out);
    Value::Object(out)
}
fn object_keys(value: &Value) -> Value {
    fn visit(v: &Value, path: String, out: &mut serde_json::Map<String, Value>) {
        match v {
            Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    visit(x, format!("{path}/{i}"), out)
                }
            }
            Value::Object(o) => {
                if path.contains("/meta") || path.contains("/opaque") {
                    out.insert(path.clone(), json!(o.keys().collect::<Vec<_>>()));
                }
                for (k, x) in o {
                    visit(
                        x,
                        format!("{path}/{}", k.replace('~', "~0").replace('/', "~1")),
                        out,
                    )
                }
            }
            _ => {}
        }
    }
    let mut out = serde_json::Map::new();
    visit(value, String::new(), &mut out);
    Value::Object(out)
}
fn run_case(case: &Value) -> Value {
    let normalized = market_json::normalize_control_value(case["input"].clone());
    let input = &normalized;
    let mut p = Portfolio::new(PortfolioOptions::default(), 0.0).unwrap();
    if let Some(events) = input["events"].as_array() {
        for event in events {
            p.apply(&serde_json::from_value::<AccountEvent>(event.clone()).unwrap());
        }
    }
    let mut snapshot = p.snapshot().clone();
    if let Some(realized) = input["realizedPnlTotal"].as_f64() {
        snapshot.realized_pnl_total = realized;
    }
    let view = if input["withoutPortfolio"].as_bool() == Some(true) {
        None
    } else {
        Some(PortfolioView::from(&snapshot))
    };
    let result = match input["operation"].as_str().unwrap() {
        "risk" => {
            let intents: Vec<Intent<Value>> =
                serde_json::from_value(input["intents"].clone()).unwrap();
            let encoded = serde_json::to_value(&intents).unwrap();
            let limits: Option<risk::RiskLimits> = input
                .get("limits")
                .map(|v| serde_json::from_value(v.clone()).unwrap());
            let decision = risk::enforce_risk_limits(
                input["nowMs"].as_f64().unwrap_or(1000.0),
                &intents,
                view,
                limits.as_ref(),
            );
            let decision = serde_json::to_value(decision).unwrap();
            json!({"decision":decision,"encodedIntents":encoded,"numericBits":numeric_bits(&encoded),"objectKeys":object_keys(&encoded)})
        }
        "scope" => {
            let scope: CancelMarket = serde_json::from_value(input["scope"].clone()).unwrap();
            let matches = input["orders"]
                .as_array()
                .unwrap()
                .iter()
                .map(|o| {
                    cancellation::validate_cancel_scope(&scope).is_none()
                        && cancellation::matches_cancel_scope(
                            o["market"].as_str(),
                            o["assetId"].as_str(),
                            &scope,
                        )
                })
                .collect::<Vec<_>>();
            json!({"error":cancellation::validate_cancel_scope(&scope),"matches":matches})
        }
        "cancel_batch" => {
            let batch: CancelBatch = serde_json::from_value(input["intent"].clone()).unwrap();
            serde_json::to_value(cancellation::resolve_cancel_batch(
                &batch,
                view,
                input["nowMs"].as_f64().unwrap_or(1000.0),
                input["dryRun"].as_bool().unwrap_or(false),
            ))
            .unwrap()
        }
        _ => panic!("unknown fixture operation"),
    };
    json!({"name":case["name"],"result":result})
}
#[test]
#[ignore = "test-only differential fixture adapter"]
fn differential_fixture_driver() {
    let input = std::env::var("PMB_INTENTS_FIXTURE_INPUT").unwrap();
    let output = std::env::var("PMB_INTENTS_FIXTURE_OUTPUT").unwrap();
    let document: Value = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    let rows = document["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(run_case)
        .collect::<Vec<_>>();
    std::fs::write(output, serde_json::to_vec(&rows).unwrap()).unwrap();
}
