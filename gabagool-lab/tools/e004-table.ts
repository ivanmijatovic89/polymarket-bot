/**
 * e004-table.ts — cross-run matrix + frozen-rule evaluation for E004
 * (completion policy, CATEGORICAL arms — axis-table.ts is numeric-only
 * and can't fold the ax1 control pair in).
 *
 * Arms are wired EXPLICITLY (the control is E003's p020 pair under the
 * ax1 prefix — no prefix scan can assemble this set):
 *   npx tsx gabagool-lab/tools/e004-table.ts \
 *     --arm none=682,683 --arm c990=<h1>,<h2> \
 *     --arm c970=<h1>,<h2> --arm cfree=<h1>,<h2>
 * First run id = h1 (Apr), second = h2 (May); a single id renders h1
 * only (smoke/test mode). Labels outside {none,c970,c990,cfree} render
 * but never enter rule evaluation.
 *
 * Guards: every cell's params are cross-checked against its label
 * (none→mode none; c970→cap 0.97; c990→cap 0.99; cfree→free) — a
 * mismatch aborts (wrong-run-id wiring must die loudly, LS-3 spirit).
 *
 * Renders per cell (definitions match axis-table.ts/results.ts):
 *   EL±se, t over ALL persisted markets; taker%, pairRate, imb p50,
 *   outlay over PLAYED; plus completion economics from intent metas:
 *   xN (FILLED crosses — unfilled crosses persist no meta; issuance was
 *   verified by smoke 680), xSh, x px p10/50/90, xFee$ (era, per-meta),
 *   rungConv = realized taker fills − xN (latency conversions),
 *   takerFee$/mkt (acc-exact era), S = mean per-market avgUp+avgDown
 *   over both-sided played markets (metas spend/placed-share; fees
 *   excluded — reported beside), cross share of paired stock
 *   ΣxSh/Σ2·mergable.
 *
 * Then, when all 4 canonical arms are present in both halves:
 *   - policy spread per half: max−min EL across the 4 arms, absolute
 *     and as % of turnover (turnover = mean cost over ALL rows,
 *     averaged across the 4 arms of the half). H6 pre-registered read:
 *     spread < 0.3% of turnover in BOTH halves ⇒ H6 refuted at cell.
 *   - adjacent distinguishability in the FROZEN aggressiveness order
 *     none < c970 < c990 < cfree at |ΔEL| > 2·se_diff.
 *   - advance rule (LEDGER §E004, verbatim): (a) top-2 of 4 by EL is
 *     the same SET in both halves; (b) for each non-none member of
 *     that top-2, sign(EL(arm) − EL(none)) agrees across halves.
 */
import {
  loadRunHeader,
  loadMarketRows,
  computeMarketEcon,
  mean,
  quantile,
  closeDb,
} from './lib.ts'

const argv = process.argv.slice(2)

type ArmSpec = { label: string; h1: number; h2?: number }
const arms: ArmSpec[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--arm') continue
  const v = argv[i + 1]
  const m = /^([\w-]+)=(\d+)(?:,(\d+))?$/.exec(v ?? '')
  if (!m) {
    console.error(`bad --arm ${v} (want label=h1RunId[,h2RunId])`)
    process.exit(1)
  }
  arms.push({ label: m[1]!, h1: Number(m[2]), h2: m[3] ? Number(m[3]) : undefined })
}
if (!arms.length) {
  console.error(
    'usage: e004-table.ts --arm none=682,683 --arm c990=<h1>,<h2> --arm c970=<h1>,<h2> --arm cfree=<h1>,<h2>',
  )
  process.exit(1)
}

const CANON = ['none', 'c970', 'c990', 'cfree'] as const
const EXPECT: Record<string, { mode: string; cap?: number }> = {
  none: { mode: 'none' },
  c970: { mode: 'cap', cap: 0.97 },
  c990: { mode: 'cap', cap: 0.99 },
  cfree: { mode: 'free' },
}

type Cell = {
  label: string
  half: 'h1' | 'h2'
  runId: number
  n: number
  played: number
  el: number
  se: number
  t: number
  takerShare: number
  pairRate: number
  imbP50: number
  avgOutlay: number
  turnoverAll: number // mean cost over ALL rows (spread denominator)
  xN: number
  xSh: number
  xPx: number[] // sorted px of filled crosses
  xFee: number
  rungConv: number
  takerFeePerMkt: number // acc-exact era taker fee, mean over played
  sMean: number // mean avgUp+avgDown, both-sided played mkts
  sN: number
  crossPairShare: number // ΣxSh / Σ(2·mergable) over played
  settleFails: number
}

const cells: Cell[] = []

