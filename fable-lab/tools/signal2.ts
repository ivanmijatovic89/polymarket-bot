/**
 * signal2.ts — SIGNAL-002 cross-episode conditioning scan
 * (knowledge/SIGNAL-CROSS-EPISODE.md, session 60). Reads [diag-signal]
 * lines from the SIGNAL-001 shard logs, joins telonex_markets.result_id
 * ONCE for current markets AND their lag-1..3 predecessors, and evaluates
 * the frozen statistics:
 *
 *   1. POOLED prevAgree CONTRAST (primary): per (offset, side),
 *      Δ = mean r(agree) − mean r(disagree), Welch z. k=10, bar 3.30.
 *   2. STRATUM CONTRASTS: same within LO/MID/HI, arms n ≥ 30. k=30,
 *      bar 3.60.
 *   3. STREAK CELLS: mean residual per signed streak bucket
 *      {+1,+2,+3p,−1,−2,−3p}, n ≥ 30, scan-se convention. k=60, bar 3.80.
 *
 * WARM at |z| ≥ 3 everywhere (recorded, not candidate).
 *
 * Gates (abort exit 2, no table): G1 join-direction (ask ≥ 0.90 must win
 * > 75% per side, n ≥ 30), G2 global fairness (per side |z| < 6),
 * G3 chain coverage (lag-1 determinable ≥ 0.95 of valid samples).
 *
 * Interpretation is frozen in SIGNAL-CROSS-EPISODE.md — everything here
 * is map-grade (hypothesis-generating, gross, uncitable).
 *
 * Usage: npx tsx fable-lab/tools/signal2.ts <log> [<log> ...]
 *        npx tsx fable-lab/tools/signal2.ts <...synthetic...> --outcomes <json>
 * --outcomes ({slug:'0'|'1'}) is ONLY for the committed selftest; refused
 * unless every log path contains "synthetic" (calib.ts precedent).
 */
import { readFileSync } from 'node:fs'
import '../../src/config/env.js'
import { getMarketsBySlugs } from '../../src/db/telonexMarkets.js'
import { closeDb } from '../../src/db/index.js'

const OFFSETS = [150, 300, 600, 750, 850] as const
const NEXT_BOUND: Record<number, number> = { 150: 300, 300: 600, 600: 750, 750: 850, 850: 900 }
type Side = 'UP' | 'DOWN'
const SIDES: Side[] = ['UP', 'DOWN']
const STRATA = ['LO', 'MID', 'HI'] as const
type Stratum = (typeof STRATA)[number]
const BUCKETS = ['+1', '+2', '+3p', '-1', '-2', '-3p'] as const
type Bucket = (typeof BUCKETS)[number]
const POOLED_BAR = 3.3
const STRATUM_BAR = 3.6
const STREAK_BAR = 3.8
const WARM_BAR = 3.0
const MIN_ARM_N = 30
const ASK_MIN = 0.02
const ASK_MAX = 0.98
const G3_MIN_CHAIN_COVERAGE = 0.95

const stratumOf = (ask: number): Stratum => (ask < 0.35 ? 'LO' : ask <= 0.65 ? 'MID' : 'HI')

// Same line shape as signal-scan.ts; only slug/epoch/off/ts/asks are used
// here, the 16 features are matched (so malformed counting is identical)
// but ignored.
const FEATURES = [
  'l1Imb', 'l5Imb', 'l10Imb', 'dTot5', 'dTot10', 'nTicks', 'rate60', 'vol',
  'nz', 'flips', 'range', 'posR', 'move60', 'firstMid', 'firstTs', 'crossedN',
] as const
const LINE_RE = new RegExp(
  '^\\[diag-signal\\] slug=(\\S+) epoch=(\\d+) off=(\\d+) ts=([\\d.]+) ' +
    'upBid=([\\d.-]+) upAsk=([\\d.-]+) dnBid=([\\d.-]+) dnAsk=([\\d.-]+) ' +
    FEATURES.map((f) => `${f}=([\\d.eE+-]+)`).join(' ') +
    '$',
)

