import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../strategy/Strategy.js'
import type { StrategyContext, WarmupSnapshot } from '../strategy/StrategyContext.js'
import type { PluginsSnapshot, PluginSet } from '../strategy/plugins/PluginSet.js'
import { Portfolio } from './Portfolio.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { IntentExecutionMode } from './OrderManager.js'
import { OrderManager } from './OrderManager.js'
import { round8 } from './utils/rounding.js'
import { computePolymarketTakerFee } from './fees.js'
import { computePositionMetricsFromMarket } from './positionMetrics.js'
import { computeOrderbookMetricsFromMarket } from './orderbookMetrics.js'
import { parseGammaMarketStartMs } from '../strategy/strategyToolkit.js'
import type { BalanceSnapshot } from '../blockchain/balanceTracker.js'

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
   * Optional plugin set to update on every market tick.
   * If omitted, plugins have near-zero overhead (single null-check).
   */
  pluginSet?: PluginSet
  /**
   * Optional market metadata snapshot provider (live + backtest).
   *
   * NOTE: This should be episode-scoped (e.g. 15m window market), not computed per tick.
   */
  getMarket?: () => GammaMarketMeta | undefined
  /** Optional balance snapshot provider (live-only). */
  getBalance?: () => BalanceSnapshot | undefined
  /** Live-only: warmup readiness snapshot (used by strategies to gate order placement). */
  getWarmup?: () => WarmupSnapshot | undefined
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
  /**
   * Skip markets where the first tick arrives too late after market start.
   * Used by live trading only; set to 0 to disable.
   */
  skipLateStartAfterMs?: number
}

export class StrategyRunner {
  private readonly strategyId: string | undefined
  private readonly strategyParams: Record<string, unknown> | undefined
  private readonly externalFeedsEnabled: StrategyExternalFeedsEnabled | undefined
  private readonly strategy: Strategy
  private readonly orderManager: OrderManager
  private readonly portfolio: Portfolio
  private readonly pluginSet: PluginSet | undefined
  private readonly getMarket: (() => GammaMarketMeta | undefined) | undefined
  private readonly getBalance: (() => BalanceSnapshot | undefined) | undefined
  private readonly getWarmup: (() => WarmupSnapshot | undefined) | undefined
  private readonly intentExecutionMode: IntentExecutionMode
  private readonly maxEventsPerDrain: number
  private readonly intentLog: ((msg: string, extra?: unknown) => void) | undefined
  private readonly log: ((msg: string, extra?: unknown) => void) | undefined

  private lastMarket: MarketOrderBooksSnapshot | undefined
  private lastMarketKey: string | null = null
  private lateStartCheckedMarketKey: string | null = null
  private lateStartBlockedMarketKey: string | null = null
  private readonly skipLateStartAfterMs: number
  private waitedTechIndicatorsMarketKey: string | null = null
  private cachedPlugins: PluginsSnapshot | undefined
  private readonly accountEventQueue: AccountEvent[] = []
  private draining = false
  private readonly recentDrainEvents: { kind: AccountEvent['kind']; tsMs?: number }[] = []

  // Serial dispatch funnel — see runSerial().
  private serialTail: Promise<void> = Promise.resolve()
  private serialDepth = 0
  private serialDepthWarnedAt = 0

  constructor(opts: StrategyRunnerOptions) {
    this.strategyId = opts.strategyId
    this.strategyParams = opts.strategyParams
    this.externalFeedsEnabled = opts.externalFeedsEnabled
    this.strategy = opts.strategy
    this.orderManager = opts.orderManager
    this.portfolio = opts.portfolio ?? new Portfolio()
    this.pluginSet = opts.pluginSet
    this.getMarket = opts.getMarket
    this.getBalance = opts.getBalance
    this.getWarmup = opts.getWarmup
    this.intentExecutionMode = opts.intentExecutionMode ?? 'queued'
    this.maxEventsPerDrain = Math.max(1, opts.maxEventsPerDrain ?? 100)
    this.intentLog = opts.intentLog
    this.log = opts.log
    this.skipLateStartAfterMs = Math.max(0, Math.trunc(opts.skipLateStartAfterMs ?? 0))
  }

