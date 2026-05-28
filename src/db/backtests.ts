import { getDb } from './index.js'
import { backtests } from './schema.js'

function mustGetDb(): ReturnType<typeof getDb> {
  const db = getDb()
  if (!db) {
    throw new Error('[db] getDb() returned null (unexpected)')
  }
  return db
}

export async function insertBacktestRun(row: {
  batchUid: string
  baselineId: string | null
  cmd: string
  comment: string | null
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  slugs: string[] | null
  limit: number | null
  random: boolean
  latest: boolean
  batchStats: Record<string, unknown>
  marketStats: unknown[]
  chunkedBatchStats?: Record<string, unknown> | null
}): Promise<void> {
  const db = mustGetDb()
  await db.insert(backtests).values({
    batchUid: row.batchUid,
    baselineId: row.baselineId,
    cmd: row.cmd,
    comment: row.comment,
    strategy: row.strategy,
    params: row.params,
    symbol: row.symbol,
    slugs: row.slugs,
    limit: row.limit,
    random: row.random,
    latest: row.latest,
    batchStats: row.batchStats,
    marketStats: row.marketStats,
    ...(row.chunkedBatchStats !== undefined ? { chunkedBatchStats: row.chunkedBatchStats } : {}),
  })
}
