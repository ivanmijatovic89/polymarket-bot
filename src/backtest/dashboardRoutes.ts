import type { FastifyInstance } from 'fastify'
import { eq, desc } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { backtests } from '../db/schema.js'
import {
  AGGREGATE_QUEUE,
  MARKET_QUEUE,
  getAggregateQueue,
  getMarketQueue,
  getRedisConnection,
} from './queue.js'

type WorkerStats = {
  name: string
  host: string | null
  commitSha: string | null
  heartbeatAgeMs: number | null
  alive: boolean
  processedTotal: number
  eventsTotal: number
  lastMarket: string | null
  lastFinishedAt: number | null
}

/**
 * Workers whose `:heartbeat` key has been gone this long get their hash
 * deleted on the next listWorkers() call. The heartbeat key carries an
 * `EX 60` TTL and is written every 5s while the worker lives, so any gap
 * longer than this grace window is conclusively a dead worker.
 *
 * We don't rely on the hash itself having a TTL because BullMQ-style
 * counters (processedTotal, eventsTotal) need to survive across short
 * worker restarts within a single run — the per-restart aggregation is
 * intentional. Only **already-gone** workers get pruned.
 */
const STALE_WORKER_GRACE_MS = 5 * 60 * 1000

async function listWorkers(): Promise<WorkerStats[]> {
  const conn = getRedisConnection()
  // SCAN all backtest:worker:* hashes. Heartbeat is stored as a separate key
  // (so it can use EX 60s); reconcile by stripping the suffix.
  const names = new Set<string>()
  let cursor = '0'
  do {
    const [next, keys] = await conn.scan(cursor, 'MATCH', 'backtest:worker:*', 'COUNT', 200)
    cursor = next
    for (const k of keys) {
      const base = k.replace(/:heartbeat$/, '')
      const name = base.substring('backtest:worker:'.length)
      if (name) names.add(name)
    }
  } while (cursor !== '0')

  const now = Date.now()
  const results: WorkerStats[] = []
  const toPrune: string[] = []
  for (const name of names) {
    const hash = await conn.hgetall(`backtest:worker:${name}`)
    const hbStr = await conn.get(`backtest:worker:${name}:heartbeat`)
    const hb = hbStr ? Number(hbStr) : null
    const heartbeatAgeMs = hb !== null && Number.isFinite(hb) ? Math.max(0, now - hb) : null

    // Prune: heartbeat is gone (EX 60 expired or worker crashed before exit)
    // AND we've been showing the worker as stale long enough that any
    // restart-window grace has passed.
    if (heartbeatAgeMs === null) {
      const lastFinishedAt = hash.lastFinishedAt ? Number(hash.lastFinishedAt) : null
      const ageSinceLastWork =
        lastFinishedAt !== null && Number.isFinite(lastFinishedAt) ? now - lastFinishedAt : Infinity
      if (ageSinceLastWork > STALE_WORKER_GRACE_MS) {
        toPrune.push(name)
        continue
      }
    }

    results.push({
      name,
      host: hash.host ?? null,
      commitSha: hash.commitSha ?? null,
      heartbeatAgeMs,
      alive: heartbeatAgeMs !== null && heartbeatAgeMs < 30_000,
      processedTotal: Number(hash.processedTotal ?? 0) || 0,
      eventsTotal: Number(hash.eventsTotal ?? 0) || 0,
      lastMarket: hash.lastMarket ?? null,
      lastFinishedAt: hash.lastFinishedAt ? Number(hash.lastFinishedAt) : null,
    })
  }

  if (toPrune.length > 0) {
    const pipe = conn.pipeline()
    for (const name of toPrune) {
      pipe.del(`backtest:worker:${name}`)
      pipe.del(`backtest:worker:${name}:heartbeat`)
    }
    try {
      await pipe.exec()
    } catch {
      /* best-effort */
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name))
  return results
}

async function queueCounts(): Promise<{
  markets: Record<string, number>
  aggregate: Record<string, number>
}> {
  const market = getMarketQueue()
  const agg = getAggregateQueue()
  const [m, a] = await Promise.all([
    market.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'),
    agg.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'),
  ])
  return { markets: m, aggregate: a }
}

async function listActiveBatches(): Promise<
  Array<{
    batchUid: string
    strategy: string
    totalMarkets: number
    waitingChildren: number
    activeChildren: number
    completedChildren: number
    failedChildren: number
    parentState: string | undefined
  }>
