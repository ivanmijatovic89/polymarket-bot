/**
 * calib4.ts — CAL-004 one-shot analysis (knowledge/CALIBRATION-4.md, D34):
 * the frozen CAL-001 fixed-time plane decomposed by SPREAD STATE at the
 * sampled book — T (tight, spread ≤ 0.0105 = one tick + half-tick FP
 * tolerance) vs W (wide). k = 252 cells, candidate/NEG-FLAG bar z ≥ 3.75
 * (one-sided p = 0.023/252 ≈ 9.127e-5; tail(3.75) ≈ 8.84e-5 — rounds UP,
 * conservative per the CAL-003 audit precedent).
 *
 * Usage:
 *   npx tsx fable-lab/tools/calib4.ts <diag-calib log>                  # discovery one-shot
 *   npx tsx fable-lab/tools/calib4.ts <log> --expect-totals L,PS       # reserve confirmation mode
 *   npx tsx fable-lab/tools/calib4.ts <...synthetic... log> --outcomes <json>   # selftest only
 *
 * Modes:
 * - DISCOVERY (default): before printing any new cell, the tool must
 *   reproduce the published CAL-001 read EXACTLY (parse-identity gates,
 *   CALIBRATION-4.md "Instrument validation gates" 1-6: line totals,
 *   pipeline totals, per-offset coverage, join counts, and the four gate
 *   cells at printed precision). Any mismatch ABORTS (exit 2) — parser or
 *   join drift; fix against the synthetic fixture, never the real log.
 * - RESERVE (--expect-totals <lines>,<perSide>): for the binding reserve
 *   confirmation (CAL-002 amendment #1 semantics). The identity gates are
 *   replaced by the passed outcome-free battery totals; behavioral gates
 *   keep running (join-direction winRate > 0.9 with n ≥ 30; E14-analog
 *   |z| < 3.75, EMPTY control ABORTS on a real log); candidate flagging
 *   DROPS the sub-window requirement (reserve postdates the discovery
 *   sub-windows). REFUSED on paths containing "CAL-001-discovery" so
 *   reserve mode can never relax the discovery read.
 * - --outcomes <json> ({slug: '0'|'1'}) exists ONLY for the committed
 *   selftest (calib4-selftest.ts): replaces the DB result_id join;
 *   REFUSED unless the log path contains "synthetic". On the synthetic
 *   path the discovery identity gates are skipped (they hard-code the
 *   real log's published totals) and an empty E14 control is OK.
 *
 * Everything decision-relevant here is frozen in CALIBRATION-4.md;
 * changing a bucket, threshold, or gate after the one-shot is a protocol
 * breach (honor-system + git audit trail, as for calib.ts/calib2/calib3).
 */
import { readFileSync } from 'node:fs'
import '../../src/config/env.js'
import { getMarketsBySlugs } from '../../src/db/telonexMarkets.js'

const OFFSETS = [30, 150, 300, 450, 600, 750, 850] as const
// [lo, hi) except the last bucket, which is inclusive of hi (calib.ts).
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
const SIDES = ['UP', 'DOWN'] as const
type Side = (typeof SIDES)[number]
const STATES = ['T', 'W'] as const
type SpreadState = (typeof STATES)[number]
const SPREAD_TIGHT_MAX = 0.0105
const K = OFFSETS.length * ASK_BUCKETS.length * SIDES.length * STATES.length // 252
const Z_BAR = 3.75 // one-sided p = 0.023/252 ≈ 9.127e-5; tail(3.75) ≈ 8.84e-5 (conservative)
const MINORITY_MIN = 30 // D13
const FEE_RATE = 0.0156
const NEXT_BOUND: Record<number, number> = { 30: 150, 150: 300, 300: 450, 450: 600, 600: 750, 750: 850, 850: 900 }
const SUBWINDOWS: Array<[string, number, number]> = [
  ['W1(→Dec)', 0, Date.UTC(2026, 0, 1)],
  ['W2(Jan)', Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)],
  ['W3(Feb)', Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
]

