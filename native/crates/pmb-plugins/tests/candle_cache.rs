//! The TA candle cache (14 PF-5, P-12) and the V-7 property "identical
//! outputs with a cold or warm day cache and with any thread count".

use pmb_core::TsMs;
use pmb_plugins::{
    build_candles, compute_technical_indicators, AggTrade, CacheUse, CandleCache, CandleCacheError,
    CandleError, CandleInterval, PluginMarket, PluginRequest, PluginSet, TaInput, TaOutput,
    TechnicalIndicatorsConfig, UtcDay, DAY_MS,
};
use std::sync::atomic::{AtomicUsize, Ordering};

const HOUR: i64 = 3_600_000;

/// Deterministic synthetic trades: one every 37 s from `from` to `to`,
/// prices on a cent grid, a few per candle.
fn trades(from: i64, to: i64) -> Vec<AggTrade> {
    let mut out = Vec::new();
    let mut ts = from;
    let mut id = 1_000;
    let mut px: i64 = 6_000_000;
    let mut s: u64 = 0x9e37_79b9_7f4a_7c15;
    while ts < to {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        px += (s % 401) as i64 - 200;
        out.push(AggTrade {
            id,
            ts: TsMs(ts),
            price: px as f64 / 100.0,
            qty: (s % 997) as f64 / 1000.0 + 0.001,
        });
        id += 1;
        ts += 37_000;
    }
    out
}

/// A day loader over a trade vector, counting calls.
fn loader<'a>(
    all: &'a [AggTrade],
    calls: &'a AtomicUsize,
) -> impl Fn(&str, UtcDay) -> Result<Vec<AggTrade>, String> + 'a {
    move |pair, day| {
        assert_eq!(pair, "BTCUSDT");
        calls.fetch_add(1, Ordering::SeqCst);
        let (lo, hi) = (day.start().0, day.start().0 + DAY_MS);
        Ok(all
            .iter()
            .filter(|t| t.ts.0 >= lo && t.ts.0 < hi)
            .copied()
            .collect())
    }
}

fn market(t0_ms: i64) -> PluginMarket {
    PluginMarket::from_slug(&format!("btc-updown-15m-{}", t0_ms / 1000)).unwrap()
}

/// Bitwise rendering of a TA output (`{:?}` prints the shortest round-trip
/// form, unique per f64 value).
fn bits(o: &TaOutput) -> String {
    format!("{o:?}")
}

// spec: 14 §13 V-7 (identical outputs with a cold or warm day cache), PF-5,
// P-12; equal to candles built over the whole range without a cache
#[test]
fn cold_and_warm_cache_give_identical_ta() {
    let day0 = 20_000 * DAY_MS;
    let all = trades(day0, day0 + 10 * DAY_MS);
    let calls = AtomicUsize::new(0);
    let load = loader(&all, &calls);
    // t0 on day 8 at 13:45, and an earlier market sharing most days
    let t0 = day0 + 8 * DAY_MS + 13 * HOUR + 45 * 60_000;
    let m = market(t0);
    let earlier = market(day0 + 7 * DAY_MS + 2 * HOUR);

    let cold = CandleCache::new();
    let (c, used) = cold.ta_candles(&m, &load).unwrap().unwrap();
    // [floorHour(t0) - 160 h, t0) spans days 1..=8
    assert_eq!(used, CacheUse { hits: 0, misses: 8 });
    let cold_out = compute_technical_indicators(&m, Some(c.input())).unwrap();
    assert!(cold_out.ready().is_some(), "{cold_out:?}");

    let warm = CandleCache::new();
    warm.ta_candles(&earlier, &load).unwrap().unwrap();
    let (w, used) = warm.ta_candles(&m, &load).unwrap().unwrap();
    assert_eq!(used, CacheUse { hits: 7, misses: 1 });
    assert_eq!(w, c);
    let warm_out = compute_technical_indicators(&m, Some(w.input())).unwrap();
    assert_eq!(bits(&warm_out), bits(&cold_out));
    // a second request is all hits and loads nothing
    let before = calls.load(Ordering::SeqCst);
    let (again, used) = warm.ta_candles(&m, &load).unwrap().unwrap();
    assert_eq!(used, CacheUse { hits: 8, misses: 0 });
    assert_eq!(calls.load(Ordering::SeqCst), before);
    assert_eq!(again, c);

    // no cache: candles over all ten days at once
    let h1 = build_candles(&all, CandleInterval::H1).unwrap();
    let m15 = build_candles(&all, CandleInterval::M15).unwrap();
    let direct = compute_technical_indicators(&m, Some(TaInput { h1: &h1, m15: &m15 })).unwrap();
    assert_eq!(bits(&direct), bits(&cold_out));

    // through the plugin set, as the engine calls it
    let mut set = PluginSet::new(&PluginRequest {
        technical_indicators: Some(TechnicalIndicatorsConfig {}),
        ..PluginRequest::default()
    })
    .unwrap();
    assert!(set.needs_ta_input(&m));
    set.start_market(&m, Some(w.input())).unwrap();
    assert_eq!(
        bits(set.view().technical_indicators().unwrap()),
        bits(&cold_out)
    );
}

