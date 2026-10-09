//! Simulator tests (13 §11) with crafted ledger order records and recorded
//! books (pmb-book); they do not depend on the OM, the session or the
//! driver. `Harness` plays the core's role for one market session: it writes
//! order records, applies books to the `SharedMarket`, calls the
//! `Execution` methods and renders the emitted events as text.

mod cancellation;
mod fee_golden;
mod golden;
mod scenarios;

use std::sync::Arc;

use pmb_book::Level;
use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::vocab::InputMode;
use pmb_core::event::{AccountEvent, AccountEventKind, CancelCause};
use pmb_core::fill::Position;
use pmb_core::fixed::format_micros;
use pmb_core::ids::{
    CancelKind, CancelOp, CancelSeq, CidKey, ConditionId, Hash32, OpKey, OrderKey, TokenId,
};
use pmb_core::market::MarketVersion;
use pmb_core::order::{OrderRequest, OrderSize, OrderType, Side};
use pmb_core::rules::{
    ExchangeRules, FeeCurve, FeeEraId, RulesProvenance, RulesSource, RulesTableVersion,
    RulesTimeline,
};
use pmb_core::seed::MarketSeed;
use pmb_core::state::{CancelState, OrderState};
use pmb_core::{MarketEvent, MarketInfo, Outcome, PerOutcome, Price, Qty, TsMs, Usdc};

use super::simulator::Simulator;
use crate::config::{EngineConfig, RiskLimits};
use crate::core_rules::CoreRules;
use crate::exec::{CancelScope, EventQueue, ExecCommand, ExecCtx, Execution};
use crate::ledger::{Ledger, OrderRecord};
use crate::shared::SharedMarket;

pub(super) const SLUG: &str = "btc-updown-15m-1780272000";

/// A ts-compat `EngineConfig` with the given compat latency.
pub(super) fn ts_compat_config(delay_ms: u32, jitter_ms: u32) -> EngineConfig {
    EngineConfig {
        core_rules: CoreRules::TsCompat,
        input_mode: InputMode::TelonexDelta,
        models: ExecutionModels::TS_COMPAT,
        compat_latency: CompatLatency {
            delay_ms,
            jitter_ms,
        },
        market_seed: MarketSeed(0),
        starting_capital: Usdc::from_micros(500_000_000),
        max_events_per_drain: 4_200,
        run_mode: crate::config::RunMode::Backtest,
        risk: RiskLimits {
            max_open_orders: 100,
            max_order_size: Qty::from_micros(2_000_000_000),
            max_abs_position: Qty::from_micros(2_000_000_000),
            max_loss_stop: Usdc::from_micros(500_000_000),
        },
    }
}

/// A market with the fixed ts-compat rules of 11 §4.
pub(super) fn ts_compat_market() -> SharedMarket {
    let info = MarketInfo::new(
        SLUG,
        ConditionId(Hash32([7; 32])),
        PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
        MarketVersion::V2,
        false,
    )
    .expect("valid slug");
    let timeline = RulesTimeline::new(
        ExchangeRules::ts_compat(),
        Vec::new(),
        RulesProvenance::all_fallback(RulesTableVersion::V1),
        RulesTableVersion::V1,
        FeeEraId::F0,
    );
    SharedMarket::new(Arc::new(info), Arc::new(timeline), RulesSource::Fallback)
}

pub(super) fn dec(s: &str) -> i64 {
    pmb_core::fixed::parse_decimal(s)
        .unwrap_or_else(|e| panic!("bad decimal {s}: {e}"))
        .micros
}

pub(super) fn outcome(s: &str) -> Outcome {
    match s {
        "up" => Outcome::Up,
        "down" => Outcome::Down,
        _ => panic!("bad outcome {s}"),
    }
}

/// One market session as the simulator sees it (the core's role).
pub(super) struct Harness {
    pub market: SharedMarket,
    pub ledger: Ledger,
    pub cfg: EngineConfig,
    pub sim: Simulator,
    pub queue: EventQueue,
    /// Name of each `OrderKey` (by index) and of each `CidKey` (by index).
    names: Vec<String>,
    cids: Vec<String>,
    next_cancel: u32,
    next_op: u32,
}

