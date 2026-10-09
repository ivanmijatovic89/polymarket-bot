// Prebuilt `EngineJob` files for the L1 driver (21 §5, 20 §5.4).
//
// D-PENDING: 01 §6 M1 step 7 renders jobs once through `src/native`
// (`buildEngineJob`, M1 step 6), which does not exist on this branch yet.
// Until it does, the driver takes a directory of prebuilt job files named
// `<slug>.json`, one per manifest market, and checks them here.

import type { BenchMarket, BenchSet } from './manifest.js'

export interface CheckedJob {
  idx: number
  slug: string
  /** Absolute job file path passed to `run --job`. */
  jobPath: string
  strategyId: string
  /** Stable text of `run.modelConfig` (keys sorted). */
  modelConfigKey: string
  modelConfig: unknown
  /** `market.input.path`: the absolute v1 source path. */
  inputPath: string
}

export class JobError extends Error {
  constructor(where: string, message: string) {
    super(`${where}: ${message}`)
    this.name = 'JobError'
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** JSON text with object keys sorted, for comparing configurations. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** Validates one job against its manifest market (fail loud, R14). */
export function checkJob(job: unknown, market: BenchMarket, jobPath: string): CheckedJob {
  const where = `${jobPath} (${market.slug})`
  if (!isObject(job)) throw new JobError(where, 'job must be a JSON object')
  if (job.jobSchemaVersion !== 1)
    throw new JobError(where, `jobSchemaVersion ${String(job.jobSchemaVersion)} (expected 1)`)
  const run = job.run
  const mkt = job.market
  if (!isObject(run) || !isObject(mkt))
    throw new JobError(where, 'job needs "run" and "market" objects')
  if (mkt.slug !== market.slug) {
    throw new JobError(
      where,
      `market.slug ${JSON.stringify(mkt.slug)} differs from the manifest slug`,
    )
  }
  if (typeof run.strategyId !== 'string' || run.strategyId === '') {
    throw new JobError(where, 'run.strategyId must be a non-empty string')
  }
  if (!Array.isArray(run.candidates) || run.candidates.length !== 1) {
    throw new JobError(where, '`run` needs exactly one candidate (20 §5.4)')
  }
  if (!isObject(run.modelConfig)) throw new JobError(where, 'run.modelConfig must be an object')
  const input = mkt.input
  if (!isObject(input) || typeof input.path !== 'string' || !input.path.startsWith('/')) {
    throw new JobError(where, 'market.input.path must be an absolute path')
  }
  return {
    idx: market.idx,
    slug: market.slug,
    jobPath,
    strategyId: run.strategyId,
    modelConfigKey: stableStringify(run.modelConfig),
    modelConfig: run.modelConfig,
    inputPath: input.path,
  }
}

/**
 * Checks that all jobs share one run section (strategy and ModelConfig) and
 * that it matches the manifest where the manifest pins it.
 */
export function checkRunConsistency(
  set: BenchSet,
  jobs: readonly CheckedJob[],
): { strategyId: string; modelConfig: unknown } {
  const first = jobs[0]
  if (first === undefined) throw new JobError(set.name, 'no jobs')
  for (const j of jobs) {
    if (j.strategyId !== first.strategyId) {
      throw new JobError(
        j.jobPath,
        `strategyId ${j.strategyId} differs from ${first.strategyId} (${first.slug})`,
      )
    }
    if (j.modelConfigKey !== first.modelConfigKey) {
      throw new JobError(j.jobPath, `run.modelConfig differs from the one of ${first.slug}`)
    }
  }
  if (set.strategyId !== null && set.strategyId !== first.strategyId) {
    throw new JobError(
      set.name,
      `jobs run ${first.strategyId}, the manifest pins ${set.strategyId}`,
    )
  }
  if (set.modelConfig !== null && stableStringify(set.modelConfig) !== first.modelConfigKey) {
    throw new JobError(set.name, 'jobs carry a ModelConfig that differs from the manifest')
  }
  return { strategyId: first.strategyId, modelConfig: first.modelConfig }
}
