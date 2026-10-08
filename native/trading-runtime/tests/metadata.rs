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
