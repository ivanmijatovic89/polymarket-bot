/**
 * bisect-cutover.ts — pin the v1→2026-exchange cutover day/hour.
 * For each --at <ISO> timestamp, counts OrderFilled logs per exchange
 * group in the 15m window starting there (same method as
 * first-fill-2026-exchange.ts phase 3). Read-only; stdout only.
 *
 * Usage: npx tsx research/gabagool/scripts/bisect-cutover.ts \
 *   [--rpc URL] --at 2026-04-24T12:00:00Z,2026-04-21T12:00:00Z,...
 */
const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const RPC = argOf('rpc') ?? 'https://polygon.gateway.tenderly.co'
const ATS = (argOf('at') ?? '').split(',').filter(Boolean)

const NEW_EXCH = '0xe111180000d2663c0091e4f400237545b87b996b'
const V1_EXCHANGES = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
]
const OF1 = '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6'
const OF2 = '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee'

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
      if (j.error) throw new Error(`rpc:${j.error.message}`)
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

async function countIn(from: number, to: number, addresses: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  let cur = from
  let chunk = 200
  while (cur <= to) {
    const end = Math.min(cur + chunk - 1, to)
    let r: any[]
    try {
      r = await rpc('eth_getLogs', [
        {
          fromBlock: '0x' + cur.toString(16),
          toBlock: '0x' + end.toString(16),
          address: addresses,
          topics: [[OF1, OF2]],
        },
      ])
    } catch {
      if (chunk === 1) throw new Error(`single-block cap at ${cur}`)
      chunk = Math.max(1, Math.floor(chunk / 2))
      continue
    }
    for (const log of r) {
      const a = log.address.toLowerCase()
      counts.set(a, (counts.get(a) ?? 0) + 1)
    }
    cur = end + 1
    await new Promise((r2) => setTimeout(r2, 80))
  }
  return counts
}

for (const at of ATS) {
  const start = Date.parse(at) / 1000
  if (!Number.isFinite(start)) {
    console.log(`skip unparseable --at ${at}`)
    continue
  }
  const from = await blockAt(start)
  const to = await blockAt(start + 900)
  const counts = await countIn(from, to, [NEW_EXCH, ...V1_EXCHANGES])
  const v1 = V1_EXCHANGES.reduce((s, a) => s + (counts.get(a) ?? 0), 0)
  const nw = counts.get(NEW_EXCH) ?? 0
  console.log(`${at} +15m: v1=${v1} new=${nw} (${((100 * nw) / (v1 + nw || 1)).toFixed(1)}% new)`)
}
process.exit(0)
