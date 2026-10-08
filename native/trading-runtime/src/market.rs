//! Shared market frames, orderbooks and meaningful tick construction.
//!
//! Reference: production 07245602d6ff9bca0dcdf772134cba3dd227526c.
//! Applying one message emits at most one strategy tick after all its assets.
//! Failed messages retain the reference's partial mutations; reset is explicit.
use crate::market_json;
pub use crate::market_json::{JsString, JsValue};
use crate::math::js_number_string;
use crate::protocol::ProtocolError;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::sync::Arc;
#[path = "market_snapshot.rs"]
mod market_snapshot;
pub use market_snapshot::{BookSnapshot, MarketSnapshot, SnapshotEntry};
fn js(value: Value) -> JsValue {
    JsValue::from_value(value)
}
fn object(fields: impl IntoIterator<Item = (&'static str, JsValue)>) -> JsValue {
    JsValue::object(
        fields
            .into_iter()
            .map(|(key, value)| (key.into(), value))
            .collect(),
    )
}

#[derive(Debug, Clone)]
pub struct MarketError {
    pub name: String,
    pub message: JsString,
}
impl MarketError {
    fn error(message: impl Into<JsString>) -> Self {
        Self {
            name: "Error".into(),
            message: message.into(),
        }
    }
    fn type_error(message: impl Into<JsString>) -> Self {
        Self {
            name: "TypeError".into(),
            message: message.into(),
        }
    }
    fn value(&self) -> JsValue {
        object([
            ("name", JsValue::String(self.name.clone().into())),
            ("message", JsValue::String(self.message.clone())),
        ])
    }
}
/// A native tick retains JavaScript numeric values before JSON inspection.
/// Session strategy dispatch must consume this typed message, not `msg.view()`.
#[derive(Debug, Clone)]
pub struct MarketTick {
    pub source: Value,
    pub msg: JsValue,
    pub snapshot: Arc<MarketSnapshot>,
}
impl MarketTick {
    fn json_value(&self) -> JsValue {
        object([
            ("source", js(self.source.clone())),
            ("msg", self.msg.clone()),
            ("snapshot", self.snapshot.trace_value()),
        ])
    }
}
#[derive(Debug)]
pub struct FrameError {
    pub error: MarketError,
    pub ticks: Vec<MarketTick>,
}
#[derive(Debug)]
pub struct FrameResult {
    pub message: Option<JsValue>,
    pub ticks: Vec<MarketTick>,
}
#[derive(Clone, Debug)]
pub struct Level {
    pub price: f64,
    pub size: f64,
}
/// Borrowed numeric state for native strategy context. Cumulative depth is
/// updated with the book, including partial mutations of rejected messages.
#[derive(Clone, Copy, Debug)]
pub struct BookView<'a> {
    pub market: Option<&'a JsValue>,
    pub asset_id: Option<&'a JsValue>,
    pub bids: &'a [Level],
    pub asks: &'a [Level],
    pub depth_levels: f64,
    pub bids_depth: &'a [f64],
    pub asks_depth: &'a [f64],
    pub timestamp: f64,
    pub best_bid: Option<f64>,
    pub best_ask: Option<f64>,
    pub mid: Option<f64>,
    pub spread: Option<f64>,
}
#[derive(Clone)]
struct Book {
    market: Option<JsValue>,
    asset: Option<JsValue>,
    bids: Vec<Level>,
    asks: Vec<Level>,
    bids_depth: Vec<f64>,
    asks_depth: Vec<f64>,
    depth: f64,
    timestamp: f64,
    tick_buy: Option<f64>,
    tick_sell: Option<f64>,
    hash: Option<JsValue>,
    trades: Vec<JsValue>,
    snapshot: Arc<BookSnapshot>,
    snapshot_key: Result<Arc<JsString>, MarketError>,
}
impl Book {
    fn new(market: Option<JsValue>, asset: Option<JsValue>, depth: f64) -> Self {
        let snapshot = BookSnapshot::initial(BookView {
            market: market.as_ref(),
            asset_id: asset.as_ref(),
            bids: &[],
            asks: &[],
            bids_depth: &[],
            asks_depth: &[],
            depth_levels: depth,
            timestamp: 0.0,
            best_bid: None,
            best_ask: None,
            mid: None,
            spread: None,
        });
        // Conversion can fail; preserve its original snapshot-time failure.
        let snapshot_key = js_string(asset.as_ref()).map(Arc::new);
        Self {
            market,
            asset,
            snapshot,
            snapshot_key,
            bids: vec![],
            asks: vec![],
            bids_depth: vec![],
            asks_depth: vec![],
            depth,
            timestamp: 0.0,
            tick_buy: None,
            tick_sell: None,
            hash: None,
            trades: vec![],
        }
    }
    fn view(&self) -> BookView<'_> {
        BookView {
            market: self.market.as_ref(),
            asset_id: self.asset.as_ref(),
            bids: &self.bids,
            asks: &self.asks,
            depth_levels: self.depth,
            bids_depth: &self.bids_depth,
            asks_depth: &self.asks_depth,
            timestamp: self.timestamp,
            best_bid: self.best(true),
            best_ask: self.best(false),
            mid: self
                .best(true)
                .zip(self.best(false))
                .map(|(bid, ask)| (bid + ask) / 2.0),
            spread: self
                .best(true)
                .zip(self.best(false))
                .map(|(bid, ask)| ask - bid),
        }
    }
    fn best(&self, buy: bool) -> Option<f64> {
        (if buy { &self.bids } else { &self.asks })
            .first()
            .map(|level| if level.price == 0.0 { 0.0 } else { level.price })
    }
    fn state(&self) -> JsValue {
        let mut result = js(
            json!({"bids":levels_value(&self.bids),"asks":levels_value(&self.asks),
            "tickSizeBuy":self.tick_buy,"tickSizeSell":self.tick_sell,"lastUpdateTs":self.timestamp}),
        );
        if let Some(market) = &self.market {
            result.insert("market", market.clone());
        }
        if let Some(asset) = &self.asset {
            result.insert("assetId", asset.clone());
        }
        if let Some(hash) = &self.hash {
            result.insert("lastBookHash", hash.clone());
        }
        object([
            ("state", result),
            ("recentTrades", JsValue::array(self.trades.clone())),
        ])
    }
    fn apply(&mut self, msg: &JsValue) -> Result<(), MarketError> {
        let result = self.apply_inner(msg);
        self.bids_depth = cumulative(&self.bids, self.depth);
        self.asks_depth = cumulative(&self.asks, self.depth);
        self.snapshot = BookSnapshot::updated(self.view(), &self.snapshot);
        result
    }
    fn apply_inner(&mut self, msg: &JsValue) -> Result<(), MarketError> {
        let kind = string(msg, "event_type");
        let market = msg.get("market");
        if !same(self.market.as_ref(), market) {
            return Err(MarketError::error(JsString::format(
                &format!("[orderbook] market mismatch on {kind}: expected={{}} got={{}}"),
                &[js_string(self.market.as_ref())?, js_string(market)?],
            )));
        }
        if kind != "price_change" && !same(self.asset.as_ref(), msg.get("asset_id")) {
            return Err(MarketError::error(JsString::format(
                &format!("[orderbook] asset_id mismatch on {kind}: expected={{}} got={{}}"),
                &[
                    js_string(self.asset.as_ref())?,
                    js_string(msg.get("asset_id"))?,
                ],
            )));
        }
        match kind {
            "book" => {
                let bids = parse_levels(msg.get("bids"), true)?;
                let asks = parse_levels(msg.get("asks"), false)?;
                self.bids = bids;
                self.asks = asks;
                self.timestamp = timestamp(msg.get("timestamp"))?;
                self.hash = msg.get("hash").cloned();
            }
            "price_change" => {
                self.timestamp = timestamp(msg.get("timestamp"))?;
                let changes = iterable(msg.get("price_changes"), "changes")?;
                let (mut inserted_bid, mut inserted_ask) = (false, false);
                for change in changes {
                    let asset = property(&change, "asset_id")?;
                    if !same(self.asset.as_ref(), asset) {
                        continue;
                    }
                    let price = parse_num("price_change.price", property(&change, "price")?)?;
                    let size = parse_num("price_change.size", property(&change, "size")?)?;
                    let buy = change.get("side").and_then(JsValue::as_str) == Some("BUY");
                    let side = if buy { &mut self.bids } else { &mut self.asks };
                    let at = side.iter().position(|level| level.price == price);
                    if size <= 0.0 {
                        if let Some(at) = at {
                            side.remove(at);
                        }
                        continue;
                    }
                    if let Some(at) = at {
                        side[at] = Level { price, size };
                    } else {
                        side.push(Level { price, size });
                        if buy {
                            inserted_bid = true;
                        } else {
                            inserted_ask = true;
                        }
                    }
                }
                if inserted_bid {
                    sort_levels(&mut self.bids, true);
                }
                if inserted_ask {
                    sort_levels(&mut self.asks, false);
                }
            }
            "tick_size_change" => {
                self.timestamp = timestamp(msg.get("timestamp"))?;
                let tick = parse_num("tick_size_change.new_tick_size", msg.get("new_tick_size"))?;
                match string(msg, "side") {
                    "BUY" => self.tick_buy = Some(tick),
                    "SELL" => self.tick_sell = Some(tick),
                    _ => {
                        self.tick_buy = Some(tick);
                        self.tick_sell = Some(tick);
                    }
                }
            }
            "last_trade_price" => {
                self.timestamp = timestamp(msg.get("timestamp"))?;
                let mut trade = js(
                    json!({"price":parse_num("last_trade_price.price",msg.get("price"))?,
                    "size":parse_num("last_trade_price.size",msg.get("size"))?,"timestamp":self.timestamp}),
                );
                if let Some(side) = msg.get("side") {
                    trade.insert("side", side.clone());
                }
                self.trades.push(trade);
                if self.trades.len() > 200 {
                    self.trades.remove(0);
                }
            }
            _ => {
                return Err(MarketError::error(format!(
                    "[orderbook] unknown event_type {kind}"
                )))
            }
        }
        Ok(())
    }
}
fn levels_value(levels: &[Level]) -> Value {
    json!(levels
        .iter()
        .map(|level| json!({"price":level.price,"size":level.size}))
        .collect::<Vec<_>>())
}
fn cumulative(levels: &[Level], depth: f64) -> Vec<f64> {
    let mut sum = 0.0;
    levels
        .iter()
        .enumerate()
        .take_while(|(index, _)| (*index as f64) < depth)
        .map(|(_, level)| {
            sum += level.size;
            sum
        })
        .collect()
}
fn string<'a>(value: &'a JsValue, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(JsValue::as_str)
        .unwrap_or("undefined")
}
fn same(left: Option<&JsValue>, right: Option<&JsValue>) -> bool {
    match (left, right) {
        (Some(JsValue::Number(a)), Some(JsValue::Number(b))) => a == b,
        (Some(left), Some(right)) => left.same_identity(right),
        _ => left == right,
    }
}
fn truthy(value: Option<&JsValue>) -> bool {
    match value {
        None | Some(JsValue::Null) => false,
        Some(JsValue::Bool(value)) => *value,
        Some(JsValue::String(value)) => !value.is_empty(),
        Some(JsValue::Number(value)) => *value != 0.0 && !value.is_nan(),
        _ => true,
    }
}
fn js_string(value: Option<&JsValue>) -> Result<JsString, MarketError> {
    enum Task<'a> {
        Value(Option<&'a JsValue>, bool),
        Text(&'static str),
    }
    let mut tasks = vec![Task::Value(value, false)];
    let mut pieces = Vec::new();
    while let Some(task) = tasks.pop() {
        match task {
            Task::Text(text) => pieces.push(text.into()),
            Task::Value(value, in_array) => match value {
                None => pieces.push("undefined".into()),
                Some(JsValue::Null) => pieces.push(if in_array { "" } else { "null" }.into()),
                Some(JsValue::String(value)) => pieces.push(value.clone()),
                Some(JsValue::Array(values)) => {
                    for (index, value) in values.iter().enumerate().rev() {
                        tasks.push(Task::Value(Some(value), true));
                        if index > 0 {
                            tasks.push(Task::Text(","));
                        }
                    }
                }
                Some(JsValue::Object(_)) => {
                    if value.and_then(|value| value.get("toString")).is_some() {
                        return Err(MarketError::type_error(
                            "Cannot convert object to primitive value",
                        ));
                    }
                    pieces.push("[object Object]".into());
                }
                Some(JsValue::Number(value)) => pieces.push(js_number_string(*value).into()),
                Some(value) => pieces.push(value.to_json_string().into()),
            },
        }
    }
    Ok(JsString::join(pieces, ""))
}
fn whitespace(ch: char) -> bool {
    matches!(ch,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn number(value: Option<&JsValue>) -> Result<f64, MarketError> {
    let result = match value {
        None => f64::NAN,
        Some(JsValue::Null) => 0.0,
        Some(JsValue::Bool(v)) => {
            if *v {
                1.0
            } else {
                0.0
            }
        }
        Some(JsValue::Number(value)) => *value,
        Some(JsValue::Object(_)) => {
            if value.and_then(|value| value.get("toString")).is_some() {
                return Err(MarketError::type_error(
                    "Cannot convert object to primitive value",
                ));
            }
            f64::NAN
        }
        Some(JsValue::Array(_)) => return number(Some(&JsValue::String(js_string(value)?))),
        Some(JsValue::String(value)) => {
            let Some(value) = value.as_str() else {
                return Ok(f64::NAN);
            };
            let value = value.trim_matches(whitespace);
            if value.is_empty() {
                return Ok(0.0);
            }
            for (prefix, base) in [
                ("0x", 16),
                ("0X", 16),
                ("0b", 2),
                ("0B", 2),
                ("0o", 8),
                ("0O", 8),
            ] {
                if let Some(digits) = value.strip_prefix(prefix) {
                    if digits.is_empty() {
                        return Ok(f64::NAN);
                    }
                    return Ok(radix_number(digits, base));
                }
            }
            value.parse().unwrap_or(f64::NAN)
        }
    };
    Ok(result)
}
/// Number(radix integer) rounds once after the entire exact integer, rather
/// than rounding each multiply/add. Keep a significand, guard and sticky bit.
fn radix_number(digits: &str, base: u32) -> f64 {
    let width = base.trailing_zeros();
    let mut bits = 0usize;
    let mut mantissa = 0u64;
    let mut guard = false;
    let mut sticky = false;
    for digit in digits.chars() {
        let Some(digit) = digit.to_digit(base) else {
            return f64::NAN;
        };
        for shift in (0..width).rev() {
            let bit = (digit >> shift) & 1;
            if bits == 0 && bit == 0 {
                continue;
            }
            bits += 1;
            match bits {
                1..=53 => mantissa = (mantissa << 1) | bit as u64,
                54 => guard = bit != 0,
                _ => sticky |= bit != 0,
            }
        }
    }
    if bits <= 53 {
        return mantissa as f64;
    }
    if bits > 1024 {
        return f64::INFINITY;
    }
    if guard && (sticky || mantissa & 1 != 0) {
        mantissa += 1;
    }
    mantissa as f64 * 2.0_f64.powi((bits - 53) as i32)
}
fn parse_num(label: &str, value: Option<&JsValue>) -> Result<f64, MarketError> {
    let parsed = number(value)?;
    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(MarketError::error(format!(
            "[orderbook] invalid {label}: {}",
            value
                .map(|value| value.to_json_string())
                .unwrap_or_else(|| "undefined".into())
        )))
    }
}
fn timestamp(value: Option<&JsValue>) -> Result<f64, MarketError> {
    parse_num("timestamp", value).map(f64::trunc)
}
fn property<'a>(value: &'a JsValue, key: &str) -> Result<Option<&'a JsValue>, MarketError> {
    if value.is_null() {
        return Err(MarketError::type_error(format!(
            "Cannot read properties of null (reading '{key}')"
        )));
    }
    Ok(value.get(key))
}
fn iterable(value: Option<&JsValue>, name: &str) -> Result<Vec<JsValue>, MarketError> {
    match value {
        Some(JsValue::Array(values)) => Ok(values.values.clone()),
        Some(JsValue::String(value)) => Ok(std::char::decode_utf16(value.units())
            .map(|item| {
                JsValue::String(match item {
                    Ok(ch) => ch.to_string().into(),
                    Err(error) => JsString::from_units(vec![error.unpaired_surrogate()]),
                })
            })
            .collect()),
        _ => Err(MarketError::type_error(format!("{name} is not iterable"))),
    }
}
fn sort_levels(levels: &mut [Level], buy: bool) {
    levels.sort_by(|a, b| {
        if buy {
            b.price.partial_cmp(&a.price)
        } else {
            a.price.partial_cmp(&b.price)
        }
        .unwrap_or(std::cmp::Ordering::Equal)
    });
}
fn parse_levels(value: Option<&JsValue>, buy: bool) -> Result<Vec<Level>, MarketError> {
    let mut levels = Vec::new();
    for level in iterable(value, "levels")? {
        let label = if buy { "bids" } else { "asks" };
        let price = parse_num(&format!("{label}.price"), property(&level, "price")?)?;
        let size = parse_num(&format!("{label}.size"), property(&level, "size")?)?;
        if size > 0.0 {
            levels.push(Level { price, size });
        }
    }
    sort_levels(&mut levels, buy);
    let mut unique: Vec<Level> = Vec::new();
    for level in levels {
        if let Some(at) = unique.iter().position(|prior| prior.price == level.price) {
            unique[at] = level;
        } else {
            unique.push(level);
        }
    }
    Ok(unique)
}
fn closed_object(value: &JsValue, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|fields| {
        fields.len() == keys.len()
            && keys
                .iter()
                .all(|key| fields.iter().any(|(name, _)| name.matches(key)))
    })
}
fn normalize_hashes(message: &JsValue) -> JsValue {
    if string(message, "event_type") != "price_change" {
        return message.clone();
    }
    let Some(changes) = message.get("price_changes").and_then(JsValue::as_array) else {
        return message.clone();
    };
    if changes
        .iter()
        .all(|change| change.get("hash").and_then(JsValue::as_str) == Some(""))
    {
        return message.clone();
    }
    let keys = [
        "asset_id", "price", "size", "side", "hash", "best_bid", "best_ask",
    ];
    let compact = closed_object(
        message,
        &["market", "price_changes", "timestamp", "event_type"],
    ) && message.get("market").is_some_and(JsValue::is_string)
        && message.get("timestamp").is_some_and(JsValue::is_string)
        && changes.iter().all(|change| {
            closed_object(change, &keys)
                && keys
                    .iter()
                    .all(|key| change.get(key).is_some_and(JsValue::is_string))
                && change
                    .get("hash")
                    .and_then(JsValue::as_str)
                    .is_some_and(|hash| {
                        hash.is_empty()
                            || (hash.len() == 40
                                && hash
                                    .chars()
                                    .all(|ch| ch.is_ascii_digit() || ('a'..='f').contains(&ch)))
                    })
        });
    if !compact {
        return message.clone();
    }
    // TS spreads the outer message and maps every child into a fresh object.
    // Retain scalar values/order, but never reuse immutable identity tokens for
    // nodes whose values change during normalization.
    let mut result = JsValue::object(message.as_object().expect("closed object").to_vec());
    let changes = changes
        .iter()
        .map(|change| {
            let mut change = JsValue::object(change.as_object().expect("closed change").to_vec());
            change.insert("hash", JsValue::String("".into()));
            change
        })
        .collect();
    result.insert("price_changes", JsValue::array(changes));
    result
}
/// Decode only supported market-channel members without losing binary64 values.
pub fn decode_frame(raw: &str) -> Vec<JsValue> {
    let Ok(value) = market_json::parse(raw) else {
        return vec![];
    };
    let mut value = value;
    let values = if let JsValue::Array(values) = &mut value {
        std::mem::take(&mut values.values)
    } else {
        vec![value]
    };
    values
        .into_iter()
        .filter(|message| {
            matches!(
                string(message, "event_type"),
                "book" | "price_change" | "tick_size_change" | "last_trade_price"
            )
        })
        .collect()
}
pub(crate) fn normalize_source(source: &Value) -> Result<Value, MarketError> {
    let mut source = market_json::normalize_control_value(source.clone());
    if let Some(seq) = source.get_mut("ingestSeq") {
        let Some(raw) = seq.as_str() else {
            return Err(MarketError::error("ingestSeq must be a decimal string"));
        };
        let raw = raw.trim_matches(whitespace);
        let (negative, digits) = if let Some(rest) = raw.strip_prefix('-') {
            (true, rest)
        } else {
            (false, raw.strip_prefix('+').unwrap_or(raw))
        };
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(MarketError::error("ingestSeq must be a decimal string"));
        }
        let digits = digits.trim_start_matches('0');
        *seq = json!(if digits.is_empty() {
            "0".into()
        } else if negative {
            format!("-{digits}")
        } else {
            digits.to_owned()
        });
    }
    Ok(source)
}

