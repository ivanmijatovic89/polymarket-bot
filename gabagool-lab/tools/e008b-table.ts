/**
 * e008b-table.ts — §E008b judgment table (LEDGER, frozen s27 u75).
 * Favorite-side structure × solo-cap arms on the gated g00 chassis,
 * judged vs the g00 incumbent (runs 728/725, frozen wiring).
 *
 * Frozen wiring (hardcoded, LS-3 style):
 *   g00 incumbent (§E008 ax6): 728 (h1), 725 (h2)
 *
 * New ax7 runs are wired explicitly as they land:
 *
 *   npx tsx gabagool-lab/tools/e008b-table.ts \
 *     --arm r1=<h1>,<h2> --arm r12s=<h1>,<h2> --arm r3m=<h1>,<h2> \
 *     --arm r3d=<h1>,<h2> --arm s75=<h1>,<h2> --arm s85=<h1>,<h2>
 *
 * Partial wiring is allowed (cells print as they land); each frozen
 * rule evaluates only when every cell it reads is present, otherwise
 * it prints "pending".
 *
 * Guards (LS-3): status completed; exact batchUid per cell
 * (`…--ax7<half>-<code>--lat140`); chassis params (pairCostCap 0.96,
 * requoteDelta 0.02, completionMode none, parityTolPct 2, fvGateMode
 * level, fvGateBps 0); per-arm rungOffsets + soloCap per the freeze;
 * no 'x' metas (maker-only axis); n must match the same-half g00
 * incumbent. Settlement identity (e004-decomp method) asserted per
 * run; Δrem here is the same decomposition §E008/§E008-battery used.
 *
 * Frozen evaluations (§E008b criteria):
 *   (3) advance rule per sub-axis (E005/E008 standard): endpoint
 *       direction agreement across halves over the sub-axis chain
 *       (structure: r12s→r1→g00→r3m→r3d by max rung depth; solo:
 *       g00→s75→s85 by cap) + top-2 set match; ADVANCE list = arms
 *       EL-DISTINCT better than g00 in BOTH halves.
 *   (5) P1 r12s Δrem ≤ −1.0 both halves; P2 s85 Δrem ≥ +1.0 both
 *       halves; P3 some arm of {r3m,r3d,s75,s85} EL-DISTINCT better
 *       in both halves.
 */
import { closeDb, computeMarketEcon, loadMarketRows, loadRunHeader, mean } from './lib.ts'

const PREFIX = 'glab--E003-pair-accumulator'

type Half = 'h1' | 'h2'

const EXPECT_OFFSETS: Record<string, number[]> = {
  g00: [0.02, 0.13],
  r1: [0.02],
  r12s: [0.01, 0.02],
  r3m: [0.02, 0.06, 0.13],
  r3d: [0.02, 0.13, 0.25],
  s75: [0.02, 0.13],
  s85: [0.02, 0.13],
}
const EXPECT_SOLO: Record<string, number> = {
  g00: 0.65,
  r1: 0.65,
  r12s: 0.65,
  r3m: 0.65,
  r3d: 0.65,
  s75: 0.75,
  s85: 0.85,
}
const STRUCT_CHAIN = ['r12s', 'r1', 'g00', 'r3m', 'r3d'] as const
const SOLO_CHAIN = ['g00', 's75', 's85'] as const

/** Frozen incumbent wiring + exact batchUids. */
const FROZEN: Record<string, [number, number]> = { g00: [728, 725] }
const FROZEN_UIDS: Record<number, string> = {
  728: `${PREFIX}--ax6h1-g00--lat140`,
  725: `${PREFIX}--ax6h2-g00--lat140`,
}

type Cell = {
  code: string
  half: Half
  runId: number
  n: number
  played: number
  el: number
  se: number
  t: number
  takerShare: number
  pairRate: number
  avgOutlay: number
  makers: number
  takers: number
  cvar5: number
  pair: number
  rem: number
  cost: number
  fee: number
  settleFails: number
}

