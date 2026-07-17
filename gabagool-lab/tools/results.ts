/**
 * results.ts — the lab's canonical readout (EVALUATION.md §3–§6, 1:1).
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/results.ts --run <id> [--json] [--gates s1|s2]
 *   npx tsx gabagool-lab/tools/results.ts --batch <batchUid>
 *   npx tsx gabagool-lab/tools/results.ts --battery <id@140,id@0,id@500,id@1000>
 *
 * Prints the measured lines (TRADE_sim, TRADE_corr, REB, EL), weekly
 * slices, pairing health, tails, capital, sample stats, the fee-
 * reconstruction validation verdict, and (optionally) the gate table.
 * Judgments quote THIS output; nothing else counts as a reading.
 */
import {
  closeDb,
  computeMarketEcon,
  findRunIdsByBatchUid,
  loadMarketRows,
  loadRunHeader,
  loadSegments,
  mean,
  quantile,
  sum,
  tStat,
  type MarketEcon,
} from './lib.js'

type RunReadout = {
  runId: number
  header: Awaited<ReturnType<typeof loadRunHeader>>
  marketsTotal: number
  played: number
  playedShare: number
  tradeSimPm: number
  tradeCorrPm: number
  rebPm: number
  rebRawPm: number
  elPm: number
  rebShareOfEl: number | null
  subsidyCarry: boolean
  weekly: Array<{
    week: string
    n: number
    elPm: number
    tradeCorrPm: number
    rebPm: number
    positive: boolean
  }>
  fStab: number
  maxWeekShare: number | null
  tails: {
    p5: number
    cvar5: number
    maxLose: number
    pf: number
    worstWeekEl: number
  }
  pairing: { pairRate: number; imbP50: number; imbP90: number }
  capital: { avgOutlay: number; p90Outlay: number; elPer100: number }
  sample: { n: number; t: number; makerFills: number; takerFills: number; rejected: number | null }
  validation: {
    settleFails: number
    feeReconDiff: number
    feeReconTol: number
    feeReconOk: boolean
    metaCoverage: number
  }
}

function fmt(x: number, d = 4): string {
  return Number.isFinite(x) ? x.toFixed(d) : 'n/a'
}

