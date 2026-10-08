//! Real public OrderManager/Portfolio integration probes. These use the shared
//! graph directly; the adapter only supplies execution results and a settle gate.
use polymarket_runtime::{
    event_dispatch::Completion,
    intent::{ManagedIntent, ManagedIntents},
    metadata::{JsException, MetadataGraph, MetadataHandle, MetadataValue},
    order_manager::{ExecutionAdapter, ExecutionOperation, OrderManager, OrderManagerContext},
    portfolio::{Portfolio, PortfolioOptions},
    portfolio_records::{
        import_control_value, FillRecord, ManagedAccountEvent, OpenOrderRecord,
        PositionsSplitRecord, WsOrderUpdateRecord,
    },
    runner::{IntentMode, OwnedFuture},
};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::VecDeque,
    rc::Rc,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
};
#[derive(Clone, Debug)]
enum Error {
    Adapter(Rc<str>),
    Property(JsException),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Adapter(value) => value.fmt(f),
            Self::Property(value) => value.fmt(f),
        }
    }
}
type Events = Result<Vec<ManagedAccountEvent>, Error>;
#[derive(Default)]
struct AdapterState {
    calls: Vec<(
        ExecutionOperation,
        ManagedIntent,
        OrderManagerContext<MetadataHandle>,
    )>,
    results: VecDeque<Events>,
    gate: Option<Completion<Events>>,
    tick_enabled: bool,
    tick_calls: Vec<OrderManagerContext<MetadataHandle>>,
    logs: Vec<(String, Option<MetadataValue>)>,
    call_order: Vec<(bool, usize)>,
}
#[derive(Clone, Default)]
struct Adapter(Rc<RefCell<AdapterState>>);
impl ExecutionAdapter for Adapter {
    type MarketSnapshot = MetadataHandle;
    type Error = Error;
    fn execute(
        &self,
        operation: ExecutionOperation,
        intent: ManagedIntent,
        context: OrderManagerContext<MetadataHandle>,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, Error> {
        let mut state = self.0.borrow_mut();
        let index = state.calls.len();
        state.call_order.push((false, index));
        state.calls.push((operation, intent, context));
        if let Some(gate) = state.gate.take() {
            return Box::pin(gate);
        }
        let result = state.results.pop_front().unwrap_or(Ok(Vec::new()));
        Box::pin(async move { result })
    }
    fn on_market_tick(
        &self,
        context: OrderManagerContext<MetadataHandle>,
    ) -> Option<OwnedFuture<Vec<ManagedAccountEvent>, Error>> {
        let mut state = self.0.borrow_mut();
        if !state.tick_enabled {
            return None;
        }
        let index = state.tick_calls.len();
        state.call_order.push((true, index));
        state.tick_calls.push(context);
        Some(Box::pin(async { Ok(Vec::new()) }))
    }
    fn log(&self, message: &str, extra: Option<MetadataValue>) -> Result<(), Error> {
        self.0.borrow_mut().logs.push((message.to_owned(), extra));
        Ok(())
    }
    fn market_identity(&self, market: &MetadataHandle) -> Result<MetadataValue, Error> {
        market
            .get("market")
            .map_err(|error| self.metadata_error(error))
    }
    fn js_exception(&self, error: JsException) -> Error {
        Error::Property(error)
    }
}
struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}
fn turn<T>(future: &mut OwnedFuture<T, Error>) -> Poll<Result<T, Error>> {
    future
        .as_mut()
        .poll(&mut Context::from_waker(&Waker::from(Arc::new(Noop))))
}
fn complete<T>(mut future: OwnedFuture<T, Error>) -> Result<T, Error> {
    for _ in 0..1000 {
        if let Poll::Ready(value) = turn(&mut future) {
            return value;
        }
    }
    panic!("pending execution needs settlement");
}
fn object(graph: &MetadataGraph, value: Value) -> MetadataHandle {
    let MetadataValue::Reference(h) = import_control_value(graph, &value).unwrap() else {
        panic!("object")
    };
    h
}
fn intents(graph: &MetadataGraph, values: Value) -> ManagedIntents {
    ManagedIntents::from_handle(object(graph, values)).unwrap()
}
fn place(id: &str) -> Value {
    json!({"kind":"place_limit","clientOrderId":id,"assetId":"up","side":"BUY","price":0.5,"size":2,"orderType":"GTC","postOnly":true,"meta":{"marker":"shared"}})
}
fn context(p: &mut Portfolio, now: f64) -> OrderManagerContext<MetadataHandle> {
    OrderManagerContext {
        now_ms: now,
        last_market: None,
        portfolio: Some(p.snapshot_record().unwrap()),
    }
}
fn number(h: &MetadataHandle, key: &str) -> f64 {
    let MetadataValue::Number(n) = h.get(key).unwrap() else {
        panic!("number")
    };
    n
}
fn reference(h: &MetadataHandle, key: &str) -> MetadataHandle {
    let MetadataValue::Reference(r) = h.get(key).unwrap() else {
        panic!("reference")
    };
    r
}
fn raw_event(graph: &MetadataGraph, value: Value) -> ManagedAccountEvent {
    ManagedAccountEvent::from_envelope(object(graph, value))
}
fn split_event(graph: &MetadataGraph, id: &str, cost: f64) -> ManagedAccountEvent {
    let record = PositionsSplitRecord::new(
        graph,
        vec![
            ("id".into(), id.into()),
            ("tsMs".into(), 1.0.into()),
            ("assetIdA".into(), "up".into()),
            ("assetIdB".into(), "down".into()),
            ("size".into(), 1.0.into()),
            ("splitCost".into(), cost.into()),
        ],
    )
    .unwrap();
    let event = graph.object().unwrap();
    event.set("kind", "positions_split".into()).unwrap();
    event
        .set("split", record.handle().as_handle().clone().into())
        .unwrap();
    ManagedAccountEvent::from_envelope(event)
}

