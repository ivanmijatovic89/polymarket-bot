/**
 * calib.ts — CAL-001 one-shot analysis (knowledge/CALIBRATION.md, D21,
 * amended pre-results per knowledge/AUDIT-2026-07-10-CAL-001-REG.md).
 *
 * Usage: npx tsx fable-lab/tools/calib.ts <diag-calib log file>
 *
 * Parses [diag-calib] lines, joins telonex_markets.result_id (0=UP) via
 * src/db/telonexMarkets.ts, and prints the ENTIRE frozen 63-cell table in
 * one invocation — then applies the frozen candidate / negative-flag rules.
 * Instrument validation gates run FIRST and abort the analysis on failure.
 *
 * Everything decision-relevant here is frozen in CALIBRATION.md; changing a
 * bucket, threshold, or gate after the discovery run is a protocol breach.
 * (Enforcement is honor-system + git audit trail, not mechanical — the DB
 * is freely queryable; the frozen commit is what makes deviation visible.)
 */
import { readFileSync } from 'node:fs'
import '../../src/config/env.js'
import { getMarketsBySlugs } from '../../src/db/telonexMarkets.js'

const OFFSETS = [30, 150, 300, 450, 600, 750, 850] as const
// [lo, hi) except the last bucket, which is inclusive of hi.
const ASK_BUCKETS: Array<[number, number]> = [
  [0.02, 0.1],
  [0.1, 0.2],
  [0.2, 0.35],
  [0.35, 0.5],
  [0.5, 0.65],
  [0.65, 0.8],
  [0.8, 0.9],
  [0.9, 0.98],
  [0.98, 0.995],
]
const K = OFFSETS.length * ASK_BUCKETS.length // 63
const Z_BAR = 3.377 // one-sided p = 0.023/63
const MINORITY_MIN = 30 // D13
const FEE_RATE = 0.0156
// Drift filter (audit finding 1): a sample for offset o is valid only if its
// actual capture time ts lands before the NEXT offset (900s for the last) —
// each column's samples must come from that column's own time segment.
const NEXT_BOUND: Record<number, number> = { 30: 150, 150: 300, 300: 450, 450: 600, 600: 750, 750: 850, 850: 900 }
// Sub-window consistency (audit finding 6): a CANDIDATE must show d > 0 in
// all three fixed discovery sub-windows (UTC, by slug epoch).
const SUBWINDOWS: Array<[string, number, number]> = [
  ['W1(→Dec)', 0, Date.UTC(2026, 0, 1)],
  ['W2(Jan)', Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)],
  ['W3(Feb)', Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
]

const LINE_RE =
  /^\[diag-calib\] slug=(\S+) epoch=(\d+) off=(\d+) ts=([\d.]+) bid=([\d.]+) ask=([\d.]+)\s*$/

function bucketIndex(ask: number): number {
  for (let i = 0; i < ASK_BUCKETS.length; i++) {
    const [lo, hi] = ASK_BUCKETS[i]
    const last = i === ASK_BUCKETS.length - 1
    if (ask >= lo && (last ? ask <= hi : ask < hi)) return i
  }
  return -1
}

type Obs = { slug: string; epochMs: number; off: number; ask: number }

