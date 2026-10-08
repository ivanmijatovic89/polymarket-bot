//! Lifecycle-only binding probes. No production SDK/OrderManager parity claim.
use polymarket_runtime::event_dispatch::{BacklogWarning, Completion, EntryLabel};
use polymarket_runtime::runner::*;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
    task::{Context, Wake, Waker},
};
#[derive(Clone)]
struct Event {
    kind: String,
    market: Option<String>,
    error: Option<Rc<str>>,
}
struct Books {
    market: String,
    time: f64,
    synthetic: bool,
}
type Tick = Rc<RefCell<Books>>;
#[derive(Default)]
struct State {
    trace: Vec<String>,
    graph: polymarket_runtime::metadata::MetadataGraph,
    meta_id: Option<polymarket_runtime::metadata::MetadataValue>,
    meta_params: Option<polymarket_runtime::metadata::MetadataValue>,
    meta_requested: Option<polymarket_runtime::metadata::MetadataValue>,
    meta_enabled: Option<polymarket_runtime::metadata::MetadataValue>,
    now: f64,
    start: Option<f64>,
    can_create: bool,
    fallback_error: Option<Rc<str>>,
    gate: Option<Completion<Result<(), Rc<str>>>>,
    tick_failure: Option<Rc<str>>,
    pre_events: Option<Vec<Event>>,
    execution_events: Option<Vec<Event>>,
    account_intents: Option<Vec<usize>>,
}
#[derive(Clone, Default)]
struct Bind(Rc<RefCell<State>>);
impl Bind {
    fn note(&self, label: &str) {
        self.0.borrow_mut().trace.push(label.into())
    }
    fn trace(&self) -> Vec<String> {
        self.0.borrow().trace.clone()
    }
}
impl RunnerBindings for Bind {
    type Error = Rc<str>;
    type Key = String;
    type Tick = Tick;
    type MarketSnapshot = Tick;
    type Portfolio = Rc<Cell<usize>>;
    type PortfolioSnapshot = usize;
    type Strategy = usize;
    type BuiltPlayer = usize;
    type PluginSet = usize;
    type Plugins = usize;
    type MarketMeta = f64;
    type Balance = usize;
    type Warmup = usize;
    type Metrics = usize;
    type Context = usize;
    type Intents = Vec<usize>;
    type Event = Event;
    type EventDetail = Event;
    type FillLog = ();
    fn error(&self, message: &str) -> Self::Error {
        let _ = (&message,);
        Rc::from(message)
    }
    fn key_truthy(&self, key: &Self::Key) -> bool {
        let _ = (&key,);
        !key.is_empty()
    }
    fn strict_equal(&self, a: &Self::Key, b: &Self::Key) -> bool {
        let _ = (&a, &b);
        a == b
    }
    fn now(&self) -> f64 {
        self.note("now");
        self.0.borrow().now
    }
    fn sleep(&self, ms: f64) -> OwnedFuture<(), Self::Error> {
        let _ = (&ms,);
        self.note("sleep");
        Box::pin(async { Ok(()) })
    }
    fn resolve_max_events(&self, override_value: Option<f64>) -> Result<usize, Self::Error> {
        let _ = (&override_value,);
        Ok(override_value.unwrap_or(4200.0) as usize)
    }
    fn tick_snapshot(&self, tick: &Self::Tick) -> Result<Self::MarketSnapshot, Self::Error> {
        let _ = (&tick,);
        Ok(tick.clone())
    }
    fn market_key(&self, market: &Self::MarketSnapshot) -> Result<Option<Self::Key>, Self::Error> {
        let _ = (&market,);
        Ok(Some(market.borrow().market.clone()))
    }
    fn market_assets(&self, market: &Self::MarketSnapshot) -> Result<Vec<Self::Key>, Self::Error> {
        let _ = (&market,);
        Ok(vec!["up".into(), "down".into()])
    }
    fn market_timestamp(&self, market: &Self::MarketSnapshot) -> Result<f64, Self::Error> {
        let _ = (&market,);
        Ok(market.borrow().time)
    }
    fn synthetic_tick(&self, tick: &Self::Tick) -> Result<bool, Self::Error> {
        let _ = (&tick,);
        Ok(tick.borrow().synthetic)
    }
    fn get_market(&self) -> Result<Option<Self::MarketMeta>, Self::Error> {
        self.note("provider:market");
        Ok(self.0.borrow().start)
    }
    fn get_balance(&self) -> Result<Option<Self::Balance>, Self::Error> {
        self.note("provider:balance");
        Ok(None)
    }
    fn get_warmup(&self) -> Result<Option<Self::Warmup>, Self::Error> {
        self.note("provider:warmup");
        Ok(None)
    }
    fn new_portfolio(&self, starting_capital: f64) -> Result<Self::Portfolio, Self::Error> {
        let _ = (&starting_capital,);
        self.note("new_portfolio");
        Ok(Rc::new(Cell::new(0)))
    }
    fn snapshot(
        &self,
        portfolio: &Self::Portfolio,
    ) -> Result<Self::PortfolioSnapshot, Self::Error> {
        let _ = (&portfolio,);
        self.note("snapshot");
        Ok(portfolio.get())
    }
    fn starting_capital(
        &self,
        snapshot: &Self::PortfolioSnapshot,
    ) -> Result<Option<f64>, Self::Error> {
        let _ = (&snapshot,);
        Ok(Some(500.0))
    }
    fn portfolio_timestamp(
        &self,
        snapshot: &Self::PortfolioSnapshot,
    ) -> Result<Option<f64>, Self::Error> {
        let _ = (&snapshot,);
        Ok(Some(0.0))
    }
    fn initialize_clock(&self, portfolio: &Self::Portfolio, time: f64) -> Result<(), Self::Error> {
        let _ = (&portfolio, &time);
        self.note(&format!("clock:{time}"));
        Ok(())
    }
    fn apply(&self, portfolio: &Self::Portfolio, event: &Self::Event) -> Result<(), Self::Error> {
        let _ = (&portfolio, &event);
        self.note("apply");
        portfolio.set(portfolio.get() + 1);
        Ok(())
    }
    fn cancel_open_orders(
        &self,
        snapshot: &Self::PortfolioSnapshot,
    ) -> Result<Option<Self::Intents>, Self::Error> {
        let _ = (&snapshot,);
        self.note("open_orders");
        Ok(if *snapshot > 0 { Some(vec![1]) } else { None })
    }
    fn can_create_strategy(&self) -> bool {
        self.0.borrow().can_create
    }
    fn create_strategy(&self) -> Result<Self::BuiltPlayer, Self::Error> {
        self.note("create");
        Ok(1)
    }
    fn built_strategy(&self, built: &Self::BuiltPlayer) -> Result<Self::Strategy, Self::Error> {
        Ok(*built)
    }
    fn built_plugin_set(
        &self,
        built: &Self::BuiltPlayer,
    ) -> Result<Option<Self::PluginSet>, Self::Error> {
        let _ = built;
        self.note("built_plugin_set");
        Ok(if self.0.borrow().fallback_error.is_some() {
            None
        } else {
            Some(2)
        })
    }
    fn built_has_plugins(&self, built: &Self::BuiltPlayer) -> Result<bool, Self::Error> {
        let _ = built;
        Ok(self.0.borrow().fallback_error.is_some())
    }
    fn new_plugin_set(&self) -> Result<Self::PluginSet, Self::Error> {
        Ok(3)
    }
    fn register_built_plugins(
        &self,
        set: &Self::PluginSet,
        built: &Self::BuiltPlayer,
    ) -> Result<(), Self::Error> {
        let _ = (set, built);
        match &self.0.borrow().fallback_error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
    fn reset_plugins(&self, plugins: &Self::PluginSet) -> Result<(), Self::Error> {
        let _ = (&plugins,);
        self.note(&format!("reset:{plugins}"));
        Ok(())
    }
    fn capture_tick(
        &self,
        plugins: &Self::PluginSet,
        tick: &Self::Tick,
    ) -> Result<(), Self::Error> {
        let _ = (&plugins, &tick);
        self.note(&format!("capture:{plugins}"));
        Ok(())
    }
    fn update_plugins(
        &self,
        plugins: &Self::PluginSet,
        tick: &Self::Tick,
        context: Option<Self::Context>,
    ) -> Result<(), Self::Error> {
        let _ = (&plugins, &tick, &context);
        self.note(&format!("plugin:{plugins}"));
        Ok(())
    }
    fn plugins_snapshot(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<Self::Plugins>, Self::Error> {
        let _ = (&plugins,);
        self.note("plugin_snapshot");
        Ok(Some(*plugins))
    }
    fn plugins_truthy(&self, plugins: &Self::Plugins) -> bool {
        *plugins != 0
    }
    fn refresh_plugins(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<Self::Plugins>, Self::Error> {
        let _ = (&plugins,);
        self.note("refresh");
        Ok(Some(*plugins))
    }
    fn technical_indicators_ready(
        &self,
        plugins: Option<&Self::Plugins>,
    ) -> Result<bool, Self::Error> {
        let _ = (&plugins,);
        Ok(true)
    }
    fn wait_for_technical_indicators(&self) -> bool {
        false
    }
    fn technical_timeout(&self) -> f64 {
        3000.0
    }
    fn technical_poll(&self) -> f64 {
        10.0
    }
    fn warn_technical_timeout(&self, market: &Self::Key, timeout: f64) -> Result<(), Self::Error> {
        let _ = (&market, &timeout);
        self.note("timeout");
        Ok(())
    }
    fn parse_market_start(
        &self,
        market: Option<&Self::MarketMeta>,
    ) -> Result<Option<f64>, Self::Error> {
        let _ = (&market,);
        Ok(market.copied())
    }
    fn log_late_start(
        &self,
        market: Option<&Self::MarketMeta>,
        elapsed: f64,
        maximum: f64,
    ) -> Result<(), Self::Error> {
        let _ = (&market, &elapsed, &maximum);
        self.note("late_start");
        Ok(())
    }
    fn metrics(
        &self,
        portfolio: &Self::PortfolioSnapshot,
        books: Option<&Self::MarketSnapshot>,
        market: Option<&Self::MarketMeta>,
    ) -> Result<Option<Self::Metrics>, Self::Error> {
        let _ = (&portfolio, &books, &market);
        self.note("metrics");
        Ok(Some(1))
    }
    fn context(
        &self,
        parts: BindingContextParts<Self>,
    ) -> Result<Option<Self::Context>, Self::Error> {
        let _ = (&parts,);
        self.note(if parts.plugins.is_some() {
            "context:full"
        } else {
            "context:base"
        });
        Ok(Some(1))
    }
    fn begin_market(&self) -> Result<(), Self::Error> {
        self.note("begin_market");
        Ok(())
    }
    fn reconcile(
        &self,
        portfolio: &Self::PortfolioSnapshot,
        event: &Self::Event,
    ) -> Result<(), Self::Error> {
        let _ = (&portfolio, &event);
        self.note("reconcile");
        Ok(())
    }
    fn pending_capital(
        &self,
        portfolio: Self::PortfolioSnapshot,
    ) -> Result<Self::PortfolioSnapshot, Self::Error> {
        let _ = (&portfolio,);
        self.note("pending_capital");
        Ok(portfolio)
    }
    fn execute_intents(
        &self,
        intents: Self::Intents,
        context: ExecutionContext<Self::MarketSnapshot, Self::PortfolioSnapshot>,
        mode: IntentMode,
    ) -> OwnedFuture<Vec<Self::Event>, Self::Error> {
        let _ = (&intents, &context, &Self, &mode);
        self.note("execute");
        let events = self
            .0
            .borrow_mut()
            .execution_events
            .take()
            .unwrap_or_default();
        Box::pin(async move { Ok(events) })
    }
    fn execution_tick(
        &self,
        context: ExecutionContext<Self::MarketSnapshot, Self::PortfolioSnapshot>,
    ) -> OwnedFuture<Vec<Self::Event>, Self::Error> {
        let _ = (&context, &Self);
        self.note("execution_tick");
        let events = self.0.borrow_mut().pre_events.take().unwrap_or_default();
        Box::pin(async move { Ok(events) })
    }
    fn intents_empty(&self, intents: Option<&Self::Intents>) -> Result<bool, Self::Error> {
        let _ = (&intents,);
        Ok(intents.is_none_or(Vec::is_empty))
    }
    fn log_intents(&self, intents: &Self::Intents, mode: IntentMode) -> Result<(), Self::Error> {
        let _ = (&intents, &mode);
        self.note("intent_log");
        Ok(())
    }
    fn strategy_tick(
        &self,
        strategy: &Self::Strategy,
        tick: Self::Tick,
        portfolio: Self::PortfolioSnapshot,
        context: Option<Self::Context>,
    ) -> OwnedFuture<Option<Self::Intents>, Self::Error> {
        let _ = (&strategy, &tick, &portfolio, &context);
        self.note("strategy_tick");
        let gate = self.0.borrow_mut().gate.take();
        let failure = self.0.borrow_mut().tick_failure.take();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.await?;
            }
            if let Some(error) = failure {
                return Err(error);
            }
            Ok(Some(vec![]))
        })
    }
    fn strategy_account(
        &self,
        strategy: &Self::Strategy,
        event: Self::Event,
        portfolio: Self::PortfolioSnapshot,
        market: Option<Self::MarketSnapshot>,
        context: Option<Self::Context>,
    ) -> OwnedFuture<Option<Self::Intents>, Self::Error> {
        let _ = (&strategy, &event, &portfolio, &market, &context);
        self.note("strategy_account");
        let intents = self
            .0
            .borrow_mut()
            .account_intents
            .take()
            .unwrap_or_default();
        Box::pin(async move { Ok(Some(intents)) })
    }
    fn observe_context(&self, context: Option<&Self::Context>) -> Result<(), Self::Error> {
        let _ = (&context,);
        self.note("observe_context");
        Ok(())
    }
    fn observe_capital(&self, portfolio: &Self::PortfolioSnapshot) -> Result<(), Self::Error> {
        let _ = (&portfolio,);
        self.note("observe_capital");
        Ok(())
    }
    fn observes_capital(&self) -> bool {
        true
    }
    fn observe_decision(
        &self,
        origin: DecisionOrigin,
        intents: Option<&Self::Intents>,
    ) -> Result<(), Self::Error> {
        let _ = (&origin, &intents);
        self.note(if origin == DecisionOrigin::Market {
            "decision:market"
        } else {
            "decision:account"
        });
        Ok(())
    }
    fn observe_account(
        &self,
        event: &Self::Event,
        portfolio: &Self::PortfolioSnapshot,
    ) -> Result<(), Self::Error> {
        let _ = (&event, &portfolio);
        self.note("observe_account");
        Ok(())
    }
    fn event_detail(&self, event: &Self::Event) -> Result<Self::EventDetail, Self::Error> {
        Ok(event.clone())
    }
    fn detail_has(&self, detail: &Self::EventDetail, field: &str) -> Result<bool, Self::Error> {
        Ok(field == "market" && detail.market.is_some())
    }
    fn detail_key(
        &self,
        detail: &Self::EventDetail,
        field: &str,
    ) -> Result<Option<Self::Key>, Self::Error> {
        let _ = field;
        Ok(detail.market.clone())
    }
    fn detail_present_key(
        &self,
        detail: &Self::EventDetail,
        field: &str,
    ) -> Result<Self::Key, Self::Error> {
        let _ = (detail, field);
        panic!("fixture never sets assetIdB")
    }
    fn is_submission(&self, event: &Self::Event) -> Result<bool, Self::Error> {
        Ok(event.kind == "order_submitted")
    }
    fn recent_event(&self, event: &Self::Event) -> Result<RecentEvent<Self::Key>, Self::Error> {
        let _ = (&event,);
        Ok(RecentEvent {
            kind: event.kind.clone(),
            outer_timestamp_ms: None,
        })
    }
    fn is_fill(&self, event: &Self::Event) -> Result<bool, Self::Error> {
        let _ = (&event,);
        Ok(event.kind == "fill")
    }
    fn is_cancel_failed(&self, event: &Self::Event) -> Result<bool, Self::Error> {
        let _ = (&event,);
        Ok(event.kind == "cancel_failed")
    }
    fn prepare_fill_log(&self, event: &Self::Event) -> Result<Self::FillLog, Self::Error> {
        let _ = (&event,);
        self.note("fill_diagnostic");
        match &event.error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
    fn log_fill(&self, event: &Self::Event, details: Self::FillLog) -> Result<(), Self::Error> {
        let _ = (&event, &details);
        self.note("log_fill");
        Ok(())
    }
    fn log_cancel_failed(&self, event: &Self::Event) -> Result<(), Self::Error> {
        let _ = (&event,);
        self.note("cancel_failed");
        Ok(())
    }
    fn log_drain_limit(
        &self,
        maximum: usize,
        remaining: usize,
        recent: &[RecentEvent<Self::Key>],
    ) -> Result<(), Self::Error> {
        let _ = (&maximum, &remaining, &recent);
        self.note("drain_limit");
        Ok(())
    }
    fn serial_warning(&self, warning: BacklogWarning) {
        let _ = (&warning,);
        self.note("backlog")
    }
    fn serial_failure(&self, label: EntryLabel, error: &Self::Error) {
        let _ = (&label, &error);
        self.note("serial_failure")
    }
}

struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}
fn tick(market: &str, time: f64) -> Tick {
    Rc::new(RefCell::new(Books {
        market: market.into(),
        time,
        synthetic: false,
    }))
}
fn core(bind: Bind) -> RunnerCore<Bind> {
    RunnerCore::new(
        bind,
        RunnerOptions {
            strategy: 0,
            portfolio: None,
            plugins: Some(1),
            starting_capital: None,
            intent_mode: IntentMode::Queued,
            max_events_per_drain: None,
            skip_late_start_after_ms: None,
        },
    )
    .unwrap()
}
fn pump(runner: &mut Runner<Bind>, turns: usize) {
    let waker = Waker::from(Arc::new(Noop));
    let mut cx = Context::from_waker(&waker);
    for _ in 0..turns {
        let _ = runner.poll_ready(&mut cx);
    }
}
#[test]
fn capture_remains_sync_while_body_awaits_and_receipt_error_identity_recovers() {
    let bind = Bind::default();
    bind.0.borrow_mut().can_create = true;
    let (gate, release) = Completion::pending();
    let error: Rc<str> = Rc::from("strategy failed");
    bind.0.borrow_mut().gate = Some(gate);
    bind.0.borrow_mut().tick_failure = Some(error.clone());
    let mut runner = Runner::new(core(bind.clone()));
    let first = runner.submit_tick(tick("m", 1.0)).unwrap();
    pump(&mut runner, 8);
    assert!(!first.is_ready());
    assert_eq!(runner.depth(), 1);
    let second = runner.submit_tick(tick("m", 2.0)).unwrap();
    assert_eq!(bind.trace().last().unwrap(), "capture:1");
    assert_eq!(runner.depth(), 2);
    assert_eq!(runner.last_market().unwrap().borrow().time, 1.0);
    runner.portfolio().set(3);
    release.complete(Ok(()));
    pump(&mut runner, 24);
    let Err(actual) = first.result().unwrap() else {
        panic!("expected error")
    };
    assert!(Rc::ptr_eq(&error, &actual));
    assert!(matches!(second.result(), Some(Ok(()))));
    assert_eq!(runner.depth(), 0);
    let trace = bind.trace();
    let failure = trace.iter().position(|x| x == "serial_failure").unwrap();
    let second_provider = trace
        .iter()
        .enumerate()
        .filter(|(_, x)| *x == "provider:market")
        .nth(1)
        .unwrap()
        .0;
    assert!(failure < second_provider);
}
#[test]
fn rotation_applies_old_cancel_before_new_player_and_late_old_events() {
    let bind = Bind::default();
    bind.0.borrow_mut().can_create = true;
    let mut runner = Runner::new(core(bind.clone()));
    let first = runner.submit_tick(tick("a", 1.0)).unwrap();
    pump(&mut runner, 24);
    assert!(first.is_ready());
    let old = runner.portfolio();
    old.set(1);
    bind.0.borrow_mut().execution_events = Some(vec![Event {
        kind: "order_done".into(),
        market: Some("a".into()),
        error: None,
    }]);
    let next = runner.submit_tick(tick("b", 2.0)).unwrap();
    pump(&mut runner, 24);
    assert!(matches!(next.result(), Some(Ok(()))));
    assert_eq!(old.get(), 2);
    assert_eq!(runner.portfolio().get(), 0);
    let late = runner.submit_account(Event {
        kind: "fill".into(),
        market: Some("a".into()),
        error: Some(Rc::from("out-of-range fill date")),
    });
    pump(&mut runner, 24);
    assert!(matches!(late.result(), Some(Ok(()))));
    assert_eq!(old.get(), 3);
    let trace = bind.trace();
    let execute = trace.iter().position(|x| x == "execute").unwrap();
    let begin = trace.iter().position(|x| x == "begin_market").unwrap();
    let create = trace.iter().position(|x| x == "create").unwrap();
    let reset = trace.iter().position(|x| x == "reset:1").unwrap();
    assert!(execute < begin && begin < create && create < reset);
}
#[test]
fn synthetic_tick_skips_execution_and_fill_diagnostics_throw_before_accounting() {
    let bind = Bind::default();
    let mut runner = Runner::new(core(bind.clone()));
    let t = tick("m", 0.0);
    t.borrow_mut().synthetic = true;
    let receipt = runner.submit_tick(t).unwrap();
    pump(&mut runner, 24);
    assert!(matches!(receipt.result(), Some(Ok(()))));
    assert!(!bind.trace().contains(&"execution_tick".into()));
    let error: Rc<str> = Rc::from("Invalid time value");
    let account = runner.submit_account(Event {
        kind: "fill".into(),
        market: Some("m".into()),
        error: Some(error.clone()),
    });
    pump(&mut runner, 24);
    let Err(actual) = account.result().unwrap() else {
        panic!("expected error")
    };
    assert!(Rc::ptr_eq(&error, &actual));
    assert_eq!(runner.portfolio().get(), 0);
    assert!(!bind.trace().contains(&"apply".into()));
}
#[test]
fn drain_failure_keeps_remaining_events_for_next_serial_entry() {
    let bind = Bind::default();
    let error: Rc<str> = Rc::from("Invalid time value");
    bind.0.borrow_mut().pre_events = Some(vec![
        Event {
            kind: "fill".into(),
            market: Some("m".into()),
            error: Some(error.clone()),
        },
        Event {
            kind: "order_open".into(),
            market: Some("m".into()),
            error: None,
        },
    ]);
    let mut runner = Runner::new(core(bind.clone()));
    let first = runner.submit_tick(tick("m", 1.0)).unwrap();
    pump(&mut runner, 24);
    let Err(actual) = first.result().unwrap() else {
        panic!("expected fill diagnostic failure")
    };
    assert!(Rc::ptr_eq(&error, &actual));
    assert!(!bind.trace().contains(&"strategy_tick".into()));
    let second = runner.submit_account(Event {
        kind: "order_done".into(),
        market: Some("m".into()),
        error: None,
    });
    pump(&mut runner, 24);
    assert!(matches!(second.result(), Some(Ok(()))));
    assert_eq!(runner.portfolio().get(), 2);
    assert_eq!(
        bind.trace()
            .iter()
            .filter(|x| x.as_str() == "strategy_account")
            .count(),
        2
    );
}
#[test]
fn bounded_drain_drops_feedback_then_continues_the_market_decision() {
    let bind = Bind::default();
    bind.0.borrow_mut().pre_events = Some(
        (0..3)
            .map(|_| Event {
                kind: "order_open".into(),
                market: Some("m".into()),
                error: None,
            })
            .collect(),
    );
    let config = RunnerOptions {
        strategy: 0,
        portfolio: None,
        plugins: Some(1),
        starting_capital: None,
        intent_mode: IntentMode::Queued,
        max_events_per_drain: Some(1.0),
        skip_late_start_after_ms: None,
    };
    let mut runner = Runner::new(RunnerCore::new(bind.clone(), config).unwrap());
    let first = runner.submit_tick(tick("m", 1.0)).unwrap();
    pump(&mut runner, 24);
    assert!(matches!(first.result(), Some(Ok(()))));
    assert_eq!(runner.portfolio().get(), 1);
    let trace = bind.trace();
    let limit = trace.iter().position(|x| x == "drain_limit").unwrap();
    let decision = trace.iter().position(|x| x == "strategy_tick").unwrap();
    assert!(limit < decision);
    let second = runner.submit_account(Event {
        kind: "order_done".into(),
        market: Some("m".into()),
        error: None,
    });
    pump(&mut runner, 24);
    assert!(second.is_ready());
    assert_eq!(runner.portfolio().get(), 2);
}
#[test]
fn late_start_block_keeps_execution_ticks_but_skips_plugins_and_decisions() {
    let bind = Bind::default();
    bind.0.borrow_mut().start = Some(0.0);
    let config = RunnerOptions {
        strategy: 0,
        portfolio: None,
        plugins: Some(1),
        starting_capital: None,
        intent_mode: IntentMode::Queued,
        max_events_per_drain: None,
        skip_late_start_after_ms: Some(1000.0),
    };
    let mut runner = Runner::new(RunnerCore::new(bind.clone(), config).unwrap());
    for time in [1001.0, 1002.0] {
        let receipt = runner.submit_tick(tick("m", time)).unwrap();
        pump(&mut runner, 24);
        assert!(matches!(receipt.result(), Some(Ok(()))));
    }
    let trace = bind.trace();
    assert_eq!(
        trace.iter().filter(|x| x.as_str() == "late_start").count(),
        1
    );
    assert_eq!(
        trace
            .iter()
            .filter(|x| x.as_str() == "execution_tick")
            .count(),
        2
    );
    assert_eq!(
        trace
            .iter()
            .filter(|x| x.as_str() == "observe_capital")
            .count(),
        2
    );
    assert!(!trace.contains(&"strategy_tick".into()));
    assert!(!trace.contains(&"plugin:1".into()));
}

