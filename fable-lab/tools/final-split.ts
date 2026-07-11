/**
 * final-split.ts — BATCH-005 (FINAL RUN) disjoint-sample split point.
 * Outcome-free: reads only slugs + market_start_ms of the eligible
 * DISCOVERY window (< 1772323200000) and prints the median start ms.
 * Sample A = [floor, median-1], sample B = [median, 1772323199999];
 * disjoint by construction (each screen runs --random --limit N in each).
 */
import { listEligibleTelonexMarkets } from '../../src/db/telonexMarkets.js'
import { closeDb } from '../../src/db/index.js'

async function main() {
  const all = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local-or-download-from-r2-to-local',
    limit: 50000,
  })
  const disc = all
    .filter((m) => m.marketStartMs < 1772323200000)
    .sort((a, b) => a.marketStartMs - b.marketStartMs)
  const median = disc[Math.floor(disc.length / 2)].marketStartMs
  console.log(`discovery eligible: ${disc.length}`)
  console.log(`first: ${disc[0].marketStartMs} (${new Date(disc[0].marketStartMs).toISOString()})`)
  console.log(`median split: ${median} (${new Date(median).toISOString()})`)
  console.log(`A: [floor, ${median - 1}] -> ${disc.filter((m) => m.marketStartMs < median).length} markets`)
  console.log(`B: [${median}, 1772323199999] -> ${disc.filter((m) => m.marketStartMs >= median).length} markets`)
  await closeDb()
}
main().catch((e) => { console.error(e); process.exit(1) })
