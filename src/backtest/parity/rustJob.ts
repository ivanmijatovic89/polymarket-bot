import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MarketJobData } from '../jobTypes.js'
import { REPO_ROOT, canonicalJsonLoose, type ParityCell } from './cell.js'

/**
 * The Rust side of a parity cell (60 HR-1, HR-2): the harness builds the
 * native job with the cell's Rust strategy id and ModelConfig, and the
 * `EngineJob` comes from `src/native/buildEngineJob` (01 §6 M1 step 6,
 * 21 §5, §9), the builder later shared by `--sequential` and the worker shim.
 *
 * `src/native/` is owned by another workstream; it is loaded dynamically so
 * this tooling compiles before it exists, and a missing builder is a loud
 * error (R14), never a harness-local substitute.
 */

/** The native `MarketJobData` of 21 §4 as far as the harness fills it. */
export type NativeMarketJob = Omit<MarketJobData, 'strategyId'> & {
  strategyId: string
  modelConfig: ParityCell['modelConfig']
}

/** `buildEngineJob(MarketJobData, dataRoots)` (01 §6 M1 step 6). */
export type BuildEngineJob = (job: NativeMarketJob, dataRoots: { dataRoot: string }) => unknown

// D-PENDING: 01 §6 names `buildEngineJob(MarketJobData, dataRoots)` without fixing the module path or the dataRoots shape; chose `src/native/buildEngineJob.ts` (or `src/native/index.ts`) exporting `buildEngineJob(job, { dataRoot })`.
const BUILDER_CANDIDATES = ['src/native/buildEngineJob.ts', 'src/native/index.ts']

/**
 * Load `buildEngineJob` from src/native, or from `override` (a module path;
 * harness self-tests only — such a run is non-gating).
 */
export async function loadEngineJobBuilder(override?: string): Promise<BuildEngineJob> {
  const candidates = override
    ? [path.resolve(override)]
    : BUILDER_CANDIDATES.map((rel) => path.join(REPO_ROOT, rel))
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const mod = (await import(pathToFileURL(file).href)) as { buildEngineJob?: unknown }
    if (typeof mod.buildEngineJob === 'function') return mod.buildEngineJob as BuildEngineJob
  }
  if (override) throw new Error(`--engine-job-builder ${override} does not export buildEngineJob`)
  throw new Error(
    `--rust-bin needs src/native's buildEngineJob (looked in ${BUILDER_CANDIDATES.join(', ')}); ` +
      'it is delivered by the src/native workstream (01 §6 M1 step 6)',
  )
}

/** HR-1: each side gets its own strategy id; the Rust job carries the cell's ModelConfig (21 §4). */
export function nativeJobFor(tsJob: MarketJobData, cell: ParityCell): NativeMarketJob {
  return { ...tsJob, strategyId: cell.rustStrategyId, modelConfig: cell.modelConfig }
}

/** 21 §5.1: `EngineJob.run.strategyId` equals the binary's id (HR-1). */
export function assertEngineJobStrategy(engineJob: unknown, cell: ParityCell): void {
  const run = (engineJob as { run?: { strategyId?: unknown } } | null)?.run
  if (run?.strategyId !== cell.rustStrategyId)
    throw new Error(
      `EngineJob.run.strategyId ${JSON.stringify(run?.strategyId)} != cell rustStrategyId ${cell.rustStrategyId}`,
    )
}

/** HR-2: `<bin> run --job <EngineJob> --trace <file> --trace-level <level>` (20 §5.4). */
export function rustRunArgs(jobFile: string, traceFile: string, level: string): string[] {
  return ['run', '--job', jobFile, '--trace', traceFile, '--trace-level', level]
}

/**
 * Pre-flight against the Rust binary's `describe` (20 §5.1): the strategy id
 * is the cell's Rust id (HR-1, D20), the binary writes the same trace format
 * (22 §3), supports the cell's profile and input mode, and normalizes the
 * cell params to the TS params with the same `requiredFeeds`, so both sides
 * run the same configuration and producer eligibility is identical.
 * Returns the list of problems (empty when compatible).
 */
// D-PENDING: 60 §5.7 says run-parity refuses an exerciser schedule version mismatch, but `describe` (20 §5.1) has no field for it; chose to compare id, params and requiredFeeds and to record only the TS version until the Rust side exposes one.
export function checkDescribe(
  doc: unknown,
  cell: ParityCell,
  ts: { params: Record<string, unknown>; requiredFeeds: unknown },
): string[] {
  const d = doc as {
    type?: unknown
    capabilities?: { traceFormat?: unknown; profiles?: unknown; inputModes?: unknown }
    strategy?: {
      id?: unknown
      results?: Array<{ ok?: unknown; params?: unknown; requiredFeeds?: unknown }>
    }
  } | null
  const problems: string[] = []
  if (d?.type !== 'describe') return ['describe output is not a describe document']
  if (d.capabilities?.traceFormat !== 'pmb-parity-trace/2')
    problems.push(
      `traceFormat ${JSON.stringify(d.capabilities?.traceFormat)} != pmb-parity-trace/2`,
    )
  const profiles = Array.isArray(d.capabilities?.profiles) ? d.capabilities.profiles : []
  if (!profiles.includes(cell.profile))
    problems.push(`profile ${cell.profile} not in ${JSON.stringify(profiles)}`)
  const modes = Array.isArray(d.capabilities?.inputModes) ? d.capabilities.inputModes : []
  if (!modes.includes(cell.inputMode))
    problems.push(`input mode ${cell.inputMode} not in ${JSON.stringify(modes)}`)
  if (d.strategy?.id !== cell.rustStrategyId)
    problems.push(`strategy id ${JSON.stringify(d.strategy?.id)} != ${cell.rustStrategyId}`)
  const r = d.strategy?.results?.[0]
  if (!r || r.ok !== true) problems.push(`params rejected: ${JSON.stringify(r ?? null)}`)
  else {
    if (canonicalJsonLoose(r.params) !== canonicalJsonLoose(ts.params))
      problems.push(
        `normalized params ${JSON.stringify(r.params)} != TS ${JSON.stringify(ts.params)}`,
      )
    if (
      canonicalJsonLoose(r.requiredFeeds ?? null) !== canonicalJsonLoose(ts.requiredFeeds ?? null)
    )
      problems.push(
        `requiredFeeds ${JSON.stringify(r.requiredFeeds)} != TS ${JSON.stringify(ts.requiredFeeds)}`,
      )
  }
  return problems
}

/** `<bin> describe --params '<json>'` arguments (20 §5.1). */
export function describeArgs(params: Record<string, unknown>): string[] {
  return ['describe', '--params', JSON.stringify(params)]
}
