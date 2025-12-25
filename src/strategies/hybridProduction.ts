import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import { FIFTEEN_MIN_MS } from '../utils/timeWindows.js'
import { msUntilNextBoundary } from '../utils/windowBoundary.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

/**
 * Hybrid Production Bot - REAL MONEY READY
 *
 * Strategy: Combines best features of Wait-Hedge and Early-Hedge for production use
 *
 * PRODUCTION APPROACH:
 * - Ultra-conservative entry: <= $0.30 (VERY CHEAP - best possible edge)
 * - Multi-condition hedging: Profit-based + Opportunistic + Emergency
 * - Tight risk management: -15% stop loss (tighter than both bots)
 * - Smart position sizing: Scales with price (more shares when cheaper)
 * - Real-money tested thresholds: All values validated for $10 capital
 *
 * NEW PRODUCTION FEATURES:
 * - Dynamic position sizing based on price
 * - Capital preservation (never risk >30% per trade)
 * - Minimum trade validation ($0.50 min spend)
 *
 * Notes for this codebase:
 * - Polymarket Up/Down 15m markets expose TWO outcome token orderbooks (two assetIds).
 * - We treat them as (tokenA, tokenB). Entry buys the cheaper token; hedge buys the opposite token.
 * - We use FOK limit orders at bestAsk to behave like a taker entry/hedge.
 */

// NOTE: config type is inferred from the schema to stay aligned with Zod outputs
// under `exactOptionalPropertyTypes`.

const assetIdPairSchema = z
  .tuple([z.string().min(1), z.string().min(1)])
  .refine(([a, b]) => a !== b, { message: 'assetIds must contain 2 distinct strings' })

const jsonString = <T>(inner: z.ZodType<T>) =>
  z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        ctx.addIssue({ code: 'custom', message: `invalid json: ${msg}` })
        return z.NEVER
      }
    })
    .pipe(inner)

export const HybridProductionConfigSchema = z.strictObject({
  capital: z.coerce.number().finite().default(10),
  assetIds: jsonString(assetIdPairSchema).optional(),
  debug: z.coerce.boolean().default(false),
})

export type HybridProductionConfig = z.infer<typeof HybridProductionConfigSchema>

export const definition: StrategyDefinition<HybridProductionConfig> = {
  id: 'hybrid_production',
  title: 'Hybrid production',
  description: 'Production bot (v1) for 15m Up/Down markets (entry + hedge logic).',
  schema: HybridProductionConfigSchema,
  create: (params) => createHybridProductionStrategy(params),
}

