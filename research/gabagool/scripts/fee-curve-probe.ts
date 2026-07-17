/**
 * fee-curve-probe.ts — implied TAKER fee-curve coefficient k in
 * netTakerFee = k · p(1−p) · shares, from sampled tx receipts.
 *
 * Purpose (OQ residue after A51): did the fee-curve reshape (peak
 * $0.78 → $1.75 per 100 shares, i.e. k 0.031 → 0.070) ship exactly at
 * the 2026-04-28 ~11:02Z v1→v2 exchange cutover? Run this on a window
 * just BEFORE (v1 era) and just AFTER (v2 era) and compare k.
 *
 * Method: sample txs from an activity JSONL (any wallet active in the
 * window — it is typically the MAKER; we measure the counterparty
 * taker side), fetch receipts, and per tx:
 *  - v1 rows (topic 0xd0a08e8c…): taker-order rows are those whose
 *    `taker` topic is an exchange address. Gross charge = fee field
 *    (share-denominated on buys, valued at the fill price); refunds =
 *    ERC1155/ERC20 transfers from the operator refund module
 *    (0xe3f18acc…) to the taker wallet in the same tx, valued at that
 *    token's fill price. Net = charge − refunds.
 *  - v2 rows (topic 0xd543adfd…): fee field IS the net USDC taker fee.
 *  - implied k(tx) = netFee / Σ shares·p(1−p) over the taker rows.
 * Reports per-price-band mean net fee per share + k, and the median k.
 *
 * Usage: npx tsx research/gabagool/scripts/fee-curve-probe.ts \
 *   --file <activity.jsonl> --from <iso> --to <iso> [--sample 80]
 *   [--rpc https://polygon.gateway.tenderly.co] [--concurrency 4]
 * Read-only; stdout only.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = argOf('file')!
const prefix = argOf('prefix') // optional slug-family filter, e.g. btc-updown-15m-
const fromSec = argOf('from') ? Date.parse(argOf('from')!) / 1000 : 0
const toSec = argOf('to') ? Date.parse(argOf('to')!) / 1000 : Infinity
const sampleN = Number(argOf('sample') ?? 80)
const RPC = argOf('rpc') ?? 'https://polygon.gateway.tenderly.co'
const concurrency = Number(argOf('concurrency') ?? 4)

const EXCHANGES = new Set([
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  '0xe111180000d2663c0091e4f400237545b87b996b',
])
const REFUND_MODULE = '0xe3f18acc55091e2c48d883fc8c8413319d4ab7b0'
const OF1 = '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6'
const OF2_PREFIX = '0xd543adfd'
const TS = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const T20 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
const txSet = new Set<string>()
for await (const line of rl) {
  if (!line) continue
  const r = JSON.parse(line)
  if (r.type !== 'TRADE') continue
  if (r.timestamp < fromSec || r.timestamp > toSec) continue
  if (prefix && !r.slug?.startsWith(prefix)) continue
  txSet.add(r.transactionHash)
}
const allTxs = [...txSet]
const step = Math.max(1, Math.floor(allTxs.length / sampleN))
const sample = allTxs.filter((_, i) => i % step === 0).slice(0, sampleN)
console.log(`txs in window: ${allTxs.length}; sampling ${sample.length}`)

async function getReceipt(tx: string) {
  for (let a = 0; a < 6; a++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [tx] }),
        signal: AbortSignal.timeout(30000),
      })
      const j = (await res.json()) as any
      if (j.result) return j.result
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500 * (a + 1)))
  }
  return null
}

type TxObs = { k: number; feePerShare: number; pbar: number; shares: number; era: 'v1' | 'v2' }
const obs: TxObs[] = []
let receiptsOk = 0
let skippedNoTaker = 0

async function processTx(tx: string) {
  const rc = await getReceipt(tx)
  if (!rc) return
  receiptsOk++
  const pxOf = new Map<string, number>()
  type Row = { wallet: string; px: number; shares: number; fee: number; era: 'v1' | 'v2'; isBuy: boolean }
  const takerRows: Row[] = []
  for (const log of rc.logs) {
    const isV1 = log.topics[0] === OF1
    const isV2 = log.topics[0].startsWith(OF2_PREFIX) && log.topics.length === 4
    if (!isV1 && !isV2) continue
    const maker = ('0x' + log.topics[2].slice(26)).toLowerCase()
    const taker = ('0x' + log.topics[3].slice(26)).toLowerCase()
    const d = (log.data.slice(2).match(/.{64}/g) ?? []).map((h: string) => BigInt('0x' + h))
    const making = Number(d[2]) / 1e6
    const taking = Number(d[3]) / 1e6
    const isBuy = d[0] === 0n
    if (isBuy ? taking === 0 : making === 0) continue
    const px = isBuy ? making / taking : taking / making
    const shares = isBuy ? taking : making
    const fee = Number(d[4]) / 1e6
    const tokenId = (isBuy ? d[1] : d[0]).toString()
    pxOf.set(tokenId, px)
    if (EXCHANGES.has(taker)) takerRows.push({ wallet: maker, px, shares, fee, era: isV1 ? 'v1' : 'v2', isBuy })
  }
  if (takerRows.length === 0) {
    skippedNoTaker++
    return
  }
  const takerWallet = takerRows[0].wallet
  // v1: value share-denominated buy fees at fill price; v2: fee already USDC
  let charge = 0
  for (const r of takerRows) charge += r.era === 'v1' && r.isBuy ? r.fee * r.px : r.fee
  let refunds = 0
  if (takerRows[0].era === 'v1') {
    for (const log of rc.logs) {
      if (log.topics[0] === TS) {
        const from = ('0x' + log.topics[2].slice(26)).toLowerCase()
        const to = ('0x' + log.topics[3].slice(26)).toLowerCase()
        if (to !== takerWallet || from !== REFUND_MODULE) continue
        const d = (log.data.slice(2).match(/.{64}/g) ?? []).map((h: string) => BigInt('0x' + h))
        refunds += (Number(d[1]) / 1e6) * (pxOf.get(d[0].toString()) ?? 0.5)
      } else if (log.topics[0] === T20 && log.topics.length === 3) {
        const from = ('0x' + log.topics[1].slice(26)).toLowerCase()
        const to = ('0x' + log.topics[2].slice(26)).toLowerCase()
        if (to !== takerWallet || from !== REFUND_MODULE) continue
        refunds += Number(BigInt(log.data)) / 1e6
      }
    }
  }
  const net = charge - refunds
  const shares = takerRows.reduce((s, r) => s + r.shares, 0)
  const pq = takerRows.reduce((s, r) => s + r.shares * r.px * (1 - r.px), 0)
  const pbar = takerRows.reduce((s, r) => s + r.shares * r.px, 0) / shares
  if (pq <= 0 || shares <= 0) return
  obs.push({ k: net / pq, feePerShare: net / shares, pbar, shares, era: takerRows[0].era })
}

let idx = 0
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (idx < sample.length) {
      const tx = sample[idx++]
      await processTx(tx)
      await new Promise((r) => setTimeout(r, 80))
    }
  }),
)

console.log(`receipts: ${receiptsOk}/${sample.length}; with taker rows: ${obs.length}; no-taker txs skipped: ${skippedNoTaker}`)
const byEra = new Map<string, TxObs[]>()
for (const o of obs) {
  if (!byEra.has(o.era)) byEra.set(o.era, [])
  byEra.get(o.era)!.push(o)
}
const dumpK = args.includes('--dump-k')
for (const [era, rows] of byEra) {
  const ks = rows.map((r) => r.k).sort((a, b) => a - b)
  if (dumpK) {
    const hist = new Map<string, number>()
    for (const k of ks) {
      const b = (Math.round(k * 200) / 200).toFixed(3)
      hist.set(b, (hist.get(b) ?? 0) + 1)
    }
    console.log(`k histogram (0.005 bins): ${[...hist].sort((a, b2) => Number(a[0]) - Number(b2[0])).map(([b, n]) => `${b}:${n}`).join(' ')}`)
  }
  const med = ks[Math.floor(ks.length / 2)]
  console.log(`\n== era ${era}: ${rows.length} txs; implied k median=${med.toFixed(4)} p10=${ks[Math.floor(ks.length * 0.1)].toFixed(4)} p90=${ks[Math.floor(ks.length * 0.9)].toFixed(4)}`)
  console.log(`   (k=0.031 ≈ old curve peak $0.78/100sh; k=0.070 = new curve peak $1.75/100sh)`)
  const bands = new Map<number, { fee: number; sh: number; n: number }>()
  for (const r of rows) {
    const b = Math.min(0.9, Math.max(0.1, Math.round(r.pbar * 10) / 10))
    const e = bands.get(b) ?? { fee: 0, sh: 0, n: 0 }
    e.fee += r.feePerShare * r.shares
    e.sh += r.shares
    e.n++
    bands.set(b, e)
  }
  console.log(`   price band | mean net fee /100sh | txs`)
  for (const [b, e] of [...bands].sort((a, b2) => a[0] - b2[0]))
    console.log(`   ${b.toFixed(1)} | $${((100 * e.fee) / e.sh).toFixed(3)} | ${e.n}`)
}
process.exit(0)
