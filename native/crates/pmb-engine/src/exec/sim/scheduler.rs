//! Discrete-event scheduler (13 §4.3): actions ordered by (time, class,
//! seq), class 0 exchange-side before class 1 `Deliver`; a binary heap whose
//! capacity is reused for the whole session (13 §10); `SelfTimed` and
//! `Journaled` modes (13 §2.3).
//!
//! The scheduler is generic over the action payload; it knows nothing about
//! orders. The order key `(time, class, seq)` is total because `seq` is a
//! per-session counter, so the pop order never depends on heap internals
//! (R7).

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use pmb_core::TsMs;

/// Action class (13 §4.3): at equal time every exchange-side action runs
/// before any `Deliver`, so a report never precedes its cause.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ActionClass {
    /// `PlaceArrive`, `CancelArrive`, `DelayRelease`, `GtdExpire`,
    /// `MarketClose`, `ChainComplete`.
    Exchange = 0,
    /// `Deliver{report}`.
    Deliver = 1,
}

/// How due actions are released (13 §2.3, §5.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SchedulerMode {
    /// Backtest: the loop runs every action due strictly before the next
    /// envelope (12 §5.1 step (a)) through `next_due`/`run_next_due`.
    SelfTimed,
    /// Paper, CLOB V2 and journal replay: actions run only on `Timer(due)`
    /// envelopes (13 §2.3 TS1–TS4).
    Journaled,
}

/// One scheduled entry. Ordered by `(time, class, seq)` only; the payload
/// never takes part in the comparison.
#[derive(Copy, Clone, Debug)]
struct Entry<A> {
    time: TsMs,
    class: ActionClass,
    seq: u64,
    action: A,
}

impl<A> Entry<A> {
    #[inline]
    fn key(&self) -> (TsMs, ActionClass, u64) {
        (self.time, self.class, self.seq)
    }
}

impl<A> PartialEq for Entry<A> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.key() == other.key()
    }
}

impl<A> Eq for Entry<A> {}

impl<A> PartialOrd for Entry<A> {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<A> Ord for Entry<A> {
    /// Reversed, so the max-heap `BinaryHeap` pops the smallest key first.
    #[inline]
    fn cmp(&self, other: &Self) -> Ordering {
        other.key().cmp(&self.key())
    }
}

/// A scheduled action as popped: its due time, class and sequence number.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Due<A> {
    /// Due time on the loop clock (exchange-side actions are placed at
    /// `max(now, x + skew)`, 12 §4.4 XT3).
    pub time: TsMs,
    /// Class (13 §4.3).
    pub class: ActionClass,
    /// Per-session scheduling counter.
    pub seq: u64,
    /// The action.
    pub action: A,
}

/// The discrete-event scheduler of one session (13 §4.3). O(log n) per
/// action; no allocation once the heap reached its working size (13 X1).
#[derive(Clone, Debug)]
pub struct Scheduler<A> {
    heap: BinaryHeap<Entry<A>>,
    next_seq: u64,
}

impl<A> Default for Scheduler<A> {
    fn default() -> Self {
        Self::new()
    }
}

impl<A> Scheduler<A> {
    /// An empty scheduler.
    pub fn new() -> Self {
        Scheduler {
            heap: BinaryHeap::new(),
            next_seq: 0,
        }
    }