// spec: 14 PF-5 (each key built once even under concurrent requests, as
// PF-1), V-7 (any thread count gives identical outputs)
#[test]
fn concurrent_requests_build_each_day_once() {
    let day0 = 20_100 * DAY_MS;
    let all = trades(day0, day0 + 9 * DAY_MS);
    let calls = AtomicUsize::new(0);
    let load = loader(&all, &calls);
    let cache = CandleCache::new();
    let starts: Vec<i64> = (0..16)
        .map(|k| day0 + 7 * DAY_MS + k * 3 * HOUR + (k % 4) * 900_000)
        .collect();
    let outs: Vec<Vec<String>> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..8)
            .map(|_| {
                s.spawn(|| {
                    starts
                        .iter()
                        .map(|&t0| {
                            let m = market(t0);
                            let (c, _) = cache.ta_candles(&m, &load).unwrap().unwrap();
                            bits(&compute_technical_indicators(&m, Some(c.input())).unwrap())
                        })
                        .collect()
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    // days 0..=8 requested; each loaded exactly once
    assert_eq!(calls.load(Ordering::SeqCst), cache.len());
    assert_eq!(cache.len(), 9);
    for o in &outs[1..] {
        assert_eq!(o, &outs[0]);
    }
    // single-threaded on a fresh cache: the same outputs
    let fresh = CandleCache::new();
    let single: Vec<String> = starts
        .iter()
        .map(|&t0| {
            let m = market(t0);
            let (c, _) = fresh.ta_candles(&m, &load).unwrap().unwrap();
            bits(&compute_technical_indicators(&m, Some(c.input())).unwrap())
        })
        .collect();
    assert_eq!(single, outs[0]);
    assert!(single.iter().all(|s| s.starts_with("Ready")));
}

// spec: 14 P-11, P-12 (a 5m market needs no TA days)
#[test]
fn unsupported_market_loads_nothing() {
    let calls = AtomicUsize::new(0);
    let cache: CandleCache<String> = CandleCache::new();
    let m5 = PluginMarket::from_slug("btc-updown-5m-1760140800").unwrap();
    assert!(cache
        .ta_candles(&m5, loader(&[], &calls))
        .unwrap()
        .is_none());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(cache.is_empty());
}

// spec: 00 R14, 14 PF-5 (load and build errors are typed, name the day, and
// are cached, so every request for the key sees the same error)
#[test]
fn errors_are_typed_and_cached() {
    let cache: CandleCache<String> = CandleCache::new();
    let calls = AtomicUsize::new(0);
    let fail = |_: &str, d: UtcDay| -> Result<Vec<AggTrade>, String> {
        calls.fetch_add(1, Ordering::SeqCst);
        Err(format!("no file for {d}"))
    };
    let day = UtcDay(20_000);
    let e = cache.day("BTCUSDT", day, fail).unwrap_err();
    assert_eq!(
        e,
        CandleCacheError::Load {
            pair: "BTCUSDT".into(),
            day,
            error: "no file for 2024-10-04".into()
        }
    );
    assert_eq!(
        e.to_string(),
        "loading BTCUSDT aggTrades for 2024-10-04: no file for 2024-10-04"
    );
    assert_eq!(cache.day("BTCUSDT", day, fail).unwrap_err(), e);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    // a trade outside the day is a build error
    let outside = |_: &str, d: UtcDay| -> Result<Vec<AggTrade>, String> {
        Ok(vec![AggTrade {
            id: 1,
            ts: TsMs(d.start().0 - 1),
            price: 1.0,
            qty: 1.0,
        }])
    };
    let e = cache.day("BTCUSDT", UtcDay(20_001), outside).unwrap_err();
    assert!(matches!(
        e,
        CandleCacheError::Build {
            error: CandleError::OutsideDay { index: 0, .. },
            ..
        }
    ));
}
