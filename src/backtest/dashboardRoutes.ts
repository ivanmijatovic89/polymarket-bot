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
import { aggregateJobId } from './jobTypes.js'
import type { MarketStats } from './stats/marketStats.js'

/** Minimal HTML-escape so user-controlled strings (slug, batchUid, …) don't break the page. */
function esc(s: unknown): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

type ActiveBatchSummary = {
  batchUid: string
  strategy: string
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  parentState: string | undefined
}

/**
 * Counts per-child state for one parent flow by probing a small sample of
 * its children (BullMQ doesn't expose a queue-level filter by jobId prefix).
 *
 * For the active count we look at the market queue's currently-active jobs
 * and intersect with the batchUid prefix — that scans a bounded slice
 * (concurrency × workers, typically ≤ 16) so it's fine to do per-request.
 */
async function countActiveChildrenForBatch(batchUid: string): Promise<number> {
  const queue = getMarketQueue()
  const activeJobs = await queue.getJobs(['active'], 0, 200)
  let n = 0
  for (const j of activeJobs) {
    const id = j?.id
    if (typeof id === 'string' && id.startsWith(`${batchUid}-m-`)) n += 1
  }
  return n
}

async function listActiveBatches(): Promise<ActiveBatchSummary[]> {
  const agg = getAggregateQueue()
  // Aggregate jobs that haven't finished yet: waiting-children + waiting + active + delayed.
  const jobs = await agg.getJobs(['waiting-children', 'waiting', 'active', 'delayed'], 0, 100)
  const out: ActiveBatchSummary[] = []
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

    const failedChildrenValues = await job.getFailedChildrenValues()
    const failedChildren = Object.keys(failedChildrenValues).length
    const processedTotal = dependencies.processed ?? 0
    const completedChildren = Math.max(0, processedTotal - failedChildren)
    const unprocessedTotal = dependencies.unprocessed ?? 0
    const activeChildren = await countActiveChildrenForBatch(batchUid)
    const waitingChildren = Math.max(0, unprocessedTotal - activeChildren)

    out.push({
      batchUid,
      strategy: data.insertMeta?.strategy ?? 'unknown',
      totalMarkets,
      waitingChildren,
      activeChildren,
      completedChildren,
      failedChildren,
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
    const batchUid = req.params.batchUid
    // Try active flow parent first; fall back to MySQL row if finalized.
    const parent = await getAggregateQueue().getJob(aggregateJobId(batchUid))
    if (parent) {
      const state = await parent.getState()
      const dependencies = await parent.getDependenciesCount({ processed: true, unprocessed: true })
      const failedChildrenValues = await parent.getFailedChildrenValues()
      const failedChildren = Object.keys(failedChildrenValues).length
      const completedChildren = Math.max(0, (dependencies.processed ?? 0) - failedChildren)
      const activeChildren = await countActiveChildrenForBatch(batchUid)
      const data = parent.data as { totalMarkets?: number; insertMeta?: { strategy?: string } }
      return {
        batchUid,
        active: true,
        parentState: state,
        strategy: data.insertMeta?.strategy ?? 'unknown',
        totalMarkets: data.totalMarkets ?? 0,
        waitingChildren: Math.max(0, (dependencies.unprocessed ?? 0) - activeChildren),
        activeChildren,
        completedChildren,
        failedChildren,
      }
    }
    const detail = await getBatchDetail(batchUid)
    if (!detail) {
      reply.code(404)
      return { error: 'batch not found' }
    }
    return { batchUid, active: false, batch: detail }
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
        const total = b.totalMarkets
        const progressBar = renderProgressBar({
          total,
          completed: b.completedChildren,
          active: b.activeChildren,
          failed: b.failedChildren,
        })
        return `
        <tr>
          <td><a href="/batches/${encodeURIComponent(b.batchUid)}"><code>${esc(b.batchUid)}</code></a></td>
          <td>${esc(b.strategy)}</td>
          <td style="min-width: 240px;">${progressBar}</td>
          <td>${b.completedChildren}</td>
          <td>${b.activeChildren}</td>
          <td>${b.waitingChildren}</td>
          <td>${b.failedChildren > 0 ? `<span class="dead">${b.failedChildren}</span>` : '0'}</td>
          <td><span class="pill">${esc(b.parentState ?? '?')}</span></td>
        </tr>`
      })
      .join('')
    return /* html */ `
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>batchUid</th><th>strategy</th><th>progress</th>
              <th>done</th><th>active</th><th>waiting</th><th>failed</th>
              <th>state</th>
            </tr>
          </thead>
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
        const uid = b.batchUid ?? ''
        const uidCell = uid
          ? `<a href="/batches/${encodeURIComponent(uid)}"><code>${esc(uid)}</code></a>`
          : ''
        const pnlClass = bs && typeof bs.pnlTotal === 'number' && bs.pnlTotal < 0 ? 'dead' : 'alive'
        return `
        <tr>
          <td>${uidCell}</td>
          <td>${esc(b.strategy)}</td>
          <td>${esc(b.comment ?? '')}</td>
          <td class="${pnl !== '' ? pnlClass : ''}">${esc(pnl)}</td>
          <td>${esc(wr)}</td>
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

  // -------------------------------------------------------------------------
  // /batches/:uid — detail page that works for both active and completed.
  // For active batches it shows the live state breakdown and polls every 3s.
  // For completed batches it shows batchStats summary + per-market grid with
  // execution metadata (worker, durationMs, eventsProcessed).
  // -------------------------------------------------------------------------
  app.get<{ Params: { batchUid: string } }>('/batches/:batchUid', async (req, reply) => {
    const uid = req.params.batchUid
    reply.type('text/html; charset=utf-8')
    return /* html */ `${PAGE_HEAD(`Batch ${esc(uid)}`)}
  <div class="nav">
    <strong>Backtest Dashboard</strong>
    &nbsp;·&nbsp;
    <a href="/">Overview</a>
    <a href="/admin/queues">Bull Board (raw)</a>
  </div>
  <h2>Batch <code>${esc(uid)}</code></h2>
  <div hx-get="/partials/batch/${encodeURIComponent(uid)}" hx-trigger="load, every 3s" hx-swap="innerHTML"></div>
</body>
</html>`
  })

  app.get<{ Params: { batchUid: string } }>('/partials/batch/:batchUid', async (req, reply) => {
    const uid = req.params.batchUid
    reply.type('text/html; charset=utf-8')
    // Active? probe Redis first.
    const parent = await getAggregateQueue().getJob(aggregateJobId(uid))
    if (parent) {
      const state = await parent.getState()
      const dependencies = await parent.getDependenciesCount({
        processed: true,
        unprocessed: true,
      })
      const failedChildrenValues = await parent.getFailedChildrenValues()
      const failedChildren = Object.keys(failedChildrenValues).length
      const completedChildren = Math.max(0, (dependencies.processed ?? 0) - failedChildren)
      const activeChildren = await countActiveChildrenForBatch(uid)
      const data = parent.data as {
        totalMarkets?: number
        insertMeta?: { strategy?: string; comment?: string | null }
      }
      const total = data.totalMarkets ?? 0
      const waitingChildren = Math.max(0, (dependencies.unprocessed ?? 0) - activeChildren)
      const progressBar = renderProgressBar({
        total,
        completed: completedChildren,
        active: activeChildren,
        failed: failedChildren,
      })

      const failedList =
        failedChildren > 0
          ? Object.entries(failedChildrenValues)
              .slice(0, 50)
              .map(
                ([jobId, reason]) =>
                  `<tr><td><code>${esc(jobId)}</code></td><td>${esc(String(reason).slice(0, 200))}</td></tr>`,
              )
              .join('')
          : ''
      return /* html */ `
          <div class="card">
            <div class="label">Status</div>
            <div class="stat"><span class="pill">${esc(state)}</span> &nbsp;${esc(data.insertMeta?.strategy ?? 'unknown')}</div>
            <p>${esc(data.insertMeta?.comment ?? '')}</p>
            <div style="margin: 16px 0;">${progressBar}</div>
            <table>
              <thead><tr><th>completed</th><th>active</th><th>waiting</th><th>failed</th><th>total</th></tr></thead>
              <tbody>
                <tr>
                  <td>${completedChildren}</td>
                  <td>${activeChildren}</td>
                  <td>${waitingChildren}</td>
                  <td class="${failedChildren > 0 ? 'dead' : ''}">${failedChildren}</td>
                  <td>${total}</td>
                </tr>
              </tbody>
            </table>
          </div>
          ${
            failedList
              ? `<h3>Failed children (first 50)</h3>
                 <div class="card">
                   <table>
                     <thead><tr><th>jobId</th><th>reason</th></tr></thead>
                     <tbody>${failedList}</tbody>
                   </table>
                 </div>`
              : ''
          }`
    }

    // Completed? read MySQL row.
    const detail = await getBatchDetail(uid)
    if (!detail) {
      return `<div class="card">No batch found with batchUid <code>${esc(uid)}</code>. Either it never existed, or it's still in the queue and the dashboard can't see the row yet.</div>`
    }
    const bs = (detail.batchStats ?? {}) as Record<string, unknown>
    const cbs = (detail.chunkedBatchStats ?? null) as Record<string, unknown> | null
    const marketStats = (detail.marketStats as MarketStats[] | null) ?? []
    const failed =
      (detail.failedMarkets as Array<{
        idx: number | null
        slug: string | null
        reason: string
        jobId?: string
      }> | null) ?? null

    const pnl =
      typeof bs.pnlTotal === 'number' ? (bs.pnlTotal as number).toFixed(2) : esc(bs.pnlTotal ?? '')
    const wr = typeof bs.winRatePctStr === 'string' ? (bs.winRatePctStr as string) + '%' : ''
    const trades = typeof bs.tradesTotal === 'number' ? String(bs.tradesTotal) : ''
    const totalMarkets = typeof bs.marketsTotal === 'number' ? String(bs.marketsTotal) : ''
    const played = typeof bs.marketsPlayed === 'number' ? String(bs.marketsPlayed) : ''

    const marketRows = marketStats
      .map((m, i) => {
        const exec = m.execution
        const dur = exec ? exec.durationMs : ''
        const evs = exec ? exec.eventsProcessed.toLocaleString() : ''
        const worker = exec ? exec.workerName : ''
        const slowClass = exec && exec.durationMs > 10_000 ? 'dead' : ''
        const pnlClass = m.pnl > 0 ? 'alive' : m.pnl < 0 ? 'dead' : ''
        return `
            <tr>
              <td>${i}</td>
              <td><code>${esc(m.slug)}</code></td>
              <td>${esc(m.finalOutcome)}</td>
              <td class="${pnlClass}">${m.pnl.toFixed(2)}</td>
              <td>${m.tradeCount}</td>
              <td>${esc(worker)}</td>
              <td class="${slowClass}">${dur === '' ? '' : `${dur} ms`}</td>
              <td>${evs}</td>
            </tr>`
      })
      .join('')

    const chunkedTable =
      cbs && cbs.segments
        ? renderChunkedSegments(cbs.segments as Array<Record<string, unknown>>)
        : ''

    const failedSection =
      failed && failed.length > 0
        ? `<h3>Failed markets (${failed.length})</h3>
             <div class="card">
               <table>
                 <thead><tr><th>idx</th><th>slug</th><th>reason</th></tr></thead>
                 <tbody>${failed
                   .slice(0, 100)
                   .map(
                     (f) =>
                       `<tr><td>${f.idx ?? ''}</td><td><code>${esc(f.slug ?? '')}</code></td><td>${esc(f.reason.slice(0, 200))}</td></tr>`,
                   )
                   .join('')}</tbody>
               </table>
             </div>`
        : ''

    return /* html */ `
        <div class="grid">
          <div class="card"><div class="label">Strategy</div><div class="stat" style="font-size:18px">${esc(detail.strategy)}</div></div>
          <div class="card"><div class="label">Comment</div><div class="stat" style="font-size:14px">${esc(detail.comment ?? '')}</div></div>
          <div class="card"><div class="label">PnL total</div><div class="stat ${typeof bs.pnlTotal === 'number' && (bs.pnlTotal as number) < 0 ? 'dead' : 'alive'}">${pnl}</div></div>
          <div class="card"><div class="label">Win rate</div><div class="stat">${esc(wr)}</div></div>
          <div class="card"><div class="label">Markets played</div><div class="stat">${esc(played)} / ${esc(totalMarkets)}</div></div>
          <div class="card"><div class="label">Total trades</div><div class="stat">${esc(trades)}</div></div>
        </div>

        ${chunkedTable}

        <h3>Per-market (${marketStats.length})</h3>
        <p class="label" style="font-size:11px">Rows where duration > 10s are flagged in red.</p>
        <div class="card" style="overflow-x:auto;max-height:600px;overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th>idx</th><th>slug</th><th>outcome</th><th>pnl</th><th>trades</th>
                <th>worker</th><th>duration</th><th>events</th>
              </tr>
            </thead>
            <tbody>${marketRows}</tbody>
          </table>
        </div>

        ${failedSection}`
  })
}

