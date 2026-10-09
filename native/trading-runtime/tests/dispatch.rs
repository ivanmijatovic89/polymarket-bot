use polymarket_runtime::event_dispatch::{
    Completion, EntryLabel, FutureDisposition, SerialDispatcher, TickDisposition,
};
use polymarket_runtime::frame_cursor::{
    CursorStep, FrameAdmission, FrameCursor, FrameFailure, FrameInput, FutureFrameAdmission,
};
use polymarket_runtime::market::{MarketEngine, MarketTick};
use polymarket_runtime::market_json::JsValue;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};
fn diagnostic_decoded(messages: Vec<JsValue>, source: Value, bootstrap: bool) -> FrameInput {
    FrameInput::decoded(
        messages,
        polymarket_runtime::source::SourceHandle::from_diagnostic(
            &polymarket_runtime::metadata::MetadataGraph::new(),
            source,
        )
        .unwrap(),
        bootstrap,
    )
}
fn book(ts: i32) -> Value {
    json!({"event_type":"book","market":"m","asset_id":"up","timestamp":ts.to_string(),"bids":[{"price":"0.4","size":"3"}],"asks":[]})
}
fn frame(messages: Vec<Value>) -> FrameInput {
    diagnostic_decoded(
        messages.into_iter().map(JsValue::from_value).collect(),
        json!({"kind":"live","attempt":1,"ingestSeq":"900719925474099312345"}),
        false,
    )
}
fn cx() -> Context<'static> {
    Context::from_waker(Waker::noop())
}
#[test]
fn cursor_retains_history_and_partial_error_terminates_frame() {
    let mut engine = MarketEngine::new(None, 10.0).unwrap();
    let mut cursor = FrameCursor::new(frame(vec![book(1), book(2), Value::Null, book(3)])).unwrap();
    let CursorStep::Tick(first) = cursor.next(&mut engine).unwrap() else {
        panic!("tick")
    };
    let CursorStep::Tick(second) = cursor.next(&mut engine).unwrap() else {
        panic!("tick")
    };
    assert_eq!(first.snapshot.timestamp, 1.0);
    assert_eq!(second.snapshot.timestamp, 2.0);
    assert_eq!(first.source.diagnostic_value().unwrap()["frameIndex"], 0);
    assert_eq!(second.source.diagnostic_value().unwrap()["frameIndex"], 1);
    assert!(cursor.next(&mut engine).is_err());
    assert!(matches!(
        cursor.next(&mut engine).unwrap(),
        CursorStep::Done(_)
    ));
    assert_eq!(engine.snapshot().unwrap().timestamp, 2.0);
}
#[test]
fn compact_hash_normalization_creates_fresh_nodes_but_returns_original_message() {
    for (hash, normalized) in [
        ("a".repeat(40), true),
        (String::new(), false),
        ("other".into(), false),
    ] {
        let original = JsValue::from_value(
            json!({"event_type":"price_change","market":"m","timestamp":"1","price_changes":[{"asset_id":"up","price":"0.4","size":"2","side":"BUY","hash":hash,"best_bid":"","best_ask":""},{"asset_id":"down","price":"0.3","size":"1","side":"BUY","hash":"","best_bid":"","best_ask":""}]}),
        );
        let mut cursor = FrameCursor::new(diagnostic_decoded(
            vec![original.clone()],
            json!({"kind":"live","attempt":1}),
            false,
        ))
        .unwrap();
        let mut engine = MarketEngine::new(None, 10.0).unwrap();
        let CursorStep::Tick(tick) = cursor.next(&mut engine).unwrap() else {
            panic!("tick")
        };
        assert_eq!(tick.msg.same_identity(&original), !normalized);
        assert_eq!(
            tick.msg["price_changes"].same_identity(&original["price_changes"]),
            !normalized
        );
        for (left, right) in tick.msg["price_changes"]
            .as_array()
            .unwrap()
            .iter()
            .zip(original["price_changes"].as_array().unwrap())
        {
            assert_eq!(left.same_identity(right), !normalized);
        }
        let CursorStep::Done(Some(returned)) = cursor.next(&mut engine).unwrap() else {
            panic!("original return")
        };
        assert!(returned.same_identity(&original));
        assert_eq!(
            returned["price_changes"][0]["hash"],
            original["price_changes"][0]["hash"]
        );
    }
}
#[test]
fn void_is_atomic_but_ready_deferred_yields_and_reset_keeps_pending_chain() {
    let mut admission = FrameAdmission::<String>::new(MarketEngine::new(None, 10.0).unwrap());
    let seen = Rc::new(RefCell::new(Vec::new()));
    let copy = Rc::clone(&seen);
    let mut cb = move |t: Rc<MarketTick>| {
        copy.borrow_mut().push(t);
        Ok(TickDisposition::Void)
    };
    let receipt = admission.submit(frame(vec![book(1), book(2)]), &mut cb);
    assert!(receipt.is_ready());
    assert_eq!(seen.borrow().len(), 2);
    let mut cb = |t: Rc<MarketTick>| {
        seen.borrow_mut().push(t);
        Ok(TickDisposition::Deferred(Completion::ready(Ok(()))))
    };
    let receipt = admission.submit(frame(vec![book(3), book(4)]), &mut cb);
    assert!(!receipt.is_ready());
    assert_eq!(seen.borrow().len(), 3);
    let queued = admission.submit(frame(vec![book(5)]), &mut cb);
    admission.engine_mut().reset();
    assert!(admission.is_pending());
    for _ in 0..8 {
        let _ = admission.poll_ready(&mut cx(), &mut cb);
    }
    assert!(receipt.is_ready() && queued.is_ready());
    assert_eq!(seen.borrow()[2].snapshot.timestamp, 3.0);
    assert_eq!(admission.engine().snapshot().unwrap().timestamp, 5.0);
}
#[test]
fn direct_throw_recovers_but_deferred_rejection_poisons_already_queued_frames() {
    let mut admission = FrameAdmission::new(MarketEngine::new(None, 10.0).unwrap());
    let mut cb = |_: Rc<MarketTick>| Err::<TickDisposition<String>, _>("direct".into());
    assert!(matches!(
        admission
            .submit(frame(vec![book(1), book(2)]), &mut cb)
            .result(),
        Some(Err(FrameFailure::Callback(_)))
    ));
    let mut cb = |_: Rc<MarketTick>| Ok(TickDisposition::Void);
    assert!(admission.submit(frame(vec![book(3)]), &mut cb).is_ready());
    let (gate, resolver) = Completion::pending();
    let mut cb = |_: Rc<MarketTick>| Ok(TickDisposition::Deferred(gate.clone()));
    let first = admission.submit(frame(vec![book(4), book(5)]), &mut cb);
    let queued = admission.submit(frame(vec![book(6)]), &mut cb);
    resolver.complete(Err("rejection".into()));
    let _ = admission.poll_ready(&mut cx(), &mut cb);
    let _ = admission.poll_ready(&mut cx(), &mut cb);
    for receipt in [first, queued] {
        assert!(matches!(receipt.result(),Some(Err(FrameFailure::Callback(e))) if e=="rejection"));
    }
    assert_eq!(admission.engine().snapshot().unwrap().timestamp, 4.0);
    let mut cb = |_: Rc<MarketTick>| Ok(TickDisposition::Void);
    assert!(admission.submit(frame(vec![book(7)]), &mut cb).is_ready());
}
#[test]
fn tracked_frames_settle_one_continuation_at_a_time() {
    let mut admission = FrameAdmission::<String>::new(MarketEngine::new(None, 10.0).unwrap());
    let (gate, resolver) = Completion::pending();
    let mut cb = |_: Rc<MarketTick>| Ok(TickDisposition::Deferred(gate.clone()));
    let a = admission.submit(frame(vec![book(1)]), &mut cb);
    let b = admission.submit(frame(vec![book(2)]), &mut cb);
    let c = admission.submit(frame(vec![book(3)]), &mut cb);
    resolver.complete(Err("poison".into()));
    let _ = admission.poll_ready(&mut cx(), &mut cb);
    assert!(a.is_ready());
    assert!(!b.is_ready() && !c.is_ready());
    let d = admission.submit(frame(vec![book(4)]), &mut cb);
    let _ = admission.poll_ready(&mut cx(), &mut cb);
    assert!(b.is_ready());
    assert!(!c.is_ready() && !d.is_ready());
    for _ in 0..4 {
        let _ = admission.poll_ready(&mut cx(), &mut cb);
    }
    assert!(c.is_ready() && d.is_ready());
    assert!(!admission.is_pending());
    assert_eq!(admission.engine().snapshot().unwrap().timestamp, 1.0);
}
#[test]
fn async_adapter_preserves_void_and_supports_session_local_future() {
    let state = Rc::new(RefCell::new(Vec::new()));
    let mut admission = FutureFrameAdmission::<String>::new(MarketEngine::new(None, 10.0).unwrap());
    let mut cb = |t: Rc<MarketTick>| {
        let state = Rc::clone(&state);
        Ok(FutureDisposition::Deferred(Box::pin(async move {
            state.borrow_mut().push(t.snapshot.timestamp);
            Ok(())
        })))
    };
    let receipt = admission.submit(frame(vec![book(1), book(2)]), &mut cb);
    assert!(!receipt.is_ready());
    assert!(state.borrow().is_empty());
    for _ in 0..8 {
        let _ = admission.poll_ready(&mut cx(), &mut cb);
    }
    assert!(receipt.is_ready());
    assert_eq!(*state.borrow(), vec![1.0, 2.0]);
}
#[test]
fn capture_precedes_fifo_processing_and_failed_entries_do_not_break_chain() {
    let mut queue = SerialDispatcher::<Rc<str>, String>::new();
    let a = queue.submit_tick("a", |x| Ok(Rc::from(x))).unwrap();
    assert_eq!(queue.depth(), 1);
    let failed = queue.submit_tick("bad", |_| Err("capture".into()));
    assert!(failed.is_err());
    assert_eq!(queue.depth(), 1);
    let b = queue.enqueue(EntryLabel::Account, Rc::from("b"));
    let seen = RefCell::new(Vec::new());
    let mut process = |x: Rc<str>| {
        seen.borrow_mut().push(x.to_string());
        if x.as_ref() == "a" {
            Err("process".into())
        } else {
            Ok(TickDisposition::Void)
        }
    };
    assert!(seen.borrow().is_empty());
    for _ in 0..8 {
        let _ = queue.poll_ready(&mut cx(), &mut process);
    }
    assert_eq!(*seen.borrow(), ["a", "b"]);
    assert!(matches!(a.result(), Some(Err(_))));
    assert!(matches!(b.result(), Some(Ok(()))));
    assert_eq!(queue.depth(), 0);
    assert_eq!(queue.take_failures().len(), 1);
}
#[test]
fn dispatch_receipt_resolves_before_tail_depth_and_next_entry() {
    let mut queue = SerialDispatcher::<usize, String>::new();
    let first = queue.enqueue(EntryLabel::Tick, 1);
    queue.enqueue(EntryLabel::Account, 2);
    let (gate, resolver) = Completion::pending();
    let seen = RefCell::new(Vec::new());
    let mut process = |id| {
        seen.borrow_mut().push(id);
        Ok(if id == 1 {
            TickDisposition::Deferred(gate.clone())
        } else {
            TickDisposition::Void
        })
    };
    let _ = queue.poll_ready(&mut cx(), &mut process);
    resolver.complete(Ok(()));
    let _ = queue.poll_ready(&mut cx(), &mut process);
    assert!(first.is_ready());
    assert_eq!(queue.depth(), 2);
    assert_eq!(*seen.borrow(), [1]);
    let _ = queue.poll_ready(&mut cx(), &mut process);
    assert_eq!(*seen.borrow(), [1, 2]);
}
#[test]
fn future_serial_retains_capture_identity_and_drains_without_send() {
    use polymarket_runtime::event_dispatch::FutureSerialDispatcher;
    let original = Rc::new(RefCell::new(1));
    let retained = Rc::clone(&original);
    let mut queue = FutureSerialDispatcher::<Rc<RefCell<usize>>, String>::new();
    let receipt = queue.submit_tick(Rc::clone(&original), Ok).unwrap();
    let mut process = |payload: Rc<RefCell<usize>>| {
        assert!(Rc::ptr_eq(&payload, &retained));
        Ok(FutureDisposition::Deferred(Box::pin(async move {
            *payload.borrow_mut() = 2;
            Ok(())
        })))
    };
    {
        let drain = queue.drain(&mut process);
        let mut drain = Box::pin(drain);
        for _ in 0..8 {
            if drain.as_mut().poll(&mut cx()).is_ready() {
                break;
            }
        }
    }
    assert!(receipt.is_ready());
    assert_eq!(*original.borrow(), 2);
    assert_eq!(queue.depth(), 0);
}
#[test]
fn backlog_warning_doubles_and_resets_after_drain() {
    let mut queue = SerialDispatcher::<(), String>::new();
    for _ in 0..801 {
        queue.enqueue(EntryLabel::Tick, ());
    }
    assert_eq!(
        queue
            .take_warnings()
            .iter()
            .map(|w| w.depth)
            .collect::<Vec<_>>(),
        [200, 400, 800]
    );
    let mut process = |()| Ok(TickDisposition::Void);
    for _ in 0..1604 {
        let _ = queue.poll_ready(&mut cx(), &mut process);
    }
    for _ in 0..200 {
        queue.enqueue(EntryLabel::Account, ());
    }
    assert_eq!(queue.take_warnings()[0].depth, 200);
}
#[test]
fn completion_first_settlement_wins_and_receipt_is_awaitable() {
    let (mut completion, resolver) = Completion::pending();
    assert!(Pin::new(&mut completion).poll(&mut cx()).is_pending());
    assert!(resolver.complete(1));
    assert!(!resolver.complete(2));
    assert_eq!(Pin::new(&mut completion).poll(&mut cx()), Poll::Ready(1));
}

