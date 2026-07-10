/**
 * calib2.ts — CAL-002 one-shot analysis (knowledge/CALIBRATION-2.md, D24).
 *
 * Usage:
 *   npx tsx fable-lab/tools/calib2.ts <diag-calib log file>
 *   npx tsx fable-lab/tools/calib2.ts <...synthetic... log> --outcomes <json>
 *
 * Parses the SAME [diag-calib] line grammar as calib.ts, applies the same
 * validity pipeline (first-occurrence dedupe, drift filter ts < next
 * offset), derives the frozen conditional grid: for each adjacent offset
 * pair (t1,t2) the UP-mid move mid(t2)−mid(t1) selects one of 5 frozen
 * move buckets; the entry is buy-UP / buy-DOWN at that side's ask(t2)
 * within [0.02,0.995]. k = 6 pairs × 5 buckets × 2 sides = 60 cells,
 * candidate bar z ≥ 3.37 (one-sided p = 0.023/60), minority ≥ 30,
 * sub-window consistency — all frozen in CALIBRATION-2.md.
 *
 * --outcomes <json> ({slug: '0'|'1'}) exists ONLY for the committed
 * synthetic fixture: it is refused unless the log path contains
 * "synthetic" (D18 guard pattern), and it skips the parser-consistency
 * gate (which is defined against the real discovery log's published
 * totals).
 *
 * Changing a bucket, threshold, or gate after registration is a protocol
 * breach (honor-system + git audit trail).
 */
import { readFileSync } from 'node:fs'

const OFFSETS = [30, 150, 300, 450, 600, 750, 850] as const
const PAIRS: Array<[number, number]> = [
  [30, 150],
  [150, 300],
  [300, 450],
  [450, 600],
  [600, 750],
  [750, 850],
]
// Frozen from tick size (0.01) + CAL-001-published median spread (0.01);
// chosen with no inspection of the move distribution.
const MOVE_BUCKETS: Array<{ name: string; lo: number; hi: number; loInc: boolean; hiInc: boolean }> = [
  { name: 'dn2', lo: -Infinity, hi: -0.02, loInc: false, hiInc: true }, // move <= -0.02
  { name: 'dn1', lo: -0.02, hi: -0.005, loInc: false, hiInc: true }, // -0.02 < move <= -0.005
  { name: 'flat', lo: -0.005, hi: 0.005, loInc: false, hiInc: false }, // -0.005 < move < +0.005
  { name: 'up1', lo: 0.005, hi: 0.02, loInc: true, hiInc: false }, // +0.005 <= move < +0.02
  { name: 'up2', lo: 0.02, hi: Infinity, loInc: true, hiInc: false }, // move >= +0.02
]
const SIDES = ['UP', 'DOWN'] as const
type Side = (typeof SIDES)[number]
const K = PAIRS.length * MOVE_BUCKETS.length * SIDES.length // 60
const Z_BAR = 3.37 // one-sided p = 0.023/60 ≈ 3.83e-4; tail(3.37) ≈ 3.75e-4
const MINORITY_MIN = 30 // D13
const FEE_RATE = 0.0156
const ASK_LO = 0.02
const ASK_HI = 0.995
// Parser-consistency gate constants: CAL-001's published discovery-log
// totals (CALIBRATION.md Results).
const EXPECT_TOTAL_LINES = 104776
const EXPECT_PER_SIDE = 52388
const NEXT_BOUND: Record<number, number> = { 30: 150, 150: 300, 300: 450, 450: 600, 600: 750, 750: 850, 850: 900 }
const SUBWINDOWS: Array<[string, number, number]> = [
  ['W1(→Dec)', 0, Date.UTC(2026, 0, 1)],
  ['W2(Jan)', Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)],
  ['W3(Feb)', Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
]

const LINE_RE =
  /^\[diag-calib\] slug=(\S+) epoch=(\d+) asset=(UP|DOWN) off=(\d+) ts=([\d.]+) bid=([\d.]+) ask=([\d.]+)\s*$/

