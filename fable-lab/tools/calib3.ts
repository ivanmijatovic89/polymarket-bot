/**
 * calib3.ts — CAL-003 one-shot analysis (knowledge/CALIBRATION-3.md, D26).
 *
 * Usage:
 *   npx tsx fable-lab/tools/calib3.ts <diag-calib log file>
 *   npx tsx fable-lab/tools/calib3.ts <...synthetic... log> --outcomes <json>
 *   npx tsx fable-lab/tools/calib3.ts <reserve log> --expect-totals <lines>,<perSide>
 *
 * Parses the SAME [diag-calib] line grammar as calib.ts, applies the same
 * validity pipeline (first-occurrence dedupe, drift filter ts < next
 * offset), then derives the frozen TWO-SEGMENT path grid: for each triple
 * of consecutive offsets (t0,t1,t2) the UP-mid segments
 * s1 = mid(t1)−mid(t0) and s2 = mid(t2)−mid(t1) are each classified
 * dn (≤ −0.02) / up (≥ +0.02) / mid (otherwise); entries with a mid
 * segment are counted and EXCLUDED (CALIBRATION-3.md instrument section).
 * Entry is buy-UP / buy-DOWN at that side's ask(t2) within [0.02,0.995].
 * k = 5 triples × 4 shapes × 2 sides = 40 cells, candidate bar z ≥ 3.26
 * (one-sided tail ≤ 0.023/40), minority ≥ 30, sub-window consistency —
 * all frozen in CALIBRATION-3.md (+ pre-read amendments).
 *
 * Gate-reproduction (CALIBRATION-3.md gate 2): the join-direction and
 * E14-analog pools are derived EXACTLY as calib2.ts derived them (pair
 * (750,850) conditioned, NOT triple-conditioned); in discovery mode their
 * printed values must equal CAL-002's published gate values exactly —
 * any mismatch is derivation drift between tools and ABORTS.
 *
 * --expect-totals is the RESERVE-read mode (CAL-002 amendment #1
 * semantics, built in from registration): the parser-consistency gate
 * checks the reserve run's own outcome-free D23 battery totals, candidate
 * flagging drops the sub-window requirement, and gate 2 falls back to
 * CAL-002's threshold gates. Refused on paths containing
 * "CAL-001-discovery" so it can never relax the discovery read.
 *
 * --outcomes <json> ({slug: '0'|'1'}) exists ONLY for the committed
 * synthetic fixture: refused unless the log path contains "synthetic".
 *
 * Changing a bucket, threshold, or gate after registration is a protocol
 * breach (honor-system + git audit trail).
 */
import { readFileSync } from 'node:fs'

const OFFSETS = [30, 150, 300, 450, 600, 750, 850] as const
const TRIPLES: Array<[number, number, number]> = [
  [30, 150, 300],
  [150, 300, 450],
  [300, 450, 600],
  [450, 600, 750],
  [600, 750, 850],
]
// Per-segment sign class, same ±0.02 edges as CAL-002's big-move buckets.
type Seg = 'dn' | 'mid' | 'up'
function segClass(move: number): Seg {
  if (move <= -0.02) return 'dn'
  if (move >= 0.02) return 'up'
  return 'mid'
}
const SHAPES: Array<[Seg, Seg]> = [
  ['dn', 'dn'],
  ['dn', 'up'],
  ['up', 'dn'],
  ['up', 'up'],
]
const shapeName = (s: [Seg, Seg]) => `${s[0]}-${s[1]}`
const SIDES = ['UP', 'DOWN'] as const
type Side = (typeof SIDES)[number]
const K = TRIPLES.length * SHAPES.length * SIDES.length // 40
// Amendment #1 (pre-read audit): 3.26, not 3.25 — tail(3.26) ≈ 5.57e-4 ≤
// 0.023/40 = 5.75e-4 (tail(3.25) ≈ 5.77e-4 would be anti-conservative).
const Z_BAR = 3.26
const MINORITY_MIN = 30 // D13
const FEE_RATE = 0.0156
const ASK_LO = 0.02
const ASK_HI = 0.995
// Parser-consistency gate constants: CAL-001's published discovery-log totals.
const EXPECT_TOTAL_LINES = 104776
const EXPECT_PER_SIDE = 52388
// Gate-reproduction constants (CALIBRATION-3.md gate 2): CAL-002's
// published gate printouts on the discovery log. Derivation drift → ABORT.
const GATE_EXPECT: Record<Side, { tailWr: string; tailN: number; ctlZ: string; ctlN: number }> = {
  UP: { tailWr: '0.9869', tailN: 686, ctlZ: '-1.03', ctlN: 519 },
  DOWN: { tailWr: '0.9777', tailN: 719, ctlZ: '-0.59', ctlN: 516 },
}
const NEXT_BOUND: Record<number, number> = { 30: 150, 150: 300, 300: 450, 450: 600, 600: 750, 750: 850, 850: 900 }
const SUBWINDOWS: Array<[string, number, number]> = [
  ['W1(→Dec)', 0, Date.UTC(2026, 0, 1)],
  ['W2(Jan)', Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)],
  ['W3(Feb)', Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
]

