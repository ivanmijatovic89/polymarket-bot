/**
 * trades-coverage.ts — read-only: does the Telonex catalog report `trades`
 * (and quotes / onchain_fills) channel coverage for the lab's eligible
 * universe? Motivated by EDGE-SPACE §3.2 (queue-realistic fill model needs
 * trade prints); sync-design.md §301 says these channels exist upstream but
 * v1 sync only pulls book_snapshot_full. The synced catalog rows already
 * carry per-market availability ranges (schema.ts:379).
 */
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../../src/config/telonex.js'

async function main() {
  const db = getDb()
  const [rows] = await db.execute(sql`
    SELECT
      COUNT(*) AS eligible_catalog_rows,
      SUM(CASE WHEN trades_from IS NOT NULL THEN 1 ELSE 0 END) AS has_trades,
      SUM(CASE WHEN quotes_from IS NOT NULL THEN 1 ELSE 0 END) AS has_quotes,
      SUM(CASE WHEN onchain_fills_from IS NOT NULL THEN 1 ELSE 0 END) AS has_onchain_fills,
      MIN(trades_from) AS trades_min,
      MAX(trades_to) AS trades_max
    FROM telonex_markets
    WHERE symbol = 'btc' AND timeframe = '15m'
      AND market_start_ms >= ${TELONEX_DATASET_ELIGIBLE_FROM_MS}
  `)
  console.log(rows)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
