//! The input envelope (12 §3).
//!
//! Envelopes are borrowed from decoded batches; the loop never copies
//! payloads (12 E4). Every influence from outside a session enters as an
//! envelope (12 E3).

use pmb_core::{MarketEvent, Outcome, TsMs, Usdc};

use crate::exec::{AccountInput, TimerFired};
use crate::feeds_view::FeedObservation;

/// Producer of an envelope (12 §3.1 `source`). The order of the variants is
/// the fixed source rank used to merge live ingress rings (12 E2).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Source {
    /// Polymarket market WS or a recorded market row.
    MarketWs,
    /// User WS (live).
    UserWs,
    /// REST response (live).
    Rest,
    /// Binance feed.
    Binance,
    /// Chainlink feed.
    Chainlink,
    /// Price-to-beat feed.
    PriceToBeat,
    /// Timer fire (journaled mode, 13 §2.3).
    Timer,
    /// Operator command (live).
    Operator,
    /// Driver or runtime control.
    Control,
}

/// Synthetic tick kind (12 §3.2 `SyntheticTick`, 14 §8).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SyntheticKind {
    /// Binance aggTrade tick (`binance_agg_trade`).
    BinanceAggTrade,
    /// Chainlink round tick (`chainlink_round`).
    ChainlinkRound,
}

/// Operator commands (12 §3.2 `Operator`, 50 §16).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum OperatorCommand {
    /// Cancel one order by client order id (interned).
    CancelOrder {
        /// The interned cid.
        cid: pmb_core::CidKey,
    },
    /// Cancel every open order of the session.
    CancelAll,
    /// Trip the kill switch (12 §8.3).
    KillSwitch,
}

/// A session-guard trip computed by the runtime across sessions (12 §8.3,
/// 50 §10.2). Live and paper only.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum GuardTrip {
    /// Session loss including settlement.
    SessionLoss,
    /// Wallet exposure.
    WalletExposure,
    /// Order-rate cap.
    OrderRate,
    /// Reject burst.
    RejectBurst,
}

/// Control payloads (12 §3.2 `Control`).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Control {
    /// Session start; `observe_only` keeps the session from becoming Active
    /// (12 §10).
    SessionStart {
        /// Observe-only window (late start, operator pause).
        observe_only: bool,
    },
    /// Client-side window end at `window.end`; realistic only (12 §3.2,
    /// TC-C13).
    WindowEnd,
    /// Live capital cap from the CLOB collateral balance (12 §9.4, D31).
    CapitalCap(Usdc),
    /// Rules in force changed (11 §7.5, 50 §6.2); the driver has applied it
    /// to `SharedMarket`.
    RulesUpdate,
    /// Data gap: the outcome's book (or both) becomes stale (15 I-6f, 50 §7).
    DataGap(Option<Outcome>),
    /// Adopted read-only inventory (12 §10, D29).
    AdoptPositions,
    /// Session-guard trip (12 §8.3).
    Guard(GuardTrip),
    /// Operator command (50 §16).
    Operator(OperatorCommand),
    /// Runtime shutdown.
    Shutdown,
}

/// Payload of an envelope (12 §3.2).
#[derive(Copy, Clone, Debug)]
pub enum Payload<'a> {
    /// Recorded or live market message (12 §5.2).
    Market(MarketEvent<'a>),
    /// Feed update; applied to `SharedMarket` by the driver, no tick.
    Feed(FeedObservation),
    /// Synthetic strategy tick (12 §5.3, 14 §8).
    SyntheticTick(SyntheticKind),
    /// Live account input for the execution adapter (13 §9).
    Account(&'a AccountInput),
    /// Timer fire in journaled mode (13 §2.3, 12 E5).
    Timer(TimerFired),
    /// Control (12 §8, §10).
    Control(Control),
}

/// One input envelope (12 §3.1).
#[derive(Copy, Clone, Debug)]
pub struct Envelope<'a> {
    /// Position in the session's input stream; strictly increasing (12 E1).
    pub seq: u64,
    /// Effect time on the loop clock (12 §4).
    pub at: TsMs,
    /// Exchange timestamp of the payload, when the source has one.
    pub exchange_ts: Option<TsMs>,
    /// Local wall-clock receive time (live, Recorder V4, journal).
    pub recv_wall: Option<TsMs>,
    /// Local monotonic receive time in ns (live, journal).
    pub recv_mono: Option<u64>,
    /// Producer.
    pub source: Source,
    /// Payload.
    pub payload: Payload<'a>,
}
