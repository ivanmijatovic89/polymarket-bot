//! `SharedMarket` (12 §2.1): the market state shared read-only by every
//! session (candidate) of one market during session steps (12 §14 P5).
//!
//! The driver mutates it between steps with [`SharedMarket::apply`]; sessions
//! never mutate it and never hold references into it across steps (12 §2.1).

use std::sync::Arc;

use pmb_book::{MarketBooks, TopChange};
use pmb_core::market::Window;
use pmb_core::rules::{ExchangeRules, RulesSource, RulesTimeline};
use pmb_core::{MarketInfo, Outcome, PerOutcome, TsMs};

use crate::envelope::Envelope;
use crate::feeds_view::FeedState;

/// What the driver's apply of one envelope changed, read by every session's
/// step of the same envelope (16 BK-7, 12 §5.2).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct ApplyEffect {
    /// Top-of-book change of the recorded book (16 BK-7), for the tick
    /// interest filter (16 §9.4 TF-2 (b)).
    pub top: TopChange,
    /// The event touched a stale outcome book (12 §5.2 "Stale books").
    pub stale_book: bool,
}

/// Market state shared by every session of one market (12 §2.1).
#[derive(Clone, Debug)]
pub struct SharedMarket {
    /// Market identity and window (10 §5); `Arc` so groups share it (10 P5).
    pub info: Arc<MarketInfo>,
    /// Recorded books of both outcomes (15 §2.1); never mutated by a session
    /// (13 §4.2, 15 I-5).
    pub books: MarketBooks,
    /// Last update time of each outcome book on the loop clock (30 §5.1
    /// `updated_at`).
    pub book_updated_at: PerOutcome<Option<TsMs>>,
    /// Stale flag per outcome after a `BookReset` until the next `book`
    /// (realistic, paper, live; 12 §5.2). Always `false` in ts-compat.
    pub stale: PerOutcome<bool>,
    /// Effect of the envelope most recently applied by the driver.
    pub last_apply: ApplyEffect,
    /// Rules timeline of the market (11 §13), shared read-only.
    pub rules_timeline: Arc<RulesTimeline>,
    /// Rules in force at the current exchange time (11 §7.5).
    pub rules: ExchangeRules,
    /// RS4 classification of the rules (11 §13.3, 21 §10 `rulesSource`).
    pub rules_source: RulesSource,
    /// Feed state (12 §3.2 `Feed`, 14). Stand-in until `pmb-feeds` lands.
    pub feeds: FeedState,
    /// Exchange-time skew estimate: the causal lower envelope
    /// `min(at − exchange_ts)` over market envelopes so far (12 §4.4 XT1).
    /// `None` before the first market envelope.
    pub skew_ms: Option<i64>,
    /// Condition id observed on the first counted tick (21 §11 `marketId`):
    /// `true` once a counted tick was seen.
    pub first_counted_tick_seen: bool,
}

impl SharedMarket {
    /// A market before its first envelope.
    pub fn new(
        info: Arc<MarketInfo>,
        rules_timeline: Arc<RulesTimeline>,
        rules_source: RulesSource,
    ) -> SharedMarket {
        let rules = rules_timeline.initial;
        SharedMarket {
            info,
            books: MarketBooks::new(),
            book_updated_at: PerOutcome::new(None, None),
            stale: PerOutcome::new(false, false),
            last_apply: ApplyEffect::default(),
            rules_timeline,
            rules,
            rules_source,
            feeds: FeedState::default(),
            skew_ms: None,
            first_counted_tick_seen: false,
        }
    }

    /// Strategy window `[start, end)` from the slug (10 §5).
    #[inline]
    pub fn window(&self) -> Window {
        self.info.window
    }

    /// The driver's apply of one envelope, before any session steps it
    /// (12 §2.1): market events update the recorded books, the stale flags,
    /// the top-change bit and the skew (12 §4.4); `TickSizeChange` updates
    /// the rules in force (12 §5.2); feed envelopes update the feed state;
    /// other payloads leave the market unchanged.
    pub fn apply(&mut self, _env: &Envelope<'_>) {
        todo!("core agent: driver apply (12 §2.1, §4.4, §5.2; 15 §2.1)")
    }

    /// `xnow` for a loop time (12 §4.4 XT1): `now − skew`; `now` before the
    /// first market envelope.
    #[inline]
    pub fn exchange_time(&self, now: TsMs) -> TsMs {
        crate::clock::xnow(now, self.skew_ms)
    }

    /// Loop time at which an exchange-side event due at exchange time `x`
    /// is scheduled: `max(now, x + skew)` (12 §4.4 XT3, 13 §4.3).
    #[inline]
    pub fn loop_time_of(&self, now: TsMs, x: TsMs) -> TsMs {
        crate::clock::loop_time_of(now, x, self.skew_ms)
    }

    /// Whether the outcome's book is stale (12 §5.2).
    #[inline]
    pub fn is_stale(&self, o: Outcome) -> bool {
        self.stale[o]
    }
}
