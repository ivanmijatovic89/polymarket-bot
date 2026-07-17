/**
 * decompose-activity.ts — income decomposition + fingerprint for one
 * wallet's activity JSONL (pull-activity.ts output) over a window.
 *
 * Reports: event-type counts, rebate/yield payouts, trading cash flow on
 * complete markets (fills>0, 1h/2h boundary margins), win%, book mix,
 * clip-size and buy-price quantiles, per-market leg balance.
 *
 * Usage: npx tsx research/gabagool/scripts/decompose-activity.ts \
 *          --file <jsonl> --from <iso> --to <iso>
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = argOf('file')!
const fromSec = Date.parse(argOf('from')!) / 1000
const toSec = Date.parse(argOf('to')!) / 1000

type Row = {
  timestamp: number
  type: string
  side?: string
  size?: number
  usdcSize?: number
  price?: number
  slug?: string
  outcome?: string
}

const typeCounts = new Map<string, number>()
const payouts: Array<{ ts: number; type: string; usd: number }> = []
const bySlug = new Map<string, Row[]>()
const buySizes: number[] = []
const buyPrices: number[] = []

for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue
  const r = JSON.parse(line) as Row
  typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1)
  if (['MAKER_REBATE', 'TAKER_REBATE', 'YIELD', 'REFERRAL_REWARD'].includes(r.type)) {
    payouts.push({ ts: r.timestamp, type: r.type, usd: r.usdcSize ?? 0 })
    continue
  }
  const slug = r.slug || ''
  if (!slug) continue
  if (!bySlug.has(slug)) bySlug.set(slug, [])
  bySlug.get(slug)!.push(r)
  if (r.type === 'TRADE' && r.side === 'BUY') {
    if (r.usdcSize) buySizes.push(r.usdcSize)
    if (r.price) buyPrices.push(r.price)
  }
}

console.log('event types:', Object.fromEntries(typeCounts))
const payoutByType = new Map<string, number>()
for (const p of payouts) payoutByType.set(p.type, (payoutByType.get(p.type) ?? 0) + p.usd)
for (const [t, usd] of payoutByType) console.log(`${t}: $${usd.toFixed(2)} total`)

function famOf(slug: string): string {
  const m = slug.match(/^(btc|eth|sol|xrp)-updown-(\d+m)-/)
  if (m) return `${m[1]}-${m[2]}`
  for (const [c, p] of [
    ['bitcoin', 'btc'],
    ['ethereum', 'eth'],
    ['solana', 'sol'],
    ['xrp', 'xrp'],
  ] as const) {
    if (slug.startsWith(c)) return `${p}-1h+`
  }
  return 'other'
}

let net = 0
let buyTot = 0
let wins = 0
let n = 0
const famCounts = new Map<string, number>()
const legImbalances: number[] = []
const nets: Array<{ net: number; fills: number; slug: string }> = []

for (const [slug, rows] of bySlug) {
  const ts = rows.map((r) => r.timestamp)
  if (Math.min(...ts) < fromSec + 3600 || Math.max(...ts) > toSec - 7200) continue
  let fills = 0
  let m = 0
  let up = 0
  let down = 0
  for (const r of rows) {
    const usd = r.usdcSize ?? 0
    if (r.type === 'TRADE') {
      fills++
      famCounts.set(famOf(slug), (famCounts.get(famOf(slug)) ?? 0) + 1)
      if (r.side === 'BUY') {
        m -= usd
        buyTot += usd
        if ((r.outcome || '').toLowerCase() === 'up') up += r.size ?? 0
        else down += r.size ?? 0
      } else m += usd
    } else if (r.type === 'REDEEM' || r.type === 'MERGE') m += usd
  }
  if (fills === 0) continue
  n++
  net += m
  if (m > 0) wins++
  nets.push({ net: m, fills, slug })
  if (up + down > 0) legImbalances.push(Math.abs(up - down) / Math.max(up, down, 1))
}

const q = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-')

console.log(
  `\ncomplete markets: ${n}; trading net $${f2(net)} on $${f2(buyTot)} buys (${((100 * net) / buyTot).toFixed(2)}%); mean $${f2(net / n)}/mkt; win% ${((100 * wins) / n).toFixed(1)}`,
)
console.log('book mix (fill counts):', [...famCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
console.log(
  `buy size: p50=$${f2(q(buySizes, 0.5))} p90=$${f2(q(buySizes, 0.9))} p99=$${f2(q(buySizes, 0.99))}`,
)
console.log(
  `buy price: p5=${f2(q(buyPrices, 0.05))} p25=${f2(q(buyPrices, 0.25))} p50=${f2(q(buyPrices, 0.5))} p75=${f2(q(buyPrices, 0.75))} p95=${f2(q(buyPrices, 0.95))}`,
)
console.log(
  `leg imbalance |up−down|/max: p50=${(100 * q(legImbalances, 0.5)).toFixed(1)}% p90=${(100 * q(legImbalances, 0.9)).toFixed(1)}%`,
)
nets.sort((a, b) => a.net - b.net)
console.log('worst 3:', nets.slice(0, 3).map((x) => `${x.slug.slice(0, 38)} ${f2(x.net)}`))
console.log('best 3:', nets.slice(-3).map((x) => `${x.slug.slice(0, 38)} ${f2(x.net)}`))
