//! `SharedMarket` (12 §2.1): the market state shared read-only by every
//! session (candidate) of one market during session steps (12 §14 P5).
//!
//! The driver mutates it between steps with [`SharedMarket::apply`]; sessions
//! never mutate it and never hold references into it across steps (12 §2.1).

use std::sync::Arc;

use pmb_book::{Level, MarketBooks, Side as BookSide, TopChange};
use pmb_core::market::Window;
use pmb_core::market_event::QuoteSide;
use pmb_core::rules::{ExchangeRules, RulesSource, RulesTimeline};
use pmb_core::{MarketEvent, MarketInfo, Outcome, PerOutcome, TsMs};

use crate::envelope::{Control, Envelope, Payload};
use crate::feeds_view::{FeedObservation, FeedState};

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
    /// Next unapplied change of `rules_timeline` (forward-only, 11 X1).
    pub(crate) rules_next: usize,
}

#[inline]
fn book_side(s: QuoteSide) -> BookSide {
    match s {
        QuoteSide::Bid => BookSide::Bid,
        QuoteSide::Ask => BookSide::Ask,
    }
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
            rules_next: 0,
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
    pub fn apply(&mut self, env: &Envelope<'_>) {
        let mut effect = ApplyEffect::default();
        match env.payload {
            Payload::Market(ev) => {
                // 12 §4.4 XT1: causal lower envelope over market envelopes.
                if let Some(x) = env.exchange_ts {
                    let d = env.at.0 - x.0;
                    self.skew_ms = Some(self.skew_ms.map_or(d, |s| s.min(d)));
                }
                self.apply_market(&ev, env.at, &mut effect);
                self.advance_rules(env.at);
            }
            Payload::Feed(obs) => {
                // Stand-in feed state (pmb-feeds integration replaces it).
                let ts = match obs {
                    FeedObservation::BinanceAggTrade { ts, .. }
                    | FeedObservation::ChainlinkRound { ts, .. } => ts,
                    FeedObservation::PriceToBeat { .. } => env.at,
                };
                self.feeds.clock = Some(self.feeds.clock.map_or(ts, |c| c.max(ts)));
            }
            Payload::Control(Control::DataGap(scope)) => {
                // 15 I-6f: the outcome book (or both) is stale until its next
                // `book` (realistic, paper, live; 12 §5.2).
                self.books.reset(scope);
                for o in Outcome::ALL {
                    if scope.is_none() || scope == Some(o) {
                        self.stale[o] = true;
                    }
                }
            }
            Payload::Control(_)
            | Payload::SyntheticTick(_)
            | Payload::Account(_)
            | Payload::Timer(_) => {}
        }
        self.last_apply = effect;
    }

    fn apply_market(&mut self, ev: &MarketEvent<'_>, at: TsMs, effect: &mut ApplyEffect) {
        fn merge(effect: &mut ApplyEffect, t: TopChange) {
            effect.top.price |= t.price;
            effect.top.size |= t.size;
        }
        match *ev {
            MarketEvent::Book {
                outcome,
                bids,
                asks,
            } => {
                let lv = |l: &pmb_core::PriceSize| Level {
                    price: l.price,
                    size: l.size,
                };
                let t =
                    self.books
                        .apply_snapshot(outcome, bids.iter().map(lv), asks.iter().map(lv));
                merge(effect, t);
                self.stale[outcome] = false;
                self.book_updated_at[outcome] = Some(at);
                self.first_counted_tick_seen = true;
            }
            MarketEvent::PriceChange { changes } => {
                for c in changes {
                    let t = self
                        .books
                        .apply_level(c.outcome, book_side(c.side), c.price, c.size);
                    merge(effect, t);
                    self.book_updated_at[c.outcome] = Some(at);
                    effect.stale_book |= self.stale[c.outcome];
                }
                self.first_counted_tick_seen = true;
            }
            MarketEvent::LastTrade { outcome, .. } => {
                self.books.touch(outcome);
            }
            MarketEvent::TickSizeChange { outcome, tick } => {
                // 11 §7.5, 12 §5.2: updates the rules in force; never a tick.
                self.books.touch(outcome);
                self.rules.tick[outcome] = tick;
            }
        }
    }

    /// Applies every dated change of the rules timeline at or before the
    /// exchange time of `at` (11 §7.5, X1; 12 §4.4 XT3).
    fn advance_rules(&mut self, at: TsMs) {
        let x = self.exchange_time(at);
        let changes = &self.rules_timeline.changes;
        while let Some(&(t, c)) = changes.get(self.rules_next) {
            if t > x {
                break;
            }
            match c {
                pmb_core::rules::RulesChange::Tick { outcome, tick, .. } => {
                    self.rules.tick[outcome] = tick
                }
                pmb_core::rules::RulesChange::TakerDelay(d) => self.rules.taker_delay = d,
            }
            self.rules_next += 1;
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::{Control, Source};
    use pmb_core::ids::{ConditionId, Hash32, TokenId};
    use pmb_core::market::MarketVersion;
    use pmb_core::rules::{RulesChange, RulesProvenance, RulesTableVersion, TickOrigin};
    use pmb_core::{LevelUpdate, Price, PriceSize, Qty};

    fn market(changes: Vec<(TsMs, RulesChange)>) -> SharedMarket {
        let info = MarketInfo::new(
            "btc-updown-15m-1780272000",
            ConditionId(Hash32([7; 32])),
            PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
            MarketVersion::V2,
            false,
        )
        .unwrap();
        let start = info.window.start_ms;
        let initial = ExchangeRules::realistic_fallback(RulesTableVersion::V1, start, start);
        let tl = RulesTimeline::new(
            initial,
            changes,
            RulesProvenance::all_fallback(RulesTableVersion::V1),
            RulesTableVersion::V1,
            pmb_core::rules::fee_era(RulesTableVersion::V1, start).id,
        );
        SharedMarket::new(Arc::new(info), Arc::new(tl), RulesSource::Fallback)
    }

    fn env(at: i64, ex: Option<i64>, payload: Payload<'_>) -> Envelope<'_> {
        Envelope {
            seq: 0,
            at: TsMs(at),
            exchange_ts: ex.map(TsMs),
            recv_wall: None,
            recv_mono: None,
            source: Source::MarketWs,
            payload,
        }
    }

    fn ps(p: i64, s: i64) -> PriceSize {
        PriceSize {
            price: Price::from_micros(p),
            size: Qty::from_micros(s),
        }
    }

    #[test]
    fn skew_is_the_causal_lower_envelope() {
        // spec: 12 §4.4 XT1 (skew = min(at − exchange_ts) over market envelopes)
        let mut m = market(vec![]);
        assert_eq!(m.exchange_time(TsMs(1_000)), TsMs(1_000));
        let b = [ps(400_000, 1_000_000)];
        let book = |at, ex| {
            env(
                at,
                Some(ex),
                Payload::Market(MarketEvent::Book {
                    outcome: Outcome::Up,
                    bids: &b,
                    asks: &[],
                }),
            )
        };
        m.apply(&book(1_050, 1_000));
        assert_eq!(m.skew_ms, Some(50));
        m.apply(&book(2_020, 2_000));
        m.apply(&book(3_100, 3_000));
        assert_eq!(m.skew_ms, Some(20));
        assert_eq!(m.exchange_time(TsMs(5_000)), TsMs(4_980));
        assert_eq!(m.loop_time_of(TsMs(5_000), TsMs(6_000)), TsMs(6_020));
        assert!(m.first_counted_tick_seen);
        assert_eq!(m.book_updated_at[Outcome::Up], Some(TsMs(3_100)));
    }

    #[test]
    fn tick_size_change_and_timeline_update_the_rules_in_force() {
        // spec: 12 §5.2 (TickSizeChange updates the rules; never a tick),
        // 11 §7.5, X1 (timeline applied at exchange time)
        let start = 1_780_272_000_000;
        let mut m = market(vec![(
            TsMs(start + 500),
            RulesChange::Tick {
                outcome: Outcome::Down,
                tick: Price::from_micros(1_000),
                origin: TickOrigin::Event,
            },
        )]);
        m.apply(&env(
            start + 10,
            Some(start),
            Payload::Market(MarketEvent::TickSizeChange {
                outcome: Outcome::Up,
                tick: Price::from_micros(1_000),
            }),
        ));
        assert_eq!(m.rules.tick[Outcome::Up], Price::from_micros(1_000));
        assert_eq!(m.rules.tick[Outcome::Down], Price::from_micros(10_000));
        // Exchange time = at − skew(10) = start + 500 reaches the change.
        m.apply(&env(
            start + 510,
            Some(start + 600),
            Payload::Market(MarketEvent::LastTrade {
                outcome: Outcome::Down,
                price: Price::from_micros(500_000),
                size: Qty::from_micros(1_000_000),
                side: None,
            }),
        ));
        assert_eq!(m.rules.tick[Outcome::Down], Price::from_micros(1_000));
    }

    #[test]
    fn top_change_bit_and_stale_flags() {
        // spec: 16 BK-7 (top-change bit per applied event), 12 §5.2 stale books
        let mut m = market(vec![]);
        let b = [ps(400_000, 1_000_000)];
        let a = [ps(600_000, 1_000_000)];
        m.apply(&env(
            1,
            Some(1),
            Payload::Market(MarketEvent::Book {
                outcome: Outcome::Up,
                bids: &b,
                asks: &a,
            }),
        ));
        assert!(m.last_apply.top.price);
        let size_only = [LevelUpdate {
            outcome: Outcome::Up,
            side: QuoteSide::Bid,
            price: Price::from_micros(400_000),
            size: Qty::from_micros(2_000_000),
        }];
        m.apply(&env(
            2,
            Some(2),
            Payload::Market(MarketEvent::PriceChange {
                changes: &size_only,
            }),
        ));
        assert!(!m.last_apply.top.price && m.last_apply.top.size);
        m.apply(&env(3, None, Payload::Control(Control::DataGap(None))));
        assert!(m.is_stale(Outcome::Up) && m.is_stale(Outcome::Down));
        m.apply(&env(
            4,
            Some(4),
            Payload::Market(MarketEvent::PriceChange {
                changes: &size_only,
            }),
        ));
        assert!(m.last_apply.stale_book);
        m.apply(&env(
            5,
            Some(5),
            Payload::Market(MarketEvent::Book {
                outcome: Outcome::Up,
                bids: &b,
                asks: &a,
            }),
        ));
        assert!(!m.is_stale(Outcome::Up));
        assert!(m.is_stale(Outcome::Down));
    }
}
