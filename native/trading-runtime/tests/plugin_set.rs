use polymarket_runtime::{metadata::*, plugin_set::PluginSet, sdk_snapshot::TickHandle};
fn reference(value: MetadataValue) -> MetadataHandle {
    let MetadataValue::Reference(handle) = value else {
        panic!()
    };
    handle
}
fn callback(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let log = reference(frame.captures[0].clone());
    log.push(frame.captures[1].clone())?;
    if frame.captures.len() > 3 && frame.captures[3].is_truthy() {
        return Err(JsException::Thrown(frame.captures[2].clone()));
    }
    Ok(frame.captures[2].clone())
}
fn plugin(
    graph: &MetadataGraph,
    log: &MetadataHandle,
    id: &str,
    tag: &str,
    result: MetadataValue,
) -> MetadataHandle {
    let plugin = graph.object().unwrap();
    plugin.set("id", id.into()).unwrap();
    for (field, suffix) in [
        ("captureMarketTick", "capture"),
        ("onMarketTick", "tick"),
        ("snapshot", "snapshot"),
        ("reset", "reset"),
    ] {
        let function = graph
            .function(
                callback,
                vec![
                    log.clone().into(),
                    format!("{tag}-{suffix}").as_str().into(),
                    result.clone(),
                ],
            )
            .unwrap();
        plugin.set(field, function.into()).unwrap();
    }
    plugin
}
fn tick(graph: &MetadataGraph, event_type: &str) -> TickHandle {
    let msg = graph.object().unwrap();
    msg.set("event_type", event_type.into()).unwrap();
    TickHandle::new(
        graph,
        graph.object().unwrap().into(),
        msg.into(),
        graph.object().unwrap().into(),
    )
    .unwrap()
}
#[test]
fn synthetic_ticks_capture_all_plugins_but_gate_hooks_and_refresh_all_snapshots() {
    let graph = MetadataGraph::new();
    let set = PluginSet::new(&graph).unwrap();
    let log = graph.array().unwrap();
    let one = plugin(&graph, &log, "same", "one", 1.0.into());
    let two = plugin(&graph, &log, "same", "two", MetadataValue::Null);
    let three = plugin(&graph, &log, "absent", "three", MetadataValue::Missing);
    two.set("handlesSyntheticTicks", MetadataValue::Bool(true))
        .unwrap();
    three.set("handlesSyntheticTicks", "true".into()).unwrap();
    set.register(one.into()).unwrap();
    set.register(two.into()).unwrap();
    set.register(three.into()).unwrap();
    assert_eq!(set.list_ids().unwrap().len(), 2);
    let synthetic = tick(&graph, "chainlink_round");
    set.capture_market_tick(&synthetic).unwrap();
    set.on_market_tick(&synthetic, None).unwrap();
    assert_eq!(log.stringify().unwrap().unwrap(),"[\"one-capture\",\"two-capture\",\"three-capture\",\"two-tick\",\"one-snapshot\",\"two-snapshot\",\"three-snapshot\"]");
    let snapshot = reference(set.snapshot().unwrap());
    assert!(matches!(snapshot.get("same").unwrap(), MetadataValue::Null));
    assert!(!snapshot.has_property("absent").unwrap());
    let before = snapshot.clone();
    set.reset().unwrap();
    let after = reference(set.snapshot().unwrap());
    assert_ne!(before, after);
}
#[test]
fn reset_throw_preserves_cached_root_and_proto_snapshot_assignment_is_not_data_definition() {
    let graph = MetadataGraph::new();
    let set = PluginSet::new(&graph).unwrap();
    let log = graph.array().unwrap();
    let inherited = graph.object().unwrap();
    inherited.set("inherited", 7.0.into()).unwrap();
    let first = plugin(&graph, &log, "__proto__", "first", inherited.clone().into());
    set.register(first.clone().into()).unwrap();
    let cached = reference(set.refresh_snapshot().unwrap());
    assert_eq!(cached.prototype().unwrap().unwrap(), inherited);
    assert!(cached.own_descriptor("__proto__").unwrap().is_none());
    assert!(matches!(
        cached.get_property("inherited").unwrap(),
        MetadataValue::Number(7.0)
    ));
    let error = graph.object().unwrap();
    let throws = graph
        .function(
            callback,
            vec![
                log.clone().into(),
                "throws".into(),
                error.clone().into(),
                MetadataValue::Bool(true),
            ],
        )
        .unwrap();
    first.set("reset", throws.into()).unwrap();
    let JsException::Thrown(MetadataValue::Reference(thrown)) = set.reset().unwrap_err() else {
        panic!()
    };
    assert_eq!(thrown, error);
    assert_eq!(reference(set.snapshot().unwrap()), cached);
}
fn changing_id(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let counter = reference(frame.captures[0].clone());
    let MetadataValue::Number(value) = counter.get("value")? else {
        panic!()
    };
    counter.set("value", (value + 1.0).into())?;
    Ok(match value as u32 {
        0 => "a",
        1 => "b",
        2 => "c",
        _ => "d",
    }
    .into())
}
#[test]
fn list_ids_keeps_each_observable_source_get_and_original_list_membership() {
    let graph = MetadataGraph::new();
    let set = PluginSet::new(&graph).unwrap();
    let counter = graph.object().unwrap();
    counter.set("value", 0.0.into()).unwrap();
    let getter = graph
        .function(changing_id, vec![counter.clone().into()])
        .unwrap();
    let first = graph.object().unwrap();
    first
        .define_accessor_property(
            "id",
            AccessorPropertyDefinition {
                get: Some(Some(getter)),
                ..Default::default()
            },
        )
        .unwrap();
    let second = graph.object().unwrap();
    second.set("id", "c".into()).unwrap();
    set.register(first.clone().into()).unwrap();
    set.register(second.into()).unwrap();
    let ids = set.list_ids().unwrap();
    assert_eq!(ids.len(), 1);
    assert!(matches!(&ids[0],MetadataValue::String(id) if id.matches("d")));
    assert!(matches!(
        counter.get("value").unwrap(),
        MetadataValue::Number(4.0)
    ));
    let list = set.list().unwrap();
    assert_eq!(reference(list.get_index(0).unwrap()), first);
    list.set_length(0).unwrap();
    assert_eq!(set.list().unwrap().length().unwrap(), 2);
}
