use polymarket_runtime::{metadata::*, sdk_context::*};
#[test]
fn context_presence_order_and_nested_identity_match_runner_construction() {
    let graph = MetadataGraph::new();
    let empty = ContextParts::default();
    assert!(ContextHandle::base(&graph, &empty).unwrap().is_none());
    assert!(ContextHandle::full(&graph, &empty).unwrap().is_none());
    let plugins = graph.object().unwrap();
    let market = graph.object().unwrap();
    let metrics = graph.object().unwrap();
    let balance = graph.object().unwrap();
    let warmup = graph.object().unwrap();
    let mut parts = ContextParts {
        plugins: plugins.clone().into(),
        ..Default::default()
    };
    assert!(ContextHandle::base(&graph, &parts).unwrap().is_none());
    assert_eq!(
        ContextHandle::full(&graph, &parts)
            .unwrap()
            .unwrap()
            .as_handle()
            .keys()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap().to_owned())
            .collect::<Vec<_>>(),
        vec!["plugins"]
    );
    parts.market = market.clone().into();
    parts.metrics = metrics.clone().into();
    parts.balance = balance.clone().into();
    parts.warmup = warmup.clone().into();
    let base = ContextHandle::base(&graph, &parts).unwrap().unwrap();
    let full = ContextHandle::full(&graph, &parts).unwrap().unwrap();
    assert_eq!(
        base.as_handle()
            .keys()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap().to_owned())
            .collect::<Vec<_>>(),
        vec!["market", "metrics", "balance", "warmup"]
    );
    assert_eq!(
        full.as_handle()
            .keys()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap().to_owned())
            .collect::<Vec<_>>(),
        vec!["plugins", "market", "metrics", "balance", "warmup"]
    );
    let MetadataValue::Reference(m) = full.get("market").unwrap() else {
        panic!()
    };
    assert_eq!(m, market);
    market.set("changed", 1.0.into()).unwrap();
    assert!(matches!(
        m.get("changed").unwrap(),
        MetadataValue::Number(1.0)
    ));
    assert_ne!(base.as_handle(), full.as_handle());
    assert!(!full.as_handle().is_frozen().unwrap());
    parts.market = MetadataValue::Number(0.0);
    parts.metrics = MetadataValue::Bool(false);
    parts.balance = MetadataValue::Number(f64::NAN);
    parts.warmup = MetadataValue::Null;
    assert!(ContextHandle::base(&graph, &parts).unwrap().is_none());
}