const cells = new Map<string, Cell>() // `<code>@<half>`
const ck = (code: string, half: Half): string => `${code}@${half}`

async function buildCell(code: string, half: Half, runId: number): Promise<void> {
  const h = await loadRunHeader(runId)
  if (!h) {
    console.error(`run ${runId} not found`)
    process.exit(1)
  }
  if (h.status !== 'completed') {
    console.error(`run ${runId} [${h.status}] is not completed — refusing (partial data)`)
    process.exit(1)
  }
  const expUid = FROZEN_UIDS[runId] ?? `${PREFIX}--ax7${half}-${code}--lat140`
  if (h.batchUid !== expUid) {
    console.error(
      `cell ${code} ${half} run ${runId}: batchUid '${h.batchUid}' != expected '${expUid}' — wrong run wired?`,
    )
    process.exit(1)
  }
  const p = (h.params ?? {}) as Record<string, unknown>
  const offs = p.rungOffsets
  const want = EXPECT_OFFSETS[code]!
  const offsOk =
    Array.isArray(offs) &&
    offs.length === want.length &&
    offs.every((v, i) => Math.abs(Number(v) - want[i]!) < 1e-9)
  if (!offsOk) {
    console.error(`run ${runId}: rungOffsets ${JSON.stringify(offs)} != ${JSON.stringify(want)}`)
    process.exit(1)
  }
  const solo = Number(p.soloCap ?? 0.65)
  if (Math.abs(solo - EXPECT_SOLO[code]!) > 1e-9) {
    console.error(`run ${runId}: soloCap ${solo} != expected ${EXPECT_SOLO[code]}`)
    process.exit(1)
  }
  const cap = Number(p.pairCostCap ?? 0.99)
  const delta = Number(p.requoteDelta ?? 0.02)
  const mode = String(p.completionMode ?? 'none')
  const tol = Number(p.parityTolPct ?? NaN)
  if (
    Math.abs(cap - 0.96) > 1e-9 ||
    Math.abs(delta - 0.02) > 1e-9 ||
    mode !== 'none' ||
    Math.abs(tol - 2) > 1e-9
  ) {
    console.error(
      `run ${runId}: chassis mismatch (cap=${cap} delta=${delta} completion=${mode} tol=${tol}; want 0.96/0.02/none/2)`,
    )
    process.exit(1)
  }
  const gateMode = String(p.fvGateMode ?? 'none')
  const gateBps = Number(p.fvGateBps ?? NaN)
  if (gateMode !== 'level' || Math.abs(gateBps) > 1e-9) {
    console.error(
      `run ${runId}: fvGateMode=${gateMode} fvGateBps=${gateBps} != level/0 — wrong run wired?`,
    )
    process.exit(1)
  }

  const rows = await loadMarketRows(runId)
  const els: number[] = []
  const pairT: number[] = []
  const remT: number[] = []
  const costT: number[] = []
  const feeT: number[] = []
  let played = 0
  let makers = 0
  let takers = 0
  let xN = 0
  const pr: number[] = []
  const outl: number[] = []
  let settleFails = 0
  for (const m of rows) {
    const e = computeMarketEcon(m)
    els.push(e.el)
    if (!e.settleCheckOk) settleFails += 1
    const outcome = m.finalOutcome ?? 'UP'
    const up = m.upShares + e.dockedUp
    const down = m.downShares + e.dockedDown
    const pairs = Math.min(up, down)
    pairT.push(pairs)
    remT.push(outcome === 'UP' ? up - pairs : down - pairs)
    costT.push(m.cost + m.splitCost)
    feeT.push(e.takerFeeEra)
    for (const meta of m.metas) {
      if (meta.k === 'x' && Number(meta.px) > 0 && Number(meta.sz) > 0) xN += 1
    }
    if (e.makerFills + e.takerFills > 0) {
      played += 1
      makers += e.makerFills
      takers += e.takerFills
      pr.push(e.pairRate)
      outl.push(e.outlay)
    }
  }
  if (xN > 0) {
    console.error(
      `run ${runId}: ${xN} 'x' metas in a maker-only axis — wrong run or code leak; aborting`,
    )
    process.exit(1)
  }
  const n = els.length
  const mu = mean(els)
  const sd = Math.sqrt(mean(els.map((x) => (x - mu) ** 2)) * (n / Math.max(1, n - 1)))
  const se = sd / Math.sqrt(Math.max(1, n))
  const idEl = mean(pairT) + mean(remT) - mean(costT) - mean(feeT)
  if (Math.abs(idEl - mu) > 1e-4) {
    console.error(
      `run ${runId}: identity EL ${idEl.toFixed(6)} != canonical EL ${mu.toFixed(6)} — decomposition invalid; aborting`,
    )
    process.exit(1)
  }
  const sortedEl = [...els].sort((a, b) => a - b)
  const w5 = Math.max(1, Math.floor(n * 0.05))
  cells.set(ck(code, half), {
    code,
    half,
    runId,
    n,
    played,
    el: mu,
    se,
    t: se > 0 ? mu / se : 0,
    takerShare: makers + takers > 0 ? takers / (makers + takers) : 0,
    pairRate: mean(pr),
    avgOutlay: mean(outl),
    makers,
    takers,
    cvar5: mean(sortedEl.slice(0, w5)),
    pair: mean(pairT),
    rem: mean(remT),
    cost: mean(costT),
    fee: mean(feeT),
    settleFails,
  })
}

