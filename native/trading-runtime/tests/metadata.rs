use polymarket_runtime::{market_json::JsString, metadata::*};

fn reference(value: MetadataValue) -> MetadataHandle {
    let MetadataValue::Reference(x) = value else {
        panic!("reference")
    };
    x
}
#[test]
fn observer_tape_reaches_previous_trade_and_statistics() {
    let graph = MetadataGraph::new();
    let meta = graph.object().unwrap();
    meta.set("decision", MetadataValue::from("buy")).unwrap();
    let submitted_order = meta.clone();
    let history = submitted_order.clone();
    let trade = history.clone();
    let stats = trade.clone();
    let tape = graph.object().unwrap();
    tape.set("ticks", 1.0.into()).unwrap();
    submitted_order
        .set("pairLeagueTape", tape.clone().into())
        .unwrap();
    assert_eq!(
        stats.stringify().unwrap().unwrap(),
        "{\"decision\":\"buy\",\"pairLeagueTape\":{\"ticks\":1}}"
    );
    tape.set("ticks", 2.0.into()).unwrap();
    drop(meta);
    drop(submitted_order);
    drop(history);
    drop(trade);
    graph.collect_full().unwrap();
    assert_eq!(
        stats.stringify().unwrap().unwrap(),
        "{\"decision\":\"buy\",\"pairLeagueTape\":{\"ticks\":2}}"
    );
    assert_eq!(reference(stats.get("pairLeagueTape").unwrap()), tape);
}
#[test]
fn repeated_nodes_are_not_cycles_and_cycles_fail_at_observation() {
    let graph = MetadataGraph::new();
    let child = graph.object().unwrap();
    child.set("n", 1.0.into()).unwrap();
    let parent = graph.object().unwrap();
    parent.set("a", child.clone().into()).unwrap();
    parent.set("b", child.clone().into()).unwrap();
    assert_eq!(
        parent.stringify().unwrap().unwrap(),
        "{\"a\":{\"n\":1},\"b\":{\"n\":1}}"
    );
    child.set("parent", parent.clone().into()).unwrap();
    assert_eq!(parent.stringify(), Err(MetadataError::CircularReference));
    child.delete("parent").unwrap();
    assert!(parent.stringify().is_ok());
}
#[test]
fn binary64_utf16_missing_and_order_are_preserved() {
    let graph = MetadataGraph::new();
    let object = graph.object().unwrap();
    let key = JsString::from_units(vec![0xd800]);
    object.set("z", MetadataValue::Missing).unwrap();
    object
        .set("10", MetadataValue::Number(f64::INFINITY))
        .unwrap();
    object.set("2", MetadataValue::Number(-0.0)).unwrap();
    object.set("x", MetadataValue::Number(f64::NAN)).unwrap();
    object
        .set(
            key.clone(),
            MetadataValue::String(JsString::from_units(vec![0x61, 0xd800, 0x62])),
        )
        .unwrap();
    let MetadataValue::Number(zero) = object.get("2").unwrap() else {
        panic!()
    };
    assert_eq!(zero.to_bits(), (-0.0f64).to_bits());
    assert_eq!(
        object.keys().unwrap(),
        vec!["2".into(), "10".into(), "z".into(), "x".into(), key]
    );
    assert_eq!(
        object.stringify().unwrap().unwrap(),
        "{\"2\":0,\"10\":null,\"x\":null,\"\\ud800\":\"a\\ud800b\"}"
    );
    assert_eq!(graph.stringify(&MetadataValue::Missing).unwrap(), None);
}
#[test]
fn sparse_arrays_lengths_and_serialization_limits() {
    let graph = MetadataGraph::new();
    let array = graph.array().unwrap();
    array.set_index(2, (-0.0).into()).unwrap();
    array.push(MetadataValue::Missing).unwrap();
    assert_eq!(array.length().unwrap(), 4);
    assert_eq!(array.stringify().unwrap().unwrap(), "[null,null,0,null]");
    array.delete_index(2).unwrap();
    array.set_length(2).unwrap();
    assert_eq!(array.stringify().unwrap().unwrap(), "[null,null]");
    array.set_index(0, 0.0.into()).unwrap();
    array.set_index(1, 0.0.into()).unwrap();
    assert_eq!(
        graph
            .stringify_with_limit(&array.clone().into(), 5)
            .unwrap()
            .unwrap(),
        "[0,0]"
    );
    assert_eq!(
        graph.stringify_with_limit(&array.clone().into(), 4),
        Err(MetadataError::OutputLimit)
    );
    assert_eq!(
        array.set_index(u32::MAX, 0.0.into()),
        Err(MetadataError::InvalidArrayIndex)
    );
}
#[test]
fn unreachable_cycles_reclaim_and_stale_generations_never_upgrade() {
    let graph = MetadataGraph::new();
    let a = graph.object().unwrap();
    let b = graph.array().unwrap();
    a.set("b", b.clone().into()).unwrap();
    b.push(a.clone().into()).unwrap();
    let weak = a.downgrade();
    drop(a);
    drop(b);
    assert_eq!(graph.collect_full().unwrap(), 2);
    assert!(weak.upgrade().is_none());
    let new = graph.object().unwrap();
    assert_eq!(graph.stats().allocated_slots, 2);
    assert!(weak.upgrade().is_none());
    drop(new);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 0);
}
#[test]
fn retained_child_roots_survive_pruning_and_weak_edges() {
    let graph = MetadataGraph::new();
    let ledger = graph.object().unwrap();
    let tape = graph.object().unwrap();
    ledger.set("order", tape.clone().into()).unwrap();
    let retained = reference(ledger.get("order").unwrap());
    let weak = tape.downgrade();
    drop(tape);
    ledger.delete("order").unwrap();
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_some());
    retained.set("late", MetadataValue::Bool(true)).unwrap();
    assert_eq!(retained.stringify().unwrap().unwrap(), "{\"late\":true}");
    drop(retained);
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_none());
}
#[test]
fn marking_barriers_and_root_cursor_removal_are_safe() {
    let graph = MetadataGraph::new();
    let child = graph.object().unwrap();
    let weak = child.downgrade();
    drop(child);
    let parent = graph.object().unwrap();
    assert_eq!(graph.collect_step(1).unwrap().work, 1);
    let restored = weak.upgrade().unwrap();
    parent.set("child", restored.clone().into()).unwrap();
    drop(restored);
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_some());
    let got = reference(parent.get("child").unwrap());
    assert!(got.stringify().is_ok());
    drop(got);
    parent.delete("child").unwrap();
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_none());
    let a = graph.object().unwrap();
    let b = graph.object().unwrap();
    graph.collect_step(1).unwrap();
    drop(a);
    drop(b);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 1);
}
#[test]
fn collector_work_is_bounded_and_long_stream_does_not_retain_all_nodes() {
    let graph = MetadataGraph::new();
    let persistent = graph.object().unwrap();
    let mut peak = 0;
    for index in 0..30_000 {
        let a = graph.object().unwrap();
        let b = graph.array().unwrap();
        a.set("cycle", b.clone().into()).unwrap();
        b.push(a.clone().into()).unwrap();
        if index % 1000 == 0 {
            persistent.set("latest", a.clone().into()).unwrap();
        }
        drop(a);
        drop(b);
        let step = graph.collect_step(32).unwrap();
        assert!(step.work <= 32);
        peak = peak.max(graph.stats().live_nodes);
    }
    assert!(peak < 1024, "unbounded live nodes: {peak}");
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 3);
    persistent.delete("latest").unwrap();
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 1);
}
#[test]
fn object_key_churn_is_not_retained_and_deletion_reorders_reinsertion() {
    let graph = MetadataGraph::new();
    let object = graph.object().unwrap();
    object.set("a", 1.0.into()).unwrap();
    object.set("b", 2.0.into()).unwrap();
    object.delete("a").unwrap();
    object.set("a", 3.0.into()).unwrap();
    assert_eq!(object.stringify().unwrap().unwrap(), "{\"b\":2,\"a\":3}");
    for i in 0..100_000 {
        let key = format!("k{i}");
        object.set(key.as_str(), 0.0.into()).unwrap();
        object.delete(key.as_str()).unwrap();
    }
    assert_eq!(object.keys().unwrap().len(), 2);
}
#[test]
fn graph_boundaries_truthiness_and_drop_do_not_leak() {
    let one = MetadataGraph::new();
    let two = MetadataGraph::new();
    let a = one.object().unwrap();
    let b = two.object().unwrap();
    assert_eq!(a.set("other", b.into()), Err(MetadataError::WrongGraph));
    let weak = a.downgrade();
    a.set("self", a.clone().into()).unwrap();
    drop(a);
    drop(one);
    assert!(weak.upgrade().is_none());
    for x in [
        MetadataValue::Missing,
        MetadataValue::Null,
        MetadataValue::Bool(false),
        MetadataValue::Number(0.0),
        MetadataValue::Number(-0.0),
        MetadataValue::Number(f64::NAN),
        MetadataValue::String("".into()),
    ] {
        assert!(!x.is_truthy())
    }
    assert!(MetadataValue::Number(f64::INFINITY).is_truthy());
}

