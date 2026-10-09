//! The author account-event view (30 §8): core events are small `Copy`
//! values holding keys (10 §10.1 V3); the session resolves those keys per
//! callback, without allocation, so the author gets references.

use pmb_core::event::{
    AccountEvent as CoreEvent, CancelFailReason, DoneReason, MergeFailReason, RejectReason,
    SplitFailReason,
};
use pmb_core::fill::{Fill, SettlementStatus};
use pmb_core::ids::{CancelOp, CidKey, ExchangeOrderId};
use pmb_core::{Qty, TsMs, Usdc};

use super::views::OrderView;
use crate::ledger::Ledger;

/// The author view of one fill (30 §8 `FillView`): `order` via the key,
/// outcome, side, price, qty, fee as charged, liquidity, `at`, `exchange_ts`.
pub type FillView = Fill;

/// One delivered account event as the strategy sees it (30 §8). Every
/// variant carries `at`, the engine delivery time (10 §10.1 V2).
#[non_exhaustive]
#[derive(Copy, Clone, Debug)]
pub enum AccountEvent<'a> {
    /// `order_submitted`.
    OrderSubmitted {
        /// Delivery time.
        at: TsMs,
        /// The order.
        order: &'a OrderView,
    },
    /// `order_rejected`; `order` is `None` for OM-level rejections.
    OrderRejected {
        /// Delivery time.
        at: TsMs,
        /// Interned client order id (session interner).
        cid: CidKey,
        /// The keyed order, for exchange-origin rejections.
        order: Option<&'a OrderView>,
        /// Reason (10 §10.2).
        reason: RejectReason,
    },
    /// `order_accepted`.
    OrderAccepted {
        /// Delivery time.
        at: TsMs,
        /// The order.
        order: &'a OrderView,
        /// Exchange (or simulator) order id.
        exchange_id: Option<ExchangeOrderId>,
    },
    /// Taker delay started (new).
    OrderDelayed {
        /// Delivery time.
        at: TsMs,
        /// The order.
        order: &'a OrderView,
        /// Exchange release time.
        release_at: TsMs,
    },
    /// `order_open`.
    OrderOpen {
        /// Delivery time.
        at: TsMs,
        /// The order.
        order: &'a OrderView,
    },
    /// `fill`.
    Fill {
        /// Delivery time.
        at: TsMs,
        /// The fill.
        fill: &'a FillView,
        /// The order it belongs to.
        order: &'a OrderView,
    },
    /// `ws_order_update` (`Failed` reverses the fill, 10 §9.2).
    SettlementUpdate {
        /// Delivery time.
        at: TsMs,
        /// The order.
        order: &'a OrderView,
        /// The fill, when the update is per fill.
        fill: Option<&'a FillView>,
        /// Status.
        status: SettlementStatus,
    },
    /// `order_done`.
    OrderDone {
        /// Delivery time.
        at: TsMs,
        /// The order.
        order: &'a OrderView,
        /// Reason.
        reason: DoneReason,
        /// Authoritative filled quantity, when reported.
        filled: Option<Qty>,
    },
    /// The exchange confirmed a cancel (realistic, paper, live; new).
    CancelAcked {
        /// Delivery time.
        at: TsMs,
        /// Cancel operation.
        op: CancelOp,
        /// The order (non-terminal).
        order: &'a OrderView,
    },
    /// `cancel_failed`.
    CancelFailed {
        /// Delivery time.
        at: TsMs,
        /// Cancel operation.
        op: CancelOp,
        /// The order, when known.
        order: Option<&'a OrderView>,
        /// Reason.
        reason: CancelFailReason,
    },
    /// `positions_split`.
    PositionsSplit {
        /// Delivery time.
        at: TsMs,
        /// Full sets.
        size: Qty,
        /// Collateral spent.
        cost: Usdc,
    },
    /// `split_failed`.
    SplitFailed {
        /// Delivery time.
        at: TsMs,
        /// Requested full sets.
        requested: Qty,
        /// Reason.
        reason: SplitFailReason,
    },
    /// `positions_merged`.
    PositionsMerged {
        /// Delivery time.
        at: TsMs,
        /// Full sets merged.
        size: Qty,
    },
    /// `merge_failed`.
    MergeFailed {
        /// Delivery time.
        at: TsMs,
        /// Requested full sets.
        requested: Qty,
        /// Reason.
        reason: MergeFailReason,
    },
    /// `account_stream_status` (live only).
    StreamStatus {
        /// Delivery time.
        at: TsMs,
        /// Connected.
        connected: bool,
    },
}

