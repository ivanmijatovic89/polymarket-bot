/**
 * universe.ts — list the game's fixed market universe. Read-only.
 *
 * RULES: "Markets are ordered chronologically. First N markets always means the
 * first N eligible markets from that fixed floor" (2026-04-02, btc 15m,
 * telonex delta-typed conversions, read-from local-or-download-from-r2-to-local).
 *
 * This is the SINGLE definition of "the first N markets" for level selection —
 * every level submission passes the slugs printed here, so market selection can
 * never drift with dataset growth.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-game-opus/tools/universe.ts --first 5
 *   tsx protocols/pair-game-opus/tools/universe.ts --first 1 --slugs-only
 */
import '../../../src/config/env.js'
import { listEligibleTelonexMarkets } from '../../../src/db/telonexMarkets.js'

const FLOOR_MS = 1775088000000 // 2026-04-02T00:00:00Z

const argv = process.argv.slice(2)
let first = 5
let slugsOnly = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  if (a === '--first') {
    const n = Number(argv[++i])
    if (!Number.isInteger(n) || n < 1) {
      console.error('[universe] --first expects a positive integer')
      process.exit(2)
    }
    first = n
  } else if (a === '--slugs-only') {
    slugsOnly = true
  } else {
    console.error(`[universe] unknown flag '${a}' (valid: --first N, --slugs-only)`)
    process.exit(2)
  }
}

const markets = await listEligibleTelonexMarkets({
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'local-or-download-from-r2-to-local',
  fromMs: FLOOR_MS,
  limit: first,
})

if (slugsOnly) {
  console.log(markets.map((m) => m.slug).join(','))
} else {
  for (const [i, m] of markets.entries()) {
    console.log(
      `${String(i + 1).padStart(3)}  ${m.slug}  start=${new Date(m.marketStartMs).toISOString()}  ` +
        `priceToBeat=${m.priceToBeat ?? '-'}  outcomes=${m.outcome0}/${m.outcome1}`,
    )
  }
}
process.exit(0)