  getPortfolio(): Portfolio {
    return this.portfolio
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
      indicators: this.pluginSet ? this.pluginSet.listIds() : [],
      externalFeeds: {
        ...(requested ? { requested: requested as unknown as Record<string, unknown> } : {}),
        ...(this.externalFeedsEnabled ? { enabled: this.externalFeedsEnabled } : {}),
      },
    }
  }

  /**
   * Run `fn` strictly after every previously submitted entry point finished.
   *
   * Live callers fire-and-forget (`void runner.onMarketTick(...)` per WS
   * message, account events from user WS / poller / WebUI commands), while the
   * tick body awaits real I/O (live order placement is a REST round-trip). An
   * unserialized runner therefore interleaves ticks and account events at
   * every `await` — mid-placement portfolio snapshots, out-of-order strategy
   * callbacks — none of which can happen in backtests, where runSingleMarket
   * awaits each call sequentially. This funnel gives live the same semantics:
   * one entry point at a time, in arrival order. In backtests callers already
   * await, so the chain never holds more than one entry and behavior (and
   * replay determinism) is unchanged.
   *
   * Errors propagate to the submitting caller but never break the chain.
   * The queue is unbounded by design (dropping ticks would silently change
   * strategy semantics); a persistent backlog means the strategy cannot keep
   * up with the market and is surfaced via the depth warning.
   */
  private runSerial(label: 'tick' | 'account', fn: () => Promise<void>): Promise<void> {
    this.serialDepth += 1
    if (this.serialDepth >= 200 && this.serialDepth >= this.serialDepthWarnedAt * 2) {
      this.serialDepthWarnedAt = this.serialDepth
      // console.warn unconditionally: the optional `log` sink is disabled in
      // the default live config (LOG_TRADES=false), and a growing backlog is
      // exactly the situation that must never go unreported.
      console.warn('[runner] serial dispatch backlog is growing', {
        depth: this.serialDepth,
        entry: label,
      })
      try {
        this.log?.('[runner] serial dispatch backlog is growing', {
          depth: this.serialDepth,
          entry: label,
        })
      } catch {
        // never let a logger break dispatch or the depth accounting
      }
    }
    const run = this.serialTail.then(fn)
    this.serialTail = run
      .catch((err) => {
        // Chaining onto `run` marks its rejection as handled, so a
        // fire-and-forget live caller (`void runner.onMarketTick(...)`) would
        // otherwise lose the error entirely — pre-funnel these surfaced via
        // the process unhandledRejection handler. Log unconditionally; a
        // caller that awaits (backtest) still receives the rejection too.
        console.error(`[runner] ${label} entry failed:`, err)
      })
      .finally(() => {
        this.serialDepth -= 1
        if (this.serialDepth === 0) this.serialDepthWarnedAt = 0
      })
    return run
  }

  onMarketTick(tick: MarketTick): Promise<void> {
    return this.runSerial('tick', () => this.processMarketTick(tick))
  }

  private async processMarketTick(tick: MarketTick): Promise<void> {
    this.lastMarket = tick.snapshot
    const market = this.getMarket?.()
    const balance = this.getBalance?.()
    const warmup = this.getWarmup?.()

    // Reset per-episode plugin state on market change (align with strategy reset semantics).
    const marketKey = tick.snapshot.market ?? null
    if (marketKey && this.lastMarketKey && marketKey !== this.lastMarketKey) {
      this.pluginSet?.reset()
      this.cachedPlugins = undefined
      this.waitedTechIndicatorsMarketKey = null
      this.lateStartCheckedMarketKey = null
      this.lateStartBlockedMarketKey = null
    }
    if (marketKey) this.lastMarketKey = marketKey

    // Allow execution layer to emit fills/state updates that happen "because the market moved"
    // (only used in backtests; live fills arrive via user WS / polling).
    const preEvents = await this.orderManager.onMarketTick({
      nowMs: tick.snapshot.timestamp || Date.now(),
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.portfolio.snapshot(),
    })
    for (const ev of preEvents) this.enqueueAccountEvent(ev)
    await this.drainAccountEvents()

    const portfolio = this.portfolio.snapshot()
    const positionMetrics = computePositionMetricsFromMarket({
      portfolio,
      ...(market ? { market } : {}),
    })
    const orderbookMetrics = computeOrderbookMetricsFromMarket({
      marketBooks: tick.snapshot,
      ...(market ? { market } : {}),
    })
    const metrics =
      positionMetrics || orderbookMetrics
        ? {
            ...(positionMetrics ? { position: positionMetrics } : {}),
            ...(orderbookMetrics ? { orderbook: orderbookMetrics } : {}),
          }
        : undefined

    const baseCtx: StrategyContext | undefined =
      market || metrics || warmup || balance
        ? {
            ...(market ? { market } : {}),
            ...(metrics ? { metrics } : {}),
            ...(balance ? { balance } : {}),
            ...(warmup ? { warmup } : {}),
          }
        : undefined

    if (
      this.skipLateStartAfterMs > 0 &&
      marketKey &&
      this.lateStartBlockedMarketKey === marketKey
    ) {
      return
    }

    if (
      this.skipLateStartAfterMs > 0 &&
      marketKey &&
      this.lateStartCheckedMarketKey !== marketKey
    ) {
      const nowMs =
        typeof tick.snapshot.timestamp === 'number' && Number.isFinite(tick.snapshot.timestamp)
          ? tick.snapshot.timestamp
          : null
      const startMs = nowMs !== null ? parseGammaMarketStartMs(baseCtx?.market) : null
      const elapsedMs = nowMs !== null && startMs !== null ? nowMs - startMs : null
      if (elapsedMs !== null && elapsedMs > this.skipLateStartAfterMs) {
        const marketSlug =
          typeof baseCtx?.market?.slug === 'string' ? baseCtx.market.slug : 'unknown'
        const marketTimeElapsedSec = Math.floor(elapsedMs / 1000)
        const maxMarketTimeElapsedSec = Math.floor(this.skipLateStartAfterMs / 1000)
        console.log(
          '[skip-market-if-bot-started-too-late][⛔] bot started too late; skipping market',
          {
            marketSlug,
            marketTimeElapsedSec,
            maxMarketTimeElapsedSec,
          },
        )
        this.lateStartCheckedMarketKey = marketKey
        this.lateStartBlockedMarketKey = marketKey
        return
      }
      this.lateStartCheckedMarketKey = marketKey
    }

    this.pluginSet?.onMarketTick(tick, baseCtx)

    const waitForTechIndicators = process.env.BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS === '1'
    if (
      waitForTechIndicators &&
      this.pluginSet &&
      marketKey &&
      this.waitedTechIndicatorsMarketKey !== marketKey
    ) {
      const timeoutMs = Math.max(
        0,
        Math.trunc(Number(process.env.BACKTEST_TECH_IND_TIMEOUT_MS ?? '3000') || 0),
      )
      const pollMs = Math.max(
        1,
        Math.trunc(Number(process.env.BACKTEST_TECH_IND_POLL_MS ?? '10') || 10),
      )
      const startedAt = Date.now()

      let snap = this.pluginSet.refreshSnapshot()
      while (!snap?.technicalIndicators && Date.now() - startedAt < timeoutMs) {
        await new Promise((r) => setTimeout(r, pollMs))
        snap = this.pluginSet.refreshSnapshot()
      }

      if (!snap?.technicalIndicators) {
        console.warn('[backtest] technicalIndicators not ready before timeout', {
          market: marketKey,
          timeoutMs,
        })
      }
      this.waitedTechIndicatorsMarketKey = marketKey
    }

    const plugins = this.pluginSet ? this.pluginSet.snapshot() : undefined
    if (plugins) this.cachedPlugins = plugins

    const ctx: StrategyContext | undefined =
      plugins || market || metrics || warmup || balance
        ? {
            ...(plugins ? { plugins } : {}),
            ...(market ? { market } : {}),
            ...(metrics ? { metrics } : {}),
            ...(balance ? { balance } : {}),
            ...(warmup ? { warmup } : {}),
          }
        : undefined

    const intents = await this.strategy.onMarketTick(tick, portfolio, ctx)
    await this.applyIntents(intents, {
      portfolioSnapshot: portfolio,
      nowMs: tick.snapshot.timestamp || Date.now(),
    })
    await this.drainAccountEvents()
  }

  onAccountEvent(ev: AccountEvent): Promise<void> {
    return this.runSerial('account', async () => {
      this.enqueueAccountEvent(ev)
      await this.drainAccountEvents()
    })
  }

  private async applyIntents(
    intents: Intent[],
    opts?: { portfolioSnapshot?: PortfolioSnapshot; nowMs?: number },
  ): Promise<void> {
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
        if (i.kind === 'place_batch') {
          return {
            kind: i.kind,
            orderCount: i.orders.length,
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
        if (i.kind === 'split_positions') {
          return {
            kind: i.kind,
            assetIdA: i.assetIdA,
            assetIdB: i.assetIdB,
            size: i.size,
            ...(typeof i.costPerShare === 'number' ? { costPerShare: i.costPerShare } : {}),
            ...(i.reason ? { reason: i.reason } : {}),
          }
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
    const portfolioSnapshot = opts?.portfolioSnapshot ?? this.portfolio.snapshot()
    const nowMs = opts?.nowMs ?? this.lastMarket?.timestamp ?? portfolioSnapshot.nowMs ?? Date.now()
    const events = await this.orderManager.handleIntents(
      intents,
      {
        nowMs,
        ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
        portfolio: portfolioSnapshot,
      },
      { mode: this.intentExecutionMode },
    )
    for (const ev of events) this.enqueueAccountEvent(ev)
  }

  private enqueueAccountEvent(ev: AccountEvent): void {
    this.accountEventQueue.push(ev)
  }

  private pushRecentDrainEvent(ev: AccountEvent): void {
    this.recentDrainEvents.push({
      kind: ev.kind,
      ...(typeof (ev as { tsMs?: unknown }).tsMs === 'number'
        ? { tsMs: (ev as { tsMs: number }).tsMs }
        : {}),
    })
    if (this.recentDrainEvents.length > 10) this.recentDrainEvents.shift()
  }

  private async drainAccountEvents(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      let processed = 0
      while (this.accountEventQueue.length > 0) {
        if (processed >= this.maxEventsPerDrain) {
          this.log?.(
            '[runner] maxEventsPerDrain exceeded; halting drain and dropping queued events',
            {
              maxEventsPerDrain: this.maxEventsPerDrain,
              remaining: this.accountEventQueue.length,
              recent: this.recentDrainEvents.slice(),
            },
          )
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
      const feePaid = (() => {
        if (ev.fill.liquidity !== 'TAKER') return 0
        if (typeof ev.fill.feeRateBps !== 'number' || !Number.isFinite(ev.fill.feeRateBps)) return 0
        if (!Number.isFinite(ev.fill.price) || !Number.isFinite(ev.fill.size)) return 0
        const fee = computePolymarketTakerFee({
          feeRateBps: ev.fill.feeRateBps,
          price: ev.fill.price,
          size: ev.fill.size,
          side: ev.fill.side,
        })
        return round8(fee.feeQuote + fee.feeBase * ev.fill.price)
      })()
      this.log?.('[trade]', { ...ev.fill, timeIso, notional, cashDelta, feePaid })
    }
    this.portfolio.apply(ev)

    // Pass the latest cached plugin snapshot.
    // Note: Plugin snapshots are updated on market ticks; onAccountEvent we reuse the last cached snapshot.
    const portfolio = this.portfolio.snapshot()
    const market = this.getMarket?.()
    const balance = this.getBalance?.()
    const warmup = this.getWarmup?.()
    const positionMetrics = computePositionMetricsFromMarket({
      portfolio,
      ...(market ? { market } : {}),
    })
    const orderbookMetrics = this.lastMarket
      ? computeOrderbookMetricsFromMarket({
          marketBooks: this.lastMarket,
          ...(market ? { market } : {}),
        })
      : undefined
    const metrics =
      positionMetrics || orderbookMetrics
        ? {
            ...(positionMetrics ? { position: positionMetrics } : {}),
            ...(orderbookMetrics ? { orderbook: orderbookMetrics } : {}),
          }
        : undefined

    const plugins = this.cachedPlugins ?? this.pluginSet?.snapshot()

    const ctx: StrategyContext | undefined =
      plugins || market || metrics || warmup || balance
        ? {
            ...(plugins ? { plugins } : {}),
            ...(market ? { market } : {}),
            ...(metrics ? { metrics } : {}),
            ...(balance ? { balance } : {}),
            ...(warmup ? { warmup } : {}),
          }
        : undefined

    const nextIntents = await this.strategy.onAccountEvent(ev, portfolio, this.lastMarket, ctx)
    if (!nextIntents || nextIntents.length === 0) return

    const nowMs = this.lastMarket?.timestamp || portfolio.nowMs || Date.now()
    const nextEvents = await this.orderManager.handleIntents(
      nextIntents,
      {
        nowMs,
        ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
        portfolio,
      },
      { mode: this.intentExecutionMode },
    )
    for (const e of nextEvents) this.enqueueAccountEvent(e)
  }
}
