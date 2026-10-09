//! The strategy-facing surface (30 §3–§8, §12): the `Strategy` trait,
//! interests, results and errors, `Ctx` and its author views, the author
//! account-event view and the engine-owned intent buffer.
//!
//! `pmb-sdk` re-exports these items (30 §3); nothing engine-internal is
//! reachable through them (30 P1): author views expose accessor methods only.

mod ctx;
mod event;
mod intents;
mod views;

pub use ctx::Ctx;
pub use event::{AccountEvent, FillView};
pub use intents::{Intents, Meta, MetaValue};
pub use views::{BookView, Level, OrderView, PortfolioView, RulesView, TickCause, TickInfo};

pub use pmb_core::fill::Capital;
pub use pmb_core::MarketInfo;

use std::fmt;

/// Plain-data feed and plugin requirements built from params alone (30 §10).
///
/// STAND-IN: the builders (`binance_spot`, `chainlink`, `price_to_beat`,
/// the four plugin configs) are defined with the feed view in `pmb-feeds`
/// and the plugins in `pmb-plugins`; integration replaces this type.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Requirements {
    _private: (),
}

impl Requirements {
    /// No feeds and no plugins (30 §10).
    pub const fn new() -> Requirements {
        Requirements { _private: () }
    }
}

/// Event-flag set of [`Interests`] (30 §4.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct EventFlags(u8);

impl EventFlags {
    /// `Fill`.
    pub const FILLS: EventFlags = EventFlags(1 << 0);
    /// `OrderSubmitted`, `OrderAccepted`, `OrderDelayed`, `OrderOpen`,
    /// `CancelAcked`, `OrderDone`.
    pub const LIFECYCLE: EventFlags = EventFlags(1 << 1);
    /// `OrderRejected`, `CancelFailed`.
    pub const REJECTIONS: EventFlags = EventFlags(1 << 2);
    /// `PositionsSplit`, `SplitFailed`, `PositionsMerged`, `MergeFailed`.
    pub const SPLIT_MERGE: EventFlags = EventFlags(1 << 3);
    /// `SettlementUpdate`.
    pub const SETTLEMENT: EventFlags = EventFlags(1 << 4);
    /// `StreamStatus` (live only).
    pub const STREAM: EventFlags = EventFlags(1 << 5);
    /// Every flag (the default).
    pub const ALL: EventFlags = EventFlags(0b11_1111);
    /// No flag.
    pub const NONE: EventFlags = EventFlags(0);

    /// Union.
    #[inline]
    pub const fn union(self, other: EventFlags) -> EventFlags {
        EventFlags(self.0 | other.0)
    }

    /// Whether every flag of `other` is set.
    #[inline]
    pub const fn contains(self, other: EventFlags) -> bool {
        self.0 & other.0 == other.0
    }

    /// The flag covering a core account event (30 §4.1 table).
    pub const fn of(kind: &pmb_core::event::AccountEventKind) -> EventFlags {
        use pmb_core::event::AccountEventKind as K;
        match kind {
            K::Fill(_) => EventFlags::FILLS,
            K::OrderSubmitted { .. }
            | K::OrderAccepted { .. }
            | K::OrderDelayed { .. }
            | K::OrderOpen { .. }
            | K::CancelAcked { .. }
            | K::OrderDone { .. } => EventFlags::LIFECYCLE,
            K::OrderRejected { .. } | K::CancelFailed { .. } => EventFlags::REJECTIONS,
            K::PositionsSplit { .. }
            | K::SplitFailed { .. }
            | K::PositionsMerged { .. }
            | K::MergeFailed { .. } => EventFlags::SPLIT_MERGE,
            K::SettlementUpdate { .. } => EventFlags::SETTLEMENT,
            K::StreamStatus { .. } => EventFlags::STREAM,
        }
    }
}

/// When `on_tick` is called on a real strategy tick (30 §4.1, 16 §9.4
/// TF-1/TF-2). Synthetic feed ticks the strategy opted into are always
/// delivered.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum TickInterest {
    /// Always (default). ts-compat ports MUST keep it (TF-1).
    #[default]
    All,
    /// First in-window tick; a best bid or ask price of either outcome
    /// changed; an account event was delivered, a requested feed's visible
    /// value or a requested plugin's output changed since the last `on_tick`.
    TopOfBook,
    /// As `TopOfBook`, plus a change of the size at a best level.
    TopOfBookAndSize,
}