#[test]
fn sweep_barriers_weak_reachability_and_slot_reuse() {
    let graph = MetadataGraph::new();
    let dead = graph.object().unwrap();
    let weak = dead.downgrade();
    drop(dead);
    let parent = graph.object().unwrap();
    while !graph.stats().sweeping {
        assert!(graph.collect_step(1).unwrap().work <= 1);
    }
    assert!(weak.upgrade().is_none());
    graph.collect_step(1).unwrap();
    let child = graph.object().unwrap();
    child.set("parent", parent.clone().into()).unwrap();
    parent.set("child", child.clone().into()).unwrap();
    let retained = child.downgrade();
    drop(child);
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_none());
    assert!(retained.upgrade().is_some());
    parent.delete("child").unwrap();
    graph.collect_full().unwrap();
    assert!(retained.upgrade().is_none());
}
#[test]
fn large_unreachable_containers_reclaim_one_entry_per_budget_unit() {
    let graph = MetadataGraph::new();
    let array = graph.array().unwrap();
    for _ in 0..5000 {
        array.push(0.0.into()).unwrap();
    }
    drop(array);
    for _ in 0..500 {
        let progress = graph.collect_step(3).unwrap();
        assert!(progress.work <= 3);
        assert_eq!(progress.reclaimed, 0);
    }
    assert_eq!(graph.collect_full().unwrap(), 1);
    assert_eq!(graph.stats().live_nodes, 0);
}
#[test]
fn output_limits_are_exact_for_utf8_strings_objects_and_arrays() {
    let graph = MetadataGraph::new();
    let object = graph.object().unwrap();
    object
        .set("emoji", MetadataValue::String("😀".into()))
        .unwrap();
    object
        .set(
            "lone",
            MetadataValue::String(JsString::from_units(vec![0xd800])),
        )
        .unwrap();
    let value = MetadataValue::Reference(object);
    let output = graph.stringify(&value).unwrap().unwrap();
    assert_eq!(
        graph
            .stringify_with_limit(&value, output.len())
            .unwrap()
            .unwrap(),
        output
    );
    assert_eq!(
        graph.stringify_with_limit(&value, output.len() - 1),
        Err(MetadataError::OutputLimit)
    );
    let string = MetadataValue::String("😀".into());
    assert_eq!(
        graph.stringify_with_limit(&string, 6).unwrap().unwrap(),
        "\"😀\""
    );
    assert_eq!(
        graph.stringify_with_limit(&string, 5),
        Err(MetadataError::OutputLimit)
    );
    let array = graph.array().unwrap();
    for _ in 0..10 {
        array.push(0.0.into()).unwrap();
    }
    let value = MetadataValue::Reference(array);
    assert!(graph.stringify_with_limit(&value, 21).is_ok());
    assert_eq!(
        graph.stringify_with_limit(&value, 20),
        Err(MetadataError::OutputLimit)
    );
}

