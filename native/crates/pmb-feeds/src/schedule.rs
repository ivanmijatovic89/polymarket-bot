//! Synthetic feed tick schedule, flush and stamps for historical inputs
//! (14 §8.1, §8.2, §8.4).
//!
//! The schedule is built once per market read and shared by every candidate
//! (14 F-42). The flusher is a forward-only index the engine loop drives
//! before every real tick (14 F-40); it returns borrowed slices of the
//! schedule and never allocates.

use crate::binance::BinanceSeries;
use crate::chainlink::ChainlinkSeries;
use pmb_core::{SyntheticKind, TsMs, Window};

/// One scheduled synthetic tick: visibility time `v` and kind (14 F-39).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ScheduleEntry {
    pub v: TsMs,
    pub kind: SyntheticKind,
}

/// The window-bounded schedule (14 F-39).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SyntheticSchedule {
    entries: Box<[ScheduleEntry]>,
    scheduled: [u32; 2],
}

impl SyntheticSchedule {
    /// Every element (seed included) of each opted-in series with
    /// `start <= v <= end`, sorted by `(v, kind)` with Binance first at
    /// equal `v` and series order kept within a feed (stable sort; 14 F-39,
    /// `syntheticTickSchedule.ts:28-60`).
    pub fn build(
        binance: Option<&BinanceSeries>,
        chainlink: Option<&ChainlinkSeries>,
        window: Window,
    ) -> SyntheticSchedule {
        let (start, end) = (window.start_ms.0, window.end_ms.0);
        let mut out = Vec::new();
        let mut scheduled = [0u32; 2];
        if let Some(s) = binance {
            for i in 0..s.len() {
                let v = s.vis(i);
                if (start..=end).contains(&v) {
                    out.push(ScheduleEntry {
                        v: TsMs(v),
                        kind: SyntheticKind::BinanceAggTrade,
                    });
                }
            }
        }
        if let Some(s) = chainlink {
            for i in 0..s.len() {
                let v = s.vis(i);
                if (start..=end).contains(&v) {
                    out.push(ScheduleEntry {
                        v: TsMs(v),
                        kind: SyntheticKind::ChainlinkRound,
                    });
                }
            }
        }
        out.sort_by_key(|e| (e.v, e.kind));
        for e in &out {
            scheduled[e.kind.index()] += 1;
        }
        SyntheticSchedule {
            entries: out.into(),
            scheduled,
        }
    }

    #[inline]
    pub fn entries(&self) -> &[ScheduleEntry] {
        &self.entries
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    /// Scheduled entries of one kind (diagnostics, 14 PF-7).
    pub fn scheduled(&self, kind: SyntheticKind) -> u32 {
        self.scheduled[kind.index()]
    }
}

/// Per-session forward-only flush index (14 F-40).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SyntheticFlusher {
    next: usize,
    dispatched: [u32; 2],
    dropped_before_book: u32,
}

impl SyntheticFlusher {
    pub fn new() -> SyntheticFlusher {
        SyntheticFlusher::default()
    }

    /// Consumes every not-yet-consumed entry with `v < clock` (strict, so an
    /// equal-time real tick goes first) and returns the entries to dispatch
    /// in order before the real tick. Without a real book snapshot yet
    /// (`has_book == false`) the entries are consumed and dropped (14 F-40).
    /// A clock at or below an earlier one consumes nothing.
    #[inline]
    pub fn take_before<'s>(
        &mut self,
        schedule: &'s SyntheticSchedule,
        clock: TsMs,
        has_book: bool,
    ) -> &'s [ScheduleEntry] {
        let from = self.next;
        let entries = schedule.entries();
        let mut to = from;
        while to < entries.len() && entries[to].v < clock {
            to += 1;
        }
        self.consume(&entries[from..to], has_book)
    }

    /// The remainder after the input ends (14 F-40; TS `flushTail`).
    pub fn take_rest<'s>(
        &mut self,
        schedule: &'s SyntheticSchedule,
        has_book: bool,
    ) -> &'s [ScheduleEntry] {
        let from = self.next;
        self.consume(&schedule.entries()[from..], has_book)
    }

    #[inline]
    fn consume<'s>(&mut self, taken: &'s [ScheduleEntry], has_book: bool) -> &'s [ScheduleEntry] {
        self.next += taken.len();
        if !has_book {
            self.dropped_before_book += taken.len() as u32;
            return &[];
        }
        for e in taken {
            self.dispatched[e.kind.index()] += 1;
        }
        taken
    }

    /// Dispatched entries of one kind; these are the `binance_agg_trade` /
    /// `chainlink_round` counts of 14 §8.4 (counted before the window gate).
    pub fn dispatched(&self, kind: SyntheticKind) -> u32 {
        self.dispatched[kind.index()]
    }

    /// Entries consumed before the first book: never dispatched, never
    /// counted (14 §8.4).
    pub fn dropped_before_book(&self) -> u32 {
        self.dropped_before_book
    }
}

