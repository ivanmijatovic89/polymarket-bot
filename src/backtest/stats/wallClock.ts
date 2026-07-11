// Pure compute for backtest "wall-clock" elapsed time.
//
// A backtest runs many markets in parallel across workers/machines, and an
// `--extend` re-runs the same run hours later. Naively taking
// `max(finishedAt) - min(startedAt)` over the markets counts the idle gap
// between those disjoint processing windows as if the run had been busy the
// whole time (e.g. 6.4h reported for ~18m of actual work).
//
// The correct measure is the total length of the UNION of the per-market
// [start, end] busy intervals: overlapping intervals (parallel workers) count
// once, and idle gaps between disjoint windows are excluded. This is the
// "real elapsed time during which at least one worker was busy".
//
// No DB access — caller supplies the intervals. Lives in the shared stats
// package so the engine (write-time, persisted per segment) and the dashboard
// (live recompute on the detail page) use the exact same formula and can never
// drift.

/** A single busy interval, `[startMs, endMs]`. */
export type BusyInterval = readonly [start: number, end: number]

/**
 * Total milliseconds covered by the union of the given busy intervals.
 *
 * Overlapping intervals are merged (shared time counted once); disjoint
 * intervals contribute their individual lengths but NOT the gaps between them.
 * Zero- and negative-width intervals (`end <= start`, e.g. clock skew) are
 * ignored. Returns `0` for empty input.
 */
export function unionBusyMs(intervals: Iterable<BusyInterval>): number {
  const sorted = [...intervals].filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])

  let total = 0
  let curStart: number | null = null
  let curEnd = 0
  for (const [start, end] of sorted) {
    if (curStart === null) {
      curStart = start
      curEnd = end
    } else if (start <= curEnd) {
      // Overlapping or adjacent — extend the current merged interval.
      if (end > curEnd) curEnd = end
    } else {
      // Gap — close the current interval and start a new one.
      total += curEnd - curStart
      curStart = start
      curEnd = end
    }
  }
  if (curStart !== null) total += curEnd - curStart
  return total
}
