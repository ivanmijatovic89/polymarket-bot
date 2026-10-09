//! Placeholder for the strategy-facing feed view (14 §2, 30 §5 `feeds()`).
//!
//! STAND-IN: the real `FeedsView`, feed state and visibility clocks are being
//! written in crate `pmb-feeds` (feeds stream). Integration replaces these
//! types with re-exports from `pmb-feeds`; the session only needs (a) a feed
//! state the driver updates in `SharedMarket` (12 §3.2 `Feed`), (b) a view
//! built once per dispatched tick (12 §6.4) and (c) per-feed change
//! generations for the tick interest filter (14 P-13, 16 TF-2 (d)).

use pmb_core::TsMs;

/// Latest visible value of each requested feed (30 §5 `feeds()`, 14 F-7).
/// Stand-in with no feeds; unrequested feeds are always `None` (30 §5).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedsView {
    /// Change generation over all requested feeds (14 P-13).
    pub generation: u64,
}

impl FeedsView {
    /// A view with no feed values.
    pub const EMPTY: FeedsView = FeedsView { generation: 0 };
}

/// Feed state of one market, owned by `SharedMarket` and advanced by the
/// driver (12 §2.1, §3.2 `Feed`). Stand-in.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedState {
    /// High-water feed clock (14 F-7; the clock per profile is 12 §4.1).
    pub clock: Option<TsMs>,
}

/// One feed observation carried by a `Feed` envelope (12 §3.2): Binance
/// aggTrade, Chainlink round or price to beat. Stand-in.
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum FeedObservation {
    /// Binance aggTrade last price (14 §4).
    BinanceAggTrade {
        /// Trade time.
        ts: TsMs,
        /// Price as an external feed value (`f64` allowed, R2).
        price: f64,
    },
    /// Chainlink round (14 §5).
    ChainlinkRound {
        /// Round time.
        ts: TsMs,
        /// Round value.
        value: f64,
    },
    /// Price to beat became visible (14 §6).
    PriceToBeat {
        /// Value.
        value: f64,
    },
}
