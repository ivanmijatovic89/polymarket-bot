/**
 * session-split-vol.ts — OQ #2: month-scale session split with a
 * realized-vol covariate. Extends session-split.ts:
 *   - pools MULTIPLE single-day activity pulls (per-file 1h margins)
 *   - winner per market from Gamma /events?slug= (cached in
 *     data/gamma-winners.json) — works past Telonex coverage (G9)
 *   - realized vol per 15m window from cached Binance 1m klines
 *     (fetch-binance-1m.ts): vol = sqrt(sum(1m logret^2)) in bp
 *   - outputs: session × vol-tercile grid, session marginal, vol
 *     marginal, per-day table (month drift)
 *
 * Gross PnL = winnerShares − outlay. This is merge-neutral: merging
 * min(up,dn) pairs at $1 + resolution of the excess pays the same
 * total as holding everything to resolution.
 *
 * Usage: npx tsx research/gabagool/scripts/session-split-vol.ts \
 *   --activity fileA.jsonl,fileB.jsonl,...
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const files = argOf('activity')!.split(',')

type Trade = { ts: number; size: number; usd: number; outcome: string }
const bySlug = new Map<string, Trade[]>()

for (const f of files) {
  let minTs = Infinity
  let maxTs = 0
  const rows: Array<{ slug: string; t: Trade }> = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    const r = JSON.parse(line)
    if (r.type !== 'TRADE' || r.side !== 'BUY') continue
    if (r.timestamp < minTs) minTs = r.timestamp
    if (r.timestamp > maxTs) maxTs = r.timestamp
    if (!r.slug?.startsWith('btc-updown-15m-')) continue
    rows.push({ slug: r.slug, t: { ts: r.timestamp, size: r.size, usd: r.usdcSize, outcome: r.outcome } })
  }
  let kept = 0
  for (const { slug, t } of rows) {
    const epoch = Number(slug.split('-').pop())
    if (epoch < minTs + 3600 || epoch + 900 > maxTs - 3600) continue
    let arr = bySlug.get(slug)
    if (!arr) bySlug.set(slug, (arr = []))
    arr.push(t)
    kept++
  }
  console.log(`${f}: window ${new Date(minTs * 1000).toISOString()}..${new Date(maxTs * 1000).toISOString()}, kept ${kept} btc-15m BUY fills`)
}

const slugs = [...bySlug.keys()].sort()
console.log(`pooled btc-15m markets inside margins: ${slugs.length}`)

// --- winners via Gamma (cached) ---
const CACHE = 'research/gabagool/data/gamma-winners.json'
const winnerOf: Record<string, string | null> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
let fetched = 0
for (const slug of slugs) {
  if (slug in winnerOf) continue
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`)
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      const evs = (await res.json()) as Array<{ markets: Array<{ outcomes: string; outcomePrices: string; closed: boolean }> }>
      const m = evs[0]?.markets?.[0]
      if (!m || !m.closed) {
        winnerOf[slug] = null
        break
      }
      const outcomes = JSON.parse(m.outcomes) as string[]
      const prices = (JSON.parse(m.outcomePrices) as string[]).map(Number)
      const wi = prices.findIndex((p) => p === 1)
      winnerOf[slug] = wi >= 0 ? outcomes[wi] : null
      break
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  fetched++
  if (fetched % 50 === 0) {
    writeFileSync(CACHE, JSON.stringify(winnerOf))
    console.log(`  gamma: ${fetched} fetched...`)
  }
  await new Promise((r) => setTimeout(r, 120))
}
writeFileSync(CACHE, JSON.stringify(winnerOf))
console.log(`winners: ${slugs.filter((s) => winnerOf[s]).length}/${slugs.length} resolved (${fetched} newly fetched)`)

// --- realized vol from Binance 1m ---
const klinesByDay = new Map<string, Array<[number, number, number, number, number]>>()
function volBpOf(epoch: number): number | undefined {
  const day = new Date(epoch * 1000).toISOString().slice(0, 10)
  if (!klinesByDay.has(day)) {
    const p = `research/gabagool/data/binance-1m-${day}.json`
    if (!existsSync(p)) return undefined
    klinesByDay.set(day, JSON.parse(readFileSync(p, 'utf8')))
  }
  const kl = klinesByDay.get(day)!.filter((k) => k[0] >= epoch * 1000 && k[0] < (epoch + 900) * 1000)
  if (kl.length < 10) return undefined
  let ss = 0
  for (let i = 1; i < kl.length; i++) {
    const r = Math.log(kl[i][4] / kl[i - 1][4])
    ss += r * r
  }
  return Math.sqrt(ss) * 10_000
}

// --- per-market table ---
type M = {
  slug: string
  day: string
  hour: number
  volBp: number | undefined
  fills: number
  outlay: number
  pairRate: number
  pairCost: number
  grossPnl: number | undefined
  excessWon: boolean | undefined
}
const ms: M[] = []
for (const slug of slugs) {
  const epoch = Number(slug.split('-').pop())
  const ts = bySlug.get(slug)!
  const up = ts.filter((t) => t.outcome === 'Up')
  const dn = ts.filter((t) => t.outcome === 'Down')
  const sum = (a: Trade[], f: (t: Trade) => number) => a.reduce((x, t) => x + f(t), 0)
  const upSh = sum(up, (t) => t.size)
  const dnSh = sum(dn, (t) => t.size)
  const upUsd = sum(up, (t) => t.usd)
  const dnUsd = sum(dn, (t) => t.usd)
  if (!upSh && !dnSh) continue
  const winner = winnerOf[slug] ?? undefined
  const winSh = winner === 'Up' ? upSh : winner === 'Down' ? dnSh : undefined
  ms.push({
    slug,
    day: new Date(epoch * 1000).toISOString().slice(0, 10),
    hour: new Date(epoch * 1000).getUTCHours(),
    volBp: volBpOf(epoch),
    fills: ts.length,
    outlay: upUsd + dnUsd,
    pairRate: Math.max(upSh, dnSh) ? Math.min(upSh, dnSh) / Math.max(upSh, dnSh) : NaN,
    pairCost: (upSh ? upUsd / upSh : NaN) + (dnSh ? dnUsd / dnSh : NaN),
    grossPnl: winSh === undefined ? undefined : winSh - (upUsd + dnUsd),
    excessWon: winner === undefined ? undefined : (upSh >= dnSh ? 'Up' : 'Down') === winner,
  })
}

const q = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const vols = ms.filter((m) => m.volBp !== undefined).map((m) => m.volBp!)
const t1 = q(vols, 1 / 3)
const t2 = q(vols, 2 / 3)
console.log(`\nvolBp terciles: ≤${t1.toFixed(1)} | ≤${t2.toFixed(1)} | > (n=${vols.length})`)

function row(name: string, g: M[]): string {
  const pnls = g.filter((m) => m.grossPnl !== undefined).map((m) => m.grossPnl!)
  const ew = g.filter((m) => m.excessWon !== undefined)
  const outlay = g.reduce((a, m) => a + m.outlay, 0)
  const pnlSum = pnls.reduce((a, b) => a + b, 0)
  return `${name} | ${g.length} | ${q(g.map((m) => m.fills), 0.5).toFixed(0)} | $${q(g.map((m) => m.outlay), 0.5).toFixed(0)} | ${q(g.map((m) => m.pairRate), 0.5).toFixed(3)} | ${q(g.map((m) => m.pairCost), 0.25).toFixed(3)}/${q(g.map((m) => m.pairCost), 0.5).toFixed(3)}/${q(g.map((m) => m.pairCost), 0.75).toFixed(3)} | $${pnlSum.toFixed(0)} (${((100 * pnlSum) / (outlay || 1)).toFixed(2)}%) | $${q(pnls, 0.1).toFixed(0)}/$${q(pnls, 0.5).toFixed(0)}/$${q(pnls, 0.9).toFixed(0)} | ${((100 * pnls.filter((x) => x < 0).length) / (pnls.length || 1)).toFixed(0)}% | ${((100 * ew.filter((m) => m.excessWon).length) / (ew.length || 1)).toFixed(0)}%`
}
const HDR = 'group | mkts | fills p50 | outlay p50 | pairRate p50 | pairCost p25/50/75 | grossPnL (%outlay) | pnl p10/50/90 | losers% | excessWon%'

const SESSIONS: Array<[string, (h: number) => boolean]> = [
  ['overnight 00-05Z', (h) => h < 6],
  ['eu 06-11Z', (h) => h >= 6 && h < 12],
  ['us 12-19Z', (h) => h >= 12 && h < 20],
  ['evening 20-23Z', (h) => h >= 20],
]
const TERCILES: Array<[string, (v: number) => boolean]> = [
  ['calm', (v) => v <= t1],
  ['mid', (v) => v > t1 && v <= t2],
  ['storm', (v) => v > t2],
]

console.log(`\n== session marginal ==\n${HDR}`)
for (const [n, p] of SESSIONS) console.log(row(n, ms.filter((m) => p(m.hour))))

console.log(`\n== vol marginal ==\n${HDR}`)
for (const [n, p] of TERCILES) console.log(row(n, ms.filter((m) => m.volBp !== undefined && p(m.volBp!))))

console.log(`\n== session × vol grid ==\n${HDR}`)
for (const [sn, sp] of SESSIONS)
  for (const [tn, tp] of TERCILES)
    console.log(row(`${sn} × ${tn}`, ms.filter((m) => sp(m.hour) && m.volBp !== undefined && tp(m.volBp!))))

console.log(`\n== per-day (month drift) ==\n${HDR}`)
for (const day of [...new Set(ms.map((m) => m.day))].sort()) console.log(row(day, ms.filter((m) => m.day === day)))

const all = ms.filter((m) => m.grossPnl !== undefined)
console.log(`\nALL: ${ms.length} markets, gross PnL $${all.reduce((a, m) => a + m.grossPnl!, 0).toFixed(0)}, outlay $${ms.reduce((a, m) => a + m.outlay, 0).toFixed(0)}`)
process.exit(0)
