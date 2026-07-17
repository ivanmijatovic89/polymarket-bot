/**
 * analyze-tail.ts — per-market forensics over an activity JSONL pulled by
 * pull-activity.ts. Pure cash-flow accounting: BUY = −usdc, SELL/REDEEM/
 * MERGE = +usdc, so per-market net needs no resolution oracle.
 *
 * Usage: npx tsx research/gabagool/scripts/analyze-tail.ts \
 *          --file research/gabagool/data/activity-gabagool22.jsonl \
 *          [--from <iso>] [--to <iso>]   (bounds on market first-fill time)
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = argOf('file')
if (!file) throw new Error('--file required')
const fromSec = argOf('from') ? Date.parse(argOf('from')!) / 1000 : 0
const toSec = argOf('to') ? Date.parse(argOf('to')!) / 1000 : Infinity

type Row = {
  timestamp: number
  type: string
  side?: string
  size?: number
  usdcSize?: number
  price?: number
  slug?: string
  outcome?: string
  outcomeIndex?: number
}

type MarketAgg = {
  slug: string
  family: string
  firstTs: number
  lastTs: number
  fills: number
  buys: number
  sells: number
  buyUsd: number
  sellUsd: number
  redeemUsd: number
  mergeUsd: number
  merges: number
  redeems: number
  upShares: number
  upCost: number
  downShares: number
  downCost: number
  sellUpShares: number
  sellDownShares: number
  fillTs: number[]
  cash: { ts: number; delta: number }[]
}

function familyOf(slug: string): string {
  const m = slug.match(/^(btc|eth|sol|xrp)-updown-(\d+m)-/)
  if (m) return `${m[1]}-${m[2]}`
  if (/^(bitcoin|ethereum|solana|xrp)-up-or-down-.*-(\d{1,2}(am|pm))-et$/.test(slug)) {
    const coin = slug.startsWith('bitcoin') ? 'btc' : slug.startsWith('ethereum') ? 'eth' : slug.startsWith('solana') ? 'sol' : 'xrp'
    return `${coin}-1h`
  }
  if (/up-or-down/.test(slug)) {
    const coin = slug.startsWith('bitcoin') ? 'btc' : slug.startsWith('ethereum') ? 'eth' : slug.startsWith('solana') ? 'sol' : 'xrp'
    return `${coin}-other`
  }
  return 'other'
}

const markets = new Map<string, MarketAgg>()

const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
let rows = 0
for await (const line of rl) {
  if (!line) continue
  const r = JSON.parse(line) as Row
  rows++
  const slug = r.slug || ''
  if (!slug) continue
  let m = markets.get(slug)
  if (!m) {
    m = {
      slug, family: familyOf(slug), firstTs: r.timestamp, lastTs: r.timestamp,
      fills: 0, buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, redeemUsd: 0,
      mergeUsd: 0, merges: 0, redeems: 0, upShares: 0, upCost: 0,
      downShares: 0, downCost: 0, sellUpShares: 0, sellDownShares: 0,
      fillTs: [], cash: [],
    }
    markets.set(slug, m)
  }
  m.firstTs = Math.min(m.firstTs, r.timestamp)
  m.lastTs = Math.max(m.lastTs, r.timestamp)
  const usd = r.usdcSize ?? 0
  if (r.type === 'TRADE') {
    m.fills++
    m.fillTs.push(r.timestamp)
    const isUp = (r.outcome || '').toLowerCase() === 'up'
    if (r.side === 'BUY') {
      m.buys++
      m.buyUsd += usd
      m.cash.push({ ts: r.timestamp, delta: -usd })
      if (isUp) { m.upShares += r.size ?? 0; m.upCost += usd }
      else { m.downShares += r.size ?? 0; m.downCost += usd }
    } else {
      m.sells++
      m.sellUsd += usd
      m.cash.push({ ts: r.timestamp, delta: +usd })
      if (isUp) m.sellUpShares += r.size ?? 0
      else m.sellDownShares += r.size ?? 0
    }
  } else if (r.type === 'REDEEM') {
    m.redeems++
    m.redeemUsd += usd
    m.cash.push({ ts: r.timestamp, delta: +usd })
  } else if (r.type === 'MERGE') {
    m.merges++
    m.mergeUsd += usd
    m.cash.push({ ts: r.timestamp, delta: +usd })
  }
}

// completed-market filter: needs ≥1 fill (fills=0 = start-truncated: buys
// predate the data file) and margins on both ends so entries and exits are
// fully inside the pulled data (end-truncated markets look like total
// losses). Margins: 1h after `from`, 2h before `to`.
const all = [...markets.values()].filter(
  (m) => m.fills > 0 && m.firstTs >= fromSec + 3600 && m.lastTs <= toSec - 7200,
)

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.floor(q * s.length))
  return s[i]
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-')

console.log(`rows=${rows} markets(total)=${markets.size} markets(in-window)=${all.length}\n`)

const byFamily = new Map<string, MarketAgg[]>()
for (const m of all) {
  if (!byFamily.has(m.family)) byFamily.set(m.family, [])
  byFamily.get(m.family)!.push(m)
}

console.log('| family | mkts | fills p50 | fills p90 | fills max | net$ mean | net$ p10 | net$ p50 | net$ p90 | win% | pairCost p50 | paired p50 | unpaired$ p50 | maxOutlay p50 | maxOutlay max |')
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')

const globalGapAll: number[] = []
for (const [fam, ms] of [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const nets: number[] = []
  const fillsArr: number[] = []
  const pairCosts: number[] = []
  const pairedArr: number[] = []
  const unpairedUsd: number[] = []
  const outlays: number[] = []
  let wins = 0
  for (const m of ms) {
    const net = m.sellUsd + m.redeemUsd + m.mergeUsd - m.buyUsd
    nets.push(net)
    if (net > 0) wins++
    fillsArr.push(m.fills)
    const netUp = m.upShares - m.sellUpShares
    const netDown = m.downShares - m.sellDownShares
    const paired = Math.min(netUp, netDown)
    pairedArr.push(paired)
    if (m.upShares > 0 && m.downShares > 0) {
      pairCosts.push(m.upCost / m.upShares + m.downCost / m.downShares)
    }
    const unpaired = Math.max(netUp, netDown) - paired
    const side = netUp > netDown ? 'up' : 'down'
    const avg = side === 'up'
      ? (m.upShares ? m.upCost / m.upShares : 0)
      : (m.downShares ? m.downCost / m.downShares : 0)
    unpairedUsd.push(unpaired * avg)
    // max outlay = min of running cash
    let run = 0
    let minRun = 0
    for (const c of m.cash.sort((a, b) => a.ts - b.ts)) {
      run += c.delta
      if (run < minRun) minRun = run
    }
    outlays.push(-minRun)
    const ts = m.fillTs.sort((a, b) => a - b)
    for (let i = 1; i < ts.length; i++) globalGapAll.push(ts[i] - ts[i - 1])
  }
  console.log(
    `| ${fam} | ${ms.length} | ${quantile(fillsArr, 0.5)} | ${quantile(fillsArr, 0.9)} | ${Math.max(...fillsArr)} | ${f2(nets.reduce((a, b) => a + b, 0) / nets.length)} | ${f2(quantile(nets, 0.1))} | ${f2(quantile(nets, 0.5))} | ${f2(quantile(nets, 0.9))} | ${((wins / ms.length) * 100).toFixed(1)} | ${f2(quantile(pairCosts, 0.5))} | ${f2(quantile(pairedArr, 0.5))} | ${f2(quantile(unpairedUsd, 0.5))} | ${f2(quantile(outlays, 0.5))} | ${f2(Math.max(...outlays))} |`,
  )
}

// global aggregates
const nets = all.map((m) => m.sellUsd + m.redeemUsd + m.mergeUsd - m.buyUsd)
const totalNet = nets.reduce((a, b) => a + b, 0)
const totalBuy = all.reduce((a, b) => a + b.buyUsd, 0)
const totalSell = all.reduce((a, b) => a + b.sellUsd, 0)
const totalRedeem = all.reduce((a, b) => a + b.redeemUsd, 0)
const totalMerge = all.reduce((a, b) => a + b.mergeUsd, 0)
console.log(`\nTOTALS (in-window markets): net=$${f2(totalNet)} buys=$${f2(totalBuy)} sells=$${f2(totalSell)} redeems=$${f2(totalRedeem)} merges=$${f2(totalMerge)}`)
console.log(`net as % of buy turnover: ${((totalNet / totalBuy) * 100).toFixed(3)}%`)
console.log(`inter-fill gap sec (within-market): p50=${quantile(globalGapAll, 0.5)} mean=${f2(globalGapAll.reduce((a, b) => a + b, 0) / globalGapAll.length)} p90=${quantile(globalGapAll, 0.9)}`)

// worst/best tail
const sorted = [...all].sort((a, b) => (a.sellUsd + a.redeemUsd + a.mergeUsd - a.buyUsd) - (b.sellUsd + b.redeemUsd + b.mergeUsd - b.buyUsd))
console.log('\nworst 8 markets:')
for (const m of sorted.slice(0, 8)) console.log(`  ${m.slug} net=${f2(m.sellUsd + m.redeemUsd + m.mergeUsd - m.buyUsd)} fills=${m.fills} buy=$${f2(m.buyUsd)}`)
console.log('best 5 markets:')
for (const m of sorted.slice(-5)) console.log(`  ${m.slug} net=${f2(m.sellUsd + m.redeemUsd + m.mergeUsd - m.buyUsd)} fills=${m.fills} buy=$${f2(m.buyUsd)}`)

// buy price distribution (sample)
const buyPrices: number[] = []
const rl2 = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
for await (const line of rl2) {
  if (!line) continue
  const r = JSON.parse(line) as Row
  if (r.type === 'TRADE' && r.side === 'BUY' && r.price) buyPrices.push(r.price)
}
console.log(`\nbuy price distribution: p5=${quantile(buyPrices, 0.05)} p25=${quantile(buyPrices, 0.25)} p50=${quantile(buyPrices, 0.5)} p75=${quantile(buyPrices, 0.75)} p95=${quantile(buyPrices, 0.95)}`)
const buySizes: number[] = []
const rl3 = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
for await (const line of rl3) {
  if (!line) continue
  const r = JSON.parse(line) as Row
  if (r.type === 'TRADE' && r.side === 'BUY' && r.usdcSize) buySizes.push(r.usdcSize)
}
console.log(`buy usd size: p25=${f2(quantile(buySizes, 0.25))} p50=${f2(quantile(buySizes, 0.5))} p90=${f2(quantile(buySizes, 0.9))} p99=${f2(quantile(buySizes, 0.99))} max=${f2(buySizes.reduce((a, b) => Math.max(a, b), 0))}`)
