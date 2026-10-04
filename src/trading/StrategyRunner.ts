import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import { isSyntheticFeedTick } from '../market/syntheticTick.js'
import type {
  AccountEvent,
  CapitalSnapshot,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../strategy/Strategy.js'
import type { StrategyContext, WarmupSnapshot } from '../strategy/StrategyContext.js'
import { PluginSet, type PluginsSnapshot } from '../strategy/plugins/PluginSet.js'
import type { BuiltStrategy } from '../strategy/strategyDefinition.js'
import { DEFAULT_STARTING_CAPITAL, validateStartingCapital } from './capital.js'
import { Portfolio } from './Portfolio.js'
import { resolveMaxEventsPerDrain } from './runnerConfig.js'
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
  /** Diagnostic hooks only. Observers must copy data and must never mutate engine state. */
  observer?: StrategyRunnerObserver
  strategyId?: string
  strategyParams?: Record<string, unknown>
  externalFeedsEnabled?: StrategyExternalFeedsEnabled
  strategy: Strategy
  /** Required for runners spanning multiple markets; creates fresh player state. */
  createStrategy?: () => BuiltStrategy
  /** USDC per market. Defaults to 500; unrelated to actual wallet balances. */
  startingCapital?: number
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
   * Uses MAX_EVENTS_PER_DRAIN (default 4200) unless explicitly overridden.
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

export type StrategyRunnerObserver = {
  onCapital?: (capital: Readonly<CapitalSnapshot> | undefined) => void
  onContext?: (context: StrategyContext | undefined) => void
  onDecision?: (origin: 'market' | 'account', intents: readonly Intent[]) => void
  onAccountEvent?: (event: AccountEvent, portfolio: PortfolioSnapshot) => void
}

export class StrategyRunner {
  private readonly observer: StrategyRunnerObserver | undefined
  private readonly strategyId: string | undefined
  private readonly strategyParams: Record<string, unknown> | undefined
  private readonly externalFeedsEnabled: StrategyExternalFeedsEnabled | undefined
  private strategy: Strategy
  private readonly createStrategy: (() => BuiltStrategy) | undefined
  private readonly startingCapital: number
  private readonly orderManager: OrderManager
  private portfolio: Portfolio
  private pluginSet: PluginSet | undefined
  private readonly portfoliosByMarket = new Map<string, Portfolio>()
  private readonly accountMarketByAssetId = new Map<string, string>()
  private readonly accountMarketByOrderId = new Map<string, string>()
  private readonly accountMarketByClientId = new Map<string, string>()
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
    this.observer = opts.observer
    this.strategyId = opts.strategyId
    this.strategyParams = opts.strategyParams
    this.externalFeedsEnabled = opts.externalFeedsEnabled
    this.strategy = opts.strategy
    this.createStrategy = opts.createStrategy
    this.startingCapital = validateStartingCapital(
      opts.startingCapital ??
        opts.portfolio?.snapshot().capital?.startingCapital ??
        DEFAULT_STARTING_CAPITAL,
    )
    this.orderManager = opts.orderManager
    this.portfolio = opts.portfolio ?? new Portfolio({ startingCapital: this.startingCapital })
    this.pluginSet = opts.pluginSet
    this.getMarket = opts.getMarket
    this.getBalance = opts.getBalance
    this.getWarmup = opts.getWarmup
    this.intentExecutionMode = opts.intentExecutionMode ?? 'queued'
    this.maxEventsPerDrain = resolveMaxEventsPerDrain(opts.maxEventsPerDrain)
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
    this.pluginSet?.captureMarketTick?.(tick)
    return this.runSerial('tick', async () => {
      await this.processMarketTick(tick)
      if (this.observer?.onCapital) {
        this.observer.onCapital(
          this.orderManager.withPendingCapital(this.portfolio.snapshot()).capital,
        )
      }
    })
  }

  private async processMarketTick(tick: MarketTick): Promise<void> {
    const market = this.getMarket?.()
    const balance = this.getBalance?.()
    const warmup = this.getWarmup?.()

    // Reset per-episode plugin state on market change (align with strategy reset semantics).
    const marketKey = tick.snapshot.market ?? null
    if (marketKey && this.lastMarketKey && marketKey !== this.lastMarketKey) {
      if (!this.createStrategy)
        throw new Error(
          'A multi-market StrategyRunner requires createStrategy to reset player state',
        )
      // Cancel old resting orders, accounting for the response in their original
      // portfolio without asking the old strategy to generate more decisions.
      const orders = Object.values(this.portfolio.snapshot().openOrdersByClientId)
      if (orders.length > 0) {
        const events = await this.orderManager.handleIntents(
          [{ kind: 'cancel_batch', orders }],
          {
            nowMs: tick.snapshot.timestamp,
            ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
            portfolio: this.portfolio.snapshot(),
          },
          { mode: 'immediate' },
        )
        for (const event of events) {
          this.portfolio.apply(event)
          this.orderManager.reconcileActiveOrders(this.portfolio.snapshot(), event)
        }
      }
      this.orderManager.beginMarket()
      this.portfolio =
        this.portfoliosByMarket.get(marketKey) ??
        new Portfolio({ startingCapital: this.startingCapital })
      const built = this.createStrategy()
      this.strategy = built.strategy
      this.pluginSet?.reset()
      this.pluginSet = built.pluginSet
      if (!this.pluginSet && built.plugins?.length) {
        this.pluginSet = new PluginSet()
        for (const plugin of built.plugins) this.pluginSet.register(plugin)
      }
      this.cachedPlugins = undefined
      this.waitedTechIndicatorsMarketKey = null
      this.lateStartCheckedMarketKey = null
      this.lateStartBlockedMarketKey = null
    }
    if (marketKey) {
      this.lastMarketKey = marketKey
      this.portfoliosByMarket.set(marketKey, this.portfolio)
      for (const assetId of Object.keys(tick.snapshot.byAssetId))
        this.accountMarketByAssetId.set(assetId, marketKey)
    }
    this.lastMarket = tick.snapshot
    this.portfolio.initializeClock(tick.snapshot.timestamp || Date.now())

    // Allow execution layer to emit fills/state updates that happen "because the market moved"
    // (only used in backtests; live fills arrive via user WS / polling).
    //
    // Synthetic feed ticks carry an UNCHANGED book, so the execution simulator
    // must not run on them: re-testing a resting maker remainder against a
    // stale crossed book would create fills live never gives, and GTD expiry /
    // the latency queue would re-time. Live this call is a no-op anyway
    // (LiveExecution.onMarketTick returns []), so skipping it here — in shared
    // code — keeps live == replay by construction. Queued-mode intents
    // consequently also dispatch only on real book ticks, in both runtimes.
    if (!isSyntheticFeedTick(tick.msg)) {
      const preEvents = await this.orderManager.onMarketTick({
        nowMs: tick.snapshot.timestamp || Date.now(),
        ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
        portfolio: this.portfolio.snapshot(),
      })
      for (const ev of preEvents) this.enqueueAccountEvent(ev)
      await this.drainAccountEvents()
    }

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

    this.observer?.onContext?.(ctx)
    const decisionPortfolio = this.orderManager.withPendingCapital(portfolio)
    this.observer?.onCapital?.(decisionPortfolio.capital)
    const intents = await this.strategy.onMarketTick(tick, decisionPortfolio, ctx)
    this.observer?.onDecision?.('market', intents)
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
            ...(i.postOnly !== undefined ? { postOnly: i.postOnly } : {}),
            ...(i.reason ? { reason: i.reason } : {}),
          }
        }
        if (i.kind === 'place_batch') {
          return {
            kind: i.kind,
            orderCount: i.orders.length,
            postOnlyCount: i.orders.filter((order) => order.postOnly === true).length,
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
        if (i.kind === 'cancel_batch') {
          return { kind: i.kind, orders: i.orders, ...(i.reason ? { reason: i.reason } : {}) }
        }
        if (i.kind === 'cancel_market') {
          return {
            kind: i.kind,
            market: i.market,
            assetId: i.assetId,
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
    const eventMarket = this.accountEventMarket(ev)
    if (eventMarket && eventMarket !== this.lastMarketKey) {
      let original = this.portfoliosByMarket.get(eventMarket)
      if (!original) {
        original = new Portfolio({ startingCapital: this.startingCapital })
        this.portfoliosByMarket.set(eventMarket, original)
      }
      original.apply(ev)
      // No old-market event is delivered to the new player or new allowance.
      return
    }
    if (ev.kind === 'fill') {
      const timeIso = new Date(ev.fill.tsMs).toISOString()
      const notional = round8((ev.fill.price ?? 0) * (ev.fill.size ?? 0))
      const cashDelta = ev.fill.side === 'BUY' ? round8(-notional) : notional
      const feePaid = (() => {
        if (ev.fill.liquidity !== 'TAKER') return 0
        if (typeof ev.fill.feeRateBps !== 'number' || !Number.isFinite(ev.fill.feeRateBps)) return 0
        if (!Number.isFinite(ev.fill.price) || !Number.isFinite(ev.fill.size)) return 0
        return round8(
          computePolymarketTakerFee({
            feeRateBps: ev.fill.feeRateBps,
            price: ev.fill.price,
            size: ev.fill.size,
          }),
        )
      })()
      this.log?.('[trade]', { ...ev.fill, timeIso, notional, cashDelta, feePaid })
    }
    if (ev.kind === 'cancel_failed') this.log?.('[cancel_failed]', ev)
    this.portfolio.apply(ev)
    this.orderManager.reconcileActiveOrders(this.portfolio.snapshot(), ev)

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

    const decisionPortfolio = this.orderManager.withPendingCapital(portfolio)
    this.observer?.onAccountEvent?.(ev, decisionPortfolio)
    const nextIntents = await this.strategy.onAccountEvent(
      ev,
      decisionPortfolio,
      this.lastMarket,
      ctx,
    )
    this.observer?.onDecision?.('account', nextIntents)
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

  private accountEventMarket(ev: AccountEvent): string | undefined {
    const detail =
      ev.kind === 'fill'
        ? ev.fill
        : ev.kind === 'positions_split'
          ? ev.split
          : ev.kind === 'order_submitted' || ev.kind === 'ws_order_update'
            ? ev.order
            : ev
    const orderId = 'orderId' in detail ? detail.orderId : undefined
    const clientId = 'clientOrderId' in detail ? detail.clientOrderId : undefined
    const assetId =
      'assetId' in detail ? detail.assetId : 'assetIdA' in detail ? detail.assetIdA : undefined
    const market =
      ('market' in detail ? detail.market : undefined) ??
      (orderId ? this.accountMarketByOrderId.get(orderId) : undefined) ??
      (assetId ? this.accountMarketByAssetId.get(assetId) : undefined) ??
      (clientId ? this.accountMarketByClientId.get(clientId) : undefined) ??
      this.lastMarketKey ??
      undefined
    if (market) {
      if (orderId) this.accountMarketByOrderId.set(orderId, market)
      if (clientId && ev.kind === 'order_submitted')
        this.accountMarketByClientId.set(clientId, market)
      if (assetId) this.accountMarketByAssetId.set(assetId, market)
      if ('assetIdB' in detail) this.accountMarketByAssetId.set(detail.assetIdB, market)
    }
    return market
  }
}
