//! Local account ledger. Event shapes and reconciliation follow trading/Portfolio.ts.
use crate::types::round;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};

pub fn n(v: &Value, k: &str) -> f64 {
    v[k].as_f64().filter(|v| v.is_finite()).unwrap_or(0.0)
}
pub fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
pub fn copy(dst: &mut Value, src: &Value, keys: &[&str]) {
    for k in keys {
        if let Some(v) = src.get(*k) {
            dst[*k] = v.clone();
        }
    }
}
pub fn r(v: f64) -> f64 {
    round(v, 8)
}
pub fn taker_fee(price: f64, size: f64, bps: f64) -> f64 {
    if !price.is_finite()
        || price <= 0.0
        || price >= 1.0
        || !size.is_finite()
        || size <= 0.0
        || !bps.is_finite()
        || bps <= 0.0
    {
        0.0
    } else {
        round((bps / 10000.0) * price * (1.0 - price) * size, 4).max(0.0)
    }
}
pub fn buy_cost(price: f64, size: f64, post_only: bool) -> f64 {
    if size <= 0.0 {
        0.0
    } else {
        r(price * size
            + if post_only {
                0.0
            } else {
                taker_fee(price, size, 700.0)
            })
    }
}
fn rank(raw: &str) -> u8 {
    match raw {
        "MATCHED" => 1,
        "MINED" => 2,
        "CONFIRMED" => 3,
        _ => 0,
    }
}
#[derive(Clone)]
struct CashOrder {
    order_id: String,
    side: String,
    price: f64,
    size: f64,
    post: bool,
    filled: f64,
    matched: f64,
    final_filled: Option<f64>,
}
pub struct Ledger {
    pub now: Option<i64>,
    pub starting: f64,
    pub cash: f64,
    pub realized: f64,
    pub positions: Map<String, Value>,
    pub open: Map<String, Value>,
    pub history: Map<String, Value>,
    pub ws: Map<String, Value>,
    pub fills: VecDeque<Value>,
    pub splits: VecDeque<Value>,
    pub markets: Map<String, Value>,
    index: HashMap<String, String>,
    persistent: Map<String, Value>,
    terminal: HashSet<String>,
    terminal_order: VecDeque<String>,
    pending_fills: HashMap<String, f64>,
    pending_status: Map<String, Value>,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
    cash_orders: Vec<CashOrder>,
    cash_client: HashMap<String, usize>,
    cash_exchange: HashMap<String, usize>,
    unlinked: HashMap<String, f64>,
    cached: Option<Value>,
    max_fills: usize,
}
impl Ledger {
    pub fn new(starting: f64) -> Self {
        Self {
            now: None,
            starting,
            cash: starting,
            realized: 0.0,
            positions: Map::new(),
            open: Map::new(),
            history: Map::new(),
            ws: Map::new(),
            fills: VecDeque::new(),
            splits: VecDeque::new(),
            markets: Map::new(),
            index: HashMap::new(),
            persistent: Map::new(),
            terminal: HashSet::new(),
            terminal_order: VecDeque::new(),
            pending_fills: HashMap::new(),
            pending_status: Map::new(),
            seen: HashSet::new(),
            seen_order: VecDeque::new(),
            cash_orders: Vec::new(),
            cash_client: HashMap::new(),
            cash_exchange: HashMap::new(),
            unlinked: HashMap::new(),
            cached: None,
            max_fills: 500,
        }
    }
    pub fn initialize(&mut self, now: i64) {
        if self.now.is_none() {
            self.now = Some(now);
            self.cached = None;
        }
    }
    pub fn reserved(&self) -> f64 {
        r(self
            .cash_orders
            .iter()
            .filter(|o| o.side == "BUY")
            .map(|o| {
                buy_cost(
                    o.price,
                    (o.final_filled.unwrap_or(o.size) - o.filled).max(0.0),
                    o.post,
                )
            })
            .sum())
    }
    pub fn available(&self) -> f64 {
        self.cached
            .as_ref()
            .map(|p| n(&p["capital"], "availableCash"))
            .unwrap_or_else(|| r(self.cash - self.reserved()))
    }
    pub fn snapshot(&mut self) -> &Value {
        if self.cached.is_none() {
            let reserved = self.reserved();
            let mut snap = json!({"capital":{"startingCapital":self.starting,"cash":self.cash,"reservedCash":reserved,"availableCash":r(self.cash-reserved)},"nowMs":self.now,"realizedPnlTotal":self.realized,"positionsByAssetId":self.positions,"openOrdersByClientId":self.open,"wsOpenOrdersByOrderId":self.ws,"ordersByClientId":self.history,"recentFills":self.fills,"marketByAssetId":self.markets});
            if !self.splits.is_empty() {
                snap["recentSplits"] = json!(self.splits);
            }
            self.cached = Some(snap);
        }
        self.cached.as_ref().unwrap()
    }
    fn terminal(&mut self, oid: &str) {
        if self.terminal.insert(oid.to_owned()) {
            self.terminal_order.push_back(oid.to_owned());
        }
        self.ws.shift_remove(oid);
        if self.terminal_order.len() > 50000 {
            let old = self.terminal_order.pop_front().unwrap();
            self.terminal.remove(&old);
        }
    }
    fn once(&mut self, id: String) -> bool {
        if !self.seen.insert(id.clone()) {
            return false;
        }
        self.seen_order.push_back(id);
        if self.seen_order.len() > 50000 {
            for _ in 0..5000 {
                self.seen.remove(&self.seen_order.pop_front().unwrap());
            }
        }
        true
    }
    fn earlier(&self, o: &Value, oid: &str) -> bool {
        !oid.is_empty()
            && s(o, "orderId") != oid
            && (!s(o, "orderId").is_empty() || self.persistent.contains_key(oid))
    }
    fn upsert(&mut self, cid: &str, next: Value) {
        let oid = s(&next, "orderId");
        if !oid.is_empty() {
            self.persistent.shift_remove(oid);
            self.persistent.insert(oid.to_owned(), json!(cid));
            if self.persistent.len() > 50000 {
                for _ in 0..5000 {
                    let key = self.persistent.keys().next().unwrap().clone();
                    self.persistent.shift_remove(&key);
                }
            }
        }
        self.history.shift_remove(cid);
        self.history.insert(cid.to_owned(), next);
        if self.history.len() > 10000 {
            for _ in 0..1000 {
                let key = self.history.keys().next().unwrap().clone();
                self.history.shift_remove(&key);
            }
        }
    }
    fn merge_status(&mut self, cid: &str, oid: &str) {
        if let (Some(p), Some(prev)) = (self.pending_status.get(oid), self.history.get(cid)) {
            let mut next = prev.clone();
            copy(&mut next, p, &["tradeStatusRaw"]);
            next["tradeStatusRank"] =
                json!(n(prev, "tradeStatusRank").max(n(p, "tradeStatusRank")));
            next["updatedAtMs"] = json!(n(prev, "updatedAtMs").max(n(p, "updatedAtMs")));
            self.upsert(cid, next);
        }
    }
    fn order_snapshot(&self, o: &Value, state: &str, remaining: f64, matched: f64) -> Value {
        let cid = s(o, "clientOrderId");
        let mut out = json!({"clientOrderId":cid,"assetId":o["assetId"],"side":o["side"],"price":o["price"],"originalSize":o["size"],"sizeMatched":matched,"remaining":remaining,"lifecycleState":state,"tradeStatusRank":self.history.get(cid).map(|v|n(v,"tradeStatusRank")).unwrap_or(0.0),"updatedAtMs":self.now});
        copy(&mut out, o, &["orderId", "postOnly", "meta"]);
        if let Some(prev) = self.history.get(cid) {
            copy(&mut out, prev, &["tradeStatusRaw"]);
        }
        out
    }
    fn link_cash(&mut self, cid: &str, oid: &str) {
        if self.open.get(cid).is_some_and(|o| self.earlier(o, oid)) {
            return;
        }
        let Some(&i) = self.cash_client.get(cid) else {
            return;
        };
        if !self.cash_orders[i].order_id.is_empty() && self.cash_orders[i].order_id != oid {
            return;
        }
        self.cash_orders[i].order_id = oid.to_owned();
        if let Some(&j) = self.cash_exchange.get(oid) {
            if i != j {
                let other = self.cash_orders[j].clone();
                let o = &mut self.cash_orders[i];
                o.filled = o.filled.max(other.filled);
                o.matched = o.matched.max(other.matched);
                if other.final_filled.is_some() {
                    o.final_filled = other.final_filled;
                }
                self.cash_orders[j].side = "REMOVED".to_owned();
            }
        }
        self.cash_orders[i].filled =
            r(self.cash_orders[i].filled + self.unlinked.remove(oid).unwrap_or(0.0));
        self.cash_exchange.insert(oid.to_owned(), i);
    }
    fn cash_event(&mut self, ev: &Value) {
        match s(ev, "kind") {
            "order_submitted" => {
                let o = &ev["order"];
                let i = self.cash_orders.len();
                self.cash_orders.push(CashOrder {
                    order_id: String::new(),
                    side: s(o, "side").to_owned(),
                    price: n(o, "price"),
                    size: n(o, "size"),
                    post: o["postOnly"] == true,
                    filled: n(o, "filled"),
                    matched: n(o, "filled"),
                    final_filled: None,
                });
                self.cash_client.insert(s(o, "clientOrderId").to_owned(), i);
                if !s(o, "orderId").is_empty() {
                    self.link_cash(s(o, "clientOrderId"), s(o, "orderId"));
                }
            }
            "order_accepted" | "order_open" => {
                if !s(ev, "clientOrderId").is_empty() && !s(ev, "orderId").is_empty() {
                    self.link_cash(s(ev, "clientOrderId"), s(ev, "orderId"));
                }
            }
            "ws_order_update" => {
                let o = &ev["order"];
                if ["MATCHED", "MINED", "CONFIRMED", "RETRYING", "FAILED"].contains(&s(o, "status"))
                {
                    return;
                }
                let oid = s(o, "orderId");
                let i = if let Some(&i) = self.cash_exchange.get(oid) {
                    i
                } else {
                    if s(o, "side").is_empty()
                        || o["price"].as_f64().is_none()
                        || o["originalSize"].as_f64().is_none()
                    {
                        return;
                    }
                    let i = self.cash_orders.len();
                    self.cash_orders.push(CashOrder {
                        order_id: oid.to_owned(),
                        side: s(o, "side").to_owned(),
                        price: n(o, "price"),
                        size: n(o, "originalSize"),
                        post: false,
                        filled: self.unlinked.remove(oid).unwrap_or(0.0),
                        matched: 0.0,
                        final_filled: None,
                    });
                    self.cash_exchange.insert(oid.to_owned(), i);
                    i
                };
                let c = &mut self.cash_orders[i];
                if o["sizeMatched"].as_f64().is_some() {
                    c.matched = c.matched.max(n(o, "sizeMatched"));
                }
                if (s(o, "event") == "CANCELLATION"
                    || ["CANCELED", "CANCELLED", "EXPIRED"].contains(&s(o, "status"))
                    || c.matched >= c.size)
                    && o["sizeMatched"].as_f64().is_some()
                {
                    c.final_filled =
                        Some(c.final_filled.unwrap_or(0.0).max(c.matched).max(c.filled));
                }
            }
            "order_done" | "order_rejected" => {
                let rejected = s(ev, "kind") == "order_rejected";
                if rejected && !self.open.contains_key(s(ev, "clientOrderId")) {
                    return;
                }
                let i = if s(ev, "kind") == "order_done" && !s(ev, "orderId").is_empty() {
                    self.cash_exchange.get(s(ev, "orderId"))
                } else {
                    self.cash_client.get(s(ev, "clientOrderId"))
                };
                if let Some(&i) = i {
                    let c = &mut self.cash_orders[i];
                    let filled = if rejected || s(ev, "reason") == "killed" {
                        Some(0.0)
                    } else if s(ev, "reason") == "filled" {
                        Some(c.size)
                    } else {
                        ev["filledSize"].as_f64()
                    };
                    if let Some(f) = filled {
                        c.final_filled = Some(
                            f.max(c.matched)
                                .max(c.filled)
                                .max(c.final_filled.unwrap_or(0.0)),
                        );
                    }
                }
            }
            _ => {}
        }
    }
    fn fill_order(&mut self, f: &Value) {
        let oid = s(f, "orderId");
        let cid = if !s(f, "clientOrderId").is_empty() {
            s(f, "clientOrderId").to_owned()
        } else {
            self.index.get(oid).cloned().unwrap_or_default()
        };
        let existing = self.open.get(&cid).cloned();
        if existing.as_ref().is_some_and(|o| self.earlier(o, oid)) {
            return;
        }
        if cid.is_empty()
            || existing
                .as_ref()
                .is_some_and(|o| s(o, "orderId").is_empty() && !oid.is_empty())
        {
            if !oid.is_empty() {
                *self.pending_fills.entry(oid.to_owned()).or_default() =
                    r(self.pending_fills.get(oid).copied().unwrap_or(0.0) + n(f, "size"));
            }
            return;
        }
        if let Some(mut o) = existing {
            self.update_fill(&mut o, n(f, "size"));
        }
    }
    fn update_fill(&mut self, o: &mut Value, size: f64) {
        o["filled"] = json!(r(n(o, "filled") + size));
        o["remaining"] = json!(r((n(o, "size") - n(o, "filled")).max(0.0)));
        o["updatedAtMs"] = json!(self.now);
        o["state"] = json!(if n(o, "remaining") > 0.0 {
            "partially_filled"
        } else {
            "filled"
        });
        let cid = s(o, "clientOrderId");
        if s(o, "state") == "filled" {
            self.open.shift_remove(cid);
            self.index.remove(s(o, "orderId"));
        } else {
            self.open.insert(cid.to_owned(), o.clone());
        }
    }
    pub fn apply(&mut self, ev: &Value) {
        self.cached = None;
        let kind = s(ev, "kind");
        let detail = match kind {
            "fill" => &ev["fill"],
            "positions_split" => &ev["split"],
            _ => ev,
        };
        let ts = n(detail, "tsMs") as i64;
        self.initialize(ts);
        self.now = Some(self.now.unwrap_or(ts).max(ts));
        self.cash_event(ev);
        match kind {
            "order_submitted" => {
                let o = ev["order"].clone();
                let cid = s(&o, "clientOrderId");
                self.open.insert(cid.to_owned(), o.clone());
                if !s(&o, "orderId").is_empty() {
                    self.index
                        .insert(s(&o, "orderId").to_owned(), cid.to_owned());
                }
                if !s(&o, "market").is_empty() {
                    self.markets
                        .insert(s(&o, "assetId").to_owned(), o["market"].clone());
                }
                let mut snap =
                    self.order_snapshot(&o, s(&o, "state"), n(&o, "remaining"), n(&o, "filled"));
                snap["tradeStatusRank"] = json!(0);
                snap.as_object_mut().unwrap().shift_remove("tradeStatusRaw");
                self.upsert(cid, snap);
                self.merge_status(cid, s(&o, "orderId"));
            }
            "order_accepted" | "order_open" => {
                let oid = s(ev, "orderId");
                let cid = if !s(ev, "clientOrderId").is_empty() {
                    s(ev, "clientOrderId").to_owned()
                } else {
                    self.index.get(oid).cloned().unwrap_or_default()
                };
                if let Some(mut o) = self.open.get(&cid).cloned() {
                    if self.earlier(&o, oid) {
                        return;
                    }
                    copy(&mut o, ev, &["orderId"]);
                    if !s(&o, "orderId").is_empty() {
                        self.index.insert(s(&o, "orderId").to_owned(), cid.clone());
                    }
                    if kind == "order_open" || s(&o, "state") == "requested" {
                        o["state"] = json!("open");
                    }
                    o["updatedAtMs"] = json!(self.now);
                    self.open.insert(cid.clone(), o.clone());
                    self.upsert(
                        &cid,
                        self.order_snapshot(
                            &o,
                            s(&o, "state"),
                            n(&o, "remaining"),
                            n(&o, "filled"),
                        ),
                    );
                    self.merge_status(&cid, s(&o, "orderId"));
                    if kind == "order_accepted" {
                        if let Some(size) = self.pending_fills.remove(oid) {
                            self.update_fill(&mut o, size);
                        }
                    }
                }
            }
            "order_rejected" => {
                let cid = s(ev, "clientOrderId");
                if let Some(mut o) = self.open.get(cid).cloned() {
                    o["state"] = json!("rejected");
                    o["lastError"] = ev["reason"].clone();
                    o["remaining"] = json!(0);
                    o["updatedAtMs"] = json!(self.now);
                    self.open.shift_remove(cid);
                    self.index.remove(s(&o, "orderId"));
                    self.upsert(
                        cid,
                        self.order_snapshot(&o, "rejected", 0.0, n(&o, "filled")),
                    );
                    self.merge_status(cid, s(&o, "orderId"));
                }
            }
            "order_done" => {
                let oid = s(ev, "orderId");
                if !oid.is_empty() {
                    self.terminal(oid);
                }
                let cid = if !s(ev, "clientOrderId").is_empty() {
                    s(ev, "clientOrderId").to_owned()
                } else {
                    self.index
                        .get(oid)
                        .cloned()
                        .or_else(|| {
                            self.persistent
                                .get(oid)
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        })
                        .unwrap_or_default()
                };
                let previous = self.history.get(&cid).cloned();
                if let Some(o) = self.open.get(&cid).cloned() {
                    if self.earlier(&o, oid) {
                        return;
                    }
                    if !s(&o, "orderId").is_empty() {
                        self.terminal(s(&o, "orderId"));
                    }
                    self.open.shift_remove(&cid);
                    self.index.remove(s(&o, "orderId"));
                    let matched = n(&o, "filled").max(
                        previous
                            .as_ref()
                            .map(|p| n(p, "sizeMatched"))
                            .unwrap_or(0.0),
                    );
                    self.upsert(&cid, self.order_snapshot(&o, s(ev, "reason"), 0.0, matched));
                    self.merge_status(&cid, s(&o, "orderId"));
                } else if let Some(mut p) = previous {
                    if (oid.is_empty() || s(&p, "orderId") == oid)
                        && (s(&p, "lifecycleState").is_empty()
                            || ["requested", "open", "partially_filled"]
                                .contains(&s(&p, "lifecycleState")))
                    {
                        p["lifecycleState"] = ev["reason"].clone();
                        p["remaining"] = json!(0);
                        if s(ev, "reason") == "filled" && p.get("originalSize").is_some() {
                            p["sizeMatched"] = p["originalSize"].clone();
                        }
                        p["updatedAtMs"] = json!(self.now);
                        self.upsert(&cid, p);
                    }
                }
            }
            "ws_order_update" => {
                let o = &ev["order"];
                let oid = s(o, "orderId");
                let mut next = json!({"orderId":oid,"updatedAtMs":self.now});
                copy(
                    &mut next,
                    o,
                    &[
                        "owner",
                        "market",
                        "assetId",
                        "side",
                        "price",
                        "originalSize",
                        "sizeMatched",
                        "status",
                        "orderType",
                        "outcome",
                    ],
                );
                let filled = o["originalSize"].as_f64().is_some()
                    && o["sizeMatched"].as_f64().is_some()
                    && n(o, "originalSize") > 0.0
                    && n(o, "sizeMatched") >= n(o, "originalSize");
                let canceled = s(o, "event") == "CANCELLATION" || s(o, "status") == "CANCELED";
                if filled || canceled || self.terminal.contains(oid) {
                    self.terminal(oid);
                } else {
                    self.ws.insert(oid.to_owned(), next);
                }
                let raw = s(o, "status");
                if !raw.is_empty() {
                    self.pending_status.insert(oid.to_owned(),json!({"tradeStatusRaw":raw,"tradeStatusRank":rank(raw),"updatedAtMs":self.now}));
                    if self.pending_status.len() > 10000 {
                        for _ in 0..1000 {
                            let key = self.pending_status.keys().next().unwrap().clone();
                            self.pending_status.shift_remove(&key);
                        }
                    }
                }
                let cid = self.index.get(oid).cloned().or_else(|| {
                    self.persistent
                        .get(oid)
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
                if let Some(cid) = cid {
                    let base = self.history.get(&cid).cloned().or_else(|| {
                        self.open.get(&cid).map(|bot| {
                            self.order_snapshot(
                                bot,
                                s(bot, "state"),
                                n(bot, "remaining"),
                                n(bot, "filled"),
                            )
                        })
                    });
                    if let Some(mut base) = base {
                        if self
                            .open
                            .get(&cid)
                            .map(|v| s(v, "orderId"))
                            .unwrap_or(s(&base, "orderId"))
                            == oid
                        {
                            let prev = base.clone();
                            copy(
                                &mut base,
                                o,
                                &[
                                    "orderId",
                                    "assetId",
                                    "side",
                                    "price",
                                    "originalSize",
                                    "sizeMatched",
                                ],
                            );
                            if o["originalSize"].as_f64().is_some()
                                && o["sizeMatched"].as_f64().is_some()
                            {
                                base["remaining"] =
                                    json!(r((n(o, "originalSize") - n(o, "sizeMatched")).max(0.0)));
                            }
                            if !raw.is_empty() {
                                base["tradeStatusRaw"] = json!(raw);
                            }
                            base["tradeStatusRank"] =
                                json!(n(&prev, "tradeStatusRank").max(rank(raw) as f64));
                            base["updatedAtMs"] = json!(self.now);
                            base["sizeMatched"] =
                                json!(n(&prev, "sizeMatched").max(n(o, "sizeMatched")));
                            if self.terminal.contains(oid) {
                                base["remaining"] = json!(0);
                            }
                            self.upsert(&cid, base);
                        }
                    }
                }
            }
            "fill" => {
                let f = &ev["fill"];
                let size = n(f, "size");
                let price = n(f, "price");
                if size <= 0.0
                    || f["price"].as_f64().is_none()
                    || price < 0.0
                    || !self.once(s(f, "id").to_owned())
                {
                    return;
                }
                let fee = if s(f, "liquidity") == "TAKER" {
                    taker_fee(price, size, n(f, "feeRateBps"))
                } else {
                    0.0
                };
                self.cash = r(self.cash
                    + r(if s(f, "side") == "BUY" {
                        -price * size - fee
                    } else {
                        price * size - fee
                    }));
                let oid = s(f, "orderId");
                let cid = s(f, "clientOrderId");
                if !oid.is_empty() && !cid.is_empty() && !self.cash_exchange.contains_key(oid) {
                    self.link_cash(cid, oid);
                }
                let i = if !oid.is_empty() {
                    self.cash_exchange.get(oid)
                } else {
                    self.cash_client.get(cid)
                };
                if let Some(&i) = i {
                    self.cash_orders[i].filled = r(self.cash_orders[i].filled + size);
                } else if !oid.is_empty() {
                    let value = r(self.unlinked.get(oid).copied().unwrap_or(0.0) + size);
                    self.unlinked.insert(oid.to_owned(), value);
                }
                self.fills.push_back(f.clone());
                if self.max_fills > 0 && self.fills.len() > self.max_fills {
                    self.fills.pop_front();
                }
                self.fill_order(f);
                let asset = s(f, "assetId");
                let prev = self
                    .positions
                    .get(asset)
                    .cloned()
                    .unwrap_or(json!({"qty":0,"costBasis":0,"avgEntryPrice":null}));
                let qty = n(&prev, "qty");
                let cost = n(&prev, "costBasis");
                if s(f, "side") == "BUY" {
                    let next_qty = qty + size;
                    let next_cost = cost + price * size + fee;
                    self.positions.insert(asset.to_owned(),json!({"assetId":asset,"qty":r(next_qty),"avgEntryPrice":r(next_cost/next_qty),"costBasis":r(next_cost)}));
                } else {
                    let sell = size.min(qty);
                    let remaining = qty - sell;
                    let avg = if qty > 0.0 { cost / qty } else { 0.0 };
                    let remaining_cost = (cost - avg * sell).max(0.0);
                    self.realized = r(self.realized + r(price * sell - fee - avg * sell));
                    if remaining > 0.0 {
                        self.positions.insert(asset.to_owned(),json!({"assetId":asset,"qty":r(remaining),"avgEntryPrice":r(remaining_cost/remaining),"costBasis":r(remaining_cost)}));
                    } else {
                        self.positions.shift_remove(asset);
                        if !self.open.values().any(|o| s(o, "assetId") == asset) {
                            self.markets.shift_remove(asset);
                        }
                    }
                }
                if !s(f, "market").is_empty() {
                    self.markets.insert(asset.to_owned(), f["market"].clone());
                }
            }
            "positions_split" => {
                let sp = &ev["split"];
                let size = n(sp, "size").max(0.0);
                let a = s(sp, "assetIdA");
                let b = s(sp, "assetIdB");
                if a.is_empty()
                    || b.is_empty()
                    || a == b
                    || size <= 0.0
                    || sp["splitCost"].as_f64().is_none()
                    || n(sp, "splitCost") < 0.0
                    || !self.once(format!("split:{}", s(sp, "id")))
                {
                    return;
                }
                self.cash = r(self.cash - n(sp, "splitCost"));
                for asset in [a, b] {
                    let p = self.positions.entry(asset.to_owned()).or_insert(
                        json!({"assetId":asset,"qty":0,"avgEntryPrice":null,"costBasis":0}),
                    );
                    p["qty"] = json!(r(n(p, "qty") + size));
                    if !s(sp, "market").is_empty() {
                        self.markets.insert(asset.to_owned(), sp["market"].clone());
                    }
                }
                self.splits.push_back(sp.clone());
                if self.splits.len() > 500 {
                    self.splits.pop_front();
                }
            }
            "positions_merged" => {
                if !self.once(format!("merge:{}", s(ev, "id"))) {
                    return;
                }
                let a = s(ev, "assetIdA");
                let b = s(ev, "assetIdB");
                let size = n(ev, "size");
                if a.is_empty() || b.is_empty() || a == b || size <= 0.0 {
                    return;
                }
                self.cash = r(self.cash + size);
                let actual = size
                    .min(self.positions.get(a).map(|p| n(p, "qty")).unwrap_or(0.0))
                    .min(self.positions.get(b).map(|p| n(p, "qty")).unwrap_or(0.0));
                if actual <= 0.0 {
                    return;
                }
                for asset in [a, b] {
                    if let Some(mut p) = self.positions.get(asset).cloned() {
                        let next = r(n(&p, "qty") - actual);
                        if next > 0.0 {
                            p["qty"] = json!(next);
                            self.positions.insert(asset.to_owned(), p);
                        } else {
                            self.positions.shift_remove(asset);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}
