//! Shared deterministic risk decisions; cancellation never releases exposure.
use crate::intent::{Intent, PlaceOrder, PortfolioView};
use crate::math::js_number_string;
use crate::portfolio::{AccountEvent, Side};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskLimits {
    pub max_open_orders: f64,
    pub max_order_size: f64,
    pub max_abs_position: f64,
    pub max_loss_stop: f64,
}
impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_open_orders: 100.0,
            max_order_size: 2000.0,
            max_abs_position: 2000.0,
            max_loss_stop: 500.0,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct Blocked<M> {
    pub intent: Intent<M>,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskDecision<M> {
    pub allowed: Vec<Intent<M>>,
    pub rejected_events: Vec<AccountEvent>,
    pub blocked: Vec<Blocked<M>>,
}
struct Exposure {
    count: f64,
    buys: HashMap<String, f64>,
    sells: HashMap<String, f64>,
}
fn reject(now_ms: f64, client_order_id: &str, reason: &str) -> AccountEvent {
    AccountEvent::OrderRejected {
        ts_ms: now_ms,
        client_order_id: client_order_id.to_owned(),
        market: None,
        reason: reason.to_owned(),
    }
}
fn check<M>(
    order: &PlaceOrder<M>,
    view: PortfolioView<'_>,
    limits: &RiskLimits,
    exposure: &mut Exposure,
) -> Option<String> {
    let size = order
        .size
        .valid()
        .copied()
        .filter(|n| n.is_finite() && *n > 0.0)?;
    if size > limits.max_order_size {
        return Some(format!(
            "risk_max_order_size(max={})",
            js_number_string(limits.max_order_size)
        ));
    }
    if exposure.count + 1.0 > limits.max_open_orders {
        return Some(format!(
            "risk_max_open_orders(max={})",
            js_number_string(limits.max_open_orders)
        ));
    }
    let qty = view
        .snapshot
        .positions_by_asset_id
        .get(&order.asset_id)
        .map_or(0.0, |p| {
            crate::portfolio::position_view(p)
                .expect("typed numeric position slots")
                .qty
        });
    let buys = exposure.buys.get(&order.asset_id).copied().unwrap_or(0.0);
    let sells = exposure.sells.get(&order.asset_id).copied().unwrap_or(0.0);
    let projected = if order.side == Side::Buy {
        qty + buys + size
    } else {
        qty - (sells + size)
    };
    if projected.abs() > limits.max_abs_position {
        return Some(format!(
            "risk_max_abs_position(max={})",
            js_number_string(limits.max_abs_position)
        ));
    }
    exposure.count += 1.0;
    let values = if order.side == Side::Buy {
        &mut exposure.buys
    } else {
        &mut exposure.sells
    };
    values.insert(
        order.asset_id.clone(),
        if order.side == Side::Buy {
            buys + size
        } else {
            sells + size
        },
    );
    None
}
pub fn enforce_risk_limits<M: Clone>(
    now_ms: f64,
    intents: &[Intent<M>],
    portfolio: Option<PortfolioView<'_>>,
    limits: Option<&RiskLimits>,
) -> RiskDecision<M> {
    let mut result = RiskDecision {
        allowed: Vec::new(),
        rejected_events: Vec::new(),
        blocked: Vec::new(),
    };
    let Some(view) = portfolio else {
        result.allowed = intents.to_vec();
        return result;
    };
    let defaults = RiskLimits::default();
    let limits = limits.unwrap_or(&defaults);
    let raw_realized = view.snapshot.realized_pnl_total;
    let realized = if raw_realized.is_finite() {
        raw_realized
    } else {
        0.0
    };
    let loss = realized <= -limits.max_loss_stop.abs();
    let mut exposure = Exposure {
        count: 0.0,
        buys: HashMap::new(),
        sells: HashMap::new(),
    };
    for (_, raw) in view.snapshot.open_orders_by_client_id.object_iter() {
        let o = crate::portfolio::open_order_view(raw).expect("typed open-order slots");
        exposure.count += 1.0;
        let size = if o.remaining.is_finite() && o.remaining > 0.0 {
            o.remaining
        } else {
            0.0
        };
        let values = if o.side == Side::Buy {
            &mut exposure.buys
        } else {
            &mut exposure.sells
        };
        let old = values.get(&o.asset_id).copied().unwrap_or(0.0);
        values.insert(o.asset_id.clone(), old + size);
    }
    for intent in intents {
        match intent {
            Intent::PlaceBatch(batch) => {
                if loss {
                    let reason = format!("risk_loss_stop(realized={})", js_number_string(realized));
                    result.blocked.push(Blocked {
                        intent: intent.clone(),
                        reason: reason.clone(),
                    });
                    for order in &batch.orders {
                        result.rejected_events.push(reject(
                            now_ms,
                            &order.client_order_id,
                            &reason,
                        ));
                    }
                    continue;
                }
                let mut valid = Vec::new();
                for order in &batch.orders {
                    if let Some(reason) = check(order, view, limits, &mut exposure) {
                        result.rejected_events.push(reject(
                            now_ms,
                            &order.client_order_id,
                            &reason,
                        ));
                    } else {
                        valid.push(order.clone());
                    }
                }
                if !valid.is_empty() {
                    let mut allowed = batch.clone();
                    allowed.orders = valid;
                    result.allowed.push(Intent::PlaceBatch(allowed));
                }
            }
            Intent::PlaceLimit(order) => {
                let error = if loss {
                    Some(format!(
                        "risk_loss_stop(realized={})",
                        js_number_string(realized)
                    ))
                } else {
                    check(order, view, limits, &mut exposure)
                };
                if let Some(reason) = error {
                    result
                        .rejected_events
                        .push(reject(now_ms, &order.client_order_id, &reason));
                    result.blocked.push(Blocked {
                        intent: intent.clone(),
                        reason,
                    });
                } else {
                    result.allowed.push(intent.clone());
                }
            }
            _ => result.allowed.push(intent.clone()),
        }
    }
    result
}