#[test]
fn public_utf16_representation_has_identical_key_order_and_string_semantics() {
    let graph = MetadataGraph::new();
    let utf8 = graph.object().unwrap();
    let utf16 = graph.object().unwrap();
    for key in ["z", "10", "2", "4294967295", "4294967294", "0", "😀"] {
        utf8.set(key, 1.0.into()).unwrap();
        utf16
            .set(JsString::Utf16(key.encode_utf16().collect()), 1.0.into())
            .unwrap();
    }
    utf16.set("2", 2.0.into()).unwrap();
    utf8.set("2", 2.0.into()).unwrap();
    assert_eq!(utf16.keys().unwrap(), utf8.keys().unwrap());
    assert_eq!(utf16.stringify().unwrap(), utf8.stringify().unwrap());
    assert_eq!(utf16.keys().unwrap()[1], JsString::from("2"));
    for text in ["", "0", "2", "\n\"\\", "😀"] {
        let ordinary = MetadataValue::String(text.into());
        let direct = MetadataValue::String(JsString::Utf16(text.encode_utf16().collect()));
        assert_eq!(direct.is_truthy(), ordinary.is_truthy());
        assert_eq!(
            graph.stringify(&direct).unwrap(),
            graph.stringify(&ordinary).unwrap()
        );
        let MetadataValue::String(direct) = direct else {
            panic!()
        };
        assert!(direct.matches(text));
        assert_eq!(direct, JsString::from(text));
    }
}