type Gate = (
    Completion<Result<(), String>>,
    polymarket_runtime::event_dispatch::CompletionResolver<Result<(), String>>,
);
type Gates = Rc<RefCell<HashMap<String, Gate>>>;
#[derive(Clone)]
struct Envelope {
    tick: Option<Rc<MarketTick>>,
    id: String,
    captured: Value,
}
fn tick_value(tick: &MarketTick) -> Value {
    // Diagnostic encoding only: UTF-16 strings outside Unicode scalar values
    // use an explicit code-unit tag; sourceProbe still reads the original slot.
    let mut diagnostic = JsValue::object(vec![
        ("source".into(), tick.source.diagnostic_value().unwrap()),
        ("msg".into(), tick.msg.clone()),
        ("snapshot".into(), tick.snapshot.trace_value()),
    ]);
    let mut pending = vec![&mut diagnostic];
    while let Some(value) = pending.pop() {
        match value {
            JsValue::String(text) if text.as_str().is_none() => {
                *value = JsValue::object(vec![(
                    "$utf16".into(),
                    JsValue::array(
                        text.units()
                            .into_iter()
                            .map(|unit| JsValue::Number(f64::from(unit)))
                            .collect(),
                    ),
                )]);
            }
            JsValue::Object(object) => {
                pending.extend(object.values.iter_mut().map(|(_, value)| value))
            }
            JsValue::Array(array) => pending.extend(array.values.iter_mut()),
            _ => {}
        }
    }
    serde_json::from_str(&diagnostic.to_json_string()).unwrap()
}
fn source_spec(
    graph: &polymarket_runtime::metadata::MetadataGraph,
    spec: &Value,
) -> polymarket_runtime::source::SourceHandle {
    use polymarket_runtime::source::SourceHandle;
    let source = SourceHandle::from_diagnostic(
        graph,
        spec.get("source")
            .cloned()
            .unwrap_or_else(|| json!({"kind":"live","attempt":1})),
    )
    .unwrap();
    source_mutation(&source, spec);
    source
}
fn source_mutation(source: &polymarket_runtime::source::SourceHandle, spec: &Value) {
    use polymarket_runtime::{metadata::MetadataValue, source::*};
    if let Some(bits) = spec["localTimeBits"].as_str() {
        source
            .set(
                LOCAL_TIME_MS,
                f64::from_bits(u64::from_str_radix(bits, 16).unwrap()).into(),
            )
            .unwrap();
    }
    if let Some(sequence) = spec["sequence"].as_str() {
        source
            .set(INGEST_SEQ, MetadataValue::BigInt(sequence.parse().unwrap()))
            .unwrap();
    }
    if spec["removeSequence"].as_bool().unwrap_or(false) {
        source.delete(INGEST_SEQ).unwrap();
    }
    if spec["undefinedSequence"].as_bool().unwrap_or(false) {
        source.set(INGEST_SEQ, MetadataValue::Missing).unwrap();
    }
    if let Some(units) = spec["filePathUnits"].as_array() {
        source
            .set(
                FILE_PATH,
                MetadataValue::String(polymarket_runtime::market_json::JsString::from_units(
                    units.iter().map(|v| v.as_u64().unwrap() as u16).collect(),
                )),
            )
            .unwrap();
    }
    if let Some(value) = spec["nestedValue"].as_f64() {
        let MetadataValue::Reference(nested) = source.record().as_handle().get("extra").unwrap()
        else {
            panic!("extra")
        };
        nested.set("value", value.into()).unwrap();
    }
}
fn source_probe(source: &polymarket_runtime::source::SourceHandle) -> Value {
    use polymarket_runtime::{metadata::MetadataValue, source::*};
    let sequence = source.get(INGEST_SEQ).unwrap();
    let local = source.get(LOCAL_TIME_MS).unwrap();
    let bits = match local {
        MetadataValue::Number(value) => Some(if value.is_nan() {
            "NaN".into()
        } else {
            format!("{:016x}", value.to_bits())
        }),
        _ => None,
    };
    let path = match source.get(FILE_PATH).unwrap() {
        MetadataValue::String(value) => Some(value.units()),
        _ => None,
    };
    let seq_type = match &sequence {
        MetadataValue::BigInt(_) => "bigint",
        MetadataValue::Missing => "undefined",
        MetadataValue::Null => "object",
        MetadataValue::Number(_) => "number",
        MetadataValue::String(_) => "string",
        MetadataValue::Bool(_) => "boolean",
        MetadataValue::Reference(_) => "object",
    };
    let seq = match sequence {
        MetadataValue::BigInt(value) => Some(value.to_string()),
        _ => None,
    };
    json!({"keys":source.record().as_handle().keys().unwrap().iter().map(|key|key.units()).collect::<Vec<_>>(),"sequenceType":seq_type,"sequence":seq,"localTimeBits":bits,"filePathUnits":path})
}

