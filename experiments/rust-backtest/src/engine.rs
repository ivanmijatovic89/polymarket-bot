//! Deterministic local order manager and execution adapter.
use crate::{
    portfolio::{buy_cost, copy, n, r, s, Ledger},
    types::{Book, Random},
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct Action {
    at: i64,
    seq: u64,
    intent: Value,
    market: String,
}
#[derive(Clone)]
struct Resting {
    intent: Value,
    oid: String,
    market: String,
    remaining: f64,
    fills: u64,
}
pub struct LocalEngine {
    pub ledger: Ledger,
    pub market: String,
    pub assets: [String; 2],
    pub latency: i64,
    pub jitter: i64,
    pub cancel_latency: bool,
    pub touch: bool,
    random: Random,
    active: HashSet<String>,
    submissions: Vec<Value>,
    splits: Vec<Value>,
    merges: Vec<Value>,
    pending: Vec<Action>,
    resting: Vec<Resting>,
    queued: Vec<Value>,
    seq: u64,
    order_seq: u64,
    op_seq: u64,
}
fn rejected(cid: &str, now: i64, reason: &str) -> Value {
    json!({"kind":"order_rejected","tsMs":now,"clientOrderId":cid,"reason":reason})
}
fn canceled(o: &Resting, now: i64, reason: &str, quantity: bool) -> Value {
    let mut e = json!({"kind":"order_done","tsMs":now,"clientOrderId":o.intent["clientOrderId"],"orderId":o.oid,"reason":reason});
    if quantity {
        e["filledSize"] = json!(n(&o.intent, "size") - o.remaining);
    }
    e
}
fn cancel_failed(op: &str, now: i64, reason: &str, target: &Value) -> Value {
    let mut out = json!({"kind":"cancel_failed","operation":op,"tsMs":now,"reason":reason});
    copy(
        &mut out,
        target,
        &["clientOrderId", "orderId", "market", "assetId"],
    );
    out
}
fn scope_error(i: &Value) -> Option<&'static str> {
    if i.get("market").is_none() && i.get("assetId").is_none() {
        return Some("missing_cancel_scope");
    }
    if let Some(v) = i.get("market") {
        let v = v.as_str().unwrap_or("");
        if v.len() != 66 || !v.starts_with("0x") || !v[2..].chars().all(|c| c.is_ascii_hexdigit()) {
            return Some("invalid_cancel_market");
        }
    }
    if let Some(v) = i.get("assetId") {
        let v = v.as_str().unwrap_or("");
        if v.is_empty() || !v.chars().all(|c| c.is_ascii_digit()) {
            return Some("invalid_cancel_assetId");
        }
    }
    None
}
fn in_scope(market: &str, asset: &str, i: &Value) -> bool {
    (i.get("market").is_none() || market.eq_ignore_ascii_case(s(i, "market")))
        && (i.get("assetId").is_none() || asset == s(i, "assetId"))
}
impl LocalEngine {
    pub fn new(
        starting: f64,
        market: String,
        assets: [String; 2],
        latency: i64,
        jitter: i64,
        seed: u32,
    ) -> Self {
        Self {
            ledger: Ledger::new(starting),
            market,
            assets,
            latency,
            jitter,
            cancel_latency: true,
            touch: false,
            random: Random::new(seed),
            active: HashSet::new(),
            submissions: Vec::new(),
            splits: Vec::new(),
            merges: Vec::new(),
            pending: Vec::new(),
            resting: Vec::new(),
            queued: Vec::new(),
            seq: 0,
            order_seq: 0,
            op_seq: 0,
        }
    }
    pub fn pending_capital(&self) -> f64 {
        self.submissions
            .iter()
            .filter(|o| s(o, "side") == "BUY")
            .map(|o| buy_cost(n(o, "price"), n(o, "remaining"), o["postOnly"] == true))
            .sum::<f64>()
            + self
                .splits
                .iter()
                .map(|e| n(&e["split"], "splitCost"))
                .sum::<f64>()
    }
    pub fn decision_snapshot(&mut self) -> Value {
        let mut p = self.ledger.snapshot().clone();
        let pending = self.pending_capital();
        if pending != 0.0 {
            let reserved = r(n(&p["capital"], "reservedCash") + pending);
            p["capital"]["reservedCash"] = json!(reserved);
            p["capital"]["availableCash"] = json!(r(n(&p["capital"], "cash") - reserved));
        }
        p
    }
    pub fn reconcile(&mut self, event: &Value) {
        let detail = &event["order"];
        if s(event, "kind") == "order_submitted" {
            if let Some(i) = self.submissions.iter().position(|o| o == detail) {
                self.submissions.remove(i);
            }
        }
        for pending in [&mut self.splits, &mut self.merges] {
            if let Some(i) = pending.iter().position(|p| p == event) {
                pending.remove(i);
            }
        }
        self.active.retain(|cid| {
            self.submissions
                .iter()
                .any(|o| s(o, "clientOrderId") == cid)
                || !self.ledger.history.contains_key(cid)
                || self.ledger.open.contains_key(cid)
        });
    }
    fn funding(&self, cost: f64, p: &Value) -> Option<String> {
        let cap = &p["capital"];
        let pending = self.pending_capital();
        let available = if pending == 0.0 {
            n(cap, "availableCash")
        } else {
            r(n(cap, "cash") - r(n(cap, "reservedCash") + pending))
        };
        if cap.is_object() && cost > available + 1e-8 {
            Some(format!(
                "insufficient_capital(required={cost},available={available})"
            ))
        } else {
            None
        }
    }
    fn risk(&self, intents: &[Value], p: &Value, now: i64) -> (Vec<Value>, Vec<Value>) {
        let mut allowed = Vec::new();
        let mut rejected_events = Vec::new();
        let open = p["openOrdersByClientId"].as_object().unwrap();
        let mut count = open.len();
        let mut buys: HashMap<String, f64> = HashMap::new();
        let mut sells: HashMap<String, f64> = HashMap::new();
        for o in open.values() {
            let map = if s(o, "side") == "BUY" {
                &mut buys
            } else {
                &mut sells
            };
            *map.entry(s(o, "assetId").to_owned()).or_default() += n(o, "remaining").max(0.0);
        }
        for i in intents {
            let kind = s(i, "kind");
            if kind != "place_limit" && kind != "place_batch" {
                allowed.push(i.clone());
                continue;
            }
            let orders = if kind == "place_batch" {
                i["orders"].as_array().cloned().unwrap_or_default()
            } else {
                vec![i.clone()]
            };
            let mut valid = Vec::new();
            for o in orders {
                let size = n(&o, "size");
                let asset = s(&o, "assetId");
                let qty = n(&p["positionsByAssetId"][asset], "qty");
                let buy = buys.get(asset).copied().unwrap_or(0.0);
                let sell = sells.get(asset).copied().unwrap_or(0.0);
                let projected = if s(&o, "side") == "BUY" {
                    qty + buy + size
                } else {
                    qty - (sell + size)
                };
                let reason = if n(p, "realizedPnlTotal") <= -500.0 {
                    Some(format!(
                        "risk_loss_stop(realized={})",
                        n(p, "realizedPnlTotal")
                    ))
                } else if size <= 0.0 {
                    None
                } else if size > 2000.0 {
                    Some("risk_max_order_size(max=2000)".to_owned())
                } else if count + 1 > 100 {
                    Some("risk_max_open_orders(max=100)".to_owned())
                } else if projected.abs() > 2000.0 {
                    Some("risk_max_abs_position(max=2000)".to_owned())
                } else {
                    None
                };
                if let Some(reason) = reason {
                    if !self.active.contains(s(&o, "clientOrderId")) {
                        rejected_events.push(rejected(s(&o, "clientOrderId"), now, &reason));
                    }
                } else {
                    if size > 0.0 {
                        count += 1;
                        let map = if s(&o, "side") == "BUY" {
                            &mut buys
                        } else {
                            &mut sells
                        };
                        *map.entry(asset.to_owned()).or_default() += size;
                    }
                    valid.push(o);
                }
            }
            if kind == "place_batch" {
                if !valid.is_empty() {
                    let mut batch = i.clone();
                    batch["orders"] = json!(valid);
                    allowed.push(batch);
                }
            } else {
                allowed.extend(valid);
            }
        }
        (allowed, rejected_events)
    }
    fn validation(o: &Value, now: i64) -> Option<&'static str> {
        if o["price"].as_f64().is_none() || n(o, "price") <= 0.0 {
            Some("invalid_price")
        } else if o["size"].as_f64().is_none() || n(o, "size") <= 0.0 {
            Some("invalid_size")
        } else if s(o, "assetId").is_empty() {
            Some("missing_assetId")
        } else if o["postOnly"] == true && !["GTC", "GTD"].contains(&s(o, "orderType")) {
            Some("post_only_requires_gtc_or_gtd")
        } else if s(o, "orderType") == "GTD" {
            if o.get("expireAtMs").is_none() {
                Some("gtd_requires_expireAtMs")
            } else if o["expireAtMs"].as_f64().is_none() {
                Some("invalid_expireAtMs")
            } else if n(o, "expireAtMs") < (now + 60000) as f64 {
                Some("gtd_expireAtMs_too_soon(min_offset_ms=60000)")
            } else {
                None
            }
        } else {
            None
        }
    }
    fn submitted(&self, o: &Value, now: i64) -> Value {
        let mut v = json!({"clientOrderId":o["clientOrderId"],"market":self.market,"assetId":o["assetId"],"side":o["side"],"price":o["price"],"size":o["size"],"remaining":o["size"],"filled":0,"orderType":o["orderType"],"state":"requested","createdAtMs":now,"updatedAtMs":now});
        copy(&mut v, o, &["postOnly", "meta"]);
        if s(o, "orderType") == "GTD" {
            copy(&mut v, o, &["expireAtMs"]);
        }
        v
    }
    fn when(&mut self, now: i64) -> i64 {
        let jitter = if self.jitter > 0 {
            ((self.random.next() * 2.0 - 1.0) * self.jitter as f64).trunc() as i64
        } else {
            0
        };
        now.max(now + self.latency + jitter)
    }
    fn send(&mut self, i: Value, now: i64, books: &[Book; 2], p: &Value) -> Vec<Value> {
        let cancel = s(&i, "kind").starts_with("cancel_");
        let at = if cancel && !self.cancel_latency {
            now
        } else {
            self.when(now)
        };
        if at <= now {
            self.execute(&i, now, books, p, &self.market.clone())
        } else {
            let action = Action {
                at,
                seq: self.seq,
                intent: i,
                market: self.market.clone(),
            };
            self.seq += 1;
            self.pending.push(action);
            Vec::new()
        }
    }
    fn resolve_batch(i: &Value, p: &Value, now: i64) -> (Vec<Value>, Vec<Value>) {
        let mut orders = Vec::new();
        let mut events = Vec::new();
        let Some(refs) = i["orders"].as_array().filter(|v| v.len() <= 3000) else {
            return (
                orders,
                vec![cancel_failed(
                    "cancel_batch",
                    now,
                    "invalid_cancel_batch_size",
                    &json!({}),
                )],
            );
        };
        let mut seen = HashSet::new();
        for reference in refs {
            let cid = s(reference, "clientOrderId");
            let oid = s(reference, "orderId");
            let valid = |key: &str| {
                reference.get(key).is_none()
                    || (!s(reference, key).is_empty()
                        && s(reference, key).trim() == s(reference, key))
            };
            if !reference.is_object()
                || (cid.is_empty() && oid.is_empty())
                || !valid("clientOrderId")
                || !valid("orderId")
            {
                events.push(cancel_failed(
                    "cancel_batch",
                    now,
                    "invalid_order_reference",
                    &json!({}),
                ));
                continue;
            }
            let by_client = p["openOrdersByClientId"].get(cid);
            let by_exchange = p["openOrdersByClientId"]
                .as_object()
                .unwrap()
                .values()
                .find(|o| !oid.is_empty() && s(o, "orderId") == oid);
            if !cid.is_empty() && by_exchange.is_some_and(|o| s(o, "clientOrderId") != cid) {
                events.push(cancel_failed(
                    "cancel_batch",
                    now,
                    "conflicting_order_reference",
                    reference,
                ));
                continue;
            }
            let bot = by_client.or(by_exchange);
            let previous = if !cid.is_empty() {
                p["ordersByClientId"].get(cid)
            } else {
                p["ordersByClientId"]
                    .as_object()
                    .unwrap()
                    .values()
                    .find(|o| s(o, "orderId") == oid)
            };
            let known = bot
                .and_then(|o| o.get("orderId"))
                .or_else(|| previous.and_then(|o| o.get("orderId")))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !oid.is_empty() && !known.is_empty() && oid != known {
                events.push(cancel_failed(
                    "cancel_batch",
                    now,
                    "conflicting_order_reference",
                    reference,
                ));
                continue;
            }
            if bot.is_none()
                && previous.is_some_and(|o| {
                    ["filled", "canceled", "expired", "killed", "rejected"]
                        .contains(&s(o, "lifecycleState"))
                })
            {
                continue;
            }
            if !cid.is_empty() && bot.is_none() && oid.is_empty() {
                events.push(cancel_failed(
                    "cancel_batch",
                    now,
                    "unknown_client_order",
                    reference,
                ));
                continue;
            }
            if bot.is_some_and(|o| s(o, "orderId").is_empty()) {
                events.push(cancel_failed(
                    "cancel_batch",
                    now,
                    "missing_exchange_order_id",
                    reference,
                ));
                continue;
            }
            let actual_oid = bot.map(|o| s(o, "orderId")).unwrap_or(oid);
            let actual_cid = bot.map(|o| s(o, "clientOrderId")).unwrap_or(cid);
            let key = if !actual_oid.is_empty() {
                format!("exchange:{actual_oid}")
            } else {
                format!("client:{actual_cid}")
            };
            if seen.insert(key) {
                let mut target = json!({});
                if !actual_cid.is_empty() {
                    target["clientOrderId"] = json!(actual_cid);
                }
                if !actual_oid.is_empty() {
                    target["orderId"] = json!(actual_oid);
                }
                orders.push(target);
            }
        }
        (orders, events)
    }
    pub fn handle(
        &mut self,
        intents: Vec<Value>,
        now: i64,
        books: &[Book; 2],
        queued: bool,
    ) -> Vec<Value> {
        if queued {
            self.queued.extend(intents);
            return Vec::new();
        }
        let p = self.ledger.snapshot().clone();
        let (allowed, mut out) = self.risk(&intents, &p, now);
        let track = allowed.iter().any(|i| s(i, "kind").starts_with("cancel_"));
        let mut refs = p.clone();
        for i in allowed {
            let start = out.len();
            match s(&i, "kind") {
                "place_limit" | "place_batch" => {
                    let batch = s(&i, "kind") == "place_batch";
                    let orders = if batch {
                        i["orders"].as_array().cloned().unwrap_or_default()
                    } else {
                        vec![i.clone()]
                    };
                    let mut valid = Vec::new();
                    for o in orders {
                        let cid = s(&o, "clientOrderId");
                        if self.active.contains(cid) {
                            continue;
                        }
                        if !batch {
                            self.active.insert(cid.to_owned());
                        }
                        let err = Self::validation(&o, now).map(str::to_owned).or_else(|| {
                            if s(&o, "side") == "BUY" {
                                self.funding(
                                    buy_cost(n(&o, "price"), n(&o, "size"), o["postOnly"] == true),
                                    &p,
                                )
                            } else {
                                None
                            }
                        });
                        if let Some(err) = err {
                            if !batch {
                                self.active.remove(cid);
                            }
                            out.push(rejected(cid, now, &err));
                            continue;
                        }
                        self.active.insert(cid.to_owned());
                        let submitted = self.submitted(&o, now);
                        self.submissions.push(submitted.clone());
                        out.push(json!({"kind":"order_submitted","tsMs":now,"order":submitted}));
                        valid.push(o);
                    }
                    if !valid.is_empty() {
                        let execution_intent = if batch {
                            json!({"kind":"place_batch","orders":valid})
                        } else {
                            valid.remove(0)
                        };
                        let events = self.send(execution_intent, now, books, &p);
                        for e in &events {
                            if ["order_done", "order_rejected"].contains(&s(e, "kind")) {
                                self.active.remove(s(e, "clientOrderId"));
                            }
                        }
                        out.extend(events);
                    }
                }
                "split_positions" | "merge_positions" => {
                    let split = s(&i, "kind") == "split_positions";
                    let a = s(&i, "assetIdA");
                    let b = s(&i, "assetIdB");
                    let size = n(&i, "size");
                    let mut error = if a.is_empty() || b.is_empty() || a == b {
                        Some("invalid asset ids".to_owned())
                    } else if split && size <= 0.0 {
                        Some("invalid size".to_owned())
                    } else {
                        None
                    };
                    let mut actual = size;
                    if error.is_none() && split {
                        error = self.funding(size, &p);
                    }
                    if error.is_none() && !split && size > 0.0 {
                        let available = |asset: &str| {
                            let qty = n(&p["positionsByAssetId"][asset], "qty")
                                - self
                                    .merges
                                    .iter()
                                    .filter(|e| {
                                        s(e, "assetIdA") == asset || s(e, "assetIdB") == asset
                                    })
                                    .map(|e| n(e, "size"))
                                    .sum::<f64>();
                            qty.max(0.0)
                        };
                        actual = size.min(available(a)).min(available(b));
                        if actual <= 0.0 {
                            error = Some("insufficient_uncommitted_positions".to_owned());
                        }
                    }
                    if let Some(err) = error {
                        out.push(json!({"kind":if split{"split_failed"}else{"merge_failed"},"tsMs":now,"assetIdA":a,"assetIdB":b,"requestedSize":size,"reason":err}));
                    } else if actual > 0.0 {
                        self.op_seq += 1;
                        let mut detail = json!({"id":if split{format!("bt-split:{}:{now}:{a}:{b}",self.op_seq)}else{format!("bt-merge:{}:{now}",self.op_seq)},"market":self.market,"tsMs":now,"assetIdA":a,"assetIdB":b,"size":actual});
                        copy(&mut detail, &i, &["reason"]);
                        let event = if split {
                            detail["splitCost"] = json!(actual);
                            json!({"kind":"positions_split","split":detail})
                        } else {
                            detail["kind"] = json!("positions_merged");
                            detail
                        };
                        if split {
                            self.splits.push(event.clone());
                        } else {
                            self.merges.push(event.clone());
                        }
                        out.push(event);
                    }
                }
                "cancel_order" => {
                    let mut i = i.clone();
                    if s(&i, "orderId").is_empty() {
                        if let Some(o) = self
                            .resting
                            .iter()
                            .find(|o| s(&o.intent, "clientOrderId") == s(&i, "clientOrderId"))
                        {
                            i["orderId"] = json!(o.oid);
                        }
                    }
                    out.extend(self.send(i, now, books, &p));
                }
                "cancel_batch" => {
                    let (orders, events) = Self::resolve_batch(&i, &refs, now);
                    out.extend(events);
                    if !orders.is_empty() {
                        out.extend(self.send(
                            json!({"kind":"cancel_batch","orders":orders}),
                            now,
                            books,
                            &p,
                        ));
                    }
                }
                "cancel_market" => {
                    if let Some(err) = scope_error(&i) {
                        out.push(cancel_failed("cancel_market", now, err, &json!({})));
                    } else {
                        out.extend(self.send(i, now, books, &p));
                    }
                }
                "cancel_all" => out.extend(self.send(i, now, books, &p)),
                _ => panic!("Unsupported intent: {i}"),
            }
            if track {
                for e in &out[start..] {
                    let cid = s(e, "clientOrderId");
                    match s(e, "kind") {
                        "order_submitted" => {
                            refs["openOrdersByClientId"][s(&e["order"], "clientOrderId")] =
                                e["order"].clone();
                        }
                        "order_accepted" => {
                            if refs["openOrdersByClientId"].get(cid).is_some() {
                                copy(&mut refs["openOrdersByClientId"][cid], e, &["orderId"]);
                            }
                        }
                        "order_done" | "order_rejected" => {
                            if s(e, "reason") == "duplicate_clientOrderId" {
                                continue;
                            }
                            let oid = s(e, "orderId");
                            let target = if !cid.is_empty() {
                                cid.to_owned()
                            } else {
                                refs["openOrdersByClientId"]
                                    .as_object()
                                    .unwrap()
                                    .values()
                                    .find(|o| !oid.is_empty() && s(o, "orderId") == oid)
                                    .map(|o| s(o, "clientOrderId").to_owned())
                                    .unwrap_or_default()
                            };
                            if let Some(o) = refs["openOrdersByClientId"]
                                .as_object_mut()
                                .unwrap()
                                .shift_remove(&target)
                            {
                                let mut h = json!({"clientOrderId":target,"assetId":o["assetId"],"side":o["side"],"lifecycleState":if s(e,"kind")=="order_done"{s(e,"reason")}else{"rejected"},"tradeStatusRank":0,"updatedAtMs":e["tsMs"]});
                                copy(&mut h, &o, &["orderId"]);
                                refs["ordersByClientId"][&target] = h;
                            }
                            refs["wsOpenOrdersByOrderId"]
                                .as_object_mut()
                                .unwrap()
                                .shift_remove(oid);
                            self.active.remove(&target);
                        }
                        _ => {}
                    }
                }
            }
        }
        out
    }
    fn book<'a>(&self, asset: &str, books: &'a [Book; 2]) -> Option<&'a Book> {
        self.assets
            .iter()
            .position(|a| a == asset)
            .and_then(|i| books[i].exists.then_some(&books[i]))
    }
    fn fill(&self, o: &mut Resting, now: i64, price: f64, size: f64, maker: bool) -> Value {
        o.fills += 1;
        o.remaining -= size;
        let mut f = json!({"id":format!("{}:{}",o.oid,o.fills),"tsMs":now,"market":o.market,"assetId":o.intent["assetId"],"side":o.intent["side"],"price":price,"size":size,"clientOrderId":o.intent["clientOrderId"],"orderId":o.oid,"liquidity":if maker{"MAKER"}else{"TAKER"}});
        if !maker {
            f["feeRateBps"] = json!(700);
        }
        json!({"kind":"fill","fill":f})
    }
    fn place(&mut self, i: &Value, now: i64, books: &[Book; 2], market: &str) -> Vec<Value> {
        let cid = s(i, "clientOrderId");
        let book = self.book(s(i, "assetId"), books);
        let buy = s(i, "side") == "BUY";
        let price = n(i, "price");
        let opposing = book
            .and_then(|b| if buy { b.asks.first() } else { b.bids.first() })
            .map(|l| l.price);
        if i["postOnly"] == true
            && opposing.is_some_and(|p| if buy { price >= p } else { price <= p })
        {
            let mut e = rejected(cid, now, "post_only_would_cross");
            e["market"] = json!(market);
            return vec![e];
        }
        let oid = format!("bt-{}-{cid}", self.order_seq);
        self.order_seq += 1;
        let mut o = Resting {
            intent: i.clone(),
            oid: oid.clone(),
            market: market.to_owned(),
            remaining: n(i, "size"),
            fills: 0,
        };
        let ws = |status: &str, matched: f64, event: &str| json!({"kind":"ws_order_update","tsMs":now,"order":{"orderId":oid,"assetId":i["assetId"],"side":i["side"],"price":price,"originalSize":i["size"],"sizeMatched":matched,"status":status,"orderType":i["orderType"],"event":event}});
        let mut out = vec![
            json!({"kind":"order_accepted","tsMs":now,"clientOrderId":cid,"orderId":oid,"market":market}),
            ws("MATCHED", 0.0, "UPDATE"),
        ];
        let levels = book.map(|b| if buy { &b.asks } else { &b.bids });
        let fillable: f64 = levels
            .map(|ls| {
                ls.iter()
                    .take_while(|l| {
                        if buy {
                            l.price <= price
                        } else {
                            l.price >= price
                        }
                    })
                    .map(|l| l.size)
                    .sum()
            })
            .unwrap_or(0.0);
        let fok = s(i, "orderType") == "FOK";
        if fok && fillable < n(i, "size") {
            out.push(ws("CANCELED", 0.0, "CANCELLATION"));
            out.push(canceled(&o, now, "killed", false));
            return out;
        }
        if let Some(levels) = levels {
            for l in levels {
                if if buy {
                    l.price > price
                } else {
                    l.price < price
                } {
                    break;
                }
                let take = o.remaining.min(l.size);
                if take > 0.0 {
                    out.push(self.fill(&mut o, now, l.price, take, false));
                }
                if o.remaining <= 0.0 {
                    break;
                }
            }
        }
        if o.remaining <= 0.0 {
            out.push(canceled(&o, now, "filled", false));
            if fok {
                out.push(ws("CONFIRMED", n(i, "size"), "UPDATE"));
            }
        } else {
            out.push(json!({"kind":"order_open","tsMs":now,"clientOrderId":cid,"orderId":oid}));
            if let Some(j) = self
                .resting
                .iter()
                .position(|r| s(&r.intent, "clientOrderId") == cid)
            {
                self.resting[j] = o;
            } else {
                self.resting.push(o);
            }
        }
        out
    }
    fn execute(
        &mut self,
        i: &Value,
        now: i64,
        books: &[Book; 2],
        _p: &Value,
        market: &str,
    ) -> Vec<Value> {
        match s(i, "kind") {
            "place_limit" => self.place(i, now, books, market),
            "place_batch" => {
                let mut out = Vec::new();
                for o in i["orders"].as_array().unwrap() {
                    out.extend(self.place(o, now, books, market));
                }
                out
            }
            "cancel_order" => {
                let cid = s(i, "clientOrderId");
                let oid = s(i, "orderId");
                let j = self.resting.iter().position(|o| {
                    if !cid.is_empty() {
                        s(&o.intent, "clientOrderId") == cid
                    } else {
                        o.oid == oid
                    }
                });
                if let Some(j) = j {
                    if !oid.is_empty() && self.resting[j].oid != oid {
                        return Vec::new();
                    }
                    vec![canceled(&self.resting.remove(j), now, "canceled", true)]
                } else {
                    Vec::new()
                }
            }
            "cancel_batch" => {
                let mut out = Vec::new();
                for target in i["orders"].as_array().unwrap() {
                    let mut cancel = target.clone();
                    cancel["kind"] = json!("cancel_order");
                    out.extend(self.execute(&cancel, now, books, _p, market));
                }
                out
            }
            "cancel_market" | "cancel_all" => {
                let mut out = Vec::new();
                let mut j = 0;
                while j < self.resting.len() {
                    let o = &self.resting[j];
                    if s(i, "kind") == "cancel_all"
                        || in_scope(&o.market, s(&o.intent, "assetId"), i)
                    {
                        out.push(canceled(&self.resting.remove(j), now, "canceled", true));
                    } else {
                        j += 1;
                    }
                }
                out
            }
            _ => panic!("Unsupported execution: {i}"),
        }
    }
    pub fn tick(&mut self, now: i64, books: &[Book; 2]) -> Vec<Value> {
        let mut out = Vec::new();
        if !self.queued.is_empty() {
            let q = std::mem::take(&mut self.queued);
            out.extend(self.handle(q, now, books, false));
        }
        if !self.pending.is_empty() {
            let mut due = Vec::new();
            self.pending.retain(|a| {
                if a.at <= now {
                    due.push(a.clone());
                    false
                } else {
                    true
                }
            });
            due.sort_by_key(|a| (a.at, a.seq));
            let p = self.ledger.snapshot().clone();
            for a in due {
                out.extend(self.execute(&a.intent, now, books, &p, &a.market));
            }
        }
        let mut j = 0;
        while j < self.resting.len() {
            let mut o = self.resting[j].clone();
            if s(&o.intent, "orderType") == "GTD" && now as f64 >= n(&o.intent, "expireAtMs") {
                out.push(canceled(&self.resting.remove(j), now, "expired", true));
                continue;
            }
            let buy = s(&o.intent, "side") == "BUY";
            let price = n(&o.intent, "price");
            let opposing = self
                .book(s(&o.intent, "assetId"), books)
                .and_then(|b| if buy { b.asks.first() } else { b.bids.first() })
                .map(|l| l.price);
            let fillable = opposing.is_some_and(|p| {
                if buy {
                    if self.touch {
                        p <= price
                    } else {
                        p < price
                    }
                } else if self.touch {
                    p >= price
                } else {
                    p > price
                }
            });
            if fillable && o.remaining > 0.0 {
                let size = o.remaining;
                out.push(self.fill(&mut o, now, price, size, true));
                out.push(canceled(&o, now, "filled", false));
                self.resting.remove(j);
            } else {
                j += 1;
            }
        }
        out
    }
}
