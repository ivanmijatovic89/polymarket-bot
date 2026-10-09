//! Account events and reason enums (10 §10). Events are small `Copy` values
//! referencing keys (V3); strings are produced only at I/O boundaries.

use crate::fill::{Fill, SettlementStatus};
use crate::ids::{CancelOp, CidKey, FillKey, OpKey, OrderKey};
use crate::{fixed::format_micros, Outcome, Qty, TsMs, Usdc};
use std::fmt;

/// Mode of a `TradingRestricted` rejection.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum TradingMode {
    PostOnly,
    CancelOnly,
    Disabled,
    Restarting,
}

/// Why a placement was rejected (engine and exchange origin, 10 §10.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum RejectReason {
    // engine origin
    InvalidPrice,
    InvalidSize,
    UnknownOutcome,
    PostOnlyRequiresResting,
    GtdRequiresExpiry,
    GtdExpiryTooSoon {
        min_offset_ms: i64,
    },
    InsufficientCapital {
        required: Usdc,
        available: Usdc,
    },
    InsufficientInventory {
        required: Qty,
        available: Qty,
    },
    RiskMaxOpenOrders {
        max: u32,
    },
    RiskMaxOrderSize {
        max: Qty,
    },
    RiskMaxAbsPosition {
        max: Qty,
    },
    RiskLossStop {
        realized: Usdc,
    },
    BatchTooLarge {
        max: u32,
    },
    SelfCross {
        resting: OrderKey,
    },
    MetaTooLarge,
    StrategyHalted,
    KillSwitch,
    // exchange origin
    InvalidTick {
        price: crate::Price,
        tick: crate::Price,
    },
    PriceOutOfBounds {
        min: crate::Price,
        max: crate::Price,
    },
    SizeBelowMinimum {
        min: Qty,
    },
    NotionalBelowMinimum {
        min: Usdc,
    },
    SizePrecision,
    AmountPrecision,
    PostOnlyWouldCross,
    GtdLeadTooShort {
        min_lead_ms: i64,
    },
    MarketClosed,
    TradingRestricted {
        mode: TradingMode,
    },
    RateLimited {
        retry_after_ms: i64,
    },
    InsufficientExchangeBalance,
    NotFoundAfterAmbiguous,
    Unmapped {
        code: u16,
    },
}

impl RejectReason {
    /// Engine-origin reasons (no exchange round trip).
    pub const fn is_engine_origin(self) -> bool {
        matches!(
            self,
            RejectReason::InvalidPrice
                | RejectReason::InvalidSize
                | RejectReason::UnknownOutcome
                | RejectReason::PostOnlyRequiresResting
                | RejectReason::GtdRequiresExpiry
                | RejectReason::GtdExpiryTooSoon { .. }
                | RejectReason::InsufficientCapital { .. }
                | RejectReason::InsufficientInventory { .. }
                | RejectReason::RiskMaxOpenOrders { .. }
                | RejectReason::RiskMaxOrderSize { .. }
                | RejectReason::RiskMaxAbsPosition { .. }
                | RejectReason::RiskLossStop { .. }
                | RejectReason::BatchTooLarge { .. }
                | RejectReason::SelfCross { .. }
                | RejectReason::MetaTooLarge
                | RejectReason::StrategyHalted
                | RejectReason::KillSwitch
        )
    }

    /// Reason code (the text before `(` in the TS string; 22 §3.4).
    pub const fn code(self) -> &'static str {
        match self {
            RejectReason::InvalidPrice => "invalid_price",
            RejectReason::InvalidSize => "invalid_size",
            RejectReason::UnknownOutcome => "missing_assetId",
            RejectReason::PostOnlyRequiresResting => "post_only_requires_gtc_or_gtd",
            RejectReason::GtdRequiresExpiry => "gtd_requires_expireAtMs",
            RejectReason::GtdExpiryTooSoon { .. } => "gtd_expireAtMs_too_soon",
            RejectReason::InsufficientCapital { .. } => "insufficient_capital",
            RejectReason::InsufficientInventory { .. } => "insufficient_inventory",
            RejectReason::RiskMaxOpenOrders { .. } => "risk_max_open_orders",
            RejectReason::RiskMaxOrderSize { .. } => "risk_max_order_size",
            RejectReason::RiskMaxAbsPosition { .. } => "risk_max_abs_position",
            RejectReason::RiskLossStop { .. } => "risk_loss_stop",
            RejectReason::BatchTooLarge { .. } => "batch_too_large",
            RejectReason::SelfCross { .. } => "self_cross",
            RejectReason::MetaTooLarge => "meta_too_large",
            RejectReason::StrategyHalted => "strategy_halted",
            RejectReason::KillSwitch => "kill_switch",
            RejectReason::InvalidTick { .. } => "invalid_tick",
            RejectReason::PriceOutOfBounds { .. } => "price_out_of_bounds",
            RejectReason::SizeBelowMinimum { .. } => "size_below_minimum",
            RejectReason::NotionalBelowMinimum { .. } => "notional_below_minimum",
            RejectReason::SizePrecision => "size_precision",
            RejectReason::AmountPrecision => "amount_precision",
            RejectReason::PostOnlyWouldCross => "post_only_would_cross",
            RejectReason::GtdLeadTooShort { .. } => "gtd_lead_too_short",
            RejectReason::MarketClosed => "market_closed",
            RejectReason::TradingRestricted { .. } => "trading_restricted",
            RejectReason::RateLimited { .. } => "rate_limited",
            RejectReason::InsufficientExchangeBalance => "insufficient_exchange_balance",
            RejectReason::NotFoundAfterAmbiguous => "not_found_after_ambiguous",
            RejectReason::Unmapped { .. } => "unmapped",
        }
    }
}