#[test]
fn queued_prefix_copies_membership_but_keeps_original_intent_and_metadata() {
    let graph = MetadataGraph::new();
    let adapter = Adapter::default();
    let manager = OrderManager::new_in_graph(&graph, adapter.clone(), false, None);
    let array = intents(&graph, json!([place("a")]));
    let original = array.at(0).unwrap();
    let future = manager.handle_intents(
        array.clone(),
        OrderManagerContext {
            now_ms: 0.0,
            last_market: None,
            portfolio: None,
        },
        IntentMode::Queued,
    );
    original.handle().set("price", 0.25.into()).unwrap();
    array
        .handle()
        .push(object(&graph, place("not-enqueued")).into())
        .unwrap();
    // Clearing the caller array after invocation cannot erase queued membership.
    array.handle().set_length(0).unwrap();
    assert!(complete(future).unwrap().is_empty());
    let events = complete(manager.on_market_tick(OrderManagerContext {
        now_ms: 1.0,
        last_market: None,
        portfolio: None,
    }))
    .unwrap();
    let calls = adapter.0.borrow();
    assert_eq!(calls.calls.len(), 1);
    assert_eq!(calls.calls[0].1.handle(), original.handle());
    let submitted = reference(events[0].envelope(), "order");
    assert_eq!(number(&submitted, "price"), 0.25);
    assert_eq!(
        reference(&submitted, "meta"),
        reference(original.handle(), "meta")
    );
}
#[test]
fn immediate_without_portfolio_reads_original_array_after_adapter_await() {
    let graph = MetadataGraph::new();
    let adapter = Adapter::default();
    let (gate, resolver) = Completion::pending();
    adapter.0.borrow_mut().gate = Some(gate);
    let manager = OrderManager::new_in_graph(&graph, adapter.clone(), false, None);
    let array = intents(&graph, json!([place("a")]));
    let mut future = manager.handle_intents(
        array.clone(),
        OrderManagerContext {
            now_ms: 1.0,
            last_market: None,
            portfolio: None,
        },
        IntentMode::Immediate,
    );
    // The actual first adapter call happened during the method invocation.
    assert_eq!(adapter.0.borrow().calls.len(), 1);
    assert!(turn(&mut future).is_pending());
    array
        .handle()
        .push(object(&graph, place("b")).into())
        .unwrap();
    resolver.complete(Ok(Vec::new()));
    let events = complete(future).unwrap();
    assert_eq!(adapter.0.borrow().calls.len(), 2);
    assert_eq!(events.len(), 2);
}
#[test]
fn pending_submission_overlay_shares_members_and_reconciles_exact_order_identity() {
    let graph = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let adapter = Adapter::default();
    let manager = OrderManager::new_in_graph(&graph, adapter, false, None);
    let original = p.snapshot_record().unwrap();
    let emitted = complete(manager.handle_intents(
        intents(&graph, json!([place("a")])),
        context(&mut p, 1.0),
        IntentMode::Immediate,
    ))
    .unwrap();
    let submitted = reference(emitted[0].envelope(), "order");
    let overlay = manager.with_pending_capital(&original).unwrap();
    assert_ne!(overlay.handle(), original.handle());
    assert!(!overlay.handle().as_handle().is_frozen().unwrap());
    assert!(reference(overlay.handle().as_handle(), "capital")
        .is_frozen()
        .unwrap());
    assert_eq!(
        number(
            &reference(overlay.handle().as_handle(), "capital"),
            "reservedCash"
        ),
        1.0
    );
    for key in [
        "positionsByAssetId",
        "openOrdersByClientId",
        "ordersByClientId",
        "recentFills",
    ] {
        assert_eq!(
            reference(overlay.handle().as_handle(), key),
            reference(original.handle().as_handle(), key)
        );
    }
    submitted.set("remaining", 4.0.into()).unwrap();
    assert_eq!(
        number(
            &reference(
                manager
                    .with_pending_capital(&original)
                    .unwrap()
                    .handle()
                    .as_handle(),
                "capital"
            ),
            "reservedCash"
        ),
        2.0
    );
    let equal = raw_event(
        &graph,
        json!({"kind":"order_submitted","tsMs":1,"order":{ "clientOrderId":"a","assetId":"up","side":"BUY","price":0.5,"size":2,"remaining":4,"filled":0,"state":"requested","createdAtMs":1,"updatedAtMs":1 }}),
    );
    manager.reconcile(&original, &equal).unwrap();
    assert_ne!(
        manager.with_pending_capital(&original).unwrap().handle(),
        original.handle()
    );
    p.apply_managed(&emitted[0]).unwrap();
    manager
        .reconcile(&p.snapshot_record().unwrap(), &emitted[0])
        .unwrap();
    let next = p.snapshot_record().unwrap();
    assert_eq!(
        manager.with_pending_capital(&next).unwrap().handle(),
        next.handle()
    );
}
#[test]
fn split_obligation_copies_cost_and_requires_original_envelope_to_reconcile() {
    let graph = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let adapter = Adapter::default();
    let event = split_event(&graph, "s", 3.0);
    adapter
        .0
        .borrow_mut()
        .results
        .push_back(Ok(vec![event.clone()]));
    let manager = OrderManager::new_in_graph(&graph, adapter, true, None);
    let root = p.snapshot_record().unwrap();
    let result = complete(manager.handle_intents(
        intents(
            &graph,
            json!([{"kind":"split_positions","assetIdA":"up","assetIdB":"down","size":1}]),
        ),
        context(&mut p, 1.0),
        IntentMode::Immediate,
    ))
    .unwrap();
    assert_eq!(result[0].envelope(), event.envelope());
    reference(event.envelope(), "split")
        .set("splitCost", 99.0.into())
        .unwrap();
    let equal = split_event(&graph, "s", 99.0);
    manager.reconcile(&root, &equal).unwrap();
    assert_eq!(
        number(
            &reference(
                manager
                    .with_pending_capital(&root)
                    .unwrap()
                    .handle()
                    .as_handle(),
                "capital"
            ),
            "reservedCash"
        ),
        3.0
    );
    manager.reconcile(&root, &event).unwrap();
    assert_eq!(
        manager.with_pending_capital(&root).unwrap().handle(),
        root.handle()
    );
}
#[test]
fn execution_error_keeps_original_identity_and_pending_submission() {
    let graph = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(&graph, PortfolioOptions::default(), 0.0).unwrap();
    let adapter = Adapter::default();
    let error: Rc<str> = Rc::from("adapter-original-error");
    adapter
        .0
        .borrow_mut()
        .results
        .push_back(Err(Error::Adapter(error.clone())));
    let manager = OrderManager::new_in_graph(&graph, adapter, false, None);
    let root = p.snapshot_record().unwrap();
    let failure = complete(manager.handle_intents(
        intents(&graph, json!([place("a")])),
        context(&mut p, 1.0),
        IntentMode::Immediate,
    ))
    .unwrap_err();
    let Error::Adapter(failure) = failure else {
        panic!("original adapter error")
    };
    assert!(Rc::ptr_eq(&error, &failure));
    assert_eq!(
        number(
            &reference(
                manager
                    .with_pending_capital(&root)
                    .unwrap()
                    .handle()
                    .as_handle(),
                "capital"
            ),
            "reservedCash"
        ),
        1.0
    );
    manager.begin_market();
    assert_eq!(
        manager.with_pending_capital(&root).unwrap().handle(),
        root.handle()
    );
}