#[test]
fn session_ownership_is_pure_and_distinguishes_same_slot_across_arenas() {
    let graph = MetadataGraph::new();
    let same_session = graph.clone();
    let other_session = MetadataGraph::new();
    let owned = graph.object().unwrap();
    let foreign = other_session.object().unwrap();
    let retained = owned.clone();
    let before = graph.stats();
    let foreign_before = other_session.stats();
    assert!(graph.owns(&owned));
    assert!(same_session.owns(&retained));
    assert!(owned.graph().owns(&retained));
    assert!(!graph.owns(&foreign));
    assert!(!other_session.owns(&owned));
    assert_eq!(graph.stats(), before);
    assert_eq!(other_session.stats(), foreign_before);
    assert!(owned.keys().unwrap().is_empty());
    drop(owned);
    graph.collect_full().unwrap();
    assert!(graph.owns(&retained));
}

#[test]
fn present_array_index_keys_distinguish_undefined_from_holes_without_mutation() {
    let graph = MetadataGraph::new();
    let array = graph.array().unwrap();
    array.set_length(6).unwrap();
    assert!(array.index_keys().unwrap().is_empty());
    array.set_index(4, MetadataValue::Null).unwrap();
    array.set_index(1, MetadataValue::Missing).unwrap();
    let before = graph.stats();
    assert_eq!(array.index_keys().unwrap(), vec![1, 4]);
    assert!(matches!(
        array.get_index(1).unwrap(),
        MetadataValue::Missing
    ));
    assert!(matches!(
        array.get_index(2).unwrap(),
        MetadataValue::Missing
    ));
    assert_eq!(graph.stats(), before);
    assert_eq!(array.length().unwrap(), 6);
    array.delete_index(1).unwrap();
    assert_eq!(array.index_keys().unwrap(), vec![4]);
    array.set_length(4).unwrap();
    assert!(array.index_keys().unwrap().is_empty());
    array.set_index(3, MetadataValue::Missing).unwrap();
    assert_eq!(array.index_keys().unwrap(), vec![3]);
    assert_eq!(
        graph.object().unwrap().index_keys().unwrap_err(),
        MetadataError::WrongKind
    );
}

