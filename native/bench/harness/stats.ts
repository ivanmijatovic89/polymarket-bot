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
  /** Binary index (0 = A, 1 = B). */
  bin: number
  /** Repetition number per binary, 1-based; 0 for the warm-up. */
  rep: number
  warmup: boolean
}

/**
 * One discarded warm-up per configuration, then `reps` measured runs per
 * binary, interleaved ABBA across two binaries (A B, B A, A B, …; 16 §13.5).
 */
export function abbaSchedule(binaries: number, reps: number): Slot[] {
  if (binaries !== 1 && binaries !== 2) throw new Error('abbaSchedule: one or two binaries')
  if (!Number.isInteger(reps) || reps < 1) throw new Error('abbaSchedule: reps must be >= 1')
  const out: Slot[] = []
  for (let b = 0; b < binaries; b++) out.push({ bin: b, rep: 0, warmup: true })
  for (let k = 0; k < reps; k++) {
    const order = binaries === 1 ? [0] : k % 2 === 0 ? [0, 1] : [1, 0]
    for (const b of order) out.push({ bin: b, rep: k + 1, warmup: false })
  }
  return out
}

export interface RunMetrics {
  markets: number
  wallMs: number
  marketsPerS: number
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
  children: readonly ChildUsage[],
  logicalCores: number,
): RunMetrics {
  if (children.length === 0) throw new Error('runMetrics: no children')
  if (!(wallMs > 0)) throw new Error('runMetrics: wall time must be > 0')
  if (!(logicalCores > 0)) throw new Error('runMetrics: logical cores must be > 0')
  let userMs = 0
  let sysMs = 0
  let peakRssBytes = 0
  for (const c of children) {
    userMs += c.userMs
    sysMs += c.sysMs
    peakRssBytes = Math.max(peakRssBytes, c.maxRssBytes)
  }
  const cpuMs = userMs + sysMs
  return {
    markets: children.length,
    wallMs,
    marketsPerS: children.length / (wallMs / 1000),
    userMs,
    sysMs,
    cpuMs,
    cpuUtilization: cpuMs / (wallMs * logicalCores),
    peakRssBytes,
    childWallMedianMs: summarize(children.map((c) => c.realMs)).median,
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
