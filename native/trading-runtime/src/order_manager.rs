//! Shared order-manager state and original graph-owned decisions. No Portfolio
//! ledger is duplicated here: local cancellation maps only track emitted order
//! references until the runner applies their original events to Portfolio.
use crate::{
    cancellation::{
        managed_cancel_failed, matches_managed_cancel_scope, resolve_managed_cancel_batch,
        validate_managed_cancel_scope,
    },
    intent::{managed as g, ManagedIntent, ManagedIntents},
    js_async::{eager, js_await},
    market_json::JsString,
    math::{buy_commitment, js_max, js_min, js_number_string, round8},
    metadata::{JsException, MetadataError, MetadataGraph, MetadataHandle, MetadataValue},
    portfolio_records::{
        CapitalRecord, ManagedAccountEvent, OpenOrderRecord, PortfolioSnapshotRecord,
    },
    risk::enforce_managed_risk_limits,
    runner::{IntentMode, OwnedFuture},
};
use std::{cell::RefCell, rc::Rc};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutionOperation {
    PlaceLimit,
    PlaceBatch,
    CancelOrder,
    CancelAll,
    CancelBatch,
    CancelMarket,
    MergePositions,
    SplitPositions,
}
#[derive(Clone)]
pub struct OrderManagerContext<M> {
    pub now_ms: f64,
    pub last_market: Option<M>,
    pub portfolio: Option<PortfolioSnapshotRecord>,
}
/// Adapter implementations preserve thrown error identity. Each distinct tag is
/// the corresponding original TypeScript adapter method, not a routing fallback.
pub trait ExecutionAdapter: Clone + 'static {
    type MarketSnapshot: Clone + 'static;
    type Error: Clone + 'static;
    fn execute(
        &self,
        operation: ExecutionOperation,
        intent: ManagedIntent,
        context: OrderManagerContext<Self::MarketSnapshot>,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, Self::Error>;
    fn on_market_tick(
        &self,
        _context: OrderManagerContext<Self::MarketSnapshot>,
    ) -> Option<OwnedFuture<Vec<ManagedAccountEvent>, Self::Error>> {
        None
    }
    fn market_identity(&self, market: &Self::MarketSnapshot) -> Result<MetadataValue, Self::Error>;
    fn js_exception(&self, error: JsException) -> Self::Error;
    fn metadata_error(&self, error: MetadataError) -> Self::Error {
        self.js_exception(error.into())
    }
    fn log(&self, _message: &str, _extra: Option<MetadataValue>) -> Result<(), Self::Error> {
        Ok(())
    }
}
#[derive(Clone)]
enum PendingMerge {
    Original(MetadataHandle),
    Copied {
        asset_a: MetadataValue,
        asset_b: MetadataValue,
        size: f64,
    },
}
#[derive(Default)]
struct State {
    active: Vec<JsString>,
    submissions: Vec<OpenOrderRecord>,
    splits: Vec<(MetadataHandle, f64)>,
    merges: Vec<(MetadataHandle, PendingMerge)>,
    pending: Vec<ManagedIntent>,
    operation_seq: f64,
}
struct Inner<A: ExecutionAdapter> {
    graph: MetadataGraph,
    execution: A,
    dry_run: bool,
    min_gtd_offset_ms: f64,
    state: RefCell<State>,
}
pub struct OrderManager<A: ExecutionAdapter>(Rc<Inner<A>>);
impl<A: ExecutionAdapter> Clone for OrderManager<A> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<A: ExecutionAdapter> OrderManager<A> {
    pub fn new_in_graph(
        graph: &MetadataGraph,
        execution: A,
        dry_run: bool,
        min_gtd_offset_ms: Option<f64>,
    ) -> Self {
        Self(Rc::new(Inner {
            graph: graph.clone(),
            execution,
            dry_run,
            min_gtd_offset_ms: js_max(0.0, min_gtd_offset_ms.unwrap_or(60_000.0)),
            state: RefCell::new(State::default()),
        }))
    }
    fn graph(&self) -> &MetadataGraph {
        &self.0.graph
    }
    fn meta<T, E: Into<JsException>>(&self, value: Result<T, E>) -> Result<T, A::Error> {
        value.map_err(|e| self.0.execution.js_exception(e.into()))
    }
    fn active(&self, id: &JsString) -> bool {
        self.0.state.borrow().active.contains(id)
    }
    fn activate(&self, id: JsString) {
        let mut state = self.0.state.borrow_mut();
        if !state.active.contains(&id) {
            state.active.push(id);
        }
    }
    fn deactivate(&self, id: &JsString) {
        self.0
            .state
            .borrow_mut()
            .active
            .retain(|current| current != id);
    }
    pub fn begin_market(&self) {
        let mut state = self.0.state.borrow_mut();
        state.pending.clear();
        state.active.clear();
        state.submissions.clear();
        state.splits.clear();
        state.merges.clear();
    }
    fn check_graph(&self, handle: &MetadataHandle) -> Result<(), A::Error> {
        if self.graph().owns(handle) {
            Ok(())
        } else {
            Err(self.0.execution.metadata_error(MetadataError::WrongGraph))
        }
    }
    fn has_submission(&self, id: &JsString) -> Result<bool, A::Error> {
        let orders = self.0.state.borrow().submissions.clone();
        for order in orders {
            if g::strict_equal(
                &self.meta(order.handle().as_handle().get_property("clientOrderId"))?,
                &MetadataValue::String(id.clone()),
            ) {
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub fn reconcile(
        &self,
        portfolio: &PortfolioSnapshotRecord,
        event: &ManagedAccountEvent,
    ) -> Result<(), A::Error> {
        self.check_graph(portfolio.handle().as_handle())?;
        self.check_graph(event.envelope())?;
        {
            let mut state = self.0.state.borrow_mut();
            state.splits.retain(|(key, _)| key != event.envelope());
            state.merges.retain(|(key, _)| key != event.envelope());
        }
        if g::is_string(
            &self.meta(event.envelope().get_property("kind"))?,
            "order_submitted",
        ) {
            let order = self.meta(event.envelope().get_property("order"))?;
            self.0.state.borrow_mut().submissions.retain(|current| {
                !g::strict_equal(
                    &MetadataValue::Reference(current.handle().as_handle().clone()),
                    &order,
                )
            });
        }
        let active = self.0.state.borrow().active.clone();
        let root = portfolio.handle().as_handle();
        let history = self.meta(g::members(root, "ordersByClientId"))?;
        let open = self.meta(g::members(root, "openOrdersByClientId"))?;
        for id in active {
            if !self.has_submission(&id)?
                && self.meta(history.get_property(id.clone()))?.is_truthy()
                && !self.meta(open.get_property(id.clone()))?.is_truthy()
            {
                self.deactivate(&id);
            }
        }
        Ok(())
    }
    pub fn with_pending_capital(
        &self,
        portfolio: &PortfolioSnapshotRecord,
    ) -> Result<PortfolioSnapshotRecord, A::Error> {
        self.check_graph(portfolio.handle().as_handle())?;
        let original = self.meta(portfolio.handle().as_handle().get_property("capital"))?;
        if !original.is_truthy() {
            return Ok(portfolio.clone());
        }
        let (submissions, splits) = {
            let state = self.0.state.borrow();
            (state.submissions.clone(), state.splits.clone())
        };
        let mut pending = 0.0;
        for order in submissions {
            let h = order.handle().as_handle();
            if g::is_string(&self.meta(h.get_property("side"))?, "BUY") {
                let price = self.meta(g::number(self.meta(h.get_property("price"))?))?;
                let remaining = self.meta(g::number(self.meta(h.get_property("remaining"))?))?;
                let post = matches!(
                    self.meta(h.get_property("postOnly"))?,
                    MetadataValue::Bool(true)
                );
                pending += buy_commitment(price, remaining, post);
            }
        }
        for (_, cost) in splits {
            pending += cost;
        }
        if pending == 0.0 {
            return Ok(portfolio.clone());
        }
        let capital = self.meta(g::object(original))?;
        let reserved = round8(
            self.meta(g::number(self.meta(capital.get_property("reservedCash"))?))? + pending,
        );
        let cash = self.meta(g::number(self.meta(capital.get_property("cash"))?))?;
        let fields = self
            .meta(capital.keys())?
            .into_iter()
            .map(|key| {
                let value = capital.get_property(key.clone())?;
                Ok((key, value))
            })
            .collect::<Result<Vec<_>, JsException>>();
        let next = self.meta(CapitalRecord::new(self.graph(), self.meta(fields)?))?;
        self.meta(
            next.handle()
                .as_handle()
                .set("reservedCash", reserved.into()),
        )?;
        self.meta(
            next.handle()
                .as_handle()
                .set("availableCash", round8(cash - reserved).into()),
        )?;
        self.meta(next.handle().as_handle().freeze())?;
        let outer = self.meta(g::spread(self.graph(), portfolio.handle().as_handle()))?;
        self.meta(outer.set("capital", next.handle().as_handle().clone().into()))?;
        self.snapshot_from_object(&outer)
    }
    fn snapshot_from_object(
        &self,
        outer: &MetadataHandle,
    ) -> Result<PortfolioSnapshotRecord, A::Error> {
        let fields = self
            .meta(outer.keys())?
            .into_iter()
            .map(|key| {
                let value = outer.get_property(key.clone())?;
                Ok((key, value))
            })
            .collect::<Result<Vec<_>, JsException>>();
        self.meta(PortfolioSnapshotRecord::new(
            self.graph(),
            self.meta(fields)?,
        ))
    }
    fn funding_error(
        &self,
        cost: f64,
        ctx: &OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Option<String>, A::Error> {
        let Some(p) = &ctx.portfolio else {
            return Ok(None);
        };
        let p = self.with_pending_capital(p)?;
        let capital = self.meta(p.handle().as_handle().get_property("capital"))?;
        if !capital.is_truthy() {
            return Ok(None);
        };
        let capital = self.meta(g::object(capital))?;
        let available = self.meta(g::number(self.meta(capital.get_property("availableCash"))?))?;
        Ok(if cost <= available + 1e-8 {
            None
        } else {
            Some(format!(
                "insufficient_capital(required={},available={})",
                js_number_string(cost),
                js_number_string(available)
            ))
        })
    }
    fn event(
        &self,
        fields: impl IntoIterator<Item = (&'static str, MetadataValue)>,
    ) -> Result<ManagedAccountEvent, A::Error> {
        self.meta(g::event(self.graph(), fields))
    }
    fn reject(
        &self,
        order: &ManagedIntent,
        now: f64,
        reason: &str,
    ) -> Result<ManagedAccountEvent, A::Error> {
        self.event([
            ("kind", "order_rejected".into()),
            ("tsMs", now.into()),
            (
                "clientOrderId",
                self.meta(order.get_property("clientOrderId"))?,
            ),
            ("reason", reason.into()),
        ])
    }
    fn placement_rejections(
        &self,
        events: Vec<ManagedAccountEvent>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let mut out = Vec::new();
        for event in events {
            let kind = self.meta(event.envelope().get_property("kind"))?;
            if g::is_string(&kind, "order_rejected") {
                let id = self.meta(g::string(
                    self.meta(event.envelope().get_property("clientOrderId"))?,
                ))?;
                if self.active(&id) {
                    self.0.execution.log(
                        "[risk] ignored blocked retry of active order",
                        Some(event.envelope().clone().into()),
                    )?;
                    continue;
                }
            }
            out.push(event);
        }
        Ok(out)
    }
    fn risk(
        &self,
        intents: ManagedIntents,
        ctx: &OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<(ManagedIntents, Vec<ManagedAccountEvent>), A::Error> {
        self.check_graph(intents.handle())?;
        if let Some(p) = &ctx.portfolio {
            self.check_graph(p.handle().as_handle())?;
        }
        let decision = self.meta(enforce_managed_risk_limits(
            self.graph(),
            ctx.now_ms,
            intents,
            ctx.portfolio.as_ref(),
            None,
        ))?;
        if !decision.blocked.is_empty() {
            let reasons = self.meta(self.graph().array())?;
            for (_, reason) in &decision.blocked {
                self.meta(reasons.push(reason.as_str().into()))?;
            }
            let extra = self.meta(g::pairs(
                self.graph(),
                [
                    ("count", (decision.blocked.len() as f64).into()),
                    ("reasons", reasons.into()),
                ],
            ))?;
            self.0
                .execution
                .log("[risk] blocked intents", Some(extra.into()))?;
        }
        Ok((
            decision.allowed,
            self.placement_rejections(decision.rejected_events)?,
        ))
    }
    pub fn handle_intents(
        &self,
        intents: ManagedIntents,
        ctx: OrderManagerContext<A::MarketSnapshot>,
        mode: IntentMode,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, A::Error> {
        let this = self.clone();
        Box::pin(eager(async move {
            this.check_graph(intents.handle())?;
            if this.meta(intents.length())? == 0 {
                return Ok(Vec::new());
            }
            if mode == IntentMode::Queued {
                let mut values = Vec::new();
                let mut i = 0;
                while i < this.meta(intents.length())? {
                    values.push(this.meta(intents.at(i))?);
                    i += 1;
                }
                this.0.state.borrow_mut().pending.extend(values);
                return Ok(Vec::new());
            }
            let (allowed, mut out) = this.risk(intents, &ctx)?;
            out.extend(js_await(this.execute_now(allowed, ctx)).await?);
            Ok(out)
        }))
    }
    pub fn on_market_tick(
        &self,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> OwnedFuture<Vec<ManagedAccountEvent>, A::Error> {
        let this = self.clone();
        Box::pin(eager(async move {
            let queued = std::mem::take(&mut this.0.state.borrow_mut().pending);
            let mut out = Vec::new();
            if !queued.is_empty() {
                let intents = this.meta(ManagedIntents::new_in_graph(this.graph(), queued))?;
                let (allowed, rejected) = this.risk(intents, &ctx)?;
                out.extend(rejected);
                out.extend(js_await(this.execute_now(allowed, ctx.clone())).await?);
            }
            if let Some(callback) = this.0.execution.on_market_tick(ctx) {
                out.extend(js_await(callback).await?);
            }
            Ok(out)
        }))
    }
    async fn execute_now(
        &self,
        intents: ManagedIntents,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let mut track = false;
        let mut index = 0;
        while index < self.meta(intents.length())? {
            let intent = self.meta(intents.at(index))?;
            index += 1;
            let kind = self.meta(g::string(self.meta(intent.get_property("kind"))?))?;
            if kind
                .units()
                .starts_with(&"cancel_".encode_utf16().collect::<Vec<_>>())
            {
                track = true;
                break;
            }
        }
        let local = self.reference_portfolio(&ctx, track)?;
        let mut out = Vec::new();
        index = 0;
        while index < self.meta(intents.length())? {
            let intent = self.meta(intents.at(index))?;
            index += 1;
            let kind = self.meta(intent.get_property("kind"))?;
            let operation = if g::is_string(&kind, "place_limit") {
                Some(ExecutionOperation::PlaceLimit)
            } else if g::is_string(&kind, "place_batch") {
                Some(ExecutionOperation::PlaceBatch)
            } else if g::is_string(&kind, "cancel_order") {
                Some(ExecutionOperation::CancelOrder)
            } else if g::is_string(&kind, "cancel_all") {
                Some(ExecutionOperation::CancelAll)
            } else if g::is_string(&kind, "cancel_batch") {
                Some(ExecutionOperation::CancelBatch)
            } else if g::is_string(&kind, "cancel_market") {
                Some(ExecutionOperation::CancelMarket)
            } else if g::is_string(&kind, "merge_positions") {
                Some(ExecutionOperation::MergePositions)
            } else if g::is_string(&kind, "split_positions") {
                Some(ExecutionOperation::SplitPositions)
            } else {
                None
            };
            let Some(operation) = operation else {
                continue;
            };
            let mut cancel_ctx = ctx.clone();
            cancel_ctx.portfolio = Some(local.clone());
            let events = match operation {
                ExecutionOperation::PlaceLimit => {
                    js_await(self.place_limit(intent, ctx.clone())).await?
                }
                ExecutionOperation::PlaceBatch => {
                    js_await(self.place_batch(intent, ctx.clone())).await?
                }
                ExecutionOperation::MergePositions => {
                    js_await(self.merge(intent, ctx.clone())).await?
                }
                ExecutionOperation::SplitPositions => {
                    js_await(self.split(intent, ctx.clone())).await?
                }
                op => js_await(self.cancel(op, intent, cancel_ctx)).await?,
            };
            if track {
                for event in &events {
                    self.track_reference(&local, event)?;
                }
            }
            out.extend(events);
        }
        Ok(out)
    }
    fn reference_portfolio(
        &self,
        ctx: &OrderManagerContext<A::MarketSnapshot>,
        track: bool,
    ) -> Result<PortfolioSnapshotRecord, A::Error> {
        let outer = self.meta(g::pairs(
            self.graph(),
            [
                ("nowMs", ctx.now_ms.into()),
                (
                    "positionsByAssetId",
                    self.meta(self.graph().object())?.into(),
                ),
                ("recentFills", self.meta(self.graph().array())?.into()),
                ("marketByAssetId", self.meta(self.graph().object())?.into()),
            ],
        ))?;
        if let Some(p) = &ctx.portfolio {
            let source = p.handle().as_handle();
            for key in self.meta(source.own_property_keys())? {
                if self
                    .meta(source.own_descriptor(key.clone()))?
                    .is_some_and(|d| d.enumerable())
                {
                    self.meta(outer.set(key.clone(), self.meta(source.get_property(key))?))?;
                }
            }
        }
        for key in [
            "openOrdersByClientId",
            "ordersByClientId",
            "wsOpenOrdersByOrderId",
        ] {
            let value = if track {
                match &ctx.portfolio {
                    Some(p) => self.meta(g::spread(
                        self.graph(),
                        &self.meta(g::members(p.handle().as_handle(), key))?,
                    ))?,
                    None => self.meta(self.graph().object())?,
                }
            } else {
                self.meta(self.graph().object())?
            };
            self.meta(outer.set(key, value.into()))?;
        }
        self.snapshot_from_object(&outer)
    }
    fn track_reference(
        &self,
        portfolio: &PortfolioSnapshotRecord,
        event: &ManagedAccountEvent,
    ) -> Result<(), A::Error> {
        let h = event.envelope();
        let kind = self.meta(h.get_property("kind"))?;
        let root = portfolio.handle().as_handle();
        let open = self.meta(g::members(root, "openOrdersByClientId"))?;
        let history = self.meta(g::members(root, "ordersByClientId"))?;
        let ws = self.meta(g::members(root, "wsOpenOrdersByOrderId"))?;
        if g::is_string(&kind, "order_submitted") {
            let order = self.meta(g::object(self.meta(h.get_property("order"))?))?;
            let id = self.meta(g::string(self.meta(order.get_property("clientOrderId"))?))?;
            self.meta(open.set_property(id, self.meta(g::spread(self.graph(), &order))?.into()))?;
        }
        if g::is_string(&kind, "order_accepted") {
            let cid = self.meta(g::string(self.meta(h.get_property("clientOrderId"))?))?;
            let value = self.meta(open.get_property(cid.clone()))?;
            let oid = self.meta(h.get_property("orderId"))?;
            if value.is_truthy() && oid.is_truthy() {
                let order = self.meta(g::spread(self.graph(), &self.meta(g::object(value))?))?;
                self.meta(order.set("orderId", oid))?;
                self.meta(open.set_property(cid, order.into()))?;
            }
        }
        if g::is_string(&kind, "order_done") || g::is_string(&kind, "order_rejected") {
            if g::is_string(&kind, "order_rejected")
                && g::is_string(
                    &self.meta(h.get_property("reason"))?,
                    "duplicate_clientOrderId",
                )
            {
                return Ok(());
            }
            let oid = if g::is_string(&kind, "order_done") {
                self.meta(h.get_property("orderId"))?
            } else {
                MetadataValue::Missing
            };
            let mut cid = self.meta(h.get_property("clientOrderId"))?;
            if matches!(cid, MetadataValue::Missing | MetadataValue::Null) {
                for order in self.meta(g::values(&open))? {
                    if oid.is_truthy()
                        && g::strict_equal(&self.meta(order.get_property("orderId"))?, &oid)
                    {
                        cid = self.meta(order.get_property("clientOrderId"))?;
                        break;
                    }
                }
            }
            if oid.is_truthy() {
                self.meta(ws.delete_property(self.meta(g::string(oid))?))?;
            }
            if cid.is_truthy() {
                let id = self.meta(g::string(cid.clone()))?;
                let raw = self.meta(open.get_property(id.clone()))?;
                if raw.is_truthy() {
                    let order = self.meta(g::object(raw))?;
                    let next = self.meta(self.graph().object())?;
                    self.meta(next.set("clientOrderId", cid))?;
                    let order_id = self.meta(order.get_property("orderId"))?;
                    if order_id.is_truthy() {
                        self.meta(next.set("orderId", order_id))?;
                    }
                    for key in ["assetId", "side"] {
                        self.meta(next.set(key, self.meta(order.get_property(key))?))?;
                    }
                    self.meta(next.set(
                        "lifecycleState",
                        if g::is_string(&kind, "order_done") {
                            self.meta(h.get_property("reason"))?
                        } else {
                            "rejected".into()
                        },
                    ))?;
                    self.meta(next.set("tradeStatusRank", 0.0.into()))?;
                    self.meta(next.set("updatedAtMs", self.meta(h.get_property("tsMs"))?))?;
                    self.meta(history.set_property(id.clone(), next.into()))?;
                }
                self.meta(open.delete_property(id.clone()))?;
                self.deactivate(&id);
            }
        }
        Ok(())
    }
    fn validate_place(&self, intent: &ManagedIntent, now: f64) -> Result<Option<String>, A::Error> {
        for (key, reason) in [("price", "invalid_price"), ("size", "invalid_size")] {
            // The Number.isFinite test and relational test are distinct JS Get
            // sites. An accessor can change its result or throw on the second.
            if !matches!(self.meta(intent.get_property(key))?,MetadataValue::Number(n) if n.is_finite())
            {
                return Ok(Some(reason.to_owned()));
            }
            if self.meta(g::number(self.meta(intent.get_property(key))?))? <= 0.0 {
                return Ok(Some(reason.to_owned()));
            }
        }
        if !self.meta(intent.get_property("assetId"))?.is_truthy() {
            return Ok(Some("missing_assetId".into()));
        }
        if matches!(
            self.meta(intent.get_property("postOnly"))?,
            MetadataValue::Bool(true)
        ) && !g::is_string(&self.meta(intent.get_property("orderType"))?, "GTC")
            && !g::is_string(&self.meta(intent.get_property("orderType"))?, "GTD")
        {
            return Ok(Some("post_only_requires_gtc_or_gtd".into()));
        }
        if g::is_string(&self.meta(intent.get_property("orderType"))?, "GTD") {
            if matches!(
                self.meta(intent.get_property("expireAtMs"))?,
                MetadataValue::Missing
            ) {
                return Ok(Some("gtd_requires_expireAtMs".into()));
            }
            if !matches!(self.meta(intent.get_property("expireAtMs"))?,MetadataValue::Number(n) if n.is_finite())
            {
                return Ok(Some("invalid_expireAtMs".into()));
            }
            if self.meta(g::number(self.meta(intent.get_property("expireAtMs"))?))?
                < now + self.0.min_gtd_offset_ms
            {
                return Ok(Some(format!(
                    "gtd_expireAtMs_too_soon(min_offset_ms={})",
                    js_number_string(self.0.min_gtd_offset_ms)
                )));
            }
        }
        if !g::is_string(&self.meta(intent.get_property("orderType"))?, "GTD")
            && !matches!(
                self.meta(intent.get_property("expireAtMs"))?,
                MetadataValue::Missing
            )
        {
            let client_id = if self.meta(intent.handle().has_property("clientOrderId"))? {
                self.meta(intent.get_property("clientOrderId"))?
            } else {
                MetadataValue::String("unknown".into())
            };
            let extra = self.meta(g::pairs(
                self.graph(),
                [
                    ("clientOrderId", client_id),
                    ("orderType", self.meta(intent.get_property("orderType"))?),
                ],
            ))?;
            self.0.execution.log(
                "[orderManager] ignoring expireAtMs for non-GTD orderType",
                Some(extra.into()),
            )?;
        }
        Ok(None)
    }
    fn place_error(
        &self,
        intent: &ManagedIntent,
        ctx: &OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Option<String>, A::Error> {
        if let Some(error) = self.validate_place(intent, ctx.now_ms)? {
            return Ok(Some(error));
        }
        if g::is_string(&self.meta(intent.get_property("side"))?, "BUY") {
            let price = self.meta(g::number(self.meta(intent.get_property("price"))?))?;
            let size = self.meta(g::number(self.meta(intent.get_property("size"))?))?;
            let post = matches!(
                self.meta(intent.get_property("postOnly"))?,
                MetadataValue::Bool(true)
            );
            self.funding_error(buy_commitment(price, size, post), ctx)
        } else {
            Ok(None)
        }
    }
    fn submitted(
        &self,
        intent: &ManagedIntent,
        ctx: &OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<ManagedAccountEvent, A::Error> {
        let mut fields = vec![(
            "clientOrderId".into(),
            self.meta(intent.get_property("clientOrderId"))?,
        )];
        if let Some(market) = &ctx.last_market {
            if self.0.execution.market_identity(market)?.is_truthy() {
                fields.push(("market".into(), self.0.execution.market_identity(market)?));
            }
        }
        for key in ["assetId", "side", "price", "size"] {
            fields.push((key.into(), self.meta(intent.get_property(key))?));
        }
        fields.extend([
            ("remaining".into(), self.meta(intent.get_property("size"))?),
            ("filled".into(), 0.0.into()),
            (
                "orderType".into(),
                self.meta(intent.get_property("orderType"))?,
            ),
        ]);
        let post = self.meta(intent.get_property("postOnly"))?;
        if !matches!(post, MetadataValue::Missing) {
            fields.push(("postOnly".into(), post));
        }
        let meta = self.meta(intent.get_property("meta"))?;
        if meta.is_truthy() {
            fields.push(("meta".into(), meta));
        }
        if g::is_string(&self.meta(intent.get_property("orderType"))?, "GTD") {
            fields.push((
                "expireAtMs".into(),
                self.meta(intent.get_property("expireAtMs"))?,
            ));
        }
        fields.extend([
            ("state".into(), "requested".into()),
            ("createdAtMs".into(), ctx.now_ms.into()),
            ("updatedAtMs".into(), ctx.now_ms.into()),
        ]);
        let order = self.meta(OpenOrderRecord::new(self.graph(), fields))?;
        let event = self.event([
            ("kind", "order_submitted".into()),
            ("tsMs", ctx.now_ms.into()),
            ("order", order.handle().as_handle().clone().into()),
        ])?;
        self.0.state.borrow_mut().submissions.push(order);
        Ok(event)
    }
    async fn place_limit(
        &self,
        intent: ManagedIntent,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let id = self.meta(g::string(self.meta(intent.get_property("clientOrderId"))?))?;
        if self.active(&id) {
            return Ok(Vec::new());
        }
        self.activate(id);
        if let Some(error) = self.place_error(&intent, &ctx)? {
            self.deactivate(
                &self.meta(g::string(self.meta(intent.get_property("clientOrderId"))?))?,
            );
            return Ok(vec![self.reject(&intent, ctx.now_ms, &error)?]);
        }
        let mut events = vec![self.submitted(&intent, &ctx)?];
        if self.0.dry_run {
            for kind in ["order_accepted", "order_open"] {
                events.push(self.event([
                    ("kind", kind.into()),
                    ("tsMs", ctx.now_ms.into()),
                    (
                        "clientOrderId",
                        self.meta(intent.get_property("clientOrderId"))?,
                    ),
                ])?);
            }
            return Ok(events);
        }
        let result = js_await(self.0.execution.execute(
            ExecutionOperation::PlaceLimit,
            intent.clone(),
            ctx,
        ))
        .await?;
        for event in &result {
            let kind = self.meta(event.envelope().get_property("kind"))?;
            if (g::is_string(&kind, "order_rejected") || g::is_string(&kind, "order_done"))
                && g::strict_equal(
                    &self.meta(event.envelope().get_property("clientOrderId"))?,
                    &self.meta(intent.get_property("clientOrderId"))?,
                )
            {
                self.deactivate(
                    &self.meta(g::string(self.meta(intent.get_property("clientOrderId"))?))?,
                );
            }
        }
        events.extend(result);
        Ok(events)
    }
    async fn place_batch(
        &self,
        intent: ManagedIntent,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let raw = self.meta(intent.get_property("orders"))?;
        if !raw.is_truthy() {
            return Ok(Vec::new());
        }
        let orders = self.meta(ManagedIntents::from_handle(self.meta(g::object(raw))?))?;
        let mut events = Vec::new();
        let mut valid = Vec::new();
        let mut index = 0;
        while index < self.meta(orders.length())? {
            let order = self.meta(orders.at(index))?;
            index += 1;
            let id = self.meta(g::string(self.meta(order.get_property("clientOrderId"))?))?;
            if self.active(&id) {
                continue;
            }
            if let Some(error) = self.place_error(&order, &ctx)? {
                events.push(self.reject(&order, ctx.now_ms, &error)?);
                continue;
            }
            self.activate(id);
            events.push(self.submitted(&order, &ctx)?);
            valid.push(order);
        }
        if valid.is_empty() {
            return Ok(events);
        }
        if self.0.dry_run {
            for order in valid {
                for kind in ["order_accepted", "order_open"] {
                    events.push(self.event([
                        ("kind", kind.into()),
                        ("tsMs", ctx.now_ms.into()),
                        (
                            "clientOrderId",
                            self.meta(order.get_property("clientOrderId"))?,
                        ),
                    ])?);
                }
            }
            return Ok(events);
        }
        let array = self.meta(ManagedIntents::new_in_graph(self.graph(), valid))?;
        let batch = self.meta(g::pairs(
            self.graph(),
            [
                ("kind", "place_batch".into()),
                ("orders", array.handle().clone().into()),
            ],
        ))?;
        if let MetadataValue::String(reason) = self.meta(intent.get_property("reason"))? {
            self.meta(batch.set("reason", MetadataValue::String(reason)))?;
        }
        let result = js_await(self.0.execution.execute(
            ExecutionOperation::PlaceBatch,
            self.meta(ManagedIntent::from_handle(batch))?,
            ctx,
        ))
        .await?;
        for event in &result {
            let kind = self.meta(event.envelope().get_property("kind"))?;
            if g::is_string(&kind, "order_rejected") || g::is_string(&kind, "order_done") {
                let id = self.meta(event.envelope().get_property("clientOrderId"))?;
                if id.is_truthy() {
                    self.deactivate(&self.meta(g::string(id))?);
                }
            }
        }
        events.extend(result);
        Ok(events)
    }
    fn operation_failed(
        &self,
        kind: &str,
        intent: &ManagedIntent,
        now: f64,
        size: MetadataValue,
        reason: &str,
    ) -> Result<ManagedAccountEvent, A::Error> {
        self.event([
            ("kind", kind.into()),
            ("tsMs", now.into()),
            ("assetIdA", self.meta(intent.get_property("assetIdA"))?),
            ("assetIdB", self.meta(intent.get_property("assetIdB"))?),
            ("requestedSize", size),
            ("reason", reason.into()),
        ])
    }
    async fn split(
        &self,
        intent: ManagedIntent,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let size = match self.meta(intent.get_property("size"))? {
            MetadataValue::Number(n) if n.is_finite() => n,
            _ => 0.0,
        };
        let a = self.meta(intent.get_property("assetIdA"))?;
        let b = self.meta(intent.get_property("assetIdB"))?;
        if !a.is_truthy() || !b.is_truthy() || g::strict_equal(&a, &b) {
            return Ok(vec![self.operation_failed(
                "split_failed",
                &intent,
                ctx.now_ms,
                size.into(),
                "invalid asset ids",
            )?]);
        }
        if size <= 0.0 {
            return Ok(vec![self.operation_failed(
                "split_failed",
                &intent,
                ctx.now_ms,
                size.into(),
                "invalid size",
            )?]);
        }
        if let Some(error) = self.funding_error(size, &ctx)? {
            return Ok(vec![self.operation_failed(
                "split_failed",
                &intent,
                ctx.now_ms,
                size.into(),
                &error,
            )?]);
        }
        let events = js_await(self.0.execution.execute(
            ExecutionOperation::SplitPositions,
            intent,
            ctx,
        ))
        .await?;
        for event in &events {
            if g::is_string(
                &self.meta(event.envelope().get_property("kind"))?,
                "positions_split",
            ) {
                let split = self.meta(g::object(
                    self.meta(event.envelope().get_property("split"))?,
                ))?;
                let cost = self.meta(g::number(self.meta(split.get_property("splitCost"))?))?;
                let mut state = self.0.state.borrow_mut();
                if let Some((_, stored)) = state
                    .splits
                    .iter_mut()
                    .find(|(key, _)| key == event.envelope())
                {
                    *stored = cost;
                } else {
                    state.splits.push((event.envelope().clone(), cost));
                }
            }
        }
        Ok(events)
    }
    async fn merge(
        &self,
        intent: ManagedIntent,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let mut size = match self.meta(intent.get_property("size"))? {
            MetadataValue::Number(n) if n.is_finite() => n,
            _ => 0.0,
        };
        let a = self.meta(intent.get_property("assetIdA"))?;
        let b = self.meta(intent.get_property("assetIdB"))?;
        if !a.is_truthy() || !b.is_truthy() || g::strict_equal(&a, &b) {
            return Ok(vec![self.operation_failed(
                "merge_failed",
                &intent,
                ctx.now_ms,
                size.into(),
                "invalid asset ids",
            )?]);
        }
        if size <= 0.0 {
            return Ok(Vec::new());
        }
        if let Some(p) = &ctx.portfolio {
            let positions = self.meta(g::members(p.handle().as_handle(), "positionsByAssetId"))?;
            let pending = self.0.state.borrow().merges.clone();
            let available = |asset: &MetadataValue| -> Result<f64, A::Error> {
                let mut qty = match self
                    .meta(positions.get_property(self.meta(g::string(asset.clone()))?))?
                {
                    MetadataValue::Missing | MetadataValue::Null => 0.0,
                    value => self.meta(g::nullish_number(
                        self.meta(self.meta(g::object(value))?.get_property("qty"))?,
                        0.0,
                    ))?,
                };
                for (_, merge) in &pending {
                    let (a, b, size) = match merge {
                        PendingMerge::Copied {
                            asset_a,
                            asset_b,
                            size,
                        } => (asset_a.clone(), asset_b.clone(), *size),
                        PendingMerge::Original(event) => (
                            self.meta(event.get_property("assetIdA"))?,
                            self.meta(event.get_property("assetIdB"))?,
                            self.meta(g::number(self.meta(event.get_property("size"))?))?,
                        ),
                    };
                    if g::strict_equal(&a, asset) || g::strict_equal(&b, asset) {
                        qty -= size;
                    }
                }
                Ok(js_max(0.0, qty))
            };
            size = js_min(
                js_min(
                    size,
                    available(&self.meta(intent.get_property("assetIdA"))?)?,
                ),
                available(&self.meta(intent.get_property("assetIdB"))?)?,
            );
            if size <= 0.0 {
                return Ok(vec![self.operation_failed(
                    "merge_failed",
                    &intent,
                    ctx.now_ms,
                    self.meta(intent.get_property("size"))?,
                    "insufficient_uncommitted_positions",
                )?]);
            }
        }
        if self.0.dry_run {
            let seq = {
                let mut state = self.0.state.borrow_mut();
                state.operation_seq += 1.0;
                state.operation_seq
            };
            let event = self.event([
                ("kind", "positions_merged".into()),
                (
                    "id",
                    format!("dry-merge:{}", js_number_string(seq))
                        .as_str()
                        .into(),
                ),
            ])?;
            if let Some(m) = &ctx.last_market {
                if self.0.execution.market_identity(m)?.is_truthy() {
                    self.meta(
                        event
                            .envelope()
                            .set("market", self.0.execution.market_identity(m)?),
                    )?;
                }
            }
            for (key, value) in [
                ("tsMs", ctx.now_ms.into()),
                ("assetIdA", self.meta(intent.get_property("assetIdA"))?),
                ("assetIdB", self.meta(intent.get_property("assetIdB"))?),
                ("size", size.into()),
            ] {
                self.meta(event.envelope().set(key, value))?;
            }
            let reason = self.meta(intent.get_property("reason"))?;
            if reason.is_truthy() {
                self.meta(event.envelope().set("reason", reason))?;
            }
            let pending = PendingMerge::Copied {
                asset_a: self.meta(intent.get_property("assetIdA"))?,
                asset_b: self.meta(intent.get_property("assetIdB"))?,
                size,
            };
            self.0
                .state
                .borrow_mut()
                .merges
                .push((event.envelope().clone(), pending));
            return Ok(vec![event]);
        }
        let copy = self.meta(g::spread(self.graph(), intent.handle()))?;
        self.meta(copy.set("size", size.into()))?;
        let events = js_await(self.0.execution.execute(
            ExecutionOperation::MergePositions,
            self.meta(ManagedIntent::from_handle(copy))?,
            ctx,
        ))
        .await?;
        for event in &events {
            if g::is_string(
                &self.meta(event.envelope().get_property("kind"))?,
                "positions_merged",
            ) {
                let mut state = self.0.state.borrow_mut();
                if let Some((_, value)) = state
                    .merges
                    .iter_mut()
                    .find(|(key, _)| key == event.envelope())
                {
                    *value = PendingMerge::Original(event.envelope().clone());
                } else {
                    state.merges.push((
                        event.envelope().clone(),
                        PendingMerge::Original(event.envelope().clone()),
                    ));
                }
            }
        }
        Ok(events)
    }
    fn dry_cancel(
        &self,
        orders: &[ManagedIntent],
        ctx: &OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        let mut out = Vec::new();
        for order in orders {
            let cid = self.meta(order.get_property("clientOrderId"))?;
            let oid = self.meta(order.get_property("orderId"))?;
            let event = self.event([("kind", "order_done".into()), ("tsMs", ctx.now_ms.into())])?;
            if cid.is_truthy() {
                self.meta(event.envelope().set("clientOrderId", cid.clone()))?;
            }
            if oid.is_truthy() {
                self.meta(event.envelope().set("orderId", oid))?;
            }
            self.meta(event.envelope().set("reason", "canceled".into()))?;
            let filled = if cid.is_truthy() {
                match &ctx.portfolio {
                    Some(p) => {
                        let open =
                            self.meta(g::members(p.handle().as_handle(), "openOrdersByClientId"))?;
                        match self.meta(open.get_property(self.meta(g::string(cid))?))? {
                            MetadataValue::Missing | MetadataValue::Null => {
                                MetadataValue::Number(0.0)
                            }
                            value => {
                                let v =
                                    self.meta(self.meta(g::object(value))?.get_property("filled"))?;
                                if matches!(v, MetadataValue::Missing | MetadataValue::Null) {
                                    0.0.into()
                                } else {
                                    v
                                }
                            }
                        }
                    }
                    None => 0.0.into(),
                }
            } else {
                0.0.into()
            };
            self.meta(event.envelope().set("filledSize", filled))?;
            out.push(event);
        }
        Ok(out)
    }
    fn known_cancel(
        &self,
        target: &ManagedIntent,
        ctx: &OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<bool, A::Error> {
        let Some(p) = &ctx.portfolio else {
            return Ok(false);
        };
        for (field, members) in [
            ("clientOrderId", "openOrdersByClientId"),
            ("orderId", "wsOpenOrdersByOrderId"),
        ] {
            let id = self.meta(target.get_property(field))?;
            if id.is_truthy() {
                let map = self.meta(g::members(p.handle().as_handle(), members))?;
                if self
                    .meta(map.get_property(self.meta(g::string(id))?))?
                    .is_truthy()
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    async fn cancel(
        &self,
        operation: ExecutionOperation,
        intent: ManagedIntent,
        ctx: OrderManagerContext<A::MarketSnapshot>,
    ) -> Result<Vec<ManagedAccountEvent>, A::Error> {
        if operation == ExecutionOperation::CancelMarket {
            if let Some(error) = self.meta(validate_managed_cancel_scope(&intent))? {
                return Ok(vec![self.meta(managed_cancel_failed(
                    self.graph(),
                    self.meta(intent.get_property("kind"))?,
                    ctx.now_ms,
                    error,
                    None,
                ))?]);
            }
        }
        if operation == ExecutionOperation::CancelBatch
            || (operation == ExecutionOperation::CancelOrder && self.0.dry_run)
        {
            let resolve = if operation == ExecutionOperation::CancelOrder {
                let orders = self.meta(self.graph().array())?;
                self.meta(orders.push(intent.handle().clone().into()))?;
                self.meta(ManagedIntent::from_handle(self.meta(g::pairs(
                    self.graph(),
                    [("kind", "cancel_batch".into()), ("orders", orders.into())],
                ))?))?
            } else {
                intent.clone()
            };
            let result = self.meta(resolve_managed_cancel_batch(
                self.graph(),
                &resolve,
                ctx.portfolio.as_ref(),
                ctx.now_ms,
                self.0.dry_run,
            ))?;
            let mut out = result.events;
            if operation == ExecutionOperation::CancelOrder {
                for event in &out {
                    if g::is_string(
                        &self.meta(event.envelope().get_property("kind"))?,
                        "cancel_failed",
                    ) {
                        self.meta(
                            event
                                .envelope()
                                .set("operation", self.meta(intent.get_property("kind"))?),
                        )?;
                    }
                }
            }
            if self.0.dry_run {
                for target in result.orders {
                    if self.known_cancel(&target, &ctx)? {
                        out.extend(self.dry_cancel(&[target], &ctx)?);
                    } else {
                        out.push(self.meta(managed_cancel_failed(
                            self.graph(),
                            self.meta(intent.get_property("kind"))?,
                            ctx.now_ms,
                            "unknown_order",
                            Some(target.handle()),
                        ))?);
                    }
                }
                return Ok(out);
            }
            if result.orders.is_empty() {
                return Ok(out);
            }
            let copy = self.meta(g::spread(self.graph(), intent.handle()))?;
            let orders = self.meta(ManagedIntents::new_in_graph(self.graph(), result.orders))?;
            self.meta(copy.set("orders", orders.handle().clone().into()))?;
            out.extend(
                js_await(self.0.execution.execute(
                    operation,
                    self.meta(ManagedIntent::from_handle(copy))?,
                    ctx,
                ))
                .await?,
            );
            return Ok(out);
        }
        if !self.0.dry_run {
            return js_await(self.0.execution.execute(operation, intent, ctx)).await;
        }
        let Some(p) = &ctx.portfolio else {
            return Ok(Vec::new());
        };
        let root = p.handle().as_handle();
        let mut orders = Vec::new();
        let mut ids = Vec::new();
        for order in self.meta(g::values(
            &self.meta(g::members(root, "openOrdersByClientId"))?,
        ))? {
            if operation == ExecutionOperation::CancelMarket
                && !self.meta(matches_managed_cancel_scope(&order, &intent))?
            {
                continue;
            }
            ids.push(self.meta(order.get_property("orderId"))?);
            if operation == ExecutionOperation::CancelMarket {
                let target = self.meta(g::pairs(
                    self.graph(),
                    [(
                        "clientOrderId",
                        self.meta(order.get_property("clientOrderId"))?,
                    )],
                ))?;
                let id = self.meta(order.get_property("orderId"))?;
                if id.is_truthy() {
                    self.meta(target.set("orderId", id))?;
                }
                orders.push(self.meta(ManagedIntent::from_handle(target))?);
            } else {
                orders.push(self.meta(ManagedIntent::from_handle(order))?);
            }
        }
        for order in self.meta(g::values(
            &self.meta(g::members(root, "wsOpenOrdersByOrderId"))?,
        ))? {
            let oid = self.meta(order.get_property("orderId"))?;
            if ids.iter().any(|id| g::strict_equal(id, &oid)) {
                continue;
            }
            if operation == ExecutionOperation::CancelMarket
                && !self.meta(matches_managed_cancel_scope(&order, &intent))?
            {
                continue;
            }
            if operation == ExecutionOperation::CancelMarket {
                orders.push(self.meta(ManagedIntent::from_handle(
                    self.meta(g::pairs(self.graph(), [("orderId", oid)]))?,
                ))?);
            } else {
                orders.push(self.meta(ManagedIntent::from_handle(order))?);
            }
        }
        self.dry_cancel(&orders, &ctx)
    }
}
