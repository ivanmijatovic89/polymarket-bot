use num_bigint::BigInt;
use parquet::record::{Field, Row};
use polymarket_runtime::{
    event_dispatch::{Completion, CompletionResolver},
    market_json::{JsString, JsValue},
    metadata::MetadataGraph,
    parquet_input::{InputError, ParquetInputData, ReplayInputRow},
    recorded_replay::{replay_recorded, RecordedInput, ReplayError},
};
use std::{
    cell::RefCell,
    collections::VecDeque,
    future::Future,
    path::PathBuf,
    pin::pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};

struct Input {
    rows: VecDeque<ReplayInputRow>,
    actions: Rc<RefCell<Vec<&'static str>>>,
    fail_advance: bool,
}
impl RecordedInput for Input {
    fn pop(&mut self) -> Result<Option<ReplayInputRow>, InputError> {
        self.actions.borrow_mut().push("pop");
        Ok(self.rows.pop_front())
    }
    fn advance(&mut self) -> Result<(), InputError> {
        self.actions.borrow_mut().push("advance");
        if self.fail_advance {
            Err(InputError("refill failed".into()))
        } else {
            Ok(())
        }
    }
}
impl Drop for Input {
    fn drop(&mut self) {
        self.actions.borrow_mut().push("close");
    }
}
fn book(market: &str, timestamp: i32) -> String {
    format!(
        r#"{{"event_type":"book","market":{market},"asset_id":"up","timestamp":"{timestamp}","bids":[],"asks":[],"extra":1e400,"negativeZero":-0}}"#
    )
}
fn row(raw: impl Into<JsString>, timestamp: i32) -> ReplayInputRow {
    ReplayInputRow {
        file_index: 0,
        row_index: 0,
        file_path: PathBuf::from("fixture.parquet"),
        ingest_sequence: BigInt::from(timestamp),
        ordering_timestamp: BigInt::from(timestamp),
        row: ParquetInputData {
            physical: Row::new(vec![("ts_local_ms".into(), Field::Long(timestamp as i64))]),
            undefined_columns: Vec::new(),
            logical_json: vec![("raw_json".into(), JsValue::String(raw.into()))],
            logical_decimals: Vec::new(),
        },
    }
}
fn run<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    for _ in 0..100 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
    panic!("test future did not complete");
}
fn input(rows: Vec<ReplayInputRow>, actions: &Rc<RefCell<Vec<&'static str>>>) -> Input {
    Input {
        rows: rows.into(),
        actions: actions.clone(),
        fail_advance: false,
    }
}

