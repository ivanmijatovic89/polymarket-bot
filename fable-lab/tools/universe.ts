/**
 * universe.ts — report the eligible BTC 15m telonex universe and compute the
 * exploration/holdout boundary for experiment registration.
 *
 * Read-only. Scope is operator-fixed (CHARTER): btc / 15m / delta-typed /
 * local-or-download-from-r2-to-local.
 *
 * Usage:
 *   npx tsx fable-lab/tools/universe.ts [--holdout-frac 0.25] [--json]
 */
import {
  countEligibleTelonexMarkets,
  listEligibleTelonexMarkets,
} from '../../src/db/telonexMarkets.js'
import { closeDb, getDb } from '../../src/db/index.js'
import { sql } from 'drizzle-orm'

const SCOPE = {
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'local-or-download-from-r2-to-local',
} as const

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const holdoutFrac = Number(argValue('--holdout-frac') ?? '0.25')
  if (!(holdoutFrac > 0 && holdoutFrac < 1)) {
    throw new Error('--holdout-frac must be in (0,1)')
  }
  const asJson = process.argv.includes('--json')

  const total = await countEligibleTelonexMarkets(SCOPE)
  if (total === 0) {
    console.log('Eligible universe is EMPTY for scope', SCOPE)
    return
  }
  const markets = await listEligibleTelonexMarkets({ ...SCOPE, limit: total })
  // listEligibleTelonexMarkets orders by market_start_ms ASC (non-random path)
  const first = markets[0]
  const last = markets[markets.length - 1]
  const boundaryIdx = Math.floor(markets.length * (1 - holdoutFrac))
  const boundary = markets[boundaryIdx]

  // Ingestion lag (U64): catalog rows synced but not yet ingested past the last
  // ELIGIBLE market. Inline SQL is the lab convention for non-eligibility catalog
  // reads (trades-coverage.ts precedent) — eligibility queries still go through
  // src/db/telonexMarkets.ts only. NOTE: reflects the LOCAL catalog, i.e. only as
  // fresh as the last `npm run telonex:sync`; for vendor-side freshness run
  // `npm run telonex:sync -- --dry-run` (read-only) and compare matched vs total.
  const db = getDb()
  const [lagRows] = await db.execute(sql`
    SELECT COUNT(*) n, MAX(market_start_ms) max_ms
    FROM telonex_markets
    WHERE symbol = ${SCOPE.symbol} AND timeframe = ${SCOPE.timeframe}
      AND market_start_ms > ${last.marketStartMs}`)
  const lag = (lagRows as unknown as { n: number; max_ms: number | string | null }[])[0]
  const awaiting = Number(lag?.n ?? 0)
  const awaitingMaxMs = lag?.max_ms == null ? null : Number(lag.max_ms)

  const report = {
    scope: SCOPE,
    eligibleTotal: total,
    listedTotal: markets.length,
    firstMarket: { slug: first.slug, startMs: first.marketStartMs, iso: iso(first.marketStartMs) },
    lastMarket: { slug: last.slug, startMs: last.marketStartMs, iso: iso(last.marketStartMs) },
    holdoutFrac,
    explorationCount: boundaryIdx,
    holdoutCount: markets.length - boundaryIdx,
    holdoutBoundaryMs: boundary.marketStartMs,
    holdoutBoundaryIso: iso(boundary.marketStartMs),
    catalogAwaitingIngestion: awaiting,
    catalogAwaitingMaxIso: awaitingMaxMs == null ? null : iso(awaitingMaxMs),
    note:
      'Register experiments with: exploration = market_start_ms < holdoutBoundaryMs; ' +
      'holdout = holdoutBoundaryMs <= market_start_ms <= lastMarket.startMs (one-shot, ' +
      'BOTH bounds frozen in the spec — markets accruing later belong to no window).',
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Eligible BTC 15m universe (delta-typed, r2-or-local):`)
    console.log(`  total eligible: ${report.eligibleTotal} (listed ${report.listedTotal})`)
    console.log(`  first: ${report.firstMarket.slug}  ${report.firstMarket.iso}`)
    console.log(`  last:  ${report.lastMarket.slug}  ${report.lastMarket.iso}`)
    console.log(`  holdout fraction: ${holdoutFrac}`)
    console.log(`  exploration markets: ${report.explorationCount}`)
    console.log(`  holdout markets:     ${report.holdoutCount}`)
    console.log(`  HOLDOUT BOUNDARY: market_start_ms >= ${report.holdoutBoundaryMs}`)
    console.log(`                    (${report.holdoutBoundaryIso})`)
    if (awaiting > 0) {
      console.log(
        `  CATALOG AWAITING INGESTION: ${awaiting} synced markets past the last eligible ` +
          `(through ${report.catalogAwaitingMaxIso}) — need operator download+convert ` +
          `(see knowledge/DATASET-GROWTH.md)`,
      )
    } else {
      console.log(
        `  catalog in step with eligible universe (local catalog only — vendor may be ahead; ` +
          `probe with: npm run telonex:sync -- --dry-run)`,
      )
    }
    console.log(`  ${report.note}`)
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
