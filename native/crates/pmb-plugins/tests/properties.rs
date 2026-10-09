//! Property tests for the plugin layer (14 §13 V-7, the parts owned by this
//! crate; 60 §8.2).

use pmb_core::{PerOutcome, Price, TsMs};
use pmb_plugins::ts_shape::plugins_json;
use pmb_plugins::{
    build_candles, build_day_candles, AggTrade, BidOrAsk, BookTop, CandleInterval, DwellGateConfig,
    PluginId, PluginMarket, PluginPool, PluginRequest, PluginSet, PluginTick, TaInput,
    TechnicalIndicatorsConfig, TimeWindowGateConfig, TimeWindowVolatilityConfig, VolPrice, DAY_MS,
};
use proptest::prelude::*;

const START: i64 = 1_760_140_800_000;

fn request(track: VolPrice) -> PluginRequest {
    PluginRequest {
        time_window_volatility: Some(TimeWindowVolatilityConfig::new(
            [("1s", 1000), ("4s", 4000), ("30s", 30_000)],
            track,
        )),
        technical_indicators: None,
        dwell_gate: Some(DwellGateConfig {
            from: Price::from_micros(350_000),
            to: Price::from_micros(650_000),
            required_ms: 1200,
            track_price: BidOrAsk::Ask,
        }),
        time_window_gate: Some(TimeWindowGateConfig {
            allow_after_ms: 3000,
            disable_after_ms: 40_000,
        }),
    }
}

/// (time step, may step back, synthetic, up bid, spread, drop mask)
type RawTick = (u16, bool, bool, u32, u32, u8);

fn ticks(raw: &[RawTick]) -> Vec<PluginTick> {
    let mut ts = START - 2000;
    let mut last_real = PerOutcome::new(BookTop::EMPTY, BookTop::EMPTY);
    let mut out = Vec::with_capacity(raw.len());
    for (i, &(step, back, synthetic, bid, spread, drop)) in raw.iter().enumerate() {
        ts = if back {
            ts - i64::from(step % 50)
        } else {
            ts + i64::from(step)
        };
        let synthetic = synthetic && i > 0;
        let tops = if synthetic {
            last_real
        } else {
            let bid = i64::from(bid % 980) * 1000 + 1000;
            let ask = (bid + i64::from(spread % 30 + 1) * 1000).min(1_000_000);
            let p = |m: i64, keep: bool| keep.then(|| Price::from_micros(m));
            let tops = PerOutcome::new(
                BookTop::new(p(bid, drop & 1 == 0), p(ask, drop & 2 == 0)),
                BookTop::new(
                    p(1_000_000 - ask, drop & 4 == 0),
                    p(1_000_000 - bid, drop & 8 == 0),
                ),
            );
            last_real = tops;
            tops
        };
        out.push(PluginTick::new(TsMs(ts), synthetic, tops));
    }
    out
}

fn market() -> PluginMarket {
    PluginMarket::from_slug("btc-updown-15m-1760140800").unwrap()
}

/// A candidate's request from a small menu, so that some candidates share
/// configs and some do not: (volatility, dwell, gate, TA) variant indices,
/// 0 = not requested.
fn menu_request(v: u8, d: u8, g: u8, ta: bool) -> PluginRequest {
    let tracks = [VolPrice::Mid, VolPrice::Bid];
    PluginRequest {
        time_window_volatility: (v % 3 != 0).then(|| {
            TimeWindowVolatilityConfig::new(
                [("1s", 1000), ("4s", 4000)],
                tracks[usize::from(v % 3) - 1],
            )
        }),
        technical_indicators: ta.then_some(TechnicalIndicatorsConfig {}),
        dwell_gate: (d % 3 != 0).then(|| DwellGateConfig {
            from: Price::from_micros(350_000),
            to: Price::from_micros(650_000),
            required_ms: 600 * i64::from(d % 3),
            track_price: BidOrAsk::Ask,
        }),
        time_window_gate: (g % 3 != 0).then(|| TimeWindowGateConfig {
            allow_after_ms: 1000 * i64::from(g % 3),
            disable_after_ms: 40_000,
        }),
    }
}