const PAGE_HEAD = (title: string): string => /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #0b0d10; color: #e8eaed; }
    h1, h2, h3 { font-weight: 600; }
    a { color: #8ab4f8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 16px 0 32px; }
    .card { background: #16191d; border: 1px solid #2a2d31; border-radius: 8px; padding: 16px; }
    .stat { font-size: 28px; font-weight: 700; line-height: 1.1; margin: 8px 0; }
    .label { color: #9aa0a6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #2a2d31; font-size: 12.5px; }
    th { color: #9aa0a6; font-weight: 500; position: sticky; top: 0; background: #16191d; }
    .alive { color: #81c995; }
    .dead { color: #f28b82; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #2a2d31; font-size: 11px; }
    .nav { margin-bottom: 24px; }
    .nav a { margin-right: 16px; }
    .progress-bar { display: flex; height: 14px; border-radius: 4px; overflow: hidden; background: #2a2d31; font-size: 10px; line-height: 14px; }
    .progress-bar > div { color: #0b0d10; text-align: center; white-space: nowrap; }
    .progress-done { background: #81c995; }
    .progress-active { background: #fdd663; }
    .progress-failed { background: #f28b82; }
    .progress-label { color: #9aa0a6; font-size: 11px; margin-top: 4px; }
  </style>
</head>
<body>`

function renderProgressBar(opts: {
  total: number
  completed: number
  active: number
  failed: number
}): string {
  const { total, completed, active, failed } = opts
  if (total <= 0) return '<span class="label">—</span>'
  const pctDone = (completed / total) * 100
  const pctActive = (active / total) * 100
  const pctFailed = (failed / total) * 100
  return /* html */ `
    <div class="progress-bar" title="${completed} done / ${active} active / ${failed} failed / ${total} total">
      ${pctDone > 0 ? `<div class="progress-done" style="width:${pctDone}%"></div>` : ''}
      ${pctActive > 0 ? `<div class="progress-active" style="width:${pctActive}%"></div>` : ''}
      ${pctFailed > 0 ? `<div class="progress-failed" style="width:${pctFailed}%"></div>` : ''}
    </div>
    <div class="progress-label">${completed + active + failed} / ${total} (${pctDone.toFixed(1)}% done)</div>`
}

function renderChunkedSegments(segments: Array<Record<string, unknown>>): string {
  if (!Array.isArray(segments) || segments.length === 0) return ''
  // Pick a representative window if multiple are present.
  const head = segments[0] as { window?: number; segments?: Array<Record<string, unknown>> }
  const list = (head && Array.isArray(head.segments) ? head.segments : segments) as Array<
    Record<string, unknown>
  >
  if (list.length === 0) return ''
  const rows = list
    .map((s) => {
      const pnl =
        typeof s.pnlTotal === 'number' ? (s.pnlTotal as number).toFixed(2) : esc(s.pnlTotal ?? '')
      const wr = typeof s.winRatePctStr === 'string' ? (s.winRatePctStr as string) + '%' : ''
      const cls =
        typeof s.pnlTotal === 'number' ? ((s.pnlTotal as number) < 0 ? 'dead' : 'alive') : ''
      return `<tr><td>${esc(s.from ?? '')}–${esc(s.to ?? '')}</td><td class="${cls}">${pnl}</td><td>${esc(wr)}</td><td>${esc(s.tradesTotal ?? '')}</td></tr>`
    })
    .join('')
  return `<h3>Chunked segments (window ${esc(head.window ?? '?')})</h3>
    <div class="card">
      <table>
        <thead><tr><th>idx range</th><th>pnl</th><th>win rate</th><th>trades</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}