fn graph_probe(value: MetadataValue) -> Value {
    let mut bits = serde_json::Map::new();
    let mut keys = serde_json::Map::new();
    let mut work = vec![(value.clone(), String::new())];
    while let Some((value, path)) = work.pop() {
        match value {
            MetadataValue::Number(number) => {
                bits.insert(path, json!(format!("{:016x}", number.to_bits())));
            }
            MetadataValue::Reference(handle) => {
                let names = if handle.is_array() {
                    handle
                        .index_keys()
                        .unwrap()
                        .into_iter()
                        .map(|n| n.to_string().into())
                        .collect::<Vec<polymarket_runtime::market_json::JsString>>()
                } else {
                    handle.keys().unwrap()
                };
                keys.insert(
                    path.clone(),
                    json!(names
                        .iter()
                        .map(|key| key.as_str().unwrap())
                        .collect::<Vec<_>>()),
                );
                for key in names {
                    let text = key.as_str().unwrap();
                    let value = if handle.is_array() {
                        handle.get_index(text.parse().unwrap()).unwrap()
                    } else {
                        handle.get(key.clone()).unwrap()
                    };
                    work.push((
                        value,
                        format!("{path}/{}", text.replace('~', "~0").replace('/', "~1")),
                    ));
                }
            }
            _ => {}
        }
    }
    let value = match value {
        MetadataValue::Reference(h) => {
            serde_json::from_str(&h.stringify().unwrap().unwrap()).unwrap()
        }
        MetadataValue::Null => Value::Null,
        _ => panic!("fixture probe root"),
    };
    json!({"value":value,"keys":keys,"bits":bits})
}
fn fixture_event(graph: &MetadataGraph, value: &Value) -> ManagedAccountEvent {
    let is_submission = value["kind"] == "order_submitted";
    let envelope = graph.object().unwrap();
    for (key, value) in value.as_object().unwrap() {
        let payload = if matches!(key.as_str(), "fill" | "split" | "order") {
            let fields = value
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| {
                    (
                        key.as_str().into(),
                        import_control_value(graph, value).unwrap(),
                    )
                })
                .collect();
            let record = match key.as_str() {
                "fill" => FillRecord::new(graph, fields)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone(),
                "split" => PositionsSplitRecord::new(graph, fields)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone(),
                "order" if is_submission => OpenOrderRecord::new(graph, fields)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone(),
                _ => WsOrderUpdateRecord::new(graph, fields)
                    .unwrap()
                    .handle()
                    .as_handle()
                    .clone(),
            };
            MetadataValue::Reference(record)
        } else {
            import_control_value(graph, value).unwrap()
        };
        envelope.set(key.as_str(), payload).unwrap();
    }
    ManagedAccountEvent::from_envelope(envelope)
}
fn fixture_context(
    graph: &MetadataGraph,
    context: &OrderManagerContext<MetadataHandle>,
) -> MetadataHandle {
    let h = graph.object().unwrap();
    h.set("nowMs", context.now_ms.into()).unwrap();
    if let Some(market) = &context.last_market {
        h.set("lastMarket", market.clone().into()).unwrap();
    }
    if let Some(p) = &context.portfolio {
        h.set("portfolio", p.handle().as_handle().clone().into())
            .unwrap();
    }
    h
}
fn fixture_throwing_getter(
    frame: &polymarket_runtime::metadata::CallFrame,
) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(counter) = &frame.captures[0] else {
        panic!("fixture counter")
    };
    let MetadataValue::Number(count) = counter.get("count")? else {
        panic!("fixture count")
    };
    counter.set("count", (count + 1.0).into())?;
    let MetadataValue::Reference(returns) = &frame.captures[2] else {
        panic!("fixture returns")
    };
    if (count as u32) < returns.length()? {
        return Ok(returns.get_index(count as u32)?);
    }
    Err(JsException::Thrown(frame.captures[1].clone()))
}
fn fixture_error(error: &Error) -> Value {
    if let Error::Property(JsException::Thrown(MetadataValue::Reference(value))) = error {
        serde_json::from_str(&value.stringify().unwrap().unwrap()).unwrap()
    } else {
        json!(error.to_string())
    }
}
fn run_case(case: &Value) -> Value {
    let input = &case["input"];
    let graph = MetadataGraph::new();
    let mut p = Portfolio::new_in_graph(
        &graph,
        PortfolioOptions {
            starting_capital: input["startingCapital"].as_f64().unwrap_or(500.0),
            ..PortfolioOptions::default()
        },
        0.0,
    )
    .unwrap();
    p.initialize_clock(0.0);
    for event in input["seed"].as_array().into_iter().flatten() {
        p.apply_managed(&fixture_event(&graph, event)).unwrap();
    }
    let adapter = Adapter::default();
    adapter.0.borrow_mut().tick_enabled = true;
    for result in input["execution"].as_array().into_iter().flatten() {
        let events = if let Some(error) = result.get("error") {
            Err(Error::Adapter(Rc::from(error.as_str().unwrap())))
        } else {
            Ok(result["events"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|event| fixture_event(&graph, event))
                .collect())
        };
        adapter.0.borrow_mut().results.push_back(events);
    }
    let manager = OrderManager::new_in_graph(
        &graph,
        adapter.clone(),
        input["dryRun"].as_bool().unwrap_or(false),
        input["minGtdOffsetMs"].as_f64(),
    );
    let market = input
        .get("market")
        .map(|value| object(&graph, json!({"market":value})));
    let mut originals = Vec::new();
    let mut outputs: Vec<Vec<ManagedAccountEvent>> = Vec::new();
    let mut observations = Vec::new();
    for op in input["operations"].as_array().unwrap() {
        let ctx = OrderManagerContext {
            now_ms: op["nowMs"].as_f64().unwrap_or(1000.0),
            last_market: market.clone(),
            portfolio: if input["withoutPortfolio"].as_bool() == Some(true) {
                None
            } else {
                Some(p.snapshot_record().unwrap())
            },
        };
        let mut events = Vec::new();
        let mut error = None;
        let mut getter_state = None;
        let mut thrown_original = false;
        match op["op"].as_str().unwrap() {
            "handle" => {
                let values = intents(&graph, op["intents"].clone());
                if let Some(getter) = op.get("getter") {
                    let original = values
                        .at(getter["intentIndex"].as_u64().unwrap() as u32)
                        .unwrap();
                    let counter = object(&graph, json!({"count":0}));
                    let thrown = object(&graph, getter["thrown"].clone());
                    let callback = graph
                        .function(
                            fixture_throwing_getter,
                            vec![
                                counter.clone().into(),
                                thrown.clone().into(),
                                import_control_value(
                                    &graph,
                                    getter.get("returns").unwrap_or(&json!([])),
                                )
                                .unwrap(),
                            ],
                        )
                        .unwrap();
                    original
                        .handle()
                        .define_accessor_property(
                            getter["field"].as_str().unwrap(),
                            polymarket_runtime::metadata::AccessorPropertyDefinition {
                                get: Some(Some(callback)),
                                set: Some(None),
                                enumerable: Some(true),
                                configurable: Some(true),
                            },
                        )
                        .unwrap();
                    getter_state = Some((counter, thrown));
                }
                for i in 0..values.length().unwrap() {
                    originals.push(values.at(i).unwrap().handle().clone());
                }
                match complete(manager.handle_intents(
                    values,
                    ctx,
                    if op["mode"] == "queued" {
                        IntentMode::Queued
                    } else {
                        IntentMode::Immediate
                    },
                )) {
                    Ok(value) => {
                        events = value;
                        outputs.push(events.clone());
                    }
                    Err(value) => {
                        thrown_original = matches!((&value,&getter_state),(Error::Property(JsException::Thrown(MetadataValue::Reference(v))),Some((_,t))) if v==t);
                        error = Some(fixture_error(&value));
                    }
                }
            }
            "tick" => match complete(manager.on_market_tick(ctx)) {
                Ok(value) => {
                    events = value;
                    outputs.push(events.clone());
                }
                Err(value) => error = Some(fixture_error(&value)),
            },
            "begin" => manager.begin_market(),
            "apply" => {
                for event in &outputs[op["index"].as_u64().unwrap() as usize] {
                    p.apply_managed(event).unwrap();
                    manager
                        .reconcile(&p.snapshot_record().unwrap(), event)
                        .unwrap();
                }
            }
            "reconcile" => {
                for event in &outputs[op["index"].as_u64().unwrap() as usize] {
                    manager
                        .reconcile(&p.snapshot_record().unwrap(), event)
                        .unwrap();
                }
            }
            "seed" => {
                for event in op["events"].as_array().into_iter().flatten() {
                    p.apply_managed(&fixture_event(&graph, event)).unwrap();
                }
            }
            _ => panic!("fixture operation"),
        }
        let snapshot = p.snapshot_record().unwrap();
        let pending = manager.with_pending_capital(&snapshot).unwrap();
        let array = graph.array().unwrap();
        for event in events {
            array.push(event.envelope().clone().into()).unwrap();
        }
        let shared = [
            "positionsByAssetId",
            "openOrdersByClientId",
            "wsOpenOrdersByOrderId",
            "ordersByClientId",
            "recentFills",
            "marketByAssetId",
        ]
        .into_iter()
        .filter(|key| {
            reference(snapshot.handle().as_handle(), key)
                == reference(pending.handle().as_handle(), key)
        })
        .collect::<Vec<_>>();
        let mut result = json!({"op":op["op"],"events":graph_probe(array.into()),"snapshot":graph_probe(snapshot.handle().as_handle().clone().into()),"pending":graph_probe(pending.handle().as_handle().clone().into()),"samePendingRoot":snapshot.handle()==pending.handle(),"pendingFrozen":pending.handle().as_handle().is_frozen().unwrap(),"capitalFrozen":reference(pending.handle().as_handle(),"capital").is_frozen().unwrap(),"shared":shared});
        if let Some((counter, _)) = getter_state {
            let MetadataValue::Number(count) = counter.get("count").unwrap() else {
                panic!("fixture count")
            };
            result
                .as_object_mut()
                .unwrap()
                .insert("getterCalls".into(), json!(count));
            result
                .as_object_mut()
                .unwrap()
                .insert("thrownOriginal".into(), json!(thrown_original));
        }
        if let Some(error) = error {
            result
                .as_object_mut()
                .unwrap()
                .insert("error".into(), json!(error));
        }
        observations.push(result);
    }
    let state = adapter.0.borrow();
    let mut calls = Vec::new();
    for (tick, index) in &state.call_order {
        if *tick {
            let ctx = &state.tick_calls[*index];
            calls.push(json!({"operation":"market_tick","intent":graph_probe(MetadataValue::Null),"context":graph_probe(fixture_context(&graph,ctx).into()),"originalIntent":false}));
        } else {
            let (operation, intent, ctx) = &state.calls[*index];
            let operation = match operation {
                ExecutionOperation::PlaceLimit => "place_limit",
                ExecutionOperation::PlaceBatch => "place_batch",
                ExecutionOperation::CancelOrder => "cancel_order",
                ExecutionOperation::CancelAll => "cancel_all",
                ExecutionOperation::CancelBatch => "cancel_batch",
                ExecutionOperation::CancelMarket => "cancel_market",
                ExecutionOperation::MergePositions => "merge_positions",
                ExecutionOperation::SplitPositions => "split_positions",
            };
            calls.push(json!({"operation":operation,"intent":graph_probe(intent.handle().clone().into()),"context":graph_probe(fixture_context(&graph,ctx).into()),"originalIntent":originals.contains(intent.handle())}));
        }
    }
    let logs=state.logs.iter().map(|(message,extra)|json!({"message":message,"extra":extra.as_ref().map(|extra|graph_probe(extra.clone()))})).collect::<Vec<_>>();
    json!({"name":case["name"],"result":{"operations":observations,"calls":calls,"logs":logs}})
}
#[test]
#[ignore = "test-only pinned TypeScript differential seam"]
fn differential_fixture_driver() {
    let input = std::env::var("PMB_ORDER_MANAGER_FIXTURE_INPUT").unwrap();
    let output = std::env::var("PMB_ORDER_MANAGER_FIXTURE_OUTPUT").unwrap();
    let value: Value = serde_json::from_str(&std::fs::read_to_string(input).unwrap()).unwrap();
    let result = value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(run_case)
        .collect::<Vec<_>>();
    std::fs::write(output, serde_json::to_vec(&result).unwrap()).unwrap();
}