async function buildCell(label: string, half: 'h1' | 'h2', runId: number): Promise<void> {
  const h = await loadRunHeader(runId)
  if (!h) {
    console.error(`run ${runId} not found`)
    process.exit(1)
  }
  if (h.status !== 'completed') {
    console.error(`run ${runId} [${h.status}] is not completed — refusing (partial data)`)
    process.exit(1)
  }
  const p = (h.params ?? {}) as Record<string, unknown>
  const exp = EXPECT[label]
  if (exp) {
    const mode = String(p.completionMode ?? 'none')
    const cap = Number(p.completionCap ?? 0.99)
    if (mode !== exp.mode || (exp.cap !== undefined && Math.abs(cap - exp.cap) > 1e-9)) {
      console.error(
        `arm ${label} run ${runId}: params mismatch (completionMode=${mode} completionCap=${cap}) — wrong run wired?`,
      )
      process.exit(1)
    }
  }
  const rows = await loadMarketRows(runId)
  const econ = rows.map(computeMarketEcon)
  const played = econ.filter((e) => e.makerFills + e.takerFills > 0)
  const els = econ.map((e) => e.el)
  const n = els.length
  const mu = mean(els)
  const sd = Math.sqrt(mean(els.map((x) => (x - mu) ** 2)) * (n / Math.max(1, n - 1)))
  const se = sd / Math.sqrt(Math.max(1, n))
  const makers = played.reduce((a, e) => a + e.makerFills, 0)
  const takers = played.reduce((a, e) => a + e.takerFills, 0)

  let xN = 0
  let xSh = 0
  let xFee = 0
  const xPx: number[] = []
  let mergableTimes2 = 0
  const sVals: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const e = econ[i]!
    if (e.makerFills + e.takerFills === 0) continue
    mergableTimes2 += 2 * r.mergableShares
    let cU = 0
    let qU = 0
    let cD = 0
    let qD = 0
    for (const meta of r.metas) {
      const px = Number(meta.px)
      const sz = Number(meta.sz)
      if (!(px > 0) || !(sz > 0)) continue
      if (meta.k === 'x') {
        xN += 1
        xSh += sz
        xPx.push(px)
        xFee += 0.07 * px * (1 - px) * sz
      }
      if (meta.leg === 'U') {
        cU += px * sz
        qU += sz
      } else if (meta.leg === 'D') {
        cD += px * sz
        qD += sz
      }
    }
    if (qU > 0 && qD > 0) sVals.push(cU / qU + cD / qD)
  }
  xPx.sort((a, b) => a - b)

  cells.push({
    label,
    half,
    runId,
    n,
    played: played.length,
    el: mu,
    se,
    t: se > 0 ? mu / se : 0,
    takerShare: makers + takers > 0 ? takers / (makers + takers) : 0,
    pairRate: mean(played.map((e) => e.pairRate)),
    imbP50: quantile(
      played.map((e) => e.imbalance).sort((a, b) => a - b),
      0.5,
    ),
    avgOutlay: mean(played.map((e) => e.outlay)),
    turnoverAll: mean(econ.map((e) => e.outlay)),
    xN,
    xSh,
    xPx,
    xFee,
    rungConv: takers - xN,
    takerFeePerMkt: mean(played.map((e) => e.takerFeeEra)),
    sMean: sVals.length ? mean(sVals) : NaN,
    sN: sVals.length,
    crossPairShare: mergableTimes2 > 0 ? xSh / mergableTimes2 : 0,
    settleFails: econ.filter((e) => !e.settleCheckOk).length,
  })
}

for (const a of arms) {
  await buildCell(a.label, 'h1', a.h1)
  if (a.h2 !== undefined) await buildCell(a.label, 'h2', a.h2)
}

const seen = new Map<string, number>()
for (const c of cells) {
  const k = `${c.label}|${c.half}`
  if (seen.has(k)) {
    console.error(`DUPLICATE cell ${k}: runs ${seen.get(k)} and ${c.runId}`)
    process.exit(1)
  }
  seen.set(k, c.runId)
}

const fmt = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const order = (ls: string[]): string[] => {
  const canon = CANON.filter((l) => ls.includes(l))
  const extra = ls.filter((l) => !(CANON as readonly string[]).includes(l)).sort()
  return [...canon, ...extra]
}
const halves = [...new Set(cells.map((c) => c.half))].sort() as ('h1' | 'h2')[]
const labels = order([...new Set(cells.map((c) => c.label))])
const at = (l: string, h: string): Cell | undefined =>
  cells.find((c) => c.label === l && c.half === h)