impl Harness {
    pub fn new(cfg: EngineConfig) -> Harness {
        let sim = Simulator::new(&cfg).expect("ts-compat composition");
        Harness {
            market: ts_compat_market(),
            ledger: Ledger::new(cfg.core_rules, cfg.starting_capital),
            cfg,
            sim,
            queue: EventQueue::new(false),
            names: Vec::new(),
            cids: Vec::new(),
            next_cancel: 0,
            next_op: 0,
        }
    }

    pub fn compat(delay_ms: u32) -> Harness {
        Harness::new(ts_compat_config(delay_ms, 0))
    }

    /// Replaces the recorded book of an outcome (the driver's apply).
    pub fn book(&mut self, o: Outcome, bids: &[(i64, i64)], asks: &[(i64, i64)]) {
        let lv = |&(p, s): &(i64, i64)| Level {
            price: Price::from_micros(p),
            size: Qty::from_micros(s),
        };
        self.market
            .books
            .apply_snapshot(o, bids.iter().map(lv), asks.iter().map(lv));
    }

    /// Sets a delivered position (ledger client knowledge).
    pub fn position(&mut self, o: Outcome, qty: i64) {
        self.ledger.positions[o] = Position {
            qty: Qty::from_micros(qty),
            cost_basis: Usdc::ZERO,
        };
    }

    fn cid(&mut self, name: &str) -> CidKey {
        match self.cids.iter().position(|c| c == name) {
            Some(i) => CidKey::new(i as u32),
            None => {
                self.cids.push(name.to_owned());
                CidKey::new((self.cids.len() - 1) as u32)
            }
        }
    }

    /// Writes a crafted `InFlight` order record, as the OM does at emission
    /// (12 §9.1), and returns its key.
    pub fn record(&mut self, name: &str, mut req: OrderRequest, stamp: i64) -> OrderKey {
        req.cid = self.cid(name);
        let key = OrderKey::new(self.ledger.orders.len() as u32);
        self.ledger.orders.push(OrderRecord {
            key,
            req,
            created_at: TsMs(stamp),
            signed: None,
            state: OrderState::InFlight,
            cancel: CancelState::None,
            submitted_delivered: true,
            acknowledged: false,
            om_terminal: false,
            filled: Qty::ZERO,
            spent: Usdc::ZERO,
            final_qty: None,
            settlement: None,
            reserved: Usdc::ZERO,
            reserved_shares: Qty::ZERO,
            fill_seq: 0,
            res_fee: FeeCurve::TS_COMPAT,
            res_lo: Price::from_micros(10_000),
        });
        self.names.push(name.to_owned());
        key
    }

    /// The latest key written for a cid (its current generation).
    pub fn key_of(&self, name: &str) -> OrderKey {
        let i = self
            .names
            .iter()
            .rposition(|n| n == name)
            .unwrap_or_else(|| panic!("unknown order {name}"));
        OrderKey::new(i as u32)
    }

    pub fn cancel_op(&mut self, kind: CancelKind) -> CancelOp {
        let op = CancelOp {
            seq: CancelSeq::new(self.next_cancel),
            kind,
        };
        self.next_cancel += 1;
        op
    }

    pub fn op(&mut self) -> OpKey {
        let op = OpKey::new(self.next_op);
        self.next_op += 1;
        op
    }

    pub fn submit(&mut self, t: i64, cmd: ExecCommand<'_>) {
        let cx = ExecCtx {
            market: &self.market,
            ledger: &self.ledger,
            config: &self.cfg,
        };
        self.sim.submit(TsMs(t), cmd, &cx, &mut self.queue);
    }

    pub fn place(&mut self, t: i64, keys: &[OrderKey]) {
        self.submit(t, ExecCommand::Place { orders: keys });
    }

