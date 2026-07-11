/**
 * trades-coverage.ts — read-only: does the Telonex catalog report `trades`
 * (and quotes / onchain_fills) channel coverage for the lab's eligible
 * universe? Motivated by EDGE-SPACE §3.2 (queue-realistic fill model needs
 * trade prints); sync-design.md §301 says these channels exist upstream but
 * v1 sync only pulls book_snapshot_full. The synced catalog rows already
 * carry per-market availability ranges (schema.ts:379).
 *
 * Since U64 the lab syncs the catalog itself, so catalog rows split into two
 * buckets: `converted` (a done delta-typed conversion exists — these back the
 * eligible universe) and `awaiting-ingestion` (synced, not yet downloaded/
 * converted by the operator). The wake-up-gate baseline (STATE check 2) is
 * the CONVERTED bucket — a lab-run sync moves only the awaiting bucket
 * (motivating friction recorded in DECISIONS D39: session 53 had to
 * re-derive why the totals jumped after the U64 sync).
 */
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '../../src/db/index.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../../src/config/telonex.js'

async function main() {
  const db = getDb()
  const [rows] = await db.execute(sql`
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM telonex_market_conversions c
        WHERE c.market_id = telonex_markets.id
          AND c.converter = 'delta-typed' AND c.status = 'done'
      ) THEN 'converted' ELSE 'awaiting-ingestion' END AS bucket,
      COUNT(*) AS catalog_rows,
      SUM(CASE WHEN trades_from IS NOT NULL THEN 1 ELSE 0 END) AS has_trades,
      SUM(CASE WHEN quotes_from IS NOT NULL THEN 1 ELSE 0 END) AS has_quotes,
      SUM(CASE WHEN onchain_fills_from IS NOT NULL THEN 1 ELSE 0 END) AS has_onchain_fills,
      MIN(trades_from) AS trades_min,
      MAX(trades_to) AS trades_max
    FROM telonex_markets
    WHERE symbol = 'btc' AND timeframe = '15m'
      AND market_start_ms >= ${TELONEX_DATASET_ELIGIBLE_FROM_MS}
    GROUP BY bucket ORDER BY bucket
  `)
  console.log(rows)
  console.log(
    '[gate] STATE wake-up check 2 baseline = the CONVERTED bucket; the gate itself is a trades-aware CONVERTER on disk, not these counts.',
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
