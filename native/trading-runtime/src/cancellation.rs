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
        let by_client = cid
            .and_then(|c| snapshot.and_then(|p| p.open_orders_by_client_id.get(c)))
            .map(|r| crate::portfolio::open_order_view(r).expect("typed open-order slots"));
        let by_exchange = oid.and_then(|id| {
            snapshot.and_then(|p| {
                p.open_orders_by_client_id
                    .object_iter()
                    .map(|(_, r)| {
                        crate::portfolio::open_order_view(r).expect("typed open-order slots")
                    })
                    .find(|o| o.order_id.as_ref() == Some(id))
            })
        });
        if cid.is_some_and(|c| {
            by_exchange
                .as_ref()
                .is_some_and(|o| &o.client_order_id != c)
        }) {
            result
                .events
                .push(fail("conflicting_order_reference", Some(reference)));
            continue;
        }
        let bot_owned = by_client.or(by_exchange);
        let bot = bot_owned.as_ref();
        let previous = if let Some(c) = cid {
            snapshot
                .and_then(|p| p.orders_by_client_id.get(c))
                .map(|r| crate::portfolio::order_history_view(r).expect("typed history slots"))
        } else {
            oid.and_then(|id| {
                snapshot.and_then(|p| {
                    p.orders_by_client_id
                        .object_iter()
                        .map(|(_, r)| {
                            crate::portfolio::order_history_view(r).expect("typed history slots")
                        })
                        .find(|o| o.order_id.as_ref() == Some(id))
                })
            })
        };
        let previous = previous.as_ref();
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