impl<'a> AccountEvent<'a> {
    /// Engine delivery time (30 §8, 10 §10.1 V2).
    pub fn at(&self) -> TsMs {
        match *self {
            AccountEvent::OrderSubmitted { at, .. }
            | AccountEvent::OrderRejected { at, .. }
            | AccountEvent::OrderAccepted { at, .. }
            | AccountEvent::OrderDelayed { at, .. }
            | AccountEvent::OrderOpen { at, .. }
            | AccountEvent::Fill { at, .. }
            | AccountEvent::SettlementUpdate { at, .. }
            | AccountEvent::OrderDone { at, .. }
            | AccountEvent::CancelAcked { at, .. }
            | AccountEvent::CancelFailed { at, .. }
            | AccountEvent::PositionsSplit { at, .. }
            | AccountEvent::SplitFailed { at, .. }
            | AccountEvent::PositionsMerged { at, .. }
            | AccountEvent::MergeFailed { at, .. }
            | AccountEvent::StreamStatus { at, .. } => at,
        }
    }

    /// Resolves a delivered core event against the ledger (30 §8, §16 S10):
    /// key lookups only, no allocation.
    // D-PENDING: the core `OrderAccepted` carries no exchange id before the
    // live adapter's side table (M9); chose `Sim(key)`, the simulator's id.
    pub fn resolve(ev: &'a CoreEvent, ledger: &'a Ledger) -> AccountEvent<'a> {
        use pmb_core::event::AccountEventKind as K;
        let at = ev.at;
        let o = |k| ledger.order(k);
        match &ev.kind {
            K::OrderSubmitted { order } => AccountEvent::OrderSubmitted {
                at,
                order: o(*order),
            },
            K::OrderRejected { order, cid, reason } => AccountEvent::OrderRejected {
                at,
                cid: *cid,
                order: order.map(o),
                reason: *reason,
            },
            K::OrderAccepted { order } => AccountEvent::OrderAccepted {
                at,
                order: o(*order),
                exchange_id: Some(ExchangeOrderId::Sim(*order)),
            },
            K::OrderDelayed { order, release_at } => AccountEvent::OrderDelayed {
                at,
                order: o(*order),
                release_at: *release_at,
            },
            K::OrderOpen { order } => AccountEvent::OrderOpen {
                at,
                order: o(*order),
            },
            K::Fill(f) => AccountEvent::Fill {
                at,
                fill: f,
                order: o(f.key.order),
            },
            K::SettlementUpdate {
                order,
                fill,
                status,
                ..
            } => AccountEvent::SettlementUpdate {
                at,
                order: o(*order),
                fill: fill.and_then(|k| ledger.fill_index(k).map(|i| &ledger.fills()[i])),
                status: *status,
            },
            K::OrderDone {
                order,
                reason,
                filled,
            } => AccountEvent::OrderDone {
                at,
                order: o(*order),
                reason: *reason,
                filled: *filled,
            },
            K::CancelAcked { op, order } => AccountEvent::CancelAcked {
                at,
                op: *op,
                order: o(*order),
            },
            K::CancelFailed { op, order, reason } => AccountEvent::CancelFailed {
                at,
                op: *op,
                order: order.map(o),
                reason: *reason,
            },
            K::PositionsSplit { size, cost, .. } => AccountEvent::PositionsSplit {
                at,
                size: *size,
                cost: *cost,
            },
            K::SplitFailed {
                requested, reason, ..
            } => AccountEvent::SplitFailed {
                at,
                requested: *requested,
                reason: *reason,
            },
            K::PositionsMerged { size, .. } => AccountEvent::PositionsMerged { at, size: *size },
            K::MergeFailed {
                requested, reason, ..
            } => AccountEvent::MergeFailed {
                at,
                requested: *requested,
                reason: *reason,
            },
            K::StreamStatus { connected } => AccountEvent::StreamStatus {
                at,
                connected: *connected,
            },
        }
    }

    /// TS kind string (`order_submitted`, `fill`, …; 10 §10.1).
    pub fn ts_kind(&self) -> &'static str {
        match self {
            AccountEvent::OrderSubmitted { .. } => "order_submitted",
            AccountEvent::OrderRejected { .. } => "order_rejected",
            AccountEvent::OrderAccepted { .. } => "order_accepted",
            AccountEvent::OrderDelayed { .. } => "order_delayed",
            AccountEvent::OrderOpen { .. } => "order_open",
            AccountEvent::Fill { .. } => "fill",
            AccountEvent::SettlementUpdate { .. } => "settlement_update",
            AccountEvent::OrderDone { .. } => "order_done",
            AccountEvent::CancelAcked { .. } => "cancel_acked",
            AccountEvent::CancelFailed { .. } => "cancel_failed",
            AccountEvent::PositionsSplit { .. } => "positions_split",
            AccountEvent::SplitFailed { .. } => "split_failed",
            AccountEvent::PositionsMerged { .. } => "positions_merged",
            AccountEvent::MergeFailed { .. } => "merge_failed",
            AccountEvent::StreamStatus { .. } => "account_stream_status",
        }
    }
}
