/**
 * Mapping from the engine's `EngineMarketOutput` (21 §11) to the TS-owned
 * `RunSingleMarketOutput` / `MarketStats` the rest of the app consumes
 * unchanged (21 P1), with the execution metadata the shim stamps (21 §12).
 * Type-checked against the real TS types, so a contract change that breaks
 * the TS shapes fails `tsc` (21 §3 CI item 3).
 */
import type { RunSingleMarketOutput } from '../../backtest/runSingleMarket.js'
import type { MarketExecutionMeta, MarketStats } from '../../backtest/stats/marketStats.js'
import type { RecorderV4Capture } from '../../recorder-v4/replay/provenance.js'
import type { EngineMarketOutput, EventsByType } from './generated.js'

/** Shim-stamped execution fields (21 §12); events come from the engine. */
export type ExecutionStamps = Omit<MarketExecutionMeta, 'eventsProcessed' | 'eventsByType'>

/**
 * `durationMs` per candidate (21 §12): the whole span for one candidate;
 * `floor(w × span / k)` for a group of `k` candidates admitted with token
 * weight `w` (40 §7.1, 41 §7.4).
 */
export function candidateDurationMs(
  startedAtMs: number,
  finishedAtMs: number,
  group?: { weight: number; candidates: number },
): number {
  const span = finishedAtMs - startedAtMs
  if (!Number.isSafeInteger(span) || span < 0) {
    throw new Error(`native shim: bad execution span ${startedAtMs}..${finishedAtMs}`)
  }
  if (!group) return span
  const { weight, candidates } = group
  if (
    !Number.isSafeInteger(weight) ||
    weight < 1 ||
    !Number.isSafeInteger(candidates) ||
    candidates < 1
  ) {
    throw new Error(`native shim: bad group weight ${weight} or size ${candidates}`)
  }
  return Math.floor((weight * span) / candidates)
}

function eventsRecord(e: EventsByType): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}

/**
 * Builds the `RunSingleMarketOutput` of one candidate (21 §11 table):
 * `idx` and `durationMs` from the shim, `marketStats.execution` stamped for
 * every non-null `marketStats`, `recorderV4Capture` from the V4 manifest.
 *
 * `marketStats.rules` (11 §13.8) has no TS `MarketStats` field yet, so a
 * non-null value fails loud instead of being dropped (R14); ts-compat emits
 * null.
 */
export function toRunSingleMarketOutput(
  out: EngineMarketOutput,
  idx: number,
  stamps: ExecutionStamps,
  recorderV4Capture?: RecorderV4Capture,
): RunSingleMarketOutput {
  const eventsByType = eventsRecord(out.eventsByType)
  let marketStats: MarketStats | null = null
  if (out.marketStats !== null) {
    const { rules, skipReason, ...stats } = out.marketStats
    if (rules !== null) {
      throw new Error(
        'native shim: marketStats.rules is set but TS MarketStats has no rules field yet (11 §13.8)',
      )
    }
    marketStats = {
      ...stats,
      ...(skipReason === undefined ? {} : { skipReason }),
      ...(recorderV4Capture === undefined ? {} : { recorderV4Capture }),
      execution: { ...stamps, eventsProcessed: out.eventsProcessed, eventsByType },
    }
  }
  return {
    idx,
    slug: out.slug,
    marketStats,
    eventsProcessed: out.eventsProcessed,
    eventsByType,
    durationMs: stamps.durationMs,
    ...(out.skipReason === undefined ? {} : { skipReason: out.skipReason }),
    ...(out.coverageReasons === undefined ? {} : { coverageReasons: out.coverageReasons }),
  }
}
