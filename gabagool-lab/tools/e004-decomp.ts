/**
 * e004-decomp.ts — pre-registered E004 mechanism split (LEDGER §E004):
 * decompose ΔEL between completion arms into settlement components.
 *
 * Identity (REB=0 at threshold in all E004 arms; settlement recheck
 * green): EL = mergable·$1 + winnerRemainder·$1 − cost − splitCost
 * − eraTakerFee. All five terms are per-market means over ALL
 * persisted markets, so deltas add up to ΔEL exactly. The tool
 * asserts the identity against computeMarketEcon's EL per run and
 * aborts if they diverge (>1e-4 $/mkt) — decomposition must match
 * the canonical readout or die loudly.
 *
 * Usage: npx tsx gabagool-lab/tools/e004-decomp.ts --runs 682,692,696,694
 * First run is the baseline; deltas are (arm − baseline).
 */
import { closeDb, computeMarketEcon, loadMarketRows, loadRunHeader, mean } from './lib.js'

type Comp = {
  runId: number
  batchUid: string
  n: number
  pair: number // mean mergable·$1
  rem: number // mean winner-remainder·$1
  cost: number // mean cost+splitCost
  fee: number // mean era taker fee
  el: number // identity EL
  elEcon: number // canonical EL (computeMarketEcon)
}

async function compute(runId: number): Promise<Comp> {
  const header = await loadRunHeader(runId)
  if (!header) throw new Error(`run ${runId} not found`)
  const rows = await loadMarketRows(runId)
  const pair: number[] = []
  const rem: number[] = []
  const cost: number[] = []
  const fee: number[] = []
  const elEcon: number[] = []
  for (const m of rows) {
    const econ = computeMarketEcon(m)
    const outcome = m.finalOutcome ?? 'UP'
    // Effective shares = stored shares + sim share-docking undone (the
    // era re-price charges taker fees in USDC instead; lib.ts pnlCorr).
    const up = m.upShares + econ.dockedUp
    const down = m.downShares + econ.dockedDown
    const pairs = Math.min(up, down)
    const remShares = outcome === 'UP' ? up - pairs : down - pairs
    pair.push(pairs)
    rem.push(remShares)
    cost.push(m.cost + m.splitCost)
    fee.push(econ.takerFeeEra)
    elEcon.push(econ.el)
  }
  const c: Comp = {
    runId,
    batchUid: header.batchUid,
    n: rows.length,
    pair: mean(pair),
    rem: mean(rem),
    cost: mean(cost),
    fee: mean(fee),
    el: mean(pair) + mean(rem) - mean(cost) - mean(fee),
    elEcon: mean(elEcon),
  }
  if (Math.abs(c.el - c.elEcon) > 1e-4)
    throw new Error(
      `run ${runId}: identity EL ${c.el.toFixed(6)} != canonical EL ${c.elEcon.toFixed(6)} — decomposition invalid`,
    )
  return c
}

function fmt(x: number): string {
  return (x >= 0 ? '+' : '') + x.toFixed(4)
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--runs')
  if (i < 0) throw new Error('usage: e004-decomp.ts --runs <baseId,id,id,...>')
  const ids = String(process.argv[i + 1])
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (ids.length < 2) throw new Error('need >=2 run ids (first = baseline)')

  const comps: Comp[] = []
  for (const id of ids) comps.push(await compute(id))
  const base = comps[0]

  console.log('=== E004 mechanism split ($/market means; EL = pair + rem − cost − fee) ===')
  console.log(`baseline: run ${base.runId} (${base.batchUid})`)
  console.log('run    n     pair$      rem$       cost$      fee$      EL')
  for (const c of comps)
    console.log(
      `${String(c.runId).padEnd(6)} ${String(c.n).padEnd(5)} ${c.pair.toFixed(4).padStart(9)} ${c.rem
        .toFixed(4)
        .padStart(9)} ${c.cost.toFixed(4).padStart(10)} ${c.fee.toFixed(4).padStart(8)} ${c.el
        .toFixed(4)
        .padStart(9)}`,
    )
  console.log('-- deltas vs baseline (Δpair + Δrem − Δcost − Δfee = ΔEL) --')
  for (const c of comps.slice(1)) {
    const dEl = c.el - base.el
    console.log(
      `${String(c.runId).padEnd(6)} Δpair ${fmt(c.pair - base.pair)}  Δrem ${fmt(
        c.rem - base.rem,
      )}  Δcost ${fmt(c.cost - base.cost)}  Δfee ${fmt(c.fee - base.fee)}  → ΔEL ${fmt(dEl)}`,
    )
  }
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