function meanSd(xs: number[]): { mean: number; sd: number } {
  const n = xs.length
  let s = 0
  for (const x of xs) s += x
  const mean = s / n
  let m2 = 0
  for (const x of xs) m2 += (x - mean) * (x - mean)
  return { mean, sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0 }
}

interface Sample {
  slug: string
  off: number
  side: Side
  ask: number
  r: number // won − ask
  stratum: Stratum
  agree: 0 | 1 | null // null = lag-1 indeterminable
  bucket: Bucket | null // null = streak indeterminable
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const outIdx = argv.indexOf('--outcomes')
  let outcomesPath: string | undefined
  if (outIdx !== -1) {
    outcomesPath = argv[outIdx + 1]
    if (!outcomesPath) { console.error('--outcomes requires a value'); process.exit(1) }
    argv.splice(outIdx, 2)
  }
  const logPaths = argv
  if (logPaths.length === 0) {
    console.error('usage: npx tsx fable-lab/tools/signal2.ts <log> [<log>...] [--outcomes <json>]')
    process.exit(1)
  }
  const synthetic = outcomesPath !== undefined
  if (synthetic && !logPaths.every((p) => p.includes('synthetic'))) {
    console.error('REFUSED: --outcomes is only for synthetic fixtures (every log path must contain "synthetic")')
    process.exit(1)
  }