impl fmt::Display for RejectReason {
    /// TS string, numbers as exact decimals with trailing zeros trimmed (10 §10.2).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let c = self.code();
        match *self {
            RejectReason::GtdExpiryTooSoon { min_offset_ms } => {
                write!(f, "{c}(min_offset_ms={min_offset_ms})")
            }
            RejectReason::InsufficientCapital {
                required,
                available,
            } => write!(
                f,
                "{c}(required={},available={})",
                format_micros(required.micros()),
                format_micros(available.micros())
            ),
            RejectReason::InsufficientInventory {
                required,
                available,
            } => write!(
                f,
                "{c}(required={},available={})",
                format_micros(required.micros()),
                format_micros(available.micros())
            ),
            RejectReason::RiskMaxOpenOrders { max } => write!(f, "{c}(max={max})"),
            RejectReason::RiskMaxOrderSize { max } => {
                write!(f, "{c}(max={})", format_micros(max.micros()))
            }
            RejectReason::RiskMaxAbsPosition { max } => {
                write!(f, "{c}(max={})", format_micros(max.micros()))
            }
            RejectReason::RiskLossStop { realized } => {
                write!(f, "{c}(realized={})", format_micros(realized.micros()))
            }
            RejectReason::BatchTooLarge { max } => write!(f, "{c}(max_{max}_orders)"),
            _ => f.write_str(c),
        }
    }
}

/// Why a cancel was issued (10 §10.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CancelCause {
    Strategy(CancelOp),
    Rotation,
    WindowEnd,
    MarketClosed,
    HeartbeatLoss,
    KillSwitch,
    StrategyPanic,
    Operator,
    Exchange,
}

/// Why an order ended (10 §10.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum DoneReason {
    Filled,
    Canceled(CancelCause),
    Expired,
    Killed,
}

impl DoneReason {
    /// TS `order_done` reason string.
    pub const fn as_ts_str(self) -> &'static str {
        match self {
            DoneReason::Filled => "filled",
            DoneReason::Canceled(_) => "canceled",
            DoneReason::Expired => "expired",
            DoneReason::Killed => "killed",
        }
    }
}

/// Why a cancel failed (10 §10.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CancelFailReason {
    UnknownClientOrder,
    ConflictingRefs,
    MissingExchangeOrderId,
    NotCancelableDuringDelay,
    ExchangeNotCanceled { code: u16 },
    TooManyIds,
    Ambiguous,
}

impl CancelFailReason {
    pub const fn code(self) -> &'static str {
        match self {
            CancelFailReason::UnknownClientOrder => "unknown_client_order",
            // D62: the TS string (`cancellation.ts:90,99`).
            CancelFailReason::ConflictingRefs => "conflicting_order_reference",
            CancelFailReason::MissingExchangeOrderId => "missing_exchange_order_id",
            CancelFailReason::NotCancelableDuringDelay => "not_cancelable_during_delay",
            CancelFailReason::ExchangeNotCanceled { .. } => "exchange_not_canceled",
            // TS: `invalid_cancel_batch_size` (`cancellation.ts:70`).
            CancelFailReason::TooManyIds => "invalid_cancel_batch_size",
            CancelFailReason::Ambiguous => "ambiguous",
        }
    }
}

/// Why a split or merge failed (10 §10.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SplitMergeFailReason {
    InvalidSize,
    InsufficientCollateral,
    InsufficientPairs,
    TxFailed,
    Ambiguous,
    // D-PENDING: 12 §7.3 checks "Halt and guards" first for a split, but
    // 10 §10.2 lists no halt reason for SplitFailed; chose the two
    // `RejectReason` halt variants with the same codes. Never produced in
    // ts-compat (a backtest strategy is never halted while it runs).
    /// The strategy is halted (12 §11, 50 §10.2 `reject_burst`).
    StrategyHalted,
    /// A tripped kill switch or session guard (12 §8.3).
    KillSwitch,
}

