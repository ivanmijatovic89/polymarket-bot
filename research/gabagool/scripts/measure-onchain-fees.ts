/**
 * measure-onchain-fees.ts — per-fill maker/taker role + NET fee (after
 * operator in-tx refunds) for one wallet, from sampled tx receipts.
 *
 * Motivation (PRIORS A13): data-api /activity reports gross size/usdcSize;
 * net taker fees are docked in shares (buys) or USDC (sells) and refunded
 * partially in-tx by the operator module. Activity-based nets are
 * gross-of-fee. This script measures the true drag on-chain.
 *
 * Method: collect the wallet's TRADE rows for a slug family+window from an
 * activity JSONL, group by transactionHash, sample every k-th tx, fetch
 * receipts (POLYGON_RPC_URL, read-only), decode OrderFilled rows where
 * maker == wallet (role: taker if the row's `taker` topic == exchange,
 * else maker) and ERC1155/ERC20 transfers from the operator refund module
 * back to the wallet. Reports per-role fill counts, notional, gross fee,
 * refunds, net fee, and effective net-fee rate on taker notional.
 *
 * Usage: npx tsx research/gabagool/scripts/measure-onchain-fees.ts \
 *   --file <activity.jsonl> --address 0x... --prefix btc-updown-15m- \
 *   --from <iso> --to <iso> [--sample 150] [--concurrency 5]
 */
import { createReadStream, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = argOf('file')!
const address = argOf('address')!.toLowerCase()
const prefix = argOf('prefix') ?? 'btc-updown-15m-'
const fromSec = argOf('from') ? Date.parse(argOf('from')!) / 1000 : 0
const toSec = argOf('to') ? Date.parse(argOf('to')!) / 1000 : Infinity
const sampleN = Number(argOf('sample') ?? 150)
const concurrency = Number(argOf('concurrency') ?? 5)

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const rpc = env.POLYGON_RPC_URL
if (!rpc) throw new Error('POLYGON_RPC_URL missing from .env')

const EXCHANGES = new Set([
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // CTF exchange (v1)
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // negRisk CTF exchange
  '0xe111180000d2663c0091e4f400237545b87b996b', // 2026 exchange (fee-native)
])
// v1 charges 10%*min(p,1-p) to both sides and the operator module
// (0xe3f18acc...) refunds in-tx; only transfers from THAT module are fee
// refunds. The 2026 exchange charges the net fee directly (fee field =
// published curve for takers, 0 for makers) - no refunds.
const REFUND_MODULE = '0xe3f18acc55091e2c48d883fc8c8413319d4ab7b0'
const OF = '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6'
const OF2_PREFIX = '0xd543adfd' // fill event on the 2026 exchange
const TS = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const T20 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// 1) collect txs in window/family
const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
const txSet = new Set<string>()
for await (const line of rl) {
  if (!line) continue
  const r = JSON.parse(line)
  if (r.type !== 'TRADE' || !r.slug?.startsWith(prefix)) continue
  if (r.timestamp < fromSec || r.timestamp > toSec) continue
  txSet.add(r.transactionHash)
}
const allTxs = [...txSet]
const step = Math.max(1, Math.floor(allTxs.length / sampleN))
const sample = allTxs.filter((_, i) => i % step === 0).slice(0, sampleN)
console.log(`txs in window/family: ${allTxs.length}; sampling ${sample.length} (every ${step}th)`)

type Acc = { fills: number; notional: number; grossFee: number }
const acc: Record<'maker' | 'taker', Acc> = {
  maker: { fills: 0, notional: 0, grossFee: 0 },
  taker: { fills: 0, notional: 0, grossFee: 0 },
}
let refundsShares = 0 // valued at fill price where possible (per tx avg price)
let refundsUsdc = 0
let receiptsOk = 0

async function getReceipt(tx: string) {
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [tx] }),
      })
      const j = await res.json()
      if (j.result) return j.result
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (a + 1)))
  }
  return null
}

async function processTx(tx: string) {
  const rc = await getReceipt(tx)
  if (!rc) return
  receiptsOk++
  // token id -> price observed in this tx (from the wallet's own OF rows)
  const pxOf = new Map<string, number>()
  for (const log of rc.logs) {
    const isV1 = log.topics[0] === OF
    const isV2 = log.topics[0].startsWith(OF2_PREFIX) && log.topics.length === 4
    if (!isV1 && !isV2) continue
    const maker = ('0x' + log.topics[2].slice(26)).toLowerCase()
    if (maker !== address) continue
    const taker = ('0x' + log.topics[3].slice(26)).toLowerCase()
    const d = (log.data.slice(2).match(/.{64}/g) ?? []).map((h: string) => BigInt('0x' + h))
    const makerAssetId = d[0]
    const making = Number(d[2]) / 1e6
    const taking = Number(d[3]) / 1e6
    const fee = Number(d[4]) / 1e6
    const isBuy = makerAssetId === 0n
    const px = isBuy ? making / taking : taking / making
    const shares = isBuy ? taking : making
    const tokenId = (isBuy ? d[1] : d[0]).toString()
    pxOf.set(tokenId, px)
    const role: 'maker' | 'taker' = EXCHANGES.has(taker) ? 'taker' : 'maker'
    acc[role].fills++
    acc[role].notional += px * shares
    // v1: fee in output asset (shares for buys); v2: fee already USDC-denominated
    acc[role].grossFee += isV1 && isBuy ? fee * px : fee
  }
  for (const log of rc.logs) {
    if (log.topics[0] === TS) {
      const from = ('0x' + log.topics[2].slice(26)).toLowerCase()
      const to = ('0x' + log.topics[3].slice(26)).toLowerCase()
      if (to !== address || from !== REFUND_MODULE) continue
      const d = (log.data.slice(2).match(/.{64}/g) ?? []).map((h: string) => BigInt('0x' + h))
      const px = pxOf.get(d[0].toString()) ?? 0.5
      refundsShares += (Number(d[1]) / 1e6) * px
    } else if (log.topics[0] === T20 && log.topics.length === 3) {
      const from = ('0x' + log.topics[1].slice(26)).toLowerCase()
      const to = ('0x' + log.topics[2].slice(26)).toLowerCase()
      if (to !== address || from !== REFUND_MODULE) continue
      refundsUsdc += Number(BigInt(log.data)) / 1e6
    }
  }
}

let idx = 0
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (idx < sample.length) {
      const tx = sample[idx++]
      await processTx(tx)
      await new Promise((r) => setTimeout(r, 60))
    }
  }),
)

const gross = acc.maker.grossFee + acc.taker.grossFee
const refunds = refundsShares + refundsUsdc
const net = gross - refunds
const totNotional = acc.maker.notional + acc.taker.notional
console.log(`receipts decoded: ${receiptsOk}/${sample.length}`)
for (const role of ['maker', 'taker'] as const) {
  const a = acc[role]
  console.log(
    `${role}: fills=${a.fills} notional=$${a.notional.toFixed(2)} grossFee=$${a.grossFee.toFixed(2)}`,
  )
}
console.log(`refunds to wallet: shares(USD-valued)=$${refundsShares.toFixed(2)} usdc=$${refundsUsdc.toFixed(2)}`)
console.log(`NET fee: $${net.toFixed(2)} = ${((100 * net) / totNotional).toFixed(3)}% of sampled notional`)
console.log(
  `taker share of notional: ${((100 * acc.taker.notional) / totNotional).toFixed(1)}%; net fee on taker notional: ${acc.taker.notional ? ((100 * net) / acc.taker.notional).toFixed(3) : '-'}%`,
)
