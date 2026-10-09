//! Shared owning-thread runner orchestration. Bindings supply graph operations,
//! the one Portfolio/OrderManager core and SDK callbacks; no serialized views.
use crate::event_dispatch::{
    BacklogWarning, DispatchReceipt, EntryLabel, FutureDisposition, FutureSerialDispatcher,
};
use crate::{js_async::js_await, math::js_max};
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    future::Future,
    hash::Hash,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll},
};

pub type OwnedFuture<T, E> = Pin<Box<dyn Future<Output = Result<T, E>>>>;

/// Session-local owner of the one accounting core. Each method borrows only for
/// its synchronous operation; callbacks and returned futures retain this owner,
/// never a RefCell guard or a copied accounting ledger.
#[derive(Clone)]
pub struct SharedPortfolio(Rc<RefCell<crate::portfolio::Portfolio>>);
impl SharedPortfolio {
    pub fn new_in_graph(
        graph: &crate::metadata::MetadataGraph,
        options: crate::portfolio::PortfolioOptions,
        initial_now_ms: f64,
    ) -> Result<Self, &'static str> {
        crate::portfolio::Portfolio::new_in_graph(graph, options, initial_now_ms)
            .map(Self::from_portfolio)
    }
    pub fn from_portfolio(portfolio: crate::portfolio::Portfolio) -> Self {
        Self(Rc::new(RefCell::new(portfolio)))
    }
    pub fn same_owner(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
    pub fn snapshot(
        &self,
    ) -> Result<crate::portfolio_records::PortfolioSnapshotRecord, crate::metadata::MetadataError>
    {
        self.0.borrow_mut().snapshot_record()
    }
    pub fn initialize_clock(&self, time: f64) {
        self.0.borrow_mut().initialize_clock(time);
    }
    pub fn apply(
        &self,
        event: &crate::portfolio_records::ManagedAccountEvent,
    ) -> Result<(), crate::portfolio::PortfolioIngressError> {
        self.0.borrow_mut().apply_managed(event)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentMode {
    Queued,
    Immediate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecisionOrigin {
    Market,
    Account,
}
#[derive(Clone)]
pub struct ExecutionContext<M, P> {
    pub now_ms: f64,
    pub last_market: Option<M>,
    pub portfolio: P,
}
#[derive(Clone)]
pub struct ContextParts<D, X, B, W, P> {
    pub market: Option<D>,
    pub metrics: Option<X>,
    pub balance: Option<B>,
    pub warmup: Option<W>,
    pub plugins: Option<P>,
}
#[derive(Clone)]
pub struct RecentEvent<K> {
    pub kind: K,
    pub outer_timestamp_ms: Option<f64>,
}
pub type BindingContextParts<B> = ContextParts<
    <B as RunnerBindings>::MarketMeta,
    <B as RunnerBindings>::Metrics,
    <B as RunnerBindings>::Balance,
    <B as RunnerBindings>::Warmup,
    <B as RunnerBindings>::Plugins,
>;

/// Each call is an atomic SDK/accounting/execution operation, not a replacement
/// runner body. All handles are rooted in one caller-owned graph. Key Eq/Hash
/// MUST implement JS Map SameValueZero; strict_equal is separately JS ===.
/// new_portfolio MUST reuse that graph across episodes: retained prior-market
/// references remain valid in later strategy decisions. Workers/candidates get
/// distinct session graphs at transport boundaries, never at market rotation.
/// Error clones MUST preserve the original thrown object's identity.
/// Callbacks return owned futures, so no RefCell guard can survive an await.
pub trait RunnerBindings: Clone + 'static {
    type Error: Clone + 'static;
    type Key: Clone + Eq + Hash + 'static;
    type Tick: Clone + 'static;
    type MarketSnapshot: Clone + 'static;
    type Portfolio: Clone + 'static;
    type PortfolioSnapshot: Clone + 'static;
    type Strategy: Clone + 'static;
    type BuiltPlayer: Clone + 'static;
    type PluginSet: Clone + 'static;
    type Plugins: Clone + 'static;
    type MarketMeta: Clone + 'static;
    type Balance: Clone + 'static;
    type Warmup: Clone + 'static;
    type Metrics: Clone + 'static;
    type Context: Clone + 'static;
    type Intents: Clone + 'static;
    type Event: Clone + 'static;
    type EventDetail: Clone + 'static;
    type FillLog;

    fn error(&self, message: &str) -> Self::Error;
    fn key_truthy(&self, key: &Self::Key) -> bool;
    fn strict_equal(&self, a: &Self::Key, b: &Self::Key) -> bool;
    fn now(&self) -> f64;
    fn sleep(&self, ms: f64) -> OwnedFuture<(), Self::Error>;
    fn resolve_max_events(&self, override_value: Option<f64>) -> Result<usize, Self::Error>;
    fn tick_snapshot(&self, tick: &Self::Tick) -> Result<Self::MarketSnapshot, Self::Error>;
    fn market_key(&self, market: &Self::MarketSnapshot) -> Result<Option<Self::Key>, Self::Error>;
    fn market_assets(&self, market: &Self::MarketSnapshot) -> Result<Vec<Self::Key>, Self::Error>;
    fn market_timestamp(&self, market: &Self::MarketSnapshot) -> Result<f64, Self::Error>;
    fn synthetic_tick(&self, tick: &Self::Tick) -> Result<bool, Self::Error>;
    fn get_market(&self) -> Result<Option<Self::MarketMeta>, Self::Error>;
    fn get_balance(&self) -> Result<Option<Self::Balance>, Self::Error>;
    fn get_warmup(&self) -> Result<Option<Self::Warmup>, Self::Error>;
    fn new_portfolio(&self, starting_capital: f64) -> Result<Self::Portfolio, Self::Error>;
    fn snapshot(&self, portfolio: &Self::Portfolio)
        -> Result<Self::PortfolioSnapshot, Self::Error>;
    fn starting_capital(
        &self,
        snapshot: &Self::PortfolioSnapshot,
    ) -> Result<Option<f64>, Self::Error>;
    fn portfolio_timestamp(
        &self,
        snapshot: &Self::PortfolioSnapshot,
    ) -> Result<Option<f64>, Self::Error>;
    fn initialize_clock(&self, portfolio: &Self::Portfolio, time: f64) -> Result<(), Self::Error>;
    fn apply(&self, portfolio: &Self::Portfolio, event: &Self::Event) -> Result<(), Self::Error>;
    fn cancel_open_orders(
        &self,
        snapshot: &Self::PortfolioSnapshot,
    ) -> Result<Option<Self::Intents>, Self::Error>;
    fn can_create_strategy(&self) -> bool;
    fn create_strategy(&self) -> Result<Self::BuiltPlayer, Self::Error>;
    fn built_strategy(&self, built: &Self::BuiltPlayer) -> Result<Self::Strategy, Self::Error>;
    fn built_plugin_set(
        &self,
        built: &Self::BuiltPlayer,
    ) -> Result<Option<Self::PluginSet>, Self::Error>;
    fn built_has_plugins(&self, built: &Self::BuiltPlayer) -> Result<bool, Self::Error>;
    fn new_plugin_set(&self) -> Result<Self::PluginSet, Self::Error>;
    /// Read/iterate built.plugins at this call site; registration errors retain
    /// the already-installed partial PluginSet, as the TS assignment precedes it.
    fn register_built_plugins(
        &self,
        set: &Self::PluginSet,
        built: &Self::BuiltPlayer,
    ) -> Result<(), Self::Error>;
    fn reset_plugins(&self, plugins: &Self::PluginSet) -> Result<(), Self::Error>;
    fn capture_tick(&self, plugins: &Self::PluginSet, tick: &Self::Tick)
        -> Result<(), Self::Error>;
    fn update_plugins(
        &self,
        plugins: &Self::PluginSet,
        tick: &Self::Tick,
        context: Option<Self::Context>,
    ) -> Result<(), Self::Error>;
    fn plugins_snapshot(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<Self::Plugins>, Self::Error>;
    /// JavaScript truthiness, distinct from optional method/undefined presence.
    fn plugins_truthy(&self, plugins: &Self::Plugins) -> bool;
    fn refresh_plugins(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<Self::Plugins>, Self::Error>;
    fn technical_indicators_ready(
        &self,
        plugins: Option<&Self::Plugins>,
    ) -> Result<bool, Self::Error>;
    fn wait_for_technical_indicators(&self) -> bool;
    /// Values are Number(env ?? default), before the TS `||` and clamp.
    fn technical_timeout(&self) -> f64;
    fn technical_poll(&self) -> f64;
    fn warn_technical_timeout(&self, market: &Self::Key, timeout: f64) -> Result<(), Self::Error>;
    fn parse_market_start(
        &self,
        market: Option<&Self::MarketMeta>,
    ) -> Result<Option<f64>, Self::Error>;
    fn log_late_start(
        &self,
        market: Option<&Self::MarketMeta>,
        elapsed: f64,
        maximum: f64,
    ) -> Result<(), Self::Error>;
    fn metrics(
        &self,
        portfolio: &Self::PortfolioSnapshot,
        books: Option<&Self::MarketSnapshot>,
        market: Option<&Self::MarketMeta>,
    ) -> Result<Option<Self::Metrics>, Self::Error>;
    /// Allocate fresh context wrapper in TS order: plugins,market,metrics,balance,warmup.
    fn context(
        &self,
        parts: BindingContextParts<Self>,
    ) -> Result<Option<Self::Context>, Self::Error>;
    fn begin_market(&self) -> Result<(), Self::Error>;
    fn reconcile(
        &self,
        portfolio: &Self::PortfolioSnapshot,
        event: &Self::Event,
    ) -> Result<(), Self::Error>;
    fn pending_capital(
        &self,
        portfolio: Self::PortfolioSnapshot,
    ) -> Result<Self::PortfolioSnapshot, Self::Error>;
    fn execute_intents(
        &self,
        intents: Self::Intents,
        context: ExecutionContext<Self::MarketSnapshot, Self::PortfolioSnapshot>,
        mode: IntentMode,
    ) -> OwnedFuture<Vec<Self::Event>, Self::Error>;
    fn execution_tick(
        &self,
        context: ExecutionContext<Self::MarketSnapshot, Self::PortfolioSnapshot>,
    ) -> OwnedFuture<Vec<Self::Event>, Self::Error>;
    fn intents_empty(&self, intents: Option<&Self::Intents>) -> Result<bool, Self::Error>;
    fn log_intents(&self, intents: &Self::Intents, mode: IntentMode) -> Result<(), Self::Error>;
    fn strategy_tick(
        &self,
        strategy: &Self::Strategy,
        tick: Self::Tick,
        portfolio: Self::PortfolioSnapshot,
        context: Option<Self::Context>,
    ) -> OwnedFuture<Option<Self::Intents>, Self::Error>;
    fn strategy_account(
        &self,
        strategy: &Self::Strategy,
        event: Self::Event,
        portfolio: Self::PortfolioSnapshot,
        market: Option<Self::MarketSnapshot>,
        context: Option<Self::Context>,
    ) -> OwnedFuture<Option<Self::Intents>, Self::Error>;
    fn observe_context(&self, context: Option<&Self::Context>) -> Result<(), Self::Error>;
    fn observe_capital(&self, portfolio: &Self::PortfolioSnapshot) -> Result<(), Self::Error>;
    fn observes_capital(&self) -> bool;
    fn observe_decision(
        &self,
        origin: DecisionOrigin,
        intents: Option<&Self::Intents>,
    ) -> Result<(), Self::Error>;
    fn observe_account(
        &self,
        event: &Self::Event,
        portfolio: &Self::PortfolioSnapshot,
    ) -> Result<(), Self::Error>;
    /// Select the original detail object with the pinned kind-test order.
    fn event_detail(&self, event: &Self::Event) -> Result<Self::EventDetail, Self::Error>;
    fn detail_has(&self, detail: &Self::EventDetail, field: &str) -> Result<bool, Self::Error>;
    /// None denotes nullish only; false/0/empty-string keys stay present.
    fn detail_key(
        &self,
        detail: &Self::EventDetail,
        field: &str,
    ) -> Result<Option<Self::Key>, Self::Error>;
    /// Unlike detail_key, own/inherited undefined must be a real Map key.
    fn detail_present_key(
        &self,
        detail: &Self::EventDetail,
        field: &str,
    ) -> Result<Self::Key, Self::Error>;
    fn is_submission(&self, event: &Self::Event) -> Result<bool, Self::Error>;
    fn recent_event(&self, event: &Self::Event) -> Result<RecentEvent<Self::Key>, Self::Error>;
    fn is_fill(&self, event: &Self::Event) -> Result<bool, Self::Error>;
    fn is_cancel_failed(&self, event: &Self::Event) -> Result<bool, Self::Error>;
    /// Must evaluate Date(fill.tsMs).toISOString and fill arithmetic even when
    /// the optional logger is absent; exceptions precede Portfolio.apply.
    fn prepare_fill_log(&self, event: &Self::Event) -> Result<Self::FillLog, Self::Error>;
    fn log_fill(&self, event: &Self::Event, details: Self::FillLog) -> Result<(), Self::Error>;
    fn log_cancel_failed(&self, event: &Self::Event) -> Result<(), Self::Error>;
    fn log_drain_limit(
        &self,
        maximum: usize,
        remaining: usize,
        recent: &[RecentEvent<Self::Key>],
    ) -> Result<(), Self::Error>;
    /// Console warning is unconditional; the optional sink exception is caught.
    fn serial_warning(&self, warning: BacklogWarning);
    fn serial_failure(&self, label: EntryLabel, error: &Self::Error);
}

/// Atomic getters for the public strategy metadata surface. The runner owns
/// field order, truthiness, wrapper allocation and shared reference semantics;
/// bindings supply the current SDK slots and the same session graph.
pub trait RunnerMetadataBindings: RunnerBindings {
    fn metadata_graph(&self) -> crate::metadata::MetadataGraph;
    fn metadata_error(&self, error: crate::metadata::MetadataError) -> Self::Error;
    fn strategy_id(&self) -> crate::metadata::MetadataValue;
    fn strategy_params(&self) -> crate::metadata::MetadataValue;
    fn enabled_external_feeds(&self) -> crate::metadata::MetadataValue;
    fn strategy_name(
        &self,
        strategy: &Self::Strategy,
    ) -> Result<crate::metadata::MetadataValue, Self::Error>;
    fn strategy_required_feeds(
        &self,
        strategy: &Self::Strategy,
    ) -> Result<crate::metadata::MetadataValue, Self::Error>;
    fn plugin_ids(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<crate::metadata::MetadataHandle, Self::Error>;
}
fn strategy_metadata<B: RunnerMetadataBindings>(
    bindings: &B,
    strategy: &B::Strategy,
    plugins: Option<&B::PluginSet>,
) -> Result<Option<crate::metadata::MetadataHandle>, B::Error> {
    use crate::metadata::MetadataValue;
    if !bindings.strategy_id().is_truthy() || !bindings.strategy_params().is_truthy() {
        return Ok(None);
    }
    // The original reads requiredFeeds before constructing the return literal.
    let requested = bindings.strategy_required_feeds(strategy)?;
    let graph = bindings.metadata_graph();
    let root = graph.object().map_err(|e| bindings.metadata_error(e))?;
    root.set("id", bindings.strategy_id())
        .map_err(|e| bindings.metadata_error(e))?;
    root.set("name", bindings.strategy_name(strategy)?)
        .map_err(|e| bindings.metadata_error(e))?;
    root.set("params", bindings.strategy_params())
        .map_err(|e| bindings.metadata_error(e))?;
    let indicators = match plugins {
        Some(plugins) => bindings.plugin_ids(plugins)?,
        None => graph.array().map_err(|e| bindings.metadata_error(e))?,
    };
    root.set("indicators", indicators.into())
        .map_err(|e| bindings.metadata_error(e))?;
    let external = graph.object().map_err(|e| bindings.metadata_error(e))?;
    if requested.is_truthy() {
        external
            .set("requested", requested)
            .map_err(|e| bindings.metadata_error(e))?;
    }
    if bindings.enabled_external_feeds().is_truthy() {
        external
            .set("enabled", bindings.enabled_external_feeds())
            .map_err(|e| bindings.metadata_error(e))?;
    }
    root.set("externalFeeds", MetadataValue::Reference(external))
        .map_err(|e| bindings.metadata_error(e))?;
    Ok(Some(root))
}

pub struct RunnerOptions<B: RunnerBindings> {
    pub strategy: B::Strategy,
    pub portfolio: Option<B::Portfolio>,
    pub plugins: Option<B::PluginSet>,
    pub starting_capital: Option<f64>,
    pub intent_mode: IntentMode,
    pub max_events_per_drain: Option<f64>,
    pub skip_late_start_after_ms: Option<f64>,
}
pub struct RunnerCore<B: RunnerBindings> {
    bindings: B,
    strategy: B::Strategy,
    portfolio: B::Portfolio,
    public_portfolio: Rc<RefCell<B::Portfolio>>,
    public_strategy: Rc<RefCell<B::Strategy>>,
    public_market: Rc<RefCell<Option<B::MarketSnapshot>>>,
    plugins: Rc<RefCell<Option<B::PluginSet>>>,
    starting_capital: f64,
    mode: IntentMode,
    maximum: usize,
    late_limit: f64,
    last_market: Option<B::MarketSnapshot>,
    last_key: Option<B::Key>,
    portfolios: HashMap<B::Key, B::Portfolio>,
    by_asset: HashMap<B::Key, B::Key>,
    by_order: HashMap<B::Key, B::Key>,
    by_client: HashMap<B::Key, B::Key>,
    checked_late: Option<B::Key>,
    blocked_late: Option<B::Key>,
    waited_technical: Option<B::Key>,
    cached_plugins: Option<B::Plugins>,
    events: VecDeque<B::Event>,
    recent: VecDeque<RecentEvent<B::Key>>,
    draining: bool,
}
fn truthy_number(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}
fn number_or(x: f64, fallback: impl FnOnce() -> f64) -> f64 {
    if truthy_number(x) {
        x
    } else {
        fallback()
    }
}
impl<B: RunnerBindings> RunnerCore<B> {
    pub fn new(bindings: B, options: RunnerOptions<B>) -> Result<Self, B::Error> {
        let starting_capital = match options.starting_capital {
            Some(value) => value,
            None => match &options.portfolio {
                Some(p) => bindings
                    .starting_capital(&bindings.snapshot(p)?)?
                    .unwrap_or(500.0),
                None => 500.0,
            },
        };
        if !starting_capital.is_finite() || starting_capital < 0.0 {
            return Err(
                bindings.error("starting capital must be a finite non-negative number of USDC")
            );
        }
        let portfolio = match options.portfolio {
            Some(p) => p,
            None => bindings.new_portfolio(starting_capital)?,
        };
        let maximum = bindings.resolve_max_events(options.max_events_per_drain)?;
        Ok(Self {
            bindings,
            public_strategy: Rc::new(RefCell::new(options.strategy.clone())),
            strategy: options.strategy,
            public_portfolio: Rc::new(RefCell::new(portfolio.clone())),
            public_market: Rc::new(RefCell::new(None)),
            portfolio,
            plugins: Rc::new(RefCell::new(options.plugins)),
            starting_capital,
            mode: options.intent_mode,
            maximum,
            late_limit: js_max(0.0, options.skip_late_start_after_ms.unwrap_or(0.0).trunc()),
            last_market: None,
            last_key: None,
            portfolios: HashMap::new(),
            by_asset: HashMap::new(),
            by_order: HashMap::new(),
            by_client: HashMap::new(),
            checked_late: None,
            blocked_late: None,
            waited_technical: None,
            cached_plugins: None,
            events: VecDeque::new(),
            recent: VecDeque::new(),
            draining: false,
        })
    }
    pub fn portfolio(&self) -> B::Portfolio {
        self.portfolio.clone()
    }
    pub fn last_market(&self) -> Option<B::MarketSnapshot> {
        self.last_market.clone()
    }
    fn same_key(&self, a: Option<&B::Key>, b: Option<&B::Key>) -> bool {
        match (a, b) {
            (Some(a), Some(b)) => self.bindings.strict_equal(a, b),
            (None, None) => true,
            _ => false,
        }
    }
    fn truthy_key(&self, key: Option<&B::Key>) -> bool {
        key.is_some_and(|k| self.bindings.key_truthy(k))
    }
    fn plugin_set(&self) -> Option<B::PluginSet> {
        self.plugins.borrow().clone()
    }
    fn tick_time_or_now(&self, tick: &B::Tick) -> Result<f64, B::Error> {
        let snap = self.bindings.tick_snapshot(tick)?;
        Ok(number_or(self.bindings.market_timestamp(&snap)?, || {
            self.bindings.now()
        }))
    }
    fn execution_context(
        &self,
        now_ms: f64,
        portfolio: B::PortfolioSnapshot,
    ) -> ExecutionContext<B::MarketSnapshot, B::PortfolioSnapshot> {
        ExecutionContext {
            now_ms,
            last_market: self.last_market.clone(),
            portfolio,
        }
    }
    pub async fn process_market(&mut self, tick: B::Tick) -> Result<(), B::Error> {
        js_await(self.process_market_body(tick)).await?;
        if self.bindings.observes_capital() {
            let p = self.bindings.snapshot(&self.portfolio)?;
            let p = self.bindings.pending_capital(p)?;
            self.bindings.observe_capital(&p)?;
        }
        Ok(())
    }
    async fn process_market_body(&mut self, tick: B::Tick) -> Result<(), B::Error> {
        let market = self.bindings.get_market()?;
        let balance = self.bindings.get_balance()?;
        let warmup = self.bindings.get_warmup()?;
        let initial_snapshot = self.bindings.tick_snapshot(&tick)?;
        let key = self.bindings.market_key(&initial_snapshot)?;
        if self.truthy_key(key.as_ref())
            && self.truthy_key(self.last_key.as_ref())
            && !self.same_key(key.as_ref(), self.last_key.as_ref())
        {
            if !self.bindings.can_create_strategy() {
                return Err(self.bindings.error(
                    "A multi-market StrategyRunner requires createStrategy to reset player state",
                ));
            }
            let snap = self.bindings.snapshot(&self.portfolio)?;
            if let Some(cancel) = self.bindings.cancel_open_orders(&snap)? {
                // TS takes a second snapshot and reads the current tick timestamp.
                let now = self
                    .bindings
                    .market_timestamp(&self.bindings.tick_snapshot(&tick)?)?;
                let context = self.execution_context(now, self.bindings.snapshot(&self.portfolio)?);
                for event in js_await(self.bindings.execute_intents(
                    cancel,
                    context,
                    IntentMode::Immediate,
                ))
                .await?
                {
                    self.bindings.apply(&self.portfolio, &event)?;
                    self.bindings
                        .reconcile(&self.bindings.snapshot(&self.portfolio)?, &event)?;
                }
            }
            self.bindings.begin_market()?;
            self.portfolio = match self.portfolios.get(key.as_ref().expect("truthy key")) {
                Some(p) => p.clone(),
                None => self.bindings.new_portfolio(self.starting_capital)?,
            };
            *self.public_portfolio.borrow_mut() = self.portfolio.clone();
            let built = self.bindings.create_strategy()?;
            self.strategy = self.bindings.built_strategy(&built)?;
            *self.public_strategy.borrow_mut() = self.strategy.clone();
            if let Some(old) = self.plugin_set() {
                self.bindings.reset_plugins(&old)?;
            }
            *self.plugins.borrow_mut() = self.bindings.built_plugin_set(&built)?;
            if self.plugin_set().is_none() && self.bindings.built_has_plugins(&built)? {
                let set = self.bindings.new_plugin_set()?;
                *self.plugins.borrow_mut() = Some(set.clone());
                self.bindings.register_built_plugins(&set, &built)?;
            }
            self.cached_plugins = None;
            self.waited_technical = None;
            self.checked_late = None;
            self.blocked_late = None;
        }
        if self.truthy_key(key.as_ref()) {
            let key = key.clone().expect("truthy key");
            self.last_key = Some(key.clone());
            self.portfolios.insert(key.clone(), self.portfolio.clone());
            let snapshot = self.bindings.tick_snapshot(&tick)?;
            for asset in self.bindings.market_assets(&snapshot)? {
                self.by_asset.insert(asset, key.clone());
            }
        }
        self.last_market = Some(self.bindings.tick_snapshot(&tick)?);
        *self.public_market.borrow_mut() = self.last_market.clone();
        self.bindings
            .initialize_clock(&self.portfolio, self.tick_time_or_now(&tick)?)?;
        if !self.bindings.synthetic_tick(&tick)? {
            let context = self.execution_context(
                self.tick_time_or_now(&tick)?,
                self.bindings.snapshot(&self.portfolio)?,
            );
            self.events
                .extend(js_await(self.bindings.execution_tick(context)).await?);
            js_await(self.drain()).await?;
        }
        let portfolio = self.bindings.snapshot(&self.portfolio)?;
        let snapshot = self.bindings.tick_snapshot(&tick)?;
        let metrics = self
            .bindings
            .metrics(&portfolio, Some(&snapshot), market.as_ref())?;
        let parts = ContextParts {
            market,
            metrics,
            balance,
            warmup,
            plugins: None,
        };
        let base_context = self.bindings.context(parts.clone())?;
        if self.late_limit > 0.0
            && self.truthy_key(key.as_ref())
            && self.same_key(self.blocked_late.as_ref(), key.as_ref())
        {
            return Ok(());
        }
        if self.late_limit > 0.0
            && self.truthy_key(key.as_ref())
            && !self.same_key(self.checked_late.as_ref(), key.as_ref())
        {
            let timestamp = self
                .bindings
                .market_timestamp(&self.bindings.tick_snapshot(&tick)?)?;
            let start = if timestamp.is_finite() {
                self.bindings.parse_market_start(parts.market.as_ref())?
            } else {
                None
            };
            if let Some(start) = start {
                let elapsed = timestamp - start;
                if elapsed > self.late_limit {
                    self.bindings.log_late_start(
                        parts.market.as_ref(),
                        elapsed,
                        self.late_limit,
                    )?;
                    self.checked_late = key.clone();
                    self.blocked_late = key.clone();
                    return Ok(());
                }
            }
            self.checked_late = key.clone();
        }
        if let Some(plugins) = self.plugin_set() {
            self.bindings
                .update_plugins(&plugins, &tick, base_context)?;
        }
        let wait = self.bindings.wait_for_technical_indicators();
        if wait
            && self.plugin_set().is_some()
            && self.truthy_key(key.as_ref())
            && !self.same_key(self.waited_technical.as_ref(), key.as_ref())
        {
            let timeout = js_max(
                0.0,
                number_or(self.bindings.technical_timeout(), || 0.0).trunc(),
            );
            let poll = js_max(
                1.0,
                number_or(self.bindings.technical_poll(), || 10.0).trunc(),
            );
            let started = self.bindings.now();
            let plugins = self.plugin_set().expect("present plugin set");
            let mut snap = self.bindings.refresh_plugins(&plugins)?;
            while !self.bindings.technical_indicators_ready(snap.as_ref())?
                && self.bindings.now() - started < timeout
            {
                js_await(self.bindings.sleep(poll)).await?;
                snap = self.bindings.refresh_plugins(&plugins)?;
            }
            if !self.bindings.technical_indicators_ready(snap.as_ref())? {
                self.bindings
                    .warn_technical_timeout(key.as_ref().expect("truthy key"), timeout)?;
            }
            self.waited_technical = key.clone();
        }
        let plugins = match self.plugin_set() {
            Some(p) => self.bindings.plugins_snapshot(&p)?,
            None => None,
        };
        if let Some(p) = &plugins {
            if self.bindings.plugins_truthy(p) {
                self.cached_plugins = Some(p.clone());
            }
        }
        let context = self.bindings.context(ContextParts { plugins, ..parts })?;
        self.bindings.observe_context(context.as_ref())?;
        let decision_portfolio = self.bindings.pending_capital(portfolio.clone())?;
        if self.bindings.observes_capital() {
            self.bindings.observe_capital(&decision_portfolio)?;
        }
        let intents = js_await(self.bindings.strategy_tick(
            &self.strategy,
            tick.clone(),
            decision_portfolio,
            context,
        ))
        .await?;
        self.bindings
            .observe_decision(DecisionOrigin::Market, intents.as_ref())?;
        // The || Date.now expression is evaluated even for an empty decision.
        let now = self.tick_time_or_now(&tick)?;
        js_await(self.apply_intents(intents, Some(portfolio), Some(now))).await?;
        js_await(self.drain()).await
    }
    async fn apply_intents(
        &mut self,
        intents: Option<B::Intents>,
        portfolio: Option<B::PortfolioSnapshot>,
        now: Option<f64>,
    ) -> Result<(), B::Error> {
        if self.bindings.intents_empty(intents.as_ref())? {
            return Ok(());
        }
        let intents = intents.expect("nonempty intents");
        self.bindings.log_intents(&intents, self.mode)?;
        let portfolio = match portfolio {
            Some(p) => p,
            None => self.bindings.snapshot(&self.portfolio)?,
        };
        let now = match now {
            Some(x) => x,
            None => match &self.last_market {
                Some(m) => self.bindings.market_timestamp(m)?,
                None => self
                    .bindings
                    .portfolio_timestamp(&portfolio)?
                    .unwrap_or_else(|| self.bindings.now()),
            },
        };
        self.events.extend(
            js_await(self.bindings.execute_intents(
                intents,
                self.execution_context(now, portfolio),
                self.mode,
            ))
            .await?,
        );
        Ok(())
    }
    pub async fn process_account(&mut self, event: B::Event) -> Result<(), B::Error> {
        self.events.push_back(event);
        js_await(self.drain()).await
    }
    async fn drain(&mut self) -> Result<(), B::Error> {
        if self.draining {
            return Ok(());
        }
        self.draining = true;
        let result = self.drain_body().await;
        self.draining = false;
        result
    }
    async fn drain_body(&mut self) -> Result<(), B::Error> {
        let mut processed = 0;
        while !self.events.is_empty() {
            if processed >= self.maximum {
                let recent: Vec<_> = self.recent.iter().cloned().collect();
                self.bindings
                    .log_drain_limit(self.maximum, self.events.len(), &recent)?;
                self.events.clear();
                return Ok(());
            }
            let event = self.events.pop_front().expect("nonempty queue");
            processed += 1;
            self.recent.push_back(self.bindings.recent_event(&event)?);
            if self.recent.len() > 10 {
                self.recent.pop_front();
            }
            js_await(self.account_body(event)).await?;
        }
        Ok(())
    }
    fn route_market(&mut self, event: &B::Event) -> Result<Option<B::Key>, B::Error> {
        let detail = self.bindings.event_detail(event)?;
        let order_id = if self.bindings.detail_has(&detail, "orderId")? {
            self.bindings.detail_key(&detail, "orderId")?
        } else {
            None
        };
        let client_id = if self.bindings.detail_has(&detail, "clientOrderId")? {
            self.bindings.detail_key(&detail, "clientOrderId")?
        } else {
            None
        };
        let asset_id = if self.bindings.detail_has(&detail, "assetId")? {
            self.bindings.detail_key(&detail, "assetId")?
        } else if self.bindings.detail_has(&detail, "assetIdA")? {
            self.bindings.detail_key(&detail, "assetIdA")?
        } else {
            None
        };
        let explicit_market = if self.bindings.detail_has(&detail, "market")? {
            self.bindings.detail_key(&detail, "market")?
        } else {
            None
        };
        let lookup = |field: &Option<B::Key>, map: &HashMap<B::Key, B::Key>| {
            field
                .as_ref()
                .filter(|k| self.bindings.key_truthy(k))
                .and_then(|k| map.get(k))
                .cloned()
        };
        let market = explicit_market
            .or_else(|| lookup(&order_id, &self.by_order))
            .or_else(|| lookup(&asset_id, &self.by_asset))
            .or_else(|| lookup(&client_id, &self.by_client))
            .or_else(|| self.last_key.clone());
        if self.truthy_key(market.as_ref()) {
            let market = market.as_ref().expect("truthy key");
            if self.truthy_key(order_id.as_ref()) {
                self.by_order
                    .insert(order_id.expect("present key"), market.clone());
            }
            if self.truthy_key(client_id.as_ref()) && self.bindings.is_submission(event)? {
                self.by_client
                    .insert(client_id.expect("present key"), market.clone());
            }
            if self.truthy_key(asset_id.as_ref()) {
                self.by_asset
                    .insert(asset_id.expect("present key"), market.clone());
            }
            if self.bindings.detail_has(&detail, "assetIdB")? {
                self.by_asset.insert(
                    self.bindings.detail_present_key(&detail, "assetIdB")?,
                    market.clone(),
                );
            }
        }
        Ok(market)
    }
    async fn account_body(&mut self, event: B::Event) -> Result<(), B::Error> {
        let market = self.route_market(&event)?;
        if self.truthy_key(market.as_ref())
            && !self.same_key(market.as_ref(), self.last_key.as_ref())
        {
            let key = market.expect("truthy key");
            let portfolio = match self.portfolios.get(&key) {
                Some(p) => p.clone(),
                None => {
                    let p = self.bindings.new_portfolio(self.starting_capital)?;
                    self.portfolios.insert(key, p.clone());
                    p
                }
            };
            self.bindings.apply(&portfolio, &event)?;
            return Ok(());
        }
        if self.bindings.is_fill(&event)? {
            let details = self.bindings.prepare_fill_log(&event)?;
            self.bindings.log_fill(&event, details)?;
        }
        if self.bindings.is_cancel_failed(&event)? {
            self.bindings.log_cancel_failed(&event)?;
        }
        self.bindings.apply(&self.portfolio, &event)?;
        self.bindings
            .reconcile(&self.bindings.snapshot(&self.portfolio)?, &event)?;
        let portfolio = self.bindings.snapshot(&self.portfolio)?;
        let market = self.bindings.get_market()?;
        let balance = self.bindings.get_balance()?;
        let warmup = self.bindings.get_warmup()?;
        let metrics =
            self.bindings
                .metrics(&portfolio, self.last_market.as_ref(), market.as_ref())?;
        let plugins = match &self.cached_plugins {
            Some(p) => Some(p.clone()),
            None => match self.plugin_set() {
                Some(p) => self.bindings.plugins_snapshot(&p)?,
                None => None,
            },
        };
        let context = self.bindings.context(ContextParts {
            market,
            metrics,
            balance,
            warmup,
            plugins,
        })?;
        let decision_portfolio = self.bindings.pending_capital(portfolio.clone())?;
        self.bindings.observe_account(&event, &decision_portfolio)?;
        let intents = js_await(self.bindings.strategy_account(
            &self.strategy,
            event,
            decision_portfolio,
            self.last_market.clone(),
            context,
        ))
        .await?;
        self.bindings
            .observe_decision(DecisionOrigin::Account, intents.as_ref())?;
        if self.bindings.intents_empty(intents.as_ref())? {
            return Ok(());
        }
        let now = match &self.last_market {
            Some(m) => self.bindings.market_timestamp(m)?,
            None => f64::NAN,
        };
        let now = if truthy_number(now) {
            now
        } else {
            number_or(
                self.bindings
                    .portfolio_timestamp(&portfolio)?
                    .unwrap_or(f64::NAN),
                || self.bindings.now(),
            )
        };
        self.events.extend(
            js_await(self.bindings.execute_intents(
                intents.expect("nonempty intents"),
                self.execution_context(now, portfolio),
                self.mode,
            ))
            .await?,
        );
        Ok(())
    }
}

enum Entry<B: RunnerBindings> {
    Tick(B::Tick),
    Account(B::Event),
}
/// Cloneable synchronous ingress sees the CURRENT plugin set while a previous
/// body awaits. Serial entries own exact wrappers. Only the owning thread pumps.
pub struct Runner<B: RunnerBindings> {
    bindings: B,
    strategy: Rc<RefCell<B::Strategy>>,
    plugins: Rc<RefCell<Option<B::PluginSet>>>,
    core: Rc<RefCell<Option<RunnerCore<B>>>>,
    portfolio: Rc<RefCell<B::Portfolio>>,
    market: Rc<RefCell<Option<B::MarketSnapshot>>>,
    serial: FutureSerialDispatcher<'static, Entry<B>, B::Error>,
}
impl<B: RunnerBindings> Runner<B> {
    pub fn new(core: RunnerCore<B>) -> Self {
        Self {
            bindings: core.bindings.clone(),
            strategy: Rc::clone(&core.public_strategy),
            plugins: Rc::clone(&core.plugins),
            portfolio: Rc::clone(&core.public_portfolio),
            market: Rc::clone(&core.public_market),
            core: Rc::new(RefCell::new(Some(core))),
            serial: FutureSerialDispatcher::new(),
        }
    }
    /// Available during a pending strategy/execution Future; these are live
    /// wrapper handles, not snapshots of the runner body or graph.
    pub fn portfolio(&self) -> B::Portfolio {
        self.portfolio.borrow().clone()
    }
    pub fn last_market(&self) -> Option<B::MarketSnapshot> {
        self.market.borrow().clone()
    }
    pub fn submit_tick(&mut self, tick: B::Tick) -> Result<DispatchReceipt<B::Error>, B::Error> {
        let plugins = self.plugins.borrow().clone();
        if let Some(p) = plugins {
            self.bindings.capture_tick(&p, &tick)?;
        }
        let receipt = self.serial.enqueue(EntryLabel::Tick, Entry::Tick(tick));
        self.warnings();
        Ok(receipt)
    }
    pub fn submit_account(&mut self, event: B::Event) -> DispatchReceipt<B::Error> {
        let receipt = self
            .serial
            .enqueue(EntryLabel::Account, Entry::Account(event));
        self.warnings();
        receipt
    }
    fn warnings(&mut self) {
        for warning in self.serial.take_warnings() {
            self.bindings.serial_warning(warning);
        }
    }
    pub fn depth(&self) -> usize {
        self.serial.depth()
    }
    pub fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<()> {
        let shared = Rc::clone(&self.core);
        let result = self.serial.poll_ready(cx, &mut |entry| {
            let mut core = shared
                .borrow_mut()
                .take()
                .expect("FIFO permits one active runner body");
            let shared = Rc::clone(&shared);
            Ok(FutureDisposition::Deferred(Box::pin(async move {
                let result = match entry {
                    Entry::Tick(tick) => core.process_market(tick).await,
                    Entry::Account(event) => core.process_account(event).await,
                };
                *shared.borrow_mut() = Some(core);
                result
            })))
        });
        for (label, error) in self.serial.take_failures() {
            self.bindings.serial_failure(label, &error);
        }
        result
    }
}

impl<B: RunnerMetadataBindings> Runner<B> {
    /// Read current strategy/plugin roots while a strategy or execution awaits.
    /// Every successful call returns new wrappers and retains original params,
    /// requested/enabled feeds and nested graph references.
    pub fn get_strategy_meta(&self) -> Result<Option<crate::metadata::MetadataHandle>, B::Error> {
        let strategy = self.strategy.borrow().clone();
        let plugins = self.plugins.borrow().clone();
        strategy_metadata(&self.bindings, &strategy, plugins.as_ref())
    }
}
impl<B: RunnerMetadataBindings> RunnerCore<B> {
    pub fn get_strategy_meta(&self) -> Result<Option<crate::metadata::MetadataHandle>, B::Error> {
        let plugins = self.plugin_set();
        strategy_metadata(&self.bindings, &self.strategy, plugins.as_ref())
    }
}
