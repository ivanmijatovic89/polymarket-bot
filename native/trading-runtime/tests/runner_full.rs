//! Actual shared Runner/OrderManager/Portfolio/PluginSet body fixture driver.
//! Providers, strategies and execution responses are scripted input edges only.
use polymarket_runtime::{
    event_dispatch::{BacklogWarning, Completion, CompletionResolver, DispatchReceipt, EntryLabel},
    intent::{ManagedIntent, ManagedIntents},
    js_async::{eager, js_await},
    metadata::{
        CallFrame, JsException, MetadataError, MetadataGraph, MetadataHandle, MetadataValue,
    },
    order_manager::{ExecutionAdapter, ExecutionOperation, OrderManager, OrderManagerContext},
    plugin_set::PluginSet,
    portfolio::PortfolioOptions,
    portfolio_records::{import_control_value, ManagedAccountEvent, PortfolioSnapshotRecord},
    runner::{
        DecisionOrigin, IntentMode, OwnedFuture, RecentEvent, Runner, RunnerCore, RunnerOptions,
        SharedPortfolio,
    },
    runner_bindings::{NativeRunnerBindings, RunnerHost},
    sdk_context::ContextHandle,
    sdk_snapshot::{MarketSnapshotHandle, TickHandle},
    sdk_value::JsMapKey,
};
use serde_json::{json, Map, Value};
use std::{
    cell::RefCell,
    collections::HashMap,
    rc::{Rc, Weak},
    sync::Arc,
    task::{Context, Wake, Waker},
};
thread_local! {static HOSTS:RefCell<HashMap<MetadataHandle,Weak<RefCell<State>>>>=RefCell::new(HashMap::new());}
type GatePair = (
    Completion<Result<(), JsException>>,
    CompletionResolver<Result<(), JsException>>,
);
type ReceiptEntry = (
    String,
    Option<DispatchReceipt<JsException>>,
    Option<JsException>,
);
#[derive(Clone)]
struct Host(Rc<RefCell<State>>);
struct State {
    graph: MetadataGraph,
    root: MetadataHandle,
    input: Value,
    input_graph: MetadataHandle,
    trace: Vec<Value>,
    ids: HashMap<MetadataHandle, usize>,
    id: usize,
    now: f64,
    market: MetadataValue,
    balance: MetadataValue,
    warmup: MetadataValue,
    generation: usize,
    players: HashMap<MetadataHandle, usize>,
    plugin_seen: HashMap<MetadataHandle, usize>,
    plugin_sets: HashMap<MetadataHandle, PluginSet>,
    market_calls: usize,
    account_calls: usize,
    execution_calls: usize,
    events: HashMap<String, ManagedAccountEvent>,
    errors: HashMap<String, JsException>,
    gates: HashMap<String, GatePair>,
    retained: MetadataHandle,
    retained_meta: MetadataHandle,
}
fn reference(v: MetadataValue) -> Result<MetadataHandle, JsException> {
    if let MetadataValue::Reference(h) = v {
        Ok(h)
    } else {
        Err(MetadataError::WrongKind.into())
    }
}

