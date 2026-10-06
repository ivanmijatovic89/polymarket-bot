import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { runSingleMarket } from '../runSingleMarket.js'
import { resolveSimulatorMarket } from './resolveMarket.js'
import { TraceWriter, writeJsonAtomic } from './traceWriter.js'
import type { TraceManifest, ComparisonRow } from './contracts.js'

export async function captureTrace(
  runId: number,
  slug: string,
  directory: string,
  progress: (ticks: number) => void = () => {},
): Promise<TraceManifest> {
  mkdirSync(directory, { recursive: true })
  const inputDirectory = path.join(directory, 'input')
  mkdirSync(inputDirectory, { recursive: true })
  try {
    const resolved = await resolveSimulatorMarket(runId, slug, inputDirectory)
    return await captureResolvedTrace(resolved, directory, progress)
  } finally {
    // Only this session's downloads; original local datasets are never copied here or deleted.
    rmSync(inputDirectory, { recursive: true, force: true })
  }
}

/** Shared CLI/simulator execution; injectable resolved inputs make parity testable without a database. */
export async function captureResolvedTrace(
  resolved: Pick<
    Awaited<ReturnType<typeof resolveSimulatorMarket>>,
    'input' | 'provenance' | 'tokens'
  > & {
    expected: {
      [K in
        | 'pnl'
        | 'cost'
        | 'upShares'
        | 'downShares'
        | 'mergableShares'
        | 'feesPaid'
        | 'splitCost'
        | 'tradeCount'
        | 'tradeAsMaker'
        | 'tradeAsTaker']: number | string
    } & { eventsProcessed: number | null }
  },
  directory: string,
  progress: (ticks: number) => void = () => {},
): Promise<TraceManifest> {
  const writer = new TraceWriter(directory, resolved.tokens, progress)
  const result = await runSingleMarket({ ...resolved.input, observer: writer.observer })
  writer.finish()
  if (result.skipReason && result.skipReason !== 'no_activity') {
    throw new Error(
      `Replay skipped: ${result.skipReason}${result.coverageReasons?.length ? ` (${result.coverageReasons.join('; ')})` : ''}. Use an explicitly admitted outage backtest to inspect incomplete captures.`,
    )
  }
  const fields = [
    'pnl',
    'cost',
    'upShares',
    'downShares',
    'mergableShares',
    'feesPaid',
    'splitCost',
    'tradeCount',
    'tradeAsMaker',
    'tradeAsTaker',
  ] as const
  const comparison: ComparisonRow[] = fields.map((field) => {
    const saved = Number(resolved.expected[field])
    const replay = result.marketStats?.[field] ?? (result.skipReason === 'no_activity' ? 0 : null)
    return { field, saved, replay, matches: replay !== null && Math.abs(saved - replay) < 0.00005 }
  })
  if (resolved.expected.eventsProcessed !== null)
    comparison.push({
      field: 'eventsProcessed',
      saved: Number(resolved.expected.eventsProcessed),
      replay: result.eventsProcessed,
      matches: Number(resolved.expected.eventsProcessed) === result.eventsProcessed,
    })
  const manifest: TraceManifest = {
    version: 1,
    provenance: resolved.provenance,
    chunks: writer.chunks,
    actions: writer.actions,
    chart: writer.chart,
    ticks: writer.ticks,
    eventsProcessed: result.eventsProcessed,
    startTime: writer.chunks[0]?.startTime ?? 0,
    endTime: writer.chunks.at(-1)?.endTime ?? 0,
    comparison,
    resultMatches: comparison.every((r) => r.matches),
    durationMs: result.durationMs,
  }
  writeJsonAtomic(path.join(directory, 'manifest.json'), manifest)
  return manifest
}
