import type { ActiveBatchSummary } from '@/lib/queries/batches'
import type { QueueCounts } from '@/lib/queries/queues'
import type { MachineGroup } from '@/lib/queries/workers'

export const LIVE_DASHBOARD_REFETCH_MS = 3_000

export type WorkersResponse = {
  machines: MachineGroup[]
  totals: {
    processedTotal: number
    eventsTotal: number
    alive: number
  }
}

export type ActiveBatchesResponse = {
  batches: ActiveBatchSummary[]
}

export const workersQueryKey = ['workers'] as const
export const queuesQueryKey = ['queues'] as const
export const activeBatchesQueryKey = ['batches', 'active'] as const

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`failed to fetch ${url}`)
  return response.json()
}

export function fetchWorkers(): Promise<WorkersResponse> {
  return fetchJson('/api/workers')
}

export function fetchQueues(): Promise<QueueCounts> {
  return fetchJson('/api/queues')
}

export function fetchActiveBatches(): Promise<ActiveBatchesResponse> {
  return fetchJson('/api/batches/active')
}
