/**
 * signal3-scan.ts — SIGNAL-003 one-shot outcome join + frozen per-fill scan
 * (knowledge/SIGNAL-FILLS.md, session 64). Reads [diag-fill] lines from one
 * or more shard logs (fixture strategies/_fixtures/diag-fill.ts replaying
 * the run-472 SCR-008 cell), joins telonex_markets.result_id ONCE, and
 * evaluates whether any causal pre-fill feature predicts per-fill
 * settlement PnL. E29 arithmetic: the ungated fill population averages
 * ~zero, so any predictor of toxicity makes its complement positive-EV.
 *
 * Primary sample: FIRST fill per market (fillSeq=0), fLiq=MAKER, fPrice in
 * [0.02, 0.98]. Residual r = wonDown − fPrice (DOWN buy held to
 * settlement; maker fee 0 in the engine model).
 *
 *   1. MONOTONE SCREEN (primary): per feature, Spearman rank-correlation of
 *      feature vs residual within fill-price strata LO [0.02,0.35) /
 *      MID [0.35,0.65] / HI (0.65,0.98] (n ≥ 200), Stouffer-combined
 *      (w = √n). k = 21. CANDIDATE |z| ≥ 3.50 (Bonferroni α ≈ 0.01),
 *      WARM |z| ≥ 3 (recorded, not candidate).
 *   2. CELL GRID (shape readout): feature quintiles within (stratum,
 *      feature); d = mean residual, scan-se convention. k ≈ 315 (n ≥ 30).
 *      CANDIDATE |z| ≥ 4.20.
 *   3. FILL SEASONALITY: hour-of-day (6 four-hour UTC bins) + day-of-week
 *      cells per stratum; same cell bar 4.20.
 *
 * qAgeSec / qMidDrift rows with the -1 attribution sentinel are excluded
 * from those two features' tests only (requote race; count printed).
 *
 * Gates (abort exit 2, no table printed):
 *   G1 join-direction: fills with fPrice ≥ 0.90 (n ≥ 30) must win > 75%.
 *   G2 global zero anchor: |z| of overall mean residual < 6 (E29 measured
 *      ≈ 0 at N=500; a huge global deviation means a parse/join bug).
 *
 * Interpretation is frozen in SIGNAL-FILLS.md — all outputs are map-grade;
 * a candidate licenses a mechanically-derived complement gate that must
 * then survive a fresh D49 screen on a NEW sample. Zero candidates closes
 * the maker family (IDEAS #22 dead branch).
 *
 * Usage: npx tsx fable-lab/tools/signal3-scan.ts <log> [<log> ...]
 *        npx tsx fable-lab/tools/signal3-scan.ts <...synthetic...> --outcomes <json>
 * --outcomes ({slug:'0'|'1'}, result_id convention: '0'=UP won, '1'=DOWN
 * won) is ONLY for the committed selftest; refused unless every log path
 * contains "synthetic".
 */
import { readFileSync } from 'node:fs'
import '../../src/config/env.js'
import { getMarketsBySlugs } from '../../src/db/telonexMarkets.js'
import { closeDb } from '../../src/db/index.js'

const FEATURES = [
  'spread', 'qAgeSec', 'qMidDrift', 'l1Imb', 'l5Imb', 'l10Imb', 'dTot5',
  'dTot10', 'nTicks', 'rate60', 'vol', 'nz', 'flips', 'range', 'posR',
  'move60', 'move10', 'firstMid', 'firstTs', 'crossedN', 'fElapsed',
] as const
type Feature = (typeof FEATURES)[number]
const STRATA = ['LO', 'MID', 'HI'] as const
type Stratum = (typeof STRATA)[number]
const MONOTONE_BAR = 3.5 // k=21, Bonferroni ~0.01
const CELL_BAR = 4.2 // k≈315 (+~39 seasonality), Bonferroni ~0.01
const WARM_BAR = 3.0
const MIN_STRATUM_N = 200
const PRICE_MIN = 0.02
const PRICE_MAX = 0.98

const stratumOf = (p: number): Stratum => (p < 0.35 ? 'LO' : p <= 0.65 ? 'MID' : 'HI')

