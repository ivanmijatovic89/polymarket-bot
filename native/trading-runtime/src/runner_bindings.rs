//! Concrete shared runner accounting and SDK bindings. The host supplies only
//! external providers, strategy/plugin callbacks and diagnostics; accounting and
//! intent execution always call the one native Portfolio and OrderManager.
//! Accepted ticks already own authoritative graph roots. Raw ingress allocation
//! and complete generic coercion remain separate required integration surfaces.
use crate::{
    event_dispatch::{BacklogWarning, EntryLabel},
    intent::{managed as g, ManagedIntent, ManagedIntents},
    metadata::{JsException, MetadataError, MetadataGraph, MetadataHandle, MetadataValue},
    order_manager::{ExecutionAdapter, OrderManager, OrderManagerContext},
    portfolio::{PortfolioIngressError, PortfolioOptions},
    portfolio_records::{ManagedAccountEvent, PortfolioSnapshotRecord},
    runner::*,
    sdk_context::ContextHandle,
    sdk_snapshot::{MarketSnapshotHandle, TickHandle},
    sdk_value::{strict_equal, JsMapKey},
};

/// Required atomic boundary methods. No host method replaces runner processing,
/// Portfolio accounting, pending-capital accounting or OrderManager decisions.
pub trait RunnerHost: Clone + 'static {
    type PluginSet: Clone + 'static;
    fn graph(&self) -> MetadataGraph;
    fn error(&self, message: &str) -> JsException;
    fn error_named(&self, name: &str, message: &str) -> JsException;
    fn now(&self) -> f64;
    fn sleep(&self, ms: f64) -> OwnedFuture<(), JsException>;
    fn resolve_max_events(&self, override_value: Option<f64>) -> Result<usize, JsException>;
    fn get_market(&self) -> Result<Option<MetadataValue>, JsException>;
    fn get_balance(&self) -> Result<Option<MetadataValue>, JsException>;
    fn get_warmup(&self) -> Result<Option<MetadataValue>, JsException>;
    fn can_create_strategy(&self) -> bool;
    fn create_strategy(&self) -> Result<MetadataHandle, JsException>;
    fn built_strategy(&self, built: &MetadataHandle) -> Result<MetadataHandle, JsException>;
    fn built_plugin_set(
        &self,
        built: &MetadataHandle,
    ) -> Result<Option<Self::PluginSet>, JsException>;
    fn built_has_plugins(&self, built: &MetadataHandle) -> Result<bool, JsException>;
    fn new_plugin_set(&self) -> Result<Self::PluginSet, JsException>;
    fn register_built_plugins(
        &self,
        set: &Self::PluginSet,
        built: &MetadataHandle,
    ) -> Result<(), JsException>;
    fn reset_plugins(&self, plugins: &Self::PluginSet) -> Result<(), JsException>;
    fn capture_tick(&self, plugins: &Self::PluginSet, tick: &TickHandle)
        -> Result<(), JsException>;
    fn update_plugins(
        &self,
        plugins: &Self::PluginSet,
        tick: &TickHandle,
        context: Option<ContextHandle>,
    ) -> Result<(), JsException>;
    fn plugins_snapshot(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<MetadataValue>, JsException>;
    fn refresh_plugins(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<MetadataValue>, JsException>;
    fn technical_indicators_ready(
        &self,
        plugins: Option<&MetadataValue>,
    ) -> Result<bool, JsException>;
    fn wait_for_technical_indicators(&self) -> bool;
    fn technical_timeout(&self) -> f64;
    fn technical_poll(&self) -> f64;
    fn warn_technical_timeout(&self, market: &JsMapKey, timeout: f64) -> Result<(), JsException>;
    fn parse_market_start(
        &self,
        market: Option<&MetadataValue>,
    ) -> Result<Option<f64>, JsException>;
    fn log_late_start(
        &self,
        market: Option<&MetadataValue>,
        elapsed: f64,
        maximum: f64,
    ) -> Result<(), JsException>;

    fn log_intents(&self, intents: &ManagedIntents, mode: IntentMode) -> Result<(), JsException>;
    fn strategy_tick(
        &self,
        strategy: &MetadataHandle,
        tick: TickHandle,
        portfolio: PortfolioSnapshotRecord,
        context: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException>;
    fn strategy_account(
        &self,
        strategy: &MetadataHandle,
        event: ManagedAccountEvent,
        portfolio: PortfolioSnapshotRecord,
        market: Option<MarketSnapshotHandle>,
        context: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException>;
    fn observe_context(&self, context: Option<&ContextHandle>) -> Result<(), JsException>;
    fn observe_capital(&self, portfolio: &PortfolioSnapshotRecord) -> Result<(), JsException>;
    fn observes_capital(&self) -> bool;
    fn observe_decision(
        &self,
        origin: DecisionOrigin,
        intents: Option<&ManagedIntents>,
    ) -> Result<(), JsException>;
    fn observe_account(
        &self,
        event: &ManagedAccountEvent,
        portfolio: &PortfolioSnapshotRecord,
    ) -> Result<(), JsException>;

    fn log_fill(
        &self,
        event: &ManagedAccountEvent,
        details: MetadataValue,
    ) -> Result<(), JsException>;
    fn log_cancel_failed(&self, event: &ManagedAccountEvent) -> Result<(), JsException>;
    fn log_drain_limit(
        &self,
        maximum: usize,
        remaining: usize,
        recent: &[RecentEvent<JsMapKey>],
    ) -> Result<(), JsException>;
    fn serial_warning(&self, warning: BacklogWarning);
    fn serial_failure(&self, label: EntryLabel, error: &JsException);
    fn strategy_id(&self) -> MetadataValue;
    fn strategy_params(&self) -> MetadataValue;
    fn enabled_external_feeds(&self) -> MetadataValue;
    fn plugin_ids(&self, set: &Self::PluginSet) -> Result<MetadataHandle, JsException>;
}

pub struct NativeRunnerBindings<
    H: RunnerHost,
    A: ExecutionAdapter<MarketSnapshot = MarketSnapshotHandle, Error = JsException>,
> {
    pub host: H,
    pub order_manager: OrderManager<A>,
}
impl<
        H: RunnerHost,
        A: ExecutionAdapter<MarketSnapshot = MarketSnapshotHandle, Error = JsException>,
    > Clone for NativeRunnerBindings<H, A>
{
    fn clone(&self) -> Self {
        Self {
            host: self.host.clone(),
            order_manager: self.order_manager.clone(),
        }
    }
}
fn optional_number(value: MetadataValue) -> Result<Option<f64>, JsException> {
    match value {
        MetadataValue::Missing | MetadataValue::Null => Ok(None),
        MetadataValue::Number(n) => Ok(Some(n)),
        _ => Err(MetadataError::WrongKind.into()),
    }
}
fn property(value: &MetadataValue, key: &str) -> Result<MetadataValue, JsException> {
    g::object(value.clone())?.get_property(key)
}
fn has_property(value: &MetadataValue, key: &str) -> Result<bool, JsException> {
    let mut object = Some(g::object(value.clone())?);
    while let Some(handle) = object {
        if handle.own_descriptor(key)?.is_some() {
            return Ok(true);
        }
        object = handle.prototype()?;
    }
    Ok(false)
}
fn event_kind(event: &ManagedAccountEvent, name: &str) -> Result<bool, JsException> {
    Ok(g::is_string(&event.envelope().get_property("kind")?, name))
}
fn execution_context(
    context: ExecutionContext<MarketSnapshotHandle, PortfolioSnapshotRecord>,
) -> OrderManagerContext<MarketSnapshotHandle> {
    OrderManagerContext {
        now_ms: context.now_ms,
        last_market: context.last_market,
        portfolio: Some(context.portfolio),
    }
}
impl<
        H: RunnerHost,
        A: ExecutionAdapter<MarketSnapshot = MarketSnapshotHandle, Error = JsException>,
    > RunnerBindings for NativeRunnerBindings<H, A>
{
    type Error = JsException;
    type Key = JsMapKey;
    type Tick = TickHandle;
    type MarketSnapshot = MarketSnapshotHandle;
    type Portfolio = SharedPortfolio;
    type PortfolioSnapshot = PortfolioSnapshotRecord;
    type Strategy = MetadataHandle;
    type BuiltPlayer = MetadataHandle;
    type Plugins = MetadataValue;
    type MarketMeta = MetadataValue;
    type Balance = MetadataValue;
    type Warmup = MetadataValue;
    type Metrics = MetadataValue;
    type Context = ContextHandle;
    type Intents = ManagedIntents;
    type Event = ManagedAccountEvent;
    type EventDetail = MetadataValue;
    type FillLog = MetadataValue;
    type PluginSet = H::PluginSet;
    fn error(&self, message: &str) -> JsException {
        self.host.error(message)
    }
    fn now(&self) -> f64 {
        self.host.now()
    }
    fn sleep(&self, ms: f64) -> OwnedFuture<(), JsException> {
        self.host.sleep(ms)
    }
    fn resolve_max_events(&self, override_value: Option<f64>) -> Result<usize, JsException> {
        self.host.resolve_max_events(override_value)
    }
    fn get_market(&self) -> Result<Option<MetadataValue>, JsException> {
        self.host.get_market()
    }
    fn get_balance(&self) -> Result<Option<MetadataValue>, JsException> {
        self.host.get_balance()
    }
    fn get_warmup(&self) -> Result<Option<MetadataValue>, JsException> {
        self.host.get_warmup()
    }
    fn can_create_strategy(&self) -> bool {
        self.host.can_create_strategy()
    }
    fn create_strategy(&self) -> Result<MetadataHandle, JsException> {
        self.host.create_strategy()
    }
    fn built_strategy(&self, built: &MetadataHandle) -> Result<MetadataHandle, JsException> {
        self.host.built_strategy(built)
    }
    fn built_plugin_set(
        &self,
        built: &MetadataHandle,
    ) -> Result<Option<Self::PluginSet>, JsException> {
        self.host.built_plugin_set(built)
    }
    fn built_has_plugins(&self, built: &MetadataHandle) -> Result<bool, JsException> {
        self.host.built_has_plugins(built)
    }
    fn new_plugin_set(&self) -> Result<Self::PluginSet, JsException> {
        self.host.new_plugin_set()
    }
    fn register_built_plugins(
        &self,
        set: &Self::PluginSet,
        built: &MetadataHandle,
    ) -> Result<(), JsException> {
        self.host.register_built_plugins(set, built)
    }
    fn reset_plugins(&self, plugins: &Self::PluginSet) -> Result<(), JsException> {
        self.host.reset_plugins(plugins)
    }
    fn capture_tick(
        &self,
        plugins: &Self::PluginSet,
        tick: &TickHandle,
    ) -> Result<(), JsException> {
        self.host.capture_tick(plugins, tick)
    }
    fn update_plugins(
        &self,
        plugins: &Self::PluginSet,
        tick: &TickHandle,
        context: Option<ContextHandle>,
    ) -> Result<(), JsException> {
        self.host.update_plugins(plugins, tick, context)
    }
    fn plugins_snapshot(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<MetadataValue>, JsException> {
        self.host.plugins_snapshot(plugins)
    }
    fn plugins_truthy(&self, plugins: &MetadataValue) -> bool {
        plugins.is_truthy()
    }
    fn refresh_plugins(
        &self,
        plugins: &Self::PluginSet,
    ) -> Result<Option<MetadataValue>, JsException> {
        self.host.refresh_plugins(plugins)
    }
    fn technical_indicators_ready(
        &self,
        plugins: Option<&MetadataValue>,
    ) -> Result<bool, JsException> {
        self.host.technical_indicators_ready(plugins)
    }
    fn wait_for_technical_indicators(&self) -> bool {
        self.host.wait_for_technical_indicators()
    }
    fn technical_timeout(&self) -> f64 {
        self.host.technical_timeout()
    }
    fn technical_poll(&self) -> f64 {
        self.host.technical_poll()
    }
    fn warn_technical_timeout(&self, market: &JsMapKey, timeout: f64) -> Result<(), JsException> {
        self.host.warn_technical_timeout(market, timeout)
    }
    fn parse_market_start(
        &self,
        market: Option<&MetadataValue>,
    ) -> Result<Option<f64>, JsException> {
        self.host.parse_market_start(market)
    }
    fn log_late_start(
        &self,
        market: Option<&MetadataValue>,
        elapsed: f64,
        maximum: f64,
    ) -> Result<(), JsException> {
        self.host.log_late_start(market, elapsed, maximum)
    }
    fn metrics(
        &self,
        portfolio: &PortfolioSnapshotRecord,
        books: Option<&MarketSnapshotHandle>,
        market: Option<&MetadataValue>,
    ) -> Result<Option<MetadataValue>, JsException> {
        graph_metrics(&self.host.graph(), portfolio, books, market)
    }
    fn log_intents(&self, intents: &ManagedIntents, mode: IntentMode) -> Result<(), JsException> {
        self.host.log_intents(intents, mode)
    }
    fn strategy_tick(
        &self,
        strategy: &MetadataHandle,
        tick: TickHandle,
        portfolio: PortfolioSnapshotRecord,
        context: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException> {
        self.host.strategy_tick(strategy, tick, portfolio, context)
    }
    fn strategy_account(
        &self,
        strategy: &MetadataHandle,
        event: ManagedAccountEvent,
        portfolio: PortfolioSnapshotRecord,
        market: Option<MarketSnapshotHandle>,
        context: Option<ContextHandle>,
    ) -> OwnedFuture<Option<ManagedIntents>, JsException> {
        self.host
            .strategy_account(strategy, event, portfolio, market, context)
    }
    fn observe_context(&self, context: Option<&ContextHandle>) -> Result<(), JsException> {
        self.host.observe_context(context)
    }
    fn observe_capital(&self, portfolio: &PortfolioSnapshotRecord) -> Result<(), JsException> {
        self.host.observe_capital(portfolio)
    }
    fn observes_capital(&self) -> bool {
        self.host.observes_capital()
    }
    fn observe_decision(
        &self,
        origin: DecisionOrigin,
        intents: Option<&ManagedIntents>,
    ) -> Result<(), JsException> {
        self.host.observe_decision(origin, intents)
    }
    fn observe_account(
        &self,
        event: &ManagedAccountEvent,
        portfolio: &PortfolioSnapshotRecord,
    ) -> Result<(), JsException> {
        self.host.observe_account(event, portfolio)
    }
    fn prepare_fill_log(&self, event: &ManagedAccountEvent) -> Result<MetadataValue, JsException> {
        prepare_fill(&self.host, event)
    }
    fn log_fill(
        &self,
        event: &ManagedAccountEvent,
        details: MetadataValue,
    ) -> Result<(), JsException> {
        self.host.log_fill(event, details)
    }
    fn log_cancel_failed(&self, event: &ManagedAccountEvent) -> Result<(), JsException> {
        self.host.log_cancel_failed(event)
    }
    fn log_drain_limit(
        &self,
        maximum: usize,
        remaining: usize,
        recent: &[RecentEvent<JsMapKey>],
    ) -> Result<(), JsException> {
        self.host.log_drain_limit(maximum, remaining, recent)
    }
    fn serial_warning(&self, warning: BacklogWarning) {
        self.host.serial_warning(warning)
    }
    fn serial_failure(&self, label: EntryLabel, error: &JsException) {
        self.host.serial_failure(label, error)
    }

    fn key_truthy(&self, key: &JsMapKey) -> bool {
        key.is_truthy()
    }
    fn strict_equal(&self, a: &JsMapKey, b: &JsMapKey) -> bool {
        strict_equal(&a.value(), &b.value())
    }
    fn tick_snapshot(&self, tick: &TickHandle) -> Result<MarketSnapshotHandle, JsException> {
        tick.snapshot()
    }
    fn market_key(&self, market: &MarketSnapshotHandle) -> Result<Option<JsMapKey>, JsException> {
        let value = market.market()?;
        Ok(
            if matches!(value, MetadataValue::Missing | MetadataValue::Null) {
                None
            } else {
                Some(JsMapKey::from_value(&value))
            },
        )
    }
    fn market_assets(&self, market: &MarketSnapshotHandle) -> Result<Vec<JsMapKey>, JsException> {
        let books = g::object(market.by_asset_id()?)?;
        let mut keys = Vec::new();
        for key in books.own_property_keys()? {
            if books
                .own_descriptor(key.clone())?
                .is_some_and(|d| d.enumerable())
            {
                keys.push(JsMapKey::from_value(&MetadataValue::String(key)));
            }
        }
        Ok(keys)
    }
    fn market_timestamp(&self, market: &MarketSnapshotHandle) -> Result<f64, JsException> {
        Ok(g::number(market.timestamp()?)?)
    }
    fn synthetic_tick(&self, tick: &TickHandle) -> Result<bool, JsException> {
        let msg = tick.msg()?;
        if g::is_string(&property(&msg, "event_type")?, "binance_agg_trade") {
            return Ok(true);
        }
        Ok(g::is_string(
            &property(&msg, "event_type")?,
            "chainlink_round",
        ))
    }
    fn new_portfolio(&self, starting_capital: f64) -> Result<SharedPortfolio, JsException> {
        SharedPortfolio::new_in_graph(
            &self.host.graph(),
            PortfolioOptions {
                starting_capital,
                ..PortfolioOptions::default()
            },
            self.host.now(),
        )
        .map_err(|e| self.host.error(e))
    }
    fn snapshot(
        &self,
        portfolio: &SharedPortfolio,
    ) -> Result<PortfolioSnapshotRecord, JsException> {
        Ok(portfolio.snapshot()?)
    }
    fn starting_capital(
        &self,
        snapshot: &PortfolioSnapshotRecord,
    ) -> Result<Option<f64>, JsException> {
        let capital = snapshot.handle().as_handle().get_property("capital")?;
        optional_number(property(&capital, "startingCapital")?)
    }
    fn portfolio_timestamp(
        &self,
        snapshot: &PortfolioSnapshotRecord,
    ) -> Result<Option<f64>, JsException> {
        optional_number(snapshot.handle().as_handle().get_property("nowMs")?)
    }
    fn initialize_clock(&self, portfolio: &SharedPortfolio, time: f64) -> Result<(), JsException> {
        portfolio.initialize_clock(time);
        Ok(())
    }
    fn apply(
        &self,
        portfolio: &SharedPortfolio,
        event: &ManagedAccountEvent,
    ) -> Result<(), JsException> {
        portfolio.apply(event).map_err(|e| match e {
            PortfolioIngressError::Graph(e) => JsException::Native(e),
            e => self.host.error(&e.to_string()),
        })
    }
    fn cancel_open_orders(
        &self,
        snapshot: &PortfolioSnapshotRecord,
    ) -> Result<Option<ManagedIntents>, JsException> {
        let map = g::object(
            snapshot
                .handle()
                .as_handle()
                .get_property("openOrdersByClientId")?,
        )?;
        let orders = self.host.graph().array()?;
        for key in map.own_property_keys()? {
            if map
                .own_descriptor(key.clone())?
                .is_some_and(|d| d.enumerable())
            {
                orders.push(map.get_property(key)?)?;
            }
        }
        if orders.length()? == 0 {
            return Ok(None);
        }
        let intent = self.host.graph().object()?;
        intent.set("kind", "cancel_batch".into())?;
        intent.set("orders", orders.into())?;
        Ok(Some(ManagedIntents::new_in_graph(
            &self.host.graph(),
            [ManagedIntent::from_handle(intent)?],
        )?))
    }
    fn context(
        &self,
        parts: BindingContextParts<Self>,
    ) -> Result<Option<ContextHandle>, JsException> {
        Ok(ContextHandle::full(
            &self.host.graph(),
            &crate::sdk_context::ContextParts {
                plugins: parts.plugins.unwrap_or(MetadataValue::Missing),
                market: parts.market.unwrap_or(MetadataValue::Missing),
                metrics: parts.metrics.unwrap_or(MetadataValue::Missing),
                balance: parts.balance.unwrap_or(MetadataValue::Missing),
                warmup: parts.warmup.unwrap_or(MetadataValue::Missing),
            },
        )?)
    }
    fn begin_market(&self) -> Result<(), JsException> {
        self.order_manager.begin_market();
        Ok(())
    }
    fn reconcile(
        &self,
        portfolio: &PortfolioSnapshotRecord,
        event: &ManagedAccountEvent,
    ) -> Result<(), JsException> {
        self.order_manager.reconcile(portfolio, event)
    }
    fn pending_capital(
        &self,
        portfolio: PortfolioSnapshotRecord,
    ) -> Result<PortfolioSnapshotRecord, JsException> {
        self.order_manager.with_pending_capital(&portfolio)
    }
    fn execute_intents(
        &self,
        intents: ManagedIntents,
        context: ExecutionContext<MarketSnapshotHandle, PortfolioSnapshotRecord>,
        mode: IntentMode,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, JsException> {
        self.order_manager
            .handle_intents(intents, execution_context(context), mode)
    }
    fn execution_tick(
        &self,
        context: ExecutionContext<MarketSnapshotHandle, PortfolioSnapshotRecord>,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, JsException> {
        self.order_manager
            .on_market_tick(execution_context(context))
    }
    fn intents_empty(&self, intents: Option<&ManagedIntents>) -> Result<bool, JsException> {
        match intents {
            None => Ok(true),
            Some(intents) => Ok(
                matches!(intents.handle().get_property("length")?,MetadataValue::Number(n) if n==0.0),
            ),
        }
    }
    fn event_detail(&self, event: &ManagedAccountEvent) -> Result<MetadataValue, JsException> {
        if event_kind(event, "fill")? {
            event.envelope().get_property("fill")
        } else if event_kind(event, "positions_split")? {
            event.envelope().get_property("split")
        } else if event_kind(event, "order_submitted")? || event_kind(event, "ws_order_update")? {
            event.envelope().get_property("order")
        } else {
            Ok(event.envelope().clone().into())
        }
    }
    fn detail_has(&self, detail: &MetadataValue, field: &str) -> Result<bool, JsException> {
        has_property(detail, field)
    }
    fn detail_key(
        &self,
        detail: &MetadataValue,
        field: &str,
    ) -> Result<Option<JsMapKey>, JsException> {
        let v = property(detail, field)?;
        Ok(
            if matches!(v, MetadataValue::Null | MetadataValue::Missing) {
                None
            } else {
                Some(JsMapKey::from_value(&v))
            },
        )
    }
    fn detail_present_key(
        &self,
        detail: &MetadataValue,
        field: &str,
    ) -> Result<JsMapKey, JsException> {
        Ok(JsMapKey::from_value(&property(detail, field)?))
    }
    fn is_submission(&self, event: &ManagedAccountEvent) -> Result<bool, JsException> {
        event_kind(event, "order_submitted")
    }
    fn recent_event(
        &self,
        event: &ManagedAccountEvent,
    ) -> Result<RecentEvent<JsMapKey>, JsException> {
        let kind = JsMapKey::from_value(&event.envelope().get_property("kind")?);
        let timestamp = event.envelope().get_property("tsMs")?;
        Ok(RecentEvent {
            kind,
            outer_timestamp_ms: if let MetadataValue::Number(n) = timestamp {
                Some(n)
            } else {
                None
            },
        })
    }
    fn is_fill(&self, event: &ManagedAccountEvent) -> Result<bool, JsException> {
        event_kind(event, "fill")
    }
    fn is_cancel_failed(&self, event: &ManagedAccountEvent) -> Result<bool, JsException> {
        event_kind(event, "cancel_failed")
    }
}
impl<
        H: RunnerHost,
        A: ExecutionAdapter<MarketSnapshot = MarketSnapshotHandle, Error = JsException>,
    > RunnerMetadataBindings for NativeRunnerBindings<H, A>
{
    fn metadata_graph(&self) -> MetadataGraph {
        self.host.graph()
    }
    fn metadata_error(&self, error: MetadataError) -> JsException {
        error.into()
    }
    fn strategy_id(&self) -> MetadataValue {
        self.host.strategy_id()
    }
    fn strategy_params(&self) -> MetadataValue {
        self.host.strategy_params()
    }
    fn enabled_external_feeds(&self) -> MetadataValue {
        self.host.enabled_external_feeds()
    }
    fn strategy_name(&self, strategy: &MetadataHandle) -> Result<MetadataValue, JsException> {
        strategy.get_property("name")
    }
    fn strategy_required_feeds(
        &self,
        strategy: &MetadataHandle,
    ) -> Result<MetadataValue, JsException> {
        strategy.get_property("requiredFeeds")
    }
    fn plugin_ids(&self, plugins: &H::PluginSet) -> Result<MetadataHandle, JsException> {
        self.host.plugin_ids(plugins)
    }
}

fn finite_number(value: MetadataValue) -> f64 {
    match value {
        MetadataValue::Number(n) if n.is_finite() => n,
        _ => 0.0,
    }
}
fn optional_property(value: &MetadataValue, key: &str) -> Result<MetadataValue, JsException> {
    if matches!(value, MetadataValue::Missing | MetadataValue::Null) {
        Ok(MetadataValue::Missing)
    } else {
        property(value, key)
    }
}
fn keyed(value: &MetadataValue, key: MetadataValue) -> Result<MetadataValue, JsException> {
    g::object(value.clone())?.get_property(crate::sdk_value::to_property_key(key)?)
}
fn metric_position(
    graph: &MetadataGraph,
    portfolio: &PortfolioSnapshotRecord,
    market: &MetadataValue,
) -> Result<Option<MetadataHandle>, JsException> {
    if !market.is_truthy() {
        return Ok(None);
    }
    // Wrapper reads each truthy ID twice when installing its optional argument.
    let up = property(market, "upAssetId")?;
    let up = if up.is_truthy() {
        property(market, "upAssetId")?
    } else {
        MetadataValue::Missing
    };
    let down = property(market, "downAssetId")?;
    let down = if down.is_truthy() {
        property(market, "downAssetId")?
    } else {
        MetadataValue::Missing
    };
    if !up.is_truthy() || !down.is_truthy() {
        return Ok(None);
    }
    let up = keyed(
        &portfolio
            .handle()
            .as_handle()
            .get_property("positionsByAssetId")?,
        up,
    )?;
    let down = keyed(
        &portfolio
            .handle()
            .as_handle()
            .get_property("positionsByAssetId")?,
        down,
    )?;
    let up_shares = finite_number(optional_property(&up, "qty")?);
    let down_shares = finite_number(optional_property(&down, "qty")?);
    let up_cost = finite_number(optional_property(&up, "costBasis")?);
    let down_cost = finite_number(optional_property(&down, "costBasis")?);
    let total = up_cost + down_cost;
    let pair = if up_shares > 0.0 && down_shares > 0.0 {
        MetadataValue::Number(up_cost / up_shares + down_cost / down_shares)
    } else {
        MetadataValue::Null
    };
    let merge = crate::math::js_min(up_shares, down_shares);
    Ok(Some(g::pairs(
        graph,
        [
            ("shares_mergeable", merge.into()),
            ("pair_avg", pair),
            ("total_cost", total.into()),
            ("pnl_merge", (merge - total).into()),
            ("pnl_if_up_wins", (up_shares - total).into()),
            ("pnl_if_down_wins", (down_shares - total).into()),
            ("imbalance", (up_shares - down_shares).into()),
        ],
    )?))
}
fn weak_side(
    graph: &MetadataGraph,
    up: MetadataValue,
    down: MetadataValue,
) -> Result<(MetadataValue, f64), JsException> {
    let up = crate::math::js_max(0.0, finite_number(up));
    let down = crate::math::js_max(0.0, finite_number(down));
    let (side, ratio) = if up == down {
        ("NONE", 1.0)
    } else {
        (
            if up < down { "UP" } else { "DOWN" },
            if crate::math::js_max(up, down) > 0.0 {
                crate::math::js_min(up, down) / crate::math::js_max(up, down)
            } else {
                0.0
            },
        )
    };
    let _ = graph;
    Ok((side.into(), ratio))
}
fn metric_orderbook(
    graph: &MetadataGraph,
    books: &MarketSnapshotHandle,
    market: &MetadataValue,
) -> Result<Option<MetadataHandle>, JsException> {
    if !market.is_truthy() {
        return Ok(None);
    }
    let up_id = property(market, "upAssetId")?;
    let down_id = property(market, "downAssetId")?;
    if !up_id.is_truthy() || !down_id.is_truthy() {
        return Ok(None);
    }
    let up = keyed(&books.by_asset_id()?, up_id)?;
    let down = keyed(&books.by_asset_id()?, down_id)?;
    if !up.is_truthy() || !down.is_truthy() {
        return Ok(None);
    }
    let mut levels = crate::math::js_min(
        finite_number(property(&up, "depthLevels")?).floor(),
        finite_number(property(&down, "depthLevels")?).floor(),
    );
    for (book, name) in [
        (&up, "bidsDepthByLevel"),
        (&down, "bidsDepthByLevel"),
        (&up, "asksDepthByLevel"),
        (&down, "asksDepthByLevel"),
    ] {
        let array = property(book, name)?;
        let length = optional_property(&array, "length")?;
        let length = if matches!(length, MetadataValue::Missing | MetadataValue::Null) {
            0.0
        } else {
            g::number(length)?
        };
        levels = crate::math::js_min(levels, length);
    }
    levels = crate::math::js_max(0.0, levels);
    let bids = graph.array()?;
    let bidratios = graph.array()?;
    let asks = graph.array()?;
    let askratios = graph.array()?;
    let mut i = 0.0;
    while i < levels {
        let key = crate::math::js_number_string(i);
        let (side, ratio) = weak_side(
            graph,
            property(&property(&up, "bidsDepthByLevel")?, &key)?,
            property(&property(&down, "bidsDepthByLevel")?, &key)?,
        )?;
        bids.push(side)?;
        bidratios.push(ratio.into())?;
        let (side, ratio) = weak_side(
            graph,
            property(&property(&up, "asksDepthByLevel")?, &key)?,
            property(&property(&down, "asksDepthByLevel")?, &key)?,
        )?;
        asks.push(side)?;
        askratios.push(ratio.into())?;
        i += 1.0;
    }
    Ok(Some(g::pairs(
        graph,
        [
            ("depthLevels", levels.into()),
            ("weakBidSideByLevel", bids.into()),
            ("weakBidRatioByLevel", bidratios.into()),
            ("weakAskSideByLevel", asks.into()),
            ("weakAskRatioByLevel", askratios.into()),
        ],
    )?))
}
/// Current graph slots, getter timing and freshly allocated metric wrapper match
/// the shared TS helpers. Primitive object-key coercion is integrated; arbitrary
/// object ToPropertyKey/primitive boxing remain explicit SDK operator work.
pub fn graph_metrics(
    graph: &MetadataGraph,
    portfolio: &PortfolioSnapshotRecord,
    books: Option<&MarketSnapshotHandle>,
    market: Option<&MetadataValue>,
) -> Result<Option<MetadataValue>, JsException> {
    let market = market.unwrap_or(&MetadataValue::Missing);
    let position = metric_position(graph, portfolio, market)?;
    let orderbook = match books {
        Some(books) => metric_orderbook(graph, books, market)?,
        None => None,
    };
    if position.is_none() && orderbook.is_none() {
        return Ok(None);
    }
    let root = graph.object()?;
    if let Some(position) = position {
        root.set("position", position.into())?;
    }
    if let Some(orderbook) = orderbook {
        root.set("orderbook", orderbook.into())?;
    }
    Ok(Some(root.into()))
}

/// Numeric JavaScript Date TimeClip and UTC ISO spelling across its full range.
/// String/object Date coercion is a separate required SDK operator surface.
pub fn numeric_date_iso(ms: f64) -> Option<String> {
    if !ms.is_finite() || ms.abs() > 8_640_000_000_000_000.0 {
        return None;
    }
    let ms = ms.trunc() as i64;
    let days = ms.div_euclid(86_400_000);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let doe = shifted - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    let rem = ms.rem_euclid(86_400_000);
    let hour = rem / 3_600_000;
    let minute = rem / 60_000 % 60;
    let second = rem / 1000 % 60;
    let milli = rem % 1000;
    Some(format!(
        "{year}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z"
    ))
}
fn prepare_fill<H: RunnerHost>(
    host: &H,
    event: &ManagedAccountEvent,
) -> Result<MetadataValue, JsException> {
    // Get is repeated at each actual source expression, preserving getter effects.
    let fill = || event.envelope().get_property("fill");
    let ts = g::number(property(&fill()?, "tsMs")?)?;
    let iso =
        numeric_date_iso(ts).ok_or_else(|| host.error_named("RangeError", "Invalid time value"))?;
    let price = property(&fill()?, "price")?;
    let price = g::nullish_number(price, 0.0)?;
    let size = property(&fill()?, "size")?;
    let size = g::nullish_number(size, 0.0)?;
    let notional = crate::math::round8(price * size);
    let cash = if g::is_string(&property(&fill()?, "side")?, "BUY") {
        crate::math::round8(-notional)
    } else {
        notional
    };
    let fee = if !g::is_string(&property(&fill()?, "liquidity")?, "TAKER") {
        0.0
    } else {
        let rate = property(&fill()?, "feeRateBps")?;
        if !matches!(rate, MetadataValue::Number(_)) {
            0.0
        } else {
            let rate = property(&fill()?, "feeRateBps")?;
            if !matches!(rate,MetadataValue::Number(n) if n.is_finite()) {
                0.0
            } else {
                let price = property(&fill()?, "price")?;
                if !matches!(price,MetadataValue::Number(n) if n.is_finite()) {
                    0.0
                } else {
                    let size = property(&fill()?, "size")?;
                    if !matches!(size,MetadataValue::Number(n) if n.is_finite()) {
                        0.0
                    } else {
                        let rate = g::number(property(&fill()?, "feeRateBps")?)?;
                        let price = g::number(property(&fill()?, "price")?)?;
                        let size = g::number(property(&fill()?, "size")?)?;
                        crate::math::round8(crate::math::compute_taker_fee(rate, price, size))
                    }
                }
            }
        }
    };
    Ok(g::pairs(
        &host.graph(),
        [
            ("timeIso", iso.as_str().into()),
            ("notional", notional.into()),
            ("cashDelta", cash.into()),
            ("feePaid", fee.into()),
        ],
    )?
    .into())
}
