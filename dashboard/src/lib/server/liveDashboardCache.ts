import type { TtlCacheRead } from './ttlCache'
import { listActiveBatches } from '@/lib/queries/batches'
import { queueCounts } from '@/lib/queries/queues'
import { listWorkers } from '@/lib/queries/workers'
import { createTtlCache } from './ttlCache'

/**
 * Live Fleet data changes frequently, so keep this deliberately shorter than
 * the client polling interval while still coalescing simultaneous consumers.
 */
export const LIVE_DASHBOARD_CACHE_MS = 2_000

async function loadWorkers() {
  const machines = await listWorkers()
  return {
    machines,
    totals: {
      processedTotal: machines.reduce((sum, machine) => sum + machine.totals.processedTotal, 0),
      eventsTotal: machines.reduce((sum, machine) => sum + machine.totals.eventsTotal, 0),
      alive: machines.reduce((sum, machine) => sum + machine.totals.aliveCount, 0),
    },
  }
}

async function loadActiveBatches() {
  return { batches: await listActiveBatches() }
}

const workersCache = createTtlCache<Awaited<ReturnType<typeof loadWorkers>>>(
  LIVE_DASHBOARD_CACHE_MS,
)
const queuesCache = createTtlCache<Awaited<ReturnType<typeof queueCounts>>>(
  LIVE_DASHBOARD_CACHE_MS,
)
const activeBatchesCache = createTtlCache<Awaited<ReturnType<typeof loadActiveBatches>>>(
  LIVE_DASHBOARD_CACHE_MS,
)

export function getCachedWorkers() {
  return workersCache.get(loadWorkers)
}

export function getCachedQueueCounts() {
  return queuesCache.get(queueCounts)
}

export function getCachedActiveBatches() {
  return activeBatchesCache.get(loadActiveBatches)
}

export function liveDashboardCacheHeaders<T>(read: TtlCacheRead<T>): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Dashboard-Cache-Source': read.source,
    'X-Dashboard-Cache-Age-Ms': String(Math.round(read.ageMs)),
    'X-Dashboard-Cache-TTL-Ms': String(LIVE_DASHBOARD_CACHE_MS),
  }
}