/// Stateful shared market core; the enclosing session serializes frame calls.
pub struct MarketEngine {
    market: Option<JsValue>,
    timestamp: f64,
    books: Vec<Book>,
    expected: Option<[String; 2]>,
    saw_books: Vec<Option<JsValue>>,
    last_by_asset: Vec<(Option<JsValue>, f64)>,
    depth: f64,
    snapshot_cache: RefCell<Option<Arc<MarketSnapshot>>>,
    snapshot_dirty: Cell<bool>,
}
impl MarketEngine {
    pub fn new(expected: Option<[String; 2]>, depth: f64) -> Result<Self, MarketError> {
        if !depth.is_finite() {
            return Err(MarketError::error("depthLevels must be finite"));
        }
        Ok(Self {
            market: None,
            timestamp: 0.0,
            books: vec![],
            expected,
            saw_books: vec![],
            last_by_asset: vec![],
            depth: depth.floor().max(1.0),
            snapshot_cache: RefCell::new(None),
            snapshot_dirty: Cell::new(true),
        })
    }
    pub fn reset(&mut self) {
        self.market = None;
        self.timestamp = 0.0;
        self.books.clear();
        self.saw_books.clear();
        self.last_by_asset.clear();
        *self.snapshot_cache.get_mut() = None;
        self.snapshot_dirty.set(true);
    }
    fn assert_market(&mut self, market: Option<&JsValue>, kind: &str) -> Result<(), MarketError> {
        if !truthy(self.market.as_ref()) {
            self.market = market.cloned();
            return Ok(());
        }
        if !same(self.market.as_ref(), market) {
            return Err(MarketError::error(JsString::format(
                &format!("[orderbook] market mismatch on {kind}: expected={{}} got={{}}"),
                &[js_string(self.market.as_ref())?, js_string(market)?],
            )));
        }
        Ok(())
    }
    fn get_book(&mut self, market: Option<&JsValue>, asset: Option<&JsValue>) -> usize {
        if let Some(index) = self
            .books
            .iter()
            .position(|book| same(book.asset.as_ref(), asset))
        {
            return index;
        }
        self.books
            .push(Book::new(market.cloned(), asset.cloned(), self.depth));
        self.books.len() - 1
    }
    pub fn book(&self, asset_id: &str) -> Option<BookView<'_>> {
        self.books
            .iter()
            .find(|book| book.asset.as_ref().and_then(JsValue::as_str) == Some(asset_id))
            .map(Book::view)
    }
    pub fn books(&self) -> impl Iterator<Item = BookView<'_>> {
        self.books.iter().map(Book::view)
    }
    fn update_asset(&mut self, asset: Option<&JsValue>, timestamp: f64) {
        if let Some(index) = self
            .last_by_asset
            .iter()
            .position(|(id, _)| same(id.as_ref(), asset))
        {
            self.last_by_asset[index].1 = timestamp;
        } else {
            self.last_by_asset.push((asset.cloned(), timestamp));
        }
    }
    fn apply(&mut self, msg: &JsValue) -> Result<(), MarketError> {
        // Rejected messages can still alter global time, create books or mutate levels.
        self.snapshot_dirty.set(true);
        let kind = string(msg, "event_type");
        let market = msg.get("market");
        if market
            .and_then(JsValue::as_str)
            .is_some_and(|market| !market.is_empty())
        {
            self.assert_market(market, kind)?;
        }
        let ts = number(msg.get("timestamp"))?;
        if ts.is_finite() {
            self.timestamp = ts.trunc();
        }
        match kind {
            "book" | "tick_size_change" | "last_trade_price" => {
                self.assert_market(market, kind)?;
                let asset = msg.get("asset_id");
                let index = self.get_book(market, asset);
                self.books[index].apply(msg)?;
                self.timestamp = self.books[index].timestamp;
                if kind == "book" && !self.saw_books.iter().any(|id| same(id.as_ref(), asset)) {
                    self.saw_books.push(asset.cloned());
                }
                self.update_asset(asset, self.books[index].timestamp);
            }
            "price_change" => {
                self.assert_market(market, kind)?;
                let mut groups: Vec<(Option<JsValue>, Vec<JsValue>)> = vec![];
                for change in iterable(msg.get("price_changes"), "changes")? {
                    let asset = property(&change, "asset_id")?;
                    if let Some(index) = groups.iter().position(|(id, _)| same(id.as_ref(), asset))
                    {
                        groups[index].1.push(change);
                        continue;
                    }
                    groups.push((asset.cloned(), vec![change]));
                }
                for (asset, changes) in groups {
                    let index = self.get_book(market, asset.as_ref());
                    let mut message = JsValue::object(vec![
                        ("event_type".into(), JsValue::String("price_change".into())),
                        ("price_changes".into(), JsValue::array(changes)),
                    ]);
                    if let Some(market) = market {
                        message.insert("market", market.clone());
                    }
                    if let Some(timestamp) = msg.get("timestamp") {
                        message.insert("timestamp", timestamp.clone());
                    }
                    self.books[index].apply(&message)?;
                    self.update_asset(asset.as_ref(), self.books[index].timestamp);
                }
                self.timestamp = timestamp(msg.get("timestamp"))?;
            }
            _ => {
                return Err(MarketError::error(JsString::format(
                    "[orderbook] MarketOrderBookEngine unknown event_type {}",
                    &[js_string(msg.get("event_type"))?],
                )))
            }
        }
        Ok(())
    }
    /// Freeze historical book state without JSON construction. Unchanged book
    /// nodes, sides and cumulative arrays retain their shared allocations.
    pub fn snapshot(&self) -> Result<Arc<MarketSnapshot>, MarketError> {
        if !self.snapshot_dirty.get() {
            if let Some(snapshot) = self.snapshot_cache.borrow().as_ref() {
                return Ok(Arc::clone(snapshot));
            }
        }
        let mut entries: Vec<SnapshotEntry> = Vec::with_capacity(self.books.len());
        for book in &self.books {
            let key = book.snapshot_key.clone()?;
            let entry = SnapshotEntry {
                key,
                book: Arc::clone(&book.snapshot),
            };
            if let Some(index) = entries.iter().position(|prior| prior.key == entry.key) {
                entries[index].book = entry.book;
            } else {
                entries.push(entry);
            }
        }
        entries.sort_by_key(|entry| {
            entry
                .key
                .array_index()
                .map(|index| (0, index))
                .unwrap_or((1, 0))
        });
        let previous = self.snapshot_cache.borrow();
        let entries_same = previous.as_ref().is_some_and(|previous| {
            previous.by_asset_id.len() == entries.len()
                && previous
                    .by_asset_id
                    .iter()
                    .zip(&entries)
                    .all(|(old, new)| old.key == new.key && Arc::ptr_eq(&old.book, &new.book))
        });
        let market = self.market.as_ref().filter(|market| !market.is_null());
        let market_same =
            previous
                .as_ref()
                .is_some_and(|previous| match (market, previous.market.as_ref()) {
                    (Some(JsValue::Number(left)), JsValue::Number(right)) => {
                        left.to_bits() == right.to_bits()
                    }
                    (Some(left), right) => left.same_identity(right),
                    (None, JsValue::String(value)) => value.matches("(unknown)"),
                    _ => false,
                });
        let snapshot = if let Some(previous) = previous.as_ref().filter(|previous| {
            entries_same && market_same && previous.timestamp.to_bits() == self.timestamp.to_bits()
        }) {
            Arc::clone(previous)
        } else {
            Arc::new(MarketSnapshot {
                market: if market_same {
                    Arc::clone(&previous.as_ref().expect("cached market").market)
                } else {
                    Arc::new(
                        market
                            .cloned()
                            .unwrap_or_else(|| JsValue::String("(unknown)".into())),
                    )
                },
                timestamp: self.timestamp,
                by_asset_id: if entries_same {
                    Arc::clone(&previous.as_ref().expect("cached entries").by_asset_id)
                } else {
                    entries.into()
                },
            })
        };
        drop(previous);
        *self.snapshot_cache.borrow_mut() = Some(Arc::clone(&snapshot));
        self.snapshot_dirty.set(false);
        Ok(snapshot)
    }
    pub fn inspection(&self) -> Result<JsValue, MarketError> {
        let warm = if let Some(expected) = &self.expected {
            expected.iter().all(|id| {
                self.saw_books
                    .iter()
                    .any(|seen| seen.as_ref().and_then(JsValue::as_str) == Some(id))
            })
        } else {
            !self.saw_books.is_empty()
        };
        let missing = self
            .expected
            .as_ref()
            .map(|expected| {
                expected
                    .iter()
                    .filter(|id| {
                        !self
                            .saw_books
                            .iter()
                            .any(|seen| seen.as_ref().and_then(JsValue::as_str) == Some(id))
                    })
                    .map(|id| JsValue::String(id.clone().into()))
                    .collect()
            })
            .unwrap_or_default();
        let mut states = JsValue::object(vec![]);
        for book in &self.books {
            states.insert_key(js_string(book.asset.as_ref())?, book.state());
        }
        Ok(object([
            ("snapshot", self.snapshot()?.trace_value()),
            (
                "snapshotAssetKeys",
                JsValue::array(
                    self.snapshot()?
                        .by_asset_id
                        .iter()
                        .map(|entry| JsValue::String(entry.key.as_ref().clone()))
                        .collect(),
                ),
            ),
            ("isWarm", JsValue::Bool(warm)),
            ("missingBooks", JsValue::array(missing)),
            (
                "lastUpdateTsByAssetId",
                JsValue::array(
                    self.last_by_asset
                        .iter()
                        .map(|(id, ts)| {
                            JsValue::array(vec![
                                id.clone().unwrap_or(JsValue::Null),
                                JsValue::Number(*ts),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("states", states),
        ]))
    }
    pub fn handle_raw(
        &mut self,
        raw: &str,
        source: &Value,
        bootstrap: bool,
    ) -> Result<FrameResult, FrameError> {
        self.handle_wire(&decode_frame(raw), source, bootstrap)
    }
    pub fn handle_decoded(
        &mut self,
        messages: &[Value],
        source: &Value,
        bootstrap: bool,
    ) -> Result<FrameResult, FrameError> {
        let messages = messages
            .iter()
            .cloned()
            .map(JsValue::from_value)
            .collect::<Vec<_>>();
        self.handle_wire(&messages, source, bootstrap)
    }
    /// Apply exactly one child, retaining partial mutation if conversion fails.
    /// Admission owns sequencing; the collector and cursor share this operation.
    pub(crate) fn apply_frame_child(
        &mut self,
        original: &JsValue,
        source: &Value,
        bootstrap: bool,
        index: usize,
        length: usize,
    ) -> Result<Option<MarketTick>, MarketError> {
        let invalid = match original {
            JsValue::Null => Some("Cannot read properties of null (reading 'event_type')".into()),
            JsValue::String(_) | JsValue::Bool(_) | JsValue::Number(_) => Some(JsString::format(
                "Cannot use 'in' operator to search for 'market' in {}",
                &[js_string(Some(original))?],
            )),
            _ => None,
        };
        if let Some(message) = invalid {
            return Err(MarketError::type_error(message));
        }
        let message = normalize_hashes(original);
        self.apply(&message)?;
        if bootstrap || !matches!(string(&message, "event_type"), "book" | "price_change") {
            return Ok(None);
        }
        let mut source = source.clone();
        if source.get("ingestSeq").is_some() && length > 1 {
            source["frameIndex"] = json!(index);
        }
        Ok(Some(MarketTick {
            source,
            msg: message,
            snapshot: self.snapshot()?,
        }))
    }
    fn handle_wire(
        &mut self,
        messages: &[JsValue],
        source: &Value,
        bootstrap: bool,
    ) -> Result<FrameResult, FrameError> {
        let mut ticks = vec![];
        let source = normalize_source(source).map_err(|error| FrameError {
            error,
            ticks: vec![],
        })?;
        for (index, original) in messages.iter().enumerate() {
            match self.apply_frame_child(original, &source, bootstrap, index, messages.len()) {
                Ok(Some(tick)) => ticks.push(tick),
                Ok(None) => {}
                Err(error) => return Err(FrameError { error, ticks }),
            }
        }
        Ok(FrameResult {
            message: messages.last().cloned(),
            ticks,
        })
    }
}

/// Diagnostic evidence of internal number classes; JSON output alone masks
/// infinities and signed zero. This projection is never used for dispatch.
fn snapshot_numeric_bits(snapshot: &MarketSnapshot) -> JsValue {
    fn bits(value: f64) -> JsValue {
        JsValue::String(format!("{:016x}", value.to_bits()).into())
    }
    fn optional(value: Option<f64>) -> JsValue {
        value.map(bits).unwrap_or(JsValue::Null)
    }
    fn levels(values: &[Level]) -> JsValue {
        JsValue::array(
            values
                .iter()
                .map(|level| JsValue::array(vec![bits(level.price), bits(level.size)]))
                .collect(),
        )
    }
    object([
        ("timestamp", bits(snapshot.timestamp)),
        (
            "books",
            JsValue::array(
                snapshot
                    .books()
                    .map(|entry| {
                        let book = &entry.book;
                        object([
                            ("key", JsValue::String(entry.key.as_ref().clone())),
                            ("timestamp", bits(book.timestamp)),
                            ("depthLevels", bits(book.depth_levels)),
                            ("bestBid", optional(book.best_bid)),
                            ("bestAsk", optional(book.best_ask)),
                            ("mid", optional(book.mid)),
                            ("spread", optional(book.spread)),
                            ("bids", levels(&book.bids)),
                            ("asks", levels(&book.asks)),
                            (
                                "bidsDepthByLevel",
                                JsValue::array(book.bids_depth.iter().copied().map(bits).collect()),
                            ),
                            (
                                "asksDepthByLevel",
                                JsValue::array(book.asks_depth.iter().copied().map(bits).collect()),
                            ),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}

/// Portable operation driver for independent whole-output fixtures. This is not
/// a production replay mode, queue job or replacement for a session tick loop.
pub fn verify_market(input: &Value) -> Result<JsValue, ProtocolError> {
    let expected = match input.get("expectedAssetIds") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let Some(values) = value.as_array().filter(|values| values.len() == 2) else {
                return Err(ProtocolError::invalid_request(
                    "expectedAssetIds must contain two strings",
                ));
            };
            let Some(first) = values[0].as_str() else {
                return Err(ProtocolError::invalid_request(
                    "expectedAssetIds must contain two strings",
                ));
            };
            let Some(second) = values[1].as_str() else {
                return Err(ProtocolError::invalid_request(
                    "expectedAssetIds must contain two strings",
                ));
            };
            Some([first.to_owned(), second.to_owned()])
        }
    };
    let depth = input
        .get("depthLevels")
        .map(|value| value.as_f64().unwrap_or(f64::NAN))
        .unwrap_or(10.0);
    let mut engine = MarketEngine::new(expected, depth).map_err(|error| {
        ProtocolError::invalid_request(
            error
                .message
                .as_str()
                .unwrap_or("invalid market configuration"),
        )
    })?;
    let operations = input
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| ProtocolError::invalid_request("operations must be an array"))?;
    let mut steps = vec![];
    let retain_ticks = input
        .get("retainTicks")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut retained = vec![];
    for operation in operations {
        let source = operation
            .get("source")
            .cloned()
            .unwrap_or_else(|| json!({"kind":"live","attempt":1}));
        let bootstrap = operation
            .get("bootstrap")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let outcome = match operation
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("undefined")
        {
            "reset" => {
                engine.reset();
                Ok(FrameResult {
                    message: None,
                    ticks: vec![],
                })
            }
            "raw" => engine.handle_raw(
                operation
                    .get("rawJson")
                    .and_then(Value::as_str)
                    .ok_or_else(|| ProtocolError::invalid_request("rawJson must be a string"))?,
                &source,
                bootstrap,
            ),
            "decoded" => engine.handle_decoded(
                operation
                    .get("messages")
                    .and_then(Value::as_array)
                    .ok_or_else(|| ProtocolError::invalid_request("messages must be an array"))?,
                &source,
                bootstrap,
            ),
            _ => {
                return Err(ProtocolError::invalid_request(
                    "unknown market fixture operation",
                ))
            }
        };
        if retain_ticks {
            retained.extend(
                match &outcome {
                    Ok(result) => &result.ticks,
                    Err(error) => &error.ticks,
                }
                .iter()
                .cloned(),
            );
        }
        let mut step = engine
            .inspection()
            .unwrap_or_else(|error| object([("inspectionError", error.value())]));
        match outcome {
            Ok(result) => {
                step.insert("message", result.message.unwrap_or(JsValue::Null));
                step.insert(
                    "ticks",
                    JsValue::array(result.ticks.iter().map(MarketTick::json_value).collect()),
                );
            }
            Err(error) => {
                step.insert("message", JsValue::Null);
                step.insert(
                    "ticks",
                    JsValue::array(error.ticks.iter().map(MarketTick::json_value).collect()),
                );
                step.insert("error", error.error.value());
            }
        }
        let message_keys = step["message"]
            .as_object()
            .unwrap_or(&[])
            .iter()
            .map(|(key, _)| JsValue::String(key.clone()))
            .collect();
        step.insert("messageKeys", JsValue::array(message_keys));
        steps.push(step);
    }
    let mut result = object([
        ("steps", JsValue::array(steps)),
        (
            "final",
            engine
                .inspection()
                .unwrap_or_else(|error| object([("inspectionError", error.value())])),
        ),
    ]);
    if retain_ticks {
        result.insert(
            "retainedTicks",
            JsValue::array(retained.iter().map(MarketTick::json_value).collect()),
        );
        result.insert(
            "retainedNumericBits",
            JsValue::array(
                retained
                    .iter()
                    .map(|tick| snapshot_numeric_bits(&tick.snapshot))
                    .collect(),
            ),
        );
    }
    Ok(result)
}