#[test]
fn fallback_registration_error_retains_installed_plugin_set_and_new_player() {
    let bind = Bind::default();
    bind.0.borrow_mut().can_create = true;
    let mut runner = Runner::new(core(bind.clone()));
    let first = runner.submit_tick(tick("a", 1.0)).unwrap();
    pump(&mut runner, 24);
    assert!(matches!(first.result(), Some(Ok(()))));
    let error: Rc<str> = Rc::from("plugin iterable failed");
    bind.0.borrow_mut().fallback_error = Some(error.clone());
    let second = runner.submit_tick(tick("b", 2.0)).unwrap();
    pump(&mut runner, 24);
    let Err(actual) = second.result().unwrap() else {
        panic!("expected registration error")
    };
    assert!(Rc::ptr_eq(&error, &actual));
    let third = runner.submit_tick(tick("a", 3.0)).unwrap();
    assert_eq!(bind.trace().last().unwrap(), "capture:3");
    pump(&mut runner, 24);
    assert!(matches!(third.result(), Some(Ok(()))));
    assert!(bind.trace().contains(&"plugin:3".into()));
    let trace = bind.trace();
    let reset = trace.iter().position(|x| x == "reset:1").unwrap();
    let plugin_read = trace.iter().position(|x| x == "built_plugin_set").unwrap();
    assert!(reset < plugin_read);
}

