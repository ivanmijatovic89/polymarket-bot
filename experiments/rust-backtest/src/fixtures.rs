//! Differential fixtures call the same local engine used by measured replay.
use crate::{
    context::{BookSnapshot, Metrics},
    engine::LocalEngine,
    portfolio::{n, s},
    stats,
    types::Book,
};
use serde_json::{json, Value};
pub fn run(input: &Value) -> Value {
    let mut results = Vec::new();
    for case in input["cases"].as_array().unwrap() {
        let market = s(case, "market").to_owned();
        let assets = [s(case, "upId").to_owned(), s(case, "downId").to_owned()];
        let mut engine = LocalEngine::new(
            n(case, "startingCapital"),
            market.clone(),
            assets.clone(),
            n(case, "latencyMs") as i64,
            n(case, "jitterMs") as i64,
            case["seed"].as_u64().unwrap_or(7) as u32,
        );
        engine.cancel_latency = case["cancelLatency"] != false;
        engine.touch = case["makerFillMode"] == "touch_or_better";
        engine.ledger.initialize(1000);
        let mut books = [Book::default(), Book::default()];
        let mut frames = Vec::new();
        for step in case["steps"].as_array().unwrap() {
            let now = n(step, "nowMs") as i64;
            for (i, key) in ["up", "down"].into_iter().enumerate() {
                if let Some(v) = step.get(key) {
                    let levels = |key: &str, buy: bool| {
                        let mut book = Book::default();
                        for level in v[key].as_array().unwrap() {
                            book.change(
                                buy,
                                level[0].as_f64().unwrap(),
                                level[1].as_f64().unwrap(),
                            );
                        }
                        if buy {
                            book.bids
                        } else {
                            book.asks
                        }
                    };
                    books[i] = Book {
                        exists: true,
                        ts: now,
                        bids: levels("bids", true),
                        asks: levels("asks", false),
                    };
                }
            }
            let snaps = std::array::from_fn(|i| BookSnapshot::new(&books[i], 10));
            let mut emitted = Vec::new();
            let mut actions = std::collections::VecDeque::new();
            if step["tick"] != false {
                actions.extend(engine.tick(now, &books));
            }
            if let Some(events) = step["events"].as_array() {
                actions.extend(events.clone());
            }
            let mut drain =
                |engine: &mut LocalEngine, actions: &mut std::collections::VecDeque<Value>| {
                    let mut count = 0;
                    let mut used_callbacks = std::collections::HashSet::new();
                    while let Some(e) = actions.pop_front() {
                        count += 1;
                        if count > 4200 {
                            actions.clear();
                            break;
                        }
                        engine.ledger.apply(&e);
                        engine.reconcile(&e);
                        let p = engine.decision_snapshot();
                        let metrics = Metrics::new(&engine.ledger, &assets, &snaps, 10);
                        emitted.push(json!({"event":e,"portfolio":p,"metrics":metrics.value()}));
                        if let Some(callbacks) = step["callbacks"].as_object() {
                            let kind = s(&e, "kind");
                            if let Some(next) = callbacks.get(kind) {
                                if used_callbacks.insert(kind.to_owned()) {
                                    actions.extend(engine.handle(
                                        next.as_array().unwrap().clone(),
                                        now,
                                        &books,
                                        case["mode"] == "queued",
                                    ));
                                }
                            }
                        }
                    }
                };
            drain(&mut engine, &mut actions);
            if let Some(intents) = step["intents"].as_array() {
                actions.extend(engine.handle(
                    intents.clone(),
                    now,
                    &books,
                    case["mode"] == "queued",
                ));
                drain(&mut engine, &mut actions);
            }
            let metrics = Metrics::new(&engine.ledger, &assets, &snaps, 10);
            frames.push(json!({"events":emitted,"portfolio":engine.ledger.snapshot(),"metrics":metrics.value()}));
        }
        let p = engine.ledger.snapshot().clone();
        let trades = engine
            .ledger
            .fills
            .iter()
            .map(|f| {
                let mut f = f.clone();
                if let Some(order) = engine.ledger.history.get(s(&f, "clientOrderId")) {
                    if let Some(meta) = order.get("meta") {
                        f["intentMeta"] = meta.clone();
                    }
                }
                f
            })
            .collect::<Vec<_>>();
        let splits = engine.ledger.splits.iter().cloned().collect::<Vec<_>>();
        let market_stats = stats::market(
            s(case, "name"),
            &market,
            &assets,
            s(case, "outcome"),
            &p,
            &trades,
            &splits,
        );
        results.push(json!({"name":case["name"],"frames":frames,"stats":market_stats}));
    }
    let mut aggregations = Vec::new();
    for case in input["aggregations"].as_array().unwrap() {
        let markets = case["markets"].as_array().unwrap();
        aggregations.push(json!({"name":case["name"],"batch":stats::batch(markets,n(case,"initialCapital")),"segments":stats::segments(markets,n(case,"initialCapital"))}));
    }
    let fixed = input["fixed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            json!(crate::strategy::fixed(
                v[0].as_f64().unwrap(),
                v[1].as_u64().unwrap() as u32
            ))
        })
        .collect::<Vec<_>>();
    json!({"results":results,"aggregations":aggregations,"fixed":fixed})
}
