import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MarketJobData } from '../jobTypes.js'
import { REPO_ROOT, type ParityCell } from './cell.js'

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

export async function loadEngineJobBuilder(): Promise<BuildEngineJob> {
  for (const rel of BUILDER_CANDIDATES) {
    const file = path.join(REPO_ROOT, rel)
    if (!existsSync(file)) continue
    const mod = (await import(pathToFileURL(file).href)) as { buildEngineJob?: unknown }
    if (typeof mod.buildEngineJob === 'function') return mod.buildEngineJob as BuildEngineJob
  }
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
