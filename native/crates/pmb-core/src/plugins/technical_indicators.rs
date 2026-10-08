//! Technical indicators on Binance klines (port of
//! `TechnicalIndicatorsPlugin`): computed once per market, from the candles
//! that closed before the 15m window opened.
//!
//! The TypeScript plugin fetches klines asynchronously and the snapshot
//! appears at a wall-clock-dependent tick (or after the first tick with
//! `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1`). Here the computation is
//! synchronous on the first real tick, i.e. always the "wait" behavior.
//! Candles come from an injected [`CandleSource`]; the core does no I/O.
//!
//! Indicator definitions follow the `technicalindicators` npm package:
//! ATR = Wilder EMA (SMA seed) of true range; ADX = Wilder EMA of DX where
//! +DM/-DM/TR are Wilder sums; Bollinger = SMA ± k·population SD; realized
//! volatility = population SD of the last `period` log returns.

use crate::model::TsMs;
use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    pub open_time: TsMs,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub close_time: TsMs,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KlineInterval {
    #[serde(rename = "1h")]
    H1,
    #[serde(rename = "15m")]
    M15,
}

/// Historical klines (Binance `/api/v3/klines` semantics: up to `limit`
/// candles whose open time is <= `end_time_ms`, ascending by open time,
/// de-duplicated).
pub trait CandleSource: Send + Sync {
    fn klines(
        &self,
        symbol: &str,
        interval: KlineInterval,
        end_time_ms: TsMs,
        limit: usize,
    ) -> anyhow::Result<Vec<Candle>>;
}

/// In-memory candles (tests, or klines pre-fetched by the producer).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCandleSource {
    pub h1: Vec<Candle>,
    pub m15: Vec<Candle>,
}