#[test]
fn awaited_child_precedes_other_children_refill_and_stop() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let raw = format!("[{},{}]", book("\"m\"", 1), book("\"m\"", 2));
    let (gate, resolver): (Completion<()>, CompletionResolver<()>) = Completion::pending();
    let mut calls = 0;
    let future = replay_recorded(
        input(
            vec![row(raw.clone(), 1), row(book("\"m\"", 3), 3)],
            &actions,
        ),
        &graph,
        false,
        || {
            actions.borrow_mut().push("stop");
            false
        },
        async |_| {},
        async |tick, original| {
            calls += 1;
            actions.borrow_mut().push("tick");
            assert!(original.matches(&raw) || calls == 3);
            assert!(tick.msg["extra"].is_null());
            assert_eq!(tick.msg["negativeZero"], JsValue::Number(0.0));
            if calls == 1 {
                gate.clone().await;
            }
            Ok::<(), ()>(())
        },
    );
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["stop", "pop", "tick"]);
    resolver.complete(());
    let mut completed = false;
    for _ in 0..20 {
        if matches!(future.as_mut().poll(&mut context), Poll::Ready(Ok(()))) {
            completed = true;
            break;
        }
    }
    assert!(completed);
    assert_eq!(
        *actions.borrow(),
        [
            "stop", "pop", "tick", "tick", "advance", "stop", "pop", "tick", "advance", "stop",
            "pop", "close"
        ]
    );
}
#[test]
fn callback_failure_closes_without_refill_and_retains_identity() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let error = Rc::new("failure");
    let result = run(replay_recorded(
        input(vec![row(book("\"m\"", 1), 1)], &actions),
        &graph,
        false,
        || false,
        async |_| {},
        async |_, _| Err::<(), _>(error.clone()),
    ));
    let Err(ReplayError::Callback(actual)) = result else {
        panic!("callback error");
    };
    assert!(Rc::ptr_eq(&actual, &error));
    assert_eq!(*actions.borrow(), ["pop", "close"]);
}
#[test]
fn stop_is_checked_after_refill_even_when_callback_requests_stop() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let stopped = Rc::new(RefCell::new(false));
    let stop = stopped.clone();
    let result = run(replay_recorded(
        input(
            vec![row(book("\"m\"", 1), 1), row(book("\"m\"", 2), 2)],
            &actions,
        ),
        &graph,
        false,
        || *stop.borrow(),
        async |_| {},
        async |_, _| {
            *stopped.borrow_mut() = true;
            Ok::<(), ()>(())
        },
    ));
    assert!(result.is_ok());
    assert_eq!(*actions.borrow(), ["pop", "advance", "close"]);
}
#[test]
fn numeric_boolean_object_and_nullish_market_selection_uses_strict_identity() {
    for (first, second, expected) in [
        ("false", "false", 2),
        ("1", "\"1\"", 1),
        ("{}", "{}", 1),
        ("null", "null", 2),
    ] {
        let graph = MetadataGraph::new();
        let actions = Rc::new(RefCell::new(Vec::new()));
        let mut ticks = 0;
        let result = run(replay_recorded(
            input(
                vec![row(book(first, 1), 1), row(book(second, 2), 2)],
                &actions,
            ),
            &graph,
            false,
            || false,
            async |_| {},
            async |_, _| {
                ticks += 1;
                Ok::<(), ()>(())
            },
        ));
        assert!(result.is_ok(), "{first}/{second}: {result:?}");
        assert_eq!(ticks, expected, "market {first}/{second}");
    }
}
#[test]
fn time_driven_sleep_includes_zero_caps_and_moves_previous_after_regression() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let mut sleeps = Vec::new();
    let rows = [1, 1, 30000, 2, 5]
        .into_iter()
        .map(|time| row("[]", time))
        .collect();
    let result = run(replay_recorded(
        input(rows, &actions),
        &graph,
        true,
        || false,
        async |time| {
            sleeps.push(time);
        },
        async |_, _| Ok::<(), ()>(()),
    ));
    assert!(result.is_ok());
    assert_eq!(sleeps, [0, 10000, 3]);
}
#[test]
fn serialization_failure_precedes_event_type_skip() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let mut item = row("[]", 1);
    item.row.logical_json.clear();
    item.row.physical = Row::new(vec![
        ("event_type".into(), Field::Str("disconnect".into())),
        ("raw_json".into(), Field::Long(7)),
    ]);
    let result = run(replay_recorded(
        input(vec![item], &actions),
        &graph,
        false,
        || false,
        async |_| {},
        async |_, _| Ok::<(), ()>(()),
    ));
    assert!(matches!(result, Err(ReplayError::Input(_))));
    assert_eq!(*actions.borrow(), ["pop", "close"]);
}
#[test]
fn lone_utf16_units_in_original_json_text_survive_callback_and_parse() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let text = book("\"m\"", 1).replace("1e400", "\"PLACEHOLDER\"");
    let units = text
        .split("PLACEHOLDER")
        .next()
        .unwrap()
        .encode_utf16()
        .chain([0xd800])
        .chain(text.split("PLACEHOLDER").nth(1).unwrap().encode_utf16())
        .collect();
    let raw = JsString::from_units(units);
    let mut ticks = 0;
    let result = run(replay_recorded(
        input(vec![row(raw.clone(), 1)], &actions),
        &graph,
        false,
        || false,
        async |_| {},
        async |tick, original| {
            ticks += 1;
            assert_eq!(original, raw);
            let JsValue::String(extra) = &tick.msg["extra"] else {
                panic!("string");
            };
            assert_eq!(extra.units(), [0xd800]);
            Ok::<(), ()>(())
        },
    ));
    assert!(result.is_ok());
    assert_eq!(ticks, 1);
}

