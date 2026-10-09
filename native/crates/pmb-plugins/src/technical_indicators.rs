//! TechnicalIndicators (14 §12.2, §12.5): BTCUSDT 1h and 15m indicators as of
//! the market start, from candles built offline from local aggTrades
//! ([`crate::candles`], D19). Oracle for the math:
//! `src/strategy/plugins/TechnicalIndicatorsPlugin.ts:37-66,215-300` with the
//! `technicalindicators` npm package (3.1.0): Wilder ATR with SMA seed, ADX
//! via Wilder sums, population-SD Bollinger width, realized volatility as the
//! population SD of log returns. Math salvaged from the WIP
//! (`technical_indicators.rs:192-405`) with `ln` from the pure-Rust `libm`
//! (14 P-2).
//!
//! The snapshot is computed synchronously at market start, i.e. before the
//! first strategy callback (14 P-10), and never changes during the market.
//! It observes no synthetic ticks (14 §12.2).

use crate::candles::{Candle, CandleInterval};
use crate::{Plugin, PluginError, PluginId, PluginMarket, PluginTick};
use pmb_core::market::{Symbol, Timeframe};
use pmb_core::TsMs;
use serde::Serialize;

/// The Binance pair TA reads (TS `BINANCE_SYMBOL`, 14 §12.2).
pub const TA_SYMBOL: &str = "BTCUSDT";
/// Closed 1h candles used (2 x the longest 1h period, 14 P-9).
pub const TA_LOOKBACK_1H: usize = 160;
/// Closed 15m candles used (2 x the longest 15m period, 14 P-9).
pub const TA_LOOKBACK_15M: usize = 40;

const PERIOD_BB: usize = 20;
const PERIOD_ATR: usize = 14;
const PERIOD_ADX: usize = 14;
const PERIOD_RV_FAST: usize = 20;
const PERIOD_RV_SLOW: usize = 80;
const PERIOD_15M_RV: usize = 20;
const EPS: f64 = 1e-12;
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 86_400_000;

/// Config: none in v1 (BTCUSDT, 14 §12.2).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct TechnicalIndicatorsConfig {}

/// aggTrades range `[floorHour(t0) - 160 h, t0)` whose candles TA needs
/// (14 P-12); `describe` exports it for the producer preflight.
pub fn ta_trades_range(t0: TsMs) -> (TsMs, TsMs) {
    let floor_hour = t0.0.div_euclid(HOUR_MS) * HOUR_MS;
    (TsMs(floor_hour - TA_LOOKBACK_1H as i64 * HOUR_MS), t0)
}

/// Candles handed to TA at market start, ascending by open time.
#[derive(Copy, Clone, Debug)]
pub struct TaInput<'a> {
    pub h1: &'a [Candle],
    pub m15: &'a [Candle],
}

/// Trading session of the market start hour (TS `sessionFromHourUTC`).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Session {
    Asia,
    Eu,
    Us,
}

impl Session {
    pub const fn from_hour_utc(h: u32) -> Session {
        match h {
            0..=7 => Session::Asia,
            8..=15 => Session::Eu,
            _ => Session::Us,
        }
    }

    /// TS label.
    pub const fn as_str(self) -> &'static str {
        match self {
            Session::Asia => "ASIA",
            Session::Eu => "EU",
            Session::Us => "US",
        }
    }
}

/// 1h indicators (TS `tf1h`).
#[derive(Copy, Clone, Debug, Default, PartialEq)]
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

/// 15m indicators (TS `tf15m`).
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Tf15m {
    pub hl_range_pct: Option<f64>,
    pub wick_ratio: Option<f64>,
    pub atr14_pct: Option<f64>,
    pub rv20: Option<f64>,
}

/// Calendar fields of the market start (TS `meta`).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct TaMeta {
    pub session: Session,
    pub hour_of_day_utc: u32,
    /// 0 = Sunday.
    pub day_of_week_utc: u32,
}

/// Ready indicator values (TS `TechnicalIndicatorsSnapshot`).
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct TechnicalIndicatorsSnapshot {
    /// Market start (slug epoch), TS `asOfTimeMs`.
    pub as_of_time_ms: TsMs,
    pub symbol: &'static str,
    pub tf1h: Tf1h,
    pub tf15m: Tf15m,
    pub meta: TaMeta,
}

