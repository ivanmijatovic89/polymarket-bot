/**
 * session-split.ts — does time-of-day change pair economics for a 24/7
 * wallet? Per btc-updown-15m market inside the pull window (>=1h
 * margins): leg audit (as deep-dive-04b6.ts), then aggregate by the
 * market window's UTC start hour into session buckets:
 *   overnight 00-05Z | eu 06-11Z | us 12-19Z | evening 20-23Z
 * Winners from telonex DB result_id (sanctioned module).
 *
 * Usage: npx tsx research/gabagool/scripts/session-split.ts \
 *   --activity research/gabagool/data/activity-b27bc932-jun.jsonl
 */
import { readFileSync } from 'node:fs'
import { listEligibleTelonexMarkets } from '../../../src/db/telonexMarkets.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const activityPath = argOf('activity')!

type Trade = { ts: number; price: number; size: number; usd: number; outcome: string }
const bySlug = new Map<string, Trade[]>()
let minTs = Infinity
let maxTs = 0
for (const line of readFileSync(activityPath, 'utf8').split('\n')) {
  if (!line) continue
  const r = JSON.parse(line)
  if (r.type !== 'TRADE' || r.side !== 'BUY') continue
  if (r.timestamp < minTs) minTs = r.timestamp
  if (r.timestamp > maxTs) maxTs = r.timestamp
  if (!r.slug?.startsWith('btc-updown-15m-')) continue
  let arr = bySlug.get(r.slug)
  if (!arr) bySlug.set(r.slug, (arr = []))
  arr.push({ ts: r.timestamp, price: r.price, size: r.size, usd: r.usdcSize, outcome: r.outcome })
}
console.log(`trade window: ${new Date(minTs * 1000).toISOString()} .. ${new Date(maxTs * 1000).toISOString()}`)

const slugs = [...bySlug.keys()]
  .filter((s) => {
    const epoch = Number(s.split('-').pop())
    return epoch >= minTs + 3600 && epoch + 900 <= maxTs - 3600
  })
  .sort()
console.log(`btc-15m markets inside margins: ${slugs.length}`)

const dbRows = await listEligibleTelonexMarkets({
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'r2',
  fromMs: (minTs - 3600) * 1000,
  toMs: (maxTs + 3600) * 1000,
  limit: 2000,
})
const winnerOf = new Map<string, string>()
for (const m of dbRows) {
  if (m.resultId === '0') winnerOf.set(m.slug, m.outcome0)
  else if (m.resultId === '1') winnerOf.set(m.slug, m.outcome1)
}

type M = {
  hour: number
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
  const winner = winnerOf.get(slug)
  const winSh = winner === 'Up' ? upSh : winner === 'Down' ? dnSh : undefined
  ms.push({
    hour: new Date(epoch * 1000).getUTCHours(),
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
const BUCKETS: Array<[string, (h: number) => boolean]> = [
  ['overnight 00-05Z', (h) => h < 6],
  ['eu 06-11Z', (h) => h >= 6 && h < 12],
  ['us 12-19Z', (h) => h >= 12 && h < 20],
  ['evening 20-23Z', (h) => h >= 20],
]
console.log('\nbucket | mkts | fills/mkt p50 | outlay p50 | pairRate p50 | pairCost p25/p50/p75 | grossPnL sum | pnl p10/p50/p90 | losers% | excessWon%')
for (const [name, pred] of BUCKETS) {
  const g = ms.filter((m) => pred(m.hour))
  const pnls = g.filter((m) => m.grossPnl !== undefined).map((m) => m.grossPnl!)
  const ew = g.filter((m) => m.excessWon !== undefined)
  console.log(
    `${name} | ${g.length} | ${q(g.map((m) => m.fills), 0.5)} | $${q(g.map((m) => m.outlay), 0.5).toFixed(0)} | ${q(g.map((m) => m.pairRate), 0.5).toFixed(3)} | ${q(g.map((m) => m.pairCost), 0.25).toFixed(3)}/${q(g.map((m) => m.pairCost), 0.5).toFixed(3)}/${q(g.map((m) => m.pairCost), 0.75).toFixed(3)} | $${pnls.reduce((a, b) => a + b, 0).toFixed(0)} | $${q(pnls, 0.1).toFixed(0)}/$${q(pnls, 0.5).toFixed(0)}/$${q(pnls, 0.9).toFixed(0)} | ${((100 * pnls.filter((x) => x < 0).length) / (pnls.length || 1)).toFixed(0)}% | ${((100 * ew.filter((m) => m.excessWon).length) / (ew.length || 1)).toFixed(0)}%`,
  )
}
const all = ms.filter((m) => m.grossPnl !== undefined)
console.log(`\nALL: ${ms.length} markets, gross PnL $${all.reduce((a, m) => a + m.grossPnl!, 0).toFixed(0)}, total outlay $${ms.reduce((a, m) => a + m.outlay, 0).toFixed(0)}`)
process.exit(0)
