import type { AnyMarketMessage, MarketOrderBooksSnapshot } from './orderbook/index.js'
import { MarketOrderBookEngine } from './orderbook/index.js'
import { decodeMarketChannelMessage } from './marketChannelDecoder.js'

export type EngineSource =
  | { kind: 'live'; attempt: number }
  | { kind: 'parquet'; filePath: string; ingestSeq: bigint }

export type EngineTick = {
  source: EngineSource
  msg: AnyMarketMessage
  snapshot: MarketOrderBooksSnapshot
}

export type MarketEngineOptions = {
  /**
   * Expected token ids for this market (e.g. YES/NO clobTokenIds).
   * Enables warm-state semantics in the underlying MarketOrderBookEngine.
   */
  expectedAssetIds?: [string, string]
  /**
   * Called only on `book` and `price_change` events (strategy-friendly tick cadence).
   */
  onTick?: (t: EngineTick) => void | Promise<void>
}

/**
 * Shared engine for live + backtest:
 * raw_json -> decoder -> MarketOrderBookEngine -> strategy ticks
 */
export class MarketEngine {
  private ob: MarketOrderBookEngine
  private readonly expectedAssetIds: [string, string] | undefined
  private readonly onTick?: (t: EngineTick) => void | Promise<void>

  constructor(opts?: MarketEngineOptions) {
    this.expectedAssetIds = opts?.expectedAssetIds
    this.ob = new MarketOrderBookEngine({
      ...(opts?.expectedAssetIds ? { expectedAssetIds: opts.expectedAssetIds } : {}),
    })
    if (opts?.onTick) {
      this.onTick = opts.onTick
    }
  }

  /**
   * Reset orderbook state (e.g. when rotating to a new market).
   */
  reset(): void {
    this.ob = new MarketOrderBookEngine({
      ...(this.expectedAssetIds ? { expectedAssetIds: this.expectedAssetIds } : {}),
    })
  }

  getOrderBookEngine(): MarketOrderBookEngine {
    return this.ob
  }

  snapshot(): MarketOrderBooksSnapshot {
    return this.ob.snapshot()
  }

  /**
   * Accept raw JSON and apply it to the shared orderbook.
   * Returns the decoded message (or null if ignored).
   */
  async handleRaw(args: {
    rawJson: string
    source: EngineSource
  }): Promise<AnyMarketMessage | null> {
    const msg = decodeMarketChannelMessage(args.rawJson)
    if (!msg) return null

    this.ob.applyAny(msg)

    if (msg.event_type === 'book' || msg.event_type === 'price_change') {
      await this.onTick?.({ source: args.source, msg, snapshot: this.ob.snapshot() })
    }

    return msg
  }
}
