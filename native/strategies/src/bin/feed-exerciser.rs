//! Feed exerciser `feed-exerciser.rs` (60 §5.8, 14 §13 V-3, D20): a
//! deterministic parity-test strategy for feeds, plugins and synthetic ticks,
//! not a trading strategy. TS twin: `src/strategies/testing/feed-exerciser.ts`
//! (id `feed-exerciser`).
//!
//! It requests every historical feed (Binance aggTrades, Chainlink unless
//! `chainlink: false`, price to beat) with `tickOnUpdate` per the param, and
//! the plugins TimeWindowVolatility, DwellGate, TimeWindowGate and, only when
//! `ta`, TechnicalIndicators (D19 as amended). The parity trace at level
//! `feeds` records what the strategy can see on every tick (22 §3.2); the
//! strategy itself reads nothing.
//!
//! - `trade: false` returns no intents (the T15 tick-stream checkpoint).
//! - `trade: true` runs the engine exerciser schedule
//!   ([`native_strategies::exerciser`]) on real ticks only: synthetic feed
//!   ticks never count (60 §5.1). Both twins run the schedule of
//!   `EXERCISER_SCHEDULE_VERSION`, as the TS twin does.

// D-PENDING: 60 §5.8 says `trade: true` runs schedule v2, which 01 §4.1
// stages in M2. Until v2 lands in both twins, both run the schedule version
// they implement (v1), so a `trade: true` cell behaves the same on both
// sides instead of running on TS and failing `describe` on Rust.

use native_strategies::exerciser::Exerciser;
use pmb_sdk::prelude::*;

/// Feed exerciser params (60 §5.8): `{tickOnUpdate, trade, ta, chainlink}`;
/// only `chainlink` has a default.
#[derive(Params, Clone, Debug)]
struct FeedExerciserParams {
    /// Opt into synthetic strategy ticks on every update of each requested
    /// spot feed (Binance aggTrade, Chainlink round; 14 §8).
    tick_on_update: bool,
    /// Run the engine exerciser schedule on real ticks.
    trade: bool,
    /// Also request the TechnicalIndicators plugin.
    ta: bool,
    /// Request Chainlink. `false` exists for agent-run paper sessions, which
    /// load no Chainlink credentials; every parity cell uses `true`.
    #[param(default = true)]
    chainlink: bool,
}

// D-PENDING: 60 §5.8 names the plugins but not their configs; the TS twin
// fixed them in `FEED_EXERCISER_PLUGIN_CONFIG` (volatility 10 s and 60 s on
// the mid, dwell band [0.40, 0.60] for 5 s on the bid, gate open 60 s to
// 840 s after the start). Mirrored here.

/// TimeWindowVolatility: windows 10 s and 60 s on the mid (the constructor's
/// default track price, as TS `trackPrice: 'mid'`).
fn time_window_volatility_config() -> TimeWindowVolatilityConfig {
    TimeWindowVolatilityConfig::new([
        ("10s", DurMs::from_ms(10_000)),
        ("60s", DurMs::from_ms(60_000)),
    ])
}

/// DwellGate: band [0.40, 0.60] held for 5 s, on the bid.
fn dwell_gate_config() -> DwellGateConfig {
    DwellGateConfig::new(
        price!(0.40),
        price!(0.60),
        DurMs::from_ms(5_000),
        BidOrAsk::Bid,
    )
}

/// TimeWindowGate: open from 60 s to 840 s after the market start.
fn time_window_gate_config() -> TimeWindowGateConfig {
    TimeWindowGateConfig::new(DurMs::from_ms(60_000), DurMs::from_ms(840_000))
}

/// The feed exerciser (60 §5.8). One instance per market (30 §4 rule 4).
#[derive(Debug)]
struct FeedExerciser {
    /// The engine exerciser schedule when `trade: true`.
    trade: Option<Exerciser>,
}

impl Strategy for FeedExerciser {
    type Params = FeedExerciserParams;
    const ID: &'static str = "feed-exerciser.rs";

    fn requirements(p: &FeedExerciserParams) -> Requirements {
        // Symbols follow the traded market (14 F-49).
        let feed = FeedOptions::default().tick_on_update(p.tick_on_update);
        let mut r = Requirements::new().binance_spot(feed.clone());
        if p.chainlink {
            r = r.chainlink(feed);
        }
        r = r
            .price_to_beat()
            .time_window_volatility(time_window_volatility_config())
            .dwell_gate(dwell_gate_config())
            .time_window_gate(time_window_gate_config());
        if p.ta {
            r = r.technical_indicators(TechnicalIndicatorsConfig::default());
        }
        r
    }

