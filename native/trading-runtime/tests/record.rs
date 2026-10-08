use num_bigint::BigInt;
use polymarket_runtime::{market_json::JsString, metadata::*, record::*};
static SCHEMA: RecordSchema = RecordSchema::new("Order", &["id", "qty", "meta", "2", "label"]);
static OTHER: RecordSchema = RecordSchema::new("OtherOrder", &["id", "qty", "meta", "2", "label"]);
static BAD: RecordSchema = RecordSchema::new("Bad", &["id", "id"]);
const QTY: FieldId = SCHEMA.field(1);
const META: FieldId = SCHEMA.field(2);
fn reference(value: MetadataValue) -> MetadataHandle {
    let MetadataValue::Reference(x) = value else {
        panic!("reference")
    };
    x
}
#[test]
fn ordered_raw_properties_and_schema_bound_slots_share_one_storage() {
    let graph = MetadataGraph::new();
    let record = graph
        .record(
            &SCHEMA,
            vec![
                ("label".into(), "last".into()),
                ("10".into(), 10.0.into()),
                ("qty".into(), (-0.0).into()),
                ("2".into(), 2.0.into()),
                ("id".into(), "order".into()),
                ("extra".into(), MetadataValue::Missing),
            ],
        )
        .unwrap();
    assert_eq!(
        record.as_handle().keys().unwrap(),
        vec![
            "2".into(),
            "10".into(),
            "label".into(),
            "qty".into(),
            "id".into(),
            "extra".into()
        ]
    );
    assert_eq!(
        record.number(QTY).unwrap().unwrap().to_bits(),
        (-0.0f64).to_bits()
    );
    assert_eq!(
        record.as_handle().stringify().unwrap().unwrap(),
        r#"{"2":2,"10":10,"label":"last","qty":0,"id":"order"}"#
    );
    record.as_handle().set("qty", 7.0.into()).unwrap();
    assert_eq!(record.number(QTY).unwrap(), Some(7.0));
    record.set_field(QTY, 8.0.into()).unwrap();
    let MetadataValue::Number(q) = record.as_handle().get("qty").unwrap() else {
        panic!()
    };
    assert_eq!(q, 8.0);
    assert!(matches!(
        record.get_field(OTHER.field(1)),
        Err(MetadataError::WrongField)
    ));
    assert!(matches!(
        record.set_field(OTHER.field(1), 1.0.into()),
        Err(MetadataError::WrongField)
    ));
    assert_eq!(
        record.delete_field(OTHER.field(1)),
        Err(MetadataError::WrongField)
    );
    assert_eq!(
        record.has_field(OTHER.field(1)),
        Err(MetadataError::WrongField)
    );
    assert_eq!(
        record.number(OTHER.field(1)),
        Err(MetadataError::WrongField)
    );
    assert!(matches!(
        RecordHandle::try_from_handle(graph.object().unwrap()),
        Err(MetadataError::WrongKind)
    ));
    assert!(matches!(
        graph.record(&BAD, vec![]),
        Err(MetadataError::InvalidRecordSchema)
    ));
}
#[test]
fn missing_ownundefined_type_changes_deletion_and_reinsertion_are_distinct() {
    let graph = MetadataGraph::new();
    let record = graph.record(&SCHEMA, vec![]).unwrap();
    assert!(!record.has_field(QTY).unwrap());
    assert!(matches!(
        record.get_field(QTY).unwrap(),
        MetadataValue::Missing
    ));
    record.set_field(QTY, MetadataValue::Missing).unwrap();
    assert!(record.has_field(QTY).unwrap());
    assert_eq!(record.number(QTY).unwrap(), None);
    record.set_field(SCHEMA.field(0), "id".into()).unwrap();
    assert_eq!(
        record.as_handle().keys().unwrap(),
        vec!["qty".into(), "id".into()]
    );
    record.set_field(QTY, MetadataValue::Null).unwrap();
    assert_eq!(
        record.as_handle().stringify().unwrap().unwrap(),
        r#"{"qty":null,"id":"id"}"#
    );
    record.set_field(QTY, "not-a-number".into()).unwrap();
    assert_eq!(record.number(QTY).unwrap(), None);
    assert!(record.delete_field(QTY).unwrap());
    assert!(!record.delete_field(QTY).unwrap());
    assert!(!record.has_field(QTY).unwrap());
    record.set_field(QTY, 1.0.into()).unwrap();
    assert_eq!(
        record.as_handle().keys().unwrap(),
        vec!["id".into(), "qty".into()]
    );
    record
        .as_handle()
        .set(JsString::Utf16(vec![50]), 3.0.into())
        .unwrap();
    assert_eq!(record.number(SCHEMA.field(3)).unwrap(), Some(3.0));
}
#[test]
fn metadata_record_cycles_identity_and_delayed_observation() {
    let graph = MetadataGraph::new();
    let meta = graph.object().unwrap();
    let tape = graph.object().unwrap();
    let order = graph
        .record(&SCHEMA, vec![("meta".into(), meta.clone().into())])
        .unwrap();
    meta.set("order", order.clone().into()).unwrap();
    assert_eq!(
        order.as_handle().stringify(),
        Err(MetadataError::CircularReference)
    );
    meta.delete("order").unwrap();
    meta.set("tape", tape.clone().into()).unwrap();
    tape.set("n", 1.0.into()).unwrap();
    let retained = reference(order.get_field(META).unwrap());
    let recovered = RecordHandle::try_from_handle(order.as_handle().clone()).unwrap();
    assert_eq!(recovered, order);
    drop(order);
    drop(meta);
    graph.collect_full().unwrap();
    tape.set("n", 2.0.into()).unwrap();
    assert_eq!(
        retained.stringify().unwrap().unwrap(),
        r#"{"tape":{"n":2}}"#
    );
    drop(recovered);
    drop(retained);
    drop(tape);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 0);
}
#[test]
fn record_cross_session_references_are_rejected_and_no_rooted_internal_edges_leak() {
    let graph = MetadataGraph::new();
    let other = MetadataGraph::new();
    let child = other.object().unwrap();
    assert!(matches!(
        graph.record(&SCHEMA, vec![("meta".into(), child.clone().into())]),
        Err(MetadataError::WrongGraph)
    ));
    let record = graph.record(&SCHEMA, vec![]).unwrap();
    assert_eq!(
        record.set_field(META, child.into()),
        Err(MetadataError::WrongGraph)
    );
    let cycle = graph.object().unwrap();
    record.set_field(META, cycle.clone().into()).unwrap();
    cycle.set("back", record.clone().into()).unwrap();
    let weak = record.as_handle().downgrade();
    drop(record);
    drop(cycle);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 0);
    assert!(weak.upgrade().is_none());
    let next = graph.record(&SCHEMA, vec![]).unwrap();
    assert!(weak.upgrade().is_none());
    assert_eq!(graph.stats().live_nodes, 1);
    drop(next);
}
#[test]
fn direct_record_numbers_preserve_every_binary64_class_and_bigint_is_distinct() {
    let graph = MetadataGraph::new();
    let record = graph.record(&SCHEMA, vec![]).unwrap();
    for bits in [
        0,
        1,
        0x8000000000000000,
        0x8000000000000001,
        0x7ff0000000000000,
        0xfff0000000000000,
        0x7ff8000000000001,
        0x7ff0000000000001,
    ] {
        record
            .set_field(QTY, MetadataValue::Number(f64::from_bits(bits)))
            .unwrap();
        assert_eq!(record.number(QTY).unwrap().unwrap().to_bits(), bits);
    }
    let ordinal: BigInt = "900719925474099312345678901234567890".parse().unwrap();
    record
        .set_field(QTY, MetadataValue::BigInt(ordinal.clone()))
        .unwrap();
    assert_eq!(record.number(QTY).unwrap(), None);
    let MetadataValue::BigInt(actual) = record.get_field(QTY).unwrap() else {
        panic!()
    };
    assert_eq!(actual, ordinal);
    assert_eq!(
        record.as_handle().stringify(),
        Err(MetadataError::BigIntSerialization)
    );
    assert!(!MetadataValue::BigInt(BigInt::from(0)).is_truthy());
    assert!(MetadataValue::BigInt(BigInt::from(-1)).is_truthy());
    assert_eq!(
        graph.stringify(&MetadataValue::BigInt(BigInt::from(0))),
        Err(MetadataError::BigIntSerialization)
    );
    let array = graph.array().unwrap();
    array.push(MetadataValue::BigInt(BigInt::from(1))).unwrap();
    assert_eq!(array.stringify(), Err(MetadataError::BigIntSerialization));
}
#[test]
fn record_marking_sweep_barriers_and_incremental_property_reclamation() {
    let graph = MetadataGraph::new();
    let root = graph.record(&SCHEMA, vec![]).unwrap();
    let child = graph.record(&SCHEMA, vec![]).unwrap();
    let weak = child.as_handle().downgrade();
    root.set_field(META, child.clone().into()).unwrap();
    drop(child);
    graph.collect_step(1).unwrap();
    let later = graph.object().unwrap();
    let later_weak = later.downgrade();
    root.as_handle().set("later", later.clone().into()).unwrap();
    drop(later);
    while !graph.collect_step(1).unwrap().cycle_complete {}
    assert!(weak.upgrade().is_some());
    assert!(later_weak.upgrade().is_some());
    root.delete_field(META).unwrap();
    root.as_handle().delete("later").unwrap();
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_none());
    assert!(later_weak.upgrade().is_none());
    let huge = graph.record(&SCHEMA, vec![]).unwrap();
    for i in 0..5000 {
        huge.as_handle().set(format!("k{i}"), 1.0.into()).unwrap();
    }
    drop(huge);
    let before = graph.stats().live_nodes;
    let mut steps = 0;
    loop {
        steps += 1;
        let progress = graph.collect_step(1).unwrap();
        assert!(progress.work <= 1);
        if progress.cycle_complete {
            break;
        }
    }
    assert!(steps >= 5000);
    assert_eq!(graph.stats().live_nodes, before - 1);
}
#[test]
fn long_stream_record_cycles_and_replaced_members_do_not_retain_history() {
    let graph = MetadataGraph::new();
    let ledger = graph.object().unwrap();
    let mut retained = None;
    for i in 0..30000 {
        let record = graph
            .record(&SCHEMA, vec![("qty".into(), (i as f64).into())])
            .unwrap();
        let meta = graph.object().unwrap();
        record.set_field(META, meta.clone().into()).unwrap();
        meta.set("back", record.clone().into()).unwrap();
        ledger.set("position", record.clone().into()).unwrap();
        if i == 10 {
            retained = Some(record.clone());
        }
        drop(record);
        drop(meta);
        graph.collect_step(16).unwrap();
    }
    graph.collect_full().unwrap();
    assert!(graph.stats().allocated_slots < 40);
    assert_eq!(graph.stats().live_nodes, 5);
    assert_eq!(retained.as_ref().unwrap().number(QTY).unwrap(), Some(10.0));
    ledger.delete("position").unwrap();
    drop(retained);
    drop(ledger);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 0);
}

