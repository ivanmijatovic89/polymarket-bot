import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MarketJobData } from '../jobTypes.js'
import {
  TELONEX_DELTA_FORMAT,
  buildEngineJob,
  toNativeJobTemplate,
  validateModelConfig,
  withNativeGate,
  type NativeDescribe,
  type NativeJobTemplate,
  type BuildEngineJobOptions,
  type BuiltEngineJob,
  type DataRoots,
  type NativeMarketJobData,
} from '../../native/index.js'
import type { EngineJob } from '../../native/contract/generated.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { canonicalJsonLoose, modelConfigSha256, type ParityCell } from './cell.js'

/**
 * The Rust side of a parity cell (60 HR-1, HR-2): the harness builds the
 * native `MarketJobData` with the cell's Rust strategy id and ModelConfig,
 * and the `EngineJob` comes from `src/native/buildEngineJob` (01 §6 M1 step
 * 6, 21 §5, §9), the builder later shared by `--sequential` and the worker
 * shim. The binary runs through the src/native protocol-v2 runner.
 */

/** `buildEngineJob(MarketJobData, dataRoots)` (01 §6 M1 step 6; 21 §5, §9). */
export type BuildEngineJob = (
  job: NativeMarketJobData,
  dataRoots: DataRoots,
  opts?: BuildEngineJobOptions,
) => Promise<BuiltEngineJob> | BuiltEngineJob

/**
 * src/native's `buildEngineJob`, or the export of `override` (a module path;
 * harness self-tests only — such a run is non-gating).
 */
export async function loadEngineJobBuilder(override?: string): Promise<BuildEngineJob> {
  if (!override) return buildEngineJob
  const mod = (await import(pathToFileURL(path.resolve(override)).href)) as {
    buildEngineJob?: unknown
  }
  if (typeof mod.buildEngineJob !== 'function')
    throw new Error(`--engine-job-builder ${override} does not export buildEngineJob`)
  return mod.buildEngineJob as BuildEngineJob
}

/** Catalog facts of a parity market that the native job needs (21 §4 `conditionId`, `input.bytes`). */
export type NativeCatalogFacts = {
  /** `telonex_markets.market_id` (15 I-18). */
  conditionId: string | null
  /** Converted parquet size (`telonex_market_conversions.size_bytes`, 15 I-8). */
  bytes: number
}

/**
 * HR-1: the native `MarketJobData` (21 §4) of a TS parity job: the Rust
 * strategy id, the cell ModelConfig, the strategy's required feeds, the
 * local input (60 MS-5: `--read-from local`, absolute path under the data
 * root) and `feedAvailability` resolved at `asOfMs` (14 §6.2, 60 OR-8).
 */
export function nativeJobFor(
  tsJob: MarketJobData,
  cell: ParityCell,
  facts: NativeCatalogFacts & {
    requiredFeeds: ExternalFeedsRequestConfig | null
    asOfMs: number
  },
): NativeJobTemplate {
  // The full contract check of the cell ModelConfig (21 §6.3; cell.ts checks only the fields the oracle maps).
  const modelConfig: unknown = cell.modelConfig
  validateModelConfig(modelConfig)
  return toNativeJobTemplate(tsJob, {
    strategyId: cell.rustStrategyId,
    modelConfig,
    requiredFeeds: facts.requiredFeeds,
    conditionId: facts.conditionId,
    input: {
      path: tsJob.filePath,
      r2Url: null,
      bytes: facts.bytes,
      sha256: null,
      format: { ...TELONEX_DELTA_FORMAT },
    },
    readFrom: cell.readFrom,
    asOfMs: facts.asOfMs,
  })
}

/**
 * The gate fields of a parity job (21 §4, 40 §4.1) from the binary that runs
 * it: its `describe` protocol and target and its sha256. A `--rust-only`
 * rerun with another binary (60 §4.5 PS-50) therefore carries that binary's
 * identity. Parity runs are agent submissions (40 §10).
 */
// D-PENDING: 21 §4 strategyArtifact.r2Url names the R2 object, but parity runs a local canonical binary that is never downloaded (60 VP-7, MS-5); chose `file://<absolute path>`.
export function parityGate(
  doc: Pick<NativeDescribe, 'protocolVersion' | 'binary'>,
  bin: { path: string; sha256: string },
  producerDirty: boolean,
): Parameters<typeof withNativeGate>[1] {
  return {
    protocolVersion: doc.protocolVersion,
    target: doc.binary.target,
    artifactSha256: bin.sha256,
    artifactR2Url: `file://${path.resolve(bin.path)}`,
    priorityClass: 'agent',
    producerDirty,
  }
}

/** A parity job template with the gate of the binary that runs it. */
export function nativeJobWithGate(
  template: NativeJobTemplate,
  gate: Parameters<typeof withNativeGate>[1],
): NativeMarketJobData {
  return withNativeGate(template, gate)
}

/**
 * The `EngineJob` of one parity market through the src/native builder
 * (HR-2). A parity market is resolved, so a 21 §13 short-circuit is an
 * error here (R14).
 */
export async function engineJobFor(
  build: BuildEngineJob,
  job: NativeMarketJobData,
  dataRoot: string,
  outputs: { tracePath: string; traceLevel: ParityCell['traceLevel'] },
): Promise<EngineJob> {
  const built = await build(job, { dataRoot }, { outputs, log: () => {} })
  if (built.kind !== 'job')
    throw new Error(`${job.slug}: buildEngineJob short-circuited (${built.skipReason}, 21 §13)`)
  return built.job
}

/**
 * `--rust-only` reuses `<dir>/jobs/<slug>.native.json`; the manifest records
 * the current cell's `modelConfigSha256`, so the reused job must carry the
 * same ModelConfig, required feeds, read mode and Rust strategy id (60 VP-2,
 * HR-7, R14). Returns the problems (empty when the job matches the cell).
 */
export function rustOnlyJobProblems(
  native: NativeJobTemplate,
  cell: ParityCell,
  current: { modelConfigSha256: string; requiredFeeds: ExternalFeedsRequestConfig | null },
): string[] {
  const problems: string[] = []
  const sha = modelConfigSha256(native.modelConfig)
  if (sha !== current.modelConfigSha256)
    problems.push(`modelConfigSha256 ${sha} != cell ${current.modelConfigSha256}`)
  if (
    canonicalJsonLoose(native.requiredFeeds ?? null) !== canonicalJsonLoose(current.requiredFeeds)
  )
    problems.push(
      `requiredFeeds ${JSON.stringify(native.requiredFeeds)} != ${JSON.stringify(current.requiredFeeds)}`,
    )
  if (native.readFrom !== cell.readFrom)
    problems.push(`readFrom ${native.readFrom} != cell ${cell.readFrom}`)
  if (native.strategyId !== cell.rustStrategyId)
    problems.push(`strategyId ${native.strategyId} != cell ${cell.rustStrategyId}`)
  return problems
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
 * Returns the list of problems (empty when compatible). The protocol,
 * real-orders and contract checks of 20 §1/§3 run first, in
 * `describeNative`.
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