// Raw log fields in emission order (after slug/epoch/fillSeq).
const RAW_FIELDS = [
  'fTs', 'fPrice', 'fSize', 'fLiq', 'stateTs', 'qAgeSec', 'qMidDrift',
  'upBid', 'upAsk', 'dnBid', 'dnAsk', 'l1Imb', 'l5Imb', 'l10Imb', 'dTot5',
  'dTot10', 'nTicks', 'rate60', 'vol', 'nz', 'flips', 'range', 'posR',
  'move60', 'move10', 'firstMid', 'firstTs', 'crossedN',
] as const
const LINE_RE = new RegExp(
  '^\\[diag-fill\\] slug=(\\S+) epoch=(\\d+) fillSeq=(\\d+) ' +
    RAW_FIELDS.map((f) => `${f}=(\\S+)`).join(' ') +
    '$',
)

interface FillObs {
  slug: string
  epochSec: number
  fillSeq: number
  fPrice: number
  fLiq: string
  hasQuoteAttr: boolean
  feats: Record<Feature, number>
}

function rankArray(xs: number[]): number[] {
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
    console.error('usage: npx tsx fable-lab/tools/signal3-scan.ts <log> [<log>...] [--outcomes <json>]')
    process.exit(1)
  }
  const synthetic = outcomesPath !== undefined
  if (synthetic && !logPaths.every((p) => p.includes('synthetic'))) {
    console.error('REFUSED: --outcomes is only for synthetic fixtures (every log path must contain "synthetic")')
    process.exit(1)
  }

  // ---- parse + dedupe ----
  const seen = new Set<string>()
  const fills: FillObs[] = []
  let malformed = 0
  let nonMaker = 0
  let priceOut = 0
  let laterFills = 0
  const slugsAll = new Set<string>()
  for (const path of logPaths) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.startsWith('[diag-fill] ')) continue
      const m = LINE_RE.exec(line)
      if (!m) { malformed++; continue }
      const slug = m[1]
      slugsAll.add(slug)
      const fillSeq = Number(m[3])
      const key = `${slug}|${fillSeq}`
      if (seen.has(key)) continue
      seen.add(key)
      const raw = {} as Record<(typeof RAW_FIELDS)[number], string>
      RAW_FIELDS.forEach((f, i) => { raw[f] = m[4 + i] })
      if (fillSeq !== 0) { laterFills++; continue } // primary = first fill per market
      if (raw.fLiq !== 'MAKER') { nonMaker++; continue }
      const fPrice = Number(raw.fPrice)
      if (!(fPrice >= PRICE_MIN && fPrice <= PRICE_MAX)) { priceOut++; continue }
      const num = (k: (typeof RAW_FIELDS)[number]): number => Number(raw[k])
      const qAge = num('qAgeSec')
      fills.push({
        slug,
        epochSec: Number(m[2]),
        fillSeq,
        fPrice,
        fLiq: raw.fLiq,
        hasQuoteAttr: qAge >= 0,
        feats: {
          spread: num('dnAsk') - num('dnBid'),
          qAgeSec: qAge,
          qMidDrift: num('qMidDrift'),
          l1Imb: num('l1Imb'), l5Imb: num('l5Imb'), l10Imb: num('l10Imb'),
          dTot5: num('dTot5'), dTot10: num('dTot10'),
          nTicks: num('nTicks'), rate60: num('rate60'), vol: num('vol'),
          nz: num('nz'), flips: num('flips'), range: num('range'),
          posR: num('posR'), move60: num('move60'), move10: num('move10'),
          firstMid: num('firstMid'), firstTs: num('firstTs'),
          crossedN: num('crossedN'), fElapsed: num('fTs'),
        },
      })
    }
  }
  const slugs = [...new Set(fills.map((p) => p.slug))]
  console.log(
    `parsed ${fills.length} primary fills across ${slugs.length} markets ` +
      `(${malformed} malformed, ${laterFills} later-fill rows excluded, ${nonMaker} non-maker first fills excluded, ` +
      `${priceOut} price-range excluded; ${slugsAll.size} markets emitted any fill line)`,
  )
  const noAttr = fills.filter((f) => !f.hasQuoteAttr).length
  console.log(`quote attribution: ${fills.length - noAttr}/${fills.length} attributed (${noAttr} sentinel rows excluded from qAgeSec/qMidDrift tests only)`)

  // ---- outcome join (ONCE) ----
  const dnWonBySlug = new Map<string, boolean>()
  if (synthetic) {
    const json = JSON.parse(readFileSync(outcomesPath!, 'utf8')) as Record<string, string>
    for (const [slug, r] of Object.entries(json)) {
      if (r === '0') dnWonBySlug.set(slug, false)
      else if (r === '1') dnWonBySlug.set(slug, true)
    }
  } else {
    for (let i = 0; i < slugs.length; i += 500) {
      const rows = await getMarketsBySlugs(slugs.slice(i, i + 500), {
        converter: 'delta-typed',
        readFrom: 'local-or-download-from-r2-to-local',
      })
      for (const r of rows) {
        if (r.resultId === '0') dnWonBySlug.set(r.slug, false)
        else if (r.resultId === '1') dnWonBySlug.set(r.slug, true)
      }
    }
  }
  const obs = fills
    .filter((f) => dnWonBySlug.has(f.slug))
    .map((f) => ({ ...f, won: dnWonBySlug.get(f.slug)! ? 1 : 0 }))
  console.log(`outcome joined for ${obs.length}/${fills.length} fills (${fills.length - obs.length} missing/unresolved — excluded)`)

  // ---- G1 join-direction gate ----
  const hi = obs.filter((o) => o.fPrice >= 0.9)
  if (hi.length >= 30) {
    const wr = hi.reduce((s, o) => s + o.won, 0) / hi.length
    console.log(`gate G1: n=${hi.length} fPrice≥0.90 winRate=${wr.toFixed(4)}`)
    if (wr <= 0.75) {
      console.error(`GATE G1 FAILED: winRate ${wr.toFixed(4)} ≤ 0.75 at fPrice ≥ 0.90 — suspect result_id join direction. ABORT.`)
      await closeDb(); process.exit(2)
    }
  } else {
    console.log(`gate G1: n=${hi.length} < 30 high-price fills — gate vacuous (disclosed)`)
  }
  // ---- G2 global zero anchor ----
  {
    const rs = obs.map((o) => o.won - o.fPrice)
    if (rs.length >= 100) {
      const { mean, sd } = meanSd(rs)
      const z = mean / (sd / Math.sqrt(rs.length))
      console.log(`gate G2: mean residual ${(mean * 100).toFixed(3)}c z=${z.toFixed(2)} (n=${rs.length})`)
      if (Math.abs(z) >= 6) {
        console.error('GATE G2 FAILED: |z| ≥ 6 on the global residual — parse/join bug suspected (E29 anchor ≈ 0). ABORT.')
        await closeDb(); process.exit(2)
      }
    }
  }

  const sampleFor = (feat: Feature, pool: typeof obs): typeof obs =>
    feat === 'qAgeSec' || feat === 'qMidDrift' ? pool.filter((o) => o.hasQuoteAttr) : pool

  // ---- 1. monotone screen ----
  console.log(`\n=== MONOTONE SCREEN (Spearman feature vs residual, Stouffer across fill-price strata; CANDIDATE |z|≥${MONOTONE_BAR.toFixed(2)}, WARM |z|≥3.00) ===`)
  const monotone: { feat: Feature; z: number; ns: string }[] = []
  for (const feat of FEATURES) {
    let num = 0, den = 0
    const nParts: string[] = []
    for (const st of STRATA) {
      const sub = sampleFor(feat, obs).filter((o) => stratumOf(o.fPrice) === st)
      if (sub.length < MIN_STRATUM_N) { nParts.push(`${st}:${sub.length}<min`); continue }
      const ranks = rankArray(sub.map((o) => o.feats[feat]))
      const resid = sub.map((o) => o.won - o.fPrice)
      const rho = pearson(ranks, resid)
      const zp = rho * Math.sqrt(sub.length - 1)
      const w = Math.sqrt(sub.length)
      num += w * zp
      den += w * w
      nParts.push(`${st}:${sub.length}`)
    }
    const z = den > 0 ? num / Math.sqrt(den) : 0
    monotone.push({ feat, z, ns: nParts.join(',') })
  }
  monotone.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  let nCand = 0, nWarm = 0
  for (const m of monotone) {
    const tag = Math.abs(m.z) >= MONOTONE_BAR ? 'CANDIDATE' : Math.abs(m.z) >= WARM_BAR ? 'WARM' : ''
    if (tag === 'CANDIDATE') nCand++
    if (tag === 'WARM') nWarm++
    if (tag || Math.abs(m.z) >= 2)
      console.log(`  ${m.feat} z=${m.z >= 0 ? '+' : ''}${m.z.toFixed(2)} [${m.ns}] ${tag}`)
  }
  console.log(`monotone screen: ${nCand} CANDIDATE, ${nWarm} WARM of ${monotone.length} tests (|z|<2 suppressed from listing)`)

  // ---- 2. cell grid ----
  console.log(`\n=== CELL GRID (feature quintiles within (stratum, feature); CANDIDATE |z|≥${CELL_BAR.toFixed(2)}) ===`)
  let cellCand = 0, cellWarm = 0, cellTotal = 0
  for (const st of STRATA) {
    for (const feat of FEATURES) {
      const sub = sampleFor(feat, obs).filter((o) => stratumOf(o.fPrice) === st)
      if (sub.length < MIN_STRATUM_N) continue
      const ranks = rankArray(sub.map((o) => o.feats[feat]))
      for (let q = 0; q < 5; q++) {
        const lo = (sub.length * q) / 5
        const hiB = (sub.length * (q + 1)) / 5
        const cell = sub.filter((_, i) => ranks[i] > lo && ranks[i] <= hiB)
        if (cell.length < 30) continue
        cellTotal++
        const rs = cell.map((o) => o.won - o.fPrice)
        const { mean, sd } = meanSd(rs)
        if (sd === 0) continue
        const z = mean / (sd / Math.sqrt(rs.length))
        if (Math.abs(z) >= WARM_BAR) {
          const tag = Math.abs(z) >= CELL_BAR ? 'CANDIDATE' : 'warm'
          if (tag === 'CANDIDATE') cellCand++
          else cellWarm++
          console.log(`  ${st} ${feat} q${q + 1} d=${(mean * 100).toFixed(2)}c z=${z >= 0 ? '+' : ''}${z.toFixed(2)} n=${cell.length} ${tag}`)
        }
      }
    }
  }
  console.log(`cell grid: ${cellCand} CANDIDATE, ${cellWarm} warm (|z|≥3) of ${cellTotal} evaluated cells`)

  // ---- 3. fill seasonality ----
  console.log(`\n=== FILL SEASONALITY (hour-of-day 4h bins + day-of-week, UTC; CANDIDATE |z|≥${CELL_BAR.toFixed(2)}) ===`)
  let seasCand = 0
  for (const st of STRATA) {
    const sub = obs.filter((o) => stratumOf(o.fPrice) === st)
    if (sub.length < MIN_STRATUM_N) continue
    const bins: Record<string, typeof sub> = {}
    for (const o of sub) {
      const hour = Math.floor((o.epochSec % 86400) / 3600)
      const hb = `h${Math.floor(hour / 4) * 4}-${Math.floor(hour / 4) * 4 + 3}`
      const dow = `d${Math.floor(o.epochSec / 86400 + 4) % 7}` // epoch day 0 = Thursday → +4 ⇒ 0=Sunday
      ;(bins[hb] ??= []).push(o)
      ;(bins[dow] ??= []).push(o)
    }
    for (const [bin, cell] of Object.entries(bins)) {
      if (cell.length < 30) continue
      const rs = cell.map((o) => o.won - o.fPrice)
      const { mean, sd } = meanSd(rs)
      if (sd === 0) continue
      const z = mean / (sd / Math.sqrt(rs.length))
      if (Math.abs(z) >= WARM_BAR) {
        const tag = Math.abs(z) >= CELL_BAR ? 'CANDIDATE' : 'warm'
        if (tag === 'CANDIDATE') seasCand++
        console.log(`  ${st} ${bin} d=${(mean * 100).toFixed(2)}c z=${z >= 0 ? '+' : ''}${z.toFixed(2)} n=${cell.length} ${tag}`)
      }
    }
  }
  console.log(`fill seasonality: ${seasCand} CANDIDATE`)

  console.log('\nscan complete — interpretation rules are frozen in knowledge/SIGNAL-FILLS.md (map-grade only)')
  await closeDb()
}

main().catch((e) => { console.error(e); process.exit(1) })