fn optional(value: &Value, name: &str) -> Option<f64> {
    value.get(name).and_then(Value::as_f64)
}
impl Host {
    fn new(input: &Value) -> Self {
        let graph = MetadataGraph::new();
        polymarket_runtime::sdk_intrinsics::ensure_object_prototype(&graph).unwrap();
        let root = graph.object().unwrap();
        let input_graph = reference(import_control_value(&graph, input).unwrap()).unwrap();
        let retained = graph.array().unwrap();
        let retained_meta = graph.array().unwrap();
        let host = Self(Rc::new(RefCell::new(State {
            graph: graph.clone(),
            root: root.clone(),
            input: input.clone(),
            input_graph: input_graph.clone(),
            trace: vec![],
            ids: HashMap::new(),
            id: 0,
            now: optional(input, "nowMs").unwrap_or(12345.0),
            market: input_graph.get("market").unwrap(),
            balance: input_graph.get("balance").unwrap(),
            warmup: input_graph.get("warmup").unwrap(),
            generation: 0,
            players: HashMap::new(),
            plugin_seen: HashMap::new(),
            plugin_sets: HashMap::new(),
            market_calls: 0,
            account_calls: 0,
            execution_calls: 0,
            events: HashMap::new(),
            errors: HashMap::new(),
            gates: HashMap::new(),
            retained,
            retained_meta,
        })));
        HOSTS.with(|all| all.borrow_mut().insert(root, Rc::downgrade(&host.0)));
        host
    }
    fn trace(&self, row: Value) {
        self.0.borrow_mut().trace.push(row)
    }
    fn graph(&self) -> MetadataGraph {
        self.0.borrow().graph.clone()
    }
    fn import(&self, value: &Value) -> MetadataValue {
        import_control_value(&self.graph(), value).unwrap()
    }
    fn object(
        &self,
        fields: impl IntoIterator<Item = (&'static str, MetadataValue)>,
    ) -> MetadataHandle {
        let h = self.graph().object().unwrap();
        for (k, v) in fields {
            h.set(k, v).unwrap()
        }
        h
    }
    fn id(&self, value: &MetadataValue) -> Value {
        match value {
            MetadataValue::Reference(h) => {
                let mut s = self.0.borrow_mut();
                let id = if let Some(id) = s.ids.get(h) {
                    *id
                } else {
                    s.id += 1;
                    let id = s.id;
                    s.ids.insert(h.clone(), id);
                    id
                };
                json!(id)
            }
            _ => self.copy(value).unwrap_or(Value::Null),
        }
    }
    fn copy(&self, value: &MetadataValue) -> Option<Value> {
        fn visit(value: &MetadataValue, active: &mut Vec<MetadataHandle>) -> Option<Value> {
            Some(match value {
                MetadataValue::Missing => return None,
                MetadataValue::Null => Value::Null,
                MetadataValue::Bool(n) => json!(n),
                MetadataValue::Number(n) => {
                    if *n == 0.0 {
                        json!(0)
                    } else {
                        json!(n)
                    }
                }
                MetadataValue::BigInt(n) => json!({"$bigint":n.to_string()}),
                MetadataValue::String(s) => json!(String::from_utf16_lossy(&s.units())),
                MetadataValue::Reference(h) => {
                    assert!(
                        !active.contains(h),
                        "fixture diagnostics require acyclic graph"
                    );
                    active.push(h.clone());
                    let result = if h.is_array() {
                        let mut out = vec![];
                        for i in 0..h.length().unwrap() {
                            out.push(
                                visit(&h.get_index(i).unwrap(), active).unwrap_or(Value::Null),
                            );
                        }
                        Value::Array(out)
                    } else {
                        let mut out = Map::new();
                        for key in h.own_property_keys().unwrap() {
                            if !h
                                .own_descriptor(key.clone())
                                .unwrap()
                                .is_some_and(|d| d.enumerable())
                            {
                                continue;
                            }
                            if let Some(value) =
                                visit(&h.get_property(key.clone()).unwrap(), active)
                            {
                                out.insert(String::from_utf16_lossy(&key.units()), value);
                            }
                        }
                        Value::Object(out)
                    };
                    active.pop();
                    result
                }
            })
        }
        visit(value, &mut Vec::new())
    }
    fn bits(&self, value: &MetadataValue) -> Value {
        let mut out = Map::new();
        let mut active = Vec::new();
        fn visit(
            v: &MetadataValue,
            p: String,
            out: &mut Map<String, Value>,
            active: &mut Vec<MetadataHandle>,
        ) {
            match v {
                MetadataValue::Number(n) => {
                    out.insert(p, json!(format!("{:016x}", n.to_bits())));
                }
                MetadataValue::Reference(h) if !active.contains(h) => {
                    active.push(h.clone());
                    for key in h.own_property_keys().unwrap() {
                        if !h
                            .own_descriptor(key.clone())
                            .unwrap()
                            .is_some_and(|d| d.enumerable())
                        {
                            continue;
                        }
                        let keytext = String::from_utf16_lossy(&key.units())
                            .replace('~', "~0")
                            .replace('/', "~1");
                        visit(
                            &h.get_property(key).unwrap(),
                            format!("{p}/{keytext}"),
                            out,
                            active,
                        );
                    }
                    active.pop();
                }
                _ => {}
            }
        }
        visit(value, String::new(), &mut out, &mut active);
        Value::Object(out)
    }
    fn plan(&self, origin: &str) -> Value {
        let mut s = self.0.borrow_mut();
        let n = match origin {
            "market" => {
                let n = s.market_calls;
                s.market_calls += 1;
                n
            }
            "account" => {
                let n = s.account_calls;
                s.account_calls += 1;
                n
            }
            _ => {
                let n = s.execution_calls;
                s.execution_calls += 1;
                n
            }
        };
        s.input
            .get(format!("{origin}Plans"))
            .and_then(|a| a.get(n))
            .cloned()
            .unwrap_or(json!({}))
    }
    fn gate(&self, name: &str) -> Completion<Result<(), JsException>> {
        let mut s = self.0.borrow_mut();
        s.gates
            .entry(name.into())
            .or_insert_with(Completion::pending)
            .0
            .clone()
    }
    fn fail(&self, plan: &Value) -> Result<(), JsException> {
        if let Some(id) = plan.get("errorId").and_then(Value::as_str) {
            return Err(self.0.borrow().errors[id].clone());
        }
        if let Some(error) = plan.get("error") {
            return Err(self.error_named(
                error.get("name").and_then(Value::as_str).unwrap_or("Error"),
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("fixture error"),
            ));
        }
        Ok(())
    }
    fn error_view(&self, error: &JsException) -> Value {
        match error {
            JsException::Thrown(v) => {
                let h = reference(v.clone()).unwrap();
                json!({"name":self.copy(&h.get("name").unwrap()),"message":self.copy(&h.get("message").unwrap()),"errorId":self.id(v)})
            }
            JsException::Native(e) => json!({"name":"Error","message":e.to_string()}),
        }
    }
    fn observe(&self, kind: &str, args: Vec<MetadataValue>) {
        let array = self.graph().array().unwrap();
        let ids = args.iter().map(|v| self.id(v)).collect::<Vec<_>>();
        for v in args {
            array.push(v).unwrap()
        }
        let value = MetadataValue::Reference(array);
        self.trace(
            json!({"kind":kind,"args":self.copy(&value),"ids":ids,"numberBits":self.bits(&value)}),
        );
    }
    fn make_strategy(&self) -> MetadataHandle {
        let (player, required) = {
            let mut s = self.0.borrow_mut();
            s.generation += 1;
            (s.generation, s.input_graph.get("requiredFeeds").unwrap())
        };
        self.trace(json!({"kind":"createStrategy","player":player}));
        let strategy = self.object([("name", "fixture".into())]);
        if !matches!(required, MetadataValue::Missing) {
            strategy.set("requiredFeeds", required).unwrap()
        }
        self.0.borrow_mut().players.insert(strategy.clone(), player);
        strategy
    }
    fn make_plugins(&self) -> Result<Option<PluginSet>, JsException> {
        if !self
            .0
            .borrow()
            .input
            .get("plugins")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(None);
        }
        let set = PluginSet::new(&self.graph())?;
        let root = self.0.borrow().root.clone();
        let plugin = self.object([
            ("id", "fixture".into()),
            (
                "handlesSyntheticTicks",
                MetadataValue::Bool(
                    self.0
                        .borrow()
                        .input
                        .get("pluginSynthetic")
                        .and_then(Value::as_bool)
                        == Some(true),
                ),
            ),
        ]);
        self.0.borrow_mut().plugin_seen.insert(plugin.clone(), 0);
        for (name, callback) in [
            (
                "captureMarketTick",
                plugin_capture as polymarket_runtime::metadata::NativeCallback,
            ),
            ("onMarketTick", plugin_tick),
            ("snapshot", plugin_snapshot),
            ("reset", plugin_reset),
        ] {
            plugin.set(
                name,
                self.graph()
                    .function(callback, vec![root.clone().into(), plugin.clone().into()])?
                    .into(),
            )?;
        }
        set.register(plugin.into())?;
        self.0
            .borrow_mut()
            .plugin_sets
            .insert(set.as_handle().clone(), set.clone());
        Ok(Some(set))
    }
    fn strategy(
        &self,
        strategy: &MetadataHandle,
        tick: Option<TickHandle>,
        event: Option<ManagedAccountEvent>,
        portfolio: PortfolioSnapshotRecord,
        books: Option<MarketSnapshotHandle>,
        ctx: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException> {
        let host = self.clone();
        let strategy = strategy.clone();
        Box::pin(eager(async move {
            let ismarket = tick.is_some();
            let plan = host.plan(if ismarket { "market" } else { "account" });
            let player = host.0.borrow().players[&strategy];
            let pf = MetadataValue::Reference(portfolio.handle().as_handle().clone());
            let market = books.map(|h| h.value()).unwrap_or(MetadataValue::Missing);
            let context = ctx.map(|h| h.value()).unwrap_or(MetadataValue::Missing);
            let mut row = Map::new();
            row.insert(
                "kind".into(),
                json!(if ismarket {
                    "strategyMarket"
                } else {
                    "strategyAccount"
                }),
            );
            row.insert("player".into(), json!(player));
            let retained = host.graph().object()?;
            if let Some(tick) = tick {
                row.insert("tickId".into(), host.id(&tick.value()));
                row.insert("sourceId".into(), host.id(&tick.source()?));
                retained.set("tick", tick.value())?;
            }
            if let Some(event) = event {
                row.insert("eventId".into(), host.id(&event.envelope().clone().into()));
                row.insert(
                    "event".into(),
                    host.copy(&event.envelope().clone().into()).unwrap(),
                );
                retained.set("event", event.envelope().clone().into())?;
            }
            row.insert("portfolioId".into(), host.id(&pf));
            if !matches!(market, MetadataValue::Missing) {
                row.insert("marketId".into(), host.id(&market));
            }
            if !matches!(context, MetadataValue::Missing) {
                row.insert("contextId".into(), host.id(&context));
            }
            row.insert("portfolio".into(), host.copy(&pf).unwrap());
            if let Some(ctx) = host.copy(&context) {
                row.insert("context".into(), ctx);
            }
            row.insert("portfolioNumberBits".into(), host.bits(&pf));
            row.insert("contextNumberBits".into(), host.bits(&context));
            host.trace(Value::Object(row));
            retained.set("portfolio", pf)?;
            if !ismarket {
                retained.set("books", market)?;
            }
            retained.set("ctx", context)?;
            retained.set("player", (player as f64).into())?;
            host.0.borrow().retained.push(retained.into())?;
            if let Some(name) = plan.get("gate").and_then(Value::as_str) {
                js_await(host.gate(name)).await?;
            }
            host.fail(&plan)?;
            let intents = reference(host.import(plan.get("intents").unwrap_or(&json!([]))))?;
            Ok(Some(ManagedIntents::from_handle(intents)?))
        }))
    }
}
fn callback_host(frame: &CallFrame) -> Host {
    let h = reference(frame.captures[0].clone()).unwrap();
    Host(HOSTS.with(|all| all.borrow()[&h].upgrade().unwrap()))
}
fn plugin_capture(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let host = callback_host(frame);
    let plugin = reference(frame.captures[1].clone())?;
    let tick = TickHandle::from_value(&host.graph(), frame.arguments[0].clone())?;
    let seen = host.0.borrow().plugin_seen[&plugin];
    let generation = host.0.borrow().generation;
    host.trace(json!({"kind":"capture","tickId":host.id(&tick.value()),"sourceId":host.id(&tick.source()?),"generation":generation}));
    if host
        .0
        .borrow()
        .input
        .get("captureErrorAt")
        .and_then(Value::as_u64)
        == Some(seen as u64)
    {
        return Err(host.error("capture failed"));
    }
    Ok(MetadataValue::Missing)
}
fn plugin_tick(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let host = callback_host(frame);
    let plugin = reference(frame.captures[1].clone())?;
    *host.0.borrow_mut().plugin_seen.get_mut(&plugin).unwrap() += 1;
    let mut row = json!({"kind":"pluginTick","tickId":host.id(&frame.arguments[0]),"generation":host.0.borrow().generation});
    if let Some(ctx) = frame.arguments.get(1).and_then(|v| host.copy(v)) {
        row["context"] = ctx;
    }
    host.trace(row);
    Ok(MetadataValue::Missing)
}
fn plugin_snapshot(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let host = callback_host(frame);
    let plugin = reference(frame.captures[1].clone())?;
    let (seen, generation) = {
        let s = host.0.borrow();
        (s.plugin_seen[&plugin], s.generation)
    };
    host.trace(json!({"kind":"pluginSnapshot","generation":generation}));
    Ok(host
        .object([
            ("generation", (generation as f64).into()),
            ("seen", (seen as f64).into()),
        ])
        .into())
}
fn plugin_reset(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let host = callback_host(frame);
    let plugin = reference(frame.captures[1].clone())?;
    let generation = host.0.borrow().generation;
    host.trace(json!({"kind":"pluginReset","generation":generation}));
    host.0.borrow_mut().plugin_seen.insert(plugin, 0);
    Ok(MetadataValue::Missing)
}

impl RunnerHost for Host {
    type PluginSet = PluginSet;
    fn graph(&self) -> MetadataGraph {
        self.graph()
    }
    fn error(&self, message: &str) -> JsException {
        self.error_named("Error", message)
    }
    fn error_named(&self, name: &str, message: &str) -> JsException {
        JsException::Thrown(
            self.object([("name", name.into()), ("message", message.into())])
                .into(),
        )
    }
    fn now(&self) -> f64 {
        let now = self.0.borrow().now;
        self.trace(json!({"kind":"clock","now":now}));
        now
    }
    fn sleep(&self, ms: f64) -> OwnedFuture<(), JsException> {
        let host = self.clone();
        Box::pin(eager(async move {
            host.0.borrow_mut().now += ms;
            Ok(())
        }))
    }
    fn resolve_max_events(&self, override_value: Option<f64>) -> Result<usize, JsException> {
        let n = override_value.unwrap_or(4200.0);
        if !n.is_finite() || n.fract() != 0.0 || !(1.0..=9_007_199_254_740_991.0).contains(&n) {
            Err(self.error("MAX_EVENTS_PER_DRAIN must be a positive safe integer"))
        } else {
            Ok(n as usize)
        }
    }
    fn get_market(&self) -> Result<Option<MetadataValue>, JsException> {
        self.trace(json!({"kind":"provider","name":"market"}));
        let v = self.0.borrow().market.clone();
        Ok(if matches!(v, MetadataValue::Missing) {
            None
        } else {
            Some(v)
        })
    }
    fn get_balance(&self) -> Result<Option<MetadataValue>, JsException> {
        self.trace(json!({"kind":"provider","name":"balance"}));
        let v = self.0.borrow().balance.clone();
        Ok(if matches!(v, MetadataValue::Missing) {
            None
        } else {
            Some(v)
        })
    }
    fn get_warmup(&self) -> Result<Option<MetadataValue>, JsException> {
        self.trace(json!({"kind":"provider","name":"warmup"}));
        let v = self.0.borrow().warmup.clone();
        Ok(if matches!(v, MetadataValue::Missing) {
            None
        } else {
            Some(v)
        })
    }
    fn can_create_strategy(&self) -> bool {
        self.0
            .borrow()
            .input
            .get("createStrategy")
            .and_then(Value::as_bool)
            != Some(false)
    }
    fn create_strategy(&self) -> Result<MetadataHandle, JsException> {
        let strategy = self.make_strategy();
        let set = self.make_plugins()?;
        let built = self.object([("strategy", strategy.into())]);
        if let Some(set) = set {
            built.set("pluginSet", set.as_handle().clone().into())?;
        }
        Ok(built)
    }
    fn built_strategy(&self, built: &MetadataHandle) -> Result<MetadataHandle, JsException> {
        reference(built.get_property("strategy")?)
    }
    fn built_plugin_set(
        &self,
        built: &MetadataHandle,
    ) -> Result<Option<Self::PluginSet>, JsException> {
        let value = built.get_property("pluginSet")?;
        Ok(if let MetadataValue::Reference(h) = value {
            Some(self.0.borrow().plugin_sets[&h].clone())
        } else {
            None
        })
    }
    fn built_has_plugins(&self, _built: &MetadataHandle) -> Result<bool, JsException> {
        Ok(false)
    }
    fn new_plugin_set(&self) -> Result<Self::PluginSet, JsException> {
        Ok(PluginSet::new(&self.graph())?)
    }
    fn register_built_plugins(
        &self,
        set: &Self::PluginSet,
        built: &MetadataHandle,
    ) -> Result<(), JsException> {
        let plugins = reference(built.get_property("plugins")?)?;
        for i in 0..plugins.length()? {
            set.register(plugins.get_property(i.to_string())?)?;
        }
        Ok(())
    }
    fn reset_plugins(&self, plugins: &Self::PluginSet) -> Result<(), JsException> {
        plugins.reset()
    }
    fn capture_tick(
        &self,
        plugins: &Self::PluginSet,
        tick: &TickHandle,
    ) -> Result<(), JsException> {
        plugins.capture_market_tick(tick)
    }
    fn update_plugins(
        &self,
        plugins: &Self::PluginSet,
        tick: &TickHandle,
        context: Option<ContextHandle>,
    ) -> Result<(), JsException> {
        plugins.on_market_tick(tick, context.as_ref())
    }
    fn plugins_snapshot(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<MetadataValue>, JsException> {
        Ok(Some(plugins.snapshot()?))
    }
    fn refresh_plugins(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<MetadataValue>, JsException> {
        Ok(Some(plugins.refresh_snapshot()?))
    }
    fn technical_indicators_ready(
        &self,
        _plugins: Option<&MetadataValue>,
    ) -> Result<bool, JsException> {
        Ok(true)
    }
    fn wait_for_technical_indicators(&self) -> bool {
        false
    }
    fn technical_timeout(&self) -> f64 {
        60000.0
    }
    fn technical_poll(&self) -> f64 {
        250.0
    }
    fn warn_technical_timeout(&self, market: &JsMapKey, timeout: f64) -> Result<(), JsException> {
        self.trace(json!({"kind":"runnerLog","message":"[runner] timed out waiting for technical indicators","extra":{"market":self.copy(&market.value()),"timeoutMs":timeout}}));
        Ok(())
    }
    fn parse_market_start(
        &self,
        market: Option<&MetadataValue>,
    ) -> Result<Option<f64>, JsException> {
        if let Some(m) = market {
            let m = reference(m.clone())?;
            let value = m.get_property("eventStartTime")?;
            if matches!(value,MetadataValue::String(s) if s.matches("1970-01-01T00:00:00.000Z")) {
                return Ok(Some(0.0));
            }
        }
        Ok(None)
    }
    fn log_late_start(
        &self,
        market: Option<&MetadataValue>,
        elapsed: f64,
        maximum: f64,
    ) -> Result<(), JsException> {
        let slug = if let Some(m) = market {
            reference(m.clone())?.get_property("slug")?
        } else {
            MetadataValue::Missing
        };
        let slug = if matches!(slug, MetadataValue::String(_)) {
            self.copy(&slug).unwrap()
        } else {
            json!("unknown")
        };
        self.trace(json!({"kind":"console","level":"log","args":["[skip-market-if-bot-started-too-late][⛔] bot started too late; skipping market",{"marketSlug":slug,"marketTimeElapsedSec":(elapsed/1000.0).floor(),"maxMarketTimeElapsedSec":(maximum/1000.0).floor()}]}));
        Ok(())
    }

    fn log_intents(&self, intents: &ManagedIntents, mode: IntentMode) -> Result<(), JsException> {
        let values = self.copy(&intents.handle().clone().into()).unwrap();
        let sample = values
            .as_array()
            .unwrap()
            .iter()
            .take(20)
            .map(|i| {
                let mut row = Map::new();
                let kind = i["kind"].as_str().unwrap();
                let keys = match kind {
                    "place_limit" => vec![
                        "kind",
                        "clientOrderId",
                        "assetId",
                        "side",
                        "price",
                        "size",
                        "orderType",
                        "postOnly",
                    ],
                    "cancel_batch" => vec!["kind", "orders"],
                    "cancel_order" => vec!["kind", "clientOrderId", "orderId"],
                    _ => vec!["kind", "assetIdA", "assetIdB", "size", "costPerShare"],
                };
                for key in keys {
                    if let Some(v) = i.get(key) {
                        row.insert(key.into(), v.clone());
                    }
                }
                if let Some(v) = i.get("reason") {
                    row.insert("reason".into(), v.clone());
                }
                Value::Object(row)
            })
            .collect::<Vec<_>>();
        self.trace(json!({"kind":"intentLog","message":"[intent] batch","extra":{"count":intents.length()?,"sample":sample,"executionMode":if mode==IntentMode::Queued{"queued"}else{"immediate"}}}));
        Ok(())
    }
    fn strategy_tick(
        &self,
        strategy: &MetadataHandle,
        tick: TickHandle,
        portfolio: PortfolioSnapshotRecord,
        context: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException> {
        let books = tick.snapshot().unwrap();
        self.strategy(strategy, Some(tick), None, portfolio, Some(books), context)
    }
    fn strategy_account(
        &self,
        strategy: &MetadataHandle,
        event: ManagedAccountEvent,
        portfolio: PortfolioSnapshotRecord,
        market: Option<MarketSnapshotHandle>,
        context: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException> {
        self.strategy(strategy, None, Some(event), portfolio, market, context)
    }
    fn observe_context(&self, context: Option<&ContextHandle>) -> Result<(), JsException> {
        self.observe(
            "onContext",
            vec![context
                .map(ContextHandle::value)
                .unwrap_or(MetadataValue::Missing)],
        );
        Ok(())
    }
    fn observe_capital(&self, portfolio: &PortfolioSnapshotRecord) -> Result<(), JsException> {
        self.observe(
            "onCapital",
            vec![portfolio.handle().as_handle().get_property("capital")?],
        );
        Ok(())
    }
    fn observes_capital(&self) -> bool {
        true
    }
    fn observe_decision(
        &self,
        origin: DecisionOrigin,
        intents: Option<&ManagedIntents>,
    ) -> Result<(), JsException> {
        self.observe(
            "onDecision",
            vec![
                if origin == DecisionOrigin::Market {
                    "market".into()
                } else {
                    "account".into()
                },
                intents
                    .map(|i| i.handle().clone().into())
                    .unwrap_or(MetadataValue::Missing),
            ],
        );
        Ok(())
    }
    fn observe_account(
        &self,
        event: &ManagedAccountEvent,
        portfolio: &PortfolioSnapshotRecord,
    ) -> Result<(), JsException> {
        self.observe(
            "onAccountEvent",
            vec![
                event.envelope().clone().into(),
                portfolio.handle().as_handle().clone().into(),
            ],
        );
        Ok(())
    }
    fn log_fill(
        &self,
        event: &ManagedAccountEvent,
        details: MetadataValue,
    ) -> Result<(), JsException> {
        let fill = reference(event.envelope().get_property("fill")?)?;
        let copied = self.object([]);
        for key in fill.own_property_keys()? {
            if fill
                .own_descriptor(key.clone())?
                .is_some_and(|d| d.enumerable())
            {
                copied.set(key.clone(), fill.get_property(key)?)?;
            }
        }
        let additions = reference(details)?;
        for key in additions.own_property_keys()? {
            copied.set(key.clone(), additions.get_property(key)?)?;
        }
        self.trace(
            json!({"kind":"runnerLog","message":"[trade]","extra":self.copy(&copied.into())}),
        );
        Ok(())
    }
    fn log_cancel_failed(&self, event: &ManagedAccountEvent) -> Result<(), JsException> {
        self.trace(json!({"kind":"runnerLog","message":"[cancel_failed]","extra":self.copy(&event.envelope().clone().into())}));
        Ok(())
    }
    fn log_drain_limit(
        &self,
        maximum: usize,
        remaining: usize,
        recent: &[RecentEvent<JsMapKey>],
    ) -> Result<(), JsException> {
        let recent = recent
            .iter()
            .map(|e| {
                let mut row = json!({"kind":self.copy(&e.kind.value())});
                if let Some(time) = e.outer_timestamp_ms {
                    row["tsMs"] = json!(time);
                }
                row
            })
            .collect::<Vec<_>>();
        self.trace(json!({"kind":"runnerLog","message":"[runner] maxEventsPerDrain exceeded; halting drain and dropping queued events","extra":{"maxEventsPerDrain":maximum,"remaining":remaining,"recent":recent}}));
        Ok(())
    }
    fn serial_warning(&self, warning: BacklogWarning) {
        self.trace(json!({"kind":"console","level":"warn","args":["[runner] serial dispatch backlog is growing",{"depth":warning.depth,"entry":if warning.entry==EntryLabel::Tick{"tick"}else{"account"}}]}))
    }
    fn serial_failure(&self, label: EntryLabel, error: &JsException) {
        self.trace(json!({"kind":"console","level":"error","args":[format!("[runner] {} entry failed:",if label==EntryLabel::Tick{"tick"}else{"account"}),self.error_view(error)]}))
    }
    fn strategy_id(&self) -> MetadataValue {
        self.0.borrow().input_graph.get("strategyId").unwrap()
    }
    fn strategy_params(&self) -> MetadataValue {
        self.0.borrow().input_graph.get("strategyParams").unwrap()
    }
    fn enabled_external_feeds(&self) -> MetadataValue {
        self.0
            .borrow()
            .input_graph
            .get("externalFeedsEnabled")
            .unwrap()
    }
    fn plugin_ids(&self, set: &Self::PluginSet) -> Result<MetadataHandle, JsException> {
        let values = set.list_ids()?;
        let array = self.graph().array()?;
        for value in values {
            array.push(value)?;
        }
        Ok(array)
    }
}
impl Host {
    fn execution(
        &self,
        method: &str,
        intent: Option<ManagedIntent>,
        ctx: OrderManagerContext<MarketSnapshotHandle>,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, JsException> {
        let host = self.clone();
        let method = method.to_owned();
        Box::pin(eager(async move {
            let plan = host.plan("execution");
            let root = host.object([("nowMs", ctx.now_ms.into())]);
            if let Some(m) = &ctx.last_market {
                root.set("lastMarket", m.value())?;
            }
            if let Some(p) = &ctx.portfolio {
                root.set("portfolio", p.handle().as_handle().clone().into())?;
            }
            let mut args = vec![];
            if let Some(intent) = intent {
                args.push(host.copy(&intent.handle().clone().into()).unwrap());
            }
            args.push(host.copy(&root.into()).unwrap());
            let mut row = json!({"kind":"execution","method":method,"args":args});
            if let Some(p) = &ctx.portfolio {
                row["portfolioId"] = host.id(&p.handle().as_handle().clone().into());
            }
            if let Some(m) = &ctx.last_market {
                row["marketId"] = host.id(&m.value());
            }
            host.trace(row);
            if let Some(name) = plan.get("gate").and_then(Value::as_str) {
                js_await(host.gate(name)).await?;
            }
            host.fail(&plan)?;
            Ok(plan
                .get("eventIds")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .map(|id| host.0.borrow().events[id.as_str().unwrap()].clone())
                        .collect()
                })
                .unwrap_or_default())
        }))
    }
}
impl ExecutionAdapter for Host {
    type MarketSnapshot = MarketSnapshotHandle;
    type Error = JsException;
    fn execute(
        &self,
        operation: ExecutionOperation,
        intent: ManagedIntent,
        context: OrderManagerContext<MarketSnapshotHandle>,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, JsException> {
        self.execution(
            match operation {
                ExecutionOperation::PlaceLimit => "placeLimit",
                ExecutionOperation::PlaceBatch => "placeBatch",
                ExecutionOperation::CancelOrder => "cancelOrder",
                ExecutionOperation::CancelAll => "cancelAll",
                ExecutionOperation::CancelBatch => "cancelBatch",
                ExecutionOperation::CancelMarket => "cancelMarket",
                ExecutionOperation::MergePositions => "mergePositions",
                ExecutionOperation::SplitPositions => "splitPositions",
            },
            Some(intent),
            context,
        )
    }
    fn on_market_tick(
        &self,
        context: OrderManagerContext<MarketSnapshotHandle>,
    ) -> Option<OwnedFuture<Vec<ManagedAccountEvent>, JsException>> {
        Some(self.execution("onMarketTick", None, context))
    }
    fn market_identity(&self, market: &MarketSnapshotHandle) -> Result<MetadataValue, JsException> {
        market.market()
    }
    fn js_exception(&self, error: JsException) -> JsException {
        error
    }
    fn log(&self, message: &str, extra: Option<MetadataValue>) -> Result<(), JsException> {
        let mut row = json!({"kind":"managerLog","message":message});
        if let Some(extra) = extra.and_then(|v| self.copy(&v)) {
            row["extra"] = extra;
        }
        self.trace(row);
        Ok(())
    }
}
struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}
type NativeRunner = Runner<NativeRunnerBindings<Host, Host>>;
fn receipt_rows(host: &Host, receipts: &[ReceiptEntry]) -> Value {
    let mut out = Map::new();
    for (name, receipt, capture) in receipts {
        let row = if let Some(error) = capture {
            json!({"status":"capture_rejected","error":host.error_view(error)})
        } else {
            match receipt.as_ref().unwrap().result() {
                None => json!({"status":"pending"}),
                Some(Ok(())) => json!({"status":"fulfilled"}),
                Some(Err(error)) => json!({"status":"rejected","error":host.error_view(&error)}),
            }
        };
        out.insert(name.clone(), row);
    }
    Value::Object(out)
}
fn final_view(host: &Host, runner: &NativeRunner, receipts: &[ReceiptEntry]) -> Value {
    let pf = runner.portfolio().snapshot().unwrap();
    let retained = host.0.borrow().retained.clone();
    let mut result = json!({"receipts":receipt_rows(host,receipts),"portfolio":host.copy(&pf.handle().as_handle().clone().into()),"retained":host.copy(&retained.clone().into()),"retainedNumberBits":host.bits(&retained.into())});
    if let Some(m) = runner.last_market() {
        result["market"] = host.copy(&m.value()).unwrap();
    }
    result
}
fn run(input: &Value) -> Value {
    let host = Host::new(input);
    let outcome = (|| -> Result<Value, JsException> {
        let plugins = host.make_plugins()?;
        let initial_plugins = plugins.clone();
        let strategy = host.make_strategy();
        let manager = OrderManager::new_in_graph(
            &host.graph(),
            host.clone(),
            input
                .get("dryRun")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            None,
        );
        let portfolio = if let Some(options) = input.get("portfolio") {
            Some(
                SharedPortfolio::new_in_graph(
                    &host.graph(),
                    PortfolioOptions {
                        starting_capital: optional(options, "startingCapital").unwrap_or(500.0),
                        max_recent_fills: optional(options, "maxRecentFills").unwrap_or(500.0),
                    },
                    host.now(),
                )
                .map_err(|e| host.error(e))?,
            )
        } else {
            None
        };
        let core = RunnerCore::new(
            NativeRunnerBindings {
                host: host.clone(),
                order_manager: manager,
            },
            RunnerOptions {
                strategy,
                portfolio,
                plugins,
                starting_capital: optional(input, "startingCapital"),
                intent_mode: if input.get("intentExecutionMode").and_then(Value::as_str)
                    == Some("immediate")
                {
                    IntentMode::Immediate
                } else {
                    IntentMode::Queued
                },
                max_events_per_drain: optional(input, "maxEventsPerDrain"),
                skip_late_start_after_ms: optional(input, "skipLateStartAfterMs"),
            },
        )?;
        let mut runner = Runner::new(core);
        let mut ticks = HashMap::new();
        let mut receipts = vec![];
        let waker = Waker::from(Arc::new(Noop));
        let mut cx = Context::from_waker(&waker);
        for op in input["operations"].as_array().unwrap() {
            let id = op.get("id").and_then(Value::as_str).unwrap_or("");
            match op["kind"].as_str().unwrap() {
                "error" => {
                    let error = host.error_named(
                        op.get("name").and_then(Value::as_str).unwrap_or("Error"),
                        op["message"].as_str().unwrap(),
                    );
                    host.0.borrow_mut().errors.insert(id.to_owned(), error);
                }
                "tick" => {
                    let handle = reference(host.import(&op["tick"]))?;
                    let tick = TickHandle::from_handle(&host.graph(), handle)?;
                    ticks.insert(id.to_owned(), tick);
                }
                "event" => {
                    let event = fixture_event(&host.graph(), &op["event"]);
                    host.0.borrow_mut().events.insert(id.to_owned(), event);
                }
                "now" => host.0.borrow_mut().now = op["nowMs"].as_f64().unwrap(),
                "providers" => {
                    let market = op
                        .get("market")
                        .map(|v| host.import(v))
                        .unwrap_or(MetadataValue::Missing);
                    let balance = op
                        .get("balance")
                        .map(|v| host.import(v))
                        .unwrap_or(MetadataValue::Missing);
                    let warmup = op
                        .get("warmup")
                        .map(|v| host.import(v))
                        .unwrap_or(MetadataValue::Missing);
                    let mut s = host.0.borrow_mut();
                    s.market = market;
                    s.balance = balance;
                    s.warmup = warmup;
                }
                "mutateTick" => {
                    let snapshot = ticks[id].snapshot()?;
                    for (k, v) in op["fields"].as_object().unwrap() {
                        snapshot
                            .as_handle()
                            .set_property(k.as_str(), host.import(v))?;
                    }
                }
                "mutateEvent" => {
                    let event = host.0.borrow().events[id].clone();
                    for (k, v) in op["fields"].as_object().unwrap() {
                        event.envelope().set_property(k.as_str(), host.import(v))?;
                    }
                }
                "release" => {
                    let name = op["gate"].as_str().unwrap();
                    host.gate(name);
                    host.0.borrow().gates[name].1.complete(Ok(()));
                }
                "pump" => {
                    for _ in 0..op.get("turns").and_then(Value::as_u64).unwrap_or(20) {
                        let _ = runner.poll_ready(&mut cx);
                    }
                }
                "submitTick" => {
                    let name = op["receipt"].as_str().unwrap().to_owned();
                    match runner.submit_tick(ticks[id].clone()) {
                        Ok(receipt) => receipts.push((name, Some(receipt), None)),
                        Err(error) => receipts.push((name, None, Some(error))),
                    }
                }
                "submitAccount" => {
                    let event = host.0.borrow().events[id].clone();
                    receipts.push((
                        op["receipt"].as_str().unwrap().to_owned(),
                        Some(runner.submit_account(event)),
                        None,
                    ));
                }
                "pluginCacheOverride" => {
                    let value = host.import(&op["value"]);
                    let get = host.graph().function(fixture_cached_get, vec![value])?;
                    let set = host.graph().function(fixture_cached_set, vec![])?;
                    initial_plugins
                        .as_ref()
                        .expect("fixture requires initial plugin set")
                        .as_handle()
                        .define_accessor_property(
                            "cached",
                            polymarket_runtime::metadata::AccessorPropertyDefinition {
                                get: Some(Some(get)),
                                set: Some(Some(set)),
                                enumerable: None,
                                configurable: Some(true),
                            },
                        )?;
                }
                "strategyMeta" => {
                    let meta = runner
                        .get_strategy_meta()?
                        .map(MetadataValue::Reference)
                        .unwrap_or(MetadataValue::Missing);
                    host.0.borrow().retained_meta.push(meta.clone())?;
                    let mut row = json!({"kind":"strategyMeta","retained":host.copy(&host.0.borrow().retained_meta.clone().into()),"numberBits":host.bits(&meta)});
                    if let Some(value) = host.copy(&meta) {
                        row["value"] = value;
                        row["rootId"] = host.id(&meta);
                        let root = reference(meta)?;
                        for (name, key) in [
                            ("paramsId", "params"),
                            ("requestedId", "requested"),
                            ("enabledId", "enabled"),
                        ] {
                            let value = if key == "params" {
                                root.get_property(key)?
                            } else {
                                reference(root.get_property("externalFeeds")?)?.get_property(key)?
                            };
                            if !matches!(value, MetadataValue::Missing) {
                                row[name] = host.id(&value);
                            }
                        }
                    }
                    host.trace(row);
                }
                "mutateParams" => {
                    let params = reference(host.0.borrow().input_graph.get("strategyParams")?)?;
                    for (k, v) in op["fields"].as_object().unwrap() {
                        params.set_property(k.as_str(), host.import(v))?;
                    }
                }
                "observe" => {
                    let mut row = final_view(&host, &runner, &receipts);
                    row["kind"] = json!("observation");
                    host.trace(row);
                }
                _ => return Err(host.error("unknown fixture operation")),
            }
        }
        let mut result = final_view(&host, &runner, &receipts);
        result["trace"] = json!(host.0.borrow().trace);
        Ok(result)
    })();
    let result = match outcome {
        Ok(v) => v,
        Err(error) => {
            let mut error = host.error_view(&error);
            error.as_object_mut().unwrap().remove("errorId");
            json!({"trace":host.0.borrow().trace,"error":error})
        }
    };
    HOSTS.with(|all| all.borrow_mut().remove(&host.0.borrow().root));
    result
}
#[test]
#[ignore = "test-only actual shared runner differential entry"]
fn full_body_fixture_driver() {
    let input = std::env::var("PMB_RUNNER_FIXTURE_INPUT").unwrap();
    let output = std::env::var("PMB_RUNNER_FIXTURE_OUTPUT").unwrap();
    let cases: Value = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    let result = cases
        .as_array()
        .unwrap()
        .iter()
        .map(|case| json!({"name":case["name"],"result":run(&case["input"])}))
        .collect::<Vec<_>>();
    std::fs::write(output, serde_json::to_vec(&result).unwrap()).unwrap();
}

fn fixture_event(graph: &MetadataGraph, event: &Value) -> ManagedAccountEvent {
    use polymarket_runtime::portfolio_records::{
        fill, open_order, positions_split, ws_order_update,
    };
    let envelope = graph.object().unwrap();
    for (key, value) in event.as_object().unwrap() {
        let schema = match key.as_str() {
            "fill" => Some(&fill::SCHEMA),
            "split" => Some(&positions_split::SCHEMA),
            "order" => Some(if event["kind"] == "order_submitted" {
                &open_order::SCHEMA
            } else {
                &ws_order_update::SCHEMA
            }),
            _ => None,
        };
        let value = if let Some(schema) = schema {
            graph
                .record(
                    schema,
                    value
                        .as_object()
                        .unwrap()
                        .iter()
                        .map(|(k, v)| (k.as_str().into(), import_control_value(graph, v).unwrap()))
                        .collect(),
                )
                .unwrap()
                .as_handle()
                .clone()
                .into()
        } else {
            import_control_value(graph, value).unwrap()
        };
        envelope.set(key.as_str(), value).unwrap();
    }
    ManagedAccountEvent::from_envelope(envelope)
}

fn fixture_cached_get(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    Ok(frame.captures[0].clone())
}
fn fixture_cached_set(_frame: &CallFrame) -> Result<MetadataValue, JsException> {
    Ok(MetadataValue::Missing)
}