async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: npx tsx fable-lab/tools/calib.ts <diag-calib log file>')
    process.exit(1)
  }

  const seen = new Set<string>() // dedupe (slug, off): keep first occurrence
  const obs: Obs[] = []
  let skippedRange = 0
  let skippedDrift = 0
  const slugsAll = new Set<string>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const [, slug, epochStr, offStr, tsStr, , askStr] = m
    const off = Number(offStr)
    const ts = Number(tsStr)
    const ask = Number(askStr)
    if (!(OFFSETS as readonly number[]).includes(off)) continue
    slugsAll.add(slug)
    const key = `${slug}|${off}`
    if (seen.has(key)) continue
    seen.add(key)
    if (ts >= NEXT_BOUND[off]) {
      skippedDrift++
      continue
    }
    if (bucketIndex(ask) === -1) {
      skippedRange++
      continue
    }
    obs.push({ slug, epochMs: Number(epochStr) * 1000, off, ask })
  }

  const slugs = [...new Set(obs.map((o) => o.slug))]
  console.log(
    `parsed ${obs.length} valid observations across ${slugs.length} markets ` +
      `(${skippedDrift} drift-discarded [ts past next offset], ${skippedRange} ask outside [0.02,0.995]; ` +
      `${slugsAll.size} markets emitted any line)`,
  )
  // Per-offset coverage (audit finding 8): non-random dropout is a
  // selection effect; make it visible.
  const covered = new Map<number, Set<string>>()
  for (const o of obs) {
    if (!covered.has(o.off)) covered.set(o.off, new Set())
    covered.get(o.off)!.add(o.slug)
  }
  console.log(
    'per-offset market coverage: ' +
      OFFSETS.map((o) => `o${o}=${covered.get(o)?.size ?? 0}`).join(' '),
  )

  // Join outcomes in chunks. getMarketsBySlugs uses resolvedOnly=false;
  // unresolved markets are excluded here by accepting only resultId '0'/'1'.
  const upWon = new Map<string, boolean>()
  for (let i = 0; i < slugs.length; i += 500) {
    const rows = await getMarketsBySlugs(slugs.slice(i, i + 500), {
      converter: 'delta-typed',
      readFrom: 'local-or-download-from-r2-to-local',
    })
    for (const r of rows) {
      if (r.resultId === '0') upWon.set(r.slug, true)
      else if (r.resultId === '1') upWon.set(r.slug, false)
    }
  }
  const unresolved = slugs.filter((s) => !upWon.has(s))
  console.log(
    `outcome joined for ${upWon.size}/${slugs.length} markets (${unresolved.length} missing/unresolved — excluded)`,
  )

  type Cell = { n: number; sumAsk: number; wins: number; sumVar: number; obs: Obs[] }
  const cells: Cell[][] = OFFSETS.map(() =>
    ASK_BUCKETS.map(() => ({ n: 0, sumAsk: 0, wins: 0, sumVar: 0, obs: [] })),
  )
  for (const o of obs) {
    const w = upWon.get(o.slug)
    if (w === undefined) continue
    const oi = (OFFSETS as readonly number[]).indexOf(o.off)
    const bi = bucketIndex(o.ask)
    const c = cells[oi][bi]
    c.n++
    c.sumAsk += o.ask
    c.wins += w ? 1 : 0
    c.sumVar += o.ask * (1 - o.ask)
    c.obs.push(o)
  }

  const stat = (oi: number, bi: number) => {
    const c = cells[oi][bi]
    if (c.n === 0) return null
    const meanAsk = c.sumAsk / c.n
    const winRate = c.wins / c.n
    const d = winRate - meanAsk
    // Fee frozen pre-results (audit finding 4): the engine takes BUY fees in
    // SHARES (src/trading/fees.ts:47), so expected fee cost per intended
    // share = winRate · rate · min(a,1−a) / a, not rate · min(a,1−a).
    const fee = meanAsk > 0 ? (winRate * FEE_RATE * Math.min(meanAsk, 1 - meanAsk)) / meanAsk : 0
    const net = d - fee
    const se = Math.sqrt(c.sumVar) / c.n
    const z = se > 0 ? d / se : 0
    const minority = Math.min(c.wins, c.n - c.wins)
    return { n: c.n, meanAsk, winRate, d, fee, net, se, z, minority }
  }

  const subwindowD = (oi: number, bi: number): Array<[string, number, number]> => {
    // returns [label, n, d] per sub-window
    return SUBWINDOWS.map(([label, lo, hi]) => {
      const xs = cells[oi][bi].obs.filter((o) => o.epochMs >= lo && o.epochMs < hi)
      if (xs.length === 0) return [label, 0, NaN] as [string, number, number]
      let wins = 0
      let sumAsk = 0
      for (const o of xs) {
        wins += upWon.get(o.slug) ? 1 : 0
        sumAsk += o.ask
      }
      return [label, xs.length, wins / xs.length - sumAsk / xs.length] as [string, number, number]
    })
  }

  // Instrument validation gates (CALIBRATION.md — run before anything else).
  const oi850 = (OFFSETS as readonly number[]).indexOf(850)
  const gateJoin = stat(oi850, ASK_BUCKETS.length - 1) // (850, [0.98,0.995])
  if (!gateJoin || gateJoin.n < 30 || gateJoin.winRate <= 0.9) {
    console.error(
      `ABORT — join-direction gate failed: cell (850s, [0.98,0.995]) = ` +
        (gateJoin ? `n=${gateJoin.n} winRate=${gateJoin.winRate.toFixed(4)}` : 'empty') +
        ` (need n≥30 and winRate>0.9). Suspect result_id join or fixture bug.`,
    )
    process.exit(2)
  }
  // E14 positive control, frozen numeric bar (audit finding 2): abort iff
  // |z| ≥ Z_BAR on (850s, [0.90,0.98)) — E14 measured this territory as
  // on-diagonal at N=13,977; a bar-clearing deviation here means the
  // instrument is broken, and that judgment is made by this frozen rule,
  // not by the analyst after seeing the table.
  const gateCtl = stat(oi850, ASK_BUCKETS.length - 2)
  if (gateCtl && Math.abs(gateCtl.z) >= Z_BAR) {
    console.error(
      `ABORT — E14 positive-control gate failed: cell (850s, [0.90,0.98)) ` +
        `d=${gateCtl.d.toFixed(4)} z=${gateCtl.z.toFixed(2)} n=${gateCtl.n} ` +
        `contradicts E14's on-diagonal measurement. Instrument suspect; do not read the table.`,
    )
    process.exit(2)
  }
  console.log(
    `gates: join-direction OK (850s tail winRate=${gateJoin.winRate.toFixed(4)}, n=${gateJoin.n}); ` +
      `E14 positive control OK ` +
      (gateCtl ? `(net=${gateCtl.net.toFixed(4)} z=${gateCtl.z.toFixed(2)} n=${gateCtl.n})` : '(empty)'),
  )

  console.log(
    `\nCAL-001 cell table (k=${K}, candidate bar z>=${Z_BAR}, minority>=${MINORITY_MIN}, ` +
      `fee=winRate*${FEE_RATE}*min(a,1-a)/a, sub-window consistency required)`,
  )
  console.log('off  askBucket      n     meanAsk winRate      d     fee     net      se      z  minor  flag')
  const candidates: string[] = []
  const negFlags: string[] = []
  for (let oi = 0; oi < OFFSETS.length; oi++) {
    for (let bi = 0; bi < ASK_BUCKETS.length; bi++) {
      const s = stat(oi, bi)
      const [lo, hi] = ASK_BUCKETS[bi]
      const last = bi === ASK_BUCKETS.length - 1
      const label = `[${lo.toFixed(2)},${hi.toFixed(3)}${last ? ']' : ')'}`
      if (!s) {
        console.log(`${String(OFFSETS[oi]).padStart(3)}  ${label.padEnd(13)} empty`)
        continue
      }
      let flag = ''
      if (s.net > 0 && s.z >= Z_BAR && s.minority >= MINORITY_MIN) {
        const sw = subwindowD(oi, bi)
        const consistent = sw.every(([, n, d]) => n > 0 && d > 0)
        const swStr = sw.map(([l, n, d]) => `${l}:n=${n},d=${Number.isNaN(d) ? 'na' : d.toFixed(4)}`).join(' ')
        if (consistent) {
          flag = 'CANDIDATE'
          candidates.push(`(${OFFSETS[oi]}s, ${label}) [${swStr}]`)
        } else {
          flag = 'CANDIDATE-demoted(subwindow-inconsistent)'
          negFlags.push(`demoted (${OFFSETS[oi]}s, ${label}) [${swStr}]`)
        }
      } else if (s.z <= -Z_BAR) {
        flag = s.minority >= MINORITY_MIN ? 'NEG-FLAG' : 'NEG-FLAG(underpowered-E14)'
        negFlags.push(`(${OFFSETS[oi]}s, ${label}) ${flag}`)
      }
      console.log(
        `${String(OFFSETS[oi]).padStart(3)}  ${label.padEnd(13)}` +
          `${String(s.n).padStart(6)}  ${s.meanAsk.toFixed(4)}  ${s.winRate.toFixed(4)} ` +
          `${s.d >= 0 ? '+' : ''}${s.d.toFixed(4)} ${s.fee.toFixed(4)} ` +
          `${s.net >= 0 ? '+' : ''}${s.net.toFixed(4)} ${s.se.toFixed(4)} ` +
          `${s.z >= 0 ? '+' : ''}${s.z.toFixed(2).padStart(6)} ${String(s.minority).padStart(6)}  ${flag}`,
      )
    }
  }
  console.log(`\nCANDIDATE cells: ${candidates.length ? candidates.join(', ') : 'none'}`)
  console.log(`NEG-FLAG / demoted cells: ${negFlags.length ? negFlags.join(', ') : 'none'}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