    /// Schedules `action` at `time`; returns its `seq` (13 §4.3: `seq` is a
    /// per-session scheduling counter, so equal `(time, class)` keep push
    /// order).
    #[inline]
    pub fn push(&mut self, time: TsMs, class: ActionClass, action: A) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.heap.push(Entry {
            time,
            class,
            seq,
            action,
        });
        seq
    }

    /// Earliest due time, if any action is scheduled.
    #[inline]
    pub fn peek_time(&self) -> Option<TsMs> {
        self.heap.peek().map(|e| e.time)
    }

    /// Pops the first action in `(time, class, seq)` order if it is due at
    /// or before `limit`.
    #[inline]
    pub fn pop_due(&mut self, limit: TsMs) -> Option<Due<A>> {
        if self.heap.peek()?.time > limit {
            return None;
        }
        self.heap.pop().map(|e| Due {
            time: e.time,
            class: e.class,
            seq: e.seq,
            action: e.action,
        })
    }

    /// Pops the first action if it is due at exactly `t` (13 §2.2
    /// `run_next_due`: every action sharing one due time, in (class, seq)
    /// order).
    #[inline]
    pub fn pop_at(&mut self, t: TsMs) -> Option<Due<A>> {
        if self.heap.peek()?.time != t {
            return None;
        }
        self.pop_due(t)
    }

    /// Number of scheduled actions.
    #[inline]
    pub fn len(&self) -> usize {
        self.heap.len()
    }

    /// Whether nothing is scheduled.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    /// Drops every scheduled action, keeping capacity; returns how many were
    /// dropped (ts-compat end of stream, 13 TC-C13).
    pub fn discard_all(&mut self) -> usize {
        let n = self.heap.len();
        self.heap.clear();
        n
    }

    /// Rewrites every scheduled payload in place (used to compact side
    /// storage the payloads point into). Rebuilding a heap from its own
    /// vector is O(n) and keeps the allocation; keys are unchanged, so the
    /// pop order is unchanged.
    pub fn rewrite(&mut self, mut f: impl FnMut(&mut A)) {
        let mut v = std::mem::take(&mut self.heap).into_vec();
        for e in v.iter_mut() {
            f(&mut e.action);
        }
        self.heap = BinaryHeap::from(v);
    }

    /// Visits every scheduled payload in unspecified order (read-only
    /// checks; never used for output).
    pub fn for_each(&self, mut f: impl FnMut(&A)) {
        for e in self.heap.iter() {
            f(&e.action);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pops_in_time_class_seq_order() {
        // spec: 13 §4.3 (order (time, class, seq); class 0 before Deliver)
        let mut s: Scheduler<&'static str> = Scheduler::new();
        s.push(TsMs(20), ActionClass::Exchange, "c");
        s.push(TsMs(10), ActionClass::Deliver, "b-deliver");
        s.push(TsMs(10), ActionClass::Exchange, "a1");
        s.push(TsMs(10), ActionClass::Exchange, "a2");
        s.push(TsMs(5), ActionClass::Deliver, "first");
        let order: Vec<_> = std::iter::from_fn(|| s.pop_due(TsMs(100)).map(|d| d.action)).collect();
        assert_eq!(order, vec!["first", "a1", "a2", "b-deliver", "c"]);
    }

    #[test]
    fn pop_due_respects_limit_and_pop_at_exact_time() {
        // spec: 13 §2.2 run_next_due (exactly next_due), 12 §5.1 strict "<"
        let mut s: Scheduler<u8> = Scheduler::new();
        s.push(TsMs(10), ActionClass::Exchange, 1);
        s.push(TsMs(11), ActionClass::Exchange, 2);
        assert_eq!(s.pop_due(TsMs(9)), None);
        assert_eq!(s.pop_at(TsMs(11)), None);
        assert_eq!(s.peek_time(), Some(TsMs(10)));
        let d = s.pop_at(TsMs(10)).expect("due");
        assert_eq!((d.time, d.seq, d.action), (TsMs(10), 0, 1));
        assert_eq!(s.pop_at(TsMs(10)), None);
        assert_eq!(s.len(), 1);
        assert_eq!(s.discard_all(), 1);
        assert!(s.is_empty());
        // seq keeps counting after a discard (per-session counter).
        assert_eq!(s.push(TsMs(1), ActionClass::Exchange, 3), 2);
    }

    #[test]
    fn rewrite_keeps_order_and_capacity() {
        // spec: 13 §4.3 (reused heap), 13 §10 (no steady-state allocation)
        let mut s: Scheduler<u32> = Scheduler::new();
        for i in 0..32u32 {
            s.push(TsMs(i64::from(31 - i)), ActionClass::Exchange, i);
        }
        let cap = s.heap.capacity();
        s.rewrite(|a| *a += 100);
        assert_eq!(s.heap.capacity(), cap);
        let first = s.pop_due(TsMs(1_000)).expect("due");
        assert_eq!((first.time, first.action), (TsMs(0), 131));
    }
}