    // `interests` keeps its default (all events, every tick): a ts-compat
    // port MUST NOT declare a tick interest (30 §4.1). Synthetic ticks are
    // opted into per feed above.

    fn new(p: &FeedExerciserParams, _market: &MarketInfo) -> Self {
        FeedExerciser {
            trade: p.trade.then(Exerciser::default),
        }
    }

    /// `trade: false`: no intents, on real and synthetic ticks alike.
    /// `trade: true`: the schedule, which skips synthetic ticks itself.
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        if let Some(schedule) = &mut self.trade {
            schedule.on_tick(ctx, out);
        }
        Ok(())
    }

    fn on_event(&mut self, ctx: &Ctx, event: &AccountEvent, out: &mut Intents) -> StrategyResult {
        if let Some(schedule) = &mut self.trade {
            schedule.on_event(ctx, event, out);
        }
        Ok(())
    }
}

pmb_sdk::strategy_main!(FeedExerciser);

/// Params, requirements and `trade` behavior (60 §5.8, 30 §9, §10, §15).
#[cfg(test)]
mod tests {
    use super::*;
    use pmb_sdk::json::Value;
    use pmb_sdk::testkit::{Profile, TestMarket};

    fn params(args: &[&str]) -> Result<FeedExerciserParams, ParamError> {
        FeedExerciserParams::from_cli(args.iter().copied())
    }

    #[test]
    fn chainlink_defaults_to_true_and_the_rest_is_required() {
        // spec: 60 §5.8 (`chainlink` defaults to true), 30 §9 rules 1, 3, 6, 7
        let p = params(&["tickOnUpdate=true", "trade=false", "ta=false"]).unwrap();
        assert!(p.chainlink);
        assert_eq!(
            p.normalized_json(),
            r#"{"chainlink":true,"ta":false,"tickOnUpdate":true,"trade":false}"#
        );
        let err = params(&["chainlink=false"]).unwrap_err();
        let mut paths: Vec<&str> = err.issues().iter().map(|i| i.path()).collect();
        paths.sort_unstable();
        assert_eq!(paths, ["/ta", "/tickOnUpdate", "/trade"]);
        assert!(params(&["tickOnUpdate=1", "trade=false", "ta=false"]).is_err());
        assert!(params(&["tickOnUpdate=true", "trade=false", "ta=false", "tick=true"]).is_err());
    }

    #[test]
    fn trade_true_is_accepted() {
        // spec: 60 §5.8 (`trade: true` runs the exerciser schedule), 00 R14
        let p = params(&["tickOnUpdate=false", "trade=true", "ta=false"]).unwrap();
        assert!(p.trade);
        assert_eq!(
            p.normalized_json(),
            r#"{"chainlink":true,"ta":false,"tickOnUpdate":false,"trade":true}"#
        );
    }

    #[test]
    fn requirements_follow_the_params() {
        // spec: 60 §5.8 (Binance, Chainlink only when `chainlink`, price to
        // beat, tickOnUpdate per the param; TechnicalIndicators only when
        // `ta`), 30 §10
        let req = |args: &[&str]| FeedExerciser::requirements(&params(args).unwrap());
        let with_plugins = |r: Requirements| {
            r.price_to_beat()
                .time_window_volatility(time_window_volatility_config())
                .dwell_gate(dwell_gate_config())
                .time_window_gate(time_window_gate_config())
        };

        let quiet = FeedOptions::default();
        let expected = with_plugins(
            Requirements::new()
                .binance_spot(quiet.clone())
                .chainlink(quiet.clone()),
        );
        assert_eq!(
            req(&["tickOnUpdate=false", "trade=false", "ta=false"]),
            expected
        );
        // `trade` changes no requirement.
        assert_eq!(
            req(&["tickOnUpdate=false", "trade=true", "ta=false"]),
            expected
        );

        let ticking = FeedOptions::default().tick_on_update(true);
        assert_eq!(
            req(&["tickOnUpdate=true", "trade=false", "ta=false"]),
            with_plugins(
                Requirements::new()
                    .binance_spot(ticking.clone())
                    .chainlink(ticking)
            )
        );

        assert_eq!(
            req(&[
                "tickOnUpdate=false",
                "trade=false",
                "ta=false",
                "chainlink=false",
            ]),
            with_plugins(Requirements::new().binance_spot(quiet))
        );

        assert_eq!(
            req(&["tickOnUpdate=false", "trade=false", "ta=true"]),
            expected.technical_indicators(TechnicalIndicatorsConfig::default())
        );
    }

