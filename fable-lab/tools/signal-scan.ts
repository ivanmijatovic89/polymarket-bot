/**
 * signal-scan.ts — SIGNAL-001 one-shot outcome join + frozen scan
 * (knowledge/SIGNAL-MAP.md, session 59). Reads [diag-signal] lines from one
 * or more shard logs, joins telonex_markets.result_id ONCE, and evaluates:
 *
 *   1. MONOTONE SCREEN (primary): per (offset, feature, side), Spearman
 *      rank-correlation between the feature and the residual (won − ask),
 *      computed within price strata (LO/MID/HI) with n ≥ 200 and combined
 *      Stouffer-weighted (w = √n). CANDIDATE at |z| ≥ 4.00 (k = 160,
 *      Bonferroni α ≈ 0.01), WARM at |z| ≥ 3.
 *   2. CELL GRID (shape readout): feature-quintile cells within
 *      (offset, stratum, side); d = mean(won − ask), scan-se convention
 *      (empirical sd of residual). Cell CANDIDATE at |z| ≥ 4.40 (k = 2,400).
 *   3. SEASONALITY: hour-of-day (6 four-hour bins, UTC) and day-of-week
 *      cells at offsets 300/750; same cell bar |z| ≥ 4.40.
 *
 * Interpretation is frozen in SIGNAL-MAP.md: ALL outputs are map-grade
 * (hypothesis-generating, gross of costs). A candidate zone licenses
 * AIMING a screen; it is NOT a registration citation by itself
 * (EDGE-SPACE §4 + reserve-confirmability envelope unchanged).
 *
 * Gates (abort exit 2, no table printed):
 *   G1 join-direction: UP samples with ask ≥ 0.90 (n ≥ 30) must win > 75%;
 *      same for DOWN. A flipped result_id join fails this loudly.
 *   G2 global fairness control: per side, |z| of overall mean residual
 *      must be < 6 (E9-E23 measured ≈ 0; a huge global deviation means a
 *      parse/join bug, not an edge).
 *
 * Usage: npx tsx fable-lab/tools/signal-scan.ts <log> [<log> ...]
 *        npx tsx fable-lab/tools/signal-scan.ts <...synthetic...> --outcomes <json>
 * --outcomes ({slug:'0'|'1'}) is ONLY for the committed selftest; refused
 * unless every log path contains "synthetic" (calib.ts precedent).
 */
import { readFileSync } from 'node:fs'
import '../../src/config/env.js'
import { getMarketsBySlugs } from '../../src/db/telonexMarkets.js'
import { closeDb } from '../../src/db/index.js'

const OFFSETS = [150, 300, 600, 750, 850] as const
const NEXT_BOUND: Record<number, number> = { 150: 300, 300: 600, 600: 750, 750: 850, 850: 900 }
const SEASON_OFFSETS = [300, 750]
const FEATURES = [
  'l1Imb', 'l5Imb', 'l10Imb', 'dTot5', 'dTot10', 'nTicks', 'rate60', 'vol',
  'nz', 'flips', 'range', 'posR', 'move60', 'firstMid', 'firstTs', 'crossedN',
] as const
type Feature = (typeof FEATURES)[number]
type Side = 'UP' | 'DOWN'
const SIDES: Side[] = ['UP', 'DOWN']
const STRATA = ['LO', 'MID', 'HI'] as const
type Stratum = (typeof STRATA)[number]
const MONOTONE_BAR = 4.0 // k=160, Bonferroni ~0.01
const CELL_BAR = 4.4 // k=2,400 (+156 seasonality), Bonferroni ~0.01
const WARM_BAR = 3.0
const MIN_STRATUM_N = 200
const ASK_MIN = 0.02
const ASK_MAX = 0.98

const stratumOf = (ask: number): Stratum => (ask < 0.35 ? 'LO' : ask <= 0.65 ? 'MID' : 'HI')

interface Obs {
  slug: string
  epochSec: number
  off: number
  ask: number // entry ask of the bought side
  feats: Record<Feature, number>
}

const LINE_RE = new RegExp(
  '^\\[diag-signal\\] slug=(\\S+) epoch=(\\d+) off=(\\d+) ts=([\\d.]+) ' +
    'upBid=([\\d.-]+) upAsk=([\\d.-]+) dnBid=([\\d.-]+) dnAsk=([\\d.-]+) ' +
    FEATURES.map((f) => `${f}=([\\d.eE+-]+)`).join(' ') +
    '$',
)