// Published CAL-001 discovery read (knowledge/CALIBRATION.md Results) — the
// discovery identity gates. A calib4 parse of the same log with the same
// pipeline MUST reproduce every one of these before any new cell prints.
const PUB = {
  lines: 104776,
  perSide: 52388,
  obs: 100404,
  markets: 8133,
  drift: 200,
  band: 4172,
  emitted: 8133,
  coverage: {
    UP: { 30: 8121, 150: 8117, 300: 8104, 450: 8070, 600: 7772, 750: 6235, 850: 3774 },
    DOWN: { 30: 8121, 150: 8117, 300: 8104, 450: 8068, 600: 7784, 750: 6239, 850: 3778 },
  } as Record<Side, Record<number, number>>,
  joined: 8133,
  gateJoin: { UP: { winRate: '0.9854', n: 687 }, DOWN: { winRate: '0.9778', n: 721 } } as Record<
    Side,
    { winRate: string; n: number }
  >,
  gateCtl: { UP: { z: '-1.02', n: 520 }, DOWN: { z: '-0.59', n: 516 } } as Record<Side, { z: string; n: number }>,
}

const LINE_RE =
  /^\[diag-calib\] slug=(\S+) epoch=(\d+) asset=(UP|DOWN) off=(\d+) ts=([\d.]+) bid=([\d.]+) ask=([\d.]+)\s*$/

function bucketIndex(ask: number): number {
  for (let i = 0; i < ASK_BUCKETS.length; i++) {
    const [lo, hi] = ASK_BUCKETS[i]
    const last = i === ASK_BUCKETS.length - 1
    if (ask >= lo && (last ? ask <= hi : ask < hi)) return i
  }
  return -1
}

type Obs = { slug: string; epochMs: number; side: Side; off: number; ask: number; state: SpreadState }

