//! Portfolio: positions, orders, capital and realized PnL, driven only by
//! account events.

use crate::fixed::Usdc;
use crate::model::{AssetId, ClientOrderId, Fill, Order, Position, TsMs};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Capital {
    pub starting: Usdc,
    pub cash: Usdc,
    /// Unspent BUY commitments, pending splits, matched BUYs awaiting fills.
    pub reserved: Usdc,
}

impl Capital {
    pub fn available(&self) -> Usdc {
        self.cash - self.reserved
    }
}

/// Read-only portfolio state handed to strategies.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PortfolioView {
    pub now_ms: TsMs,
    pub capital: Capital,
    pub realized_pnl: Usdc,
    pub positions: BTreeMap<AssetId, Position>,
    /// Every order this session placed, by client id (including terminal ones).
    pub orders: BTreeMap<ClientOrderId, Order>,
    /// Most recent fills (bounded).
    pub recent_fills: Vec<Fill>,
}

impl PortfolioView {
    pub fn position(&self, asset: &AssetId) -> Option<&Position> {
        self.positions.get(asset)
    }
    pub fn open_orders(&self) -> impl Iterator<Item = &Order> {
        self.orders.values().filter(|o| !o.state.is_terminal())
    }
}
