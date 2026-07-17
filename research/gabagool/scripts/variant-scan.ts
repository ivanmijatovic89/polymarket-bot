/**
 * variant-scan.ts — W0 variant atlas: full two-sided tape scan of crypto
 * up/down books from on-chain OrderFilled logs.
 *
 * WHY on-chain: data-api /trades is TAKER-ONLY (verified 2026-07-17: tx
 * 0xacc56fb8… had 3 maker counterparties on-chain, zero /trades rows for
 * them). A /trades-based scan would miss pure-maker variants — the exact
 * archetype. OrderFilled names both sides of every fill.
 *
 * Method:
 * - Sample 15m windows of a UTC day (--every N picks every Nth window).
 * - ts→block via binary search (eth_getBlockByNumber).
 * - eth_getLogs on the 3 exchange contracts (CTF v1, negRisk, 2026
 *   fee-native), topics OrderFilled v1+v2, chunked ≤100 blocks (dRPC
 *   free-tier log-count limit; auto-halves chunk on error).
 * - Decode each row: wallet = `maker` topic; role = taker∈exchanges ?
 *   'taker' (aggregate row) : 'maker'. BUY iff makerAssetId==0
 *   (px=making/taking, shares=taking, tokenId=takerAssetId); SELL
 *   mirrored. Each wallet's fills counted exactly once.
 * - Aggregate per (wallet, tokenId); resolve tokenIds → market/outcome
 *   via gamma ?clob_token_ids= (batched, cached in token-map.json);
 *   keep only *-updown-* markets; fold Up/Down legs per (wallet, book).
 * - Classify: pairRate = Σmin(buyUp,buyDn)/Σmax across markets,
 *   pairCost = avg buyUp px + avg buyDn px, maker share, sell share,
 *   clip sizes (reservoir), books traded.
 *
 * Usage: npx tsx research/gabagool/scripts/variant-scan.ts \
 *   --day 2026-07-15 [--every 8] [--max-windows N] [--min-fills 10]
 *   [--out research/gabagool/data/variant-scan]
 *
 * Output: <out>/scan-<day>.json (per-wallet aggregates + per-book cells)
 *         <out>/token-map.json (cache, grows across runs)
 * Read-only everywhere except <out>.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const day = argOf('day')
if (!day) {
  console.error('required: --day YYYY-MM-DD')
  process.exit(1)
}
const every = Number(argOf('every') ?? 8)
const maxWindows = Number(argOf('max-windows') ?? 96)
const minFills = Number(argOf('min-fills') ?? 10)
const outDir = argOf('out') ?? 'research/gabagool/data/variant-scan'
mkdirSync(outDir, { recursive: true })

const RPC = argOf('rpc') ?? 'https://polygon.drpc.org'
const OF1 = '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6'
const OF2 = '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee'
const EXCHANGES = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  '0xe111180000d2663c0091e4f400237545b87b996b',
]
const EXCH_SET = new Set(EXCHANGES)

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

// ---- ts→block binary search (with per-run cache of probes)
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
  // seed with a rough 2.2s/block guess to narrow fast
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

// ---- getLogs chunked with adaptive halving
async function getLogsRange(from: number, to: number): Promise<any[]> {
  const out: any[] = []
  let chunk = 100
  let cur = from
  while (cur <= to) {
    const end = Math.min(cur + chunk - 1, to)
    try {
      const logs = await rpc('eth_getLogs', [
        {
          fromBlock: '0x' + cur.toString(16),
          toBlock: '0x' + end.toString(16),
          address: EXCHANGES,
          topics: [[OF1, OF2]],
        },
      ])
      out.push(...logs)
      cur = end + 1
      await new Promise((r) => setTimeout(r, 120))
    } catch (e) {
      if (chunk > 10) {
        chunk = Math.floor(chunk / 2)
        continue
      }
      throw e
    }
  }
  return out
}

// ---- aggregation
type Cell = {
  buySh: number
  buyN: number
  sellSh: number
  sellN: number
  makerN: number
  takerN: number
  fills: number
  sizes: number[] // reservoir ≤ 200
  minBn: number
  maxBn: number
}
const cells = new Map<string, Cell>() // `${wallet}|${tokenIdDec}`
let reservoirSeen = new Map<string, number>()
function addFill(wallet: string, tokenId: string, isBuy: boolean, px: number, sh: number, role: 'maker' | 'taker', bn: number) {
  const k = `${wallet}|${tokenId}`
  let c = cells.get(k)
  if (!c) {
    c = { buySh: 0, buyN: 0, sellSh: 0, sellN: 0, makerN: 0, takerN: 0, fills: 0, sizes: [], minBn: bn, maxBn: bn }
    cells.set(k, c)
  }
  const n = px * sh
  if (isBuy) {
    c.buySh += sh
    c.buyN += n
  } else {
    c.sellSh += sh
    c.sellN += n
  }
  if (role === 'maker') c.makerN += n
  else c.takerN += n
  c.fills++
  c.minBn = Math.min(c.minBn, bn)
  c.maxBn = Math.max(c.maxBn, bn)
  const seen = (reservoirSeen.get(k) ?? 0) + 1
  reservoirSeen.set(k, seen)
  if (c.sizes.length < 200) c.sizes.push(n)
  else {
    const j = Math.floor((seen * 2654435761) % seen) // deterministic pseudo-random slot
    if (j < 200) c.sizes[j] = n
  }
}

function decodeLog(log: any) {
  const maker = ('0x' + log.topics[2].slice(26)).toLowerCase()
  const taker = ('0x' + log.topics[3].slice(26)).toLowerCase()
  const d = (log.data.slice(2).match(/.{64}/g) ?? []).map((h: string) => BigInt('0x' + h))
  // Layouts (verified 2026-07-17 on tx 0x7711684…, session 7 / A29):
  //  - v1 contracts: d = (makerAssetId, takerAssetId, making, taking, fee)
  //    BUY: makerAssetId=0, tokenId=d[1]; SELL: makerAssetId=tokenId (huge).
  //  - 2026 fee-native exchange (0xe111…): d[0] is a SIDE FLAG (0=maker
  //    gives USDC/buy, 1=maker gives token/sell) and tokenId is ALWAYS
  //    d[1]. Old rule read SELL tokenId from d[0] → binned all sells
  //    under token "1" (never resolves → dropped). Real CTF token ids
  //    are keccak-derived, so d[0]==1 is unambiguous.
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

// ---- main loop over sampled windows
const dayStartSec = Date.parse(`${day}T00:00:00Z`) / 1000
if (!Number.isFinite(dayStartSec)) {
  console.error(`bad --day: ${day}`)
  process.exit(1)
}
const windows: number[] = []
for (let w = 0; w < 96 && windows.length < maxWindows; w += every) windows.push(dayStartSec + w * 900)

let totalLogs = 0
for (const [i, epoch] of windows.entries()) {
  const from = await blockAt(epoch)
  const to = await blockAt(epoch + 900)
  const logs = await getLogsRange(from, to + 1)
  totalLogs += logs.length
  let decoded = 0
  for (const log of logs) {
    const f = decodeLog(log)
    if (!f) continue
    addFill(f.wallet, f.tokenId, f.isBuy, f.px, f.shares, f.role, f.bn)
    decoded++
  }
  console.log(
    `[${i + 1}/${windows.length}] ${new Date(epoch * 1000).toISOString().slice(11, 16)}Z blocks ${from}..${to} logs=${logs.length} decoded=${decoded} cells=${cells.size} rpcCalls=${rpcCalls}`,
  )
}

// ---- resolve tokenIds → market (gamma, batched, cached)
const tokenMapPath = join(outDir, 'token-map.json')
const tokenMap: Record<string, { slug: string; outcome: string } | null> = existsSync(tokenMapPath)
  ? JSON.parse(readFileSync(tokenMapPath, 'utf8'))
  : {}
const tokenNotional = new Map<string, number>()
for (const [k, c] of cells) {
  const t = k.split('|')[1]
  tokenNotional.set(t, (tokenNotional.get(t) ?? 0) + c.buyN + c.sellN)
}
const toResolve = [...tokenNotional.entries()]
  .filter(([t, n]) => tokenMap[t] === undefined && n >= 10)
  .sort((a, b) => b[1] - a[1])
  .map(([t]) => t)
console.log(`tokenIds: ${tokenNotional.size} seen, ${toResolve.length} to resolve (≥$10 notional)`)

// gamma /markets excludes closed markets unless closed=true; param must be
// REPEATED (comma-joined → 422). Historical scans are ~all closed markets,
// so pass closed=true first, then retry leftovers without it (open markets).
async function gammaBatch(ids: string[], closed: boolean): Promise<void> {
  const q = ids.map((id) => `clob_token_ids=${id}`).join('&')
  const url = `https://gamma-api.polymarket.com/markets?${q}${closed ? '&closed=true' : ''}&limit=${ids.length}`
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`gamma ${res.status}`)
      const ms = (await res.json()) as Array<{ slug: string; outcomes: string; clobTokenIds: string }>
      for (const m of ms) {
        const outs = JSON.parse(m.outcomes) as string[]
        const toks = JSON.parse(m.clobTokenIds) as string[]
        toks.forEach((t, i) => {
          tokenMap[t] = { slug: m.slug, outcome: outs[i] }
        })
      }
      return
    } catch (e) {
      if (a === 4) {
        console.error(`gamma batch failed (${ids.length} ids): ${String(e).slice(0, 120)}`)
        return
      }
      await new Promise((r) => setTimeout(r, 800 * (a + 1)))
    }
  }
}
for (let i = 0; i < toResolve.length; i += 20) {
  await gammaBatch(toResolve.slice(i, i + 20), true)
  if (i % 400 === 0 && i > 0) console.log(`resolved pass1 ${i}/${toResolve.length}`)
  await new Promise((r) => setTimeout(r, 100))
}
const leftover = toResolve.filter((t) => tokenMap[t] === undefined)
console.log(`pass1 (closed) resolved ${toResolve.length - leftover.length}/${toResolve.length}; pass2 (open) on ${leftover.length}`)
for (let i = 0; i < leftover.length; i += 20) {
  await gammaBatch(leftover.slice(i, i + 20), false)
  await new Promise((r) => setTimeout(r, 100))
}
for (const id of toResolve) if (tokenMap[id] === undefined) tokenMap[id] = null // not found anywhere
writeFileSync(tokenMapPath, JSON.stringify(tokenMap))

// ---- fold token cells → (wallet, marketSlug) with Up/Down legs
const UPDOWN = /-updown-|-up-or-down-/
type BookCell = {
  buyUpSh: number
  buyUpN: number
  buyDnSh: number
  buyDnN: number
  sellSh: number
  sellN: number
  makerN: number
  takerN: number
  fills: number
  sizes: number[]
}
const wm = new Map<string, BookCell>() // `${wallet}|${slug}`
let unresolvedN = 0
let nonUpdownN = 0
let updownN = 0
for (const [k, c] of cells) {
  const [wallet, t] = k.split('|')
  const m = tokenMap[t]
  if (!m) {
    unresolvedN += c.buyN + c.sellN
    continue
  }
  if (!UPDOWN.test(m.slug)) {
    nonUpdownN += c.buyN + c.sellN
    continue
  }
  updownN += c.buyN + c.sellN
  const bk = `${wallet}|${m.slug}`
  let b = wm.get(bk)
  if (!b) {
    b = { buyUpSh: 0, buyUpN: 0, buyDnSh: 0, buyDnN: 0, sellSh: 0, sellN: 0, makerN: 0, takerN: 0, fills: 0, sizes: [] }
    wm.set(bk, b)
  }
  const isUp = m.outcome.toLowerCase() === 'up'
  if (isUp) {
    b.buyUpSh += c.buySh
    b.buyUpN += c.buyN
  } else {
    b.buyDnSh += c.buySh
    b.buyDnN += c.buyN
  }
  b.sellSh += c.sellSh
  b.sellN += c.sellN
  b.makerN += c.makerN
  b.takerN += c.takerN
  b.fills += c.fills
  b.sizes.push(...c.sizes.slice(0, 50))
}
console.log(
  `notional split: updown $${updownN.toFixed(0)} | other-markets $${nonUpdownN.toFixed(0)} | unresolved $${unresolvedN.toFixed(0)}`,
)

// ---- per-wallet classification across the sample
type WalletAgg = {
  wallet: string
  books: Map<string, { markets: number; fills: number; notional: number }>
  markets: number
  fills: number
  buyN: number
  sellN: number
  makerN: number
  takerN: number
  pairMinSh: number
  pairMaxSh: number
  pairCostNum: number // Σ over markets with both legs: (avgUp+avgDn) * pairedShares
  pairCostDen: number
  sizes: number[]
}
const wallets = new Map<string, WalletAgg>()
const familyOf = (slug: string) => slug.replace(/-\d+$/, '')
for (const [bk, b] of wm) {
  const [wallet, slug] = bk.split('|')
  let w = wallets.get(wallet)
  if (!w) {
    w = {
      wallet,
      books: new Map(),
      markets: 0,
      fills: 0,
      buyN: 0,
      sellN: 0,
      makerN: 0,
      takerN: 0,
      pairMinSh: 0,
      pairMaxSh: 0,
      pairCostNum: 0,
      pairCostDen: 0,
      sizes: [],
    }
    wallets.set(wallet, w)
  }
  const fam = familyOf(slug)
  const fb = w.books.get(fam) ?? { markets: 0, fills: 0, notional: 0 }
  fb.markets++
  fb.fills += b.fills
  fb.notional += b.buyUpN + b.buyDnN + b.sellN
  w.books.set(fam, fb)
  w.markets++
  w.fills += b.fills
  w.buyN += b.buyUpN + b.buyDnN
  w.sellN += b.sellN
  w.makerN += b.makerN
  w.takerN += b.takerN
  const mn = Math.min(b.buyUpSh, b.buyDnSh)
  const mx = Math.max(b.buyUpSh, b.buyDnSh)
  w.pairMinSh += mn
  w.pairMaxSh += mx
  if (b.buyUpSh > 0 && b.buyDnSh > 0) {
    const pc = b.buyUpN / b.buyUpSh + b.buyDnN / b.buyDnSh
    w.pairCostNum += pc * mn
    w.pairCostDen += mn
  }
  if (w.sizes.length < 400) w.sizes.push(...b.sizes.slice(0, 40))
}

const rows = [...wallets.values()]
  .filter((w) => w.fills >= minFills)
  .map((w) => {
    const sizes = w.sizes.sort((a, b) => a - b)
    return {
      wallet: w.wallet,
      markets: w.markets,
      fills: w.fills,
      notional: +(w.buyN + w.sellN).toFixed(0),
      buyShare: +(w.buyN / (w.buyN + w.sellN || 1)).toFixed(3),
      makerShare: +(w.makerN / (w.makerN + w.takerN || 1)).toFixed(3),
      pairRate: +(w.pairMaxSh > 0 ? w.pairMinSh / w.pairMaxSh : 0).toFixed(3),
      pairCost: w.pairCostDen > 0 ? +(w.pairCostNum / w.pairCostDen).toFixed(4) : null,
      clipP50: sizes.length ? +sizes[Math.floor(sizes.length / 2)].toFixed(2) : null,
      books: Object.fromEntries([...w.books.entries()].map(([f, v]) => [f, v.notional > 100 ? +v.notional.toFixed(0) : undefined]).filter(([, v]) => v !== undefined) as [string, number][]),
    }
  })
  .sort((a, b) => b.notional - a.notional)

const outPath = join(outDir, `scan-${day}.json`)
writeFileSync(
  outPath,
  JSON.stringify(
    {
      day,
      every,
      windows: windows.length,
      totalLogs,
      notionalSplit: { updown: +updownN.toFixed(0), other: +nonUpdownN.toFixed(0), unresolved: +unresolvedN.toFixed(0) },
      wallets: rows,
    },
    null,
    1,
  ),
)
console.log(`\nwrote ${outPath}: ${rows.length} wallets with ≥${minFills} fills on updown books`)

// console table: top pair-accumulator candidates
const cands = rows.filter((r) => r.pairRate >= 0.25 && r.buyShare >= 0.6)
console.log(`\npair-accumulator candidates (pairRate≥0.25, buyShare≥0.6): ${cands.length}`)
for (const r of cands.slice(0, 40)) {
  console.log(
    `${r.wallet.slice(0, 10)}  n=$${String(r.notional).padStart(8)}  mkts=${String(r.markets).padStart(3)}  fills=${String(r.fills).padStart(5)}  pairRate=${r.pairRate}  pairCost=${r.pairCost ?? '-'}  maker=${r.makerShare}  clip=$${r.clipP50}  books=${Object.keys(r.books).join(',')}`,
  )
}
process.exit(0)
