/**
 * first-fill-2026-exchange.ts — OQ #4: when did trading START on the 2026
 * fee-native exchange (0xe111…996b, deployed 2026-03-31T02:39:03Z, block
 * 84902353), who migrated first, and how fast did crypto-updown flow move
 * over from the v1 exchanges?
 *
 * Phases:
 *  1. Find the first OrderFilled log on 0xe111… by forward-scanning from
 *     the deployment block in adaptive ranges (empty ranges are cheap; a
 *     range that errors on the provider's log cap is treated as
 *     "has logs" and bisected).
 *  2. Decode the first --hours hours of fills (same decoder as
 *     variant-scan.ts, A29 layout): per-wallet first-fill time, fills,
 *     notional; per-market series via token-map.json (cache-only).
 *  3. For --sample-days (comma list), count OrderFilled logs per exchange
 *     contract in the 15m window starting 12:00Z — the v1→2026 migration
 *     share curve.
 *
 * Usage: npx tsx research/gabagool/scripts/first-fill-2026-exchange.ts \
 *   [--hours 3] [--sample-days 2026-03-31,2026-04-01,...] [--rpc URL]
 * Output: research/gabagool/data/first-fill-2026-exchange.json + stdout.
 * Read-only outside data/.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const RPC = argOf('rpc') ?? 'https://polygon.drpc.org'
const HOURS = Number(argOf('hours') ?? 3)
const SAMPLE_DAYS = (argOf('sample-days') ?? '').split(',').filter(Boolean)

const NEW_EXCH = '0xe111180000d2663c0091e4f400237545b87b996b'
const V1_EXCHANGES = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
]
const OF1 = '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6'
const OF2 = '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee'
const DEPLOY_BLOCK = 84902353
const EXCH_SET = new Set([NEW_EXCH, ...V1_EXCHANGES])

let rpcCalls = 0
async function rpc(method: string, params: unknown[]): Promise<any> {
  for (let a = 0; a < 7; a++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(45000),
      })
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } }
      rpcCalls++
      if (j.error) throw new Error(`rpc:${j.error.message ?? JSON.stringify(j.error)}`)
      return j.result
    } catch (e) {
      if (a === 6) throw e
      await new Promise((r) => setTimeout(r, 700 * (a + 1)))
    }
  }
}

const blockTsCache = new Map<number, number>()
async function blockTs(bn: number): Promise<number> {
  const hit = blockTsCache.get(bn)
  if (hit !== undefined) return hit
  const b = await rpc('eth_getBlockByNumber', ['0x' + bn.toString(16), false])
  const ts = parseInt(b.timestamp, 16)
  blockTsCache.set(bn, ts)
  return ts
}
let headBn = 0
async function blockAt(tsSec: number): Promise<number> {
  if (!headBn) headBn = parseInt(await rpc('eth_blockNumber', []), 16)
  let lo = 1,
    hi = headBn
  const headTs = await blockTs(headBn)
  const guess = headBn - Math.floor((headTs - tsSec) / 2.2)
  if (guess > 1 && guess < headBn) {
    const gts = await blockTs(guess)
    if (gts <= tsSec) lo = guess
    else hi = guess
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((await blockTs(mid)) <= tsSec) lo = mid
    else hi = mid
  }
  return lo
}

async function logsIn(from: number, to: number, addresses: string[]): Promise<any[] | 'cap'> {
  try {
    return await rpc('eth_getLogs', [
      {
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        address: addresses,
        topics: [[OF1, OF2]],
      },
    ])
  } catch {
    return 'cap' // provider refused (log cap or range cap) — treat as "may contain logs"
  }
}

// Phase 1: forward-scan for the first log on the new exchange.
console.log(`phase 1: first OrderFilled on ${NEW_EXCH} from block ${DEPLOY_BLOCK}`)
let firstLog: any = null
{
  let cur = DEPLOY_BLOCK
  let range = 5000
  while (!firstLog) {
    const to = cur + range - 1
    const r = await logsIn(cur, to, [NEW_EXCH])
    if (r === 'cap') {
      if (range === 1) throw new Error(`provider refuses single-block getLogs at ${cur}`)
      range = Math.max(1, Math.floor(range / 2))
      continue
    }
    if (r.length > 0) {
      r.sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16))
      firstLog = r[0]
      break
    }
    cur = to + 1
    range = Math.min(range * 2, 20000)
    if (cur > DEPLOY_BLOCK + 3_000_000) throw new Error('no logs within ~3M blocks (~2.5 months) of deployment')
    await new Promise((r2) => setTimeout(r2, 120))
  }
}
const firstBn = parseInt(firstLog.blockNumber, 16)
const firstTs = await blockTs(firstBn)
console.log(`FIRST FILL: block ${firstBn}, ${new Date(firstTs * 1000).toISOString()}, tx ${firstLog.transactionHash}`)

// Phase 2: decode the first HOURS hours of fills.
function decodeLog(log: any) {
  const maker = ('0x' + log.topics[2].slice(26)).toLowerCase()
  const taker = ('0x' + log.topics[3].slice(26)).toLowerCase()
  const d = (log.data.slice(2).match(/.{64}/g) ?? []).map((h: string) => BigInt('0x' + h))
  const making = Number(d[2]) / 1e6
  const taking = Number(d[3]) / 1e6
  const isBuy = d[0] === 0n
  if (isBuy ? taking === 0 : making === 0) return null
  const px = isBuy ? making / taking : taking / making
  const shares = isBuy ? taking : making
  const tokenId = (isBuy || d[0] === 1n ? d[1] : d[0]).toString()
  const role: 'maker' | 'taker' = EXCH_SET.has(taker) ? 'taker' : 'maker'
  const bn = parseInt(log.blockNumber, 16)
  return { wallet: maker, tokenId, isBuy, px, shares, role, bn }
}

const endBn = await blockAt(firstTs + HOURS * 3600)
console.log(`phase 2: decoding fills ${firstBn}..${endBn} (${HOURS}h)`)
const fills: any[] = []
{
  let cur = firstBn
  let chunk = 100
  while (cur <= endBn) {
    const to = Math.min(cur + chunk - 1, endBn)
    const r = await logsIn(cur, to, [NEW_EXCH])
    if (r === 'cap') {
      if (chunk === 1) throw new Error(`single-block cap at ${cur}`)
      chunk = Math.max(1, Math.floor(chunk / 2))
      continue
    }
    for (const log of r) {
      const f = decodeLog(log)
      if (f) fills.push(f)
    }
    cur = to + 1
    await new Promise((r2) => setTimeout(r2, 100))
  }
}
console.log(`decoded ${fills.length} maker-perspective rows in first ${HOURS}h`)

// token → market series via cache only
const TOKEN_MAP = 'research/gabagool/data/variant-scan/token-map.json'
const tokenMap: Record<string, { slug?: string } | null> = existsSync(TOKEN_MAP) ? JSON.parse(readFileSync(TOKEN_MAP, 'utf8')) : {}
const seriesOf = (tokenId: string) => {
  const slug = tokenMap[tokenId]?.slug
  return slug ? slug.replace(/-\d+$/, '') : '(unmapped)'
}

type W = { firstBn: number; firstTs?: number; fills: number; notional: number; makerN: number; series: Map<string, number> }
const wallets = new Map<string, W>()
for (const f of fills) {
  let w = wallets.get(f.wallet)
  if (!w) wallets.set(f.wallet, (w = { firstBn: f.bn, fills: 0, notional: 0, makerN: 0, series: new Map() }))
  w.firstBn = Math.min(w.firstBn, f.bn)
  w.fills++
  const n = f.px * f.shares
  w.notional += n
  if (f.role === 'maker') w.makerN += n
  const s = seriesOf(f.tokenId)
  w.series.set(s, (w.series.get(s) ?? 0) + n)
}
const sorted = [...wallets.entries()].sort((a, b) => a[1].firstBn - b[1].firstBn)
console.log(`\n== earliest 25 wallets on the 2026 exchange (first ${HOURS}h) ==`)
for (const [addr, w] of sorted.slice(0, 25)) {
  const ts = new Date(((await blockTs(w.firstBn)) ?? 0) * 1000).toISOString()
  const topSeries = [...w.series].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([s, n]) => `${s}:$${n.toFixed(0)}`).join(' ')
  console.log(`${ts} ${addr} fills=${w.fills} $${w.notional.toFixed(0)} maker%=${((100 * w.makerN) / (w.notional || 1)).toFixed(0)} ${topSeries}`)
}
const bySeries = new Map<string, number>()
for (const f of fills) bySeries.set(seriesOf(f.tokenId), (bySeries.get(seriesOf(f.tokenId)) ?? 0) + f.px * f.shares)
console.log(`\n== series mix, first ${HOURS}h ==`)
for (const [s, n] of [...bySeries].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${s}: $${n.toFixed(0)}`)

// Phase 3: migration share on sample days (12:00Z 15m window each).
const migration: Array<{ day: string; v1Logs: number; newLogs: number }> = []
for (const day of SAMPLE_DAYS) {
  const start = Date.parse(`${day}T12:00:00Z`) / 1000
  const from = await blockAt(start)
  const to = await blockAt(start + 900)
  let v1Logs = 0
  let newLogs = 0
  let cur = from
  let chunk = 100
  while (cur <= to) {
    const end = Math.min(cur + chunk - 1, to)
    const r = await logsIn(cur, end, [NEW_EXCH, ...V1_EXCHANGES])
    if (r === 'cap') {
      chunk = Math.max(1, Math.floor(chunk / 2))
      continue
    }
    for (const log of r) {
      if (log.address.toLowerCase() === NEW_EXCH) newLogs++
      else v1Logs++
    }
    cur = end + 1
    await new Promise((r2) => setTimeout(r2, 100))
  }
  migration.push({ day, v1Logs, newLogs })
  console.log(`migration ${day} 12:00Z+15m: v1=${v1Logs} new=${newLogs} (${((100 * newLogs) / (v1Logs + newLogs || 1)).toFixed(1)}% new)`)
}

writeFileSync(
  'research/gabagool/data/first-fill-2026-exchange.json',
  JSON.stringify(
    {
      firstFill: { block: firstBn, ts: firstTs, iso: new Date(firstTs * 1000).toISOString(), tx: firstLog.transactionHash },
      hours: HOURS,
      fills: fills.length,
      earliestWallets: sorted.slice(0, 50).map(([addr, w]) => ({
        addr,
        firstBn: w.firstBn,
        fills: w.fills,
        notional: Math.round(w.notional),
        makerPct: Math.round((100 * w.makerN) / (w.notional || 1)),
        series: [...w.series].sort((x, y) => y[1] - x[1]).slice(0, 5),
      })),
      seriesMix: [...bySeries].sort((a, b) => b[1] - a[1]),
      migration,
      rpcCalls,
    },
    null,
    2,
  ),
)
console.log(`\nsaved -> research/gabagool/data/first-fill-2026-exchange.json (rpc calls: ${rpcCalls})`)
process.exit(0)