/// Synthetic tick stamp (14 F-41): ts-compat passes the exchange time of the
/// last real tick (out-of-window ticks included), realistic passes `now`.
#[inline]
pub fn synthetic_stamp(v: TsMs, base: TsMs) -> TsMs {
    v.max(base)
}

/// ts-compat feed clock of a real telonex-delta tick (14 §3.1, F-7):
/// `max(L, E)` when the row has a Telonex local time `L > 0`, else `E`
/// (`wireBacktestExternalFeeds.ts:59-64`). Realistic uses `now` instead
/// (12 K5).
#[inline]
pub fn ts_compat_feed_clock(exchange: TsMs, local: Option<TsMs>) -> TsMs {
    match local {
        Some(l) if l.0 > 0 => exchange.max(l),
        _ => exchange,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::FeedProfile;

    fn win(a: i64, b: i64) -> Window {
        Window {
            start_ms: TsMs(a),
            end_ms: TsMs(b),
        }
    }

    // spec: 14 F-39 (window-inclusive, (v, feed) order, series order kept)
    #[test]
    fn schedule_order() {
        // Binance ts not monotone in id order: sorted by v, ties keep series order.
        let b = BinanceSeries::from_parts(
            vec![95, 100, 105, 99, 100, 210],
            vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            true,
            0,
            FeedProfile::TsCompat,
        );
        let c =
            ChainlinkSeries::from_parts(vec![1, 2, 3], vec![90, 100, 200], vec![1.0; 3], false, 0);
        let s = SyntheticSchedule::build(Some(&b), Some(&c), win(99, 200));
        let got: Vec<(i64, SyntheticKind)> = s.entries().iter().map(|e| (e.v.0, e.kind)).collect();
        use SyntheticKind::*;
        assert_eq!(
            got,
            vec![
                (99, BinanceAggTrade),
                (100, BinanceAggTrade),
                (100, BinanceAggTrade),
                (100, ChainlinkRound),
                (105, BinanceAggTrade),
                (200, ChainlinkRound),
            ]
        );
        assert_eq!(s.scheduled(BinanceAggTrade), 4);
        assert_eq!(s.scheduled(ChainlinkRound), 2);
    }

    // spec: 14 F-40 (strict flush, pre-book consumption, forward-only, tail),
    // §8.4 (dropped entries are not counted)
    #[test]
    fn flusher_rules() {
        let b = BinanceSeries::from_parts(
            vec![10, 20, 30, 40, 50],
            vec![1.0; 5],
            false,
            0,
            FeedProfile::TsCompat,
        );
        let s = SyntheticSchedule::build(Some(&b), None, win(0, 100));
        let mut f = SyntheticFlusher::new();
        // No book yet: 10 and 20 are consumed without dispatch.
        assert!(f.take_before(&s, TsMs(25), false).is_empty());
        assert_eq!(f.dropped_before_book(), 2);
        // Equal clock: the real tick goes first (strict).
        assert!(f.take_before(&s, TsMs(30), true).is_empty());
        let got = f.take_before(&s, TsMs(31), true);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].v, TsMs(30));
        // A backward clock flushes nothing.
        assert!(f.take_before(&s, TsMs(5), true).is_empty());
        assert_eq!(f.take_rest(&s, true).len(), 2);
        assert!(f.take_rest(&s, true).is_empty());
        assert_eq!(f.dispatched(SyntheticKind::BinanceAggTrade), 3);
        assert_eq!(f.dispatched(SyntheticKind::ChainlinkRound), 0);
    }

    // spec: 14 F-41 (stamp), §3.1 (ts-compat feed clock)
    #[test]
    fn stamps_and_clock() {
        assert_eq!(synthetic_stamp(TsMs(10), TsMs(12)), TsMs(12));
        assert_eq!(synthetic_stamp(TsMs(15), TsMs(12)), TsMs(15));
        assert_eq!(ts_compat_feed_clock(TsMs(100), Some(TsMs(108))), TsMs(108));
        assert_eq!(ts_compat_feed_clock(TsMs(100), Some(TsMs(90))), TsMs(100));
        assert_eq!(ts_compat_feed_clock(TsMs(100), Some(TsMs(0))), TsMs(100));
        assert_eq!(ts_compat_feed_clock(TsMs(100), None), TsMs(100));
    }
}
