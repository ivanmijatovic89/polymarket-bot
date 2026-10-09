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
//! - `trade: true` runs the engine exerciser's schedule v2 on real ticks only
//!   (60 §5.8). It lands in M2 (01 §4.1); until then it is rejected when the
//!   params are validated (`describe` fails before enqueue, 30 §12), never
//!   silently run as `trade: false` (00 R14).

use pmb_sdk::prelude::*;

/// Why `trade: true` is refused in this revision.
const TRADE_NOT_SUPPORTED: &str = "trade=true (engine exerciser schedule v2 on real ticks, \
     60 §5.8) is not supported yet: it lands with schedule v2 in M2 (01 §4.1); use trade=false";

/// Feed exerciser params (60 §5.8): `{tickOnUpdate, trade, ta, chainlink}`;
/// only `chainlink` has a default.
#[derive(Params, Clone, Debug)]
#[param(validate)]
pub struct FeedExerciserParams {
    /// Opt into synthetic strategy ticks on every update of each requested
    /// spot feed (Binance aggTrade, Chainlink round; 14 §8).
    pub tick_on_update: bool,
    /// Run the engine exerciser schedule on real ticks (M2; rejected until
    /// then).
    pub trade: bool,
    /// Also request the TechnicalIndicators plugin.
    pub ta: bool,
    /// Request Chainlink. `false` exists for agent-run paper sessions, which
    /// load no Chainlink credentials; every parity cell uses `true`.
    #[param(default = true)]
    pub chainlink: bool,
}

impl Params for FeedExerciserParams {
    fn validate(&self) -> Result<(), ParamError> {
        if self.trade {
            return Err(ParamError::new("trade", TRADE_NOT_SUPPORTED));
        }
        Ok(())
    }
}

/// TimeWindowVolatility config, identical in both twins (TS
/// `FEED_EXERCISER_PLUGIN_CONFIG.timeWindowVolatility`): windows 10 s and
/// 60 s on the mid.
// D-PENDING: 60 §5.8 names the plugins but not their configs; the TS twin
// fixed them (volatility 10 s and 60 s on mid, dwell band [0.40, 0.60] for
// 5 s on the bid, gate open 60 s to 840 s after start). Mirrored here.
pub fn time_window_volatility_config() -> TimeWindowVolatilityConfig {
    TimeWindowVolatilityConfig::new([("10s", 10_000), ("60s", 60_000)], VolPrice::Mid)
}

/// DwellGate config, identical in both twins: band [0.40, 0.60], 5 s, bid.
pub fn dwell_gate_config() -> DwellGateConfig {
    DwellGateConfig {
        from: price!(0.40),
        to: price!(0.60),
        required_ms: 5_000,
        track_price: BidOrAsk::Bid,
    }
}

/// TimeWindowGate config, identical in both twins: open from 60 s to 840 s
/// after the market start.
pub fn time_window_gate_config() -> TimeWindowGateConfig {
    TimeWindowGateConfig {
        allow_after_ms: 60_000,
        disable_after_ms: 840_000,
    }
}

/// The feed exerciser (60 §5.8). With `trade: false` it keeps no state.
#[derive(Debug)]
pub struct FeedExerciser;

impl Strategy for FeedExerciser {
    type Params = FeedExerciserParams;
    const ID: &'static str = "feed-exerciser.rs";

    fn requirements(p: &FeedExerciserParams) -> Requirements {
        // Symbols follow the traded market (14 F-49).
        let feed = FeedOptions {
            tick_on_update: p.tick_on_update,
            ..FeedOptions::default()
        };
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
        // `validate` already refused it; never run `trade: true` as a no-op.
        assert!(!p.trade, "feed-exerciser.rs: {TRADE_NOT_SUPPORTED}");
        FeedExerciser
    }

    /// `trade: false`: no intents, on real and synthetic ticks alike.
    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
        Ok(())
    }
}