    /// `btc-updown-15m-1760140800`.
    const START_MS: i64 = 1_760_140_800_000;
    /// Real tick `i` happens at `T0 + 100 ms × i`; a Binance trade 50 ms
    /// after each.
    const T0_MS: i64 = START_MS + 1_000;
    /// Real ticks scripted: `n = 0..=REAL_LAST`.
    const REAL_LAST: u64 = 60;

    /// A ts-compat market with both books, then filler price changes, and a
    /// Binance trade between every two real ticks. Chainlink is not
    /// requested (`chainlink=false`), so none is scripted.
    fn market() -> TestMarket {
        let mut m = TestMarket::btc_15m(TsMs::from_ms(START_MS))
            .profile(Profile::TsCompat)
            .starting_capital(usdc!(1000));
        m.price_to_beat(TsMs::from_ms(START_MS), 100_000.0);
        for i in 0..=REAL_LAST {
            let at = TsMs::from_ms(T0_MS + 100 * i as i64);
            match i {
                0 => m.book(
                    at,
                    Outcome::Up,
                    &[(price!(0.48), qty!(100))],
                    &[(price!(0.52), qty!(100))],
                ),
                1 => m.book(
                    at,
                    Outcome::Down,
                    &[(price!(0.47), qty!(100))],
                    &[(price!(0.53), qty!(100))],
                ),
                _ => {
                    let size = if i % 2 == 0 { qty!(1) } else { qty!(2) };
                    m.price_change(at, Outcome::Up, Side::Buy, price!(0.40), size)
                }
            };
            let trade_at = TsMs::from_ms(T0_MS + 100 * i as i64 + 50);
            m.binance_trade(trade_at, 100_000.0 + i as f64);
        }
        m
    }

    fn is_real(cause: &Value) -> bool {
        cause == "book" || cause == "price_change"
    }

    #[test]
    fn trade_false_returns_no_intents_on_any_tick() {
        // spec: 60 §5.8 (`trade: false` returns no intents, the T15
        // checkpoint)
        let p = params(&[
            "tickOnUpdate=true",
            "trade=false",
            "ta=false",
            "chainlink=false",
        ])
        .unwrap();
        let run = market().run::<FeedExerciser>(&p);
        let trace = run.trace();
        assert!(trace
            .iter()
            .any(|r| r["t"] == "tick" && !is_real(&r["cause"])));
        assert!(trace.iter().all(|r| r["t"] != "intent"));
    }

    #[test]
    fn trade_true_runs_the_schedule_on_real_ticks_only() {
        // spec: 60 §5.8 (`trade: true` runs the exerciser schedule on real
        // ticks only), 60 §5.1 (synthetic feed ticks never count), 60 §5.2
        // row 50 (x1)
        let p = params(&[
            "tickOnUpdate=true",
            "trade=true",
            "ta=false",
            "chainlink=false",
        ])
        .unwrap();
        let run = market().run::<FeedExerciser>(&p);
        let trace = run.trace();
        let ticks: Vec<(u64, &Value)> = trace
            .iter()
            .filter(|r| r["t"] == "tick")
            .map(|r| (r["seq"].as_u64().expect("tick seq"), &r["cause"]))
            .collect();
        assert!(
            ticks.iter().any(|(_, cause)| !is_real(cause)),
            "the run delivers synthetic ticks"
        );

        let first = trace
            .iter()
            .find(|r| r["t"] == "intent" && r["src"] == "tick")
            .expect("x1 is placed");
        assert_eq!(first["cid"], "x1");
        let x1_seq = first["seq"].as_u64().expect("intent seq");
        let (_, x1_cause) = ticks
            .iter()
            .find(|(seq, _)| *seq == x1_seq)
            .expect("x1 has a tick record");
        assert!(is_real(x1_cause), "x1 fires on a real tick");
        // x1 fires at n = 50: 50 real ticks come before its tick.
        let real_before = ticks
            .iter()
            .filter(|(seq, cause)| *seq < x1_seq && is_real(cause))
            .count();
        assert_eq!(real_before, 50);
    }
}
