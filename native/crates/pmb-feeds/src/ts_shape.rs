//! TS-shape mapping at the boundary (14 F-5, §11.2): the typed feed view and
//! feed request rendered in the shapes the TS side reads, for the parity
//! trace, `describe.requiredFeeds` and the live WebUI. Nothing inside the
//! engine reads these values back.
//!
//! The functions return [`serde_json::Value`] trees; the writer that emits
//! them owns key order and number spelling (22 for the trace, 20 §5 for
//! `describe`), so nothing here emulates JS number formatting (00 R1).

use crate::error::{FeedCause, FeedError};
use crate::market::MarketFeeds;
use crate::request::{FeedOptions, FeedRequest};
use crate::time::iso_ms;
use pmb_core::{FeedsView, SpotPoint};
use serde_json::{Map, Number, Value};

fn num(v: f64) -> Value {
    Value::Number(
        Number::from_f64(v).expect("feed values are validated finite (14 F-17, F-25, §6.2)"),
    )
}

/// `RtdsPricePoint` (`src/trading/feeds/externalFeeds.ts:1-6`):
/// `{symbol, tsMs, value, receivedAtMs}` (14 F-16, F-24).
fn spot(symbol: &str, p: &SpotPoint) -> Value {
    let mut o = Map::new();
    o.insert("symbol".into(), Value::from(symbol));
    o.insert("tsMs".into(), Value::from(p.source_ts.0));
    o.insert("value".into(), num(p.value));
    o.insert("receivedAtMs".into(), Value::from(p.received_at.0));
    Value::Object(o)
}

/// The TS `ExternalFeedsSnapshot` of `view` on a historical input (14 §11.2;
/// TS `backtestExternalFeedsProvider.ts:134-177`):
///
/// - `binanceWsSpotPrice: {symbol, tsMs, value, receivedAtMs}` once visible;
/// - `rtdsPolymarketCryptoPrices: {}` always, with `chainlink: {symbol, tsMs,
///   value, receivedAtMs}` once visible;
/// - `polymarketPriceToBeat: {symbol, eventStartTimeIso, endDateIso,
///   openPrice, receivedAtMs}` once available (no `apiTimestampMs`: the
///   historical source has none).
///
/// Symbols are the resolved ones of `feeds` (14 F-49): `btcusdt`, `btc/usd`,
/// `BTC`. A feed the strategy did not request is never visible, so its key
/// is absent.
pub fn historical_snapshot(feeds: &MarketFeeds, view: &FeedsView) -> Value {
    let mut snap = Map::new();
    let mut rtds = Map::new();
    if let (Some(f), Some(p)) = (feeds.chainlink(), view.chainlink_spot()) {
        rtds.insert("chainlink".into(), spot(f.symbol, p));
    }
    snap.insert("rtdsPolymarketCryptoPrices".into(), Value::Object(rtds));
    if let (Some(f), Some(p)) = (feeds.binance(), view.binance_spot()) {
        snap.insert("binanceWsSpotPrice".into(), spot(f.symbol, p));
    }
    if let (Some(src), Some(p)) = (feeds.price_to_beat(), view.price_to_beat()) {
        let mut o = Map::new();
        o.insert("symbol".into(), Value::from(src.symbol));
        o.insert(
            "eventStartTimeIso".into(),
            Value::from(iso_ms(p.event_start.0)),
        );
        o.insert("endDateIso".into(), Value::from(iso_ms(p.end.0)));
        o.insert("openPrice".into(), num(p.open_price));
        o.insert("receivedAtMs".into(), Value::from(p.received_at.0));
        snap.insert("polymarketPriceToBeat".into(), Value::Object(o));
    }
    Value::Object(snap)
}

fn schema(what: String) -> FeedError {
    FeedError::new(
        FeedCause::Schema,
        format!("{what} (ExternalFeedsRequestConfig, 14 §11.2)"),
    )
}

fn unsupported(feed: &str, why: &str) -> FeedError {
    FeedError::new(
        FeedCause::UnsupportedFeed,
        format!("feed {feed} is not supported: {why}"),
    )
}

