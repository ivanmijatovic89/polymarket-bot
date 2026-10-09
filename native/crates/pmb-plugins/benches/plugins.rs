//! L0 micro benchmark (16 §13, 14 §14 PF-7 "plugin time"): ns per
//! `PluginSet::on_tick` with all three tick-driven plugins; a 64-candidate
//! group on one shared `PluginPool` against 64 private sets (16 CG-3, 30 §16
//! S4); candle building for one BTCUSDT-sized day (~1 M aggTrades, 14 PF-1)
//! and a market's TA from a warm candle cache (14 PF-5).
//! Run: `cargo bench -p pmb-plugins --bench plugins`.

use pmb_core::{PerOutcome, Price, TsMs};
use pmb_plugins::{
    build_day_candles, compute_technical_indicators, AggTrade, BidOrAsk, BookTop, CandleCache,
    CandleInterval, DayCandles, DwellGateConfig, PluginMarket, PluginPool, PluginRequest,
    PluginSet, PluginTick, TimeWindowGateConfig, TimeWindowVolatilityConfig, UtcDay, VolPrice,
};
use std::hint::black_box;
use std::time::Instant;

fn main() {
    let start = 1_760_140_800_000;
    let market = PluginMarket::from_slug("btc-updown-15m-1760140800").unwrap();
    let req = PluginRequest {
        time_window_volatility: Some(TimeWindowVolatilityConfig::new(
            [("1s", 1000), ("5s", 5000), ("30s", 30_000)],
            VolPrice::Mid,
        )),
        technical_indicators: None,
        dwell_gate: Some(DwellGateConfig {
            from: Price::from_micros(400_000),
            to: Price::from_micros(600_000),
            required_ms: 3000,
            track_price: BidOrAsk::Bid,
        }),
        time_window_gate: Some(TimeWindowGateConfig {
            allow_after_ms: 10_000,
            disable_after_ms: 800_000,
        }),
    };
    // ~100 ticks/s over a 15m market, about the telonex-delta density.
    let n = 90_000;
    let mut ticks = Vec::with_capacity(n);
    let mut bid = 500_000i64;
    let mut x = 0x2545_f491_4f6c_dd1du64;
    for i in 0..n {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        bid = (bid + ((x % 5) as i64 - 2) * 1000).clamp(10_000, 980_000);
        let top = BookTop::new(
            Some(Price::from_micros(bid)),
            Some(Price::from_micros(bid + 10_000)),
        );
        let down = BookTop::new(
            Some(Price::from_micros(990_000 - bid)),
            Some(Price::from_micros(1_000_000 - bid)),
        );
        ticks.push(PluginTick::new(
            TsMs(start + i as i64 * 10),
            x % 7 == 0,
            PerOutcome::new(top, down),
        ));
    }
    let mut set = PluginSet::new(&req).unwrap();
    let mut best = f64::MAX;
    for _ in 0..5 {
        set.start_market(&market, None).unwrap();
        let t = Instant::now();
        for tick in &ticks {
            black_box(set.on_tick(black_box(tick)).unwrap());
        }
        best = best.min(t.elapsed().as_nanos() as f64 / n as f64);
    }
    println!("PluginSet::on_tick (vol 3 windows + dwell + gate): {best:.1} ns/tick (best of 5, {n} ticks)");

    // A candidate group: 64 candidates over 2 volatility, 4 dwell and 2 gate
    // configs (a parameter sweep shares most plugin configs).
    let group: Vec<PluginRequest> = (0..64)
        .map(|k: i64| {
            let mut r = req.clone();
            r.time_window_volatility = Some(TimeWindowVolatilityConfig::new(
                [("1s", 1000), ("5s", 5000), ("30s", 30_000)],
                if k % 2 == 0 {
                    VolPrice::Mid
                } else {
                    VolPrice::Bid
                },
            ));
            r.dwell_gate.as_mut().unwrap().required_ms = 1000 * (1 + k % 4);
            r.time_window_gate.as_mut().unwrap().allow_after_ms = 5_000 * (1 + k % 2);
            r
        })
        .collect();
    let mut pool = PluginPool::new();
    for r in &group {
        pool.add(r).unwrap();
    }
    let mut best = f64::MAX;
    for _ in 0..5 {
        pool.start_market(&market, None).unwrap();
        let t = Instant::now();
        for tick in &ticks {
            black_box(pool.on_tick(black_box(tick)).unwrap());
        }
        best = best.min(t.elapsed().as_nanos() as f64 / n as f64);
    }
    println!(
        "PluginPool::on_tick, 64 candidates on {} shared instances: {best:.1} ns/tick",
        pool.instance_count()
    );
    let mut private: Vec<PluginSet> = group.iter().map(|r| PluginSet::new(r).unwrap()).collect();
    let mut best = f64::MAX;
    for _ in 0..3 {
        for s in &mut private {
            s.start_market(&market, None).unwrap();
        }
        let t = Instant::now();
        for tick in &ticks {
            for s in &mut private {
                black_box(s.on_tick(black_box(tick)).unwrap());
            }
        }
        best = best.min(t.elapsed().as_nanos() as f64 / n as f64);
    }
    println!("64 private PluginSets::on_tick: {best:.1} ns/tick (best of 3)");

    let day = 1_760_140_800_000; // a UTC midnight
    let trades: Vec<AggTrade> = (0..950_000)
        .map(|i| AggTrade {
            id: i,
            ts: TsMs(day + i * 86_400_000 / 950_000),
            price: 60_000.0 + (i % 1000) as f64 * 0.01,
            qty: 0.001 * (i % 17) as f64,
        })
        .collect();
    let mut best = f64::MAX;
    for _ in 0..5 {
        let t = Instant::now();
        black_box(build_day_candles(TsMs(day), black_box(&trades), CandleInterval::M15).unwrap());
        best = best.min(t.elapsed().as_secs_f64() * 1e3);
    }
    println!("build_day_candles 15m over 950k trades: {best:.2} ms (best of 5)");

    let mut best = f64::MAX;
    for _ in 0..5 {
        let t = Instant::now();
        black_box(DayCandles::build(UtcDay::containing(TsMs(day)), black_box(&trades)).unwrap());
        best = best.min(t.elapsed().as_secs_f64() * 1e3);
    }
    println!("DayCandles::build (1h + 15m) over 950k trades: {best:.2} ms (best of 5)");

    // TA for one market from a warm cache (PF-5): assemble the P-12 candles
    // from 8 cached days and compute.
    let cache: CandleCache<String> = CandleCache::new();
    let t0 = day + 7 * 86_400_000 + 13 * 3_600_000 + 45 * 60_000;
    let m = PluginMarket::from_slug(&format!("btc-updown-15m-{}", t0 / 1000)).unwrap();
    let load = |_: &str, d: UtcDay| -> Result<Vec<AggTrade>, String> {
        let off = d.start().0 - day;
        Ok(trades
            .iter()
            .map(|t| AggTrade {
                ts: TsMs(t.ts.0 + off),
                ..*t
            })
            .collect())
    };
    cache.ta_candles(&m, load).unwrap();
    let reps = 2_000;
    let mut best = f64::MAX;
    for _ in 0..5 {
        let t = Instant::now();
        for _ in 0..reps {
            let (c, _) = cache.ta_candles(&m, load).unwrap().unwrap();
            black_box(compute_technical_indicators(&m, Some(c.input())).unwrap());
        }
        best = best.min(t.elapsed().as_nanos() as f64 / reps as f64 / 1e3);
    }
    println!("TA from a warm candle cache (8 days): {best:.1} us/market (best of 5)");
}