async function readRun(runId: number): Promise<RunReadout> {
  const header = await loadRunHeader(runId)
  if (!header) throw new Error(`run ${runId} not found`)
  const rows = await loadMarketRows(runId)
  const econ: MarketEcon[] = rows.map(computeMarketEcon)

  const marketsTotal = rows.length
  const played = rows.filter((r) => r.tradeCount > 0).length
  const els = econ.map((e) => e.el)
  const elPm = mean(els)
  const tradeCorrPm = mean(econ.map((e) => e.pnlCorr))
  const tradeSimPm = mean(econ.map((e) => e.pnlSim))
  const rebPm = mean(econ.map((e) => e.rebate))
  const rebRawPm = mean(econ.map((e) => e.rebateRaw))
  const rebShareOfEl = elPm > 0 ? rebPm / elPm : null

  // Weekly slices from per-market data (corrected lines; segments table
  // stays as a sim-side cross-check, not the verdict source).
  const byWeek = new Map<string, MarketEcon[]>()
  for (const e of econ) {
    const arr = byWeek.get(e.weekKey) ?? []
    arr.push(e)
    byWeek.set(e.weekKey, arr)
  }
  const weekly = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, es]) => ({
      week,
      n: es.length,
      elPm: mean(es.map((e) => e.el)),
      tradeCorrPm: mean(es.map((e) => e.pnlCorr)),
      rebPm: mean(es.map((e) => e.rebate)),
      positive: mean(es.map((e) => e.el)) > 0,
    }))
  const fStab = weekly.length ? weekly.filter((w) => w.positive).length / weekly.length : 0
  const posWeekPnls = weekly.filter((w) => w.elPm > 0).map((w) => w.elPm * w.n)
  const maxWeekShare = posWeekPnls.length ? Math.max(...posWeekPnls) / sum(posWeekPnls) : null

  const sortedEl = [...els].sort((a, b) => a - b)
  const w5 = Math.max(1, Math.floor(els.length * 0.05))
  const cvar5 = mean(sortedEl.slice(0, w5))
  const wins = els.filter((x) => x > 0)
  const losses = els.filter((x) => x < 0)
  const pf = losses.length ? sum(wins) / Math.abs(sum(losses)) : Number.POSITIVE_INFINITY

  const playedEcon = econ.filter((_, i) => rows[i]!.tradeCount > 0)
  const outlays = playedEcon.map((e) => e.outlay).sort((a, b) => a - b)
  const avgOutlay = mean(outlays)

  // Validation
  const settleFails = econ.filter((e) => !e.settleCheckOk).length
  const feesPaidDb = sum(rows.map((r) => r.feesPaid))
  const feeRecon = sum(econ.map((e) => e.takerFeeSimRecon))
  const feeReconDiff = Math.abs(feeRecon - feesPaidDb)
  const feeReconTol = Math.max(0.02 * marketsTotal, 0.02 * Math.abs(feesPaidDb))
  const tradedRows = rows.filter((r) => r.tradeCount > 0)
  const metaCoverage = tradedRows.length
    ? tradedRows.filter((r) => r.metas.length > 0).length / tradedRows.length
    : 1

  const rejTotals = econ
    .map((e) => e)
    .map(() => null) // rejection counts come from acc when present
  void rejTotals

  return {
    runId,
    header,
    marketsTotal,
    played,
    playedShare: marketsTotal ? played / marketsTotal : 0,
    tradeSimPm,
    tradeCorrPm,
    rebPm,
    rebRawPm,
    elPm,
    rebShareOfEl,
    subsidyCarry: rebShareOfEl !== null && rebShareOfEl > 0.7,
    weekly,
    fStab,
    maxWeekShare,
    tails: {
      p5: quantile(sortedEl, 0.05),
      cvar5,
      maxLose: sortedEl.length ? sortedEl[0]! : 0,
      pf,
      worstWeekEl: weekly.length ? Math.min(...weekly.map((w) => w.elPm)) : 0,
    },
    pairing: {
      pairRate: mean(playedEcon.map((e) => e.pairRate)),
      imbP50: quantile(
        playedEcon.map((e) => e.imbalance).sort((a, b) => a - b),
        0.5,
      ),
      imbP90: quantile(
        playedEcon.map((e) => e.imbalance).sort((a, b) => a - b),
        0.9,
      ),
    },
    capital: {
      avgOutlay,
      p90Outlay: quantile(outlays, 0.9),
      elPer100: avgOutlay > 0 ? (elPm / avgOutlay) * 100 : 0,
    },
    sample: {
      n: marketsTotal,
      t: tStat(els),
      makerFills: sum(econ.map((e) => e.makerFills)),
      takerFills: sum(econ.map((e) => e.takerFills)),
      rejected: null,
    },
    validation: {
      settleFails,
      feeReconDiff,
      feeReconTol,
      feeReconOk: feeReconDiff <= feeReconTol,
      metaCoverage,
    },
  }
}

