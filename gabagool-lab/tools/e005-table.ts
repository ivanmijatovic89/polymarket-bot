/**
 * e005-table.ts — cross-run matrix + frozen-rule evaluation for the
 * E005 SHAPE sub-axis, plus the pre-registered cap-grid bind table
 * (LEDGER §E005). Shapes are CATEGORICAL (codes ra/rb/rc/rd) with the
 * reference arm reused from E003 under the ax1 prefix — explicit arm
 * wiring, exactly like e004-table.ts:
 *
 *   npx tsx gabagool-lab/tools/e005-table.ts \
 *     --arm ra=682,683 --arm rb=<h1>,<h2> --arm rc=<h1>,<h2> \
 *     --arm rd=<h1>,<h2>
 *
 * Cap sub-axis mode (ax4; labels all in {c960,c970,c980,c990} — every
 * arm is the winning shape rc with pairCostCap per label; c990 is the
 * reused rc pair 698/699 at the 0.99 file default):
 *
 *   npx tsx gabagool-lab/tools/e005-table.ts \
 *     --arm c960=<h1>,<h2> --arm c970=<h1>,<h2> \
 *     --arm c980=<h1>,<h2> --arm c990=698,699
 *
 * Cap mode adds the §E005 criteria-(5) pairRate/EL trade-off block
 * and flags cells with played < 20% (participation caveat). Shape
 * and cap labels cannot be mixed.
 *
 * E006 quote-stability mode (ax5; labels all in {q02,q05,q10,q20,
 * q45} — every arm is the rc+c960 chassis with requoteDelta per
 * label; q02 is the reused chassis pair 708/703 at the 0.02 file
 * default):
 *
 *   npx tsx gabagool-lab/tools/e005-table.ts \
 *     --arm q02=708,703 --arm q05=<h1>,<h2> --arm q10=<h1>,<h2> \
 *     --arm q20=<h1>,<h2> --arm q45=<h1>,<h2>
 *
 * Bind-table mode (§E005 cap-grid finalization rule; run on the shape
 * WINNER's pair only, after the sub-judgment is written):
 *
 *   npx tsx gabagool-lab/tools/e005-table.ts --bind <h1Run>,<h2Run>
 *
 * Guards (LS-3): every cell's params are cross-checked against its
 * label (rungOffsets exact array match; parityTolPct === 2;
 * completionMode none-or-absent) — mismatch aborts. All E005 shape
 * arms are maker-only: any 'x' meta in any wired run aborts (a cross
 * in a completion=none run means wrong-run wiring or a code leak).
 * Non-completed runs abort. Duplicate cells abort.
 *
 * Renders per cell (E005 frozen criteria (2) + LS-6 notes): EL±se, t
 * over ALL persisted markets; played share (asymmetric band
 * suppression makes participation a first-class shape readout);
 * taker%, pairRate, imb p50/p90, outlay over PLAYED; fills m/t;
 * CVaR5; S = mean per-market avgUp+avgDown over both-sided played
 * markets (fees excluded).
 *
 * Then, when all 4 shape arms are present in both halves:
 *   - adjacency on the pure-depth chain ra < rb < rc (deep rung
 *     0.03 < 0.06 < 0.13) at |ΔEL| > 2·se_diff, plus endpoints
 *     (ra vs rc); rd is NOT in the depth chain — it is the A17
 *     archetype PACKAGE (size × depth) and is compared against ra
 *     separately (LS-6 amendment: state which comparison is read).
 *   - advance rule (§E005 criteria (4), "as E003"): (a) depth
 *     direction sign(EL(rc) − EL(ra)) agrees across halves (endpoint
 *     direction, E003's standard when in-between resolution is
 *     insufficient; per-adjacent signs reported); (b) top-2 by EL of
 *     the 4 shape arms is the same SET in both halves.
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

const EXPECT_OFFSETS: Record<string, number[]> = {
  ra: [0.01, 0.03],
  rb: [0.02, 0.06],
  rc: [0.02, 0.13],
  rd: [0.01, 0.02, 0.05, 0.13],
}
// Cap sub-axis (ax4): every arm is the WINNING shape rc with an
// explicit pairCostCap; c990 is the reused rc pair (cap = file
// default 0.99, param absent).
const EXPECT_CAPS: Record<string, number> = {
  c960: 0.96,
  c970: 0.97,
  c980: 0.98,
  c990: 0.99,
}
// E006 quote-stability (ax5): every arm is the rc+c960 chassis with
// an explicit requoteDelta; q02 is the reused chassis pair 708/703
// (delta = file default 0.02, param absent).
const EXPECT_DELTAS: Record<string, number> = {
  q02: 0.02,
  q05: 0.05,
  q10: 0.1,
  q20: 0.2,
  q45: 0.45,
}
const DEPTH_CHAIN = ['ra', 'rb', 'rc'] as const
const SHAPE_ARMS = ['ra', 'rb', 'rc', 'rd'] as const
const CAP_CHAIN = ['c960', 'c970', 'c980', 'c990'] as const
const DELTA_CHAIN = ['q02', 'q05', 'q10', 'q20', 'q45'] as const

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
  imbP90: number
  avgOutlay: number
  makers: number
  takers: number
  cvar5: number
  sMean: number
  sN: number
  settleFails: number
}

const cells: Cell[] = []

/** Per-market S values (avgUp+avgDown, both-sided played mkts) for --bind. */
async function collectS(runId: number): Promise<number[]> {
  const rows = await loadMarketRows(runId)
  const out: number[] = []
  for (const r of rows) {
    let fills = 0
    let cU = 0
    let qU = 0
    let cD = 0
    let qD = 0
    for (const meta of r.metas) {
      const px = Number(meta.px)
      const sz = Number(meta.sz)
      if (!(px > 0) || !(sz > 0)) continue
      fills += 1
      if (meta.leg === 'U') {
        cU += px * sz
        qU += sz
      } else if (meta.leg === 'D') {
        cD += px * sz
        qD += sz
      }
    }
    if (fills > 0 && qU > 0 && qD > 0) out.push(cU / qU + cD / qD)
  }
  return out
}

