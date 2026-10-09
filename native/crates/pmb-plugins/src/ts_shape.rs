//! TS-shape JSON of plugin snapshots, produced only at the boundary: parity
//! trace, `describe`, live WebUI (14 F-5, §11.2). Keys are the TS plugin ids
//! and field names; absent plugins and unavailable TA are omitted, as in TS
//! (`src/strategy/plugins/PluginSet.ts:90-101`; 14 P-7). Volatility is keyed
//! by token id (TS `byAssetId`).

use crate::dwell_gate::{DwellGateSnapshot, DwellSide};
use crate::technical_indicators::{TaOutput, TechnicalIndicatorsSnapshot};
use crate::time_window_gate::TimeWindowGateSnapshot;
use crate::volatility::{VolatilitySnapshot, WindowStats};
use crate::{PluginId, PluginsView};
use pmb_core::{Outcome, PerOutcome, Price, TsMs};
use serde_json::{Map, Value};

/// Serializes a fixed-point price as a JSON number (TS `number`).
pub(crate) fn ser_price<S: serde::Serializer>(p: &Price, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_f64(p.to_f64_lossy())
}

fn num(v: f64) -> Value {
    serde_json::Number::from_f64(v).map_or(Value::Null, Value::Number)
}

fn opt_num(v: Option<f64>) -> Value {
    v.map_or(Value::Null, num)
}

fn opt_i64(v: Option<i64>) -> Value {
    v.map_or(Value::Null, Value::from)
}

fn opt_ts(v: Option<TsMs>) -> Value {
    opt_i64(v.map(|t| t.0))
}

fn window_json(w: &WindowStats) -> Value {
    let mut m = Map::new();
    m.insert("windowMs".into(), w.window_ms.into());
    m.insert("n".into(), (w.n as u64).into());
    m.insert("startTsMs".into(), opt_ts(w.start_ts));
    m.insert("endTsMs".into(), opt_ts(w.end_ts));
    m.insert("coverageMs".into(), opt_i64(w.coverage_ms));
    m.insert("ready".into(), w.ready.into());
    m.insert("staleMs".into(), opt_i64(w.stale_ms));
    m.insert("startPrice".into(), opt_num(w.start_price));
    m.insert("endPrice".into(), opt_num(w.end_price));
    m.insert("netChange".into(), opt_num(w.net_change));
    m.insert("low".into(), opt_num(w.low));
    m.insert("high".into(), opt_num(w.high));
    m.insert("stddev".into(), opt_num(w.stddev));
    m.insert("highLowRange".into(), opt_num(w.high_low_range));
    m.insert("avgAbsChange".into(), opt_num(w.avg_abs_change));
    Value::Object(m)
}

/// TS `VolatilitySnapshot`.
pub fn volatility_json(s: &VolatilitySnapshot, tokens: &PerOutcome<&str>) -> Value {
    let mut by_asset = Map::new();
    for o in Outcome::ALL {
        if let Some(ws) = s.windows(o) {
            let mut per = Map::new();
            for (label, w) in s.labels().zip(ws) {
                per.insert(label.to_owned(), window_json(w));
            }
            by_asset.insert(tokens[o].to_owned(), Value::Object(per));
        }
    }
    let mut m = Map::new();
    m.insert("asOfTsMs".into(), opt_ts(s.as_of_ts()));
    m.insert("byAssetId".into(), Value::Object(by_asset));
    Value::Object(m)
}

fn dwell_side_json(s: &DwellSide) -> Value {
    let mut m = Map::new();
    m.insert("inRange".into(), s.in_range.into());
    m.insert("elapsedInRangeMs".into(), opt_i64(s.elapsed_in_range_ms));
    m.insert("remainingMs".into(), opt_i64(s.remaining_ms));
    Value::Object(m)
}

/// TS `DwellGateSnapshot`.
pub fn dwell_gate_json(s: &DwellGateSnapshot) -> Value {
    let c = &s.config;
    let mut m = Map::new();
    m.insert("from".into(), num(c.from.to_f64_lossy()));
    m.insert("to".into(), num(c.to.to_f64_lossy()));
    m.insert("requiredMs".into(), c.required_ms.into());
    m.insert(
        "trackPrice".into(),
        match c.track_price {
            crate::BidOrAsk::Bid => "bid",
            crate::BidOrAsk::Ask => "ask",
        }
        .into(),
    );
    m.insert("dwellUpOk".into(), s.ok(Outcome::Up).into());
    m.insert("dwellDownOk".into(), s.ok(Outcome::Down).into());
    m.insert("up".into(), dwell_side_json(s.side(Outcome::Up)));
    m.insert("down".into(), dwell_side_json(s.side(Outcome::Down)));
    Value::Object(m)
}