#[test]
fn record_exact_limits_utf16_and_new_edges_during_sweep() {
    let graph = MetadataGraph::new();
    let root = graph
        .record(
            &SCHEMA,
            vec![
                ("id".into(), "😀".into()),
                ("qty".into(), MetadataValue::Number(f64::INFINITY)),
            ],
        )
        .unwrap();
    root.as_handle()
        .set(
            JsString::Utf16(vec![0xd800]),
            MetadataValue::String(JsString::Utf16(vec![0xd800])),
        )
        .unwrap();
    let value: MetadataValue = root.clone().into();
    let text = graph.stringify(&value).unwrap().unwrap();
    assert_eq!(text, r#"{"id":"😀","qty":null,"\ud800":"\ud800"}"#);
    assert_eq!(
        graph.stringify_with_limit(&value, text.len()).unwrap(),
        Some(text.clone())
    );
    assert_eq!(
        graph.stringify_with_limit(&value, text.len() - 1),
        Err(MetadataError::OutputLimit)
    );
    let doomed = graph.record(&SCHEMA, vec![]).unwrap();
    let weak = doomed.as_handle().downgrade();
    doomed.set_field(META, doomed.clone().into()).unwrap();
    drop(doomed);
    while !graph.stats().sweeping {
        graph.collect_step(1).unwrap();
    }
    assert!(weak.upgrade().is_none());
    let late = graph
        .record(&SCHEMA, vec![("qty".into(), 9.0.into())])
        .unwrap();
    let lateweak = late.as_handle().downgrade();
    root.set_field(META, late.clone().into()).unwrap();
    drop(late);
    while !graph.collect_step(1).unwrap().cycle_complete {}
    assert!(lateweak.upgrade().is_some());
    assert!(weak.upgrade().is_none());
    let retained = reference(root.get_field(META).unwrap());
    root.delete_field(META).unwrap();
    graph.collect_full().unwrap();
    assert!(lateweak.upgrade().is_some());
    drop(retained);
    graph.collect_full().unwrap();
    assert!(lateweak.upgrade().is_none());
}
