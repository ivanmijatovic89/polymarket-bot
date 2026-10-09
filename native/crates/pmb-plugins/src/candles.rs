//! Offline candles from local Binance aggTrades (14 §12.5 P-8, D19).
//!
//! A candle with open time `o` covers the trades with
//! `o <= ts_ms <= o + interval - 1`; open/close are the first/last trade in
//! `agg_trade_id` order, high/low the max/min price, volume the sum of `qty`,
//! `close_time = o + interval - 1`. No network, no clock (14 F-3).
//!
//! Candles are built per UTC day ([`build_day_candles`]) so the engine can
//! cache them per `(pair, interval, date)` (14 PF-5) and drop the raw trades.

use pmb_core::TsMs;

/// One Binance aggregate trade, as the TA candle builder needs it.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct AggTrade {
    /// `agg_trade_id` (series order, 14 F-10).
    pub id: i64,
    /// Trade time `ts_ms`.
    pub ts: TsMs,
    pub price: f64,
    pub qty: f64,
}

/// Candle interval (the two TA uses, 14 P-9).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CandleInterval {
    H1,
    M15,
}

impl CandleInterval {
    pub const fn ms(self) -> i64 {
        match self {
            CandleInterval::H1 => 3_600_000,
            CandleInterval::M15 => 900_000,
        }
    }

    /// Binance interval token.
    pub const fn as_str(self) -> &'static str {
        match self {
            CandleInterval::H1 => "1h",
            CandleInterval::M15 => "15m",
        }
    }
}

