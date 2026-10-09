import path from 'node:path'
import type { MarketJobData } from '../jobTypes.js'
import { canonicalJsonLoose } from './cell.js'

/**
 * H-1 harness validation (native/spec/60-verification.md §4.3): the
 * harness's `MarketJobData` equals the production producer's job for the
 * same market and strategy, normalized by removing `idx` and the batch and
 * submission fields.
 */

/** Fields H-1 removes before comparing (60 §4.3 H-1). */
export const H1_IGNORED_FIELDS = ['idx', 'batchUid', 'submissionUid'] as const

/**
 * Normalize a job for H-1. The producer writes catalog-relative dataset
 * paths (`data/events/...`, resolved by the worker against the repository
 * root) while the harness writes them absolute under `--data-root`; both are
 * mapped to the absolute path under `dataRoot`.
 */
// D-PENDING: H-1 lists only idx/batch/submission as normalized fields; chose to also resolve the producer's relative `filePath` under the data root and to drop `commitSha` (provenance only, D12), because a producer job of another checkout or commit cannot otherwise equal the harness job.
export function normalizeForH1(job: MarketJobData, dataRoot: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...job }
  for (const k of H1_IGNORED_FIELDS) delete out[k]
  delete out.commitSha
  if (typeof job.filePath === 'string' && !path.isAbsolute(job.filePath)) {
    const parts = job.filePath.split('/')
    if (parts[0] === 'data') out.filePath = path.join(dataRoot, ...parts.slice(1))
  }
  return JSON.parse(canonicalJsonLoose(out)) as Record<string, unknown>
}

export type H1Difference = { path: string; harness: unknown; producer: unknown }

function diffValues(a: unknown, b: unknown, p: string, out: H1Difference[]): void {
  // Absent and null differ (e.g. the gammaPriceToBeat tri-state, 21 §5.1).
  const enc = (v: unknown) => (v === undefined ? '\u0000absent' : canonicalJsonLoose(v))
  if (enc(a) === enc(b)) return
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    for (const k of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort())
      diffValues(ao[k], bo[k], `${p}.${k}`, out)
    return
  }
  out.push({ path: p, harness: a, producer: b })
}

/** Field differences between the normalized harness and producer jobs (empty = H-1 holds for this market). */
export function compareJobsH1(
  harness: MarketJobData,
  producer: MarketJobData,
  dataRoot: string,
): H1Difference[] {
  const out: H1Difference[] = []
  diffValues(normalizeForH1(harness, dataRoot), normalizeForH1(producer, dataRoot), '$', out)
  return out
}
