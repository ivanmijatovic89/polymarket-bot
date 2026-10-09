/**
 * Golden generator (60 §7.1 GF-1/GF-2; 13 §11 "compat goldens"): runs the
 * real TS `BacktestExecution` (the oracle for ts-compat execution, 00 R3) in
 * isolation over the synthetic books of compat_scenarios.txt and writes the
 * emitted events, rendered in the simulator test's text format, to
 * compat_expected.txt.
 *
 * Event mapping (13 §5.1, §5.4; 10 S3): `ws_order_update` renders as
 * `status`; the `CANCELED` update after a FOK kill has no Rust counterpart
 * (13 §5.4) and is omitted; `order_done` carries the filled quantity (TS
 * omits it for `filled`, which is the order size, and for `killed`, which
 * is 0 for a FOK); TAKER fill fees use `computePolymarketTakerFee`, as the
 * TS portfolio does.
 *
 * Usage: npx tsx native/crates/pmb-engine/src/exec/sim/tests/golden/compat_gen.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BacktestExecution } from '../../../../../../../../src/trading/execution/BacktestExecution.js'
import { computePolymarketTakerFee } from '../../../../../../../../src/trading/fees.js'
import type { OrderBookSnapshot } from '../../../../../../../../src/market/orderbook/index.js'
import type { OrderManagerContext } from '../../../../../../../../src/trading/OrderManager.js'
import type { AccountEvent } from '../../../../../../../../src/strategy/Strategy.js'

const dir = import.meta.dirname
const MARKET = '0x' + '07'.repeat(32)
const ASSET: Record<string, string> = { up: '1', down: '2' }

const fmt = (x: number): string => String(Number(x.toFixed(6)))

type Lv = { price: number; size: number }
type Book = { bids: Lv[]; asks: Lv[] }

function levels(spec: string): Lv[] {
  if (spec === '') return []
  return spec.split(',').map((pair) => {
    const [p, s] = pair.split(':')
    return { price: Number(p), size: Number(s) }
  })
}

function snapshot(assetId: string, t: number, b: Book): OrderBookSnapshot {
  const bids = [...b.bids].sort((x, y) => y.price - x.price)
  const asks = [...b.asks].sort((x, y) => x.price - y.price)
  const bestBid = bids[0]?.price ?? null
  const bestAsk = asks[0]?.price ?? null
  return {
    market: MARKET,
    assetId,
    timestamp: t,
    bestBid,
    bestAsk,
    mid: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
    bids,
    asks,
    depthLevels: 0,
    bidsDepthByLevel: [],
    asksDepthByLevel: [],
  }
}

type Scenario = { name: string; lines: string[] }

function parse(text: string): Scenario[] {
  const out: Scenario[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('scenario ')) {
      out.push({ name: line.slice('scenario '.length), lines: [] })
      continue
    }
    const cur = out[out.length - 1]
    if (!cur) throw new Error(`command before scenario: ${line}`)
    cur.lines.push(line)
  }
  return out
}

async function run(s: Scenario): Promise<string[]> {
  const out: string[] = [`== ${s.name}`]
  let exec = new BacktestExecution({ latencyMs: 0 })
  const books: Record<string, Book> = {}
  const positions: Record<string, { qty: number }> = {}
  const sizeOf = new Map<string, number>()
  const cidOf = new Map<string, string>()

  const ctx = (t: number): OrderManagerContext => {
    const byAssetId: Record<string, OrderBookSnapshot> = {}
    for (const [o, b] of Object.entries(books)) {
      const id = ASSET[o]!
      byAssetId[id] = snapshot(id, t, b)
    }
    return {
      nowMs: t,
      lastMarket: { market: MARKET, timestamp: t, byAssetId },
      portfolio: { positionsByAssetId: positions },
    } as unknown as OrderManagerContext
  }

  const render = (events: AccountEvent[]): void => {
    for (const e of events) {
      switch (e.kind) {
        case 'order_accepted':
          cidOf.set(e.orderId!, e.clientOrderId)
          out.push(`${e.tsMs} accepted ${e.clientOrderId}`)
          break
        case 'ws_order_update': {
          const o = e.order
          if (o.status === 'CANCELED') break // 13 §5.4: not reproduced
          out.push(
            `${e.tsMs} status ${cidOf.get(o.orderId)} ${o.status} ${fmt(o.sizeMatched ?? 0)}`,
          )
          break
        }
        case 'fill': {
          const f = e.fill
          const seq = f.id.slice(f.id.lastIndexOf(':') + 1)
          const fee =
            f.liquidity === 'TAKER'
              ? computePolymarketTakerFee({
                  feeRateBps: f.feeRateBps ?? 0,
                  price: f.price,
                  size: f.size,
                })
              : 0
          out.push(
            `${f.tsMs} fill ${f.clientOrderId}#${seq} ${f.liquidity} ${fmt(f.price)} ${fmt(f.size)} fee=${fmt(fee)}`,
          )
          break
        }
        case 'order_done': {
          const filled =
            e.reason === 'filled'
              ? sizeOf.get(e.orderId!)!
              : e.reason === 'killed'
                ? 0
                : (e.filledSize ?? Number.NaN)
          out.push(`${e.tsMs} done ${e.clientOrderId} ${e.reason} ${fmt(filled)}`)
          break
        }
        case 'order_open':
          out.push(`${e.tsMs} open ${e.clientOrderId}`)
          break
        case 'order_rejected':
          out.push(`${e.tsMs} rejected ${e.clientOrderId} ${e.reason}`)
          break
        case 'positions_split':
          out.push(`${e.split.tsMs} split ${fmt(e.split.size)} cost=${fmt(e.split.splitCost)}`)
          break
        case 'positions_merged':
          out.push(`${e.tsMs} merged ${fmt(e.size)}`)
          break
        default:
          out.push(`unexpected ${e.kind}`)
      }
    }
  }

  for (const line of s.lines) {
    out.push(`> ${line}`)
    const w = line.split(/\s+/)
    const cmd = w[0]
    if (cmd === 'delay') {
      exec = new BacktestExecution({ latencyMs: Number(w[1]) })
    } else if (cmd === 'book') {
      const bids = w[2]!.slice('bids='.length)
      const asks = w[3]!.slice('asks='.length)
      books[w[1]!] = { bids: levels(bids), asks: levels(asks) }
    } else if (cmd === 'position') {
      positions[ASSET[w[1]!]!] = { qty: Number(w[2]) }
    } else if (cmd === 'place') {
      const t = Number(w[1])
      const parts = line
        .slice(line.indexOf(w[1]!) + w[1]!.length)
        .split('|')
        .map((p) => p.trim().split(/\s+/))
      const orders = parts.map((p) => {
        const [cid, outcome, side, price, size, type, ...flags] = p
        const exp = flags.find((f) => f.startsWith('exp='))
        const order = {
          clientOrderId: cid!,
          assetId: ASSET[outcome!]!,
          side: side as 'BUY' | 'SELL',
          price: Number(price),
          size: Number(size),
          orderType: type as 'GTC' | 'GTD' | 'FOK',
          ...(flags.includes('post') ? { postOnly: true } : {}),
          ...(exp ? { expireAtMs: Number(exp.slice(4)) } : {}),
        }
        return order
      })
      // TS order ids are `bt-${seq}-${cid}`, assigned at execution; record
      // sizes by cid and resolve them by id at render time.
      for (const o of orders) sizeOfCid.set(o.clientOrderId, o.size)
      const events =
        orders.length === 1
          ? (await exec.placeLimit({ kind: 'place_limit', ...orders[0]! }, ctx(t))).events
          : (await exec.placeBatch({ kind: 'place_batch', orders }, ctx(t))).events
      noteSizes(events)
      render(events)
    } else if (cmd === 'cancel') {
      const t = Number(w[1])
      render(
        (await exec.cancelOrder({ kind: 'cancel_order', clientOrderId: w[2]! }, ctx(t))).events,
      )
    } else if (cmd === 'cancel_market') {
      const t = Number(w[1])
      const scope = w[2] ? { assetId: ASSET[w[2]]! } : { market: MARKET }
      render((await exec.cancelMarket({ kind: 'cancel_market', ...scope }, ctx(t))).events)
    } else if (cmd === 'cancel_all') {
      render((await exec.cancelAll({ kind: 'cancel_all' }, ctx(Number(w[1])))).events)
    } else if (cmd === 'split' || cmd === 'merge') {
      const t = Number(w[1])
      const intent = { assetIdA: ASSET.up!, assetIdB: ASSET.down!, size: Number(w[2]) }
      const r =
        cmd === 'split'
          ? await exec.splitPositions({ kind: 'split_positions', ...intent }, ctx(t))
          : await exec.mergePositions({ kind: 'merge_positions', ...intent }, ctx(t))
      render(r.events)
    } else if (cmd === 'tick') {
      const events = (await exec.onMarketTick(ctx(Number(w[1])))).events
      noteSizes(events)
      render(events)
    } else {
      throw new Error(`unknown command: ${line}`)
    }
  }
  return out

  function noteSizes(events: AccountEvent[]): void {
    for (const e of events) {
      if (e.kind === 'order_accepted') sizeOf.set(e.orderId!, sizeOfCid.get(e.clientOrderId)!)
    }
  }
}

const sizeOfCid = new Map<string, number>()

const scenarios = parse(readFileSync(path.join(dir, 'compat_scenarios.txt'), 'utf8'))
const repoRoot = path.resolve(dir, '../../../../../../../..')
const sha = (rel: string): string =>
  createHash('sha256')
    .update(readFileSync(path.join(repoRoot, rel)))
    .digest('hex')
const self = 'native/crates/pmb-engine/src/exec/sim/tests/golden/compat_gen.ts'
const oracles = [
  'src/trading/execution/BacktestExecution.ts',
  'src/trading/cancellation.ts',
  'src/trading/fees.ts',
]
// GF-2 header: generator and oracle content hashes (stable while the TS
// leaves are unchanged); the Rust test skips `#` lines.
const lines = [
  '# Generated by compat_gen.ts from compat_scenarios.txt with the TS oracle; do not edit.',
  `# generator ${self} sha256=${sha(self)}`,
  ...oracles.map((o) => `# oracle ${o} sha256=${sha(o)}`),
]
for (const s of scenarios) lines.push(...(await run(s)))
writeFileSync(path.join(dir, 'compat_expected.txt'), lines.join('\n') + '\n')
