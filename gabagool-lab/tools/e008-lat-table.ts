/**
 * e008-lat-table.ts — §E008 BATTERY ADDENDUM judgment table (LEDGER,
 * frozen s26 u70). Assembles the full latency curve for the gated
 * cells g00/g05 vs the ungated rc+c960 chassis at the SAME latency,
 * and evaluates the frozen survival rule, payload check, and
 * predictions P1–P3 mechanically.
 *
 * Frozen wiring (hardcoded, LS-3 style — these runs are named in the
 * LEDGER block and must not be re-wired):
 *   ungated refs (§E005 battery): lat0 714/709, lat140 708/703,
 *     lat500 710/711, lat1000 712/713
 *   gated lat140 (§E008 ax6):     g00 728/725, g05 726/727
 *
 * New battery runs are wired explicitly as they land:
 *
 *   npx tsx gabagool-lab/tools/e008-lat-table.ts \
 *     --arm g00@0=<h1>,<h2> --arm g00@500=<h1>,<h2> \
 *     --arm g00@1000=<h1>,<h2> --arm g05@0=<h1>,<h2> \
 *     --arm g05@500=<h1>,<h2> --arm g05@1000=<h1>,<h2>
 *
 * Partial wiring is allowed (cells print as they land); each frozen
 * rule evaluates only when every cell it reads is present, otherwise
 * it prints "pending".
 *
 * Guards (LS-3): status completed; exact batchUid match per cell
 * (new arms must be `…--ax6bat<half>-<cell>--lat<lat>`); chassis
 * params (rungOffsets [0.02,0.13], pairCostCap 0.96, requoteDelta
 * 0.02, completionMode none, parityTolPct 2); gate arms fvGateMode=
 * level with fvGateBps 0 (g00) / 5 (g05); ungated refs fvGateMode
 * none/absent; no 'x' metas anywhere (all arms maker-only); n must
 * match the ungated ref of the same (lat, half) — Δ over different
 * universes is invalid. Settlement identity (e004-decomp.ts method:
 * EL = pair + rem − cost − fee, docked shares restored) is asserted
 * per run against computeMarketEcon's EL and aborts on divergence,
 * so the Δrem payload numbers here are the same decomposition the
 * §E008 judgment used.
 */
import { closeDb, computeMarketEcon, loadMarketRows, loadRunHeader, mean } from './lib.ts'

const PREFIX = 'glab--E003-pair-accumulator'
const LATS = [0, 140, 500, 1000] as const
const GATE_BPS: Record<string, number> = { g00: 0, g05: 5 }
const RC_OFFSETS = [0.02, 0.13]

type Half = 'h1' | 'h2'
type Lat = (typeof LATS)[number]

/** Frozen hardcoded wiring: key `<cell>@<lat>` / `ref@<lat>` → [h1, h2]. */
const FROZEN: Record<string, [number, number]> = {
  'ref@0': [714, 709],
  'ref@140': [708, 703],
  'ref@500': [710, 711],
  'ref@1000': [712, 713],
  'g00@140': [728, 725],
  'g05@140': [726, 727],
}
/** Exact batchUids of the frozen runs (verified in DB before writing). */
const FROZEN_UIDS: Record<number, string> = {
  714: `${PREFIX}--bath1-c960--lat0`,
  709: `${PREFIX}--bath2-c960--lat0`,
  708: `${PREFIX}--ax4h1-c960--lat140`,
  703: `${PREFIX}--ax4h2-c960--lat140`,
  710: `${PREFIX}--bath1-c960--lat500`,
  711: `${PREFIX}--bath2-c960--lat500`,
  712: `${PREFIX}--bath1-c960--lat1000`,
  713: `${PREFIX}--bath2-c960--lat1000`,
  728: `${PREFIX}--ax6h1-g00--lat140`,
  725: `${PREFIX}--ax6h2-g00--lat140`,
  726: `${PREFIX}--ax6h1-g05--lat140`,
  727: `${PREFIX}--ax6h2-g05--lat140`,
}