/// TS `TimeWindowGateSnapshot`.
pub fn time_window_gate_json(s: &TimeWindowGateSnapshot) -> Value {
    let mut m = Map::new();
    m.insert("allowAfterMs".into(), s.config.allow_after_ms.into());
    m.insert("disableAfterMs".into(), s.config.disable_after_ms.into());
    m.insert("withinWindow".into(), s.within_window.into());
    m.insert("startMs".into(), opt_ts(s.start_ms));
    m.insert("nowMs".into(), opt_ts(s.now_ms));
    m.insert("elapsedMs".into(), opt_i64(s.elapsed_ms));
    Value::Object(m)
}

/// TS `TechnicalIndicatorsSnapshot`.
pub fn technical_indicators_json(s: &TechnicalIndicatorsSnapshot) -> Value {
    let h = &s.tf1h;
    let mut tf1h = Map::new();
    tf1h.insert("atr14Pct".into(), opt_num(h.atr14_pct));
    tf1h.insert("bbWidth".into(), opt_num(h.bb_width));
    tf1h.insert("adx14".into(), opt_num(h.adx14));
    tf1h.insert("hlRangePct".into(), opt_num(h.hl_range_pct));
    tf1h.insert("wickRatio".into(), opt_num(h.wick_ratio));
    tf1h.insert("rv20".into(), opt_num(h.rv20));
    tf1h.insert("rv80".into(), opt_num(h.rv80));
    tf1h.insert("rv20Over80".into(), opt_num(h.rv20_over80));
    let q = &s.tf15m;
    let mut tf15m = Map::new();
    tf15m.insert("hlRangePct".into(), opt_num(q.hl_range_pct));
    tf15m.insert("wickRatio".into(), opt_num(q.wick_ratio));
    tf15m.insert("atr14Pct".into(), opt_num(q.atr14_pct));
    tf15m.insert("rv20".into(), opt_num(q.rv20));
    let mut meta = Map::new();
    meta.insert("session".into(), s.meta.session.as_str().into());
    meta.insert("hourOfDayUTC".into(), s.meta.hour_of_day_utc.into());
    meta.insert("dayOfWeekUTC".into(), s.meta.day_of_week_utc.into());
    let mut m = Map::new();
    m.insert("asOfTimeMs".into(), s.as_of_time_ms.0.into());
    m.insert("symbol".into(), s.symbol.into());
    m.insert("tf1h".into(), Value::Object(tf1h));
    m.insert("tf15m".into(), Value::Object(tf15m));
    m.insert("meta".into(), Value::Object(meta));
    Value::Object(m)
}

/// One plugin's TS-shape value; `None` when the key is absent in TS
/// (unrequested plugin, unavailable TA).
pub fn plugin_json(
    view: PluginsView<'_>,
    id: PluginId,
    tokens: &PerOutcome<&str>,
) -> Option<Value> {
    match id {
        PluginId::TimeWindowVolatility => view
            .time_window_volatility()
            .map(|s| volatility_json(s, tokens)),
        PluginId::TechnicalIndicators => view
            .technical_indicators()
            .and_then(TaOutput::ready)
            .map(technical_indicators_json),
        PluginId::DwellGate => view.dwell_gate().map(dwell_gate_json),
        PluginId::TimeWindowGate => view.time_window_gate().map(time_window_gate_json),
    }
}

/// The TS `ctx.plugins` object (without `externalFeeds`, which is the feed
/// view in Rust, 14 P-4).
pub fn plugins_json(view: PluginsView<'_>, tokens: &PerOutcome<&str>) -> Value {
    let mut m = Map::new();
    for id in PluginId::ALL {
        if let Some(v) = plugin_json(view, id, tokens) {
            m.insert(id.as_str().to_owned(), v);
        }
    }
    Value::Object(m)
}