/// Why TA has no values for this market (14 P-7; TS logs these and leaves
/// the key absent).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum TaUnavailable {
    /// `start_market` has not run.
    NotStarted,
    /// Not a BTC 15m up/down market (14 P-11).
    UnsupportedMarket,
    /// Fewer closed candles than the lookback (14 P-9).
    NotEnoughCandles {
        interval: CandleInterval,
        have: usize,
        need: usize,
    },
    /// The last closed 15m candle does not close at `t0 - 1` (14 P-9).
    Misaligned15m { last_close: TsMs, expected: TsMs },
}

/// TA output: ready values or a typed reason (14 P-7).
// Computed once per market and read by reference; boxing would only add an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum TaOutput {
    Ready(TechnicalIndicatorsSnapshot),
    Unavailable(TaUnavailable),
}

impl TaOutput {
    pub fn ready(&self) -> Option<&TechnicalIndicatorsSnapshot> {
        match self {
            TaOutput::Ready(s) => Some(s),
            TaOutput::Unavailable(_) => None,
        }
    }
}

/// The plugin.
#[derive(Clone, Debug)]
pub struct TechnicalIndicators {
    out: TaOutput,
}

impl TechnicalIndicators {
    pub fn new(_cfg: &TechnicalIndicatorsConfig) -> TechnicalIndicators {
        TechnicalIndicators {
            out: TaOutput::Unavailable(TaUnavailable::NotStarted),
        }
    }

    /// Computes the market's snapshot before the first callback (14 P-10).
    pub fn start_market(
        &mut self,
        market: &PluginMarket,
        input: TaInput<'_>,
    ) -> Result<(), PluginError> {
        self.out = compute(market, input)?;
        Ok(())
    }
}

impl Plugin for TechnicalIndicators {
    const ID: PluginId = PluginId::TechnicalIndicators;
    const HANDLES_SYNTHETIC_TICKS: bool = false;
    type Snapshot = TaOutput;

    /// Ticks never change TA (computed at market start).
    fn on_tick(&mut self, _tick: &PluginTick) -> bool {
        false
    }

    fn snapshot(&self) -> &TaOutput {
        &self.out
    }
}

fn check_series(c: &[Candle], interval: CandleInterval) -> Result<(), PluginError> {
    let len = interval.ms();
    for (i, k) in c.iter().enumerate() {
        if k.close_time.0 != k.open_time.0 + len - 1 || k.open_time.0.rem_euclid(len) != 0 {
            return Err(PluginError::CandleShape { interval, index: i });
        }
        if i > 0 && c[i - 1].open_time >= k.open_time {
            return Err(PluginError::CandleOrder { interval, index: i });
        }
    }
    Ok(())
}

/// The last `need` candles closed at or before `as_of`.
fn closed_tail(
    c: &[Candle],
    as_of: TsMs,
    need: usize,
    interval: CandleInterval,
) -> Result<&[Candle], TaUnavailable> {
    let closed = &c[..c.partition_point(|k| k.close_time <= as_of)];
    if closed.len() < need {
        return Err(TaUnavailable::NotEnoughCandles {
            interval,
            have: closed.len(),
            need,
        });
    }
    Ok(&closed[closed.len() - need..])
}

