import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../strategy/Strategy.js'
import type { SettlementCoordinator } from '../settlement/SettlementCoordinator.js'
import { Portfolio } from './Portfolio.js'
import { OrderManager } from './OrderManager.js'
import { round8 } from './utils/rounding.js'

export type StrategyRunnerOptions = {
  strategy: Strategy
  orderManager: OrderManager
  portfolio?: Portfolio
  settlementCoordinator?: SettlementCoordinator
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
  private readonly settlementCoordinator: SettlementCoordinator | undefined
  private readonly maxCascadeDepth: number
  private readonly log: ((msg: string, extra?: unknown) => void) | undefined

  private lastMarket: MarketOrderBooksSnapshot | undefined
  private lastMarketId: string | undefined
  private lastTickTime: number | undefined

  constructor(opts: StrategyRunnerOptions) {
    this.strategy = opts.strategy
    this.orderManager = opts.orderManager
    this.portfolio = opts.portfolio ?? new Portfolio()
    this.settlementCoordinator = opts.settlementCoordinator
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
    // Check for market settlement BEFORE processing the tick
    if (this.settlementCoordinator) {
      const checkParams: {
        currentTick: MarketTick
        portfolio: PortfolioSnapshot
        lastMarket?: string
        lastTickTime?: number
      } = {
        currentTick: tick,
        portfolio: this.portfolio.snapshot(),
      }
      if (this.lastMarketId !== undefined) checkParams.lastMarket = this.lastMarketId
      if (this.lastTickTime !== undefined) checkParams.lastTickTime = this.lastTickTime

      const settlementEvent = await this.settlementCoordinator.checkSettlement(checkParams)

      if (settlementEvent) {
        if (settlementEvent.kind === 'market_settled') {
          this.log?.('[settlement]', {
            market: settlementEvent.market,
            reason: settlementEvent.reason,
            payouts: settlementEvent.payouts,
          })
        }
        await this.applyAccountEvent(settlementEvent, 0)
      }
    }

    // Update tracking for next settlement check
    this.lastMarketId = tick.snapshot.market
    this.lastTickTime = tick.snapshot.timestamp || Date.now()
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
      const notional = round8((ev.fill.price ?? 0) * (ev.fill.size ?? 0))
      const cashDelta = ev.fill.side === 'BUY' ? round8(-notional) : notional
      this.log?.('[trade]', { ...ev.fill, timeIso, notional, cashDelta })
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