function pickTwoAssetIds(tick: MarketTick, preferred?: [string, string]): [string, string] | null {
  if (
    preferred &&
    tick.snapshot.byAssetId[preferred[0]] &&
    tick.snapshot.byAssetId[preferred[1]] &&
    preferred[0] !== preferred[1]
  ) {
    return preferred
  }

  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

function finiteOr(v: number | null | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function posQty(portfolio: PortfolioSnapshot, assetId: string): number {
  const q = portfolio.positionsByAssetId[assetId]?.qty
  return typeof q === 'number' && Number.isFinite(q) ? q : 0
}

function openBuyNotional(portfolio: PortfolioSnapshot, clientPrefix: string): number {
  let sum = 0
  for (const o of Object.values(portfolio.openOrdersByClientId)) {
    if (!o.clientOrderId.startsWith(clientPrefix)) continue
    if (o.side !== 'BUY') continue
    const remaining =
      typeof o.remaining === 'number' && Number.isFinite(o.remaining) ? Math.max(0, o.remaining) : 0
    const price = typeof o.price === 'number' && Number.isFinite(o.price) ? Math.max(0, o.price) : 0
    // Add a small buffer for fees/slippage.
    sum += price * remaining * 1.02
  }
  return sum
}

export function createHybridProductionStrategy(cfg: HybridProductionConfig): Strategy {
  const name = 'hybrid_production'

  // =========================
  // Internal bot state
  // =========================
  let lastMarket: string | undefined

  let enteredAssetId: string | null = null
  let entryCost = 0 // notional (price * shares), excludes fees

  let isHedged = false
  let stopLossTriggered = false

  const minShareSize = 2 // Polymarket allows 1; keep a small buffer
  const minTimeBetweenTradesMs = 3000
  let lastTradeTimeMs = 0

  // Production safety limits
  const MAX_SINGLE_TRADE_PCT = 0.3
  const MIN_TRADE_VALUE = 0.5

  // Parameters (as in provided code)
  const ULTRA_CHEAP_ENTRY_THRESHOLD = 0.3
  const STOP_LOSS_PCT = 0.15
  const MIN_PROFIT_TO_HEDGE = 0.08
  const OPPORTUNISTIC_THRESHOLD = 0.25
  const EMERGENCY_TIME_LEFT_SEC = 60

  // Strategy-only cash tracking (updates on fills). This makes backtests deterministic and
  // keeps live behavior sane without querying balances.
  let cash = Number.isFinite(cfg.capital) ? cfg.capital : 10

  const clientPrefix = `${name}:`
  const log = (msg: string, extra?: unknown): void => {
    if (!cfg.debug) return
    if (extra === undefined) console.log(msg)
    else console.log(msg, extra)
  }

  function resetCycle(reason: string): void {
    log(`[HYBRID-PROD] resetCycle: ${reason}`)
    enteredAssetId = null
    entryCost = 0
    isHedged = false
    stopLossTriggered = false
    lastTradeTimeMs = 0
  }

  function timeLeftSeconds(nowMs: number): number {
    return Math.max(0, Math.ceil(msUntilNextBoundary(nowMs, FIFTEEN_MIN_MS) / 1000))
  }

  function calculatePositionSize(price: number, remainingCapital: number): number {
    // Calculate max shares we can afford (with 30% limit)
    const maxSpendThisTradeCapital = remainingCapital * MAX_SINGLE_TRADE_PCT
    const maxSpendThisTrade = Math.max(maxSpendThisTradeCapital, MIN_TRADE_VALUE)

    // Calculate shares we can buy with safety buffer (2% for fees)
    const maxShares = Math.floor(maxSpendThisTrade / (price * 1.02))

    // Dynamic sizing: buy more shares when price is cheaper (better edge)
    let targetShares: number
    if (price <= 0.2) {
      // Ultra cheap: buy maximum affordable (up to 10 shares)
      targetShares = Math.min(maxShares, 10)
    } else if (price <= 0.25) {
      // Very cheap: buy 6-8 shares
      targetShares = Math.min(maxShares, 8)
    } else if (price <= 0.3) {
      // Cheap: buy 4-6 shares
      targetShares = Math.min(maxShares, 6)
    } else {
      // Fallback (shouldn't reach here): minimum shares
      targetShares = Math.min(maxShares, 4)
    }

    // Enforce minimum
    return Math.max(minShareSize, targetShares)
  }

  function shouldTradeOnThisTick(args: {
    tokenAAsk: number
    tokenBAsk: number
    hasEntry: boolean
    hasHedge: boolean
    stopLoss: boolean
  }): boolean {
    const { tokenAAsk, tokenBAsk } = args
    // log(
    //   `🚀 [HYBRID-PROD] shouldTrade(): askA=$${tokenAAsk.toFixed(4)} askB=$${tokenBAsk.toFixed(4)} entered=${args.hasEntry} hedged=${args.hasHedge} stopLoss=${args.stopLoss}`,
    // )

    // Must have valid prices
    if (tokenAAsk <= 0 || tokenBAsk <= 0) return false

    // Entry phase: ULTRA CHEAP entries only
    if (!args.hasEntry) {
      return tokenAAsk <= ULTRA_CHEAP_ENTRY_THRESHOLD || tokenBAsk <= ULTRA_CHEAP_ENTRY_THRESHOLD
    }

    // Hedging phase
    if (args.hasEntry && !args.hasHedge && !args.stopLoss) return true
    return false
  }

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    // Reset state when the market changes (15m boundary rotation).
    if (lastMarket && tick.snapshot.market !== lastMarket) {
      resetCycle(`market_changed ${lastMarket} -> ${tick.snapshot.market}`)
    }
    lastMarket = tick.snapshot.market

    const nowMs = tick.snapshot.timestamp || Date.now()

    // Check cooldown
    const timeSinceLastTrade = nowMs - lastTradeTimeMs
    if (timeSinceLastTrade < minTimeBetweenTradesMs) return []

    const ids = pickTwoAssetIds(tick, cfg.assetIds)
    if (!ids) return []
    const [tokenA, tokenB] = ids

    const bookA = tick.snapshot.byAssetId[tokenA]
    const bookB = tick.snapshot.byAssetId[tokenB]
    if (!bookA || !bookB) return []

    const askA = finiteOr(bookA.bestAsk, 0)
    const bidA = finiteOr(bookA.bestBid, 0)
    const askB = finiteOr(bookB.bestAsk, 0)
    const bidB = finiteOr(bookB.bestBid, 0)

    const ok = shouldTradeOnThisTick({
      tokenAAsk: askA,
      tokenBAsk: askB,
      hasEntry: !!enteredAssetId,
      hasHedge: isHedged,
      stopLoss: stopLossTriggered,
    })
    if (!ok) return []

    const tLeft = timeLeftSeconds(nowMs)

    // Reserve cash for our own outstanding BUY orders to avoid accidental over-commit.
    const reserved = openBuyNotional(portfolio, clientPrefix)
    const remainingCapital = Math.max(0, cash - reserved)

    // ========================================
    // PHASE 1: Initial Entry (ULTRA CONSERVATIVE)
    // ========================================
    if (!enteredAssetId) {
      let sideAssetId: string | null = null
      let price = 0

      // Choose the cheapest side that's under threshold
      if (askA <= ULTRA_CHEAP_ENTRY_THRESHOLD && askB <= ULTRA_CHEAP_ENTRY_THRESHOLD) {
        if (askA < askB) {
          sideAssetId = tokenA
          price = askA
        } else {
          sideAssetId = tokenB
          price = askB
        }
      } else if (askA <= ULTRA_CHEAP_ENTRY_THRESHOLD) {
        sideAssetId = tokenA
        price = askA
      } else if (askB <= ULTRA_CHEAP_ENTRY_THRESHOLD) {
        sideAssetId = tokenB
        price = askB
      } else {
        return []
      }

      // Calculate smart position size
      let size = calculatePositionSize(price, remainingCapital)

      // Validate minimum trade value
      const estimatedCost = price * size * 1.02
      if (estimatedCost < MIN_TRADE_VALUE) {
        size = Math.ceil(MIN_TRADE_VALUE / (price * 1.02))
      }

      // Final affordability check
      const totalCostWithBuffer = price * size * 1.02
      if (totalCostWithBuffer > remainingCapital) return []
      if (size < minShareSize) return []

      const cid = `${clientPrefix}${tick.snapshot.market}:entry:${nowMs}:${sideAssetId}`

      // Store planned entry state (FOK is expected to fill-or-kill).
      enteredAssetId = sideAssetId
      entryCost = price * size
      lastTradeTimeMs = nowMs

      const otherAssetId = sideAssetId === tokenA ? tokenB : tokenA
      const expectedHedgeAsk = sideAssetId === tokenA ? askB : askA
      const expectedCombinedCost = price + expectedHedgeAsk
      const expectedEdge = 1.0 - expectedCombinedCost
      const expectedEdgePct =
        expectedCombinedCost > 0 ? (expectedEdge / expectedCombinedCost) * 100 : 0

      log(
        `🚀 [HYBRID-PROD] ENTRY ${sideAssetId} size=${size} @ $${price.toFixed(4)} cash=$${cash.toFixed(2)} reserved=$${reserved.toFixed(2)} tLeft=${tLeft}s`,
      )

      return [
        {
          kind: 'place_limit',
          clientOrderId: cid,
          assetId: sideAssetId,
          side: 'BUY',
          price,
          size,
          orderType: 'FOK',
          reason:
            `HYBRID-PROD ENTRY: buy ${sideAssetId} @ ${price.toFixed(3)} | ` +
            `hedge ~${otherAssetId} @ ${expectedHedgeAsk.toFixed(3)} ` +
            `= ${expectedCombinedCost.toFixed(3)} | edge=${expectedEdgePct.toFixed(2)}% | ` +
            `size=${size} | remaining_capital=${remainingCapital.toFixed(2)}`,
        },
      ]
    }

    // If we entered but no position yet (order pending / killed), wait.
    const entryQty = posQty(portfolio, enteredAssetId)
    if (entryQty <= 0) return []

    const otherAssetId = enteredAssetId === tokenA ? tokenB : tokenA
    const hedgeAsk = otherAssetId === tokenA ? askA : askB
    const entryBid = enteredAssetId === tokenA ? bidA : bidB

    // ========================================
    // PHASE 2: Stop Loss (TIGHTEST - Production Safety)
    // ========================================
    if (!stopLossTriggered && !isHedged) {
      const currentValue = entryQty * entryBid
      const lossPct = entryCost > 0 ? (currentValue - entryCost) / entryCost : 0
      if (lossPct <= -STOP_LOSS_PCT) {
        stopLossTriggered = true

        let hedgeSize = entryQty
        const hedgeCost = hedgeAsk * hedgeSize * 1.02
        if (hedgeCost > remainingCapital) {
          hedgeSize = Math.floor((remainingCapital * 0.9) / (hedgeAsk * 1.02))
          if (hedgeSize < minShareSize) return []
        }

        isHedged = true
        lastTradeTimeMs = nowMs
        const cid = `${clientPrefix}${tick.snapshot.market}:stop:${nowMs}:${otherAssetId}`

        log(
          `⛔ [HYBRID-PROD] STOP LOSS hedge ${otherAssetId} size=${hedgeSize} @ $${hedgeAsk.toFixed(4)} loss=${(lossPct * 100).toFixed(1)}%`,
        )

        return [
          {
            kind: 'place_limit',
            clientOrderId: cid,
            assetId: otherAssetId,
            side: 'BUY',
            price: hedgeAsk,
            size: hedgeSize,
            orderType: 'FOK',
            reason:
              `HYBRID-PROD STOP LOSS: buy ${otherAssetId} @ ${hedgeAsk.toFixed(3)} | ` +
              `loss=${(lossPct * 100).toFixed(1)}% | size=${hedgeSize} | cutting losses early`,
          },
        ]
      }
    }

    // ========================================
    // PHASE 3: Smart Hedging (Best of Both Bots)
    // ========================================
    if (!isHedged && !stopLossTriggered) {
      // Check if already hedged in portfolio (both legs present).
      const otherQty = posQty(portfolio, otherAssetId)
      if (entryQty > 0 && otherQty > 0) {
        isHedged = true
        return []
      }

      const currentValue = entryQty * entryBid
      const profitPct = entryCost > 0 ? (currentValue - entryCost) / entryCost : 0

      const profitableHedge = profitPct >= MIN_PROFIT_TO_HEDGE
      const opportunisticHedge = hedgeAsk <= OPPORTUNISTIC_THRESHOLD
      const emergencyHedge = tLeft <= EMERGENCY_TIME_LEFT_SEC

      if (profitableHedge || opportunisticHedge || emergencyHedge) {
        let hedgeSize = entryQty

        // Check affordability
        const hedgeCost = hedgeAsk * hedgeSize * 1.02
        if (hedgeCost > remainingCapital) {
          hedgeSize = Math.floor((remainingCapital * 0.9) / (hedgeAsk * 1.02))
          if (hedgeSize < minShareSize) return []
        }

        isHedged = true
        lastTradeTimeMs = nowMs

        const cid = `${clientPrefix}${tick.snapshot.market}:hedge:${nowMs}:${otherAssetId}`

        let reasonType = 'PROFIT-LOCK'
        if (opportunisticHedge && !profitableHedge) reasonType = 'OPPORTUNISTIC'
        if (emergencyHedge) reasonType = 'EMERGENCY'

        const totalCost = entryCost + hedgeAsk * hedgeSize
        const payout = Math.min(entryQty, hedgeSize) * 1.0
        const lockedProfit = payout - totalCost
        const lockedProfitPct = totalCost > 0 ? (lockedProfit / totalCost) * 100 : 0

        log(
          `💰 [HYBRID-PROD] HEDGE(${reasonType}) buy ${otherAssetId} size=${hedgeSize} @ $${hedgeAsk.toFixed(4)} unrealized=${(profitPct * 100).toFixed(1)}% locked=$${lockedProfit.toFixed(2)} (${lockedProfitPct.toFixed(1)}%) tLeft=${tLeft}s`,
        )

        return [
          {
            kind: 'place_limit',
            clientOrderId: cid,
            assetId: otherAssetId,
            side: 'BUY',
            price: hedgeAsk,
            size: hedgeSize,
            orderType: 'FOK',
            reason:
              `HYBRID-PROD ${reasonType}: buy ${otherAssetId} @ ${hedgeAsk.toFixed(3)} | ` +
              `unrealized=${(profitPct * 100).toFixed(1)}% | ` +
              `locked=$${lockedProfit.toFixed(2)} (${lockedProfitPct.toFixed(1)}%) | ` +
              `size=${hedgeSize} | tLeft=${tLeft}s`,
          },
        ]
      }
    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev) => {
    // Keep internal cash accounting in sync with fills.
    if (ev.kind === 'fill') {
      const f = ev.fill
      // Only account fills for our own orders (clientOrderId prefix).
      if (f.clientOrderId && f.clientOrderId.startsWith(clientPrefix)) {
        const notional = f.price * f.size
        if (f.side === 'BUY') cash = cash - notional
        else cash = cash + notional
      }
      return []
    }

    // Market settled: reset cycle to allow new entries in next market
    if (ev.kind === 'market_settled') {
      resetCycle(`market_settled(${ev.market})`)
      return []
    }

    // If our entry order was killed/rejected, allow re-entry.
    if (ev.kind === 'order_rejected' && ev.clientOrderId.startsWith(clientPrefix)) {
      if (ev.clientOrderId.includes(':entry:')) resetCycle(`entry_order_rejected(${ev.reason})`)
      return []
    }
    if (ev.kind === 'order_done' && ev.clientOrderId && ev.clientOrderId.startsWith(clientPrefix)) {
      if (ev.clientOrderId.includes(':entry:') && ev.reason === 'killed') {
        resetCycle('entry_order_killed')
      }
      return []
    }

    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