function offsetsEqual(a: unknown, b: number[]): boolean {
  return (
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((v, i) => Math.abs(Number(v) - b[i]!) < 1e-9)
  )
}

async function guardParams(label: string, runId: number): Promise<void> {
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
  const mode = String(p.completionMode ?? 'none')
  const tol = Number(p.parityTolPct ?? NaN)
  const cap = Number(p.pairCostCap ?? 0.99) // file default when absent
  const delta = Number(p.requoteDelta ?? 0.02) // file default when absent
  const isCapArm = label in EXPECT_CAPS
  const isDeltaArm = label in EXPECT_DELTAS
  const expOffsets = isCapArm || isDeltaArm ? EXPECT_OFFSETS.rc! : EXPECT_OFFSETS[label]
  if (expOffsets && !offsetsEqual(p.rungOffsets, expOffsets)) {
    console.error(
      `arm ${label} run ${runId}: rungOffsets ${JSON.stringify(p.rungOffsets)} != expected ${JSON.stringify(expOffsets)} — wrong run wired?`,
    )
    process.exit(1)
  }
  const expCap = isCapArm ? EXPECT_CAPS[label]! : isDeltaArm ? 0.96 : 0.99 // delta arms run on the c960 chassis
  if (Math.abs(cap - expCap) > 1e-9) {
    console.error(
      `arm ${label} run ${runId}: pairCostCap=${cap} != expected ${expCap} — wrong run wired?`,
    )
    process.exit(1)
  }
  const expDelta = isDeltaArm ? EXPECT_DELTAS[label]! : 0.02 // shape/cap arms ran at default
  if (Math.abs(delta - expDelta) > 1e-9) {
    console.error(
      `arm ${label} run ${runId}: requoteDelta=${delta} != expected ${expDelta} — wrong run wired?`,
    )
    process.exit(1)
  }
  if (mode !== 'none') {
    console.error(`arm ${label} run ${runId}: completionMode=${mode} (E005 is maker-only) — wrong run wired?`)
    process.exit(1)
  }
  if (Math.abs(tol - 2) > 1e-9) {
    console.error(`arm ${label} run ${runId}: parityTolPct=${tol} != 2 — wrong run wired?`)
    process.exit(1)
  }
}