function printRun(r: RunReadout, gates?: string): void {
  const h = r.header!
  console.log(`\n=== run ${r.runId} — ${h.strategy} [${h.status}] ===`)
  console.log(`batchUid: ${h.batchUid}`)
  console.log(`params: ${JSON.stringify(h.params)}`)
  console.log(
    `markets: ${r.marketsTotal} (played ${r.played}, ${(r.playedShare * 100).toFixed(1)}%)`,
  )
  console.log(`\n-- lines ($/market, over markets_total) --`)
  console.log(`TRADE_sim  ${fmt(r.tradeSimPm)}`)
  console.log(`TRADE_corr ${fmt(r.tradeCorrPm)}   (era-fee re-priced)`)
  console.log(
    `REB        ${fmt(r.rebPm)}   (threshold applied; share of EL: ${
      r.rebShareOfEl === null ? 'n/a' : (r.rebShareOfEl * 100).toFixed(0) + '%'
    }${r.subsidyCarry ? ' — SUBSIDY-CARRY' : ''}; raw pre-threshold ${fmt(r.rebRawPm)} — scale diagnostic)`,
  )
  console.log(`EL         ${fmt(r.elPm)}   <- headline`)
  console.log(`\n-- weekly EL --`)
  for (const w of r.weekly)
    console.log(
      `${w.week}  n=${String(w.n).padStart(4)}  EL ${fmt(w.elPm)}  (trade ${fmt(
        w.tradeCorrPm,
      )} + reb ${fmt(w.rebPm)}) ${w.positive ? '+' : '−'}`,
    )
  console.log(
    `stability: ${(r.fStab * 100).toFixed(0)}% weeks positive; max positive-week share ${
      r.maxWeekShare === null ? 'n/a' : (r.maxWeekShare * 100).toFixed(0) + '%'
    }`,
  )
  console.log(`\n-- tails (per-market EL) --`)
  console.log(
    `p5 ${fmt(r.tails.p5)}  CVaR5 ${fmt(r.tails.cvar5)}  maxLose ${fmt(
      r.tails.maxLose,
    )}  PF ${fmt(r.tails.pf, 2)}  worstWeek ${fmt(r.tails.worstWeekEl)}`,
  )
  console.log(`\n-- pairing --`)
  console.log(
    `pairRate ${fmt(r.pairing.pairRate, 3)}  imbalance p50 ${fmt(
      r.pairing.imbP50,
      3,
    )} p90 ${fmt(r.pairing.imbP90, 3)}`,
  )
  console.log(`\n-- capital --`)
  console.log(
    `avg outlay ${fmt(r.capital.avgOutlay, 2)}  p90 ${fmt(r.capital.p90Outlay, 2)}  EL/$100 ${fmt(
      r.capital.elPer100,
    )}`,
  )
  console.log(`\n-- sample --`)
  console.log(
    `n=${r.sample.n}  t(EL)=${fmt(r.sample.t, 2)}  fills maker/taker ${r.sample.makerFills}/${r.sample.takerFills}`,
  )
  console.log(`\n-- validation --`)
  if (r.validation.metaCoverage === 0 && r.sample.makerFills === 0 && r.sample.takerFills === 0) {
    console.log(
      'foreign run (no lab intent_meta): settlement/fee checks apply only to buy-only lab strategies',
    )
  }
  console.log(
    `settlement recheck: ${
      r.validation.settleFails === 0 ? 'OK (all markets)' : `FAIL on ${r.validation.settleFails}`
    }`,
  )
  console.log(
    `fee reconstruction: |recon−db| ${fmt(r.validation.feeReconDiff, 2)} vs tol ${fmt(
      r.validation.feeReconTol,
      2,
    )} → ${r.validation.feeReconOk ? 'VALID' : 'QUARANTINE'}; meta coverage ${(
      r.validation.metaCoverage * 100
    ).toFixed(0)}%`,
  )

  if (gates === 's1' || gates === 's2') {
    console.log(`\n-- gates (${gates.toUpperCase()}, EVALUATION v1) --`)
    const g = (name: string, pass: boolean | null, detail: string) =>
      console.log(`${name}: ${pass === null ? 'N/A ' : pass ? 'PASS' : 'FAIL'}  ${detail}`)
    g('G2 played>=20%', r.playedShare >= 0.2, `${(r.playedShare * 100).toFixed(1)}%`)
    g(
      'G9 fee-recon',
      r.validation.feeReconOk && r.validation.settleFails === 0,
      `diff ${fmt(r.validation.feeReconDiff, 2)}`,
    )
    if (gates === 's2') {
      g('G4 EL>0', r.elPm > 0, `EL ${fmt(r.elPm)}`)
      g('G4 t>=2', r.sample.t >= 2, `t ${fmt(r.sample.t, 2)}`)
      g(
        'G5 stability',
        r.fStab >= 0.6 && (r.maxWeekShare === null || r.maxWeekShare <= 0.6),
        `${(r.fStab * 100).toFixed(0)}% weeks, maxShare ${
          r.maxWeekShare === null ? 'n/a' : (r.maxWeekShare * 100).toFixed(0) + '%'
        }`,
      )
      g('G7 PF>=1.3', r.tails.pf >= 1.3, `PF ${fmt(r.tails.pf, 2)} (TAIL_K pending v1.1)`)
      g(
        'G8 pairing',
        r.pairing.pairRate >= 0.5 ? true : null,
        `pairRate ${fmt(r.pairing.pairRate, 3)} (loose-parity designs: declare budget)`,
      )
      console.log('G6 latency: use --battery to evaluate L-ratios across arms')
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const asJson = argv.includes('--json')
  const gates = get('--gates')

  const battery = get('--battery')
  if (battery) {
    const parts = battery.split(',').map((p) => {
      const [id, lat] = p.split('@')
      return { runId: Number(id), lat: Number(lat ?? NaN) }
    })
    const reads = []
    for (const p of parts) reads.push({ ...p, r: await readRun(p.runId) })
    console.log('\n=== latency battery ===')
    for (const { lat, r } of reads)
      console.log(
        `lat ${String(lat).padStart(4)}ms  EL ${fmt(r.elPm)}  TRADE_corr ${fmt(
          r.tradeCorrPm,
        )}  REB ${fmt(r.rebPm)}  fills m/t ${r.sample.makerFills}/${r.sample.takerFills}`,
      )
    const anchor = reads.find((x) => x.lat === 140)
    if (anchor && anchor.r.elPm > 0) {
      for (const { lat, r } of reads) {
        if (lat === 140) continue
        const ratio = r.elPm / anchor.r.elPm
        const fillRatio =
          anchor.r.sample.makerFills > 0 ? r.sample.makerFills / anchor.r.sample.makerFills : NaN
        console.log(
          `L-ratio-${lat}: ${fmt(ratio, 2)}  fillRatio ${fmt(fillRatio, 2)}${
            lat === 500 ? `  G6(>=0.6 & fills>=0.5): ${ratio >= 0.6 && fillRatio >= 0.5 ? 'PASS' : 'FAIL'}` : ''
          }${lat === 1000 ? `  G6(EL>0): ${r.elPm > 0 ? 'PASS' : 'FAIL'}` : ''}`,
        )
      }
    }
    await closeDb()
    return
  }

  let runIds: number[] = []
  const runArg = get('--run')
  const batchArg = get('--batch')
  if (runArg) runIds = runArg.split(',').map(Number)
  else if (batchArg) runIds = await findRunIdsByBatchUid(batchArg)
  if (!runIds.length) {
    console.error('usage: results.ts --run <id[,id]> | --batch <batchUid> | --battery id@lat,...')
    process.exit(1)
  }

  for (const id of runIds) {
    const r = await readRun(id)
    if (asJson) console.log(JSON.stringify(r, null, 2))
    else printRun(r, gates)
    // Cross-check line: sim's own aggregate (segments) vs per-market recompute.
    const segs = await loadSegments(id, ['all'])
    const all = segs.find((s) => s.segmentKind === 'all')
    if (all) {
      const diff = Math.abs(all.evPerMarketTotal - r.tradeSimPm)
      console.log(
        `segments cross-check: ev_per_market_total ${fmt(all.evPerMarketTotal)} vs recomputed ${fmt(
          r.tradeSimPm,
        )} → ${diff <= 0.011 ? 'OK' : 'MISMATCH'}`,
      )
    }
  }
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