// ------------------------------------------------------------- CLI wiring

const argv = process.argv.slice(2)
const wired = new Map<string, [number, number]>(
  Object.entries(FROZEN) as [string, [number, number]][],
)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--arm') continue
  const m = /^(r1|r12s|r3m|r3d|s75|s85)=(\d+),(\d+)$/.exec(argv[i + 1] ?? '')
  if (!m) {
    console.error(`bad --arm ${argv[i + 1]} (want <code>=<h1RunId>,<h2RunId>, code in {r1,r12s,r3m,r3d,s75,s85})`)
    process.exit(1)
  }
  if (wired.has(m[1]!)) {
    console.error(`duplicate --arm for ${m[1]}`)
    process.exit(1)
  }
  wired.set(m[1]!, [Number(m[2]), Number(m[3])])
}

for (const [code, [r1, r2]] of wired) {
  await buildCell(code, 'h1', r1)
  await buildCell(code, 'h2', r2)
}

// n must match the same-half g00 incumbent
for (const c of cells.values()) {
  if (c.code === 'g00') continue
  const ref = cells.get(ck('g00', c.half))
  if (ref && ref.n !== c.n) {
    console.error(
      `cell ${c.code} ${c.half} (run ${c.runId}): n=${c.n} != g00 n=${ref.n} (run ${ref.runId}) — universes differ, Δ invalid; aborting`,
    )
    process.exit(1)
  }
}

// ------------------------------------------------------------- rendering

const ORDER = ['r12s', 'r1', 'g00', 'r3m', 'r3d', 's75', 's85'] as const