> {
  const agg = getAggregateQueue()
  // Aggregate jobs that haven't finished yet: waiting-children + waiting + active + delayed.
  const jobs = await agg.getJobs(['waiting-children', 'waiting', 'active', 'delayed'], 0, 100)
  const out = []
  for (const job of jobs) {
    if (!job) continue
    const data = job.data as {
      batchUid?: string
      totalMarkets?: number
      insertMeta?: { strategy?: string }
    }
    const batchUid = data.batchUid ?? job.id ?? 'unknown'
    const totalMarkets = data.totalMarkets ?? 0
    const dependencies = await job.getDependenciesCount({ processed: true, unprocessed: true })
    const state = await job.getState()
    out.push({
      batchUid,
      strategy: data.insertMeta?.strategy ?? 'unknown',
      totalMarkets,
      waitingChildren: dependencies.unprocessed ?? 0,
      activeChildren: 0,
      completedChildren: dependencies.processed ?? 0,
      failedChildren: 0,
      parentState: state,
    })
  }
  return out
}

async function listHistoricalBatches(limit: number) {
  const db = getDb()
  if (!db) return []
  const rows = await db
    .select({
      batchUid: backtests.batchUid,
      strategy: backtests.strategy,
      comment: backtests.comment,
      batchStats: backtests.batchStats,
      createdAt: backtests.createdAt,
    })
    .from(backtests)
    .orderBy(desc(backtests.createdAt))
    .limit(limit)
  return rows
}

