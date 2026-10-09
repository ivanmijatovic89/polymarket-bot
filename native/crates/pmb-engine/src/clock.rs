//! Clocks of the loop (12 §4.2): the loop clock `now`, the strategy-visible
//! tick time, the exchange-time estimate `xnow`, the TS event clock and the
//! decision stamp.
//!
//! The core never reads the wall clock or the environment (12 K1, R7).

use pmb_core::TsMs;

use crate::core_rules::CoreRules;

/// Origin of a decision (22 §2 `Decision.origin`, 12 §4.2 decision stamp).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum DecisionOrigin {
    /// Tick callback.
    Tick,
    /// Account-event callback.
    Account,
    /// Engine-originated intents (window end, kill switch, panic handling,
    /// operator, rotation; 12 §8.3).
    Engine,
}

/// TS `portfolio.nowMs` (12 §4.2 `event_clock`): set by the first dispatched
/// strategy tick, then the max over timestamps of delivered account events;
/// ticks do not advance it (`src/trading/Portfolio.ts:148-153, 434-437`).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct EventClock(Option<TsMs>);

impl EventClock {
    /// Set by the first dispatched strategy tick only (`StrategyRunner.ts:314`).
    #[inline]
    pub fn init_if_unset(&mut self, tick_ts: TsMs) {
        if self.0.is_none() {
            self.0 = Some(tick_ts);
        }
    }

    /// A delivered account event at `at` advances the clock to the max
    /// (12 §4.2). Before the first tick an event also sets it.
    #[inline]
    pub fn on_delivered(&mut self, at: TsMs) {
        self.0 = Some(match self.0 {
            Some(c) if c.0 >= at.0 => c,
            _ => at,
        });
    }

    /// The clock value; `None` before the first tick and event (30 §5
    /// `event_clock()` returns the loop `now` then; D-PENDING in the core).
    #[inline]
    pub fn get(self) -> Option<TsMs> {
        self.0
    }
}

/// The clocks of one session (12 §4.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Clocks {
    /// Loop clock: high-water of envelope `at` and executed scheduled action
    /// times (12 §4.2, K2).
    pub now: TsMs,
    /// Strategy-visible tick time of the last dispatched strategy tick
    /// (12 §4.2 `tick.ts`). Realistic: `now` at dispatch. ts-compat: the TS
    /// tick timestamp, which can step back after a synthetic tick (TC-C11).
    pub tick_ts: TsMs,
    /// TS event clock (12 §4.2).
    pub event_clock: EventClock,
}

impl Clocks {
    /// Clocks before the first envelope.
    pub const fn new(start: TsMs) -> Clocks {
        Clocks {
            now: start,
            tick_ts: start,
            event_clock: EventClock(None),
        }
    }

    /// `now = max(now, t)` (12 §4.2, K2). Returns the new `now`.
    #[inline]
    pub fn advance(&mut self, t: TsMs) -> TsMs {
        if t.0 > self.now.0 {
            self.now = t;
        }
        self.now
    }

    /// Decision stamp of intents (12 §4.2): realistic `now`; ts-compat the
    /// tick ts for tick intents and the last tick's ts for callback intents
    /// (TC-C8, `StrategyRunner.ts:455-458, 679`). Engine-originated intents
    /// use `now` in both profiles.
    #[inline]
    pub fn decision_stamp(&self, rules: CoreRules, origin: DecisionOrigin) -> TsMs {
        match (rules, origin) {
            (CoreRules::TsCompat, DecisionOrigin::Tick | DecisionOrigin::Account) => self.tick_ts,
            _ => self.now,
        }
    }
}

/// `xnow = now − skew` (12 §4.4 XT1); `now` when no skew is known yet.
#[inline]
pub fn xnow(now: TsMs, skew_ms: Option<i64>) -> TsMs {
    match skew_ms {
        Some(s) => TsMs(now.0 - s),
        None => now,
    }
}

/// Loop time of an exchange-side event due at exchange time `x`:
/// `max(now, x + skew)` with the skew read when scheduling (12 §4.4 XT3,
/// 13 §4.3).
#[inline]
pub fn loop_time_of(now: TsMs, x: TsMs, skew_ms: Option<i64>) -> TsMs {
    let t = x.0 + skew_ms.unwrap_or(0);
    if t < now.0 {
        now
    } else {
        TsMs(t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_is_monotone_high_water() {
        // spec: 12 §4.2, K2
        let mut c = Clocks::new(TsMs(100));
        assert_eq!(c.advance(TsMs(150)), TsMs(150));
        assert_eq!(c.advance(TsMs(120)), TsMs(150));
        assert_eq!(c.now, TsMs(150));
    }

    #[test]
    fn event_clock_set_by_first_tick_then_max_of_events() {
        // spec: 12 §4.2 event_clock
        let mut e = EventClock::default();
        assert_eq!(e.get(), None);
        e.init_if_unset(TsMs(10));
        e.init_if_unset(TsMs(20));
        assert_eq!(e.get(), Some(TsMs(10)));
        e.on_delivered(TsMs(15));
        e.on_delivered(TsMs(12));
        assert_eq!(e.get(), Some(TsMs(15)));
    }

    #[test]
    fn decision_stamp_per_profile() {
        // spec: 12 §4.2 decision stamp, 13 TC-C8
        let mut c = Clocks::new(TsMs(0));
        c.advance(TsMs(500));
        c.tick_ts = TsMs(400);
        assert_eq!(
            c.decision_stamp(CoreRules::TsCompat, DecisionOrigin::Tick),
            TsMs(400)
        );
        assert_eq!(
            c.decision_stamp(CoreRules::TsCompat, DecisionOrigin::Account),
            TsMs(400)
        );
        assert_eq!(
            c.decision_stamp(CoreRules::TsCompat, DecisionOrigin::Engine),
            TsMs(500)
        );
        assert_eq!(
            c.decision_stamp(CoreRules::Realistic, DecisionOrigin::Tick),
            TsMs(500)
        );
        assert_eq!(
            c.decision_stamp(CoreRules::Realistic, DecisionOrigin::Account),
            TsMs(500)
        );
    }

    #[test]
    fn exchange_time_estimate_and_scheduling() {
        // spec: 12 §4.4 XT1, XT3
        assert_eq!(xnow(TsMs(1_000), None), TsMs(1_000));
        assert_eq!(xnow(TsMs(1_000), Some(40)), TsMs(960));
        assert_eq!(loop_time_of(TsMs(1_000), TsMs(990), Some(40)), TsMs(1_030));
        assert_eq!(loop_time_of(TsMs(1_000), TsMs(900), Some(40)), TsMs(1_000));
        assert_eq!(loop_time_of(TsMs(1_000), TsMs(1_200), None), TsMs(1_200));
    }
}
