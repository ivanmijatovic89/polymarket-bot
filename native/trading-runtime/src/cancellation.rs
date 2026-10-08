//! Shared cancel scope validation and deterministic target resolution.
use crate::intent::{CancelBatch, CancelMarket, InputField, OrderReference, PortfolioView};
use crate::portfolio::{AccountEvent, CancelOperation, OrderState};
use serde::Serialize;
use std::collections::HashSet;

pub fn cancel_failed(
    operation: CancelOperation,
    ts_ms: f64,
    reason: &str,
    target: Option<&OrderReference>,
    market: Option<&str>,
    asset_id: Option<&str>,
) -> AccountEvent {
    fn truthy(value: Option<&String>) -> Option<String> {
        value.filter(|v| !v.is_empty()).cloned()
    }
    AccountEvent::CancelFailed {
        ts_ms,
        operation,
        reason: reason.to_owned(),
        client_order_id: truthy(target.and_then(|r| r.client_order_id.valid())),
        order_id: truthy(target.and_then(|r| r.order_id.valid())),
        market: market.filter(|v| !v.is_empty()).map(str::to_owned),
        asset_id: asset_id.filter(|v| !v.is_empty()).map(str::to_owned),
    }
}
pub fn validate_cancel_scope(scope: &CancelMarket) -> Option<&'static str> {
    if scope.market.is_absent() && scope.asset_id.is_absent() {
        return Some("missing_cancel_scope");
    }
    if !scope.market.is_absent()
        && !scope.market.valid().is_some_and(|s| {
            s.len() == 66
                && s.starts_with("0x")
                && s.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
        })
    {
        return Some("invalid_cancel_market");
    }
    if !scope.asset_id.is_absent()
        && !scope
            .asset_id
            .valid()
            .is_some_and(|s| !s.is_empty() && s.as_bytes().iter().all(u8::is_ascii_digit))
    {
        return Some("invalid_cancel_assetId");
    }
    None
}
pub fn matches_cancel_scope(
    market: Option<&str>,
    asset_id: Option<&str>,
    scope: &CancelMarket,
) -> bool {
    (scope.market.is_absent()
        || scope
            .market
            .valid()
            .is_some_and(|s| market.is_some_and(|m| m.to_lowercase() == s.to_lowercase())))
        && (scope.asset_id.is_absent()
            || scope
                .asset_id
                .valid()
                .is_some_and(|s| asset_id == Some(s.as_str())))
}
/// ECMA-262 WhiteSpace + LineTerminator set used by String.prototype.trim.
fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn valid_id(field: &InputField<String>) -> bool {
    field
        .valid()
        .is_some_and(|s| !s.is_empty() && s.trim_matches(js_whitespace) == s)
}
#[derive(Debug, Serialize)]
pub struct CancelResolution {
    pub orders: Vec<OrderReference>,
    pub events: Vec<AccountEvent>,
}
pub fn resolve_cancel_batch(
    intent: &CancelBatch,
    portfolio: Option<PortfolioView<'_>>,
    now_ms: f64,
    dry_run: bool,
) -> CancelResolution {
    let mut result = CancelResolution {
        orders: Vec::new(),
        events: Vec::new(),
    };
    let fail = |reason: &str, target: Option<&OrderReference>| {
        cancel_failed(CancelOperation::Batch, now_ms, reason, target, None, None)
    };
    let Some(refs) = intent.orders.valid().filter(|v| v.len() <= 3000) else {
        result.events.push(fail("invalid_cancel_batch_size", None));
        return result;
    };
    let mut seen = HashSet::new();
    for input in refs {
        let Some(reference) = input.valid() else {
            result.events.push(fail("invalid_order_reference", None));
            continue;
        };
        if (reference.client_order_id.is_absent() && reference.order_id.is_absent())
            || (!reference.client_order_id.is_absent() && !valid_id(&reference.client_order_id))
            || (!reference.order_id.is_absent() && !valid_id(&reference.order_id))
        {
            result.events.push(fail("invalid_order_reference", None));
            continue;
        }
        let cid = reference.client_order_id.valid();
        let oid = reference.order_id.valid();
        let snapshot = portfolio.map(|p| p.snapshot);
        let by_client = cid.and_then(|c| snapshot.and_then(|p| p.open_orders_by_client_id.get(c)));
        let by_exchange = oid.and_then(|id| {
            snapshot.and_then(|p| {
                p.open_orders_by_client_id
                    .object_iter()
                    .find(|(_, o)| o.order_id.as_ref() == Some(id))
                    .map(|(_, o)| o)
            })
        });
        if cid.is_some_and(|c| by_exchange.is_some_and(|o| &o.client_order_id != c)) {
            result
                .events
                .push(fail("conflicting_order_reference", Some(reference)));
            continue;
        }
        let bot = by_client.or(by_exchange);
        let previous = if let Some(c) = cid {
            snapshot.and_then(|p| p.orders_by_client_id.get(c))
        } else {
            oid.and_then(|id| {
                snapshot.and_then(|p| {
                    p.orders_by_client_id
                        .object_iter()
                        .find(|(_, o)| o.order_id.as_ref() == Some(id))
                        .map(|(_, o)| o)
                })
            })
        };
        let known_id = bot
            .and_then(|o| o.order_id.as_ref())
            .or_else(|| previous.and_then(|o| o.order_id.as_ref()));
        if oid.is_some_and(|id| known_id.is_some_and(|known| !known.is_empty() && known != id)) {
            result
                .events
                .push(fail("conflicting_order_reference", Some(reference)));
            continue;
        }
        if bot.is_none()
            && previous.is_some_and(|p| {
                matches!(
                    p.lifecycle_state,
                    Some(OrderState::Filled)
                        | Some(OrderState::Canceled)
                        | Some(OrderState::Expired)
                        | Some(OrderState::Killed)
                        | Some(OrderState::Rejected)
                )
            })
        {
            continue;
        }
        if cid.is_some() && bot.is_none() && oid.is_none() {
            result
                .events
                .push(fail("unknown_client_order", Some(reference)));
            continue;
        }
        if bot.is_some_and(|o| o.order_id.as_ref().is_none_or(String::is_empty)) && !dry_run {
            result
                .events
                .push(fail("missing_exchange_order_id", Some(reference)));
            continue;
        }
        let order_id = bot
            .and_then(|o| o.order_id.as_ref())
            .or(oid)
            .filter(|s| !s.is_empty());
        let client_order_id = bot
            .map(|o| &o.client_order_id)
            .or(cid)
            .filter(|s| !s.is_empty());
        let key = if let Some(id) = order_id {
            format!("exchange:{id}")
        } else {
            format!(
                "client:{}",
                client_order_id.map_or("undefined", String::as_str)
            )
        };
        if !seen.insert(key) {
            continue;
        }
        result.orders.push(OrderReference {
            client_order_id: client_order_id
                .map_or(InputField::Absent, |v| InputField::Valid(v.clone())),
            order_id: order_id.map_or(InputField::Absent, |v| InputField::Valid(v.clone())),
            extensions: Default::default(),
        });
    }
    result
}