fn object<'v>(v: &'v Value, at: &str) -> Result<&'v Map<String, Value>, FeedError> {
    v.as_object()
        .ok_or_else(|| schema(format!("{at} must be an object")))
}

fn only_keys(o: &Map<String, Value>, at: &str, allowed: &[&str]) -> Result<(), FeedError> {
    match o.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(k) => Err(schema(format!("unknown key {at}.{k}"))),
        None => Ok(()),
    }
}

fn opt_bool(o: &Map<String, Value>, key: &str, at: &str) -> Result<bool, FeedError> {
    match o.get(key) {
        None => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(schema(format!("{at}.{key} must be a boolean"))),
    }
}

fn opt_string(o: &Map<String, Value>, key: &str, at: &str) -> Result<Option<String>, FeedError> {
    match o.get(key) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(schema(format!("{at}.{key} must be a string"))),
    }
}

fn opt_strings(o: &Map<String, Value>, key: &str, at: &str) -> Result<Vec<String>, FeedError> {
    match o.get(key) {
        None => Ok(Vec::new()),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| {
                x.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| schema(format!("{at}.{key} must hold strings")))
            })
            .collect(),
        Some(_) => Err(schema(format!("{at}.{key} must be an array"))),
    }
}

impl FeedRequest {
    /// `describe.requiredFeeds` (14 §11.2, 30 §10, 20 §5): the TS
    /// `ExternalFeedsRequestConfig`
    /// (`src/strategy/plugins/ExternalFeedsRequestPlugin.ts:5-35`), or JSON
    /// `null` when nothing is requested.
    ///
    /// - Binance spot: `binanceWsSpotPrice: {symbol?, tickOnUpdate?}`;
    /// - Chainlink: `rtdsCryptoPrices: {chainlinkSymbols?: [symbol],
    ///   tickOnUpdate?}` (one symbol, F-38);
    /// - price to beat: `polymarketPriceToBeat: {enabled: true}`.
    ///
    /// The canonical form omits an absent symbol and `tickOnUpdate: false`,
    /// so equal requests render byte-equal (21 C3, 41 §3.5).
    pub fn to_ts_request_config(&self) -> Value {
        if self.is_empty() {
            return Value::Null;
        }
        let mut out = Map::new();
        if let Some(o) = &self.binance_spot {
            let mut b = Map::new();
            if let Some(s) = &o.symbol {
                b.insert("symbol".into(), Value::from(s.as_str()));
            }
            if o.tick_on_update {
                b.insert("tickOnUpdate".into(), Value::Bool(true));
            }
            out.insert("binanceWsSpotPrice".into(), Value::Object(b));
        }
        if let Some(o) = &self.chainlink {
            let mut c = Map::new();
            if let Some(s) = &o.symbol {
                c.insert(
                    "chainlinkSymbols".into(),
                    Value::Array(vec![Value::from(s.as_str())]),
                );
            }
            if o.tick_on_update {
                c.insert("tickOnUpdate".into(), Value::Bool(true));
            }
            out.insert("rtdsCryptoPrices".into(), Value::Object(c));
        }
        if self.price_to_beat {
            let mut p = Map::new();
            p.insert("enabled".into(), Value::Bool(true));
            out.insert("polymarketPriceToBeat".into(), Value::Object(p));
        }
        Value::Object(out)
    }