function abort(msg: string): never {
  console.error(msg)
  process.exit(2)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const outIdx = argv.indexOf('--outcomes')
  let outcomesPath: string | undefined
  if (outIdx !== -1) {
    outcomesPath = argv[outIdx + 1]
    if (!outcomesPath) {
      console.error('--outcomes requires a value')
      process.exit(1)
    }
    argv.splice(outIdx, 2)
  }
  const etIdx = argv.indexOf('--expect-totals')
  let expectTotals: { lines: number; perSide: number } | undefined
  if (etIdx !== -1) {
    const v = argv[etIdx + 1]
    const m = v ? /^(\d+),(\d+)$/.exec(v) : null
    if (!m) {
      console.error('--expect-totals requires <lines>,<perSide>')
      process.exit(1)
    }
    expectTotals = { lines: Number(m[1]), perSide: Number(m[2]) }
    argv.splice(etIdx, 2)
  }
  const path = argv[0]
  if (!path) {
    console.error(
      'usage: npx tsx fable-lab/tools/calib4.ts <diag-calib log> [--expect-totals <lines>,<perSide>] [--outcomes <json>]',
    )
    process.exit(1)
  }
  const synthetic = outcomesPath !== undefined
  if (synthetic && !path.includes('synthetic')) {
    console.error('REFUSED: --outcomes is only for synthetic fixtures (log path must contain "synthetic")')
    process.exit(1)
  }
  const reserve = expectTotals !== undefined
  if (reserve && path.includes('CAL-001-discovery')) {
    console.error('REFUSED: --expect-totals is the reserve mode and cannot run on the CAL-001 discovery log')
    process.exit(1)
  }
  const discovery = !reserve && !synthetic

  // --- Parse (calib.ts pipeline, verbatim semantics) + spread state ---
  const seen = new Set<string>()
  const obs: Obs[] = []
  let skippedRange = 0
  let skippedDrift = 0
  let wellFormed = 0
  const perSideLines: Record<Side, number> = { UP: 0, DOWN: 0 }
  const slugsAll = new Set<string>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const [, slug, epochStr, side, offStr, tsStr, bidStr, askStr] = m
    const off = Number(offStr)
    const ts = Number(tsStr)
    const bid = Number(bidStr)
    const ask = Number(askStr)
    if (!(OFFSETS as readonly number[]).includes(off)) continue
    wellFormed++
    perSideLines[side as Side]++
    slugsAll.add(slug)
    const key = `${slug}|${side}|${off}`
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
    const state: SpreadState = ask - bid <= SPREAD_TIGHT_MAX ? 'T' : 'W'
    obs.push({ slug, epochMs: Number(epochStr) * 1000, side: side as Side, off, ask, state })
  }

  // Gate 1 (line totals): discovery → published; reserve → passed totals.
  if (discovery) {
    if (wellFormed !== PUB.lines || perSideLines.UP !== PUB.perSide || perSideLines.DOWN !== PUB.perSide)
      abort(
        `ABORT — identity gate 1 failed: lines=${wellFormed} UP=${perSideLines.UP} DOWN=${perSideLines.DOWN} ` +
          `(published ${PUB.lines}/${PUB.perSide}/${PUB.perSide}). Parser drift; fix against the synthetic fixture.`,
      )
  } else if (reserve) {
    if (
      wellFormed !== expectTotals!.lines ||
      perSideLines.UP !== expectTotals!.perSide ||
      perSideLines.DOWN !== expectTotals!.perSide
    )
      abort(
        `ABORT — reserve totals gate failed: lines=${wellFormed} UP=${perSideLines.UP} DOWN=${perSideLines.DOWN} ` +
          `(expected ${expectTotals!.lines},${expectTotals!.perSide}). Wrong log or damaged battery.`,
      )
  }
  console.log(`gate line-totals: OK (lines=${wellFormed}, UP=${perSideLines.UP}, DOWN=${perSideLines.DOWN})`)

  const slugs = [...new Set(obs.map((o) => o.slug))]
  console.log(
    `parsed ${obs.length} valid observations across ${slugs.length} markets ` +
      `(${skippedDrift} drift-discarded [ts past next offset], ${skippedRange} ask outside [0.02,0.995]; ` +
      `${slugsAll.size} markets emitted any line)`,
  )
  // Gate 2 (pipeline totals), discovery only.
  if (
    discovery &&
    (obs.length !== PUB.obs ||
      slugs.length !== PUB.markets ||
      skippedDrift !== PUB.drift ||
      skippedRange !== PUB.band ||
      slugsAll.size !== PUB.emitted)
  )
    abort(
      `ABORT — identity gate 2 failed: obs=${obs.length} markets=${slugs.length} drift=${skippedDrift} ` +
        `band=${skippedRange} emitted=${slugsAll.size} ` +
        `(published ${PUB.obs}/${PUB.markets}/${PUB.drift}/${PUB.band}/${PUB.emitted}).`,
    )

  // Per-offset coverage (per side) + gate 3 (discovery).
  for (const side of SIDES) {
    const covered = new Map<number, Set<string>>()
    for (const o of obs) {
      if (o.side !== side) continue
      if (!covered.has(o.off)) covered.set(o.off, new Set())
      covered.get(o.off)!.add(o.slug)
    }
    console.log(
      `per-offset market coverage ${side}: ` +
        OFFSETS.map((o) => `o${o}=${covered.get(o)?.size ?? 0}`).join(' '),
    )
    if (discovery)
      for (const o of OFFSETS) {
        const got = covered.get(o)?.size ?? 0
        if (got !== PUB.coverage[side][o])
          abort(
            `ABORT — identity gate 3 failed (${side} o${o}): coverage=${got}, published ${PUB.coverage[side][o]}.`,
          )
      }
  }

  // --- Outcome join (calib.ts semantics) + gate 4 (discovery) ---
  const upWon = new Map<string, boolean>()
  if (synthetic) {
    const json = JSON.parse(readFileSync(outcomesPath!, 'utf8')) as Record<string, string>
    for (const [slug, r] of Object.entries(json)) {
      if (r === '0') upWon.set(slug, true)
      else if (r === '1') upWon.set(slug, false)
    }
  } else {
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
  }
  const joined = slugs.filter((s) => upWon.has(s)).length
  const unresolved = slugs.length - joined
  console.log(`outcome joined for ${joined}/${slugs.length} markets (${unresolved} missing/unresolved — excluded)`)
  if (discovery && (joined !== PUB.joined || unresolved !== 0))
    abort(`ABORT — identity gate 4 failed: joined=${joined} unresolved=${unresolved} (published ${PUB.joined}/0).`)
  const won = (slug: string, side: Side): boolean | undefined => {
    const u = upWon.get(slug)
    if (u === undefined) return undefined
    return side === 'UP' ? u : !u
  }

  // --- Grids: [side][offset][bucket][state] ---
  type Cell = { n: number; sumAsk: number; wins: number; sumVar: number; obs: Obs[] }
  const mkCell = (): Cell => ({ n: 0, sumAsk: 0, wins: 0, sumVar: 0, obs: [] })
  const mkGrid = (): Cell[][][] => OFFSETS.map(() => ASK_BUCKETS.map(() => [mkCell(), mkCell()]))
  const grids: Record<Side, Cell[][][]> = { UP: mkGrid(), DOWN: mkGrid() }
  for (const o of obs) {
    const w = won(o.slug, o.side)
    if (w === undefined) continue
    const oi = (OFFSETS as readonly number[]).indexOf(o.off)
    const bi = bucketIndex(o.ask)
    const c = grids[o.side][oi][bi][o.state === 'T' ? 0 : 1]
    c.n++
    c.sumAsk += o.ask
    c.wins += w ? 1 : 0
    c.sumVar += o.ask * (1 - o.ask)
    c.obs.push(o)
  }

  type Stat = {
    n: number
    meanAsk: number
    winRate: number
    d: number
    fee: number
    net: number
    se: number
    z: number
    minority: number
  }
  const statOf = (cells: Cell[]): Stat | null => {
    let n = 0
    let sumAsk = 0
    let wins = 0
    let sumVar = 0
    for (const c of cells) {
      n += c.n
      sumAsk += c.sumAsk
      wins += c.wins
      sumVar += c.sumVar
    }
    if (n === 0) return null
    const meanAsk = sumAsk / n
    const winRate = wins / n
    const d = winRate - meanAsk
    const fee = meanAsk > 0 ? (winRate * FEE_RATE * Math.min(meanAsk, 1 - meanAsk)) / meanAsk : 0
    const net = d - fee
    const se = Math.sqrt(sumVar) / n
    const z = se > 0 ? d / se : 0
    const minority = Math.min(wins, n - wins)
    return { n, meanAsk, winRate, d, fee, net, se, z, minority }
  }
  const stat = (side: Side, oi: number, bi: number, si: number): Stat | null => statOf([grids[side][oi][bi][si]])
  const statPooled = (side: Side, oi: number, bi: number): Stat | null => statOf(grids[side][oi][bi])

  const subwindowD = (side: Side, oi: number, bi: number, si: number): Array<[string, number, number]> =>
    SUBWINDOWS.map(([label, lo, hi]) => {
      const xs = grids[side][oi][bi][si].obs.filter((o) => o.epochMs >= lo && o.epochMs < hi)
      if (xs.length === 0) return [label, 0, NaN] as [string, number, number]
      let wins = 0
      let sumAsk = 0
      for (const o of xs) {
        wins += won(o.slug, side) ? 1 : 0
        sumAsk += o.ask
      }
      return [label, xs.length, wins / xs.length - sumAsk / xs.length] as [string, number, number]
    })

  // --- Behavioral gates on the T/W-POOLED cells (identical territory to
  // calib.ts's gates) + identity gates 5/6 (discovery). ---
  const oi850 = (OFFSETS as readonly number[]).indexOf(850)
  for (const side of SIDES) {
    const gateJoin = statPooled(side, oi850, ASK_BUCKETS.length - 1)
    if (!gateJoin || gateJoin.n < 30 || gateJoin.winRate <= 0.9)
      abort(
        `ABORT — join-direction gate failed (${side}): pooled cell (850s, [0.98,0.995]) = ` +
          (gateJoin ? `n=${gateJoin.n} winRate=${gateJoin.winRate.toFixed(4)}` : 'empty') +
          ` (need n≥30 and winRate>0.9). Suspect result_id join or parse bug.`,
      )
    if (
      discovery &&
      (gateJoin.winRate.toFixed(4) !== PUB.gateJoin[side].winRate || gateJoin.n !== PUB.gateJoin[side].n)
    )
      abort(
        `ABORT — identity gate 5 failed (${side}): winRate=${gateJoin.winRate.toFixed(4)} n=${gateJoin.n} ` +
          `(published ${PUB.gateJoin[side].winRate}/${PUB.gateJoin[side].n}).`,
      )
    const gateCtl = statPooled(side, oi850, ASK_BUCKETS.length - 2)
    if (!gateCtl && !synthetic)
      abort(
        `ABORT — E14 positive-control gate EMPTY (${side}) on a real log: CAL-001 measured n≈520/516 here; ` +
          `emptiness signals a derivation bug (CAL-002 amendment #3 semantics).`,
      )
    if (gateCtl && Math.abs(gateCtl.z) >= Z_BAR)
      abort(
        `ABORT — E14 positive-control gate failed (${side}): pooled cell (850s, [0.90,0.98)) ` +
          `d=${gateCtl.d.toFixed(4)} z=${gateCtl.z.toFixed(2)} n=${gateCtl.n} ` +
          `contradicts E14's on-diagonal measurement. Instrument suspect; do not read the table.`,
      )
    if (discovery && gateCtl && (gateCtl.z.toFixed(2) !== PUB.gateCtl[side].z || gateCtl.n !== PUB.gateCtl[side].n))
      abort(
        `ABORT — identity gate 6 failed (${side}): z=${gateCtl.z.toFixed(2)} n=${gateCtl.n} ` +
          `(published ${PUB.gateCtl[side].z}/${PUB.gateCtl[side].n}).`,
      )
    console.log(
      `gates ${side}: join-direction OK (pooled 850s tail winRate=${gateJoin.winRate.toFixed(4)}, n=${gateJoin.n}); ` +
        `E14 positive control OK ` +
        (gateCtl ? `(net=${gateCtl.net.toFixed(4)} z=${gateCtl.z.toFixed(2)} n=${gateCtl.n})` : '(empty)'),
    )
  }

  // --- Cell tables (T row then W row per bucket; tightFrac on the T row) ---
  const candidates: string[] = []
  const negFlags: string[] = []
  for (const side of SIDES) {
    console.log(
      `\nCAL-004 ${side}-side cell table (k=${K} total, candidate bar z>=${Z_BAR}, minority>=${MINORITY_MIN}, ` +
        `tight=spread<=${SPREAD_TIGHT_MAX}, fee=winRate*${FEE_RATE}*min(a,1-a)/a` +
        (reserve ? ', reserve mode: no sub-window requirement' : ', sub-window consistency required') +
        `)`,
    )
    console.log(
      'off  askBucket     st      n    tfr  meanAsk winRate      d     fee     net      se      z  minor  flag',
    )
    for (let oi = 0; oi < OFFSETS.length; oi++) {
      for (let bi = 0; bi < ASK_BUCKETS.length; bi++) {
        const nT = grids[side][oi][bi][0].n
        const nW = grids[side][oi][bi][1].n
        const tfr = nT + nW > 0 ? (nT / (nT + nW)).toFixed(3) : '   na'
        for (let si = 0; si < STATES.length; si++) {
          const s = stat(side, oi, bi, si)
          const [lo, hi] = ASK_BUCKETS[bi]
          const last = bi === ASK_BUCKETS.length - 1
          const label = `[${lo.toFixed(2)},${hi.toFixed(3)}${last ? ']' : ')'}`
          const st = STATES[si]
          const tfrCol = si === 0 ? tfr.padStart(6) : '      '
          if (!s) {
            console.log(`${String(OFFSETS[oi]).padStart(3)}  ${label.padEnd(13)} ${st} empty`)
            continue
          }
          let flag = ''
          if (s.net > 0 && s.z >= Z_BAR && s.minority >= MINORITY_MIN) {
            if (reserve) {
              flag = 'CANDIDATE'
              candidates.push(`${side} ${st} (${OFFSETS[oi]}s, ${label})`)
            } else {
              const sw = subwindowD(side, oi, bi, si)
              const consistent = sw.every(([, n, d]) => n > 0 && d > 0)
              const swStr = sw
                .map(([l, n, d]) => `${l}:n=${n},d=${Number.isNaN(d) ? 'na' : d.toFixed(4)}`)
                .join(' ')
              if (consistent) {
                flag = 'CANDIDATE'
                candidates.push(`${side} ${st} (${OFFSETS[oi]}s, ${label}) [${swStr}]`)
              } else {
                flag = 'CANDIDATE-demoted(subwindow-inconsistent)'
                negFlags.push(`demoted ${side} ${st} (${OFFSETS[oi]}s, ${label}) [${swStr}]`)
              }
            }
          } else if (s.z <= -Z_BAR) {
            flag = s.minority >= MINORITY_MIN ? 'NEG-FLAG' : 'NEG-FLAG(underpowered-E14)'
            negFlags.push(`${side} ${st} (${OFFSETS[oi]}s, ${label}) ${flag}`)
          }
          console.log(
            `${String(OFFSETS[oi]).padStart(3)}  ${label.padEnd(13)} ${st} ${String(s.n).padStart(6)} ${tfrCol} ` +
              `${s.meanAsk.toFixed(4)}  ${s.winRate.toFixed(4)} ` +
              `${s.d >= 0 ? '+' : ''}${s.d.toFixed(4)} ${s.fee.toFixed(4)} ` +
              `${s.net >= 0 ? '+' : ''}${s.net.toFixed(4)} ${s.se.toFixed(4)} ` +
              `${s.z >= 0 ? '+' : ''}${s.z.toFixed(2).padStart(6)} ${String(s.minority).padStart(6)}  ${flag}`,
          )
        }
      }
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