function rankArray(xs: number[]): number[] {
  // average ranks for ties
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const ranks = new Array<number>(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg
    i = j + 1
  }
  return ranks
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  let sx = 0, sy = 0
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i] }
  const mx = sx / n, my = sy / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return 0
  return sxy / Math.sqrt(sxx * syy)
}

function meanSd(xs: number[]): { mean: number; sd: number } {
  const n = xs.length
  let s = 0
  for (const x of xs) s += x
  const mean = s / n
  let m2 = 0
  for (const x of xs) m2 += (x - mean) * (x - mean)
  return { mean, sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0 }
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
    console.error('usage: npx tsx fable-lab/tools/signal-scan.ts <log> [<log>...] [--outcomes <json>]')
    process.exit(1)
  }
  const synthetic = outcomesPath !== undefined
  if (synthetic && !logPaths.every((p) => p.includes('synthetic'))) {
    console.error('REFUSED: --outcomes is only for synthetic fixtures (every log path must contain "synthetic")')
    process.exit(1)
  }

  // ---- parse + dedupe + drift filter ----
  const seen = new Set<string>()
  const parsed: { slug: string; epochSec: number; off: number; upBid: number; upAsk: number; dnBid: number; dnAsk: number; feats: Record<Feature, number> }[] = []
  let malformed = 0
  let skippedDrift = 0
  const slugsAll = new Set<string>()
  for (const path of logPaths) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.startsWith('[diag-signal] ')) continue
      const m = LINE_RE.exec(line)
      if (!m) { malformed++; continue }
      const slug = m[1]
      const off = Number(m[3])
      const ts = Number(m[4])
      if (!(OFFSETS as readonly number[]).includes(off)) continue
      slugsAll.add(slug)
      const key = `${slug}|${off}`
      if (seen.has(key)) continue
      seen.add(key)
      if (ts >= NEXT_BOUND[off]) { skippedDrift++; continue }
      const feats = {} as Record<Feature, number>
      FEATURES.forEach((f, i) => { feats[f] = Number(m[9 + i]) })
      parsed.push({
        slug, epochSec: Number(m[2]), off,
        upBid: Number(m[5]), upAsk: Number(m[6]), dnBid: Number(m[7]), dnAsk: Number(m[8]),
        feats,
      })
    }
  }
  const slugs = [...new Set(parsed.map((p) => p.slug))]
  console.log(
    `parsed ${parsed.length} deduped (slug,off) rows across ${slugs.length} markets ` +
      `(${malformed} malformed, ${skippedDrift} drift-discarded; ${slugsAll.size} markets emitted any line)`,
  )
  for (const off of OFFSETS) {
    console.log(`per-offset market coverage: o${off}=${parsed.filter((p) => p.off === off).length}`)
  }

  // ---- outcome join (ONCE) ----
  const upWonBySlug = new Map<string, boolean>()
  if (synthetic) {
    const json = JSON.parse(readFileSync(outcomesPath!, 'utf8')) as Record<string, string>
    for (const [slug, r] of Object.entries(json)) {
      if (r === '0') upWonBySlug.set(slug, true)
      else if (r === '1') upWonBySlug.set(slug, false)
    }
  } else {
    for (let i = 0; i < slugs.length; i += 500) {
      const rows = await getMarketsBySlugs(slugs.slice(i, i + 500), {
        converter: 'delta-typed',
        readFrom: 'local-or-download-from-r2-to-local',
      })
      for (const r of rows) {
        if (r.resultId === '0') upWonBySlug.set(r.slug, true)
        else if (r.resultId === '1') upWonBySlug.set(r.slug, false)
      }
    }
  }
  const unresolved = slugs.filter((s) => !upWonBySlug.has(s))
  console.log(`outcome joined for ${upWonBySlug.size}/${slugs.length} markets (${unresolved.length} missing/unresolved — excluded)`)

  // ---- build per-side observation sets ----
  // Trade: BUY <side> at its ask. Residual r = won − ask.
  const obsBySide: Record<Side, (Obs & { won: number })[]> = { UP: [], DOWN: [] }
  for (const p of parsed) {
    const upWon = upWonBySlug.get(p.slug)
    if (upWon === undefined) continue
    // UP side sample
    if (p.upBid > 0 && p.upAsk > 0 && p.upBid < p.upAsk && p.upAsk >= ASK_MIN && p.upAsk <= ASK_MAX) {
      obsBySide.UP.push({ slug: p.slug, epochSec: p.epochSec, off: p.off, ask: p.upAsk, feats: p.feats, won: upWon ? 1 : 0 })
    }
    // DOWN side sample (fixture logs -1 sentinels when the DOWN book was absent)
    if (p.dnBid > 0 && p.dnAsk > 0 && p.dnBid < p.dnAsk && p.dnAsk >= ASK_MIN && p.dnAsk <= ASK_MAX) {
      obsBySide.DOWN.push({ slug: p.slug, epochSec: p.epochSec, off: p.off, ask: p.dnAsk, feats: p.feats, won: upWon ? 0 : 1 })
    }
  }
  console.log(`samples: UP=${obsBySide.UP.length} DOWN=${obsBySide.DOWN.length} (ask in [${ASK_MIN},${ASK_MAX}], uncrossed)`)

  // ---- G1 join-direction gate ----
  for (const side of SIDES) {
    const hi = obsBySide[side].filter((o) => o.ask >= 0.9)
    if (hi.length >= 30) {
      const wr = hi.reduce((s, o) => s + o.won, 0) / hi.length
      console.log(`gate G1 ${side}: n=${hi.length} ask≥0.90 winRate=${wr.toFixed(4)}`)
      if (wr <= 0.75) {
        console.error(`GATE G1 FAILED (${side}): winRate ${wr.toFixed(4)} ≤ 0.75 at ask ≥ 0.90 — suspect result_id join direction. ABORT.`)
        await closeDb(); process.exit(2)
      }
    } else {
      console.log(`gate G1 ${side}: n=${hi.length} < 30 high-ask samples — gate vacuous (disclosed)`)
    }
  }
  // ---- G2 global fairness control ----
  for (const side of SIDES) {
    const rs = obsBySide[side].map((o) => o.won - o.ask)
    if (rs.length < 100) continue
    const { mean, sd } = meanSd(rs)
    const z = mean / (sd / Math.sqrt(rs.length))
    console.log(`gate G2 ${side}: mean residual ${(mean * 100).toFixed(3)}c z=${z.toFixed(2)} (n=${rs.length})`)
    if (Math.abs(z) >= 6) {
      console.error(`GATE G2 FAILED (${side}): |z| ≥ 6 on the global residual — parse/join bug suspected. ABORT.`)
      await closeDb(); process.exit(2)
    }
  }

  // ---- 1. monotone screen ----
  console.log('\n=== MONOTONE SCREEN (Spearman feature vs residual, Stouffer across strata; CANDIDATE |z|≥4.00, WARM |z|≥3.00) ===')
  const monotone: { off: number; feat: Feature; side: Side; z: number; ns: string }[] = []
  for (const side of SIDES) {
    for (const off of OFFSETS) {
      const group = obsBySide[side].filter((o) => o.off === off)
      for (const feat of FEATURES) {
        let num = 0, den = 0
        const nParts: string[] = []
        for (const st of STRATA) {
          const sub = group.filter((o) => stratumOf(o.ask) === st)
          if (sub.length < MIN_STRATUM_N) { nParts.push(`${st}:${sub.length}<min`); continue }
          const ranks = rankArray(sub.map((o) => o.feats[feat]))
          const resid = sub.map((o) => o.won - o.ask)
          const rho = pearson(ranks, resid)
          const zp = rho * Math.sqrt(sub.length - 1)
          const w = Math.sqrt(sub.length)
          num += w * zp
          den += w * w
          nParts.push(`${st}:${sub.length}`)
        }
        const z = den > 0 ? num / Math.sqrt(den) : 0
        monotone.push({ off, feat, side, z, ns: nParts.join(',') })
      }
    }
  }
  monotone.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  let nCand = 0, nWarm = 0
  for (const m of monotone) {
    const tag = Math.abs(m.z) >= MONOTONE_BAR ? 'CANDIDATE' : Math.abs(m.z) >= WARM_BAR ? 'WARM' : ''
    if (tag === 'CANDIDATE') nCand++
    if (tag === 'WARM') nWarm++
    if (tag || Math.abs(m.z) >= 2)
      console.log(`  ${m.side} o${m.off} ${m.feat} z=${m.z >= 0 ? '+' : ''}${m.z.toFixed(2)} [${m.ns}] ${tag}`)
  }
  console.log(`monotone screen: ${nCand} CANDIDATE, ${nWarm} WARM of ${monotone.length} tests (|z|<2 suppressed from listing)`)

  // ---- 2. cell grid ----
  console.log('\n=== CELL GRID (feature quintiles within (off, stratum, side); CANDIDATE |z|≥4.40) ===')
  let cellCand = 0, cellWarm = 0, cellTotal = 0
  for (const side of SIDES) {
    for (const off of OFFSETS) {
      const group = obsBySide[side].filter((o) => o.off === off)
      for (const st of STRATA) {
        const sub = group.filter((o) => stratumOf(o.ask) === st)
        if (sub.length < MIN_STRATUM_N) continue
        for (const feat of FEATURES) {
          const ranks = rankArray(sub.map((o) => o.feats[feat]))
          for (let q = 0; q < 5; q++) {
            const lo = (sub.length * q) / 5
            const hi = (sub.length * (q + 1)) / 5
            const cell = sub.filter((_, i) => ranks[i] > lo && ranks[i] <= hi)
            if (cell.length < 30) continue
            cellTotal++
            const rs = cell.map((o) => o.won - o.ask)
            const { mean, sd } = meanSd(rs)
            if (sd === 0) continue
            const z = mean / (sd / Math.sqrt(rs.length))
            if (Math.abs(z) >= WARM_BAR) {
              const tag = Math.abs(z) >= CELL_BAR ? 'CANDIDATE' : 'warm'
              if (tag === 'CANDIDATE') cellCand++
              else cellWarm++
              console.log(
                `  ${side} o${off} ${st} ${feat} q${q + 1} d=${(mean * 100).toFixed(2)}c z=${z >= 0 ? '+' : ''}${z.toFixed(2)} n=${cell.length} ${tag}`,
              )
            }
          }
        }
      }
    }
  }
  console.log(`cell grid: ${cellCand} CANDIDATE, ${cellWarm} warm (|z|≥3) of ${cellTotal} evaluated cells`)

  // ---- 3. seasonality ----
  console.log('\n=== SEASONALITY (hour-of-day 4h bins + day-of-week, UTC; CANDIDATE |z|≥4.40) ===')
  let seasCand = 0
  for (const side of SIDES) {
    for (const off of SEASON_OFFSETS) {
      const group = obsBySide[side].filter((o) => o.off === off)
      for (const st of STRATA) {
        const sub = group.filter((o) => stratumOf(o.ask) === st)
        if (sub.length < MIN_STRATUM_N) continue
        const bins: Record<string, (typeof sub)[number][]> = {}
        for (const o of sub) {
          const hour = Math.floor((o.epochSec % 86400) / 3600)
          const hb = `h${Math.floor(hour / 4) * 4}-${Math.floor(hour / 4) * 4 + 3}`
          const dow = `d${Math.floor(o.epochSec / 86400 + 4) % 7}` // epoch day 0 = Thursday → +4 ⇒ 0=Sunday
          ;(bins[hb] ??= []).push(o)
          ;(bins[dow] ??= []).push(o)
        }
        for (const [bin, cell] of Object.entries(bins)) {
          if (cell.length < 30) continue
          const rs = cell.map((o) => o.won - o.ask)
          const { mean, sd } = meanSd(rs)
          if (sd === 0) continue
          const z = mean / (sd / Math.sqrt(rs.length))
          if (Math.abs(z) >= WARM_BAR) {
            const tag = Math.abs(z) >= CELL_BAR ? 'CANDIDATE' : 'warm'
            if (tag === 'CANDIDATE') seasCand++
            console.log(
              `  ${side} o${off} ${st} ${bin} d=${(mean * 100).toFixed(2)}c z=${z >= 0 ? '+' : ''}${z.toFixed(2)} n=${cell.length} ${tag}`,
            )
          }
        }
      }
    }
  }
  console.log(`seasonality: ${seasCand} CANDIDATE`)

  console.log('\nscan complete — interpretation rules are frozen in knowledge/SIGNAL-MAP.md (map-grade only)')
  await closeDb()
}

main().catch((e) => { console.error(e); process.exit(1) })
