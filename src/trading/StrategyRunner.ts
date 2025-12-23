import type { MarketOrderBooksSnapshot } from '../orderbook/OrderBookEngine.js'
import type { AccountEvent, Intent, MarketTick, Strategy } from '../strategy/Strategy.js'
import { Portfolio } from './Portfolio.js'
import { OrderManager } from '../trading/OrderManager.js'

export type StrategyRunnerOptions = {
  strategy: Strategy
  orderManager: OrderManager
  portfolio?: Portfolio
  /**
   * Prevent infinite feedback loops (account-event triggers more intents triggers more account events).
   * Default 25.
   */
  maxCascadeDepth?: number
  log?: (msg: string, extra?: unknown) => void
}

export class StrategyRunner {
  private readonly strategy: Strategy
  private readonly orderManager: OrderManager
  private readonly portfolio: Portfolio
  private readonly maxCascadeDepth: number
  private readonly log: ((msg: string, extra?: unknown) => void) | undefined

  private lastMarket: MarketOrderBooksSnapshot | undefined

  private round8(n: number): number {
    return Math.round(n * 1e8) / 1e8
  }

  constructor(opts: StrategyRunnerOptions) {
    this.strategy = opts.strategy
    this.orderManager = opts.orderManager
    this.portfolio = opts.portfolio ?? new Portfolio()
    this.maxCascadeDepth = Math.max(1, opts.maxCascadeDepth ?? 25)
    this.log = opts.log
  }

  getPortfolio(): Portfolio {
    return this.portfolio
  }

  getLastMarketSnapshot(): MarketOrderBooksSnapshot | undefined {
    return this.lastMarket
  }

  async onMarketTick(tick: MarketTick): Promise<void> {
    this.lastMarket = tick.snapshot
    // Allow execution layer to emit fills/state updates that happen "because the market moved"
    // (only used in backtests; live fills arrive via user WS / polling).
    const preEvents = await this.orderManager.onMarketTick({
      nowMs: tick.snapshot.timestamp || Date.now(),
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.portfolio.snapshot(),
    })
    for (const ev of preEvents) await this.applyAccountEvent(ev, 0)

    const intents = await this.strategy.onMarketTick(tick, this.portfolio.snapshot())
    await this.applyIntents(intents)
  }

  async onAccountEvent(ev: AccountEvent): Promise<void> {
    await this.applyAccountEvent(ev, 0)
  }

  private async applyIntents(intents: Intent[]): Promise<void> {
    if (!intents || intents.length === 0) return
    const nowMs = this.lastMarket?.timestamp || Date.now()
    const events = await this.orderManager.handleIntents(intents, {
      nowMs,
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.portfolio.snapshot(),
    })
    for (const ev of events) await this.applyAccountEvent(ev, 0)
  }

  private async applyAccountEvent(ev: AccountEvent, depth: number): Promise<void> {
    if (ev.kind === 'fill') {
      const timeIso = new Date(ev.fill.tsMs).toISOString()
      const notional = this.round8((ev.fill.price ?? 0) * (ev.fill.size ?? 0))
      const cashDelta = ev.fill.side === 'BUY' ? this.round8(-notional) : notional
      const isBacktestSettlement =
        (typeof ev.fill.orderId === 'string' &&
          (ev.fill.orderId.startsWith('bt-merge:') || ev.fill.orderId.startsWith('bt-settle:'))) ||
        (typeof ev.fill.clientOrderId === 'string' &&
          (ev.fill.clientOrderId.includes(':merge:') || ev.fill.clientOrderId.includes(':settle:')))
      if (!isBacktestSettlement) this.log?.('[trade]', { ...ev.fill, timeIso, notional, cashDelta })
    }
    this.portfolio.apply(ev)
    if (depth >= this.maxCascadeDepth) {
      this.log?.(`[runner] cascade depth exceeded, stopping`, { depth, ev })
      return
    }

    const nextIntents = await this.strategy.onAccountEvent(
      ev,
      this.portfolio.snapshot(),
      this.lastMarket,
    )
    if (!nextIntents || nextIntents.length === 0) return

    const nowMs = this.lastMarket?.timestamp || this.portfolio.snapshot().nowMs || Date.now()
    const nextEvents = await this.orderManager.handleIntents(nextIntents, {
      nowMs,
      ...(this.lastMarket ? { lastMarket: this.lastMarket } : {}),
      portfolio: this.portfolio.snapshot(),
    })
    for (const e of nextEvents) await this.applyAccountEvent(e, depth + 1)
  }
}
