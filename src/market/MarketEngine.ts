import type { AnyMarketMessage, MarketOrderBooksSnapshot } from './orderbook/index.js'
import { MarketOrderBookEngine } from './orderbook/index.js'
import { normalizePriceChangeHashes } from './priceChangeHashes.js'
import { decodeMarketChannelFrame } from './marketChannelDecoder.js'

export type EngineSource =
  | {
      kind: 'live'
      attempt: number
      /** Present for the receipt-ordered V4 live feed runtime. */
      ingestSeq?: bigint
      frameIndex?: number
      tsLocalMs?: number
    }
  | {
      kind: 'parquet'
      filePath: string
      ingestSeq: bigint
      /** Position of a decoded message inside its original websocket frame. */
      frameIndex?: number
      /**
       * The recorder's local receive time (`ts_local_ms`) of this row, when the
       * dataset has one. This is the replay stand-in for "the bot's wall clock
       * at tick processing time" — external-feed visibility must be checked
       * against it, not the exchange timestamp, which is stamped BEFORE the
       * Polymarket→bot delivery leg (~50–150 ms).
       */
      tsLocalMs?: number
    }

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
  private pendingFrame: Promise<AnyMarketMessage | null> | null = null

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
  handleRaw(args: {
    rawJson: string
    source: EngineSource
    /** Starting state is applied without pretending a new strategy tick occurred. */
    bootstrap?: boolean
  }): Promise<AnyMarketMessage | null> {
    return this.enqueueFrame(() => this.applyFrame(decodeMarketChannelFrame(args.rawJson), args))
  }

  /**
   * Accept an already decoded frame using the same queue and tick semantics as
   * handleRaw. The caller validates and transfers ownership of these messages;
   * it must not mutate them while the frame is queued or after dispatch.
   */
  handleDecoded(args: {
    messages: readonly AnyMarketMessage[]
    source: EngineSource
    bootstrap?: boolean
  }): Promise<AnyMarketMessage | null> {
    return this.enqueueFrame(() => this.applyFrame(args.messages, args))
  }

  private enqueueFrame(
    apply: () => AnyMarketMessage | null | Promise<AnyMarketMessage | null>,
  ): Promise<AnyMarketMessage | null> {
    try {
      if (this.pendingFrame) return this.trackFrame(this.pendingFrame.then(apply))
      const result = apply()
      return result instanceof Promise ? this.trackFrame(result) : Promise.resolve(result)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private trackFrame(promise: Promise<AnyMarketMessage | null>): Promise<AnyMarketMessage | null> {
    const tracked = promise.finally(() => {
      if (this.pendingFrame === tracked) this.pendingFrame = null
    })
    this.pendingFrame = tracked
    return tracked
  }

  private applyFrame(
    messages: readonly AnyMarketMessage[],
    args: { source: EngineSource; bootstrap?: boolean },
  ): AnyMarketMessage | null | Promise<AnyMarketMessage | null> {
    const applyFrom = (
      start: number,
    ): AnyMarketMessage | null | Promise<AnyMarketMessage | null> => {
      for (let frameIndex = start; frameIndex < messages.length; frameIndex++) {
        const msg = normalizePriceChangeHashes(messages[frameIndex]!)
        this.ob.applyAny(msg)
        if (!args.bootstrap && (msg.event_type === 'book' || msg.event_type === 'price_change')) {
          const source =
            'ingestSeq' in args.source && messages.length > 1
              ? { ...args.source, frameIndex }
              : args.source
          const result = this.onTick?.({ source, msg, snapshot: this.ob.snapshot() })
          // A live callback queues the strategy and returns void. Do not yield between
          // children of one websocket frame: ws can emit its next frame synchronously.
          if (result) return result.then(() => applyFrom(frameIndex + 1))
        }
      }
      return messages.at(-1) ?? null
    }
    return applyFrom(0)
  }
}
