import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type { AccountEvent, Intent, MarketTick, Strategy } from '../strategy/Strategy.js'
import type { PortfolioSnapshot } from '../strategy/Strategy.js'
import type { IndicatorSet } from '../indicators/IndicatorSet.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { ExternalFeedsSnapshot } from './feeds/externalFeeds.js'
import { Portfolio } from './Portfolio.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { IntentExecutionMode } from './OrderManager.js'
import { OrderManager } from './OrderManager.js'
import { round8 } from './utils/rounding.js'
import { computePositionMetrics } from './positionMetrics.js'

export type StrategyExternalFeedsEnabled = {
  rtdsCryptoPrices?: boolean
  binanceWsSpotPrice?: boolean
  polymarketPriceToBeat?: boolean
}

export type StrategyRunnerMeta = {
  id: string
  name: string
  params: Record<string, unknown>
  indicators: string[]
  externalFeeds: {
    requested?: Record<string, unknown>
    enabled?: StrategyExternalFeedsEnabled
  }
}

export type StrategyRunnerOptions = {
  strategyId?: string
  strategyParams?: Record<string, unknown>
  externalFeedsEnabled?: StrategyExternalFeedsEnabled
  strategy: Strategy
  orderManager: OrderManager
  portfolio?: Portfolio
  /**
   * Optional indicator set to update on every market tick.
   * If omitted, indicators have near-zero overhead (single null-check).
   */
  indicatorSet?: IndicatorSet
  /**
   * Optional external feeds snapshot provider (live-only).
   *
   * NOTE: These snapshots are passed ONLY on onMarketTick (not onAccountEvent),
   * to keep all data access tick-scoped and backtest-friendly.
   */
  getFeedsSnapshot?: () => ExternalFeedsSnapshot | undefined
  /**
   * Optional market metadata snapshot provider (live + backtest).
   *
   * NOTE: This should be episode-scoped (e.g. 15m window market), not computed per tick.
   */
  getMarket?: () => GammaMarketMeta | undefined
  /**
   * How intents should be handled:
   * - queued: submit now, execute on next market tick (legacy 1-tick latency)
   * - immediate: execute now and emit AccountEvents immediately (live-friendly)
   *
   * Default 'queued' (backtest-friendly).
   */
  intentExecutionMode?: IntentExecutionMode
  /**
   * Prevent infinite feedback loops (account-event triggers more intents triggers more account events).
   * Default 100.
   */
  maxEventsPerDrain?: number
  /**
   * Optional intent log hook (useful for a dedicated "intentions" TUI pane).
   * Keep messages compact; this is called on hot paths.
   */
  intentLog?: (msg: string, extra?: unknown) => void
  log?: (msg: string, extra?: unknown) => void
}

export class StrategyRunner {
  private readonly strategyId: string | undefined
  private readonly strategyParams: Record<string, unknown> | undefined
  private readonly externalFeedsEnabled: StrategyExternalFeedsEnabled | undefined
  private readonly strategy: Strategy
  private readonly orderManager: OrderManager
  private readonly portfolio: Portfolio
  private readonly indicatorSet: IndicatorSet | undefined
  private readonly getFeedsSnapshot: (() => ExternalFeedsSnapshot | undefined) | undefined
  private readonly getMarket: (() => GammaMarketMeta | undefined) | undefined
  private readonly intentExecutionMode: IntentExecutionMode
  private readonly maxEventsPerDrain: number
  private readonly intentLog: ((msg: string, extra?: unknown) => void) | undefined
  private readonly log: ((msg: string, extra?: unknown) => void) | undefined

  private lastMarket: MarketOrderBooksSnapshot | undefined
  private readonly accountEventQueue: AccountEvent[] = []
  private draining = false
  private readonly recentDrainEvents: { kind: AccountEvent['kind']; tsMs?: number }[] = []

  constructor(opts: StrategyRunnerOptions) {
    this.strategyId = opts.strategyId
    this.strategyParams = opts.strategyParams
    this.externalFeedsEnabled = opts.externalFeedsEnabled
    this.strategy = opts.strategy
    this.orderManager = opts.orderManager
    this.portfolio = opts.portfolio ?? new Portfolio()
    this.indicatorSet = opts.indicatorSet
    this.getFeedsSnapshot = opts.getFeedsSnapshot
    this.getMarket = opts.getMarket
    this.intentExecutionMode = opts.intentExecutionMode ?? 'queued'
    this.maxEventsPerDrain = Math.max(1, opts.maxEventsPerDrain ?? 100)
    this.intentLog = opts.intentLog
    this.log = opts.log
  }

