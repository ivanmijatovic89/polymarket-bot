// Prebuilt `EngineJob` files for the L1 driver (21 §5, 20 §5.4).
//
// D-PENDING: 01 §6 M1 step 7 renders jobs once through `src/native`
// (`buildEngineJob`, M1 step 6), which does not exist on this branch yet.
// Until it does, the driver takes a directory of prebuilt job files named
// `<slug>.json`, one per manifest market, and checks here that they carry
// exactly the configuration and the inputs the manifest pins (16 §13.1).

import fs from 'node:fs'
import path from 'node:path'
import type { BenchMarket, BenchSet } from './manifest.js'

export interface CheckedJob {
  idx: number
  slug: string
  /** Absolute job file path passed to `run --job`. */
  jobPath: string
  /** Stable text of the whole `run` section (keys sorted). */
  runKey: string
  run: Record<string, unknown>
  /** `market.input`: the absolute v1 source path and its pinned identity. */
  input: { path: string; bytes: number; sha256: string | null }
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
  if (typeof run.inputMode !== 'string' || run.inputMode === '') {
    throw new JobError(where, 'run.inputMode must be a non-empty string')
  }
  if (!Array.isArray(run.candidates) || run.candidates.length !== 1) {
    throw new JobError(where, '`run` needs exactly one candidate (20 §5.4)')
  }
  if (!isObject(run.candidates[0]) || !isObject(run.candidates[0].params)) {
    throw new JobError(where, 'run.candidates[0].params must be an object')
  }
  if (!isObject(run.modelConfig)) throw new JobError(where, 'run.modelConfig must be an object')
  const input = mkt.input
  if (!isObject(input) || typeof input.path !== 'string' || !input.path.startsWith('/')) {
    throw new JobError(where, 'market.input.path must be an absolute path')
  }
  if (typeof input.bytes !== 'number' || !Number.isSafeInteger(input.bytes)) {
    throw new JobError(where, 'market.input.bytes must be an integer')
  }
  if (input.sha256 !== null && typeof input.sha256 !== 'string') {
    throw new JobError(where, 'market.input.sha256 must be a string or null')
  }
  return {
    idx: market.idx,
    slug: market.slug,
    jobPath,
    runKey: stableStringify(run),
    run,
    input: { path: input.path, bytes: input.bytes, sha256: input.sha256 },
  }
}

/**
 * Checks the job's input against the manifest market under `dataRoot`: the
 * same file (by path, or by real path when the data root is a symlink), the
 * pinned size and, when the job carries one, the pinned sha256.
 */
export function checkJobInput(job: CheckedJob, market: BenchMarket, dataRoot: string): void {
  const where = `${job.jobPath} (${market.slug})`
  const expected = path.resolve(dataRoot, market.file)
  const actual = path.resolve(job.input.path)
  if (actual !== expected) {
    const real = (p: string): string | null => {
      try {
        return fs.realpathSync(p)
      } catch {
        return null
      }
    }
    const ra = real(actual)
    if (ra === null || ra !== real(expected)) {
      throw new JobError(
        where,
        `market.input.path ${actual} is not the manifest file ${expected} (--data-root ${dataRoot})`,
      )
    }
  }
  if (job.input.bytes !== market.bytes) {
    throw new JobError(
      where,
      `market.input.bytes ${job.input.bytes} differs from the manifest's ${market.bytes}`,
    )
  }
  if (job.input.sha256 !== null && job.input.sha256 !== market.sha256) {
    throw new JobError(where, `market.input.sha256 differs from the manifest's`)
  }
}

/**
 * Checks that every job carries one identical `run` section (21 §5:
 * strategy, input mode, ModelConfig and the candidate with its params) and
 * that it is the configuration the manifest pins (16 §13.1).
 */
export function checkRunConsistency(
  set: BenchSet,
  jobs: readonly CheckedJob[],
): Record<string, unknown> {
  const first = jobs[0]
  if (first === undefined) throw new JobError(set.name, 'no jobs')
  for (const j of jobs) {
    if (j.runKey !== first.runKey) {
      throw new JobError(j.jobPath, `the run section differs from the one of ${first.slug}`)
    }
  }
  const run = first.run
  const candidate = (run.candidates as Array<Record<string, unknown>>)[0]!
  const mismatches: string[] = []
  if (run.strategyId !== set.strategy.id) {
    mismatches.push(`strategyId ${String(run.strategyId)} (manifest ${set.strategy.id})`)
  }
  if (run.inputMode !== set.inputMode) {
    mismatches.push(`inputMode ${String(run.inputMode)} (manifest ${set.inputMode})`)
  }
  if (stableStringify(run.modelConfig) !== stableStringify(set.modelConfig)) {
    mismatches.push('modelConfig')
  }
  // D-PENDING: the manifest pins params as the job carries them (normalized,
  // 20 §5.1); a manifest written with unnormalized params fails here loudly.
  if (stableStringify(candidate.params) !== stableStringify(set.strategy.params)) {
    mismatches.push('candidates[0].params')
  }
  if (mismatches.length > 0) {
    throw new JobError(set.name, `jobs differ from the manifest in ${mismatches.join(', ')}`)
  }
  return run
}