fn run_case(case: &Value) -> Value {
    use polymarket_runtime::event_dispatch::CompletionResolver;
    let input = &case["input"];
    let graph = polymarket_runtime::metadata::MetadataGraph::new();
    let sources = RefCell::new(HashMap::<String, polymarket_runtime::source::SourceHandle>::new());
    let combined = input["combined"].as_bool().unwrap_or(false);
    let awaited = input["awaited"].as_bool().unwrap_or(false);
    let mut frames = FrameAdmission::<String>::new(MarketEngine::new(None, 10.0).unwrap());
    let serial = Rc::new(RefCell::new(SerialDispatcher::<Envelope, String>::new()));
    let events = Rc::new(RefCell::new(Vec::<Value>::new()));
    let provider = Rc::new(RefCell::new(json!("initial")));
    let gates = Rc::new(RefCell::new(HashMap::<
        String,
        (
            Completion<Result<(), String>>,
            CompletionResolver<Result<(), String>>,
        ),
    >::new()));
    let retained = Rc::new(RefCell::new(Vec::<Rc<MarketTick>>::new()));
    let plans = &input["callbacks"];
    let originals = Rc::new(RefCell::new(HashMap::<String, JsValue>::new()));
    let mut callback = |tick: Rc<MarketTick>| -> Result<TickDisposition<String>, String> {
        let id = tick.snapshot.timestamp.to_string();
        retained.borrow_mut().push(Rc::clone(&tick));
        let mut event = json!({"kind":"capture","id":id,"provider":provider.borrow().clone(),"tick":tick_value(&tick)});
        if input["identityProbe"].as_bool().unwrap_or(false) {
            let originals = originals.borrow();
            let original = &originals[&id];
            event["identity"] = json!({"messageSame":tick.msg.same_identity(original),"changesSame":tick.msg["price_changes"].same_identity(&original["price_changes"]),"changeObjectsSame":tick.msg["price_changes"].as_array().unwrap().iter().zip(original["price_changes"].as_array().unwrap()).map(|(a,b)|a.same_identity(b)).collect::<Vec<_>>()});
        }
        events.borrow_mut().push(event);
        let plan = &plans[&id];
        if plan["captureThrow"].as_bool().unwrap_or(false) {
            return Err(format!("capture:{id}"));
        }
        if combined {
            let envelope = Envelope {
                tick: Some(tick),
                id,
                captured: provider.borrow().clone(),
            };
            let receipt = serial.borrow_mut().enqueue(EntryLabel::Tick, envelope);
            if awaited {
                Ok(TickDisposition::Deferred(receipt))
            } else {
                Ok(TickDisposition::Void)
            }
        } else {
            disposition(plan, &id, &gates)
        }
    };
    let mut process = |entry: Envelope| -> Result<TickDisposition<String>, String> {
        let id = entry.id;
        events.borrow_mut().push(json!({"kind":"process","id":id,"captured":entry.captured,"provider":provider.borrow().clone(),"tick":entry.tick.as_ref().map(|t|tick_value(t))}));
        disposition(&plans[&id], &id, &gates)
    };
    let mut receipts = Vec::new();
    let mut serial_receipts = Vec::new();
    let mut observations = Vec::new();
    for op in input["operations"].as_array().unwrap() {
        match op["kind"].as_str().unwrap() {
            "submit" => {
                events
                    .borrow_mut()
                    .push(json!({"kind":"receipt","id":op["id"]}));
                let source = op
                    .get("source")
                    .cloned()
                    .unwrap_or_else(|| json!({"kind":"live","attempt":1}));
                let bootstrap = op["bootstrap"].as_bool().unwrap_or(false);
                let source = if let Some(id) = op["sourceId"].as_str() {
                    sources.borrow()[id].clone()
                } else {
                    polymarket_runtime::source::SourceHandle::from_diagnostic(&graph, source)
                        .unwrap()
                };
                let frame = if let Some(raw) = op["rawJson"].as_str() {
                    FrameInput::raw(raw, source, bootstrap)
                } else {
                    let messages = op["messages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .cloned()
                        .map(JsValue::from_value)
                        .collect::<Vec<_>>();
                    if input["identityProbe"].as_bool().unwrap_or(false) {
                        for message in &messages {
                            if let Some(id) = message["timestamp"].as_str() {
                                originals.borrow_mut().insert(id.into(), message.clone());
                            }
                        }
                    }
                    FrameInput::decoded(messages, source, bootstrap)
                };
                receipts.push((op["id"].clone(), frames.submit(frame, &mut callback)));
            }
            "source_create" => {
                sources
                    .borrow_mut()
                    .insert(op["id"].as_str().unwrap().into(), source_spec(&graph, op));
            }
            "source_mutate" => source_mutation(&sources.borrow()[op["id"].as_str().unwrap()], op),
            "account" => {
                serial_receipts.push((
                    op["id"].clone(),
                    serial.borrow_mut().enqueue(
                        EntryLabel::Account,
                        Envelope {
                            tick: None,
                            id: op["id"].as_str().unwrap().into(),
                            captured: Value::Null,
                        },
                    ),
                ));
            }
            "provider" => {
                *provider.borrow_mut() = op["value"].clone();
            }
            "reset" => frames.engine_mut().reset(),
            "resolve" => {
                if let Some((_, resolver)) = gates.borrow().get(op["gate"].as_str().unwrap()) {
                    resolver.complete(if let Some(error) = op["error"].as_str() {
                        Err(error.into())
                    } else {
                        Ok(())
                    });
                }
            }
            "flush" => {
                for _ in 0..(input["operations"].as_array().unwrap().len() * 12 + 64) {
                    let _ = frames.poll_ready(&mut cx(), &mut callback);
                    if combined {
                        let _ = serial.borrow_mut().poll_ready(&mut cx(), &mut process);
                    }
                }
            }
            _ => panic!("unknown fixture operation"),
        }
        let statuses = if op["kind"] == "flush" {
            let frame_statuses = receipts.iter().map(|(id, receipt)| {
                let result = receipt.result().map(|result| match result {
                    Ok(message) => json!({"ok":message.map(|m|serde_json::from_str::<Value>(&m.to_json_string()).unwrap())}),
                    Err(FrameFailure::Callback(error)) => json!({"error":{"name":"Error","message":error}}),
                    Err(FrameFailure::Market(error)) => json!({"error":{"name":error.name,"message":serde_json::from_str::<Value>(&JsValue::String(error.message.clone()).to_json_string()).unwrap()}}),
                });
                let mut row=json!({"id":id,"result":result});
                if input["identityProbe"].as_bool().unwrap_or(false) {
                    row["returnSame"]=json!(receipt.result().and_then(|result|result.ok()).flatten().map(|message|{
                        let originals=originals.borrow(); let original=&originals[message["timestamp"].as_str().unwrap()];message.same_identity(original)
                    }));
                }
                row
            }).collect::<Vec<_>>();
            let serial_statuses = serial_receipts
                .iter()
                .map(|(id, receipt)| {
                    let result = receipt.result().map(|result| match result {
                        Ok(()) => json!({"ok":true}),
                        Err(error) => json!({"error":{"name":"Error","message":error}}),
                    });
                    json!({"id":id,"result":result})
                })
                .collect::<Vec<_>>();
            Some(
                json!({"frames":frame_statuses,"serial":serial_statuses,"depth":serial.borrow().depth()}),
            )
        } else {
            None
        };
        observations.push(json!({"state":serde_json::from_str::<Value>(&frames.engine().snapshot().unwrap().trace_value().to_json_string()).unwrap(),"events":events.borrow().clone(),"statuses":statuses}));
    }
    let mut result = json!({"observations":observations,"retained":retained.borrow().iter().map(|t|tick_value(t)).collect::<Vec<_>>()});
    if input["sourceProbe"].as_bool().unwrap_or(false) {
        let sources = sources.borrow();
        let retained = retained.borrow();
        let mut ids = sources.keys().collect::<Vec<_>>();
        ids.sort();
        result["sourceProbes"] = json!({
            "sources":ids.iter().map(|id|json!({"id":id,"probe":source_probe(&sources[*id])})).collect::<Vec<_>>(),
            "ticks":retained.iter().map(|tick|json!({"probe":source_probe(&tick.source),"sameSources":ids.iter().map(|id|tick.source==sources[*id]).collect::<Vec<_>>(),"sameTickSources":retained.iter().map(|other|tick.source==other.source).collect::<Vec<_>>() })).collect::<Vec<_>>()
        });
    }
    json!({"name":case["name"],"result":result})
}
fn disposition(plan: &Value, id: &str, gates: &Gates) -> Result<TickDisposition<String>, String> {
    if plan["throw"].as_bool().unwrap_or(false) {
        return Err(format!("process:{id}"));
    }
    if let Some(gate) = plan["gate"].as_str() {
        let mut gates = gates.borrow_mut();
        let completion = gates
            .entry(gate.into())
            .or_insert_with(Completion::pending)
            .0
            .clone();
        return Ok(TickDisposition::Deferred(completion));
    }
    if plan["ready"].as_bool().unwrap_or(false) {
        return Ok(TickDisposition::Deferred(Completion::ready(
            if plan["reject"].as_bool().unwrap_or(false) {
                Err(format!("process:{id}"))
            } else {
                Ok(())
            },
        )));
    }
    Ok(TickDisposition::Void)
}
#[test]
#[ignore]
fn differential_fixture_driver() {
    let source = std::env::var("PMB_DISPATCH_FIXTURE_INPUT").unwrap();
    let target = std::env::var("PMB_DISPATCH_FIXTURE_OUTPUT").unwrap();
    let input: Value = serde_json::from_slice(&std::fs::read(source).unwrap()).unwrap();
    let output = input["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(run_case)
        .collect::<Vec<_>>();
    std::fs::write(target, serde_json::to_vec(&output).unwrap()).unwrap();
}
