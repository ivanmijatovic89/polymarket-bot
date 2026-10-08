use polymarket_runtime::{
    metadata::{MetadataError, MetadataGraph, MetadataValue},
    portfolio_records::{open_order, position, OpenOrderRecord, PositionRecord},
};

#[test]
fn typed_fields_keep_record_identity_presence_and_raw_creation_order() {
    let graph = MetadataGraph::new();
    let order = OpenOrderRecord::new(
        &graph,
        vec![
            ("size".into(), MetadataValue::Number(-0.0)),
            ("adapterExtra".into(), MetadataValue::Number(2.0)),
            ("clientOrderId".into(), "a".into()),
        ],
    )
    .unwrap();
    let retained = order.clone();
    assert_eq!(order.handle(), retained.handle());
    assert_eq!(
        order.number(open_order::SIZE).unwrap().unwrap().to_bits(),
        (-0.0_f64).to_bits()
    );
    assert!(!order.has(open_order::PRICE).unwrap());
    order
        .set(open_order::PRICE, MetadataValue::Missing)
        .unwrap();
    assert!(order.has(open_order::PRICE).unwrap());
    assert!(matches!(
        retained.get(open_order::PRICE).unwrap(),
        MetadataValue::Missing
    ));
    assert_eq!(
        order.handle().as_handle().stringify().unwrap().unwrap(),
        "{\"size\":0,\"adapterExtra\":2,\"clientOrderId\":\"a\"}"
    );
    order.delete(open_order::SIZE).unwrap();
    order
        .set(open_order::SIZE, MetadataValue::Number(3.0))
        .unwrap();
    assert_eq!(retained.number(open_order::SIZE).unwrap(), Some(3.0));
    assert_eq!(
        order.handle().as_handle().stringify().unwrap().unwrap(),
        "{\"adapterExtra\":2,\"clientOrderId\":\"a\",\"size\":3}"
    );
    assert_eq!(order.number(position::QTY), Err(MetadataError::WrongField));
    assert!(matches!(
        PositionRecord::try_from_handle(order.handle().clone()),
        Err(MetadataError::WrongKind)
    ));
}
