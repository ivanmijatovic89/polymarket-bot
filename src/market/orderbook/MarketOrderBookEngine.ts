import type { AnyMarketMessage, MarketOrderBookWarning, MarketOrderBooksSnapshot } from './types.js'
import { OrderBookEngine } from './OrderBookEngine.js'
import { groupPriceChangesByAsset, parseTsMs } from './utils.js'

/**
 * Market-level orderbook engine: maintains order books for ALL asset_ids under the same `market`.
 *
 * Rationale:
 * - Polymarket condition markets have multiple tokens (usually YES/NO).
 * - Many strategies (e.g. arbitrage) need the latest state of both books on each tick.
 */
export class MarketOrderBookEngine {
  private market: string | undefined
  private lastUpdateTs = 0
  private readonly enginesByAssetId = new Map<string, OrderBookEngine>()
  private readonly expectedAssetIds: readonly [string, string] | undefined
  private readonly sawBookByAssetId = new Set<string>()
  private readonly lastUpdateTsByAssetId = new Map<string, number>()
  private readonly validationEnabled: boolean
  private readonly onWarning: ((w: MarketOrderBookWarning) => void) | undefined

  constructor(params?: {
    market?: string
    expectedAssetIds?: [string, string]
    validation?: { enabled: boolean; onWarning?: (w: MarketOrderBookWarning) => void }
  }) {
    this.market = params?.market
    this.expectedAssetIds = params?.expectedAssetIds
    this.validationEnabled = params?.validation?.enabled ?? false
    this.onWarning = params?.validation?.onWarning
  }

  snapshot(): MarketOrderBooksSnapshot {
    const market = this.market ?? '(unknown)'
    return {
      market,
      timestamp: this.lastUpdateTs,
      byAssetId: Object.fromEntries(
        [...this.enginesByAssetId.entries()].map(([assetId, eng]) => [assetId, eng.snapshot()]),
      ),
    }
  }

  isWarm(): boolean {
    if (!this.expectedAssetIds) return this.sawBookByAssetId.size > 0
    return this.expectedAssetIds.every((id) => this.sawBookByAssetId.has(id))
  }

  missingBooks(): string[] {
    if (!this.expectedAssetIds) return []
    return this.expectedAssetIds.filter((id) => !this.sawBookByAssetId.has(id))
  }

  getLastUpdateTsByAssetId(): ReadonlyMap<string, number> {
    return this.lastUpdateTsByAssetId
  }

  applyAny(msg: AnyMarketMessage): void {
    const msgMarket = 'market' in msg && typeof msg.market === 'string' ? msg.market : undefined
    if (msgMarket) this.assertOrSetMarket(msgMarket, msg.event_type)

    const ts = Number((msg as { timestamp?: unknown }).timestamp)
    if (Number.isFinite(ts)) this.lastUpdateTs = Math.trunc(ts)

    switch (msg.event_type) {
      case 'book': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        const eng = this.getOrCreate(msg.market, msg.asset_id)

        // Warn if books go backwards in exchange timestamp.
        if (this.validationEnabled) {
          const prev = this.lastUpdateTsByAssetId.get(msg.asset_id)
          const next = Number(msg.timestamp)
          if (prev !== undefined && Number.isFinite(next) && Math.trunc(next) < prev) {
            this.onWarning?.({
              kind: 'non_monotonic_book_timestamp',
              market: msg.market,
              assetId: msg.asset_id,
              prevTimestamp: prev,
              nextTimestamp: Math.trunc(next),
            })
          }
        }

        eng.applyBook(msg)
        this.lastUpdateTs = eng.getState().lastUpdateTs
        this.sawBookByAssetId.add(msg.asset_id)
        this.lastUpdateTsByAssetId.set(msg.asset_id, eng.getState().lastUpdateTs)
        return
      }
      case 'price_change': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        const byAsset = groupPriceChangesByAsset(msg.price_changes)
        for (const [assetId, changes] of byAsset.entries()) {
          if (this.validationEnabled && !this.sawBookByAssetId.has(assetId)) {
            const ts = Number(msg.timestamp)
            this.onWarning?.({
              kind: 'delta_before_book',
              market: msg.market,
              assetId,
              eventType: 'price_change',
              ...(Number.isFinite(ts) ? { timestamp: Math.trunc(ts) } : {}),
            })
          }
          const eng = this.getOrCreate(msg.market, assetId)
          eng.applyPriceChange({
            event_type: 'price_change',
            market: msg.market,
            price_changes: changes,
            timestamp: msg.timestamp,
          })
          this.lastUpdateTsByAssetId.set(assetId, eng.getState().lastUpdateTs)
        }
        this.lastUpdateTs = parseTsMs(msg.timestamp)
        return
      }
      case 'tick_size_change': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        if (this.validationEnabled && !this.sawBookByAssetId.has(msg.asset_id)) {
          const ts = Number(msg.timestamp)
          this.onWarning?.({
            kind: 'delta_before_book',
            market: msg.market,
            assetId: msg.asset_id,
            eventType: 'tick_size_change',
            ...(Number.isFinite(ts) ? { timestamp: Math.trunc(ts) } : {}),
          })
        }
        const eng = this.getOrCreate(msg.market, msg.asset_id)
        eng.applyTickSizeChange(msg)
        this.lastUpdateTs = eng.getState().lastUpdateTs
        this.lastUpdateTsByAssetId.set(msg.asset_id, eng.getState().lastUpdateTs)
        return
      }
      case 'last_trade_price': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        if (this.validationEnabled && !this.sawBookByAssetId.has(msg.asset_id)) {
          const ts = Number(msg.timestamp)
          this.onWarning?.({
            kind: 'delta_before_book',
            market: msg.market,
            assetId: msg.asset_id,
            eventType: 'last_trade_price',
            ...(Number.isFinite(ts) ? { timestamp: Math.trunc(ts) } : {}),
          })
        }
        const eng = this.getOrCreate(msg.market, msg.asset_id)
        eng.applyLastTradePrice(msg)
        this.lastUpdateTs = eng.getState().lastUpdateTs
        this.lastUpdateTsByAssetId.set(msg.asset_id, eng.getState().lastUpdateTs)
        return
      }
      default: {
        const _exhaustive: never = msg
        void _exhaustive
        throw new Error(
          `[orderbook] MarketOrderBookEngine unknown event_type ${(msg as { event_type?: unknown }).event_type}`,
        )
      }
    }
  }

  private getOrCreate(market: string, assetId: string): OrderBookEngine {
    const existing = this.enginesByAssetId.get(assetId)
    if (existing) return existing
    const eng = new OrderBookEngine({ market, assetId })
    this.enginesByAssetId.set(assetId, eng)
    return eng
  }

  private assertOrSetMarket(market: string, eventType: string): void {
    if (!this.market) {
      this.market = market
      return
    }
    if (this.market !== market) {
      throw new Error(
        `[orderbook] market mismatch on ${eventType}: expected=${this.market} got=${market}`,
      )
    }
  }
}