    pub fn cancel(&mut self, t: i64, keys: &[OrderKey]) {
        let op = self.cancel_op(if keys.len() == 1 {
            CancelKind::Order
        } else {
            CancelKind::Batch
        });
        self.submit(
            t,
            ExecCommand::Cancel {
                op,
                cause: CancelCause::Strategy(op),
                keys,
            },
        );
    }

    pub fn cancel_scope(&mut self, t: i64, scope: CancelScope) {
        let op = self.cancel_op(CancelKind::Market);
        self.submit(
            t,
            ExecCommand::CancelScope {
                op,
                cause: CancelCause::Strategy(op),
                scope,
            },
        );
    }

    pub fn cancel_all(&mut self, t: i64) {
        let op = self.cancel_op(CancelKind::All);
        self.submit(
            t,
            ExecCommand::CancelAll {
                op,
                cause: CancelCause::Strategy(op),
            },
        );
    }

    /// A real in-window tick at `t` on the current books (12 §5.2).
    pub fn tick(&mut self, t: i64) {
        let cx = ExecCtx {
            market: &self.market,
            ledger: &self.ledger,
            config: &self.cfg,
        };
        let ev = MarketEvent::PriceChange { changes: &[] };
        self.sim.on_market_event(TsMs(t), &ev, &cx, &mut self.queue);
    }

    /// Takes every queued event.
    pub fn events(&mut self) -> Vec<AccountEvent> {
        std::iter::from_fn(|| self.queue.pop()).collect()
    }

    /// Renders one event in the golden text format (compat_gen.ts).
    pub fn render(&self, e: &AccountEvent) -> String {
        let n = |k: OrderKey| self.names[k.index()].as_str();
        let at = e.at.0;
        match e.kind {
            AccountEventKind::OrderAccepted { order } => format!("{at} accepted {}", n(order)),
            AccountEventKind::SettlementUpdate {
                order,
                status,
                size_matched,
                ..
            } => format!(
                "{at} status {} {} {}",
                n(order),
                status.as_ts_str(),
                format_micros(size_matched.micros())
            ),
            AccountEventKind::Fill(f) => format!(
                "{} fill {}#{} {} {} {} fee={}",
                f.at.0,
                n(f.key.order),
                f.key.seq,
                f.liquidity.as_str(),
                format_micros(f.price.micros()),
                format_micros(f.qty.micros()),
                format_micros(f.fee.micros())
            ),
            AccountEventKind::OrderDone {
                order,
                reason,
                filled,
            } => format!(
                "{at} done {} {} {}",
                n(order),
                reason.as_ts_str(),
                format_micros(
                    filled
                        .expect("the simulator always sets filled (10 S3)")
                        .micros()
                )
            ),
            AccountEventKind::OrderOpen { order } => format!("{at} open {}", n(order)),
            AccountEventKind::OrderRejected { cid, reason, .. } => {
                format!("{at} rejected {} {}", self.cids[cid.index()], reason.code())
            }
            AccountEventKind::PositionsSplit { size, cost, .. } => format!(
                "{at} split {} cost={}",
                format_micros(size.micros()),
                format_micros(cost.micros())
            ),
            AccountEventKind::PositionsMerged { size, .. } => {
                format!("{at} merged {}", format_micros(size.micros()))
            }
            other => format!("{at} unexpected {other:?}"),
        }
    }

    /// Takes and renders every queued event.
    pub fn take_rendered(&mut self) -> Vec<String> {
        let evs = self.events();
        evs.iter().map(|e| self.render(e)).collect()
    }
}

/// A share-sized order request (the cid is set by [`Harness::record`]).
pub(super) fn req(o: Outcome, side: Side, price: i64, size: i64, ty: OrderType) -> OrderRequest {
    OrderRequest {
        cid: CidKey::new(0),
        outcome: o,
        side,
        price: Price::from_micros(price),
        size: OrderSize::Shares(Qty::from_micros(size)),
        order_type: ty,
        post_only: false,
        expire_at_ms: None,
        meta: None,
        note: None,
    }
}