  // ---- parse + dedupe + drift filter (signal-scan semantics) ----
  const seen = new Set<string>()
  const parsed: { slug: string; epochSec: number; off: number; upAsk: number; dnAsk: number }[] = []
  let malformed = 0
  let skippedDrift = 0
  for (const path of logPaths) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.startsWith('[diag-signal] ')) continue
      const m = LINE_RE.exec(line)
      if (!m) { malformed++; continue }
      const off = Number(m[3])
      if (!(OFFSETS as readonly number[]).includes(off)) continue
      const key = `${m[1]}|${off}`
      if (seen.has(key)) continue
      seen.add(key)
      if (Number(m[4]) >= NEXT_BOUND[off]) { skippedDrift++; continue }
      parsed.push({ slug: m[1], epochSec: Number(m[2]), off, upAsk: Number(m[6]), dnAsk: Number(m[8]) })
    }
  }
  const slugs = [...new Set(parsed.map((p) => p.slug))]
  console.log(`parsed ${parsed.length} deduped (slug,off) rows across ${slugs.length} markets (${malformed} malformed, ${skippedDrift} drift-discarded)`)

  // ---- outcome join (ONCE): current + lag-1..3 predecessor slugs ----
  const epochs = [...new Set(parsed.map((p) => p.epochSec))]
  const wantSlugs = new Set<string>(slugs)
  for (const e of epochs) {
    for (const lag of [1, 2, 3]) wantSlugs.add(`btc-updown-15m-${e - 900 * lag}`)
  }
  const upWonBySlug = new Map<string, boolean>()
  if (synthetic) {
    const json = JSON.parse(readFileSync(outcomesPath!, 'utf8')) as Record<string, string>
    for (const [slug, r] of Object.entries(json)) {
      if (r === '0') upWonBySlug.set(slug, true)
      else if (r === '1') upWonBySlug.set(slug, false)
    }
  } else {
    const all = [...wantSlugs]
    for (let i = 0; i < all.length; i += 500) {
      const rows = await getMarketsBySlugs(all.slice(i, i + 500), {
        converter: 'delta-typed',
        readFrom: 'local-or-download-from-r2-to-local',
      })
      for (const r of rows) {
        if (r.resultId === '0') upWonBySlug.set(r.slug, true)
        else if (r.resultId === '1') upWonBySlug.set(r.slug, false)
      }
    }
  }
  const dirAt = (epochSec: number): Side | undefined => {
    const w = upWonBySlug.get(`btc-updown-15m-${epochSec}`)
    return w === undefined ? undefined : w ? 'UP' : 'DOWN'
  }

  // ---- build samples ----
  const samples: Sample[] = []
  let unresolvedCur = 0
  let askOut = 0
  for (const p of parsed) {
    const upWon = upWonBySlug.get(p.slug)
    if (upWon === undefined) { unresolvedCur++; continue }
    const o1 = dirAt(p.epochSec - 900)
    const o2 = dirAt(p.epochSec - 1800)
    const o3 = dirAt(p.epochSec - 2700)
    // run length ending at lag-1, capped at 3; null when indeterminable
    let runLen: 1 | 2 | 3 | null = null
    if (o1 !== undefined) {
      if (o2 === undefined) runLen = null
      else if (o2 !== o1) runLen = 1
      else if (o3 === undefined) runLen = null
      else if (o3 !== o1) runLen = 2
      else runLen = 3
    }
    for (const side of SIDES) {
      const ask = side === 'UP' ? p.upAsk : p.dnAsk
      if (!(ask >= ASK_MIN && ask <= ASK_MAX)) { askOut++; continue }
      const won = side === 'UP' ? (upWon ? 1 : 0) : upWon ? 0 : 1
      const agree: 0 | 1 | null = o1 === undefined ? null : o1 === side ? 1 : 0
      let bucket: Bucket | null = null
      if (o1 !== undefined && runLen !== null) {
        const mag = runLen === 3 ? '3p' : String(runLen)
        bucket = `${o1 === side ? '+' : '-'}${mag}` as Bucket
      }
      samples.push({ slug: p.slug, off: p.off, side, ask, r: won - ask, stratum: stratumOf(ask), agree, bucket })
    }
  }
  const chainKnown = samples.filter((s) => s.agree !== null).length
  const streakKnown = samples.filter((s) => s.bucket !== null).length
  console.log(
    `samples valid=${samples.length} (unresolved-current rows=${unresolvedCur}, ask-out-of-range=${askOut}); ` +
      `lag1-determinable=${chainKnown} (${(chainKnown / Math.max(1, samples.length)).toFixed(4)}), ` +
      `streak-determinable=${streakKnown} (${(streakKnown / Math.max(1, samples.length)).toFixed(4)})`,
  )

  // ---- gates ----
  for (const side of SIDES) {
    const hi = samples.filter((s) => s.side === side && s.ask >= 0.9)
    if (hi.length >= 30) {
      // r = won − ask with ask ∈ [0.02,0.98] ⇒ r > 0 iff won
      const wr = hi.filter((s) => s.r > 0).length / hi.length
      console.log(`G1 join-direction ${side}: n=${hi.length} winRate=${wr.toFixed(4)}`)
      if (wr <= 0.75) { console.error(`GATE G1 FAILED (${side}): flipped/broken outcome join`); await closeDb(); process.exit(2) }
    } else {
      console.log(`G1 join-direction ${side}: n=${hi.length} < 30 — insufficient high-ask samples, gate not evaluable`)
    }
  }
  for (const side of SIDES) {
    const rs = samples.filter((s) => s.side === side).map((s) => s.r)
    const { mean, sd } = meanSd(rs)
    const z = sd > 0 ? mean / (sd / Math.sqrt(rs.length)) : 0
    console.log(`G2 global fairness ${side}: n=${rs.length} mean=${mean.toFixed(5)} z=${z.toFixed(2)}`)
    if (Math.abs(z) >= 6) { console.error(`GATE G2 FAILED (${side}): global residual |z| >= 6 — parse/join bug`); await closeDb(); process.exit(2) }
  }
  const g3 = chainKnown / Math.max(1, samples.length)
  if (g3 < G3_MIN_CHAIN_COVERAGE) {
    console.error(`GATE G3 FAILED: lag-1 chain coverage ${g3.toFixed(4)} < ${G3_MIN_CHAIN_COVERAGE} — join bug, not physics`)
    await closeDb()
    process.exit(2)
  }
  console.log(`G3 chain coverage: ${g3.toFixed(4)} >= ${G3_MIN_CHAIN_COVERAGE}`)

  const flag = (z: number, bar: number): string =>
    Math.abs(z) >= bar ? '  << CANDIDATE' : Math.abs(z) >= WARM_BAR ? '  << warm' : ''

  // ---- family 1: pooled prevAgree contrast ----
  console.log(`\n== family 1: pooled prevAgree contrast (k=10, bar ${POOLED_BAR}) ==`)
  let cand1 = 0
  let warm1 = 0
  const contrast = (xs: Sample[]): { d: number; z: number; n1: number; n0: number } | null => {
    const a1 = xs.filter((s) => s.agree === 1).map((s) => s.r)
    const a0 = xs.filter((s) => s.agree === 0).map((s) => s.r)
    if (a1.length < MIN_ARM_N || a0.length < MIN_ARM_N) return null
    const m1 = meanSd(a1)
    const m0 = meanSd(a0)
    const se = Math.sqrt((m1.sd * m1.sd) / a1.length + (m0.sd * m0.sd) / a0.length)
    const d = m1.mean - m0.mean
    return { d, z: se > 0 ? d / se : 0, n1: a1.length, n0: a0.length }
  }
  for (const off of OFFSETS) {
    for (const side of SIDES) {
      const c = contrast(samples.filter((s) => s.off === off && s.side === side))
      if (!c) { console.log(`o${off} ${side}: n<min — na`); continue }
      if (Math.abs(c.z) >= POOLED_BAR) cand1++
      else if (Math.abs(c.z) >= WARM_BAR) warm1++
      console.log(`o${off} ${side}: d=${c.d.toFixed(5)} z=${c.z.toFixed(2)} n1=${c.n1} n0=${c.n0}${flag(c.z, POOLED_BAR)}`)
    }
  }
  console.log(`family1 candidates=${cand1} warm=${warm1}`)

  // ---- family 2: stratum contrasts ----
  console.log(`\n== family 2: stratum contrasts (k=30, bar ${STRATUM_BAR}) ==`)
  let cand2 = 0
  let warm2 = 0
  for (const off of OFFSETS) {
    for (const side of SIDES) {
      for (const st of STRATA) {
        const c = contrast(samples.filter((s) => s.off === off && s.side === side && s.stratum === st))
        if (!c) { console.log(`o${off} ${side} ${st}: n<min — na`); continue }
        if (Math.abs(c.z) >= STRATUM_BAR) cand2++
        else if (Math.abs(c.z) >= WARM_BAR) warm2++
        console.log(`o${off} ${side} ${st}: d=${c.d.toFixed(5)} z=${c.z.toFixed(2)} n1=${c.n1} n0=${c.n0}${flag(c.z, STRATUM_BAR)}`)
      }
    }
  }
  console.log(`family2 candidates=${cand2} warm=${warm2}`)

  // ---- family 3: streak cells ----
  console.log(`\n== family 3: streak cells (k=60, bar ${STREAK_BAR}) ==`)
  let cand3 = 0
  let warm3 = 0
  for (const off of OFFSETS) {
    for (const side of SIDES) {
      for (const b of BUCKETS) {
        const xs = samples.filter((s) => s.off === off && s.side === side && s.bucket === b).map((s) => s.r)
        if (xs.length < MIN_ARM_N) { console.log(`o${off} ${side} ${b}: n=${xs.length} — na`); continue }
        const { mean, sd } = meanSd(xs)
        const z = sd > 0 ? mean / (sd / Math.sqrt(xs.length)) : 0
        if (Math.abs(z) >= STREAK_BAR) cand3++
        else if (Math.abs(z) >= WARM_BAR) warm3++
        console.log(`o${off} ${side} ${b}: d=${mean.toFixed(5)} z=${z.toFixed(2)} n=${xs.length}${flag(z, STREAK_BAR)}`)
      }
    }
  }
  console.log(`family3 candidates=${cand3} warm=${warm3}`)

  console.log(`\nSUMMARY: candidates f1=${cand1} f2=${cand2} f3=${cand3} | warm f1=${warm1} f2=${warm2} f3=${warm3}`)
  await closeDb()
}

await main()