/// Number of distinct configs of one plugin kind among the requests.
fn distinct(reqs: &[PluginRequest], key: impl Fn(&PluginRequest) -> Option<String>) -> usize {
    reqs.iter()
        .filter_map(key)
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    // spec: 14 §13 V-7 ("shared plugin instances equal per-candidate
    // instances"), P-6, 16 CG-3, 30 §10 / §16 S4: N candidates reading one
    // pool (one instance per distinct config) see exactly what N private
    // instances see, with the same generations and dirty counters (P-13,
    // TF-7).
    #[test]
    fn shared_pool_equals_private_instances(
        raw in prop::collection::vec(any::<RawTick>(), 1..300),
        menu in prop::collection::vec((any::<u8>(), any::<u8>(), any::<u8>(), any::<bool>()), 1..12),
    ) {
        let tokens = PerOutcome::new("U", "D");
        let reqs: Vec<PluginRequest> = menu.iter().map(|&(v, d, g, ta)| menu_request(v, d, g, ta)).collect();
        let mut pool = PluginPool::new();
        let handles: Vec<_> = reqs.iter().map(|r| pool.add(r).unwrap()).collect();
        let mut private: Vec<PluginSet> = reqs.iter().map(|r| PluginSet::new(r).unwrap()).collect();
        let want_instances = distinct(&reqs, |r| r.time_window_volatility.as_ref().map(|c| format!("{c:?}")))
            + distinct(&reqs, |r| r.technical_indicators.map(|c| format!("{c:?}")))
            + distinct(&reqs, |r| r.dwell_gate.map(|c| format!("{c:?}")))
            + distinct(&reqs, |r| r.time_window_gate.map(|c| format!("{c:?}")));
        prop_assert_eq!(pool.instance_count(), want_instances);
        let ta = Some(TaInput { h1: &[], m15: &[] });
        let pool_ta = pool.needs_ta_input(&market()).then_some(ta).flatten();
        let pool_diag = pool.start_market(&market(), pool_ta).unwrap();
        for (set, req) in private.iter_mut().zip(&reqs) {
            let diag = set.start_market(&market(), req.technical_indicators.and(ta)).unwrap();
            if req.technical_indicators.is_some() {
                prop_assert_eq!(diag, pool_diag);
            }
        }
        for t in ticks(&raw) {
            let pool_before: Vec<u64> = handles.iter().map(|&h| pool.combined_generation(h)).collect();
            let any_pool = pool.on_tick(&t).unwrap();
            let mut any_private = false;
            for ((set, &h), &shared_before) in private.iter_mut().zip(&handles).zip(&pool_before) {
                let changed = set.on_tick(&t).unwrap();
                any_private |= changed;
                prop_assert_eq!(plugins_json(pool.view(h), &tokens), plugins_json(set.view(), &tokens));
                for id in PluginId::ALL {
                    prop_assert_eq!(pool.generation(h, id), set.generation(id));
                }
                // the candidate's dirty counter moves exactly when its own
                // plugins changed (TF-7)
                prop_assert_eq!(pool.combined_generation(h), set.combined_generation());
                prop_assert_eq!(pool.combined_generation(h) != shared_before, changed);
            }
            prop_assert_eq!(any_pool, any_private);
        }
    }

    // spec: 14 §13 V-7 ("Volatility output unchanged by synthetic ticks"), §12.2, §12.4
    #[test]
    fn volatility_ignores_synthetic_ticks(raw in prop::collection::vec(any::<RawTick>(), 1..400)) {
        let ticks = ticks(&raw);
        let req = PluginRequest { time_window_volatility: request(VolPrice::Mid).time_window_volatility, ..PluginRequest::default() };
        let mut with = PluginSet::new(&req).unwrap();
        let mut without = PluginSet::new(&req).unwrap();
        with.start_market(&market(), None).unwrap();
        without.start_market(&market(), None).unwrap();
        for t in &ticks {
            with.on_tick(t).unwrap();
            if !t.synthetic {
                without.on_tick(t).unwrap();
            }
            prop_assert_eq!(
                with.view().time_window_volatility(),
                without.view().time_window_volatility()
            );
            prop_assert_eq!(
                with.generation(PluginId::TimeWindowVolatility),
                without.generation(PluginId::TimeWindowVolatility)
            );
        }
    }

    // spec: 14 P-3 (a market restart equals a fresh instance: nothing of the
    // previous market survives), R7 determinism
    #[test]
    fn instances_are_interchangeable(
        raw in prop::collection::vec(any::<RawTick>(), 1..300),
        warm in prop::collection::vec(any::<RawTick>(), 0..100),
        track in prop_oneof![Just(VolPrice::Bid), Just(VolPrice::Ask), Just(VolPrice::Mid)],
    ) {
        let req = request(track);
        let tokens = PerOutcome::new("U", "D");
        let mut fresh = PluginSet::new(&req).unwrap();
        fresh.start_market(&market(), None).unwrap();
        // the reused instance first sees another market, then restarts
        let mut reused = PluginSet::new(&req).unwrap();
        reused.start_market(&PluginMarket::from_slug("btc-updown-15m-1760139900").unwrap(), None).unwrap();
        for t in ticks(&warm) {
            reused.on_tick(&t).unwrap();
        }
        reused.start_market(&market(), None).unwrap();
        for t in ticks(&raw) {
            let a = fresh.on_tick(&t).unwrap();
            let b = reused.on_tick(&t).unwrap();
            prop_assert_eq!(a, b);
            prop_assert_eq!(plugins_json(fresh.view(), &tokens), plugins_json(reused.view(), &tokens));
            prop_assert_eq!(fresh.combined_generation(), reused.combined_generation());
            for id in PluginId::ALL {
                prop_assert_eq!(fresh.generation(id), reused.generation(id));
            }
        }
    }

    // spec: 14 PF-5 (per-day candles equal candles of the whole range: the
    // cached and the cold path agree), P-8
    #[test]
    fn day_split_does_not_change_candles(
        steps in prop::collection::vec((1i64..400_000, 1u32..2000, 1u32..1000), 1..600),
        first in 0i64..DAY_MS,
    ) {
        let mut ts = first;
        let mut trades = Vec::with_capacity(steps.len());
        for (id, &(step, px, qty)) in steps.iter().enumerate() {
            trades.push(AggTrade { id: id as i64, ts: TsMs(ts), price: f64::from(px) * 0.5, qty: f64::from(qty) * 0.001 });
            ts += step;
        }
        for interval in [CandleInterval::H1, CandleInterval::M15] {
            let whole = build_candles(&trades, interval).unwrap();
            let mut days = Vec::new();
            let mut rest = &trades[..];
            let mut day = 0;
            while !rest.is_empty() {
                let end = (day + 1) * DAY_MS;
                let n = rest.partition_point(|t| t.ts.0 < end);
                days.extend(build_day_candles(TsMs(day * DAY_MS), &rest[..n], interval).unwrap());
                rest = &rest[n..];
                day += 1;
            }
            prop_assert_eq!(&whole, &days);
            // every trade is inside its candle, volume sums to the total
            let total: f64 = trades.iter().map(|t| t.qty).sum();
            let vol: f64 = whole.iter().map(|c| c.volume).sum();
            prop_assert!((total - vol).abs() <= 1e-9 * total.max(1.0));
            prop_assert!(whole.windows(2).all(|w| w[0].open_time < w[1].open_time));
        }
    }
}
