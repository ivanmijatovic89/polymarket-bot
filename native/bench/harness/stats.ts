// Statistics and repetition schedule of the L1 driver (16 §13.4, §13.5).

import type { ChildUsage } from './rusage.js'

export interface Summary {
  n: number
  median: number
  min: number
  max: number
}

/** Median, min and max; never "the fastest run" alone (16 §13.5). */
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) throw new Error('summarize: no values')
  for (const v of values)
    if (!Number.isFinite(v)) throw new Error(`summarize: non-finite value ${v}`)
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const median = s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  return { n: s.length, median, min: s[0]!, max: s[s.length - 1]! }
}

export interface Slot {
  /** Arm index (0 = A, 1 = B, …). */
  arm: number
  /** Repetition number per arm, 1-based; 0 for the warm-up. */
  rep: number
  warmup: boolean
}

/**
 * One discarded warm-up per arm (configuration), then `reps` measured runs
 * per arm, interleaved ABBA across arms: forward order on odd repetitions,
 * reverse order on even ones (A B, B A, A B, …; A B C, C B A, …; 16 §13.5).
 */
export function abbaSchedule(arms: number, reps: number): Slot[] {
  if (!Number.isInteger(arms) || arms < 1) throw new Error('abbaSchedule: arms must be >= 1')
  if (!Number.isInteger(reps) || reps < 1) throw new Error('abbaSchedule: reps must be >= 1')
  const forward = Array.from({ length: arms }, (_, i) => i)
  const out: Slot[] = forward.map((a) => ({ arm: a, rep: 0, warmup: true }))
  for (let k = 0; k < reps; k++) {
    const order = k % 2 === 0 ? forward : [...forward].reverse()
    for (const a of order) out.push({ arm: a, rep: k + 1, warmup: false })
  }
  return out
}

export interface RunMetrics {
  /** Markets started. */
  markets: number
  /** Markets whose `run` exited 0 with `status` and the candidate `ok` (20 §5.4). */
  okMarkets: number
  failedMarkets: number
  wallMs: number
  /** ok markets per second; failed markets never count as throughput (R14). */
  marketsPerS: number
  /** ok market-candidates per second (one candidate per `run` job, 16 §13.4). */
  marketCandidatesPerS: number
  userMs: number
  sysMs: number
  cpuMs: number
  /** (user + sys) / (wall × logical cores), 16 §13.4. */
  cpuUtilization: number
  /** Largest child `ru_maxrss` (per executor, 16 §13.4). */
  peakRssBytes: number
  /** Median child wall time (spawn → exit). */
  childWallMedianMs: number
}

export function runMetrics(
  wallMs: number,
  children: ReadonlyArray<{ usage: ChildUsage; ok: boolean; candidates: number }>,
  logicalCores: number,
): RunMetrics {
  if (children.length === 0) throw new Error('runMetrics: no children')
  if (!(wallMs > 0)) throw new Error('runMetrics: wall time must be > 0')
  if (!(logicalCores > 0)) throw new Error('runMetrics: logical cores must be > 0')
  let userMs = 0
  let sysMs = 0
  let peakRssBytes = 0
  let okMarkets = 0
  let okCandidates = 0
  for (const c of children) {
    userMs += c.usage.userMs
    sysMs += c.usage.sysMs
    peakRssBytes = Math.max(peakRssBytes, c.usage.maxRssBytes)
    if (c.ok) {
      okMarkets++
      okCandidates += c.candidates
    }
  }
  const cpuMs = userMs + sysMs
  return {
    markets: children.length,
    okMarkets,
    failedMarkets: children.length - okMarkets,
    wallMs,
    marketsPerS: okMarkets / (wallMs / 1000),
    marketCandidatesPerS: okCandidates / (wallMs / 1000),
    userMs,
    sysMs,
    cpuMs,
    cpuUtilization: cpuMs / (wallMs * logicalCores),
    peakRssBytes,
    childWallMedianMs: summarize(children.map((c) => c.usage.realMs)).median,
  }
}

export interface LoadSample {
  /** ms since the driver started. */
  tMs: number
  load1: number
}

export function loadSummary(samples: readonly LoadSample[]): Summary | null {
  return samples.length === 0 ? null : summarize(samples.map((s) => s.load1))
}