pub struct ManagedCancelResolution {
    pub orders: Vec<crate::intent::ManagedIntent>,
    pub events: Vec<crate::portfolio_records::ManagedAccountEvent>,
}
pub fn managed_cancel_failed(
    graph: &crate::metadata::MetadataGraph,
    operation: crate::metadata::MetadataValue,
    now_ms: f64,
    reason: &str,
    target: Option<&crate::metadata::MetadataHandle>,
) -> Result<crate::portfolio_records::ManagedAccountEvent, crate::metadata::JsException> {
    use crate::intent::managed as g;
    let event = g::event(
        graph,
        [
            ("kind", "cancel_failed".into()),
            ("operation", operation),
            ("tsMs", now_ms.into()),
            ("reason", reason.into()),
        ],
    )?;
    if let Some(target) = target {
        for key in ["clientOrderId", "orderId", "market", "assetId"] {
            let value = target.get_property(key)?;
            if value.is_truthy() {
                event.envelope().set(key, value)?;
            }
        }
    }
    Ok(event)
}
fn managed_valid_id(value: &crate::metadata::MetadataValue) -> bool {
    use crate::metadata::MetadataValue;
    let MetadataValue::String(value) = value else {
        return false;
    };
    let units = value.units();
    !units.is_empty()
        && !units
            .first()
            .is_some_and(|x| char::from_u32(u32::from(*x)).is_some_and(js_whitespace))
        && !units
            .last()
            .is_some_and(|x| char::from_u32(u32::from(*x)).is_some_and(js_whitespace))
}
pub fn validate_managed_cancel_scope(
    intent: &crate::intent::ManagedIntent,
) -> Result<Option<&'static str>, crate::metadata::JsException> {
    use crate::metadata::MetadataValue;
    let market = intent.get_property("market")?;
    let asset = intent.get_property("assetId")?;
    if matches!(market, MetadataValue::Missing) && matches!(asset, MetadataValue::Missing) {
        return Ok(Some("missing_cancel_scope"));
    }
    if !matches!(market, MetadataValue::Missing)
        && !matches!(market,MetadataValue::String(ref s) if {let v=s.units();v.len()==66&&v[0]==48&&v[1]==120&&v[2..].iter().all(|n|*n<=127&&(*n as u8).is_ascii_hexdigit())})
    {
        return Ok(Some("invalid_cancel_market"));
    }
    if !matches!(asset, MetadataValue::Missing)
        && !matches!(asset,MetadataValue::String(ref s) if {let v=s.units();!v.is_empty()&&v.iter().all(|n|*n>=48&&*n<=57)})
    {
        return Ok(Some("invalid_cancel_assetId"));
    }
    Ok(None)
}
pub fn matches_managed_cancel_scope(
    order: &crate::metadata::MetadataHandle,
    scope: &crate::intent::ManagedIntent,
) -> Result<bool, crate::metadata::JsException> {
    use crate::intent::managed as g;
    use crate::metadata::MetadataValue;
    let market = scope.get_property("market")?;
    let asset = scope.get_property("assetId")?;
    let market_matches = if matches!(market, MetadataValue::Missing) {
        true
    } else {
        let target = order.get_property("market")?;
        if matches!(target, MetadataValue::Missing | MetadataValue::Null) {
            false
        } else {
            let a = g::string(target)?;
            let b = g::string(market)?;
            let a = a
                .as_str()
                .ok_or(crate::metadata::MetadataError::WrongKind)?;
            let b = b
                .as_str()
                .ok_or(crate::metadata::MetadataError::WrongKind)?;
            a.to_lowercase() == b.to_lowercase()
        }
    };
    Ok(market_matches
        && (matches!(asset, MetadataValue::Missing)
            || g::strict_equal(&order.get_property("assetId")?, &asset)))
}
pub fn resolve_managed_cancel_batch(
    graph: &crate::metadata::MetadataGraph,
    intent: &crate::intent::ManagedIntent,
    portfolio: Option<&crate::portfolio_records::PortfolioSnapshotRecord>,
    now_ms: f64,
    dry_run: bool,
) -> Result<ManagedCancelResolution, crate::metadata::JsException> {
    use crate::intent::{managed as g, ManagedIntent};
    use crate::metadata::{MetadataHandle, MetadataValue};
    let mut result = ManagedCancelResolution {
        orders: Vec::new(),
        events: Vec::new(),
    };
    let fail = |reason: &str, target: Option<&MetadataHandle>| {
        managed_cancel_failed(graph, intent.get_property("kind")?, now_ms, reason, target)
    };
    let refs = match intent.get_property("orders")? {
        MetadataValue::Reference(h) if h.is_array() && h.length()? <= 3000 => h,
        _ => {
            result.events.push(fail("invalid_cancel_batch_size", None)?);
            return Ok(result);
        }
    };
    let empty = graph.object()?;
    let open = match portfolio {
        Some(p) => g::members(p.handle().as_handle(), "openOrdersByClientId")?,
        None => empty.clone(),
    };
    let history = match portfolio {
        Some(p) => g::members(p.handle().as_handle(), "ordersByClientId")?,
        None => empty,
    };
    let open_values = g::values(&open)?;
    let history_values = g::values(&history)?;
    let mut seen = HashSet::new();
    let mut index = 0;
    while index < refs.length()? {
        let reference = refs.get_index(index)?;
        index += 1;
        let reference = match reference {
            MetadataValue::Reference(h) if !h.is_array() => h,
            _ => {
                result.events.push(fail("invalid_order_reference", None)?);
                continue;
            }
        };
        let cid = reference.get_property("clientOrderId")?;
        let oid = reference.get_property("orderId")?;
        if (matches!(cid, MetadataValue::Missing) && matches!(oid, MetadataValue::Missing))
            || (!matches!(cid, MetadataValue::Missing) && !managed_valid_id(&cid))
            || (!matches!(oid, MetadataValue::Missing) && !managed_valid_id(&oid))
        {
            result.events.push(fail("invalid_order_reference", None)?);
            continue;
        }
        let by_client = if cid.is_truthy() {
            match open.get_property(g::string(cid.clone())?)? {
                MetadataValue::Missing | MetadataValue::Null => None,
                v => Some(g::object(v)?),
            }
        } else {
            None
        };
        let by_exchange = if oid.is_truthy() {
            let mut found = None;
            for order in &open_values {
                if g::strict_equal(&order.get_property("orderId")?, &oid) {
                    found = Some(order.clone());
                    break;
                }
            }
            found
        } else {
            None
        };
        let conflicting_client = if cid.is_truthy() {
            match &by_exchange {
                Some(order) => !g::strict_equal(&order.get_property("clientOrderId")?, &cid),
                None => false,
            }
        } else {
            false
        };
        if conflicting_client {
            result
                .events
                .push(fail("conflicting_order_reference", Some(&reference))?);
            continue;
        }
        let bot = by_client.or(by_exchange);
        let previous = if cid.is_truthy() {
            match history.get_property(g::string(cid.clone())?)? {
                MetadataValue::Missing | MetadataValue::Null => None,
                v => Some(g::object(v)?),
            }
        } else {
            let mut found = None;
            for order in &history_values {
                if g::strict_equal(&order.get_property("orderId")?, &oid) {
                    found = Some(order.clone());
                    break;
                }
            }
            found
        };
        let mut known_id = bot
            .as_ref()
            .map(|o| o.get_property("orderId"))
            .transpose()?
            .unwrap_or(MetadataValue::Missing);
        if matches!(known_id, MetadataValue::Missing | MetadataValue::Null) {
            known_id = previous
                .as_ref()
                .map(|o| o.get_property("orderId"))
                .transpose()?
                .unwrap_or(MetadataValue::Missing);
        }
        if oid.is_truthy() && known_id.is_truthy() && !g::strict_equal(&oid, &known_id) {
            result
                .events
                .push(fail("conflicting_order_reference", Some(&reference))?);
            continue;
        }
        if bot.is_none() {
            if let Some(previous) = &previous {
                if previous.get_property("lifecycleState")?.is_truthy() {
                    let state = previous.get_property("lifecycleState")?;
                    if ["filled", "canceled", "expired", "killed", "rejected"]
                        .iter()
                        .any(|s| g::is_string(&state, s))
                    {
                        continue;
                    }
                }
            }
        }
        if cid.is_truthy() && bot.is_none() && !oid.is_truthy() {
            result
                .events
                .push(fail("unknown_client_order", Some(&reference))?);
            continue;
        }
        let missing_exchange = match &bot {
            Some(order) => !order.get_property("orderId")?.is_truthy(),
            None => false,
        };
        if missing_exchange && !dry_run {
            result
                .events
                .push(fail("missing_exchange_order_id", Some(&reference))?);
            continue;
        }
        let mut order_id = bot
            .as_ref()
            .map(|o| o.get_property("orderId"))
            .transpose()?
            .unwrap_or(MetadataValue::Missing);
        if matches!(order_id, MetadataValue::Missing | MetadataValue::Null) {
            order_id = oid;
        }
        let mut client_id = bot
            .as_ref()
            .map(|o| o.get_property("clientOrderId"))
            .transpose()?
            .unwrap_or(MetadataValue::Missing);
        if matches!(client_id, MetadataValue::Missing | MetadataValue::Null) {
            client_id = cid;
        }
        let mut key = if order_id.is_truthy() {
            "exchange:".encode_utf16().collect::<Vec<_>>()
        } else {
            "client:".encode_utf16().collect::<Vec<_>>()
        };
        key.extend(if order_id.is_truthy() {
            g::string(order_id.clone())?.units()
        } else if client_id.is_truthy() {
            g::string(client_id.clone())?.units()
        } else {
            "undefined".encode_utf16().collect()
        });
        if !seen.insert(key) {
            continue;
        }
        let target = graph.object()?;
        if client_id.is_truthy() {
            target.set("clientOrderId", client_id)?;
        }
        if order_id.is_truthy() {
            target.set("orderId", order_id)?;
        }
        result.orders.push(ManagedIntent::from_handle(target)?);
    }
    Ok(result)
}
