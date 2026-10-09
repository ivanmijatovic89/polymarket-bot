//! Fills, settlement statuses, positions and capital (10 §9).

use crate::ids::{FillKey, TradeSeq};
use crate::order::Side;
use crate::{Outcome, Price, Qty, TsMs, Usdc};

/// Maker or taker side of a fill.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Liquidity {
    Maker,
    Taker,
}

impl Liquidity {
    /// TS string (`MAKER` / `TAKER`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Liquidity::Maker => "MAKER",
            Liquidity::Taker => "TAKER",
        }
    }
}

/// One fill: one (own order, trade, price level) (10 §9.1, 13 F-U1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Fill {
    pub key: FillKey,
    pub trade: TradeSeq,
    pub outcome: Outcome,
    pub side: Side,
    pub price: Price,
    pub qty: Qty,
    /// Charged fee, computed once by the fee model; makers 0.
    pub fee: Usdc,
    pub liquidity: Liquidity,
    /// Time the fill becomes visible to the engine.
    pub at: TsMs,
    pub exchange_ts: Option<TsMs>,
    /// Arrived after the order was terminal.
    pub late: bool,
}

/// Per-trade settlement status (10 §9.2).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SettlementStatus {
    Matched,
    Mined,
    Confirmed,
    Retrying,
    Failed,
}

impl SettlementStatus {
    /// TS `TradeStatusRank`; `Retrying` keeps the previous rank (`None`),
    /// `Failed` has no rank.
    pub const fn rank(self) -> Option<u8> {
        match self {
            SettlementStatus::Matched => Some(1),
            SettlementStatus::Mined => Some(2),
            SettlementStatus::Confirmed => Some(3),
            SettlementStatus::Retrying | SettlementStatus::Failed => None,
        }
    }

    pub const fn is_terminal(self) -> bool {
        matches!(self, SettlementStatus::Confirmed | SettlementStatus::Failed)
    }

    /// TS trade-status string.
    pub const fn as_ts_str(self) -> &'static str {
        match self {
            SettlementStatus::Matched => "MATCHED",
            SettlementStatus::Mined => "MINED",
            SettlementStatus::Confirmed => "CONFIRMED",
            SettlementStatus::Retrying => "RETRYING",
            SettlementStatus::Failed => "FAILED",
        }
    }
}

/// Position per outcome: quantity and average-cost basis (10 §9.3).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub qty: Qty,
    pub cost_basis: Usdc,
}

/// Capital view (10 §9.4): `available = cash − reserved`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Capital {
    pub starting: Usdc,
    pub cash: Usdc,
    pub reserved: Usdc,
}

impl Capital {
    #[inline]
    pub fn available(&self) -> Usdc {
        self.cash - self.reserved
    }
}