impl CandleSource for MemoryCandleSource {
    fn klines(
        &self,
        _symbol: &str,
        interval: KlineInterval,
        end_time_ms: TsMs,
        limit: usize,
    ) -> anyhow::Result<Vec<Candle>> {
        let all = match interval {
            KlineInterval::H1 => &self.h1,
            KlineInterval::M15 => &self.m15,
        };
        let upto: Vec<Candle> = all
            .iter()
            .filter(|c| c.open_time <= end_time_ms)
            .copied()
            .collect();
        Ok(upto[upto.len().saturating_sub(limit)..].to_vec())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TechnicalIndicatorsConfig {
    #[serde(default = "default_binance_symbol")]
    pub binance_symbol: String,
    /// Slug prefix the market must have (`<sym>-updown-15m-<epochSec>`).
    #[serde(default = "default_slug_symbol")]
    pub slug_symbol: String,
}

fn default_binance_symbol() -> String {
    "BTCUSDT".to_owned()
}
fn default_slug_symbol() -> String {
    "btc".to_owned()
}

impl Default for TechnicalIndicatorsConfig {
    fn default() -> Self {
        Self {
            binance_symbol: default_binance_symbol(),
            slug_symbol: default_slug_symbol(),
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Session {
    Asia,
    Eu,
    Us,
}

impl Session {
    fn from_hour_utc(h: u32) -> Session {
        match h {
            0..=7 => Session::Asia,
            8..=15 => Session::Eu,
            _ => Session::Us,
        }
    }
}

#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tf1h {
    pub atr14_pct: Option<f64>,
    pub bb_width: Option<f64>,
    pub adx14: Option<f64>,
    pub hl_range_pct: Option<f64>,
    pub wick_ratio: Option<f64>,
    pub rv20: Option<f64>,
    pub rv80: Option<f64>,
    pub rv20_over80: Option<f64>,
}

#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tf15m {
    pub hl_range_pct: Option<f64>,
    pub wick_ratio: Option<f64>,
    pub atr14_pct: Option<f64>,
    pub rv20: Option<f64>,
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TaMeta {
    pub session: Session,
    #[serde(rename = "hourOfDayUTC")]
    pub hour_of_day_utc: u32,
    /// 0 = Sunday.
    #[serde(rename = "dayOfWeekUTC")]
    pub day_of_week_utc: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TechnicalIndicatorsSnapshot {
    /// Window open (slug epoch) in ms.
    pub as_of_time_ms: TsMs,
    pub symbol: String,
    pub tf1h: Tf1h,
    pub tf15m: Tf15m,
    pub meta: TaMeta,
}

const PERIOD_BB: usize = 20;
const PERIOD_ATR: usize = 14;
const PERIOD_ADX: usize = 14;
const PERIOD_RV_FAST: usize = 20;
const PERIOD_RV_SLOW: usize = 80;
const PERIOD_15M_RV: usize = 20;
const LOOKBACK_MULT: usize = 2;
const LOOKBACK_1H: usize = PERIOD_RV_SLOW * LOOKBACK_MULT; // max 1h period * 2
const LOOKBACK_15M: usize = PERIOD_15M_RV * LOOKBACK_MULT; // max 15m period * 2
const FETCH_BUFFER: usize = 10;
const EPS: f64 = 1e-12;

/// `<sym>-updown-15m-<epochSeconds>` → window open in ms.
fn slug_epoch_ms(slug: &str, sym: &str) -> Option<TsMs> {
    let slug = slug.trim().to_ascii_lowercase();
    let prefix = format!("{}-updown-15m-", sym.trim().to_ascii_lowercase());
    let digits = slug.strip_prefix(&prefix)?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let secs: i64 = digits.parse().ok()?;
    (secs > 0).then(|| secs * 1000)
}

/// True range series (one shorter than the input: the first candle only seeds
/// the previous close).
fn true_ranges(c: &[Candle]) -> Vec<f64> {
    c.windows(2)
        .map(|w| {
            let (prev, cur) = (w[0], w[1]);
            (cur.high - cur.low)
                .max((cur.high - prev.close).abs())
                .max((cur.low - prev.close).abs())
        })
        .collect()
}

/// Wilder EMA (alpha = 1/period) seeded with the SMA of the first `period`
/// values; returns the last value.
fn wilder_ema_last(values: &[f64], period: usize) -> Option<f64> {
    if period == 0 || values.len() < period {
        return None;
    }
    let mut ema = values[..period].iter().sum::<f64>() / period as f64;
    let k = 1.0 / period as f64;
    for v in &values[period..] {
        ema += (v - ema) * k;
    }
    Some(ema)
}

fn atr_last(c: &[Candle], period: usize) -> Option<f64> {
    wilder_ema_last(&true_ranges(c), period)
}

fn adx_last(c: &[Candle], period: usize) -> Option<f64> {
    let tr = true_ranges(c);
    let (pdm, mdm): (Vec<f64>, Vec<f64>) = c
        .windows(2)
        .map(|w| {
            let up = w[1].high - w[0].high;
            let down = w[0].low - w[1].low;
            (
                if up > down && up > 0.0 { up } else { 0.0 },
                if down > up && down > 0.0 { down } else { 0.0 },
            )
        })
        .unzip();
    if tr.len() < period || period == 0 {
        return None;
    }
    // Wilder sums: first value = sum of the first `period`, then s - s/p + x.
    let p = period as f64;
    let mut s_tr: f64 = tr[..period].iter().sum();
    let mut s_pdm: f64 = pdm[..period].iter().sum();
    let mut s_mdm: f64 = mdm[..period].iter().sum();
    let dx = |s_tr: f64, s_pdm: f64, s_mdm: f64| {
        let pdi = s_pdm * 100.0 / s_tr;
        let mdi = s_mdm * 100.0 / s_tr;
        (pdi - mdi).abs() / (pdi + mdi) * 100.0
    };
    let mut dxs = Vec::with_capacity(tr.len() - period + 1);
    dxs.push(dx(s_tr, s_pdm, s_mdm));
    for i in period..tr.len() {
        s_tr = s_tr - s_tr / p + tr[i];
        s_pdm = s_pdm - s_pdm / p + pdm[i];
        s_mdm = s_mdm - s_mdm / p + mdm[i];
        dxs.push(dx(s_tr, s_pdm, s_mdm));
    }
    wilder_ema_last(&dxs, period)
}

/// (mean, population standard deviation) of the last `period` values.
fn mean_sd_last(values: &[f64], period: usize) -> Option<(f64, f64)> {
    if period == 0 || values.len() < period {
        return None;
    }
    let w = &values[values.len() - period..];
    let mean = w.iter().sum::<f64>() / period as f64;
    let var = w.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / period as f64;
    Some((mean, var.sqrt()))
}

fn realized_vol(closes: &[f64], period: usize) -> Option<f64> {
    if closes.len() < period + 1 {
        return None;
    }
    let mut returns = Vec::with_capacity(closes.len() - 1);
    for w in closes.windows(2) {
        let (a, b) = (w[0], w[1]);
        if !(a > 0.0 && b > 0.0) {
            return None;
        }
        returns.push((b / a).ln());
    }
    mean_sd_last(&returns, period)
        .map(|(_, sd)| sd)
        .filter(|v| v.is_finite())
}

fn pct_of_last_close(v: Option<f64>, last_close: Option<f64>) -> Option<f64> {
    match (v, last_close) {
        (Some(v), Some(c)) if c.is_finite() && c > 0.0 => Some(v / c),
        _ => None,
    }
}

fn hl_range_pct(c: &Candle) -> Option<f64> {
    (c.low > 0.0).then(|| (c.high - c.low) / c.low)
}

fn wick_ratio(c: &Candle) -> f64 {
    let body = (c.close - c.open).abs();
    let upper = c.high - c.open.max(c.close);
    let lower = c.open.min(c.close) - c.low;
    (upper + lower) / body.max(EPS)
}

pub(crate) fn compute_1h(candles: &[Candle]) -> Tf1h {
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    let last_close = closes.last().copied();
    let bb_width = mean_sd_last(&closes, PERIOD_BB).and_then(|(mid, sd)| {
        // upper - lower = 4·sd (stdDev multiplier 2)
        (mid != 0.0).then(|| ((mid + 2.0 * sd) - (mid - 2.0 * sd)) / mid)
    });
    let rv20 = realized_vol(&closes, PERIOD_RV_FAST);
    let rv80 = realized_vol(&closes, PERIOD_RV_SLOW);
    Tf1h {
        atr14_pct: pct_of_last_close(atr_last(candles, PERIOD_ATR), last_close),
        bb_width,
        adx14: adx_last(candles, PERIOD_ADX),
        hl_range_pct: candles.last().and_then(hl_range_pct),
        wick_ratio: candles.last().map(wick_ratio),
        rv20,
        rv80,
        rv20_over80: match (rv20, rv80) {
            (Some(a), Some(b)) if b != 0.0 => Some(a / b),
            _ => None,
        },
    }
}

pub(crate) fn compute_15m(candles: &[Candle]) -> Tf15m {
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    Tf15m {
        hl_range_pct: candles.last().and_then(hl_range_pct),
        wick_ratio: candles.last().map(wick_ratio),
        atr14_pct: pct_of_last_close(atr_last(candles, PERIOD_ATR), closes.last().copied()),
        rv20: realized_vol(&closes, PERIOD_15M_RV),
    }
}

/// Candles closed at or before `as_of_ms`, last `lookback` of them; None if too few.
fn closed_window(
    raw: Vec<Candle>,
    as_of_ms: TsMs,
    lookback: usize,
    label: &str,
    slug: &str,
) -> Option<Vec<Candle>> {
    let closed: Vec<Candle> = raw.into_iter().filter(|c| c.close_time <= as_of_ms).collect();
    if closed.len() < lookback {
        eprintln!(
            "[technicalIndicators] not enough {label} candles: have={} need={lookback} slug={slug}",
            closed.len()
        );
        return None;
    }
    Some(closed[closed.len() - lookback..].to_vec())
}

/// Computes the snapshot for one market slug (None on unsupported slug,
/// missing / misaligned candles or a source error — logged to stderr).
pub(crate) fn compute_snapshot(
    cfg: &TechnicalIndicatorsConfig,
    source: &dyn CandleSource,
    slug: &str,
) -> Option<TechnicalIndicatorsSnapshot> {
    let Some(t0) = slug_epoch_ms(slug, &cfg.slug_symbol) else {
        eprintln!("[technicalIndicators] unsupported slug, skipping: {slug}");
        return None;
    };
    let as_of = t0 - 1;
    let fetch = |interval, limit| match source.klines(&cfg.binance_symbol, interval, as_of, limit) {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("[technicalIndicators] failed to fetch klines for slug={slug}: {e:#}");
            None
        }
    };
    let raw_1h = fetch(KlineInterval::H1, LOOKBACK_1H + FETCH_BUFFER)?;
    let raw_15m = fetch(KlineInterval::M15, LOOKBACK_15M + FETCH_BUFFER)?;
    let c1h = closed_window(raw_1h, as_of, LOOKBACK_1H, "1h", slug)?;
    let c15m = closed_window(raw_15m, as_of, LOOKBACK_15M, "15m", slug)?;
    let last_close = c15m.last().map(|c| c.close_time);
    if last_close != Some(t0 - 1) {
        eprintln!(
            "[technicalIndicators] 15m misalignment: lastClose={last_close:?} expected={} slug={slug}",
            t0 - 1
        );
        return None;
    }
    const DAY_MS: i64 = 86_400_000;
    let hour = (t0.rem_euclid(DAY_MS) / 3_600_000) as u32;
    // 1970-01-01 was a Thursday (4, with Sunday = 0).
    let dow = (t0.div_euclid(DAY_MS) + 4).rem_euclid(7) as u32;
    Some(TechnicalIndicatorsSnapshot {
        as_of_time_ms: t0,
        symbol: cfg.binance_symbol.clone(),
        tf1h: compute_1h(&c1h),
        tf15m: compute_15m(&c15m),
        meta: TaMeta {
            session: Session::from_hour_utc(hour),
            hour_of_day_utc: hour,
            day_of_week_utc: dow,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_parsing() {
        assert_eq!(slug_epoch_ms("btc-updown-15m-1760140800", "btc"), Some(1_760_140_800_000));
        assert_eq!(slug_epoch_ms("BTC-updown-15m-1760140800", "btc"), Some(1_760_140_800_000));
        assert_eq!(slug_epoch_ms("btc-updown-5m-1760140800", "btc"), None);
        assert_eq!(slug_epoch_ms("eth-updown-15m-1760140800", "btc"), None);
        assert_eq!(slug_epoch_ms("btc-updown-15m-", "btc"), None);
        assert_eq!(slug_epoch_ms("btc-updown-15m-12a", "btc"), None);
    }

    #[test]
    fn session_and_calendar() {
        assert_eq!(Session::from_hour_utc(7), Session::Asia);
        assert_eq!(Session::from_hour_utc(8), Session::Eu);
        assert_eq!(Session::from_hour_utc(16), Session::Us);
    }
}