async function buildCell(label: string, half: 'h1' | 'h2', runId: number): Promise<void> {
  await guardParams(label, runId)
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
  const sVals: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const e = econ[i]!
    if (e.makerFills + e.takerFills === 0) continue
    let cU = 0
    let qU = 0
    let cD = 0
    let qD = 0
    for (const meta of r.metas) {
      const px = Number(meta.px)
      const sz = Number(meta.sz)
      if (!(px > 0) || !(sz > 0)) continue
      if (meta.k === 'x') xN += 1
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
  if (xN > 0) {
    console.error(
      `arm ${label} run ${runId}: ${xN} 'x' metas found in a maker-only experiment — wrong run wired or code leak; aborting`,
    )
    process.exit(1)
  }

  // CVaR5 convention identical to results.ts (mean of worst floor(5%·n)).
  const sortedEl = [...els].sort((a, b) => a - b)
  const w5 = Math.max(1, Math.floor(els.length * 0.05))
  const tail = sortedEl.slice(0, w5)

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
    imbP90: quantile(
      played.map((e) => e.imbalance).sort((a, b) => a - b),
      0.9,
    ),
    avgOutlay: mean(played.map((e) => e.outlay)),
    makers,
    takers,
    cvar5: tail.length ? mean(tail) : NaN,
    sMean: sVals.length ? mean(sVals) : NaN,
    sN: sVals.length,
    settleFails: econ.filter((e) => !e.settleCheckOk).length,
  })
}

function cellOf(label: string, half: 'h1' | 'h2'): Cell | undefined {
  return cells.find((c) => c.label === label && c.half === half)
}

function fmtDelta(a: Cell, b: Cell): string {
  const d = Math.abs(a.el - b.el)
  const lim = 2 * Math.sqrt(a.se ** 2 + b.se ** 2)
  return `|ΔEL| ${d.toFixed(4)} vs 2·se_diff ${lim.toFixed(4)} → ${d > lim ? 'DISTINCT' : 'indistinguishable'}`
}

// ---------------------------------------------------------------- bind mode

const bindIdx = argv.indexOf('--bind')
if (bindIdx >= 0) {
  const m = /^(\d+),(\d+)$/.exec(argv[bindIdx + 1] ?? '')
  if (!m) {
    console.error('usage: e005-table.ts --bind <h1RunId>,<h2RunId>')
    process.exit(1)
  }
  const ids = [Number(m[1]), Number(m[2])]
  for (const id of ids) {
    const h = await loadRunHeader(id)
    if (!h || h.status !== 'completed') {
      console.error(`run ${id} missing or not completed`)
      process.exit(1)
    }
  }
  const s = (await collectS(ids[0]!)).concat(await collectS(ids[1]!))
  s.sort((a, b) => a - b)
  const q = (p: number) => quantile(s, p)
  const bind = (c: number) => s.filter((v) => v > c).length / Math.max(1, s.length)
  const b96 = bind(0.96)
  const b97 = bind(0.97)
  const b98 = bind(0.98)
  console.log(`=== E005 cap-grid bind table (runs ${ids[0]}+${ids[1]}, pooled) ===`)
  console.log(`n both-sided played markets: ${s.length}`)
  console.log(
    `S quantiles: p10 ${q(0.1).toFixed(4)}  p25 ${q(0.25).toFixed(4)}  p50 ${q(0.5).toFixed(4)}  p75 ${q(0.75).toFixed(4)}  p90 ${q(0.9).toFixed(4)}`,
  )
  console.log(
    `bind(c) = share of markets with S > c:  bind(0.96) ${b96.toFixed(4)}  bind(0.97) ${b97.toFixed(4)}  bind(0.98) ${b98.toFixed(4)}`,
  )
  const keep = b96 - b98 >= 0.15 && b98 >= 0.05
  console.log(
    `rule: KEEP {0.96,0.97,0.98} iff bind(0.96)−bind(0.98) ≥ 0.15 (got ${(b96 - b98).toFixed(4)}) AND bind(0.98) ≥ 0.05 (got ${b98.toFixed(4)}) → ${keep ? 'KEEP prior grid' : 'REPLACE with quartile grid'}`,
  )
  if (!keep) {
    const r2 = (x: number) => Math.round(x * 100) / 100
    let g = [r2(q(0.25)), r2(q(0.5)), r2(q(0.75))].map((x) => Math.min(x, 0.99))
    g.sort((a, b) => a - b)
    for (let i = 1; i < g.length; i++) if (g[i]! <= g[i - 1]!) g[i] = r2(g[i - 1]! + 0.01)
    g = g.map((x) => Math.min(0.99, Math.max(0.9, x)))
    for (let i = g.length - 2; i >= 0; i--) if (g[i]! >= g[i + 1]!) g[i] = r2(g[i + 1]! - 0.01)
    console.log(`replacement grid (quartiles, de-collided, clamped [0.90,0.99]): {${g.join(', ')}}`)
  }
  await closeDb()
  process.exit(0)
}