function moveBucketIndex(move: number): number {
  for (let i = 0; i < MOVE_BUCKETS.length; i++) {
    const b = MOVE_BUCKETS[i]
    const aboveLo = b.loInc ? move >= b.lo : move > b.lo
    const belowHi = b.hiInc ? move <= b.hi : move < b.hi
    if (aboveLo && belowHi) return i
  }
  return -1 // unreachable: buckets partition the reals
}

type Sample = { ts: number; bid: number; ask: number }

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
  const path = argv[0]
  if (!path) {
    console.error('usage: npx tsx fable-lab/tools/calib2.ts <diag-calib log file> [--outcomes <json>]')
    process.exit(1)
  }
  const synthetic = outcomesPath !== undefined
  if (synthetic && !path.includes('synthetic')) {
    console.error('REFUSED: --outcomes is only for synthetic fixtures (log path must contain "synthetic")')
    process.exit(1)
  }

  // Parse with calib.ts's exact validity pipeline.
  const seen = new Set<string>()
  const valid = new Map<string, Map<Side, Map<number, Sample>>>() // slug -> side -> off -> sample
  const epochMsBySlug = new Map<string, number>()
  let rawLines = 0
  const rawPerSide: Record<Side, number> = { UP: 0, DOWN: 0 }
  let skippedDrift = 0
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const [, slug, epochStr, side, offStr, tsStr, bidStr, askStr] = m
    const off = Number(offStr)
    if (!(OFFSETS as readonly number[]).includes(off)) continue
    rawLines++
    rawPerSide[side as Side]++
    const key = `${slug}|${side}|${off}`
    if (seen.has(key)) continue
    seen.add(key)
    const ts = Number(tsStr)
    if (ts >= NEXT_BOUND[off]) {
      skippedDrift++
      continue
    }
    epochMsBySlug.set(slug, Number(epochStr) * 1000)
    if (!valid.has(slug)) valid.set(slug, new Map([['UP', new Map()], ['DOWN', new Map()]]))
    valid.get(slug)!.get(side as Side)!.set(off, { ts, bid: Number(bidStr), ask: Number(askStr) })
  }

  // Gate 1 — parser consistency vs CAL-001's published totals (real log only).
  if (synthetic) {
    console.log('gate parser-consistency: SKIPPED (synthetic fixture)')
  } else if (rawLines !== EXPECT_TOTAL_LINES || rawPerSide.UP !== EXPECT_PER_SIDE || rawPerSide.DOWN !== EXPECT_PER_SIDE) {
    console.error(
      `ABORT — parser-consistency gate failed: lines=${rawLines} (expect ${EXPECT_TOTAL_LINES}), ` +
        `UP=${rawPerSide.UP} DOWN=${rawPerSide.DOWN} (expect ${EXPECT_PER_SIDE} each). ` +
        `Fix the tool against the synthetic fixture, never against the real log.`,
    )
    process.exit(2)
  } else {
    console.log(
      `gate parser-consistency: OK (lines=${rawLines}, UP=${rawPerSide.UP}, DOWN=${rawPerSide.DOWN})`,
    )
  }
  console.log(`parsed ${valid.size} markets with any valid sample (${skippedDrift} drift-discarded lines)`)

  // Derive conditional observations.
  type Obs = { slug: string; epochMs: number; pi: number; bi: number; side: Side; ask: number }
  const obs: Obs[] = []
  let skippedBand = 0
  for (const [slug, sides] of valid) {
    const up = sides.get('UP')!
    for (let pi = 0; pi < PAIRS.length; pi++) {
      const [t1, t2] = PAIRS[pi]
      const s1 = up.get(t1)
      const s2 = up.get(t2)
      if (!s1 || !s2) continue
      const move = (s2.bid + s2.ask) / 2 - (s1.bid + s1.ask) / 2
      const bi = moveBucketIndex(move)
      for (const side of SIDES) {
        const entry = sides.get(side)!.get(t2)
        if (!entry) continue
        if (entry.ask < ASK_LO || entry.ask > ASK_HI) {
          skippedBand++
          continue
        }
        obs.push({ slug, epochMs: epochMsBySlug.get(slug)!, pi, bi, side, ask: entry.ask })
      }
    }
  }
  console.log(`derived ${obs.length} conditional entries (${skippedBand} dropped: entry ask outside [${ASK_LO},${ASK_HI}])`)
  // Per-pair coverage (amendment-#11 logic): cells condition on both
  // offsets having valid book events.
  for (const side of SIDES) {
    const cov = PAIRS.map((_, pi) => new Set(obs.filter((o) => o.pi === pi && o.side === side).map((o) => o.slug)).size)
    console.log(`per-pair market coverage ${side}: ` + PAIRS.map(([a, b], pi) => `p${a}-${b}=${cov[pi]}`).join(' '))
  }

  // Outcome join.
  const upWon = new Map<string, boolean>()
  const slugs = [...new Set(obs.map((o) => o.slug))]
  if (synthetic) {
    const json = JSON.parse(readFileSync(outcomesPath!, 'utf8')) as Record<string, string>
    for (const [slug, r] of Object.entries(json)) {
      if (r === '0') upWon.set(slug, true)
      else if (r === '1') upWon.set(slug, false)
    }
  } else {
    const { getMarketsBySlugs } = await import('../../src/db/telonexMarkets.js')
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
  const unresolved = slugs.filter((s) => !upWon.has(s))
  console.log(`outcome joined for ${slugs.length - unresolved.length}/${slugs.length} markets (${unresolved.length} missing/unresolved — excluded)`)
  const won = (slug: string, side: Side): boolean | undefined => {
    const u = upWon.get(slug)
    if (u === undefined) return undefined
    return side === 'UP' ? u : !u
  }

  type Cell = { n: number; sumAsk: number; wins: number; sumVar: number; obs: Obs[] }
  const mkCell = (): Cell => ({ n: 0, sumAsk: 0, wins: 0, sumVar: 0, obs: [] })
  const grids: Record<Side, Cell[][]> = {
    UP: PAIRS.map(() => MOVE_BUCKETS.map(mkCell)),
    DOWN: PAIRS.map(() => MOVE_BUCKETS.map(mkCell)),
  }
  for (const o of obs) {
    const w = won(o.slug, o.side)
    if (w === undefined) continue
    const c = grids[o.side][o.pi][o.bi]
    c.n++
    c.sumAsk += o.ask
    c.wins += w ? 1 : 0
    c.sumVar += o.ask * (1 - o.ask)
    c.obs.push(o)
  }

  const statOf = (xs: Array<{ ask: number; win: boolean }>) => {
    const n = xs.length
    if (n === 0) return null
    let sumAsk = 0
    let wins = 0
    let sumVar = 0
    for (const x of xs) {
      sumAsk += x.ask
      wins += x.win ? 1 : 0
      sumVar += x.ask * (1 - x.ask)
    }
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
  const cellStat = (side: Side, pi: number, bi: number) =>
    statOf(grids[side][pi][bi].obs.map((o) => ({ ask: o.ask, win: won(o.slug, side)! })))

  // Gates 2 + 3 — pooled over move buckets on pair (750,850), per side.
  const piLast = PAIRS.length - 1
  for (const side of SIDES) {
    const pooled = obs
      .filter((o) => o.pi === piLast && o.side === side && won(o.slug, side) !== undefined)
      .map((o) => ({ ask: o.ask, win: won(o.slug, side)! }))
    const tail = statOf(pooled.filter((x) => x.ask >= 0.98 && x.ask <= 0.995))
    if (!tail || tail.n < 30 || tail.winRate <= 0.9) {
      console.error(
        `ABORT — join-direction gate failed (${side}): pooled (750,850) ask∈[0.98,0.995] = ` +
          (tail ? `n=${tail.n} winRate=${tail.winRate.toFixed(4)}` : 'empty') +
          ` (need n≥30 and winRate>0.9). Suspect result_id join.`,
      )
      process.exit(2)
    }
    const ctl = statOf(pooled.filter((x) => x.ask >= 0.9 && x.ask < 0.98))
    if (ctl && Math.abs(ctl.z) >= Z_BAR) {
      console.error(
        `ABORT — E14-analog control gate failed (${side}): pooled (750,850) ask∈[0.90,0.98) ` +
          `d=${ctl.d.toFixed(4)} z=${ctl.z.toFixed(2)} n=${ctl.n}. Instrument suspect; do not read the table.`,
      )
      process.exit(2)
    }
    console.log(
      `gates ${side}: join-direction OK (pooled 750-850 tail winRate=${tail.winRate.toFixed(4)}, n=${tail.n}); ` +
        `E14-analog control OK ` +
        (ctl ? `(net=${ctl.net.toFixed(4)} z=${ctl.z.toFixed(2)} n=${ctl.n})` : '(empty)'),
    )
  }

  const subwindowD = (side: Side, pi: number, bi: number): Array<[string, number, number]> =>
    SUBWINDOWS.map(([label, lo, hi]) => {
      const xs = grids[side][pi][bi].obs.filter((o) => o.epochMs >= lo && o.epochMs < hi)
      if (xs.length === 0) return [label, 0, NaN] as [string, number, number]
      let wins = 0
      let sumAsk = 0
      for (const o of xs) {
        wins += won(o.slug, side) ? 1 : 0
        sumAsk += o.ask
      }
      return [label, xs.length, wins / xs.length - sumAsk / xs.length] as [string, number, number]
    })

  const candidates: string[] = []
  const negFlags: string[] = []
  for (const side of SIDES) {
    console.log(
      `\nCAL-002 ${side}-side cell table (k=${K} total, candidate bar z>=${Z_BAR}, minority>=${MINORITY_MIN}, ` +
        `fee=winRate*${FEE_RATE}*min(a,1-a)/a, sub-window consistency required)`,
    )
    console.log('pair     bucket     n     meanAsk winRate      d     fee     net      se      z  minor  flag')
    for (let pi = 0; pi < PAIRS.length; pi++) {
      for (let bi = 0; bi < MOVE_BUCKETS.length; bi++) {
        const s = cellStat(side, pi, bi)
        const pairLabel = `${PAIRS[pi][0]}-${PAIRS[pi][1]}`
        const label = MOVE_BUCKETS[bi].name
        if (!s) {
          console.log(`${pairLabel.padEnd(8)} ${label.padEnd(5)} empty`)
          continue
        }
        let flag = ''
        if (s.net > 0 && s.z >= Z_BAR && s.minority >= MINORITY_MIN) {
          const sw = subwindowD(side, pi, bi)
          const consistent = sw.every(([, n, d]) => n > 0 && d > 0)
          const swStr = sw.map(([l, n, d]) => `${l}:n=${n},d=${Number.isNaN(d) ? 'na' : d.toFixed(4)}`).join(' ')
          if (consistent) {
            flag = 'CANDIDATE'
            candidates.push(`${side} (${pairLabel}, ${label}) [${swStr}]`)
          } else {
            flag = 'CANDIDATE-demoted(subwindow-inconsistent)'
            negFlags.push(`demoted ${side} (${pairLabel}, ${label}) [${swStr}]`)
          }
        } else if (s.z <= -Z_BAR) {
          flag = s.minority >= MINORITY_MIN ? 'NEG-FLAG' : 'NEG-FLAG(underpowered-E14)'
          negFlags.push(`${side} (${pairLabel}, ${label}) ${flag}`)
        }
        console.log(
          `${pairLabel.padEnd(8)} ${label.padEnd(5)}` +
            `${String(s.n).padStart(6)}  ${s.meanAsk.toFixed(4)}  ${s.winRate.toFixed(4)} ` +
            `${s.d >= 0 ? '+' : ''}${s.d.toFixed(4)} ${s.fee.toFixed(4)} ` +
            `${s.net >= 0 ? '+' : ''}${s.net.toFixed(4)} ${s.se.toFixed(4)} ` +
            `${s.z >= 0 ? '+' : ''}${s.z.toFixed(2).padStart(6)} ${String(s.minority).padStart(6)}  ${flag}`,
        )
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