#[test]
fn shallow_freeze_enforces_every_data_writer_but_retains_nested_identity() {
    use polymarket_runtime::record::RecordSchema;
    static SNAPSHOT: RecordSchema =
        RecordSchema::new("SnapshotTest", &["capital", "members", "optional"]);
    let graph = MetadataGraph::new();
    let capital = graph.object().unwrap();
    capital.set("cash", 10.0.into()).unwrap();
    let members = graph.object().unwrap();
    members.set("a", 1.0.into()).unwrap();
    let snapshot = graph
        .record(
            &SNAPSHOT,
            vec![
                ("capital".into(), capital.clone().into()),
                ("members".into(), members.clone().into()),
                ("optional".into(), MetadataValue::Missing),
            ],
        )
        .unwrap();
    capital.freeze().unwrap();
    snapshot.as_handle().freeze().unwrap();
    snapshot.as_handle().freeze().unwrap();
    assert!(snapshot.as_handle().is_frozen().unwrap());
    for field in [SNAPSHOT.field(0), SNAPSHOT.field(2)] {
        assert_eq!(
            snapshot.set_field(field, MetadataValue::Missing),
            Err(MetadataError::FrozenProperty)
        );
        assert_eq!(
            snapshot.delete_field(field),
            Err(MetadataError::FrozenProperty)
        );
    }
    assert_eq!(
        snapshot.as_handle().set("extra", 3.0.into()),
        Err(MetadataError::FrozenProperty)
    );
    assert_eq!(
        snapshot.as_handle().set("members", members.clone().into()),
        Err(MetadataError::FrozenProperty)
    );
    assert_eq!(
        snapshot.as_handle().delete("capital"),
        Err(MetadataError::FrozenProperty)
    );
    assert!(!snapshot.as_handle().delete("absent").unwrap());
    assert_eq!(
        capital.set("cash", 10.0.into()),
        Err(MetadataError::FrozenProperty)
    );
    assert_eq!(capital.delete("cash"), Err(MetadataError::FrozenProperty));
    members.set("a", 2.0.into()).unwrap();
    assert_eq!(
        reference(snapshot.get_field(SNAPSHOT.field(1)).unwrap()),
        members
    );
    let descriptor = snapshot
        .as_handle()
        .own_property_descriptor("members")
        .unwrap()
        .unwrap();
    assert!(!descriptor.writable && descriptor.enumerable && !descriptor.configurable);
    assert_eq!(reference(descriptor.value), members);
    assert!(snapshot
        .as_handle()
        .own_property_descriptor("absent")
        .unwrap()
        .is_none());
    assert!(matches!(
        snapshot
            .as_handle()
            .own_property_descriptor("optional")
            .unwrap()
            .unwrap()
            .value,
        MetadataValue::Missing
    ));
}

#[test]
fn frozen_sparse_arrays_protect_length_entries_and_holes() {
    let graph = MetadataGraph::new();
    let array = graph.array().unwrap();
    array.set_length(4).unwrap();
    array.set_index(1, MetadataValue::Missing).unwrap();
    array.set_index(3, (-0.0).into()).unwrap();
    array.freeze().unwrap();
    assert_eq!(array.set_length(4), Err(MetadataError::FrozenProperty));
    assert_eq!(array.set_length(0), Err(MetadataError::FrozenProperty));
    assert_eq!(
        array.set_index(1, MetadataValue::Missing),
        Err(MetadataError::FrozenProperty)
    );
    assert_eq!(
        array.set_index(0, 1.0.into()),
        Err(MetadataError::FrozenProperty)
    );
    assert_eq!(array.push(1.0.into()), Err(MetadataError::FrozenProperty));
    assert_eq!(array.delete_index(1), Err(MetadataError::FrozenProperty));
    assert!(!array.delete_index(2).unwrap());
    let length = array.own_property_descriptor("length").unwrap().unwrap();
    assert!(!length.writable && !length.enumerable && !length.configurable);
    assert!(array.own_property_descriptor("2").unwrap().is_none());
    let value = array.own_property_descriptor("3").unwrap().unwrap();
    let MetadataValue::Number(number) = value.value else {
        panic!()
    };
    assert_eq!(number.to_bits(), (-0.0f64).to_bits());
    assert_eq!(array.index_keys().unwrap(), vec![1, 3]);
}