console.log('=== §E008b — favorite-side structure × solo-cap on the gated chassis (vs g00 incumbent) ===')
for (const half of ['h1', 'h2'] as const) {
  const have = ORDER.map((c) => cells.get(ck(c, half))).filter(Boolean) as Cell[]
  if (!have.length) continue
  console.log(`\n-- ${half} --`)
  console.log(
    'arm    run    n     played%  EL        se      t       taker%  pairRate  outlay   CVaR5     fills m/t (per played)',
  )
  for (const c of have) {
    console.log(
      `${c.code.padEnd(6)} ${String(c.runId).padEnd(6)} ${String(c.n).padEnd(5)} ${(
        (100 * c.played) /
        Math.max(1, c.n)
      )
        .toFixed(1)
        .padStart(6)}%  ${c.el.toFixed(4).padStart(8)} ${c.se.toFixed(4).padStart(7)} ${c.t
        .toFixed(1)
        .padStart(7)} ${(100 * c.takerShare).toFixed(1).padStart(6)} ${c.pairRate
        .toFixed(3)
        .padStart(9)} ${c.avgOutlay.toFixed(2).padStart(7)} ${c.cvar5.toFixed(4).padStart(9)}  ${c.makers}/${c.takers} (${(
        (c.makers + c.takers) /
        Math.max(1, c.played)
      ).toFixed(1)}/mkt)`,
    )
    if (c.settleFails > 0) console.log(`     ^ WARNING: ${c.settleFails} settlement-check failures`)
    if (c.played / Math.max(1, c.n) < 0.2)
      console.log(
        '     ^ PARTICIPATION CAVEAT (criteria 1): played < 20% — unmeasurable-at-coverage',
      )
  }
}

type Delta = {
  code: string
  half: Half
  dEl: number
  seDiff: number
  distinct: boolean
  dPair: number
  dRem: number
  dCost: number
  dFee: number
}
const deltas: Delta[] = []
for (const c of cells.values()) {
  if (c.code === 'g00') continue
  const ref = cells.get(ck('g00', c.half))
  if (!ref) continue
  const dEl = c.el - ref.el
  const seDiff = Math.sqrt(c.se ** 2 + ref.se ** 2)
  deltas.push({
    code: c.code,
    half: c.half,
    dEl,
    seDiff,
    distinct: Math.abs(dEl) > 2 * seDiff,
    dPair: c.pair - ref.pair,
    dRem: c.rem - ref.rem,
    dCost: c.cost - ref.cost,
    dFee: c.fee - ref.fee,
  })
}
deltas.sort(
  (a, b) =>
    ORDER.indexOf(a.code as (typeof ORDER)[number]) -
      ORDER.indexOf(b.code as (typeof ORDER)[number]) || a.half.localeCompare(b.half),
)

console.log('\n=== Δ(arm − g00 same-half) — settlement identity terms sum to ΔEL ===')
console.log('arm    half  ΔEL       2·se_diff  call             Δpair     Δrem      Δcost     Δfee')
const f = (x: number) => ((x >= 0 ? '+' : '') + x.toFixed(4)).padStart(8)
for (const d of deltas) {
  console.log(
    `${d.code.padEnd(6)} ${d.half}    ${f(d.dEl)}  ${(2 * d.seDiff)
      .toFixed(4)
      .padStart(
        8,
      )}  ${(d.distinct ? 'DISTINCT' : 'indistinguishable').padEnd(17)}${f(d.dPair)}  ${f(d.dRem)}  ${f(
      d.dCost,
    )}  ${f(d.dFee)}`,
  )
}

// ------------------------------------------------------- frozen evaluations

const D = (code: string, half: Half) => deltas.find((d) => d.code === code && d.half === half)
const C = (code: string, half: Half) => cells.get(ck(code, half))

console.log('\n=== frozen rules (§E008b, s27 u75) ===')