// ---------------------------------------------------------------- table mode

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
    'usage: e005-table.ts --arm ra=682,683 --arm rb=<h1>,<h2> --arm rc=<h1>,<h2> --arm rd=<h1>,<h2>\n   or: e005-table.ts --bind <h1RunId>,<h2RunId>',
  )
  process.exit(1)
}

const labels = arms.map((a) => a.label)
const shapeMode = labels.every((l) => (SHAPE_ARMS as readonly string[]).includes(l))
const capMode = !shapeMode && labels.every((l) => (CAP_CHAIN as readonly string[]).includes(l))
const deltaMode =
  !shapeMode && !capMode && labels.every((l) => (DELTA_CHAIN as readonly string[]).includes(l))
if (!shapeMode && !capMode && !deltaMode) {
  console.error(
    `arm labels must be all shapes {${SHAPE_ARMS.join(',')}}, all caps {${CAP_CHAIN.join(',')}}, or all deltas {${DELTA_CHAIN.join(',')}} — got: ${labels.join(',')}`,
  )
  process.exit(1)
}
const ALL_ARMS: readonly string[] = shapeMode ? SHAPE_ARMS : capMode ? CAP_CHAIN : DELTA_CHAIN

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

console.log(
  shapeMode
    ? '=== E005 shape table (depth chain ra < rb < rc; rd = A17 package vs ra) ==='
    : capMode
      ? '=== E005 cap table (chain c960 < c970 < c980 < c990-ref; all arms = shape rc) ==='
      : '=== E006 quote-stability table (chain q02-ref < q05 < q10 < q20 < q45; all arms = rc+c960 chassis) ===',
)
for (const half of ['h1', 'h2'] as const) {
  const hs = cells.filter((c) => c.half === half)
  if (!hs.length) continue
  console.log(`\n-- ${half} --`)
  console.log(
    'arm  run    n     played%  EL        se      t       taker%  pairRate  imbP50  imbP90  outlay   CVaR5     S(pair)      fills m/t',
  )
  for (const label of ALL_ARMS) {
    const c = hs.find((x) => x.label === label)
    if (!c) continue
    console.log(
      `${c.label.padEnd(4)} ${String(c.runId).padEnd(6)} ${String(c.n).padEnd(5)} ${(
        (100 * c.played) /
        Math.max(1, c.n)
      )
        .toFixed(1)
        .padStart(6)}%  ${c.el.toFixed(4).padStart(8)} ${c.se.toFixed(4).padStart(7)} ${c.t
        .toFixed(1)
        .padStart(7)} ${(100 * c.takerShare).toFixed(1).padStart(6)} ${c.pairRate
        .toFixed(3)
        .padStart(9)} ${c.imbP50.toFixed(3).padStart(7)} ${c.imbP90.toFixed(3).padStart(7)} ${c.avgOutlay
        .toFixed(2)
        .padStart(7)} ${c.cvar5.toFixed(4).padStart(9)} ${
        Number.isFinite(c.sMean) ? c.sMean.toFixed(4) + '(' + c.sN + ')' : 'n/a'
      }  ${c.makers}/${c.takers}`,
    )
    if (c.settleFails > 0) console.log(`     ^ WARNING: ${c.settleFails} settlement-check failures`)
    if (c.played / Math.max(1, c.n) < 0.2)
      console.log(
        `     ^ PARTICIPATION CAVEAT (§E005): played < 20% (G2 level) — cap chokes participation at this shape/sizing; EL unmeasurable-at-coverage`,
      )
  }
}

const complete = (['h1', 'h2'] as const).every((h) => ALL_ARMS.every((l) => cellOf(l, h)))
const CHAIN: readonly string[] = shapeMode ? DEPTH_CHAIN : capMode ? CAP_CHAIN : DELTA_CHAIN
const endLo = CHAIN[0]!
const endHi = CHAIN[CHAIN.length - 1]!