/// Computes TA for a market (14 P-9, P-11). Invalid candle input is an
/// engine error; missing data is a typed unavailable state.
pub fn compute(market: &PluginMarket, input: TaInput<'_>) -> Result<TaOutput, PluginError> {
    check_series(input.h1, CandleInterval::H1)?;
    check_series(input.m15, CandleInterval::M15)?;
    if market.symbol != Symbol::Btc || market.timeframe != Timeframe::M15 {
        return Ok(TaOutput::Unavailable(TaUnavailable::UnsupportedMarket));
    }
    let t0 = market.window.start_ms;
    let as_of = TsMs(t0.0 - 1);
    let c1h = match closed_tail(input.h1, as_of, TA_LOOKBACK_1H, CandleInterval::H1) {
        Ok(c) => c,
        Err(u) => return Ok(TaOutput::Unavailable(u)),
    };
    let c15m = match closed_tail(input.m15, as_of, TA_LOOKBACK_15M, CandleInterval::M15) {
        Ok(c) => c,
        Err(u) => return Ok(TaOutput::Unavailable(u)),
    };
    let last_close = c15m[c15m.len() - 1].close_time;
    if last_close != as_of {
        return Ok(TaOutput::Unavailable(TaUnavailable::Misaligned15m {
            last_close,
            expected: as_of,
        }));
    }
    let hour = t0.0.rem_euclid(DAY_MS) / HOUR_MS;
    // 1970-01-01 was a Thursday (4 with Sunday = 0).
    let dow = (t0.0.div_euclid(DAY_MS) + 4).rem_euclid(7);
    Ok(TaOutput::Ready(TechnicalIndicatorsSnapshot {
        as_of_time_ms: t0,
        symbol: TA_SYMBOL,
        tf1h: compute_1h(c1h),
        tf15m: compute_15m(c15m),
        meta: TaMeta {
            session: Session::from_hour_utc(hour as u32),
            hour_of_day_utc: hour as u32,
            day_of_week_utc: dow as u32,
        },
    }))
}

/// True range per candle after the first (the first only seeds the previous
/// close; TS `TrueRange`).
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
/// values; the last value (TS `WEMA`).
fn wilder_ema_last(values: &[f64], period: usize) -> Option<f64> {
    if period == 0 || values.len() < period {
        return None;
    }
    let mut sum = 0.0;
    for v in &values[..period] {
        sum += v;
    }
    let mut ema = sum / period as f64;
    let k = 1.0 / period as f64;
    for v in &values[period..] {
        ema += (v - ema) * k;
    }
    Some(ema)
}

fn atr_last(c: &[Candle], period: usize) -> Option<f64> {
    wilder_ema_last(&true_ranges(c), period)
}

