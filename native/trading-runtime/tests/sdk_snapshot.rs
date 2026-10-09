use polymarket_runtime::{metadata::*, sdk_snapshot::*};
#[test]
fn retained_tick_and_snapshot_wrappers_read_current_graph_slots() {
    let graph = MetadataGraph::new();
    let source = graph.object().unwrap();
    let msg = graph.object().unwrap();
    let books = graph.object().unwrap();
    let book = graph.object().unwrap();
    book.set("mid", (-0.0).into()).unwrap();
    books.set("asset", book.clone().into()).unwrap();
    let snapshot =
        MarketSnapshotHandle::new(&graph, "market".into(), 1.0, books.clone().into()).unwrap();
    let tick = TickHandle::new(
        &graph,
        source.clone().into(),
        msg.clone().into(),
        snapshot.value(),
    )
    .unwrap();
    let retained = tick.clone();
    assert_eq!(retained, tick);
    assert_eq!(retained.snapshot().unwrap(), snapshot);
    let MetadataValue::Reference(observed) = snapshot.book("asset").unwrap() else {
        panic!()
    };
    assert_eq!(observed, book);
    let MetadataValue::Number(mid) = observed.get("mid").unwrap() else {
        panic!()
    };
    assert_eq!(mid.to_bits(), (-0.0_f64).to_bits());
    let newer =
        MarketSnapshotHandle::new(&graph, "next".into(), 2.0, graph.object().unwrap().into())
            .unwrap();
    tick.as_handle()
        .set_property("snapshot", newer.value())
        .unwrap();
    assert_eq!(retained.snapshot().unwrap(), newer);
    assert!(matches!(
        snapshot.market().unwrap(),
        MetadataValue::String(_)
    ));
    let replacement = graph.object().unwrap();
    tick.as_handle()
        .set_property("msg", replacement.clone().into())
        .unwrap();
    let MetadataValue::Reference(observed) = retained.msg().unwrap() else {
        panic!()
    };
    assert_eq!(observed, replacement);
    assert_ne!(observed, msg);
    assert_eq!(
        PortfolioSnapshotHandle::from_handle(&MetadataGraph::new(), graph.object().unwrap())
            .unwrap_err(),
        MetadataError::WrongGraph
    );
}