/// Callbacks a strategy wants (30 §4.1). Default: every event, every tick.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Interests {
    /// Event flags.
    pub events: EventFlags,
    /// Tick interest.
    pub ticks: TickInterest,
}

impl Interests {
    /// Every event and every tick (30 §4.1 default).
    pub const ALL: Interests = Interests {
        events: EventFlags::ALL,
        ticks: TickInterest::All,
    };
}

impl Default for Interests {
    fn default() -> Self {
        Interests::ALL
    }
}

/// An error returned by a strategy callback (30 §12): the candidate fails
/// with `strategy_fault`, cause `error`, and the message is preserved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StrategyError {
    message: Box<str>,
}

impl StrategyError {
    /// An error with a message (one line, at most 1,000 characters at output,
    /// 21 §10).
    pub fn new(message: impl Into<Box<str>>) -> StrategyError {
        StrategyError {
            message: message.into(),
        }
    }

    /// The message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for StrategyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for StrategyError {}

/// Result of a strategy callback (30 §12).
pub type StrategyResult = Result<(), StrategyError>;

/// A strategy (30 §4). One type per binary; the runtime is generic over it
/// and never boxes it (30 §4 rule 1, 12 §14 P6). An instance is created per
/// (candidate, market) by [`Strategy::new`] and dropped when the market ends
/// (rule 4); it is only ever called from one thread at a time (rule 7).
pub trait Strategy: Send + Sized + 'static {
    /// Typed params (30 §9). The parsing, normalization and schema traits
    /// are `pmb-sdk`'s; the engine only passes `&Params` through.
    type Params: Send + Sync + 'static;

    /// Strategy id (30 §4 rule 2), e.g. `example-lag.v1`.
    const ID: &'static str;

    /// Feed and plugin requirements, a pure function of the params
    /// (30 §4 rule 3, §10).
    fn requirements(p: &Self::Params) -> Requirements;

    /// Callbacks the strategy wants, a pure function of the params
    /// (30 §4 rule 3, §4.1). Default: all.
    fn interests(_p: &Self::Params) -> Interests {
        Interests::ALL
    }

    /// A fresh instance for one market, after its `MarketInfo` and rules are
    /// known and before its first callback (30 §4 rule 4).
    fn new(p: &Self::Params, market: &MarketInfo) -> Self;

    /// A strategy tick (30 §4 rule 5; which inputs tick is owned by 12 §5).
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult;

    /// An account event of this candidate, in cascade order (30 §4 rule 6,
    /// §8; 12 §6.2). Default: no intents.
    fn on_event(
        &mut self,
        _ctx: &Ctx,
        _event: &AccountEvent,
        _out: &mut Intents,
    ) -> StrategyResult {
        Ok(())
    }

    /// Debug values for the paper/live state stream and opt-in traces
    /// (30 §4 rule 8). Called at most about once per second; never on fleet
    /// runs. Default: nothing.
    fn status(&self, _out: &mut Meta) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::event::AccountEventKind;
    use pmb_core::ids::OrderKey;

    #[test]
    fn event_flags_cover_every_kind() {
        // spec: 30 §4.1 event flag table
        let fill_kind = AccountEventKind::OrderOpen {
            order: OrderKey::new(0),
        };
        assert_eq!(EventFlags::of(&fill_kind), EventFlags::LIFECYCLE);
        assert_eq!(
            EventFlags::of(&AccountEventKind::StreamStatus { connected: true }),
            EventFlags::STREAM
        );
        assert!(EventFlags::ALL.contains(EventFlags::FILLS.union(EventFlags::SETTLEMENT)));
        assert!(!EventFlags::FILLS.contains(EventFlags::LIFECYCLE));
        assert!(EventFlags::NONE
            .union(EventFlags::REJECTIONS)
            .contains(EventFlags::REJECTIONS));
    }

    #[test]
    fn interests_default_to_all() {
        // spec: 30 §4.1 (default: all events, TickInterest::All)
        assert_eq!(Interests::default(), Interests::ALL);
        assert_eq!(TickInterest::default(), TickInterest::All);
        assert_eq!(StrategyError::new("x").message(), "x");
    }
}