#[test]
fn actual_property_getter_preserves_original_thrown_graph_value() {
    use polymarket_runtime::metadata::{AccessorPropertyDefinition, CallFrame};
    fn throw(frame: &CallFrame) -> Result<MetadataValue, JsException> {
        Err(JsException::Thrown(frame.captures[0].clone()))
    }
    let graph = MetadataGraph::new();
    let adapter = Adapter::default();
    let manager = OrderManager::new_in_graph(&graph, adapter, false, None);
    let array = intents(&graph, json!([place("a")]));
    let original = array.at(0).unwrap();
    let thrown = graph.object().unwrap();
    thrown.set("marker", "original".into()).unwrap();
    let callback = graph.function(throw, vec![thrown.clone().into()]).unwrap();
    original
        .handle()
        .define_accessor_property(
            "price",
            AccessorPropertyDefinition {
                get: Some(Some(callback)),
                set: Some(None),
                enumerable: Some(true),
                configurable: Some(true),
            },
        )
        .unwrap();
    let error = complete(manager.handle_intents(
        array,
        OrderManagerContext {
            now_ms: 1.0,
            last_market: None,
            portfolio: None,
        },
        IntentMode::Immediate,
    ))
    .unwrap_err();
    let Error::Property(JsException::Thrown(MetadataValue::Reference(value))) = error else {
        panic!("original thrown object")
    };
    assert_eq!(value, thrown);
}