#[test]
// Hash/Eq use immutable session identity and generation, never RefCell contents.
#[allow(clippy::mutable_key_type)]
fn handle_hash_preserves_session_and_generation_identity() {
    use std::collections::HashSet;
    let graph = MetadataGraph::new();
    let other = MetadataGraph::new();
    let handle = graph.object().unwrap();
    let mut set = HashSet::new();
    set.insert(handle.clone());
    assert!(set.contains(&handle.clone()));
    assert!(!set.contains(&other.object().unwrap()));
    let old = handle.downgrade();
    drop(handle);
    set.clear();
    graph.collect_full().unwrap();
    assert!(old.upgrade().is_none());
    let fresh = graph.object().unwrap();
    assert!(set.insert(fresh.clone()));
    assert!(set.contains(&fresh));
}

#[test]
fn own_data_definitions_preserve_absence_attributes_same_value_and_visibility() {
    let graph = MetadataGraph::new();
    let object = graph.object().unwrap();
    object
        .define_data_property(
            "hidden",
            DataPropertyDefinition {
                value: Some(MetadataValue::Number(-0.0)),
                ..Default::default()
            },
        )
        .unwrap();
    let descriptor = object.own_property_descriptor("hidden").unwrap().unwrap();
    assert!(!descriptor.writable && !descriptor.enumerable && !descriptor.configurable);
    assert_eq!(object.keys().unwrap().len(), 0);
    assert_eq!(object.stringify().unwrap().unwrap(), "{}");
    object
        .define_data_property(
            "hidden",
            DataPropertyDefinition {
                value: Some(MetadataValue::Number(-0.0)),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(object
        .define_data_property(
            "hidden",
            DataPropertyDefinition {
                value: Some(MetadataValue::Number(0.0)),
                ..Default::default()
            }
        )
        .is_err());
    assert!(object.delete("hidden").is_err());
    object
        .define_data_property("undefined", DataPropertyDefinition::default())
        .unwrap();
    assert!(matches!(
        object.get("undefined").unwrap(),
        MetadataValue::Missing
    ));
    assert!(object
        .own_property_descriptor("undefined")
        .unwrap()
        .is_some());
    object.set("visible", 1.0.into()).unwrap();
    object
        .define_data_property(
            "visible",
            DataPropertyDefinition {
                writable: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    let descriptor = object.own_property_descriptor("visible").unwrap().unwrap();
    assert!(!descriptor.writable && descriptor.enumerable && descriptor.configurable);
    assert_eq!(object.keys().unwrap(), vec![JsString::from("visible")]);
    assert_eq!(object.stringify().unwrap().unwrap(), "{\"visible\":1}");
    object.prevent_extensions().unwrap();
    assert!(!object.is_extensible().unwrap());
    assert!(object.set("new", 2.0.into()).is_err());
    object
        .define_data_property(
            "visible",
            DataPropertyDefinition {
                value: Some(3.0.into()),
                enumerable: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(object.stringify().unwrap().unwrap(), "{}");
    assert!(!object.is_frozen().unwrap());
    object
        .define_data_property(
            "visible",
            DataPropertyDefinition {
                configurable: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(object.is_frozen().unwrap());
    let empty = graph.object().unwrap();
    empty.prevent_extensions().unwrap();
    assert!(empty.is_frozen().unwrap());
}

fn mutate_capture_then_throw(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(capture) = &frame.captures[0] else {
        panic!()
    };
    capture.set("called", 1.0.into())?;
    capture.graph().collect_step(1)?;
    Err(JsException::Thrown(frame.receiver.clone()))
}
#[test]
fn callable_captures_throw_identity_and_prototypes_are_traced_without_root_cycles() {
    let graph = MetadataGraph::new();
    let capture = graph.object().unwrap();
    let function = graph
        .function(mutate_capture_then_throw, vec![capture.clone().into()])
        .unwrap();
    capture.set("function", function.clone().into()).unwrap();
    let receiver = graph.object().unwrap();
    let error = function.call(receiver.clone().into(), vec![]).unwrap_err();
    let JsException::Thrown(MetadataValue::Reference(thrown)) = error else {
        panic!()
    };
    assert_eq!(thrown, receiver);
    assert!(matches!(
        capture.get("called").unwrap(),
        MetadataValue::Number(1.0)
    ));
    assert!(matches!(
        receiver.call(MetadataValue::Missing, vec![]),
        Err(JsException::Native(MetadataError::NotCallable))
    ));
    assert_eq!(function.stringify().unwrap(), None);
    assert_eq!(capture.stringify().unwrap().unwrap(), "{\"called\":1}");
    let array = graph.array().unwrap();
    array.push(function.clone().into()).unwrap();
    assert_eq!(array.stringify().unwrap().unwrap(), "[null]");
    let parent = graph.object().unwrap();
    parent.set("inherited", 7.0.into()).unwrap();
    receiver.set_prototype(Some(&parent)).unwrap();
    assert!(matches!(
        receiver.get_property("inherited").unwrap(),
        MetadataValue::Number(7.0)
    ));
    receiver.set("inherited", MetadataValue::Missing).unwrap();
    assert!(matches!(
        receiver.get_property("inherited").unwrap(),
        MetadataValue::Missing
    ));
    assert_eq!(
        parent.set_prototype(Some(&receiver)),
        Err(MetadataError::CyclicPrototype)
    );
    let weak = parent.downgrade();
    drop(parent);
    graph.collect_full().unwrap();
    assert!(weak.upgrade().is_some());
    receiver.freeze().unwrap();
    let current = receiver.prototype().unwrap().unwrap();
    receiver.set_prototype(Some(&current)).unwrap();
    assert_eq!(
        receiver.set_prototype(None),
        Err(MetadataError::FrozenProperty)
    );
    drop(current);
    drop(thrown);
    drop(receiver);
    drop(capture);
    drop(function);
    drop(array);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 0);
}
#[test]
fn callable_capture_reclamation_honors_partial_work_budgets() {
    let graph = MetadataGraph::new();
    let function = graph
        .function(
            mutate_capture_then_throw,
            (0..10000).map(|_| MetadataValue::Number(1.0)).collect(),
        )
        .unwrap();
    drop(function);
    let mut complete = false;
    for _ in 0..11000 {
        let step = graph.collect_step(1).unwrap();
        assert!(step.work <= 1);
        if step.cycle_complete {
            complete = true;
            break;
        }
    }
    assert!(complete);
    assert_eq!(graph.stats().live_nodes, 0);
}

fn accessor_read(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(state) = &frame.captures[0] else {
        panic!()
    };
    state.set("receiver", frame.receiver.clone())?;
    if let MetadataValue::Reference(error) = state.get("throw")? {
        return Err(JsException::Thrown(error.into()));
    }
    Ok(state.get("value")?)
}
fn accessor_write(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(state) = &frame.captures[0] else {
        panic!()
    };
    state.set("receiver", frame.receiver.clone())?;
    state.set("value", frame.arguments[0].clone())?;
    Ok(MetadataValue::Missing)
}
#[test]
fn frozen_inherited_accessors_preserve_receiver_throws_and_descriptor_identity() {
    let graph = MetadataGraph::new();
    let state = graph.object().unwrap();
    state.set("value", 2.0.into()).unwrap();
    let getter = graph
        .function(accessor_read, vec![state.clone().into()])
        .unwrap();
    let setter = graph
        .function(accessor_write, vec![state.clone().into()])
        .unwrap();
    let prototype = graph.object().unwrap();
    prototype
        .define_accessor_property(
            "value",
            AccessorPropertyDefinition {
                get: Some(Some(getter.clone())),
                set: Some(Some(setter.clone())),
                enumerable: Some(true),
                configurable: Some(true),
            },
        )
        .unwrap();
    let receiver = graph.object().unwrap();
    receiver.set_prototype(Some(&prototype)).unwrap();
    assert!(matches!(
        prototype.own_descriptor("value").unwrap(),
        Some(OwnPropertyDescriptor::Accessor {
            get: Some(_),
            set: Some(_),
            enumerable: true,
            configurable: true
        })
    ));
    assert!(matches!(
        state.get("receiver").unwrap(),
        MetadataValue::Missing
    ));
    receiver.freeze().unwrap();
    prototype.freeze().unwrap();
    receiver.set_property("value", 3.0.into()).unwrap();
    assert!(matches!(
        receiver.get_property("value").unwrap(),
        MetadataValue::Number(3.0)
    ));
    assert_eq!(reference(state.get("receiver").unwrap()), receiver);
    assert!(matches!(
        receiver.set_property("new", 1.0.into()),
        Err(JsException::Native(MetadataError::FrozenProperty))
    ));
    assert_eq!(
        prototype.define_accessor_property(
            "value",
            AccessorPropertyDefinition {
                get: Some(None),
                ..Default::default()
            }
        ),
        Err(MetadataError::FrozenProperty)
    );
    assert_eq!(
        prototype.define_data_property(
            "value",
            DataPropertyDefinition {
                value: Some(1.0.into()),
                ..Default::default()
            }
        ),
        Err(MetadataError::FrozenProperty)
    );
    prototype
        .define_accessor_property(
            "value",
            AccessorPropertyDefinition {
                get: Some(Some(getter.clone())),
                set: Some(Some(setter.clone())),
                ..Default::default()
            },
        )
        .unwrap();
    let error = graph.object().unwrap();
    state.set("throw", error.clone().into()).unwrap();
    let JsException::Thrown(MetadataValue::Reference(thrown)) =
        receiver.get_property("value").unwrap_err()
    else {
        panic!()
    };
    assert_eq!(thrown, error);
    let getter_weak = getter.downgrade();
    let setter_weak = setter.downgrade();
    drop(getter);
    drop(setter);
    graph.collect_full().unwrap();
    assert!(getter_weak.upgrade().is_some() && setter_weak.upgrade().is_some());
    drop(thrown);
    drop(error);
    drop(receiver);
    drop(prototype);
    drop(state);
    graph.collect_full().unwrap();
    assert_eq!(graph.stats().live_nodes, 0);
}
#[test]
fn descriptor_kind_replacement_and_strict_assignment_keep_key_order_and_attrs() {
    let graph = MetadataGraph::new();
    let state = graph.object().unwrap();
    let getter = graph
        .function(accessor_read, vec![state.clone().into()])
        .unwrap();
    let object = graph.object().unwrap();
    object.set("a", 1.0.into()).unwrap();
    object.set("b", 2.0.into()).unwrap();
    object
        .define_accessor_property(
            "a",
            AccessorPropertyDefinition {
                get: Some(Some(getter)),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(matches!(
        object.set_property("a", 2.0.into()),
        Err(JsException::Native(MetadataError::FrozenProperty))
    ));
    object
        .define_data_property(
            "a",
            DataPropertyDefinition {
                value: Some(3.0.into()),
                writable: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    object.set_property("a", 4.0.into()).unwrap();
    assert_eq!(
        object.keys().unwrap(),
        vec![JsString::from("a"), JsString::from("b")]
    );
    assert_eq!(object.stringify().unwrap().unwrap(), "{\"a\":4,\"b\":2}");
    assert!(object.delete_property("missing").unwrap());
    object
        .define_data_property(
            "a",
            DataPropertyDefinition {
                writable: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    let child = graph.object().unwrap();
    child.set_prototype(Some(&object)).unwrap();
    assert!(matches!(
        child.set_property("a", 4.0.into()),
        Err(JsException::Native(MetadataError::FrozenProperty))
    ));
    child.set_property("b", 5.0.into()).unwrap();
    assert!(matches!(
        object.get("b").unwrap(),
        MetadataValue::Number(2.0)
    ));
    assert!(matches!(
        child.get_property("b").unwrap(),
        MetadataValue::Number(5.0)
    ));
}
