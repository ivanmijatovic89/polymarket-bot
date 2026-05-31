import { getRedis } from '../redis'

export type WorkerStats = {
  name: string
  commitSha: string | null
  heartbeatAgeMs: number | null
  alive: boolean
  processedTotal: number
  eventsTotal: number
  lastMarket: string | null
  lastFinishedAt: number | null
}

const STALE_WORKER_GRACE_MS = 5 * 60 * 1000

export async function listWorkers(): Promise<WorkerStats[]> {
  const conn = getRedis()
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