/// One closed candle (Binance kline fields TA reads).
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Candle {
    pub open_time: TsMs,
    pub close_time: TsMs,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

/// Length of one UTC day.
pub const DAY_MS: i64 = 86_400_000;

/// Invalid trade input; the builder never guesses (00 R14).
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum CandleError {
    #[error("aggTrade ids are not strictly increasing at index {index}")]
    IdOrder { index: usize },
    #[error("aggTrade at index {index} has a non-finite price or quantity")]
    NonFinite { index: usize },
    #[error("aggTrade at index {index} (ts {ts}) is outside the UTC day starting at {day_start}")]
    OutsideDay {
        index: usize,
        ts: i64,
        day_start: i64,
    },
    #[error("day start {0} is not a UTC midnight")]
    DayStart(i64),
}

/// Builds the candles of `interval` from trades in `agg_trade_id` order
/// (14 P-8). Intervals without trades produce no candle.
// D-PENDING: an interval without trades has no aggTrade to build from; chose to emit no candle (Binance omits klines for exchange outages; BTCUSDT has no idle 15m interval).
pub fn build_candles(
    trades: &[AggTrade],
    interval: CandleInterval,
) -> Result<Vec<Candle>, CandleError> {
    let len = interval.ms();
    let mut out: Vec<Candle> = Vec::new();
    // Index of the candle the previous trade went to: trades are almost
    // always in time order, so this is the hit path.
    let mut cur: usize = 0;
    let mut prev_id: Option<i64> = None;
    for (index, t) in trades.iter().enumerate() {
        if prev_id.is_some_and(|p| t.id <= p) {
            return Err(CandleError::IdOrder { index });
        }
        prev_id = Some(t.id);
        if !(t.price.is_finite() && t.qty.is_finite()) {
            return Err(CandleError::NonFinite { index });
        }
        let open = t.ts.0.div_euclid(len) * len;
        let slot = match out.get(cur) {
            Some(c) if c.open_time.0 == open => cur,
            _ => match out.binary_search_by_key(&open, |c| c.open_time.0) {
                Ok(i) => i,
                Err(i) => {
                    out.insert(
                        i,
                        Candle {
                            open_time: TsMs(open),
                            close_time: TsMs(open + len - 1),
                            open: t.price,
                            high: t.price,
                            low: t.price,
                            close: t.price,
                            volume: 0.0,
                        },
                    );
                    i
                }
            },
        };
        let c = &mut out[slot];
        if t.price > c.high {
            c.high = t.price;
        }
        if t.price < c.low {
            c.low = t.price;
        }
        c.close = t.price;
        c.volume += t.qty;
        cur = slot;
    }
    Ok(out)
}

/// Builds the candles of one UTC day; every trade must lie in
/// `[day_start, day_start + DAY_MS)` (day-file contract, 14 §4.1, PF-5).
pub fn build_day_candles(
    day_start: TsMs,
    trades: &[AggTrade],
    interval: CandleInterval,
) -> Result<Vec<Candle>, CandleError> {
    if day_start.0.rem_euclid(DAY_MS) != 0 {
        return Err(CandleError::DayStart(day_start.0));
    }
    let end = day_start.0 + DAY_MS;
    if let Some(index) = trades
        .iter()
        .position(|t| t.ts.0 < day_start.0 || t.ts.0 >= end)
    {
        return Err(CandleError::OutsideDay {
            index,
            ts: trades[index].ts.0,
            day_start: day_start.0,
        });
    }
    build_candles(trades, interval)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(id: i64, ts: i64, price: f64, qty: f64) -> AggTrade {
        AggTrade {
            id,
            ts: TsMs(ts),
            price,
            qty,
        }
    }

    // spec: 14 P-8 (bucket bounds, OHLC, volume, closeTime)
    #[test]
    fn ohlcv_per_interval() {
        let m = 900_000;
        let trades = [
            t(1, 0, 100.0, 1.0),
            t(2, 10, 105.0, 0.5),
            t(3, m - 1, 95.0, 0.25),
            t(4, m - 1, 99.0, 0.25),
            t(5, m, 200.0, 2.0),
        ];
        let c = build_candles(&trades, CandleInterval::M15).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].open_time, TsMs(0));
        assert_eq!(c[0].close_time, TsMs(m - 1));
        assert_eq!(
            (c[0].open, c[0].high, c[0].low, c[0].close),
            (100.0, 105.0, 95.0, 99.0)
        );
        assert_eq!(c[0].volume, 2.0);
        assert_eq!(c[1].open_time, TsMs(m));
        assert_eq!((c[1].open, c[1].close, c[1].volume), (200.0, 200.0, 2.0));
    }

    // spec: 14 P-8 (open/close in agg_trade_id order even when ts is not monotone; F-10)
    #[test]
    fn id_order_decides_open_and_close() {
        let h = 3_600_000;
        let trades = [
            t(10, h + 5, 50.0, 1.0),
            t(11, h - 1, 40.0, 1.0), // later id, earlier hour
            t(12, h + 1, 60.0, 1.0),
            t(13, 0, 41.0, 1.0),
        ];
        let c = build_candles(&trades, CandleInterval::H1).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(
            (c[0].open, c[0].close, c[0].high, c[0].low),
            (40.0, 41.0, 41.0, 40.0)
        );
        assert_eq!(
            (c[1].open, c[1].close, c[1].high, c[1].low),
            (50.0, 60.0, 60.0, 50.0)
        );
    }

    // spec: 14 P-8 (no trades, no candle)
    #[test]
    fn empty_intervals_have_no_candle() {
        let m = 900_000;
        let c = build_candles(
            &[t(1, 0, 1.0, 1.0), t(2, 3 * m, 2.0, 1.0)],
            CandleInterval::M15,
        )
        .unwrap();
        assert_eq!(
            c.iter().map(|c| c.open_time.0).collect::<Vec<_>>(),
            [0, 3 * m]
        );
        assert!(build_candles(&[], CandleInterval::M15).unwrap().is_empty());
    }

    // spec: 00 R14 (fail loud on bad input)
    #[test]
    fn invalid_input_is_an_error() {
        assert_eq!(
            build_candles(&[t(2, 0, 1.0, 1.0), t(2, 1, 1.0, 1.0)], CandleInterval::H1),
            Err(CandleError::IdOrder { index: 1 })
        );
        assert_eq!(
            build_candles(&[t(1, 0, f64::NAN, 1.0)], CandleInterval::H1),
            Err(CandleError::NonFinite { index: 0 })
        );
        assert_eq!(
            build_day_candles(
                TsMs(DAY_MS),
                &[t(1, DAY_MS - 1, 1.0, 1.0)],
                CandleInterval::H1
            ),
            Err(CandleError::OutsideDay {
                index: 0,
                ts: DAY_MS - 1,
                day_start: DAY_MS
            })
        );
        assert_eq!(
            build_day_candles(TsMs(5), &[], CandleInterval::H1),
            Err(CandleError::DayStart(5))
        );
    }

    // spec: 14 PF-5 (per-day candles concatenate to the multi-day result)
    #[test]
    fn day_candles_concatenate() {
        let mut trades = Vec::new();
        let mut id = 0;
        for k in 0..(2 * 96 * 3) {
            id += 1;
            let ts = k as i64 * 300_000 + 7;
            trades.push(t(id, ts, 100.0 + (k % 13) as f64, 0.1 * (k % 5) as f64));
        }
        let whole = build_candles(&trades, CandleInterval::M15).unwrap();
        let split = trades.partition_point(|t| t.ts.0 < DAY_MS);
        let mut days = build_day_candles(TsMs(0), &trades[..split], CandleInterval::M15).unwrap();
        days.extend(
            build_day_candles(TsMs(DAY_MS), &trades[split..], CandleInterval::M15).unwrap(),
        );
        assert_eq!(whole, days);
        assert_eq!(whole.len(), 192);
    }
}