if (complete && shapeMode) {
  console.log('\n-- adjacency: pure-depth chain (2-rung arms) --')
  for (const half of ['h1', 'h2'] as const) {
    for (let i = 1; i < CHAIN.length; i++) {
      const a = cellOf(CHAIN[i - 1]!, half)!
      const b = cellOf(CHAIN[i]!, half)!
      console.log(`${half} ${a.label} vs ${b.label}: ${fmtDelta(a, b)}`)
    }
    console.log(`${half} endpoints ${endLo} vs ${endHi}: ${fmtDelta(cellOf(endLo, half)!, cellOf(endHi, half)!)}`)
  }
  console.log('\n-- package comparison (rd = A17 4-rung, size × depth — NOT pure depth) --')
  for (const half of ['h1', 'h2'] as const) {
    const ra = cellOf('ra', half)!
    const rd = cellOf('rd', half)!
    console.log(`${half} ra vs rd: ${fmtDelta(ra, rd)}`)
  }
} else if (complete && (capMode || deltaMode)) {
  console.log(
    capMode
      ? '\n-- pairRate/EL trade-off curve (§E005 criteria 5) --'
      : '\n-- EL-vs-participation trade-off curve (§E006 criteria 5) --',
  )
  for (const half of ['h1', 'h2'] as const) {
    for (const label of CHAIN) {
      const c = cellOf(label, half)!
      const knob = capMode ? `cap ${EXPECT_CAPS[label]!.toFixed(2)}` : `delta ${EXPECT_DELTAS[label]!.toFixed(2)}`
      console.log(
        `${half} ${knob}: EL ${c.el.toFixed(4)}  pairRate ${c.pairRate.toFixed(3)}  played ${((100 * c.played) / Math.max(1, c.n)).toFixed(1)}%  taker ${(100 * c.takerShare).toFixed(1)}%  fills m/t ${c.makers}/${c.takers} (${((c.makers + c.takers) / Math.max(1, c.played)).toFixed(1)}/mkt)  S ${Number.isFinite(c.sMean) ? c.sMean.toFixed(4) : 'n/a'}`,
      )
    }
  }
  console.log(`\n-- adjacency: ${capMode ? 'cap' : 'delta'} chain --`)
  for (const half of ['h1', 'h2'] as const) {
    for (let i = 1; i < CHAIN.length; i++) {
      const a = cellOf(CHAIN[i - 1]!, half)!
      const b = cellOf(CHAIN[i]!, half)!
      console.log(`${half} ${a.label} vs ${b.label}: ${fmtDelta(a, b)}`)
    }
    console.log(`${half} endpoints ${endLo} vs ${endHi}: ${fmtDelta(cellOf(endLo, half)!, cellOf(endHi, half)!)}`)
  }
}

if (complete) {
  console.log('\n-- advance rule (§E005 criteria (4), as E003) --')
  const dirs: Record<string, number> = {}
  for (const half of ['h1', 'h2'] as const) {
    const signs: string[] = []
    for (let i = 1; i < CHAIN.length; i++) {
      const a = cellOf(CHAIN[i - 1]!, half)!
      const b = cellOf(CHAIN[i]!, half)!
      const s = Math.sign(b.el - a.el)
      signs.push(`${a.label}→${b.label} ${s > 0 ? '+' : s < 0 ? '−' : '0'}`)
    }
    const end = Math.sign(cellOf(endHi, half)!.el - cellOf(endLo, half)!.el)
    dirs[half] = end
    console.log(
      `${half} adjacent signs: ${signs.join(', ')}; endpoint direction sign(EL(${endHi})−EL(${endLo})) = ${end > 0 ? '+' : end < 0 ? '−' : '0'}`,
    )
  }
  const dirHolds = dirs.h1 === dirs.h2 && dirs.h1 !== 0
  const top2 = (half: 'h1' | 'h2') =>
    ALL_ARMS.map((l) => cellOf(l, half)!)
      .sort((a, b) => b.el - a.el)
      .slice(0, 2)
      .map((c) => c.label)
      .sort()
      .join(',')
  const t1 = top2('h1')
  const t2 = top2('h2')
  console.log(`(a) endpoint direction agrees across halves: ${dirHolds ? 'HOLDS' : 'FAILS'}`)
  console.log(`(b) top-2 by EL: h1 {${t1}}  h2 {${t2}} → set match: ${t1 === t2 ? 'HOLDS' : 'FAILS'}`)
  const modeName = shapeMode ? 'shape' : capMode ? 'cap' : 'delta'
  console.log(
    `advance rule: ${
      dirHolds && t1 === t2
        ? shapeMode
          ? 'BOTH HOLD → winning shape advances to the cap sub-axis'
          : `BOTH HOLD → ${modeName} ordering stable across halves`
        : `FAILS → ${modeName} sub-axis unstable at this coverage; record and judge accordingly`
    }`,
  )
} else {
  const modeName = shapeMode ? 'shape' : capMode ? 'cap' : 'delta'
  console.log(
    `\n(rule evaluation skipped — need all ${ALL_ARMS.length} ${modeName} arms in both halves)`,
  )
}

await closeDb()