#[test]
fn concrete_portfolio_owner_keeps_one_core_and_original_cached_graph_roots() {
    use polymarket_runtime::{
        metadata::{MetadataGraph, MetadataValue},
        portfolio::PortfolioOptions,
        portfolio_records::{portfolio_snapshot, ManagedAccountEvent, PositionsSplitRecord},
        runner::SharedPortfolio,
    };
    let graph = MetadataGraph::new();
    let owner = SharedPortfolio::new_in_graph(&graph, PortfolioOptions::default(), 123.0).unwrap();
    let retained_owner = owner.clone();
    assert!(owner.same_owner(&retained_owner));
    let original = owner.snapshot().unwrap();
    assert_eq!(
        original.handle().as_handle(),
        retained_owner.snapshot().unwrap().handle().as_handle()
    );
    let split = PositionsSplitRecord::new(
        &graph,
        vec![
            ("id".into(), "split-1".into()),
            ("tsMs".into(), 5.0.into()),
            ("assetIdA".into(), "up".into()),
            ("assetIdB".into(), "down".into()),
            ("size".into(), 2.0.into()),
            ("splitCost".into(), 2.0.into()),
        ],
    )
    .unwrap();
    let original_split = split.handle().as_handle().clone();
    retained_owner
        .apply(&ManagedAccountEvent::positions_split(&graph, split).unwrap())
        .unwrap();
    let current = owner.snapshot().unwrap();
    assert_ne!(original.handle().as_handle(), current.handle().as_handle());
    let MetadataValue::Reference(recent) = current.get(portfolio_snapshot::RECENT_SPLITS).unwrap()
    else {
        panic!("recent splits must retain a graph array")
    };
    let MetadataValue::Reference(retained_split) = recent.get_index(0).unwrap() else {
        panic!("recent split must be the original payload handle")
    };
    assert_eq!(retained_split, original_split);
    assert_eq!(
        original.number(portfolio_snapshot::NOW_MS).unwrap(),
        Some(123.0)
    );
    assert_eq!(
        current.number(portfolio_snapshot::NOW_MS).unwrap(),
        Some(5.0)
    );
    // Episode portfolios reuse the session graph but have independent ledgers.
    let next = SharedPortfolio::new_in_graph(&graph, PortfolioOptions::default(), 456.0).unwrap();
    assert!(!owner.same_owner(&next));
    assert_ne!(
        next.snapshot().unwrap().handle().as_handle(),
        current.handle().as_handle()
    );
}

