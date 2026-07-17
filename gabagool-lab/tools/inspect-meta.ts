/**
 * inspect-meta.ts — dump one market's intent_meta from a run (debug aid).
 * Usage: npx tsx gabagool-lab/tools/inspect-meta.ts --run <id> [--idx 0]
 */
import { asc, eq } from 'drizzle-orm'
import { closeDb, getDb, backtestRunMarkets } from '../../src/db/index.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const get = (f: string): string | undefined => {
    const i = argv.indexOf(f)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const runId = Number(get('--run'))
  const idx = Number(get('--idx') ?? 0)
  const db = getDb()
  const rows = await db
    .select({
      slug: backtestRunMarkets.slug,
      pnl: backtestRunMarkets.pnl,
      tradeCount: backtestRunMarkets.tradeCount,
      tradeAsMaker: backtestRunMarkets.tradeAsMaker,
      tradeAsTaker: backtestRunMarkets.tradeAsTaker,
      feesPaid: backtestRunMarkets.feesPaid,
      upShares: backtestRunMarkets.upShares,
      downShares: backtestRunMarkets.downShares,
      cost: backtestRunMarkets.cost,
      intentMeta: backtestRunMarkets.intentMeta,
    })
    .from(backtestRunMarkets)
    .where(eq(backtestRunMarkets.runId, runId))
    .orderBy(asc(backtestRunMarkets.idx))
  const r = rows[idx]
  if (!r) {
    console.error(`no market at idx ${idx} (run has ${rows.length})`)
    process.exit(1)
  }
  console.log(
    JSON.stringify(
      {
        slug: r.slug,
        pnl: r.pnl,
        trades: r.tradeCount,
        maker: r.tradeAsMaker,
        taker: r.tradeAsTaker,
        feesPaid: r.feesPaid,
        upShares: r.upShares,
        downShares: r.downShares,
        cost: r.cost,
      },
      null,
      2,
    ),
  )
  console.log('intent_meta entries:', Array.isArray(r.intentMeta) ? r.intentMeta.length : 'none')
  console.log(JSON.stringify(r.intentMeta, null, 2))
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