console.log('\n=== E004 completion-policy table (order: none < c970 < c990 < cfree) ===')
for (const half of halves) {
  console.log(`\n-- ${half} --`)
  console.log(
    'arm    run    n     EL        se      t       taker%  pairRate  imbP50  outlay  | xN     xSh    xPx p10/50/90       xFee$   rungConv  tFee$/mkt  S(pair)      x/paired',
  )
  for (const l of labels) {
    const c = at(l, half)
    if (!c) {
      console.log(`${l.padEnd(6)} MISSING`)
      continue
    }
    const xq = (q: number): string => (c.xPx.length ? fmt(quantile(c.xPx, q), 2) : 'n/a')
    console.log(
      `${l.padEnd(6)} ${String(c.runId).padEnd(6)} ${String(c.n).padEnd(5)} ${fmt(c.el)}  ${fmt(
        c.se,
      )}  ${fmt(c.t, 1).padStart(6)}  ${(c.takerShare * 100).toFixed(1).padStart(6)}  ${fmt(
        c.pairRate,
        3,
      ).padStart(8)}  ${fmt(c.imbP50, 3).padStart(6)}  ${fmt(c.avgOutlay, 2).padStart(6)}  | ${String(
        c.xN,
      ).padEnd(6)} ${String(Math.round(c.xSh)).padEnd(6)} ${xq(0.1)}/${xq(0.5)}/${xq(0.9)}  ${fmt(
        c.xFee,
        0,
      ).padStart(7)}  ${String(c.rungConv).padStart(8)}  ${fmt(c.takerFeePerMkt, 3).padStart(9)}  ${fmt(
        c.sMean,
        4,
      )}(${c.sN})  ${fmt(c.crossPairShare, 3).padStart(6)}`,
    )
    if (c.settleFails > 0)
      console.log(`  WARNING: ${c.settleFails} settlement-recheck failures in run ${c.runId}`)
  }
}

const canonical = CANON.every((l) => halves.every((h) => at(l, h) !== undefined))
if (!canonical || halves.length < 2) {
  console.log(
    '\n(rule/spread evaluation skipped — needs all 4 canonical arms in both halves)',
  )
} else {
  console.log('\n-- policy spread (per half, across the 4 arms) --')
  const h6: boolean[] = []
  for (const half of halves) {
    const four = CANON.map((l) => at(l, half)!)
    const els = four.map((c) => c.el)
    const spread = Math.max(...els) - Math.min(...els)
    const turnover = mean(four.map((c) => c.turnoverAll))
    const pct = turnover > 0 ? (spread / turnover) * 100 : NaN
    h6.push(pct < 0.3)
    console.log(
      `${half}: max−min EL = ${fmt(spread)} $/mkt; turnover ${fmt(turnover, 2)} $/mkt → spread = ${fmt(
        pct,
        3,
      )}% of turnover ${pct < 0.3 ? '(< 0.3%)' : '(>= 0.3%)'}`,
    )
  }
  console.log(
    h6.every(Boolean)
      ? 'H6 read: spread < 0.3% of turnover in BOTH halves ⇒ H6 REFUTED at this cell (completion policy is not the margin knob; live gap was book-mix/timing)'
      : 'H6 read: spread >= 0.3% of turnover in at least one half ⇒ H6 SURVIVES at this cell',
  )

  console.log('\n-- adjacent distinguishability (frozen aggressiveness order) --')
  for (const half of halves) {
    for (let i = 0; i + 1 < CANON.length; i++) {
      const a = at(CANON[i]!, half)!
      const b = at(CANON[i + 1]!, half)!
      const seDiff = Math.sqrt(a.se ** 2 + b.se ** 2)
      const d = Math.abs(a.el - b.el)
      console.log(
        `${half} ${CANON[i]} vs ${CANON[i + 1]}: |ΔEL| ${fmt(d)} vs 2·se_diff ${fmt(2 * seDiff)} → ${
          d > 2 * seDiff ? 'DISTINCT' : 'indistinguishable'
        }`,
      )
    }
  }

  console.log('\n-- advance rule (LEDGER §E004, verbatim) --')
  const top2 = (half: string): string[] =>
    CANON.map((l) => at(l, half)!)
      .sort((a, b) => b.el - a.el)
      .slice(0, 2)
      .map((c) => c.label)
  const t1 = top2('h1')
  const t2 = top2('h2')
  const setMatch = JSON.stringify([...t1].sort()) === JSON.stringify([...t2].sort())
  console.log(`h1 top-2 by EL: {${t1.join(',')}}  h2 top-2: {${t2.join(',')}}`)
  console.log(`(a) top-2 set match: ${setMatch ? 'HOLDS' : 'FAILS'}`)
  let signAgree = true
  const nonNone = [...new Set([...t1, ...t2])].filter((l) => l !== 'none')
  for (const l of nonNone) {
    const s1 = Math.sign(at(l, 'h1')!.el - at('none', 'h1')!.el)
    const s2 = Math.sign(at(l, 'h2')!.el - at('none', 'h2')!.el)
    const agree = s1 === s2
    if ((t1.includes(l) || t2.includes(l)) && !agree) signAgree = false
    console.log(
      `(b) sign(EL(${l}) − EL(none)): h1 ${s1 > 0 ? '+' : s1 < 0 ? '−' : '0'} h2 ${
        s2 > 0 ? '+' : s2 < 0 ? '−' : '0'
      } → ${agree ? 'agrees' : 'DISAGREES'}`,
    )
  }
  const both = setMatch && signAgree
  console.log(
    `advance rule: ${both ? 'BOTH HOLD → winning policy becomes completion default for candidate-grade confirmation runs' : 'FAILS → axis unstable at this coverage; candidate confirmations run maker-only, stated'}`,
  )
}

await closeDb()