  getPortfolio(): Portfolio {
    return this.portfolio
  }

  /**
   * Canonical portfolio snapshot accessor: returns `Portfolio.snapshot()` enriched with
   * optional computed convenience fields (like `positionMetrics`).
   *
   * Prefer this over `runner.getPortfolio().snapshot()` in callers outside the runner pipeline
   * (UI/backtests/CLIs) so everything sees the same snapshot shape.
   */
  getPortfolioSnapshot(): PortfolioSnapshot {
    const p = this.portfolio.snapshot()

    // Only compute if we can reliably resolve UP/DOWN ids from market meta.
    const m = this.getMarket?.()
    if (!m) return p
    const outcomes = Array.isArray(m.outcomes) ? m.outcomes : []
    const tokenIds = Array.isArray(m.clobTokenIds) ? m.clobTokenIds : []

    let upAssetId: string | undefined
    let downAssetId: string | undefined
    const n = Math.min(outcomes.length, tokenIds.length)
    for (let i = 0; i < n; i += 1) {
      const outcome = outcomes[i]
      const tokenId = tokenIds[i]
      const o = typeof outcome === 'string' ? outcome.toLowerCase() : ''
      const id = typeof tokenId === 'string' && tokenId.length > 0 ? tokenId : undefined
      if (!id) continue
      if (!upAssetId && o.includes('up')) upAssetId = id
      if (!downAssetId && o.includes('down')) downAssetId = id
    }

    const metricsArgs: { portfolio: PortfolioSnapshot; upAssetId?: string; downAssetId?: string } = { portfolio: p }
    if (upAssetId) metricsArgs.upAssetId = upAssetId
    if (downAssetId) metricsArgs.downAssetId = downAssetId
    const positionMetrics = computePositionMetrics(metricsArgs)
    return positionMetrics ? { ...p, positionMetrics } : p
  }

  getLastMarketSnapshot(): MarketOrderBooksSnapshot | undefined {
    return this.lastMarket
  }

  getStrategyMeta(): StrategyRunnerMeta | undefined {
    if (!this.strategyId || !this.strategyParams) return undefined
    const requested = this.strategy.requiredFeeds
    return {
      id: this.strategyId,
      name: this.strategy.name,
      params: this.strategyParams,
      indicators: this.indicatorSet ? this.indicatorSet.listIds() : [],
      externalFeeds: {
        ...(requested ? { requested: requested as unknown as Record<string, unknown> } : {}),
        ...(this.externalFeedsEnabled ? { enabled: this.externalFeedsEnabled } : {}),
      },
    }
  }

  async onMarketTick(tick: MarketTick): Promise<void> {
    this.lastMarket = tick.snapshot
    this.indicatorSet?.onMarketTick(tick)
    const indicators = this.indicatorSet?.snapshot()
    const feeds = this.getFeedsSnapshot?.()
    const market = this.getMarket?.()
    const ctx: StrategyContext | undefined =
      indicators || feeds || market
        ? {
            ...(indicators ? { indicators } : {}),
            ...(feeds ? { feeds } : {}),
            ...(market ? { market } : {}),
          }
        : undefined

    // Allow execution layer to emit fills/state updates that happen "because the market moved"
    // (only used in backtests; live fills arrive via user WS / polling).
    const preEvents = await this.orderManager.onMarketTick({
      nowMs: tick.snapshot.timestamp || Date.now(),
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.getPortfolioSnapshot(),
    })
    for (const ev of preEvents) this.enqueueAccountEvent(ev)
    await this.drainAccountEvents()

    const intents = await this.strategy.onMarketTick(tick, this.getPortfolioSnapshot(), ctx)
    await this.applyIntents(intents)
    await this.drainAccountEvents()
  }

  async onAccountEvent(ev: AccountEvent): Promise<void> {
    this.enqueueAccountEvent(ev)
    await this.drainAccountEvents()
  }

