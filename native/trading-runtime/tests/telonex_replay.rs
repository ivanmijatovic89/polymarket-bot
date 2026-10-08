use num_bigint::BigInt;
use parquet::record::{Field, Row};
use polymarket_runtime::{
    event_dispatch::Completion,
    market_json::JsValue,
    metadata::MetadataGraph,
    parquet_input::{InputError, ParquetInputData},
    telonex_replay::{replay_telonex, LocalTelonexInput, TelonexInput, TelonexMode},
};
use std::{
    cell::RefCell,
    collections::VecDeque,
    future::Future,
    pin::pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};

fn run<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    for _ in 0..10000 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
    panic!("test future did not complete");
}
struct Input {
    rows: VecDeque<ParquetInputData>,
    actions: Rc<RefCell<Vec<&'static str>>>,
    close_error: bool,
}
impl TelonexInput for Input {
    fn next_row(&mut self) -> Result<Option<ParquetInputData>, InputError> {
        self.actions.borrow_mut().push("read");
        Ok(self.rows.pop_front())
    }
    async fn close(&mut self) -> Result<(), InputError> {
        self.actions.borrow_mut().push("close");
        if self.close_error {
            Err(InputError("close failed".into()))
        } else {
            Ok(())
        }
    }
}
fn paired() -> ParquetInputData {
    ParquetInputData {
        physical: Row::new(vec![
            ("event_type".into(), Field::Str("orderbook_pair".into())),
            ("market".into(), Field::Str("m".into())),
            ("ts_exchange_ms".into(), Field::Long(1)),
            ("ingest_seq".into(), Field::Long(i64::MAX)),
            ("up_asset_id".into(), Field::Str("up".into())),
            ("down_asset_id".into(), Field::Str("down".into())),
            ("up_bids".into(), Field::Str("0.4@2".into())),
            ("down_bids".into(), Field::Str("0.3@4".into())),
        ]),
        undefined_columns: Vec::new(),
        logical_json: Vec::new(),
        logical_decimals: Vec::new(),
    }
}
#[test]
fn paired_books_are_atomic_and_await_before_another_read() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let input = Input {
        rows: vec![paired(), paired()].into(),
        actions: actions.clone(),
        close_error: false,
    };
    let (gate, resolver) = Completion::<()>::pending();
    let mut calls = 0;
    let future = replay_telonex(
        input,
        "fixture.parquet".into(),
        &graph,
        TelonexMode::Paired,
        || false,
        async |tick| {
            actions.borrow_mut().push("callback");
            calls += 1;
            let snapshot = tick.snapshot.trace_value();
            assert_eq!(snapshot["byAssetId"].as_object().unwrap().len(), 2);
            assert_eq!(tick.msg["asset_id"], "down");
            assert!(tick
                .source
                .diagnostic_value()
                .unwrap()
                .get("frameIndex")
                .is_none());
            assert_eq!(
                tick.source.diagnostic_value().unwrap()["ingestSeq"]
                    .as_str()
                    .unwrap(),
                (BigInt::from(i64::MAX) * BigInt::from(2) + BigInt::from(2)).to_string()
            );
            if calls == 1 {
                gate.clone().await;
            }
            Ok::<(), ()>(())
        },
    );
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["read"]);
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(*actions.borrow(), ["read", "callback"]);
    resolver.complete(());
    assert!(run(future).is_ok());
    assert_eq!(
        *actions.borrow(),
        ["read", "callback", "read", "callback", "read", "close"]
    );
}
#[test]
fn initial_stop_closes_without_priming() {
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let input = Input {
        rows: vec![paired()].into(),
        actions: actions.clone(),
        close_error: true,
    };
    assert!(run(replay_telonex(
        input,
        "fixture.parquet".into(),
        &graph,
        TelonexMode::Paired,
        || true,
        async |_| Ok::<(), ()>(())
    ))
    .is_ok());
    assert_eq!(*actions.borrow(), ["close"]);
}
#[test]
fn callback_failure_survives_close_rejection_without_next_read() {
    use polymarket_runtime::recorded_replay::ReplayError;
    let graph = MetadataGraph::new();
    let actions = Rc::new(RefCell::new(Vec::new()));
    let input = Input {
        rows: vec![paired(), paired()].into(),
        actions: actions.clone(),
        close_error: true,
    };
    let expected = Rc::new("original failure");
    let result = run(replay_telonex(
        input,
        "fixture.parquet".into(),
        &graph,
        TelonexMode::Paired,
        || false,
        async |_| Err::<(), _>(expected.clone()),
    ));
    let Err(ReplayError::Callback(actual)) = result else {
        panic!("callback error required");
    };
    assert!(Rc::ptr_eq(&actual, &expected));
    assert_eq!(*actions.borrow(), ["read", "close"]);
}
#[test]
#[ignore = "requires actual TS-produced Parquet fixture manifest"]
fn actual_telonex_replay_fixture_driver() {
    let cases: serde_json::Value = serde_json::from_slice(
        &std::fs::read(std::env::var("PMB_TELONEX_CASES").unwrap()).unwrap(),
    )
    .unwrap();
    let mut results = Vec::new();
    for scenario in cases.as_array().unwrap() {
        let graph = MetadataGraph::new();
        let ticks = RefCell::new(Vec::new());
        let path = scenario["filePath"].as_str().unwrap();
        let mode = if scenario["mode"] == "paired" {
            TelonexMode::Paired
        } else {
            TelonexMode::Delta
        };
        let failed = match LocalTelonexInput::open(path) {
            Err(_) => true,
            Ok(input) => run(replay_telonex(
                input,
                path.into(),
                &graph,
                mode,
                || {
                    scenario["stopAfter"]
                        .as_u64()
                        .is_some_and(|count| ticks.borrow().len() >= count as usize)
                },
                async |tick| {
                    ticks.borrow_mut().push(JsValue::object(vec![
                        ("snapshot".into(), tick.snapshot.trace_value()),
                        ("msg".into(), tick.msg.clone()),
                        ("source".into(), tick.source.diagnostic_value().unwrap()),
                        ("rawJson".into(), JsValue::String("".into())),
                    ]));
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
        std::env::var("PMB_TELONEX_OUTPUT").unwrap(),
        JsValue::array(results).to_json_string(),
    )
    .unwrap();
}