async function getBatchDetail(batchUid: string) {
  const db = getDb()
  if (!db) return null
  const [row] = await db.select().from(backtests).where(eq(backtests.batchUid, batchUid)).limit(1)
  return row ?? null
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    queues: { market: MARKET_QUEUE, aggregate: AGGREGATE_QUEUE },
  }))

  app.get('/api/workers', async () => {
    const workers = await listWorkers()
    return {
      workers,
      totals: {
        processedTotal: workers.reduce((s, w) => s + w.processedTotal, 0),
        eventsTotal: workers.reduce((s, w) => s + w.eventsTotal, 0),
        alive: workers.filter((w) => w.alive).length,
      },
    }
  })

  app.get('/api/queues', async () => queueCounts())

  app.get('/api/batches/active', async () => {
    const batches = await listActiveBatches()
    return { batches }
  })

  app.get<{ Querystring: { limit?: string } }>('/api/batches/history', async (req) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50))
    const batches = await listHistoricalBatches(limit)
    return { batches }
  })

  app.get<{ Params: { batchUid: string } }>('/api/batches/:batchUid', async (req, reply) => {
    const detail = await getBatchDetail(req.params.batchUid)
    if (!detail) {
      reply.code(404)
      return { error: 'batch not found' }
    }
    return { batch: detail }
  })

  // Tiny HTML overview rendered server-side; uses HTMX polling so we
  // don't need a frontend build pipeline. Bull Board is mounted at /admin/queues.
  app.get('/', async (_req, reply) => {
    reply.type('text/html; charset=utf-8')
    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Backtest Dashboard</title>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #0b0d10; color: #e8eaed; }
    h1, h2 { font-weight: 600; }
    a { color: #8ab4f8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 16px 0 32px; }
    .card { background: #16191d; border: 1px solid #2a2d31; border-radius: 8px; padding: 16px; }
    .stat { font-size: 32px; font-weight: 700; line-height: 1; margin: 8px 0; }
    .label { color: #9aa0a6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #2a2d31; font-size: 13px; }
    th { color: #9aa0a6; font-weight: 500; }
    .alive { color: #81c995; }
    .dead { color: #f28b82; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #2a2d31; font-size: 11px; }
    .nav { margin-bottom: 24px; }
    .nav a { margin-right: 16px; }
  </style>
</head>
<body>
  <div class="nav">
    <strong>Backtest Dashboard</strong>
    &nbsp;·&nbsp;
    <a href="/">Overview</a>
    <a href="/admin/queues">Bull Board (raw)</a>
    <a href="/api/health">Health JSON</a>
  </div>

  <div hx-get="/partials/queues" hx-trigger="load, every 3s" hx-swap="innerHTML"></div>

  <h2>Workers</h2>
  <div hx-get="/partials/workers" hx-trigger="load, every 3s" hx-swap="innerHTML"></div>

  <h2>Active batches</h2>
  <div hx-get="/partials/active" hx-trigger="load, every 3s" hx-swap="innerHTML"></div>

  <h2>Recent batches</h2>
  <div hx-get="/partials/history" hx-trigger="load, every 10s" hx-swap="innerHTML"></div>
</body>
</html>`
  })

  app.get('/partials/queues', async (_req, reply) => {
    const counts = await queueCounts()
    reply.type('text/html; charset=utf-8')
    return /* html */ `
      <div class="grid">
        <div class="card">
          <div class="label">Markets — waiting</div>
          <div class="stat">${counts.markets.waiting ?? 0}</div>
        </div>
        <div class="card">
          <div class="label">Markets — active</div>
          <div class="stat">${counts.markets.active ?? 0}</div>
        </div>
        <div class="card">
          <div class="label">Markets — completed</div>
          <div class="stat">${counts.markets.completed ?? 0}</div>
        </div>
        <div class="card">
          <div class="label">Markets — failed</div>
          <div class="stat">${counts.markets.failed ?? 0}</div>
        </div>
        <div class="card">
          <div class="label">Aggregate — waiting-children</div>
          <div class="stat">${counts.aggregate['waiting-children'] ?? 0}</div>
        </div>
        <div class="card">
          <div class="label">Aggregate — completed</div>
          <div class="stat">${counts.aggregate.completed ?? 0}</div>
        </div>
      </div>`
  })

  app.get('/partials/workers', async (_req, reply) => {
    const workers = await listWorkers()
    reply.type('text/html; charset=utf-8')
    if (workers.length === 0) {
      return `<div class="card">No workers have reported in yet. Start one with <code>npm run backtest:worker</code>.</div>`
    }
    const rows = workers
      .map(
        (w) => `
        <tr>
          <td>${w.name}</td>
          <td>${w.host ?? ''}</td>
          <td class="${w.alive ? 'alive' : 'dead'}">${w.alive ? '● alive' : '○ stale'}</td>
          <td>${w.processedTotal}</td>
          <td>${w.eventsTotal.toLocaleString()}</td>
          <td>${w.lastMarket ?? ''}</td>
          <td>${w.heartbeatAgeMs !== null ? Math.round(w.heartbeatAgeMs / 1000) + 's' : '—'}</td>
        </tr>`,
      )
      .join('')
    return /* html */ `
      <div class="card">
        <table>
          <thead>
            <tr><th>name</th><th>host</th><th>state</th><th>processed</th><th>events</th><th>last market</th><th>last hb</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  })

  app.get('/partials/active', async (_req, reply) => {
    const batches = await listActiveBatches()
    reply.type('text/html; charset=utf-8')
    if (batches.length === 0) {
      return `<div class="card">No active batches.</div>`
    }
    const rows = batches
      .map((b) => {
        const progress = b.totalMarkets > 0 ? `${b.completedChildren}/${b.totalMarkets}` : '?'
        return `
        <tr>
          <td><code>${b.batchUid}</code></td>
          <td>${b.strategy}</td>
          <td>${progress}</td>
          <td><span class="pill">${b.parentState ?? '?'}</span></td>
        </tr>`
      })
      .join('')
    return /* html */ `
      <div class="card">
        <table>
          <thead><tr><th>batchUid</th><th>strategy</th><th>progress</th><th>state</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  })

  app.get('/partials/history', async (_req, reply) => {
    const batches = await listHistoricalBatches(20)
    reply.type('text/html; charset=utf-8')
    if (batches.length === 0) {
      return `<div class="card">No completed batches yet.</div>`
    }
    const rows = batches
      .map((b) => {
        const bs = b.batchStats as Record<string, unknown> | null
        const pnl = bs && typeof bs.pnlTotal === 'number' ? bs.pnlTotal.toFixed(2) : ''
        const wr = bs && typeof bs.winRatePctStr === 'string' ? bs.winRatePctStr + '%' : ''
        return `
        <tr>
          <td><code>${b.batchUid ?? ''}</code></td>
          <td>${b.strategy}</td>
          <td>${b.comment ?? ''}</td>
          <td>${pnl}</td>
          <td>${wr}</td>
          <td>${b.createdAt ? new Date(b.createdAt).toLocaleString() : ''}</td>
        </tr>`
      })
      .join('')
    return /* html */ `
      <div class="card">
        <table>
          <thead><tr><th>batchUid</th><th>strategy</th><th>comment</th><th>pnl</th><th>win rate</th><th>created</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  })
}
