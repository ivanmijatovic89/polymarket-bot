/**
 * axis-table.ts — cross-run matrix + advance-rule evaluation for axis
 * experiments swept over halves (suffix grammar `axNh<half>-<code>`).
 *
 * Renders, per (axis value × half): EL±se, t, taker share of fills,
 * pairRate, imbalance p50, avg outlay. Then evaluates the frozen
 * E003-style advance rule mechanically:
 *   (a) trend direction of EL vs axis value agrees across halves
 *       (sign of OLS slope of EL on the RANK of the axis value — a
 *       monotone-trend sign, robust to the axis's log-ish spacing);
 *   (b) top-2 arms by EL are the same SET in both halves.
 * Adjacent arms are DISTINCT when |ΔEL| > 2·sqrt(se_i² + se_j²).
 *
 * Definitions match results.ts: EL stats over ALL persisted markets
 * (headline basis); pairing/imbalance/outlay over PLAYED markets.
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/axis-table.ts \
 *     --prefix glab--E003-pair-accumulator--ax1 --axis-param parityTolPct
 */
import {
  findRunsByBatchUidPrefix,
  loadMarketRows,
  computeMarketEcon,
  mean,
  quantile,
  closeDb,
} from './lib.ts'

const argv = process.argv.slice(2)
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const prefix = get('--prefix')
const axisParam = get('--axis-param')
if (!prefix || !axisParam) {
  console.error('usage: axis-table.ts --prefix <batchUid-prefix> --axis-param <name>')
  process.exit(1)
}

type Cell = {
  runId: number
  axisValue: number
  half: string
  n: number
  played: number
  el: number
  se: number
  t: number
  takerShare: number
  pairRate: number
  imbP50: number
  avgOutlay: number
}

const headers = await findRunsByBatchUidPrefix(prefix)
const usable = headers.filter((h) => h.status === 'completed')
const skipped = headers.filter((h) => h.status !== 'completed')
for (const s of skipped)
  console.log(`skipping run ${s.id} [${s.status}] ${s.batchUid} (not completed)`)

const cells: Cell[] = []
for (const h of usable) {
  const m = /ax\dh(\d)/.exec(h.batchUid ?? '')
  const half = m ? `h${m[1]}` : '?'
  const params = (h.params ?? {}) as Record<string, unknown>
  const axisValue = Number(params[axisParam])
  const rows = await loadMarketRows(h.id)
  const econ = rows.map(computeMarketEcon)
  const played = econ.filter((e) => e.makerFills + e.takerFills > 0)
  const els = econ.map((e) => e.el)
  const n = els.length
  const mu = mean(els)
  const sd = Math.sqrt(mean(els.map((x) => (x - mu) ** 2)) * (n / Math.max(1, n - 1)))
  const se = sd / Math.sqrt(Math.max(1, n))
  const makers = played.reduce((a, e) => a + e.makerFills, 0)
  const takers = played.reduce((a, e) => a + e.takerFills, 0)
  cells.push({
    runId: h.id,
    axisValue,
    half,
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
  })
}

const halves = [...new Set(cells.map((c) => c.half))].sort()
const values = [...new Set(cells.map((c) => c.axisValue))].sort((a, b) => a - b)

// one run per (half, axisValue) is assumed; duplicates would silently
// shadow each other in the table lookups below — refuse instead.
const seen = new Map<string, number>()
for (const c of cells) {
  const k = `${c.half}|${c.axisValue}`
  if (seen.has(k)) {
    console.error(
      `DUPLICATE cell ${k}: runs ${seen.get(k)} and ${c.runId} — pass a tighter --prefix`,
    )
    process.exit(1)
  }
  seen.set(k, c.runId)
}

const fmt = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')

console.log(`\n=== axis table: ${prefix} (${axisParam}) ===`)
for (const half of halves) {
  console.log(`\n-- ${half} --`)
  console.log(
    `${axisParam.padEnd(14)} run    n     EL        se      t       taker%  pairRate  imbP50  outlay`,
  )
  for (const v of values) {
    const c = cells.find((x) => x.half === half && x.axisValue === v)
    if (!c) {
      console.log(`${String(v).padEnd(14)} MISSING`)
      continue
    }
    console.log(
      `${String(v).padEnd(14)} ${String(c.runId).padEnd(6)} ${String(c.n).padEnd(5)} ${fmt(
        c.el,
      )}  ${fmt(c.se)}  ${fmt(c.t, 1).padStart(6)}  ${(c.takerShare * 100).toFixed(1).padStart(6)}  ${fmt(
        c.pairRate,
        3,
      ).padStart(8)}  ${fmt(c.imbP50, 3).padStart(6)}  ${fmt(c.avgOutlay, 2).padStart(7)}`,
    )
  }
  // adjacent distinguishability
  for (let i = 0; i + 1 < values.length; i++) {
    const a = cells.find((x) => x.half === half && x.axisValue === values[i])
    const b = cells.find((x) => x.half === half && x.axisValue === values[i + 1])
    if (!a || !b) continue
    const seDiff = Math.sqrt(a.se ** 2 + b.se ** 2)
    const d = Math.abs(a.el - b.el)
    console.log(
      `  ${values[i]} vs ${values[i + 1]}: |ΔEL| ${fmt(d)} vs 2·se_diff ${fmt(2 * seDiff)} → ${
        d > 2 * seDiff ? 'DISTINCT' : 'indistinguishable'
      }`,
    )
  }
}

// advance rule
console.log('\n-- advance rule --')
const trendSign = (half: string): number => {
  const pts = values
    .map((v, i) => ({ i, c: cells.find((x) => x.half === half && x.axisValue === v) }))
    .filter((p) => p.c)
  const xs = pts.map((p) => p.i)
  const ys = pts.map((p) => p.c!.el)
  const mx = mean(xs)
  const my = mean(ys)
  const slope =
    xs.reduce((a, x, k) => a + (x - mx) * (ys[k]! - my), 0) /
    Math.max(
      1e-12,
      xs.reduce((a, x) => a + (x - mx) ** 2, 0),
    )
  return Math.sign(slope)
}
const top2 = (half: string): string =>
  cells
    .filter((c) => c.half === half)
    .sort((a, b) => b.el - a.el)
    .slice(0, 2)
    .map((c) => String(c.axisValue))
    .sort()
    .join(',')

for (const half of halves)
  console.log(
    `${half}: trend(EL vs rank ${axisParam}) sign = ${trendSign(half)}, top-2 by EL = {${top2(half)}}`,
  )
if (halves.length === 2) {
  const [a, b] = halves as [string, string]
  const dirAgree = trendSign(a) === trendSign(b)
  const setMatch = top2(a) === top2(b)
  console.log(`(a) direction agreement: ${dirAgree ? 'HOLDS' : 'FAILS'}`)
  console.log(`(b) top-2 set match:     ${setMatch ? 'HOLDS' : 'FAILS'}`)
  console.log(
    `advance rule: ${dirAgree && setMatch ? 'BOTH HOLD → agreeing region seeds next defaults' : 'FAILS → axis unstable at this coverage; no arm advances'}`,
  )
}

await closeDb()