/// ADX: Wilder sums of TR, +DM, -DM, DX, then a Wilder EMA of DX (TS `ADX`).
fn adx_last(c: &[Candle], period: usize) -> Option<f64> {
    let tr = true_ranges(c);
    if period == 0 || tr.len() < period {
        return None;
    }
    let mut pdm = Vec::with_capacity(tr.len());
    let mut mdm = Vec::with_capacity(tr.len());
    for w in c.windows(2) {
        let up = w[1].high - w[0].high;
        let down = w[0].low - w[1].low;
        pdm.push(if up > down && up > 0.0 { up } else { 0.0 });
        mdm.push(if down > up && down > 0.0 { down } else { 0.0 });
    }
    let p = period as f64;
    let (mut s_tr, mut s_pdm, mut s_mdm) = (0.0, 0.0, 0.0);
    for i in 0..period {
        s_tr += tr[i];
        s_pdm += pdm[i];
        s_mdm += mdm[i];
    }
    let dx = |s_tr: f64, s_pdm: f64, s_mdm: f64| {
        let pdi = s_pdm * 100.0 / s_tr;
        let mdi = s_mdm * 100.0 / s_tr;
        ((pdi - mdi).abs() / (pdi + mdi)) * 100.0
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

/// (mean, population SD) of the last `period` values (TS `SD`, `SMA`).
// D-PENDING: technicalindicators SD/BollingerBands skip a window whose mean is exactly 0.0 (JS truthiness `if (mean)`) and keep the previous value; chose the plain definition (an exact zero mean of BTC closes or log returns does not occur in practice).
fn mean_sd_last(values: &[f64], period: usize) -> Option<(f64, f64)> {
    if period == 0 || values.len() < period {
        return None;
    }
    let w = &values[values.len() - period..];
    let mut sum = 0.0;
    for x in w {
        sum += x;
    }
    let mean = sum / period as f64;
    let mut sq = 0.0;
    for x in w {
        let d = x - mean;
        sq += d * d;
    }
    Some((mean, (sq / period as f64).sqrt()))
}

/// Population SD of the last `period` log returns; `None` if any close is not
/// positive (TS `realizedVolFromCloses`).
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
        returns.push(libm::log(b / a));
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

fn compute_1h(c: &[Candle]) -> Tf1h {
    let closes: Vec<f64> = c.iter().map(|k| k.close).collect();
    let last_close = closes.last().copied();
    let bb_width = mean_sd_last(&closes, PERIOD_BB).and_then(|(mid, sd)| {
        // upper - lower with the stdDev multiplier 2 (TS BollingerBands)
        (mid != 0.0).then(|| ((mid + sd * 2.0) - (mid - sd * 2.0)) / mid)
    });
    let rv20 = realized_vol(&closes, PERIOD_RV_FAST);
    let rv80 = realized_vol(&closes, PERIOD_RV_SLOW);
    Tf1h {
        atr14_pct: pct_of_last_close(atr_last(c, PERIOD_ATR), last_close),
        bb_width,
        adx14: adx_last(c, PERIOD_ADX),
        hl_range_pct: c.last().and_then(hl_range_pct),
        wick_ratio: c.last().map(wick_ratio),
        rv20,
        rv80,
        rv20_over80: match (rv20, rv80) {
            (Some(a), Some(b)) if b != 0.0 => Some(a / b),
            _ => None,
        },
    }
}

fn compute_15m(c: &[Candle]) -> Tf15m {
    let closes: Vec<f64> = c.iter().map(|k| k.close).collect();
    Tf15m {
        hl_range_pct: c.last().and_then(hl_range_pct),
        wick_ratio: c.last().map(wick_ratio),
        atr14_pct: pct_of_last_close(atr_last(c, PERIOD_ATR), closes.last().copied()),
        rv20: realized_vol(&closes, PERIOD_15M_RV),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(interval: CandleInterval, last_open: i64, n: i64) -> Vec<Candle> {
        let len = interval.ms();
        (0..n)
            .map(|i| {
                let open_time = last_open - (n - 1 - i) * len;
                let base = 100.0 + (i % 7) as f64;
                Candle {
                    open_time: TsMs(open_time),
                    close_time: TsMs(open_time + len - 1),
                    open: base,
                    high: base + 2.0,
                    low: base - 1.5,
                    close: base + 0.5,
                    volume: 1.0,
                }
            })
            .collect()
    }

    fn market(slug: &str) -> PluginMarket {
        PluginMarket::from_slug(slug).unwrap()
    }

    const T0: i64 = 1_760_140_800_000; // 2025-10-11 00:00 UTC, a Saturday

    // spec: 14 P-9 (last 160 1h and 40 15m closed candles; 15m closes at t0-1)
    #[test]
    fn ready_with_aligned_candles() {
        let h1 = series(CandleInterval::H1, T0 - HOUR_MS, 170);
        let m15 = series(CandleInterval::M15, T0 - 900_000, 50);
        let out = compute(
            &market("btc-updown-15m-1760140800"),
            TaInput { h1: &h1, m15: &m15 },
        )
        .unwrap();
        let s = out.ready().expect("ready");
        assert_eq!(s.as_of_time_ms, TsMs(T0));
        assert_eq!(s.symbol, "BTCUSDT");
        assert_eq!(s.meta.hour_of_day_utc, 0);
        assert_eq!(s.meta.day_of_week_utc, 6);
        assert_eq!(s.meta.session, Session::Asia);
        assert!(s.tf1h.adx14.is_some() && s.tf1h.rv80.is_some() && s.tf15m.rv20.is_some());
    }

    // spec: 14 P-9 (unclosed candles are ignored; too few is unavailable)
    #[test]
    fn not_enough_closed_candles() {
        // 160 1h candles, the last one still open at t0 - 1 -> 159 closed
        let h1 = series(
            CandleInterval::H1,
            T0 - 1 - (T0 - 1).rem_euclid(HOUR_MS),
            160,
        );
        let m15 = series(CandleInterval::M15, T0 - 900_000, 40);
        let m = market("btc-updown-15m-1760141700"); // t0 = T0 + 15m
        let h1b = series(CandleInterval::H1, T0, 160); // open at T0 covers t0 - 1
        let out = compute(
            &m,
            TaInput {
                h1: &h1b,
                m15: &m15,
            },
        )
        .unwrap();
        assert_eq!(
            out,
            TaOutput::Unavailable(TaUnavailable::NotEnoughCandles {
                interval: CandleInterval::H1,
                have: 159,
                need: 160
            })
        );
        let out = compute(
            &market("btc-updown-15m-1760140800"),
            TaInput {
                h1: &h1,
                m15: &m15[1..],
            },
        )
        .unwrap();
        assert_eq!(
            out,
            TaOutput::Unavailable(TaUnavailable::NotEnoughCandles {
                interval: CandleInterval::M15,
                have: 39,
                need: 40
            })
        );
    }

    // spec: 14 P-9 (misaligned 15m tail)
    #[test]
    fn misaligned_15m_is_unavailable() {
        let h1 = series(CandleInterval::H1, T0 - HOUR_MS, 200);
        let m15 = series(CandleInterval::M15, T0 - 1_800_000, 60);
        let out = compute(
            &market("btc-updown-15m-1760140800"),
            TaInput { h1: &h1, m15: &m15 },
        )
        .unwrap();
        assert_eq!(
            out,
            TaOutput::Unavailable(TaUnavailable::Misaligned15m {
                last_close: TsMs(T0 - 900_001),
                expected: TsMs(T0 - 1)
            })
        );
    }

    // spec: 14 P-11 (5m markets are unsupported)
    #[test]
    fn five_minute_markets_are_unsupported() {
        let out = compute(
            &market("btc-updown-5m-1760140800"),
            TaInput { h1: &[], m15: &[] },
        )
        .unwrap();
        assert_eq!(out, TaOutput::Unavailable(TaUnavailable::UnsupportedMarket));
    }

    // spec: 00 R14 (bad candle input is an error, not a guess)
    #[test]
    fn malformed_candles_are_errors() {
        let mut h1 = series(CandleInterval::H1, T0 - HOUR_MS, 3);
        h1.swap(0, 1);
        assert_eq!(
            compute(
                &market("btc-updown-15m-1760140800"),
                TaInput { h1: &h1, m15: &[] }
            ),
            Err(PluginError::CandleOrder {
                interval: CandleInterval::H1,
                index: 1
            })
        );
        let mut m15 = series(CandleInterval::M15, T0 - 900_000, 2);
        m15[1].close_time = TsMs(m15[1].close_time.0 + 1);
        assert_eq!(
            compute(
                &market("btc-updown-15m-1760140800"),
                TaInput { h1: &[], m15: &m15 }
            ),
            Err(PluginError::CandleShape {
                interval: CandleInterval::M15,
                index: 1
            })
        );
    }

    // spec: 14 P-12 (lookback range)
    #[test]
    fn trades_range() {
        assert_eq!(
            ta_trades_range(TsMs(T0 + 900_000)),
            (TsMs(T0 - 160 * HOUR_MS), TsMs(T0 + 900_000))
        );
        assert_eq!(
            ta_trades_range(TsMs(T0)),
            (TsMs(T0 - 160 * HOUR_MS), TsMs(T0))
        );
    }

    // spec: 14 §12.5 P-9 (calendar and sessions)
    #[test]
    fn sessions() {
        assert_eq!(Session::from_hour_utc(7), Session::Asia);
        assert_eq!(Session::from_hour_utc(8), Session::Eu);
        assert_eq!(Session::from_hour_utc(15), Session::Eu);
        assert_eq!(Session::from_hour_utc(16), Session::Us);
        assert_eq!(Session::from_hour_utc(23), Session::Us);
    }

    // spec: 14 P-9 (indicator definitions on a hand-checkable series)
    #[test]
    fn indicator_definitions() {
        assert_eq!(
            wilder_ema_last(&[1.0, 2.0, 3.0, 4.0], 2),
            Some((1.5 + (3.0 - 1.5) * 0.5) + (4.0 - 2.25) * 0.5)
        );
        assert_eq!(wilder_ema_last(&[1.0], 2), None);
        let (m, sd) = mean_sd_last(&[9.0, 2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0], 8).unwrap();
        assert_eq!((m, sd), (5.0, 2.0));
        assert_eq!(realized_vol(&[1.0, 2.0, 4.0], 2), Some(0.0));
        assert_eq!(realized_vol(&[1.0, 0.0, 4.0], 1), None);
        let c = Candle {
            open_time: TsMs(0),
            close_time: TsMs(0),
            open: 10.0,
            high: 12.0,
            low: 9.0,
            close: 10.0,
            volume: 0.0,
        };
        assert_eq!(wick_ratio(&c), 3.0 / EPS);
        assert_eq!(hl_range_pct(&c), Some(3.0 / 9.0));
    }
}