#[test]
#[ignore = "executed by the recorded replay differential wrapper"]
fn actual_recorded_replay_fixture_driver() {
    use polymarket_runtime::parquet_input::{MergedParquetInput, ReplayOrder};
    use serde_json::Value;
    let cases: Value = serde_json::from_slice(
        &std::fs::read(std::env::var("PMB_RECORDED_CASES").unwrap()).unwrap(),
    )
    .unwrap();
    let mut results = Vec::new();
    for scenario in cases.as_array().unwrap() {
        let graph = MetadataGraph::new();
        let ticks = RefCell::new(Vec::new());
        let paths = scenario["filePaths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| PathBuf::from(path.as_str().unwrap()))
            .collect();
        let order = if scenario["order"] == "exchange_time" {
            ReplayOrder::ExchangeTime
        } else {
            ReplayOrder::Recorded
        };
        let failed = match MergedParquetInput::open(paths, order) {
            Err(_) => true,
            Ok(input) => run(replay_recorded(
                input,
                &graph,
                false,
                || {
                    scenario["stopAfter"]
                        .as_u64()
                        .is_some_and(|count| ticks.borrow().len() >= count as usize)
                },
                async |_| {},
                async |tick, original| {
                    let value = JsValue::object(vec![
                        ("snapshot".into(), tick.snapshot.trace_value()),
                        ("msg".into(), tick.msg.clone()),
                        ("source".into(), tick.source.diagnostic_value().unwrap()),
                        (
                            "rawUtf16".into(),
                            JsValue::array(
                                original
                                    .units()
                                    .iter()
                                    .map(|unit| JsValue::Number(*unit as f64))
                                    .collect(),
                            ),
                        ),
                    ]);
                    ticks.borrow_mut().push(value);
                    if scenario["failAfter"]
                        .as_u64()
                        .is_some_and(|count| ticks.borrow().len() >= count as usize)
                    {
                        Err(())
                    } else {
                        Ok(())
                    }
                },
            ))
            .is_err(),
        };
        results.push(JsValue::object(vec![
            (
                "name".into(),
                JsValue::String(scenario["name"].as_str().unwrap().into()),
            ),
            ("ticks".into(), JsValue::array(ticks.into_inner())),
            ("failed".into(), JsValue::Bool(failed)),
        ]));
    }
    std::fs::write(
        std::env::var("PMB_RECORDED_OUTPUT").unwrap(),
        JsValue::array(results).to_json_string(),
    )
    .unwrap();
}

#[test]
fn ready_callback_and_metadata_only_frame_each_yield_before_advancing() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let raw = format!("[{},{}]", book("\"m\"", 1), book("\"m\"", 2));
    let future = replay_recorded(
        input(vec![row(raw, 1)], &actions),
        &graph,
        false,
        || false,
        async |_| {},
        async |_, _| {
            actions.borrow_mut().push("tick");
            Ok::<(), ()>(())
        },
    );
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["pop", "tick"]);
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["pop", "tick", "tick"]);
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["pop", "tick", "tick"]);
    assert!(matches!(
        future.as_mut().poll(&mut context),
        Poll::Ready(Ok(()))
    ));
    assert_eq!(
        *actions.borrow(),
        ["pop", "tick", "tick", "advance", "pop", "close"]
    );

    let actions = Rc::new(RefCell::new(Vec::new()));
    let raw = r#"{"event_type":"tick_size_change","market":"m","asset_id":"up","timestamp":"1","new_tick_size":"0.01","old_tick_size":"0.1"}"#;
    let future = replay_recorded(
        input(vec![row(raw, 1)], &actions),
        &graph,
        false,
        || false,
        async |_| {},
        async |_, _| Ok::<(), ()>(()),
    );
    let mut future = pin!(future);
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["pop"]);
    assert!(matches!(
        future.as_mut().poll(&mut context),
        Poll::Ready(Ok(()))
    ));
    assert_eq!(*actions.borrow(), ["pop", "advance", "pop", "close"]);
}
