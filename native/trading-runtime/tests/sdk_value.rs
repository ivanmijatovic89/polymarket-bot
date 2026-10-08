use num_bigint::BigInt;
use polymarket_runtime::{market_json::JsString, metadata::*, sdk_value::*};
use std::collections::HashSet;
#[test]
// Reference keys hash immutable session identity/generation, not mutable payloads.
#[allow(clippy::mutable_key_type)]
fn equality_domains_do_not_conflate_undefined_null_bool_bigint_or_string() {
    let graph = MetadataGraph::new();
    let object = graph.object().unwrap();
    let other = graph.object().unwrap();
    let values = [
        MetadataValue::Missing,
        MetadataValue::Null,
        MetadataValue::Bool(false),
        MetadataValue::Number(0.),
        MetadataValue::BigInt(BigInt::from(0)),
        MetadataValue::String("0".into()),
        object.clone().into(),
        other.into(),
    ];
    let keys = values
        .iter()
        .map(JsMapKey::from_value)
        .collect::<HashSet<_>>();
    assert_eq!(keys.len(), values.len());
    assert_eq!(
        JsMapKey::from_value(&object.clone().into()),
        JsMapKey::from_value(&object.into())
    );
    assert!(strict_equal(
        &MetadataValue::String(JsString::Utf16(vec![50])),
        &MetadataValue::String("2".into())
    ));
}
#[test]
fn map_zero_and_nan_rules_differ_from_strict_and_same_value() {
    let plus = MetadataValue::Number(0.);
    let minus = MetadataValue::Number(-0.);
    let nan_a = MetadataValue::Number(f64::from_bits(0x7ff8000000000001));
    let nan_b = MetadataValue::Number(f64::from_bits(0xfff8000000000021));
    assert_eq!(JsMapKey::from_value(&plus), JsMapKey::from_value(&minus));
    assert_eq!(JsMapKey::from_value(&nan_a), JsMapKey::from_value(&nan_b));
    assert!(strict_equal(&plus, &minus));
    assert!(!strict_equal(&nan_a, &nan_b));
    assert!(!same_value(&plus, &minus));
    assert!(same_value(&nan_a, &nan_b));
}
