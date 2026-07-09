/**
 * battery.ts — tabulate the Stage-2 robustness battery across runs
 * (EPISTEMOLOGY.md §5): latency curve, parameter neighborhood, composition.
 *
 * Takes run ids and/or batch uids, prints one comparison row per run so the
 * Judge sees the curve/neighborhood in one block. Read-only.
 *
 * Usage:
 *   npx tsx fable-lab/tools/battery.ts --runs 301,302,303
 *   npx tsx fable-lab/tools/battery.ts --batches EXP-014-probe,EXP-014-lat150,EXP-014-lat300
 *   npx tsx fable-lab/tools/battery.ts --exp EXP-014         # all runs labeled EXP-014-*
 */
import { eq, like } from 'drizzle-orm'
import { getDb, closeDb, backtestRuns, backtestRunMarkets } from '../../src/db/index.js'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function resolveRunIds(): Promise<number[]> {
  const db = getDb()
  const ids = new Set<number>()
  for (const r of (argValue('--runs') ?? '').split(',').filter(Boolean)) ids.add(Number(r))
  for (const b of (argValue('--batches') ?? '').split(',').filter(Boolean)) {
    const rows = await db
      .select({ id: backtestRuns.id })
      .from(backtestRuns)
      .where(eq(backtestRuns.batchUid, b))
    rows.forEach((r) => ids.add(r.id))
  }
  const exp = argValue('--exp')
  if (exp) {
    const rows = await db
      .select({ id: backtestRuns.id })
      .from(backtestRuns)
      .where(like(backtestRuns.batchUid, `${exp}-%`))
    rows.forEach((r) => ids.add(r.id))
  }
  return [...ids].sort((a, b) => a - b)
}

async function main() {
  const runIds = await resolveRunIds()
  if (runIds.length === 0) throw new Error('pass --runs, --batches, or --exp')
  const db = getDb()

  console.log(
    'runId  batchUid'.padEnd(48) +
      'params'.padEnd(40) +
      'N     played  EV/mkt    q        t       makerShare feeTotal',
  )
  for (const id of runIds) {
    const [run] = await db
      .select({
        id: backtestRuns.id,
        batchUid: backtestRuns.batchUid,
        params: backtestRuns.params,
      })
      .from(backtestRuns)
      .where(eq(backtestRuns.id, id))
    if (!run) {
      console.log(`${id}  (not found)`)
      continue
    }
    const rows = await db
      .select({
        pnl: backtestRunMarkets.pnl,
        tradeCount: backtestRunMarkets.tradeCount,
        maker: backtestRunMarkets.tradeAsMaker,
        taker: backtestRunMarkets.tradeAsTaker,
        fees: backtestRunMarkets.feesPaid,
      })
      .from(backtestRunMarkets)
      .where(eq(backtestRunMarkets.runId, id))
    const pnls = rows.map((r) => Number(r.pnl ?? 0))
    const n = pnls.length
    const mean = n ? pnls.reduce((a, b) => a + b, 0) / n : 0
    const sd =
      n > 1 ? Math.sqrt(pnls.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0
    const q = sd > 0 ? mean / sd : null
    const t = q != null ? q * Math.sqrt(n) : null
    const maker = rows.reduce((a, r) => a + Number(r.maker ?? 0), 0)
    const taker = rows.reduce((a, r) => a + Number(r.taker ?? 0), 0)
    const fees = rows.reduce((a, r) => a + Number(r.fees ?? 0), 0)
    const played = rows.filter((r) => Number(r.tradeCount ?? 0) > 0).length
    console.log(
      `${String(run.id).padEnd(7)}${String(run.batchUid).padEnd(41)}` +
        `${JSON.stringify(run.params).slice(0, 38).padEnd(40)}` +
        `${String(n).padEnd(6)}${String(played).padEnd(8)}` +
        `${fmt(mean).padEnd(10)}${fmt(q).padEnd(9)}${fmt(t).padEnd(8)}` +
        `${fmt(maker + taker > 0 ? maker / (maker + taker) : null).padEnd(11)}${fmt(fees)}`,
    )
  }
  console.log(
    '\nJudge reads: latency rows (lat0=probe/main window, lat150, lat300) — does t decay? ' +
      'grid rows — does the sign flip erratically across neighbors?',
  )
}

function fmt(x: number | null): string {
  return x == null ? 'n/a' : String(Math.round(x * 10_000) / 10_000)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