function chainEval(name: string, chain: readonly string[]): void {
  const missing = chain.some((c) => !C(c, 'h1') || !C(c, 'h2'))
  if (missing) {
    console.log(`(3) ${name} chain: pending — not all cells wired`)
    return
  }
  const dirs: Record<Half, number> = { h1: 0, h2: 0 }
  for (const half of ['h1', 'h2'] as const) {
    const signs: string[] = []
    for (let i = 1; i < chain.length; i++) {
      const a = C(chain[i - 1]!, half)!
      const b = C(chain[i]!, half)!
      const s = Math.sign(b.el - a.el)
      signs.push(`${chain[i - 1]}→${chain[i]} ${s > 0 ? '+' : s < 0 ? '−' : '0'}`)
    }
    const end = Math.sign(C(chain[chain.length - 1]!, half)!.el - C(chain[0]!, half)!.el)
    dirs[half] = end
    console.log(`    ${half}: ${signs.join(', ')}; endpoint sign(${chain[chain.length - 1]}−${chain[0]}) = ${end > 0 ? '+' : end < 0 ? '−' : '0'}`)
  }
  const dirHolds = dirs.h1 === dirs.h2 && dirs.h1 !== 0
  const top2 = (half: Half) =>
    chain
      .map((l) => C(l, half)!)
      .sort((a, b) => b.el - a.el)
      .slice(0, 2)
      .map((c) => c.code)
      .sort()
      .join(',')
  const t1 = top2('h1')
  const t2 = top2('h2')
  console.log(`    endpoint direction agreement: ${dirHolds ? 'HOLDS' : 'FAILS'}; top-2 h1 {${t1}} h2 {${t2}} → ${t1 === t2 ? 'HOLDS' : 'FAILS'}`)
}

console.log('(3) advance rule — sub-axis chains:')
chainEval('structure (by max rung depth)', STRUCT_CHAIN)
chainEval('solo-cap (by cap)', SOLO_CHAIN)

{
  const advancing: string[] = []
  let anyPending = false
  for (const code of ['r1', 'r12s', 'r3m', 'r3d', 's75', 's85']) {
    const d1 = D(code, 'h1')
    const d2 = D(code, 'h2')
    if (!d1 || !d2) {
      anyPending = true
      continue
    }
    if (d1.dEl > 0 && d1.distinct && d2.dEl > 0 && d2.distinct) advancing.push(code)
  }
  console.log(
    `(3) ADVANCE list (EL-DISTINCT better than g00 in BOTH halves)${anyPending ? ' [PARTIAL]' : ''}: ${advancing.length ? advancing.join(', ') : '(none)'}`,
  )
  if (!anyPending && advancing.length)
    console.log('    → advancing cells owe the pre-committed survival battery (criteria 4) before candidate assembly')
}

{
  const d1 = D('r12s', 'h1')
  const d2 = D('r12s', 'h2')
  if (!d1 || !d2) console.log('(P1) r12s Δrem ≤ −1.0 both halves: pending')
  else {
    const ok = d1.dRem <= -1.0 && d2.dRem <= -1.0
    console.log(
      `(P1) r12s Δrem ≤ −1.0 both halves: h1 ${f(d1.dRem).trim()}, h2 ${f(d2.dRem).trim()} → ${ok ? 'CONFIRMED' : 'REFUTED'}`,
    )
  }
}

{
  const d1 = D('s85', 'h1')
  const d2 = D('s85', 'h2')
  if (!d1 || !d2) console.log('(P2) s85 Δrem ≥ +1.0 both halves: pending')
  else {
    const ok = d1.dRem >= 1.0 && d2.dRem >= 1.0
    console.log(
      `(P2) s85 Δrem ≥ +1.0 both halves: h1 ${f(d1.dRem).trim()}, h2 ${f(d2.dRem).trim()} → ${ok ? 'CONFIRMED' : 'REFUTED'}`,
    )
  }
}

{
  const codes = ['r3m', 'r3d', 's75', 's85']
  const missing = codes.some((c) => !D(c, 'h1') || !D(c, 'h2'))
  if (missing) console.log('(P3) some arm of {r3m,r3d,s75,s85} EL-DISTINCT better both halves: pending')
  else {
    const winners = codes.filter((c) => {
      const d1 = D(c, 'h1')!
      const d2 = D(c, 'h2')!
      return d1.dEl > 0 && d1.distinct && d2.dEl > 0 && d2.distinct
    })
    console.log(
      `(P3) some arm of {r3m,r3d,s75,s85} EL-DISTINCT better both halves: ${winners.length ? winners.join(', ') : '(none)'} → ${winners.length ? 'CONFIRMED' : 'REFUTED — axis closes, backlog re-ranks'}`,
    )
  }
}

await closeDb()