  private async applyIntents(intents: Intent[]): Promise<void> {
    if (!intents || intents.length === 0) return
    this.intentLog?.('[intent] batch', {
      count: intents.length,
      sample: intents.slice(0, 20).map((i) => {
        if (i.kind === 'place_limit') {
          return {
            kind: i.kind,
            clientOrderId: i.clientOrderId,
            assetId: i.assetId,
            side: i.side,
            price: i.price,
            size: i.size,
            orderType: i.orderType,
            ...(i.reason ? { reason: i.reason } : {}),
          }
        }
        if (i.kind === 'cancel_order') {
          return {
            kind: i.kind,
            ...(i.clientOrderId ? { clientOrderId: i.clientOrderId } : {}),
            ...(i.orderId ? { orderId: i.orderId } : {}),
            ...(i.reason ? { reason: i.reason } : {}),
          }
        }
        if (i.kind === 'cancel_all') {
          return { kind: i.kind, ...(i.reason ? { reason: i.reason } : {}) }
        }
        return {
          kind: i.kind,
          assetIdA: i.assetIdA,
          assetIdB: i.assetIdB,
          size: i.size,
          ...(i.reason ? { reason: i.reason } : {}),
        }
      }),
      executionMode: this.intentExecutionMode,
    })
    const nowMs = this.lastMarket?.timestamp || Date.now()
    const events = await this.orderManager.handleIntents(intents, {
      nowMs,
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.getPortfolioSnapshot(),
    }, { mode: this.intentExecutionMode })
    for (const ev of events) this.enqueueAccountEvent(ev)
  }

  private enqueueAccountEvent(ev: AccountEvent): void {
    this.accountEventQueue.push(ev)
  }

  private pushRecentDrainEvent(ev: AccountEvent): void {
    this.recentDrainEvents.push({ kind: ev.kind, ...(typeof (ev as { tsMs?: unknown }).tsMs === 'number' ? { tsMs: (ev as { tsMs: number }).tsMs } : {}) })
    if (this.recentDrainEvents.length > 10) this.recentDrainEvents.shift()
  }

  private async drainAccountEvents(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      let processed = 0
      while (this.accountEventQueue.length > 0) {
        if (processed >= this.maxEventsPerDrain) {
          this.log?.('[runner] maxEventsPerDrain exceeded; halting drain and dropping queued events', {
            maxEventsPerDrain: this.maxEventsPerDrain,
            remaining: this.accountEventQueue.length,
            recent: this.recentDrainEvents.slice(),
          })
          this.accountEventQueue.length = 0
          return
        }

        const ev = this.accountEventQueue.shift()!
        processed += 1
        this.pushRecentDrainEvent(ev)
        await this.processAccountEvent(ev)
      }
    } finally {
      this.draining = false
    }
  }

  private async processAccountEvent(ev: AccountEvent): Promise<void> {
    if (ev.kind === 'fill') {
      const timeIso = new Date(ev.fill.tsMs).toISOString()
      const notional = round8((ev.fill.price ?? 0) * (ev.fill.size ?? 0))
      const cashDelta = ev.fill.side === 'BUY' ? round8(-notional) : notional
      this.log?.('[trade]', { ...ev.fill, timeIso, notional, cashDelta })
    }
    this.portfolio.apply(ev)

    // Pass the latest cached indicator snapshot + latest external feeds snapshot.
    // Note: IndicatorSet snapshots are updated on market ticks; onAccountEvent we reuse the last cached snapshot.
    const indicators = this.indicatorSet?.snapshot()
    const feeds = this.getFeedsSnapshot?.()
    const market = this.getMarket?.()
    const ctx: StrategyContext | undefined =
      indicators || feeds || market
        ? {
            ...(indicators ? { indicators } : {}),
            ...(feeds ? { feeds } : {}),
            ...(market ? { market } : {}),
          }
        : undefined

    const nextIntents = await this.strategy.onAccountEvent(
      ev,
      this.getPortfolioSnapshot(),
      this.lastMarket,
      ctx,
    )
    if (!nextIntents || nextIntents.length === 0) return

    const nowMs = this.lastMarket?.timestamp || this.getPortfolioSnapshot().nowMs || Date.now()
    const nextEvents = await this.orderManager.handleIntents(nextIntents, {
      nowMs,
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.getPortfolioSnapshot(),
    }, { mode: this.intentExecutionMode })
    for (const e of nextEvents) this.enqueueAccountEvent(e)
  }
}
