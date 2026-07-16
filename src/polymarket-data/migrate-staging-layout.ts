#!/usr/bin/env tsx
import '../config/env.js'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/index.js'
import { migrateLegacyMarketFacts } from './storage/migrateLayout.js'
import type { MarketFactLocator } from './storage/paths.js'

const LABEL = '[polymarket-data:migrate-staging-layout]'

async function main(): Promise<void> {
  const result = await getDb().execute(
    sql`SELECT id, slug, symbol, timeframe, market_start_ms
        FROM polymarket_markets
        ORDER BY id`,
  )
  const rows = (result as unknown as Array<Array<Record<string, unknown>>>)[0] ?? []
  const markets: MarketFactLocator[] = rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    marketStartMs: Number(row.market_start_ms),
  }))
  const moved = await migrateLegacyMarketFacts(markets)
  console.log(`${LABEL} moved trades=${moved.trades} positions=${moved.positions}`)
}

main()
  .then(async () => closeDb())
  .catch(async (error) => {
    console.error(`${LABEL} ${(error as Error).message}`)
    await closeDb().catch(() => {})
    process.exit(1)
  })
