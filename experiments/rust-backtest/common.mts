import { createHash } from 'node:crypto'
import type { ExternalFeedsSnapshot } from '../../src/trading/feeds/externalFeeds.js'
import type { AccountEvent, PortfolioSnapshot, MarketTick } from '../../src/strategy/Strategy.js'
import { readFile } from 'node:fs/promises'
export type Market = {
  slug: string
  filePath: string
  feeds: string
  startMs: number
  endMs: number
  marketId: string
  upId: string
  downId: string
  outcome: 'UP' | 'DOWN'
  priceToBeat: number
  gammaSyncedAtMs: number
  marketSha256: string
  feedSha256: string
}
export type Settings = {
  startingCapital: number
  delayMs: number
  jitterMs: number
  binanceLatencyMs: number
  chainlinkLatencyMs: number
  priceToBeatLatencyMs: number
  seed: number
}
export type Manifest = {
  formatVersion: number
  runId: number
  strategy: string
  artifactSha256: string
  artifactMeta: { r2Url: string }
  settings: Settings
  params: Record<string, unknown>
  markets: Market[]
}
export type Feeds = { binance: [number, number][]; chainlink: [number, number, number][] }
export const loadManifest = async (p: string): Promise<Manifest> =>
  JSON.parse(await readFile(p, 'utf8'))
export function seededRandom(seed: number) {
  let x = seed >>> 0
  if (!x) throw new Error('Seed must be nonzero')
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}
export function marketMeta(m: Market) {
  return {
    slug: m.slug,
    conditionId: m.marketId,
    outcomes: ['UP', 'DOWN'],
    clobTokenIds: [m.upId, m.downId],
    upAssetId: m.upId,
    downAssetId: m.downId,
    outcomeTokenMap: { up: m.upId, down: m.downId },
    eventStartTime: new Date(m.startMs).toISOString(),
    endDate: new Date(m.endMs).toISOString(),
  }
}
export function portfolioState(p: PortfolioSnapshot, m: Market) {
  return {
    nowMs: p.nowMs,
    capital: p.capital,
    realizedPnlTotal: p.realizedPnlTotal ?? 0,
    positions: [m.upId, m.downId].map((id) => {
      const x = p.positionsByAssetId[id]
      return x ? { qty: x.qty, avgEntryPrice: x.avgEntryPrice, costBasis: x.costBasis } : null
    }),
    openOrders: Object.values(p.openOrdersByClientId).map((o) => ({
      clientOrderId: o.clientOrderId,
      orderId: o.orderId ?? null,
      assetId: o.assetId,
      side: o.side,
      price: o.price,
      size: o.size,
      remaining: o.remaining,
      filled: o.filled,
      state: o.state,
    })),
  }
}
export function accountTrace(ev: AccountEvent, p: PortfolioSnapshot, m: Market) {
  const detail =
    ev.kind === 'fill'
      ? ev.fill
      : ev.kind === 'order_submitted' || ev.kind === 'ws_order_update'
        ? ev.order
        : ev
  return {
    kind: ev.kind,
    tsMs: ev.kind === 'fill' ? ev.fill.tsMs : 'tsMs' in ev ? ev.tsMs : null,
    clientOrderId: 'clientOrderId' in detail ? (detail.clientOrderId ?? null) : null,
    orderId: 'orderId' in detail ? (detail.orderId ?? null) : null,
    reason: 'reason' in ev ? (ev.reason ?? null) : null,
    status: ev.kind === 'ws_order_update' ? (ev.order.status ?? null) : null,
    fill:
      ev.kind === 'fill'
        ? {
            id: ev.fill.id,
            assetId: ev.fill.assetId,
            side: ev.fill.side,
            price: ev.fill.price,
            size: ev.fill.size,
            liquidity: ev.fill.liquidity,
            feeRateBps: ev.fill.feeRateBps ?? null,
          }
        : null,
    state: portfolioState(p, m),
  }
}
export class Digest {
  value = 2166136261
  private bytes = new Uint8Array(65536)
  private view = new DataView(this.bytes.buffer)
  private offset = 0
  private hash = createHash('sha256')
  number(n: number | null | undefined) {
    this.view.setFloat64(this.offset, n ?? NaN, true)
    for (let i = this.offset; i < this.offset + 8; i++)
      this.value = Math.imul(this.value ^ this.bytes[i]!, 16777619) >>> 0
    this.offset += 8
    if (this.offset === this.bytes.length) {
      this.hash.update(this.bytes)
      this.offset = 0
    }
  }
  sha256() {
    if (this.offset) this.hash.update(this.bytes.subarray(0, this.offset))
    this.offset = 0
    return this.hash.digest('hex')
  }
  tick(t: MarketTick, m: Market) {
    this.number(
      ['book', 'price_change', 'binance_agg_trade', 'chainlink_round'].indexOf(t.msg.event_type),
    )
    this.number(t.snapshot.timestamp)
    this.number(t.source.kind === 'parquet' ? Number(t.source.ingestSeq) : 0)
    this.number(t.source.kind === 'parquet' ? t.source.tsLocalMs : undefined)
    for (const id of [m.upId, m.downId]) {
      const b = t.snapshot.byAssetId[id]
      this.number(b ? 1 : 0)
      if (!b) continue
      this.number(b.timestamp)
      this.number(b.bestBid)
      this.number(b.bestAsk)
      this.number(b.mid)
      this.number(b.spread)
      for (const side of [b.bids, b.asks]) {
        this.number(side.length)
        for (const l of side) {
          this.number(l.price)
          this.number(l.size)
        }
      }
      this.number(b.depthLevels)
      for (const d of [b.bidsDepthByLevel, b.asksDepthByLevel]) {
        this.number(d.length)
        for (const v of d) this.number(v)
      }
    }
  }
  feeds(f: ExternalFeedsSnapshot | undefined) {
    const b = f?.binanceWsSpotPrice
    const c = f?.rtdsPolymarketCryptoPrices?.chainlink
    this.number(b?.value)
    this.number(b?.receivedAtMs)
    this.number(c?.value)
    this.number(c?.receivedAtMs)
    this.number(f?.polymarketPriceToBeat?.openPrice)
    this.number(b?.tsMs)
    this.number(c?.tsMs)
    this.number(f?.polymarketPriceToBeat?.receivedAtMs)
  }
}