#[test]
fn ready_execution_future_defers_market_strategy_until_owner_continuation() {
    use std::future::Future;
    let bind = Bind::default();
    let mut core = core(bind.clone());
    let mut future = std::pin::pin!(core.process_market(tick("m", 1.0)));
    let mut cx = Context::from_waker(Waker::noop());
    assert!(future.as_mut().poll(&mut cx).is_pending());
    let first = bind.trace();
    assert!(first.contains(&"execution_tick".into()));
    assert!(!first.contains(&"strategy_tick".into()));
    for _ in 0..24 {
        if future.as_mut().poll(&mut cx).is_ready() {
            assert!(bind.trace().contains(&"strategy_tick".into()));
            return;
        }
    }
    panic!("ready operations must settle across owning continuations");
}

impl RunnerMetadataBindings for Bind {
    fn metadata_graph(&self) -> polymarket_runtime::metadata::MetadataGraph {
        self.0.borrow().graph.clone()
    }
    fn metadata_error(&self, error: polymarket_runtime::metadata::MetadataError) -> Self::Error {
        Rc::from(error.to_string())
    }
    fn strategy_id(&self) -> polymarket_runtime::metadata::MetadataValue {
        self.0
            .borrow()
            .meta_id
            .clone()
            .unwrap_or(polymarket_runtime::metadata::MetadataValue::Missing)
    }
    fn strategy_params(&self) -> polymarket_runtime::metadata::MetadataValue {
        self.0
            .borrow()
            .meta_params
            .clone()
            .unwrap_or(polymarket_runtime::metadata::MetadataValue::Missing)
    }
    fn enabled_external_feeds(&self) -> polymarket_runtime::metadata::MetadataValue {
        self.0
            .borrow()
            .meta_enabled
            .clone()
            .unwrap_or(polymarket_runtime::metadata::MetadataValue::Missing)
    }
    fn strategy_name(
        &self,
        strategy: &usize,
    ) -> Result<polymarket_runtime::metadata::MetadataValue, Self::Error> {
        self.note("meta_name");
        Ok(format!("player:{strategy}").as_str().into())
    }
    fn strategy_required_feeds(
        &self,
        _: &usize,
    ) -> Result<polymarket_runtime::metadata::MetadataValue, Self::Error> {
        self.note("meta_requested");
        Ok(self
            .0
            .borrow()
            .meta_requested
            .clone()
            .unwrap_or(polymarket_runtime::metadata::MetadataValue::Missing))
    }
    fn plugin_ids(
        &self,
        plugins: &usize,
    ) -> Result<polymarket_runtime::metadata::MetadataHandle, Self::Error> {
        self.note("meta_indicators");
        let array = self.metadata_graph().array().unwrap();
        array
            .push(format!("plugin:{plugins}").as_str().into())
            .unwrap();
        Ok(array)
    }
}
#[test]
fn public_strategy_metadata_preserves_fields_truthiness_and_shared_config_edges() {
    use polymarket_runtime::metadata::MetadataValue;
    let bind = Bind::default();
    let mut runner = Runner::new(core(bind.clone()));
    assert!(runner.get_strategy_meta().unwrap().is_none());
    assert!(!bind.trace().contains(&"meta_requested".into()));
    let graph = bind.metadata_graph();
    let params = graph.object().unwrap();
    let requested = graph.object().unwrap();
    requested
        .set(
            "feed",
            polymarket_runtime::metadata::MetadataValue::Bool(true),
        )
        .unwrap();
    {
        let mut state = bind.0.borrow_mut();
        state.meta_id = Some("id".into());
        state.meta_params = Some(params.clone().into());
        state.meta_requested = Some(requested.clone().into());
        state.meta_enabled = Some(MetadataValue::Bool(false));
    }
    let old = runner.get_strategy_meta().unwrap().unwrap();
    let next = runner.get_strategy_meta().unwrap().unwrap();
    assert_ne!(old, next);
    assert_eq!(
        old.keys()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap())
            .collect::<Vec<_>>(),
        ["id", "name", "params", "indicators", "externalFeeds"]
    );
    let MetadataValue::Reference(old_params) = old.get("params").unwrap() else {
        panic!("params reference")
    };
    assert_eq!(old_params, params);
    let MetadataValue::Reference(external) = old.get("externalFeeds").unwrap() else {
        panic!("external wrapper")
    };
    assert_eq!(
        external
            .keys()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap())
            .collect::<Vec<_>>(),
        ["requested"]
    );
    let MetadataValue::Reference(actual) = external.get("requested").unwrap() else {
        panic!("requested reference")
    };
    assert_eq!(actual, requested);
    params.set("retainedMutation", 7.0.into()).unwrap();
    assert!(matches!(
        old_params.get("retainedMutation").unwrap(),
        MetadataValue::Number(7.0)
    ));
    old.set("id", "changed-return-wrapper".into()).unwrap();
    assert!(matches!(next.get("id").unwrap(),MetadataValue::String(id) if id.matches("id")));
    let trace = bind.trace();
    let requested_index = trace.iter().position(|x| x == "meta_requested").unwrap();
    let name_index = trace.iter().position(|x| x == "meta_name").unwrap();
    assert!(requested_index < name_index);
    // The current strategy slot is updated during rotation and remains readable
    // while its callback is pending, independent of the taken mutable body.
    bind.0.borrow_mut().can_create = true;
    let first = runner.submit_tick(tick("a", 1.0)).unwrap();
    pump(&mut runner, 24);
    assert!(first.is_ready());
    let (gate, _) = Completion::pending();
    bind.0.borrow_mut().gate = Some(gate);
    let receipt = runner.submit_tick(tick("b", 2.0)).unwrap();
    pump(&mut runner, 12);
    assert!(!receipt.is_ready());
    let current = runner.get_strategy_meta().unwrap().unwrap();
    assert!(
        matches!(current.get("name").unwrap(),MetadataValue::String(name) if name.matches("player:1"))
    );
}
