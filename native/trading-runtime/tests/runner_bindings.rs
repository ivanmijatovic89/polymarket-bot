use polymarket_runtime::{
    metadata::{
        AccessorPropertyDefinition, CallFrame, JsException, MetadataGraph, MetadataHandle,
        MetadataValue,
    },
    portfolio::PortfolioOptions,
    runner::SharedPortfolio,
    runner_bindings::graph_metrics,
    sdk_snapshot::MarketSnapshotHandle,
};
fn object(
    graph: &MetadataGraph,
    fields: impl IntoIterator<Item = (&'static str, MetadataValue)>,
) -> MetadataHandle {
    let h = graph.object().unwrap();
    for (k, v) in fields {
        h.set(k, v).unwrap()
    }
    h
}
#[test]
fn current_graph_metrics_preserve_zero_infinity_and_fresh_shared_context_wrappers() {
    let graph = MetadataGraph::new();
    let pf = SharedPortfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let snapshot = pf.snapshot().unwrap();
    let positions = match snapshot
        .handle()
        .as_handle()
        .get("positionsByAssetId")
        .unwrap()
    {
        MetadataValue::Reference(h) => h,
        _ => panic!(),
    };
    positions
        .set(
            "up",
            object(
                &graph,
                [("qty", (-0.0).into()), ("costBasis", 1e308.into())],
            )
            .into(),
        )
        .unwrap();
    positions
        .set(
            "down",
            object(&graph, [("qty", 0.0.into()), ("costBasis", 1e308.into())]).into(),
        )
        .unwrap();
    let market = object(
        &graph,
        [("upAssetId", "up".into()), ("downAssetId", "down".into())],
    );
    let metric = graph_metrics(&graph, &snapshot, None, Some(&market.clone().into()))
        .unwrap()
        .unwrap();
    let root = match metric {
        MetadataValue::Reference(h) => h,
        _ => panic!(),
    };
    let position = match root.get("position").unwrap() {
        MetadataValue::Reference(h) => h,
        _ => panic!(),
    };
    assert!(
        matches!(position.get("shares_mergeable").unwrap(),MetadataValue::Number(n) if n.to_bits()==(-0.0f64).to_bits())
    );
    assert!(
        matches!(position.get("total_cost").unwrap(),MetadataValue::Number(n) if n==f64::INFINITY)
    );
    assert!(
        matches!(position.get("pnl_merge").unwrap(),MetadataValue::Number(n) if n==f64::NEG_INFINITY)
    );
    let second = graph_metrics(&graph, &snapshot, None, Some(&market.into()))
        .unwrap()
        .unwrap();
    assert!(matches!(second,MetadataValue::Reference(h) if h!=root));
}
fn throw_captured(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    Err(JsException::Thrown(frame.captures[0].clone()))
}
#[test]
fn metric_market_getter_throws_original_reference_before_slot_projection() {
    let graph = MetadataGraph::new();
    let pf = SharedPortfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let market = graph.object().unwrap();
    let error = graph.object().unwrap();
    let getter = graph
        .function(throw_captured, vec![error.clone().into()])
        .unwrap();
    market
        .define_accessor_property(
            "upAssetId",
            AccessorPropertyDefinition {
                get: Some(Some(getter)),
                set: Some(None),
                enumerable: Some(true),
                configurable: Some(true),
            },
        )
        .unwrap();
    let result = graph_metrics(&graph, &pf.snapshot().unwrap(), None, Some(&market.into()));
    assert!(matches!(result,Err(JsException::Thrown(MetadataValue::Reference(h))) if h==error));
}
#[test]
fn current_orderbook_metrics_preserve_signed_zero_ratios() {
    let graph = MetadataGraph::new();
    let pf = SharedPortfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let market = object(
        &graph,
        [("upAssetId", "up".into()), ("downAssetId", "down".into())],
    );
    let array = |items: &[f64]| {
        let h = graph.array().unwrap();
        for x in items {
            h.push((*x).into()).unwrap()
        }
        h
    };
    let up = object(
        &graph,
        [
            ("depthLevels", 2.0.into()),
            ("bidsDepthByLevel", array(&[-0.0, 5.0]).into()),
            ("asksDepthByLevel", array(&[2.0, 10.0]).into()),
        ],
    );
    let down = object(
        &graph,
        [
            ("depthLevels", 2.0.into()),
            ("bidsDepthByLevel", array(&[2.0, 10.0]).into()),
            ("asksDepthByLevel", array(&[2.0, 5.0]).into()),
        ],
    );
    let books = MarketSnapshotHandle::new(
        &graph,
        "m".into(),
        1.0,
        object(&graph, [("up", up.into()), ("down", down.into())]).into(),
    )
    .unwrap();
    let metric = graph_metrics(
        &graph,
        &pf.snapshot().unwrap(),
        Some(&books),
        Some(&market.into()),
    )
    .unwrap()
    .unwrap();
    let root = match metric {
        MetadataValue::Reference(h) => h,
        _ => panic!(),
    };
    let result = match root.get("orderbook").unwrap() {
        MetadataValue::Reference(h) => h,
        _ => panic!(),
    };
    let ratios = match result.get("weakBidRatioByLevel").unwrap() {
        MetadataValue::Reference(h) => h,
        _ => panic!(),
    };
    assert!(matches!(ratios.get_index(0).unwrap(),MetadataValue::Number(n) if n.to_bits()==0));
    assert!(matches!(ratios.get_index(1).unwrap(),MetadataValue::Number(n) if n==0.5));
}

#[test]
fn numeric_fill_date_iso_preserves_complete_timeclip_domain_and_year_zero() {
    use polymarket_runtime::runner_bindings::numeric_date_iso;
    // Independently checked with Node20 Date.toISOString; this tests the numeric
    // Date domain only, without claiming pending string/object Date coercion.
    for (ms, expected) in [
        (0.0, "1970-01-01T00:00:00.000Z"),
        (-0.0, "1970-01-01T00:00:00.000Z"),
        (-1.0, "1969-12-31T23:59:59.999Z"),
        (-8_640_000_000_000_000.0, "-271821-04-20T00:00:00.000Z"),
        (8_640_000_000_000_000.0, "+275760-09-13T00:00:00.000Z"),
        (8_300_000_000_000_000.0, "+264986-07-12T19:33:20.000Z"),
        (-62_167_219_200_000.0, "0000-01-01T00:00:00.000Z"),
        (1.999, "1970-01-01T00:00:00.001Z"),
        (-1.999, "1969-12-31T23:59:59.999Z"),
    ] {
        assert_eq!(numeric_date_iso(ms).as_deref(), Some(expected));
    }
    for ms in [
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
        8_640_000_000_000_001.0,
        -8_640_000_000_000_001.0,
    ] {
        assert!(numeric_date_iso(ms).is_none());
    }
}