pub type SplitFailReason = SplitMergeFailReason;
pub type MergeFailReason = SplitMergeFailReason;

impl SplitMergeFailReason {
    pub const fn code(self) -> &'static str {
        match self {
            SplitMergeFailReason::InvalidSize => "invalid_size",
            SplitMergeFailReason::InsufficientCollateral => "insufficient_collateral",
            // TS: `insufficient_uncommitted_positions` (`OrderManager.ts:429`).
            SplitMergeFailReason::InsufficientPairs => "insufficient_uncommitted_positions",
            SplitMergeFailReason::TxFailed => "tx_failed",
            SplitMergeFailReason::Ambiguous => "ambiguous",
            SplitMergeFailReason::StrategyHalted => "strategy_halted",
            SplitMergeFailReason::KillSwitch => "kill_switch",
        }
    }
}

/// Account event payload (10 §10.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AccountEventKind {
    OrderSubmitted {
        order: OrderKey,
    },
    OrderRejected {
        order: Option<OrderKey>,
        cid: CidKey,
        reason: RejectReason,
    },
    OrderAccepted {
        order: OrderKey,
    },
    OrderDelayed {
        order: OrderKey,
        release_at: TsMs,
    },
    OrderOpen {
        order: OrderKey,
    },
    Fill(Fill),
    SettlementUpdate {
        order: OrderKey,
        fill: Option<FillKey>,
        status: SettlementStatus,
        size_matched: Qty,
    },
    OrderDone {
        order: OrderKey,
        reason: DoneReason,
        filled: Option<Qty>,
    },
    CancelAcked {
        op: CancelOp,
        order: OrderKey,
    },
    CancelFailed {
        op: CancelOp,
        order: Option<OrderKey>,
        reason: CancelFailReason,
    },
    PositionsSplit {
        op: OpKey,
        size: Qty,
        cost: Usdc,
    },
    SplitFailed {
        op: OpKey,
        requested: Qty,
        reason: SplitFailReason,
    },
    PositionsMerged {
        op: OpKey,
        size: Qty,
    },
    MergeFailed {
        op: OpKey,
        requested: Qty,
        reason: MergeFailReason,
    },
    StreamStatus {
        connected: bool,
    },
}

impl AccountEventKind {
    /// TS kind string (trace `event.kind`).
    pub const fn ts_kind(&self) -> &'static str {
        match self {
            AccountEventKind::OrderSubmitted { .. } => "order_submitted",
            AccountEventKind::OrderRejected { .. } => "order_rejected",
            AccountEventKind::OrderAccepted { .. } => "order_accepted",
            AccountEventKind::OrderDelayed { .. } => "order_delayed",
            AccountEventKind::OrderOpen { .. } => "order_open",
            AccountEventKind::Fill(_) => "fill",
            AccountEventKind::SettlementUpdate { .. } => "settlement_update",
            AccountEventKind::OrderDone { .. } => "order_done",
            AccountEventKind::CancelAcked { .. } => "cancel_acked",
            AccountEventKind::CancelFailed { .. } => "cancel_failed",
            AccountEventKind::PositionsSplit { .. } => "positions_split",
            AccountEventKind::SplitFailed { .. } => "split_failed",
            AccountEventKind::PositionsMerged { .. } => "positions_merged",
            AccountEventKind::MergeFailed { .. } => "merge_failed",
            AccountEventKind::StreamStatus { .. } => "account_stream_status",
        }
    }

    /// The order this event is about, if any.
    pub const fn order(&self) -> Option<OrderKey> {
        match *self {
            AccountEventKind::OrderSubmitted { order }
            | AccountEventKind::OrderAccepted { order }
            | AccountEventKind::OrderDelayed { order, .. }
            | AccountEventKind::OrderOpen { order }
            | AccountEventKind::SettlementUpdate { order, .. }
            | AccountEventKind::OrderDone { order, .. }
            | AccountEventKind::CancelAcked { order, .. } => Some(order),
            AccountEventKind::Fill(f) => Some(f.key.order),
            AccountEventKind::OrderRejected { order, .. }
            | AccountEventKind::CancelFailed { order, .. } => order,
            _ => None,
        }
    }

    /// Terminal for its order (S1): `OrderDone` or a keyed `OrderRejected`.
    pub const fn is_terminal(&self) -> bool {
        matches!(
            self,
            AccountEventKind::OrderDone { .. }
                | AccountEventKind::OrderRejected { order: Some(_), .. }
        )
    }
}

/// An account event with its delivery time (V2).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct AccountEvent {
    pub at: TsMs,
    pub kind: AccountEventKind,
}

/// Which outcome an engine-level cancel-market targets.
pub type CancelScopeOutcome = Option<Outcome>;