type Cell = {
  key: string // 'g00' | 'g05' | 'ref'
  lat: Lat
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
  // settlement identity terms (per-market means, e004-decomp method)
  pair: number
  rem: number
  cost: number
  fee: number
  settleFails: number
}

const cells = new Map<string, Cell>() // `<key>@<lat>@<half>`

function ck(key: string, lat: Lat, half: Half): string {
  return `${key}@${lat}@${half}`
}

async function buildCell(key: string, lat: Lat, half: Half, runId: number): Promise<void> {
  const h = await loadRunHeader(runId)
  if (!h) {
    console.error(`run ${runId} not found`)
    process.exit(1)
  }
  if (h.status !== 'completed') {
    console.error(`run ${runId} [${h.status}] is not completed — refusing (partial data)`)
    process.exit(1)
  }
  const expUid = FROZEN_UIDS[runId] ?? `${PREFIX}--ax6bat${half}-${key}--lat${lat}`
  if (h.batchUid !== expUid) {
    console.error(
      `cell ${key}@${lat} ${half} run ${runId}: batchUid '${h.batchUid}' != expected '${expUid}' — wrong run wired?`,
    )
    process.exit(1)
  }
  const p = (h.params ?? {}) as Record<string, unknown>
  const offs = p.rungOffsets
  const offsOk =
    Array.isArray(offs) &&
    offs.length === RC_OFFSETS.length &&
    offs.every((v, i) => Math.abs(Number(v) - RC_OFFSETS[i]!) < 1e-9)
  if (!offsOk) {
    console.error(
      `run ${runId}: rungOffsets ${JSON.stringify(offs)} != rc ${JSON.stringify(RC_OFFSETS)}`,
    )
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
  if (key === 'ref') {
    if (gateMode !== 'none') {
      console.error(`ref run ${runId}: fvGateMode=${gateMode} != none — wrong run wired?`)
      process.exit(1)
    }
  } else {
    if (gateMode !== 'level' || Math.abs(gateBps - GATE_BPS[key]!) > 1e-9) {
      console.error(
        `cell ${key} run ${runId}: fvGateMode=${gateMode} fvGateBps=${gateBps} != level/${GATE_BPS[key]} — wrong run wired?`,
      )
      process.exit(1)
    }
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
      `run ${runId}: ${xN} 'x' metas in a maker-only battery — wrong run or code leak; aborting`,
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
  cells.set(ck(key, lat, half), {
    key,
    lat,
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
  const m = /^(g00|g05)@(0|500|1000)=(\d+),(\d+)$/.exec(argv[i + 1] ?? '')
  if (!m) {
    console.error(`bad --arm ${argv[i + 1]} (want g00@0=<h1RunId>,<h2RunId>; lat in {0,500,1000})`)
    process.exit(1)
  }
  const k = `${m[1]}@${m[2]}`
  if (wired.has(k)) {
    console.error(`duplicate --arm for ${k}`)
    process.exit(1)
  }
  wired.set(k, [Number(m[3]), Number(m[4])])
}

for (const [k, [r1, r2]] of wired) {
  const [key, latS] = k.split('@') as [string, string]
  const lat = Number(latS) as Lat
  await buildCell(key, lat, 'h1', r1)
  await buildCell(key, lat, 'h2', r2)
}

// n must match between a gated cell and its same-(lat,half) ungated ref
for (const c of cells.values()) {
  if (c.key === 'ref') continue
  const ref = cells.get(ck('ref', c.lat, c.half))
  if (ref && ref.n !== c.n) {
    console.error(
      `cell ${c.key}@${c.lat} ${c.half} (run ${c.runId}): n=${c.n} != ungated ref n=${ref.n} (run ${ref.runId}) — universes differ, Δ invalid; aborting`,
    )
    process.exit(1)
  }
}

// ------------------------------------------------------------- rendering

console.log('=== §E008 BATTERY — latency curves (gated cells vs ungated rc+c960 chassis) ===')
for (const key of ['g00', 'g05', 'ref'] as const) {
  for (const half of ['h1', 'h2'] as const) {
    const have = LATS.map((lat) => cells.get(ck(key, lat, half))).filter(Boolean) as Cell[]
    if (!have.length) continue
    console.log(`\n-- ${key} ${half} --`)
    console.log(
      'lat    run    n     played%  EL        se      t       taker%  pairRate  outlay   CVaR5     fills m/t (per played)',
    )
    for (const c of have) {
      console.log(
        `${String(c.lat).padEnd(6)} ${String(c.runId).padEnd(6)} ${String(c.n).padEnd(5)} ${(
          (100 * c.played) /
          Math.max(1, c.n)
        )
          .toFixed(1)
          .padStart(6)}%  ${c.el.toFixed(4).padStart(8)} ${c.se.toFixed(4).padStart(7)} ${c.t
          .toFixed(1)
          .padStart(7)} ${(100 * c.takerShare).toFixed(1).padStart(6)} ${c.pairRate
          .toFixed(3)
          .padStart(
            9,
          )} ${c.avgOutlay.toFixed(2).padStart(7)} ${c.cvar5.toFixed(4).padStart(9)}  ${c.makers}/${c.takers} (${(
          (c.makers + c.takers) /
          Math.max(1, c.played)
        ).toFixed(1)}/mkt)`,
      )
      if (c.settleFails > 0)
        console.log(`     ^ WARNING: ${c.settleFails} settlement-check failures`)
      if (c.played / Math.max(1, c.n) < 0.2)
        console.log(
          '     ^ PARTICIPATION CAVEAT (criteria 1): played < 20% — unmeasurable-at-coverage',
        )
    }
  }
}

type Delta = {
  cell: string
  lat: Lat
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
  if (c.key === 'ref') continue
  const ref = cells.get(ck('ref', c.lat, c.half))
  if (!ref) continue
  const dEl = c.el - ref.el
  const seDiff = Math.sqrt(c.se ** 2 + ref.se ** 2)
  deltas.push({
    cell: c.key,
    lat: c.lat,
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
deltas.sort((a, b) => a.cell.localeCompare(b.cell) || a.lat - b.lat || a.half.localeCompare(b.half))

console.log('\n=== Δ(gated − ungated same-lat) — settlement identity terms sum to ΔEL ===')
console.log(
  'cell  lat    half  ΔEL       2·se_diff  call             Δpair     Δrem      Δcost     Δfee',
)
const f = (x: number) => ((x >= 0 ? '+' : '') + x.toFixed(4)).padStart(8)
for (const d of deltas) {
  console.log(
    `${d.cell}   ${String(d.lat).padEnd(6)} ${d.half}    ${f(d.dEl)}  ${(2 * d.seDiff)
      .toFixed(4)
      .padStart(
        8,
      )}  ${(d.distinct ? 'DISTINCT' : 'indistinguishable').padEnd(17)}${f(d.dPair)}  ${f(d.dRem)}  ${f(
      d.dCost,
    )}  ${f(d.dFee)}`,
  )
}

// ------------------------------------------------------- frozen evaluations

const D = (cell: string, lat: Lat, half: Half) =>
  deltas.find((d) => d.cell === cell && d.lat === lat && d.half === half)

console.log('\n=== frozen rules (§E008 BATTERY ADDENDUM, s26 u70) ===')

{
  // (3) survival rule: g00 at BOTH 500 and 1000, BOTH halves: ΔEL>0 AND DISTINCT
  const need: [Lat, Half][] = [
    [500, 'h1'],
    [500, 'h2'],
    [1000, 'h1'],
    [1000, 'h2'],
  ]
  const ds = need.map(([lat, half]) => D('g00', lat, half))
  if (ds.some((d) => !d)) {
    console.log('(3) survival rule: pending — g00 lat500/lat1000 cells not all wired')
  } else {
    const parts = ds.map(
      (d) =>
        `lat${d!.lat} ${d!.half}: ΔEL ${f(d!.dEl).trim()} ${d!.dEl > 0 ? '>0' : '≤0 FAIL'} ${d!.distinct ? 'DISTINCT' : 'NOT-DISTINCT FAIL'}`,
    )
    const ok = ds.every((d) => d!.dEl > 0 && d!.distinct)
    console.log(`(3) survival rule (g00, lat 500+1000, both halves, ΔEL>0 AND DISTINCT):`)
    for (const p of parts) console.log(`    ${p}`)
    console.log(
      `    → gate ${ok ? 'SURVIVES latency' : 'FAILS — latency-fragile; fall back per D-010'}`,
    )
  }
}

{
  // (4) payload: g00 Δrem ≥ −0.3 at every latency, both halves
  const all: string[] = []
  let ok = true
  let missing = false
  for (const lat of LATS) {
    for (const half of ['h1', 'h2'] as const) {
      const d = D('g00', lat, half)
      if (!d) {
        missing = true
        continue
      }
      if (d.dRem < -0.3) ok = false
      all.push(`lat${lat} ${half}: Δrem ${f(d.dRem).trim()}`)
    }
  }
  console.log(
    `(4) payload-at-latency (g00 Δrem ≥ −0.3 everywhere)${missing ? ' [PARTIAL — some cells pending]' : ''}:`,
  )
  console.log(`    ${all.join('  |  ')}`)
  if (!missing)
    console.log(`    → ${ok ? 'PASS' : 'FAIL — remainder capture is a latency artifact'}`)
}

{
  // P1: g00 ΔEL ≥ +1.5 at every latency, both halves
  const all: string[] = []
  let ok = true
  let missing = false
  for (const lat of LATS) {
    for (const half of ['h1', 'h2'] as const) {
      const d = D('g00', lat, half)
      if (!d) {
        missing = true
        continue
      }
      if (d.dEl < 1.5) ok = false
      all.push(`lat${lat} ${half}: ${f(d.dEl).trim()}`)
    }
  }
  console.log(`(P1) g00 ΔEL ≥ +1.5 at every latency${missing ? ' [PARTIAL]' : ''}:`)
  console.log(`    ${all.join('  |  ')}`)
  if (!missing) console.log(`    → ${ok ? 'CONFIRMED' : 'REFUTED'}`)
}

{
  // P2: g00 own slope EL(1000) − EL(0) ≥ −1.0 per half (ungated slope for context)
  const lines: string[] = []
  let ok = true
  let missing = false
  for (const half of ['h1', 'h2'] as const) {
    const a = cells.get(ck('g00', 0, half))
    const b = cells.get(ck('g00', 1000, half))
    const ra = cells.get(ck('ref', 0, half))
    const rb = cells.get(ck('ref', 1000, half))
    if (!a || !b) {
      missing = true
      continue
    }
    const slope = b.el - a.el
    if (slope < -1.0) ok = false
    const refSlope = ra && rb ? ` (ungated slope ${f(rb.el - ra.el).trim()})` : ''
    lines.push(`${half}: EL(1000)−EL(0) = ${f(slope).trim()}${refSlope}`)
  }
  console.log(`(P2) g00 latency slope ≥ −1.0 per half${missing ? ' [PARTIAL]' : ''}:`)
  for (const l of lines) console.log(`    ${l}`)
  if (!missing) console.log(`    → ${ok ? 'CONFIRMED' : 'REFUTED'}`)
}

{
  // P3: g05 retains DISTINCT positive ΔEL vs ungated at lat500, both halves
  const d1 = D('g05', 500, 'h1')
  const d2 = D('g05', 500, 'h2')
  if (!d1 || !d2) {
    console.log('(P3) g05 lat500 DISTINCT positive ΔEL: pending — cells not wired')
  } else {
    const ok = d1.dEl > 0 && d1.distinct && d2.dEl > 0 && d2.distinct
    console.log(
      `(P3) g05 lat500: h1 ΔEL ${f(d1.dEl).trim()} ${d1.distinct ? 'DISTINCT' : 'not-distinct'}, h2 ΔEL ${f(
        d2.dEl,
      ).trim()} ${d2.distinct ? 'DISTINCT' : 'not-distinct'} → ${ok ? 'CONFIRMED' : 'REFUTED'}`,
    )
  }
}

await closeDb()
