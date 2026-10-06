import type { RecorderV4SelectionSource } from '@bot/recorder-v4/replay/eligibility'
import type { CaptureSelectionFilters } from '@bot/recorder-v4/replay/selection'
import type { ExternalFeedsRequestConfig } from '@bot/strategy/plugins/ExternalFeedsRequestPlugin'
import type { CaptureCatalogMetadata } from '@bot/recorder-v4/replay/catalogMetadata'
import { readRecorderV4CatalogWorker } from '../server/recorderV4CatalogWorker'

// One in-flight child per scope, eight scopes maximum, five-minute completed reuse.
const cache = new Map<
  string,
  { expires: number; settled: boolean; promise: Promise<CaptureCatalogMetadata> }
>()
export function readRecorderV4Catalog(
  source: RecorderV4SelectionSource,
  filters: CaptureSelectionFilters,
  requiredFeeds: ExternalFeedsRequestConfig = {},
  allowGaps = false,
) {
  const key = JSON.stringify({ source, filters, requiredFeeds, allowGaps })
  const current = cache.get(key)
  if (current && current.expires > Date.now()) return current.promise
  if (cache.size >= 8) {
    const disposable = [...cache.entries()].find(([, value]) => value.settled)
    if (!disposable) throw new Error('Recorder catalog is busy. Retry after current reads finish.')
    cache.delete(disposable[0])
  }
  const promise = readRecorderV4CatalogWorker(source, filters, requiredFeeds, allowGaps)
    .then((report) => {
      const entry = cache.get(key)
      if (entry?.promise === promise) {
        entry.settled = true
        entry.expires = Date.now() + 300_000
      }
      return report
    })
    .catch((error: unknown) => {
      if (cache.get(key)?.promise === promise) cache.delete(key)
      throw error
    })
  cache.set(key, { expires: Infinity, settled: false, promise })
  return promise
}

export async function getRecorderV4DatasetCoverage(
  timeframe: '5m' | '15m',
  fromMs: number,
  toMs: number,
) {
  const bucket = process.env.R2_BUCKET?.trim()
  if (!bucket) throw new Error('R2_BUCKET is not configured for Recorder V4 dataset discovery.')
  const source: RecorderV4SelectionSource = { kind: 'r2', bucket, prefix: 'recorder-v4' }
  return {
    source: 'recorder-v4' as const,
    timeframe,
    fromMs,
    toMs,
    ...(await readRecorderV4Catalog(source, { timeframe, fromMs, toMs })),
  }
}

/** Bound interactive browsing; archive CLI remains available for arbitrary ranges. */
export function recorderV4DatasetRange(
  from: string | undefined,
  to: string | undefined,
  now = Date.now(),
) {
  const date = (value: string): number => {
    const ms = Date.parse(value)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== value
    )
      throw new Error('Choose valid UTC calendar dates (YYYY-MM-DD).')
    return ms
  }
  const end = to === undefined ? Math.floor(now / 300_000) * 300_000 : date(to) + 86_400_000 - 1
  const start = from === undefined ? end - 7 * 86_400_000 : date(from)
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > 31 * 86_400_000
  )
    throw new Error('Choose a valid UTC date range of at most 31 days.')
  return { fromMs: start, toMs: end }
}