    /// Decodes a TS `ExternalFeedsRequestConfig` into the v1 request, the
    /// inverse of [`to_ts_request_config`](Self::to_ts_request_config).
    /// This is where 14 §10 `invalid_input: unsupported_feed` is raised: the
    /// V4-only feeds (`binanceBookTicker`, `chainlinkTwap`,
    /// `polymarketPriceToBeat.source: chainlink-opening-twap`; 14 §7.4, D43),
    /// legacy RTDS Binance (`rtdsCryptoPrices.binanceSymbols`) and more than
    /// one Chainlink symbol (F-38). Unknown keys and mistyped values are
    /// `invalid_input: schema` (00 R14). Symbols are kept as written; the
    /// loader checks them against the market (F-49).
    // D-PENDING: legacy RTDS Binance on historical inputs (TS warns and keeps
    // the key absent, 14 §1); chose unsupported_feed like V4, since the v1
    // request type cannot express it.
    pub fn from_ts_request_config(v: &Value) -> Result<FeedRequest, FeedError> {
        if v.is_null() {
            return Ok(FeedRequest::default());
        }
        let o = object(v, "requiredFeeds")?;
        only_keys(
            o,
            "requiredFeeds",
            &[
                "binanceWsSpotPrice",
                "rtdsCryptoPrices",
                "polymarketPriceToBeat",
                "binanceBookTicker",
                "chainlinkTwap",
            ],
        )?;
        for k in ["binanceBookTicker", "chainlinkTwap"] {
            if o.contains_key(k) {
                return Err(unsupported(
                    k,
                    "V4-only capability, not offered in v1 (14 §7.4, D43)",
                ));
            }
        }
        let mut req = FeedRequest::default();
        if let Some(b) = o.get("binanceWsSpotPrice") {
            let at = "binanceWsSpotPrice";
            let b = object(b, at)?;
            only_keys(b, at, &["symbol", "tickOnUpdate"])?;
            req.binance_spot = Some(FeedOptions {
                symbol: opt_string(b, "symbol", at)?,
                tick_on_update: opt_bool(b, "tickOnUpdate", at)?,
            });
        }
        if let Some(r) = o.get("rtdsCryptoPrices") {
            let at = "rtdsCryptoPrices";
            let r = object(r, at)?;
            only_keys(
                r,
                at,
                &["binanceSymbols", "chainlinkSymbols", "tickOnUpdate"],
            )?;
            if !opt_strings(r, "binanceSymbols", at)?.is_empty() {
                return Err(unsupported(
                    "rtdsPolymarketCryptoPrices.binance",
                    "legacy RTDS Binance has no source; use binanceWsSpotPrice (14 §1, §10)",
                ));
            }
            let mut symbols = opt_strings(r, "chainlinkSymbols", at)?;
            if symbols.len() > 1 {
                return Err(unsupported(
                    "rtdsPolymarketCryptoPrices.chainlink",
                    "exactly one Chainlink symbol may be requested (14 F-38)",
                ));
            }
            req.chainlink = Some(FeedOptions {
                symbol: symbols.pop(),
                tick_on_update: opt_bool(r, "tickOnUpdate", at)?,
            });
        }
        if let Some(p) = o.get("polymarketPriceToBeat") {
            let at = "polymarketPriceToBeat";
            let p = object(p, at)?;
            only_keys(p, at, &["enabled", "source"])?;
            match opt_string(p, "source", at)?.as_deref() {
                None | Some("website") => {}
                Some("chainlink-opening-twap") => {
                    return Err(unsupported(
                        "polymarketPriceToBeat.source=chainlink-opening-twap",
                        "V4-only capability, not offered in v1 (14 §7.4, D43)",
                    ))
                }
                Some(s) => return Err(schema(format!("unknown {at}.source {s:?}"))),
            }
            req.price_to_beat = opt_bool(p, "enabled", at)?;
        }
        Ok(req)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(symbol: Option<&str>, tick: bool) -> Option<FeedOptions> {
        Some(FeedOptions {
            symbol: symbol.map(str::to_owned),
            tick_on_update: tick,
        })
    }

    // spec: 14 §11.2 ("historical inputs always emit
    // rtdsPolymarketCryptoPrices: {}"; unrequested or invisible keys absent)
    #[test]
    fn empty_snapshot_keeps_the_rtds_object() {
        let v = historical_snapshot(&MarketFeeds::empty(), &FeedsView::EMPTY);
        assert_eq!(v, json!({"rtdsPolymarketCryptoPrices": {}}));
    }

    // spec: 14 §11.2 row "Feed request" (30 §10 builder table, 20 §5
    // example `{"binanceWsSpotPrice": {}, "polymarketPriceToBeat":
    // {"enabled": true}}`)
    #[test]
    fn request_config_shape() {
        assert_eq!(FeedRequest::default().to_ts_request_config(), Value::Null);
        let r = FeedRequest {
            binance_spot: opts(None, false),
            chainlink: None,
            price_to_beat: true,
        };
        assert_eq!(
            r.to_ts_request_config(),
            json!({"binanceWsSpotPrice": {}, "polymarketPriceToBeat": {"enabled": true}})
        );
        let r = FeedRequest {
            binance_spot: opts(Some("btcusdt"), true),
            chainlink: opts(Some("btc/usd"), true),
            price_to_beat: false,
        };
        let v = r.to_ts_request_config();
        assert_eq!(
            v,
            json!({
                "binanceWsSpotPrice": {"symbol": "btcusdt", "tickOnUpdate": true},
                "rtdsCryptoPrices": {"chainlinkSymbols": ["btc/usd"], "tickOnUpdate": true}
            })
        );
        assert_eq!(FeedRequest::from_ts_request_config(&v).unwrap(), r);
        let r = FeedRequest {
            binance_spot: None,
            chainlink: opts(None, false),
            price_to_beat: false,
        };
        assert_eq!(r.to_ts_request_config(), json!({"rtdsCryptoPrices": {}}));
    }

    // spec: 14 §11.2 (round trip), §10 row "Any V4-only feed request (v1,
    // §7.4); legacy RTDS Binance on V4 | invalid_input (unsupported_feed) |
    // feed", F-38 (one Chainlink symbol), 00 R14 (unknown keys)
    #[test]
    fn request_config_decoding() {
        let round_trip = |v: Value| {
            let r = FeedRequest::from_ts_request_config(&v).unwrap();
            assert_eq!(
                FeedRequest::from_ts_request_config(&r.to_ts_request_config()).unwrap(),
                r
            );
            r
        };
        assert!(round_trip(Value::Null).is_empty());
        let r = round_trip(json!({
            "binanceWsSpotPrice": {"tickOnUpdate": false},
            "rtdsCryptoPrices": {"chainlinkSymbols": [], "binanceSymbols": []},
            "polymarketPriceToBeat": {"enabled": true, "source": "website"}
        }));
        assert_eq!(r.binance_spot, opts(None, false));
        assert_eq!(r.chainlink, opts(None, false));
        assert!(r.price_to_beat);
        // An explicitly disabled price to beat is not requested.
        assert!(round_trip(json!({"polymarketPriceToBeat": {"enabled": false}})).is_empty());

        let err = |v: Value| FeedRequest::from_ts_request_config(&v).unwrap_err();
        for (v, feed) in [
            (json!({"binanceBookTicker": {}}), "binanceBookTicker"),
            (
                json!({"chainlinkTwap": {"windowSeconds": 60}}),
                "chainlinkTwap",
            ),
            (
                json!({"polymarketPriceToBeat": {"enabled": true, "source": "chainlink-opening-twap"}}),
                "chainlink-opening-twap",
            ),
            (
                json!({"rtdsCryptoPrices": {"binanceSymbols": ["btcusdt"]}}),
                "rtdsPolymarketCryptoPrices.binance",
            ),
            (
                json!({"rtdsCryptoPrices": {"chainlinkSymbols": ["btc/usd", "eth/usd"]}}),
                "rtdsPolymarketCryptoPrices.chainlink",
            ),
        ] {
            let e = err(v);
            assert_eq!(
                (e.class().as_str(), e.cause.as_str()),
                ("invalid_input", "unsupported_feed"),
                "{e}"
            );
            assert!(e.message.contains(feed), "{e}");
        }
        for v in [
            json!([]),
            json!({"deribitVolatilityIndex": {}}),
            json!({"binanceWsSpotPrice": {"symbol": 1}}),
            json!({"binanceWsSpotPrice": {"pair": "BTCUSDT"}}),
            json!({"rtdsCryptoPrices": {"tickOnUpdate": "yes"}}),
            json!({"polymarketPriceToBeat": {"source": "gamma"}}),
        ] {
            assert_eq!(err(v.clone()).cause, FeedCause::Schema, "{v}");
        }
    }
}
