/**
 * fleet.ts — read-only fleet/queue status from BullMQ + Redis.
 *
 * Usage:
 *   tsx protocols/pair-fable/tools/fleet.ts [--json]
 *
 * Reports:
 *   - queue job counts for backtest-markets / backtest-aggregate
 *   - worker processes (Redis hashes backtest:worker:<machine>#<role> +
 *     :heartbeat key; alive = heartbeat age < 30s — check age, not existence,
 *     ghost hashes persist until pruned by the dashboard)
 *   - active batches: aggregate jobs in waiting-children/waiting/active/delayed
 *     with processed/unprocessed child counts
 *
 * Reuses src/backtest/queue.ts singletons (never duplicates queue names).
 * Read-only: no job mutation, no pruning.
 */
import '../../../src/config/env.js'
import {
  getMarketQueue,
  getAggregateQueue,
  getRedisConnection,
  closeRedisConnection,
} from '../../../src/backtest/queue.js'

const asJson = process.argv.includes('--json')

const COUNT_STATES = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'waiting-children',
] as const

type WorkerRow = {
  processKey: string
  alive: boolean
  heartbeatAgeMs: number | null
  commitSha: string | null
  branchName: string | null
  processedTotal: number
  lastMarket: string | null
  lastFinishedAt: number | null
  queues: string | null
}

type BatchRow = {
  jobId: string | undefined
  state: string
  submissionUid: string | null
  batchUid: string | null
  strategyId: string | null
  totalMarkets: number | null
  processed: number
  unprocessed: number
}

async function listWorkers(): Promise<WorkerRow[]> {
  const conn = getRedisConnection()
  const names = new Set<string>()
  let cursor = '0'
  do {
    const [next, keys] = await conn.scan(cursor, 'MATCH', 'backtest:worker:*', 'COUNT', 200)
    cursor = next
    for (const k of keys) {
      const name = k.replace(/:heartbeat$/, '').substring('backtest:worker:'.length)
      if (name) names.add(name)
    }
  } while (cursor !== '0')

  const now = Date.now()
  const rows: WorkerRow[] = []
  for (const name of [...names].sort()) {
    const [hash, hbStr] = await Promise.all([
      conn.hgetall(`backtest:worker:${name}`),
      conn.get(`backtest:worker:${name}:heartbeat`),
    ])
    const hb = hbStr ? Number(hbStr) : null
    const heartbeatAgeMs = hb !== null && Number.isFinite(hb) ? Math.max(0, now - hb) : null
    rows.push({
      processKey: name,
      alive: heartbeatAgeMs !== null && heartbeatAgeMs < 30_000,
      heartbeatAgeMs,
      commitSha: hash.commitSha ?? null,
      branchName: hash.branchName ?? null,
      processedTotal: Number(hash.processedTotal ?? 0) || 0,
      lastMarket: hash.lastMarket ?? null,
      lastFinishedAt: hash.lastFinishedAt ? Number(hash.lastFinishedAt) : null,
      queues: hash.queues ?? null,
    })
  }
  return rows
}

async function listActiveBatches(): Promise<BatchRow[]> {
  const agg = getAggregateQueue()
  const rows: BatchRow[] = []
  // getJobs silently caps pages at 200 — paginate explicitly.
  for (const state of ['waiting-children', 'waiting', 'active', 'delayed'] as const) {
    let start = 0
    for (;;) {
      const jobs = await agg.getJobs([state], start, start + 199)
      for (const job of jobs) {
        const data = (job.data ?? {}) as Record<string, unknown>
        const { processed, unprocessed } = await job.getDependenciesCount({
          processed: true,
          unprocessed: true,
        })
        rows.push({
          jobId: job.id,
          state,
          submissionUid: (data.submissionUid as string) ?? null,
          batchUid: (data.batchUid as string) ?? null,
          strategyId: (data.strategyId as string) ?? null,
          totalMarkets: (data.totalMarkets as number) ?? null,
          processed: processed ?? 0,
          unprocessed: unprocessed ?? 0,
        })
      }
      if (jobs.length < 200) break
      start += 200
    }
  }
  return rows
}

const [marketCounts, aggregateCounts, workers, batches] = await Promise.all([
  getMarketQueue().getJobCounts(...COUNT_STATES),
  getAggregateQueue().getJobCounts(...COUNT_STATES),
  listWorkers(),
  listActiveBatches(),
])

const snapshot = {
  at: new Date().toISOString(),
  queues: { markets: marketCounts, aggregate: aggregateCounts },
  workers,
  activeBatches: batches,
}

if (asJson) {
  console.log(JSON.stringify(snapshot, null, 2))
} else {
  console.log(`fleet @ ${snapshot.at}`)
  console.log(
    `queues  markets: ${COUNT_STATES.map((s) => `${s}=${marketCounts[s] ?? 0}`).join(' ')}`
  )
  console.log(
    `        aggregate: ${COUNT_STATES.map((s) => `${s}=${aggregateCounts[s] ?? 0}`).join(' ')}`
  )
  console.log(`workers (${workers.filter((w) => w.alive).length}/${workers.length} alive)`)
  for (const w of workers) {
    const hb = w.heartbeatAgeMs === null ? 'no-hb' : `${Math.round(w.heartbeatAgeMs / 1000)}s`
    console.log(
      `  ${w.alive ? 'UP  ' : 'DOWN'} ${w.processKey}  hb=${hb}  sha=${w.commitSha?.slice(0, 7) ?? '?'}  processed=${w.processedTotal}  last=${w.lastMarket ?? '-'}`
    )
  }
  console.log(`active batches: ${batches.length}`)
  for (const b of batches) {
    console.log(
      `  [${b.state}] ${b.batchUid ?? b.submissionUid}  strategy=${b.strategyId ?? '?'}  ${b.processed}/${(b.processed ?? 0) + (b.unprocessed ?? 0)} markets`
    )
  }
}

await closeRedisConnection()
process.exit(0)