const LINE_RE =
  /^\[diag-calib\] slug=(\S+) epoch=(\d+) asset=(UP|DOWN) off=(\d+) ts=([\d.]+) bid=([\d.]+) ask=([\d.]+)\s*$/

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
  const etIdx = argv.indexOf('--expect-totals')
  let expectTotals: { lines: number; perSide: number } | undefined
  if (etIdx !== -1) {
    const v = argv[etIdx + 1]
    const m = /^(\d+),(\d+)$/.exec(v ?? '')
    if (!m) {
      console.error('--expect-totals requires <lines>,<perSide>')
      process.exit(1)
    }
    expectTotals = { lines: Number(m[1]), perSide: Number(m[2]) }
    argv.splice(etIdx, 2)
  }
  const path = argv[0]
  if (!path) {
    console.error('usage: npx tsx fable-lab/tools/calib3.ts <log> [--outcomes <json>] [--expect-totals <lines>,<perSide>]')
    process.exit(1)
  }
  const synthetic = outcomesPath !== undefined
  if (synthetic && !path.includes('synthetic')) {
    console.error('REFUSED: --outcomes is only for synthetic fixtures (log path must contain "synthetic")')
    process.exit(1)
  }
  const reserveMode = expectTotals !== undefined
  if (reserveMode && path.includes('CAL-001-discovery')) {
    console.error('REFUSED: --expect-totals is the reserve-read mode; it cannot be used on the discovery log')
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

  // Gate 1 — parser consistency.
  const expLines = expectTotals?.lines ?? EXPECT_TOTAL_LINES
  const expSide = expectTotals?.perSide ?? EXPECT_PER_SIDE
  if (synthetic) {
    console.log('gate parser-consistency: SKIPPED (synthetic fixture)')
  } else if (rawLines !== expLines || rawPerSide.UP !== expSide || rawPerSide.DOWN !== expSide) {
    console.error(
      `ABORT — parser-consistency gate failed: lines=${rawLines} (expect ${expLines}), ` +
        `UP=${rawPerSide.UP} DOWN=${rawPerSide.DOWN} (expect ${expSide} each). ` +
        `Fix the tool against the synthetic fixture, never against the real log.`,
    )
    process.exit(2)
  } else {
    console.log(
      `gate parser-consistency: OK (lines=${rawLines}, UP=${rawPerSide.UP}, DOWN=${rawPerSide.DOWN}` +
        (reserveMode ? ', reserve-read mode: sub-window flag disabled' : '') +
        `)`,
    )
  }
  console.log(`parsed ${valid.size} markets with any valid sample (${skippedDrift} drift-discarded lines)`)

  // Derive two-segment path observations.
  type Obs = { slug: string; epochMs: number; ti: number; si: number; side: Side; ask: number }
  const obs: Obs[] = []
  let skippedBand = 0
  let skippedMid = 0
  // Coverage: unique slugs per (triple, side) with all three UP offsets
  // valid + side entry valid + in band, BEFORE the shape selection.
  const coverage: Record<Side, Array<Set<string>>> = {
    UP: TRIPLES.map(() => new Set()),
    DOWN: TRIPLES.map(() => new Set()),
  }
  for (const [slug, sides] of valid) {
    const up = sides.get('UP')!
    for (let ti = 0; ti < TRIPLES.length; ti++) {
      const [t0, t1, t2] = TRIPLES[ti]
      const s0 = up.get(t0)
      const s1 = up.get(t1)
      const s2 = up.get(t2)
      if (!s0 || !s1 || !s2) continue
      const m0 = (s0.bid + s0.ask) / 2
      const m1 = (s1.bid + s1.ask) / 2
      const m2 = (s2.bid + s2.ask) / 2
      const c1 = segClass(m1 - m0)
      const c2 = segClass(m2 - m1)
      const si = SHAPES.findIndex((s) => s[0] === c1 && s[1] === c2) // -1 when a segment is mid
      for (const side of SIDES) {
        const entry = sides.get(side)!.get(t2)
        if (!entry) continue
        if (entry.ask < ASK_LO || entry.ask > ASK_HI) {
          skippedBand++
          continue
        }
        coverage[side][ti].add(slug)
        if (si === -1) {
          skippedMid++
          continue
        }
        obs.push({ slug, epochMs: epochMsBySlug.get(slug)!, ti, si, side, ask: entry.ask })
      }
    }
  }
  console.log(
    `derived ${obs.length} path entries (${skippedBand} dropped: entry ask outside [${ASK_LO},${ASK_HI}]; ` +
      `${skippedMid} excluded: mid segment)`,
  )
  for (const side of SIDES) {
    console.log(
      `per-triple market coverage ${side} (pre-shape): ` +
        TRIPLES.map(([a, b, c], ti) => `t${a}-${b}-${c}=${coverage[side][ti].size}`).join(' '),
    )
  }

  // Outcome join.
  const upWon = new Map<string, boolean>()
  const slugs = [...new Set(obs.map((o) => o.slug))]
  // The gate pools (pair-conditioned) may include slugs outside `obs`; join
  // those too so the gates see the same outcome universe as calib2.ts did.
  const gateSlugs = new Set<string>()
  for (const [slug, sides] of valid) {
    const up = sides.get('UP')!
    if (up.get(750) && up.get(850)) gateSlugs.add(slug)
  }
  const allSlugs = [...new Set([...slugs, ...gateSlugs])]
  if (synthetic) {
    const json = JSON.parse(readFileSync(outcomesPath!, 'utf8')) as Record<string, string>
    for (const [slug, r] of Object.entries(json)) {
      if (r === '0') upWon.set(slug, true)
      else if (r === '1') upWon.set(slug, false)
    }
  } else {
    const { getMarketsBySlugs } = await import('../../src/db/telonexMarkets.js')
    for (let i = 0; i < allSlugs.length; i += 500) {
      const rows = await getMarketsBySlugs(allSlugs.slice(i, i + 500), {
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
  console.log(
    `outcome joined for ${slugs.length - unresolved.length}/${slugs.length} scan markets (${unresolved.length} missing/unresolved — excluded)`,
  )
  const won = (slug: string, side: Side): boolean | undefined => {
    const u = upWon.get(slug)
    if (u === undefined) return undefined
    return side === 'UP' ? u : !u
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

  // Gates 2 + 3 — pair (750,850) conditioned, EXACTLY as calib2.ts derived
  // them: valid UP lines at both offsets, side entry at 850 in band,
  // pooled over move buckets (i.e. no move/shape condition at all).
  for (const side of SIDES) {
    const pooled: Array<{ ask: number; win: boolean }> = []
    for (const slug of gateSlugs) {
      const entry = valid.get(slug)!.get(side)!.get(850)
      if (!entry) continue
      if (entry.ask < ASK_LO || entry.ask > ASK_HI) continue
      const w = won(slug, side)
      if (w === undefined) continue
      pooled.push({ ask: entry.ask, win: w })
    }
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
    if (!ctl && !synthetic) {
      console.error(
        `ABORT — E14-analog control gate failed (${side}): pooled (750,850) ask∈[0.90,0.98) is EMPTY ` +
          `on a real log (CAL-001 measured n≈520 here). Derivation suspect; do not read the table.`,
      )
      process.exit(2)
    }
    if (ctl && Math.abs(ctl.z) >= Z_BAR) {
      console.error(
        `ABORT — E14-analog control gate failed (${side}): pooled (750,850) ask∈[0.90,0.98) ` +
          `d=${ctl.d.toFixed(4)} z=${ctl.z.toFixed(2)} n=${ctl.n}. Instrument suspect; do not read the table.`,
      )
      process.exit(2)
    }
    // Gate-reproduction (discovery mode only): printed values must equal
    // CAL-002's published gate values exactly.
    if (!synthetic && !reserveMode) {
      const exp = GATE_EXPECT[side]
      const bad =
        tail.n !== exp.tailN ||
        tail.winRate.toFixed(4) !== exp.tailWr ||
        !ctl ||
        ctl.n !== exp.ctlN ||
        ctl.z.toFixed(2) !== exp.ctlZ
      if (bad) {
        console.error(
          `ABORT — gate-reproduction failed (${side}): got tail winRate=${tail.winRate.toFixed(4)} n=${tail.n}, ` +
            `ctl z=${ctl ? ctl.z.toFixed(2) : 'empty'} n=${ctl ? ctl.n : 0}; ` +
            `expected tail ${exp.tailWr}/${exp.tailN}, ctl ${exp.ctlZ}/${exp.ctlN} (CAL-002 published). ` +
            `Derivation drift between calib2.ts and calib3.ts — do not read the table.`,
        )
        process.exit(2)
      }
    }
    console.log(
      `gates ${side}: join-direction OK (pooled 750-850 tail winRate=${tail.winRate.toFixed(4)}, n=${tail.n}); ` +
        `E14-analog control OK ` +
        (ctl ? `(net=${ctl.net.toFixed(4)} z=${ctl.z.toFixed(2)} n=${ctl.n})` : '(empty)') +
        (!synthetic && !reserveMode ? '; gate-reproduction OK (matches CAL-002 published)' : ''),
    )
  }

  type Cell = { obs: Obs[] }
  const grids: Record<Side, Cell[][]> = {
    UP: TRIPLES.map(() => SHAPES.map(() => ({ obs: [] }))),
    DOWN: TRIPLES.map(() => SHAPES.map(() => ({ obs: [] }))),
  }
  for (const o of obs) {
    if (won(o.slug, o.side) === undefined) continue
    grids[o.side][o.ti][o.si].obs.push(o)
  }
  const cellStat = (side: Side, ti: number, si: number) =>
    statOf(grids[side][ti][si].obs.map((o) => ({ ask: o.ask, win: won(o.slug, side)! })))

  const subwindowD = (side: Side, ti: number, si: number): Array<[string, number, number]> =>
    SUBWINDOWS.map(([label, lo, hi]) => {
      const xs = grids[side][ti][si].obs.filter((o) => o.epochMs >= lo && o.epochMs < hi)
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
      `\nCAL-003 ${side}-side cell table (k=${K} total, candidate bar z>=${Z_BAR}, minority>=${MINORITY_MIN}, ` +
        `fee=winRate*${FEE_RATE}*min(a,1-a)/a, sub-window consistency required)`,
    )
    console.log('triple       shape      n     meanAsk winRate      d     fee     net      se      z  minor  flag')
    for (let ti = 0; ti < TRIPLES.length; ti++) {
      for (let si = 0; si < SHAPES.length; si++) {
        const s = cellStat(side, ti, si)
        const tripleLabel = TRIPLES[ti].join('-')
        const label = shapeName(SHAPES[si])
        if (!s) {
          console.log(`${tripleLabel.padEnd(12)} ${label.padEnd(6)} empty`)
          continue
        }
        let flag = ''
        if (s.net > 0 && s.z >= Z_BAR && s.minority >= MINORITY_MIN) {
          if (reserveMode) {
            flag = 'CANDIDATE(reserve)'
            candidates.push(`${side} (${tripleLabel}, ${label}) [reserve]`)
          } else {
            const sw = subwindowD(side, ti, si)
            const consistent = sw.every(([, n, d]) => n > 0 && d > 0)
            const swStr = sw.map(([l, n, d]) => `${l}:n=${n},d=${Number.isNaN(d) ? 'na' : d.toFixed(4)}`).join(' ')
            if (consistent) {
              flag = 'CANDIDATE'
              candidates.push(`${side} (${tripleLabel}, ${label}) [${swStr}]`)
            } else {
              flag = 'CANDIDATE-demoted(subwindow-inconsistent)'
              negFlags.push(`demoted ${side} (${tripleLabel}, ${label}) [${swStr}]`)
            }
          }
        } else if (s.z <= -Z_BAR) {
          flag = s.minority >= MINORITY_MIN ? 'NEG-FLAG' : 'NEG-FLAG(underpowered-E14)'
          negFlags.push(`${side} (${tripleLabel}, ${label}) ${flag}`)
        }
        console.log(
          `${tripleLabel.padEnd(12)} ${label.padEnd(6)}` +
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
