import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import { FIFTEEN_MIN_MS } from '../utils/timeWindows.js'
import { msUntilNextBoundary } from '../utils/windowBoundary.js'

/**
 * Hybrid Production 2 (arb-first, minimal unhedged risk)
 *
 * Design goals:
 * - WAIT by default: do nothing unless we can lock a 2-leg arbitrage (A+B < 1) with buffers
 * - HEDGE via atomic(ish) pair entry: submit both legs as FOK in the same tick batch
 * - MINIMIZE LOSS: if only one leg fills (live), immediately retry the other leg if still profitable;
 *   otherwise unwind the filled leg with a taker SELL (FOK) to get flat.
 *
 * Notes:
 * - For Polymarket Up/Down 15m markets you have TWO outcome tokens (two assetIds).
 * - Owning 1 share of each outcome yields $1 payout at settlement; buying both for < $1 locks profit.
 * - Backtests model FOK as fill-or-kill atomically per order; live may produce partial/async fills.
 */

export type HybridProduction2Config = {
  /**
   * Starting capital used for internal "cash" tracking (strategy-only).
   * This does NOT query the real exchange balance.
   */
  capital: number

  /** Optional: explicitly choose which two outcome tokens to trade. */
  assetIds?: [string, string]

  /** Toggle verbose logging. */
  debug?: boolean

  /**
   * Minimum locked profit per paired share AFTER applying fee/slippage buffers.
   * Example: 0.01 means we require at least 1 cent per pair.
   */
  minLockedProfitPerShare?: number

  /**
   * Simple multiplicative buffer applied to notional costs to approximate fees/slippage.
   * (HybridProduction uses 1.02.)
   */
  costBuffer?: number

  /** Never risk more than this fraction of remaining cash per new pair trade. */
  maxSingleTradePct?: number

  /** Minimum spend (notional) per trade batch. */
  minTradeValue?: number

  /** Minimum shares (pairs) per trade. */
  minPairSize?: number

  /** Cap max shares (pairs) per trade to stay conservative. */
  maxPairSize?: number

  /** Minimum seconds left in the 15m window to open a new position. */
  minSecondsLeftToEnter?: number

  /**
   * If we end up unhedged (one leg filled), how long we allow it before forcing an unwind.
   * (In live, missing-leg fills can arrive async; keep this short.)
   */
  maxUnhedgedHoldMs?: number
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

function posAvg(portfolio: PortfolioSnapshot, assetId: string): number | null {
  const p = portfolio.positionsByAssetId[assetId]
  if (!p) return null
  const v = p.avgEntryPrice
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function openBuyNotional(portfolio: PortfolioSnapshot, clientPrefix: string, buffer: number): number {
  let sum = 0
  for (const o of Object.values(portfolio.openOrdersByClientId)) {
    if (!o.clientOrderId.startsWith(clientPrefix)) continue
    if (o.side !== 'BUY') continue
    const remaining =
      typeof o.remaining === 'number' && Number.isFinite(o.remaining) ? Math.max(0, o.remaining) : 0
    const price = typeof o.price === 'number' && Number.isFinite(o.price) ? Math.max(0, o.price) : 0
    sum += price * remaining * buffer
  }
  return sum
}

type LegStatus = 'idle' | 'submitted' | 'filled' | 'failed'

type ActivePair = {
  market: string
  tokenA: string
  tokenB: string
  size: number
  createdAtMs: number
  // legs
  cidA: string
  cidB: string
  statusA: LegStatus
  statusB: LegStatus
  filledQtyA: number
  filledQtyB: number
  filledNotionalA: number
  filledNotionalB: number
  fillPriceA: number | null
  fillPriceB: number | null
}

export function createHybridProduction2Strategy(cfg: HybridProduction2Config): Strategy {
  const name = 'hybrid_production2'
  const clientPrefix = `${name}:`

  // Tunables (conservative defaults)
  const minLockedProfitPerShare = finiteOr(cfg.minLockedProfitPerShare, 0.01)
  const costBuffer = finiteOr(cfg.costBuffer, 1.02)
  const maxSingleTradePct = finiteOr(cfg.maxSingleTradePct, 0.3)
  const minTradeValue = finiteOr(cfg.minTradeValue, 0.5)
  const minPairSize = Math.max(1, Math.floor(finiteOr(cfg.minPairSize, 2)))
  const maxPairSize = Math.max(minPairSize, Math.floor(finiteOr(cfg.maxPairSize, 10)))
  const minSecondsLeftToEnter = Math.max(0, Math.floor(finiteOr(cfg.minSecondsLeftToEnter, 5)))
  const maxUnhedgedHoldMs = Math.max(250, Math.floor(finiteOr(cfg.maxUnhedgedHoldMs, 2500)))

  const minTimeBetweenActionsMs = 250
  let lastActionMs = 0

  // Strategy-only cash tracking (updates on fills).
  let cash = Number.isFinite(cfg.capital) ? cfg.capital : 10

  // Reset when market changes (15m boundary).
  let lastMarket: string | undefined

  // In-flight pair (to manage partial fills / unwinds deterministically).
  let activePair: ActivePair | null = null

  const log = (msg: string, extra?: unknown): void => {
    if (!cfg.debug) return
    if (extra === undefined) console.log(msg)
    else console.log(msg, extra)
  }

  function reset(reason: string): void {
    log(`[HYBRID-PROD-2] reset: ${reason}`)
    activePair = null
    lastActionMs = 0
  }

  function timeLeftSeconds(nowMs: number): number {
    return Math.max(0, Math.ceil(msUntilNextBoundary(nowMs, FIFTEEN_MIN_MS) / 1000))
  }

  function pairLockedProfitPerShare(params: { priceA: number; priceB: number }): number {
    const totalBuffered = (params.priceA + params.priceB) * costBuffer
    return 1.0 - totalBuffered
  }

  function canAffordCost(params: { totalCostBuffered: number; remainingCapital: number }): boolean {
    return params.totalCostBuffered > 0 && params.totalCostBuffered <= params.remainingCapital
  }

  function totalBufferedCostForPairs(params: { askA: number; askB: number; pairs: number }): number {
    return (params.askA + params.askB) * params.pairs * costBuffer
  }

  function canAffordPairs(params: {
    askA: number
    askB: number
    pairs: number
    remainingCapital: number
    enforceMinTradeValue?: boolean
  }): boolean {
    const total = (params.askA + params.askB) * params.pairs * costBuffer
    const ok = canAffordCost({ totalCostBuffered: total, remainingCapital: params.remainingCapital })
    if (!ok) return false
    const enforceMin = params.enforceMinTradeValue ?? true
    return enforceMin ? total >= minTradeValue : true
  }

  function computePairSize(params: {
    askA: number
    askB: number
    remainingCapital: number
  }): number {
    const maxSpend = Math.max(minTradeValue, params.remainingCapital * maxSingleTradePct)
    const perPair = (params.askA + params.askB) * costBuffer
    if (perPair <= 0) return 0
    const maxPairs = Math.floor(maxSpend / perPair)
    const capped = Math.min(maxPairSize, maxPairs)
    return Math.max(0, capped)
  }

  function buildPairIntents(params: {
    market: string
    nowMs: number
    tokenA: string
    tokenB: string
    askA: number
    askB: number
    size: number
    reason: string
  }): { intents: Intent[]; pair: ActivePair } {
    const pairId = `${params.market}:${params.nowMs}`
    const cidA = `${clientPrefix}${pairId}:buy:${params.tokenA}`
    const cidB = `${clientPrefix}${pairId}:buy:${params.tokenB}`
    const intents: Intent[] = [
      {
        kind: 'place_limit',
        clientOrderId: cidA,
        assetId: params.tokenA,
        side: 'BUY',
        price: params.askA,
        size: params.size,
        orderType: 'FOK',
        reason: params.reason,
      },
      {
        kind: 'place_limit',
        clientOrderId: cidB,
        assetId: params.tokenB,
        side: 'BUY',
        price: params.askB,
        size: params.size,
        orderType: 'FOK',
        reason: params.reason,
      },
    ]
    const pair: ActivePair = {
      market: params.market,
      tokenA: params.tokenA,
      tokenB: params.tokenB,
      size: params.size,
      createdAtMs: params.nowMs,
      cidA,
      cidB,
      statusA: 'submitted',
      statusB: 'submitted',
      filledQtyA: 0,
      filledQtyB: 0,
      filledNotionalA: 0,
      filledNotionalB: 0,
      fillPriceA: null,
      fillPriceB: null,
    }
    return { intents, pair }
  }

  function buildUnwindIntent(params: {
    market: string
    nowMs: number
    assetId: string
    bid: number
    size: number
    why: string
  }): Intent | null {
    if (params.bid <= 0 || params.size <= 0) return null
    const cid = `${clientPrefix}${params.market}:${params.nowMs}:unwind:sell:${params.assetId}`
    return {
      kind: 'place_limit',
      clientOrderId: cid,
      assetId: params.assetId,
      side: 'SELL',
      price: params.bid,
      size: params.size,
      orderType: 'FOK',
      reason: params.why,
    }
  }

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    // Reset state when the market changes (15m boundary rotation).
    if (lastMarket && tick.snapshot.market !== lastMarket) {
      reset(`market_changed ${lastMarket} -> ${tick.snapshot.market}`)
    }
    lastMarket = tick.snapshot.market

    const nowMs = tick.snapshot.timestamp || Date.now()
    const tLeft = timeLeftSeconds(nowMs)

    // tiny action cooldown to avoid repeated retries on noisy live streams
    if (nowMs - lastActionMs < minTimeBetweenActionsMs) return []

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
    if (askA <= 0 || askB <= 0) return []

    // Reserve cash for our own outstanding BUY orders.
    const reserved = openBuyNotional(portfolio, clientPrefix, costBuffer)
    const remainingCapital = Math.max(0, cash - reserved)

    const qtyA = posQty(portfolio, tokenA)
    const qtyB = posQty(portfolio, tokenB)

    // 1) If we have an active pair, manage it (retry hedge or unwind).
    if (activePair) {
      // If we somehow drifted to a new market, reset.
      if (activePair.market !== tick.snapshot.market) {
        reset(`active_pair_market_mismatch ${activePair.market} vs ${tick.snapshot.market}`)
        return []
      }

      const ageMs = nowMs - activePair.createdAtMs
      const eps = 1e-6
      const legAFilled = activePair.filledQtyA + eps >= activePair.size
      const legBFilled = activePair.filledQtyB + eps >= activePair.size
      const filledA = qtyA >= minPairSize && legAFilled
      const filledB = qtyB >= minPairSize && legBFilled

      // Completed: both legs filled (balanced).
      if (legAFilled && legBFilled) {
        log(`[HYBRID-PROD-2] pair complete`, {
          market: activePair.market,
          size: activePair.size,
          fillA: activePair.fillPriceA,
          fillB: activePair.fillPriceB,
        })
        activePair = null
        return []
      }

      // Failed both legs: nothing to do.
      if (activePair.statusA === 'failed' && activePair.statusB === 'failed') {
        activePair = null
        return []
      }

      // If one leg failed but the other didn't fill, just clear.
      if (
        (activePair.statusA === 'failed' && !filledA) ||
        (activePair.statusB === 'failed' && !filledB)
      ) {
        activePair = null
        return []
      }

      // Unhedged state: exactly one leg is filled.
      const oneFilled =
        (activePair.filledQtyA > 0 && activePair.filledQtyB <= 0) ||
        (activePair.filledQtyB > 0 && activePair.filledQtyA <= 0)

      if (oneFilled) {
        const filledAsset = activePair.filledQtyA > 0 ? tokenA : tokenB
        const missingAsset = activePair.filledQtyA > 0 ? tokenB : tokenA
        const filledBid = filledAsset === tokenA ? bidA : bidB
        const missingAsk = missingAsset === tokenA ? askA : askB
        const missingBid = missingAsset === tokenA ? bidA : bidB

        const filledQty = Math.max(0, posQty(portfolio, filledAsset))
        const filledPrice = filledAsset === tokenA ? activePair.fillPriceA : activePair.fillPriceB

        // If we know our fill price, prefer completing the hedge ONLY if it still locks profit.
        const stillProfitable =
          typeof filledPrice === 'number' && Number.isFinite(filledPrice)
            ? pairLockedProfitPerShare({
                priceA: filledAsset === tokenA ? filledPrice : missingAsk,
                priceB: filledAsset === tokenA ? missingAsk : filledPrice,
              }) >= minLockedProfitPerShare
            : false

        const canHedgeNow =
          stillProfitable &&
          tLeft > 0 &&
          filledQty >= minPairSize &&
          canAffordPairs({
            askA: missingAsk,
            askB: 0,
            pairs: Math.min(activePair.size, Math.floor(filledQty)),
            remainingCapital,
            enforceMinTradeValue: false,
          })

        // If we can complete the pair safely, try the missing leg (FOK).
        if (canHedgeNow) {
          const hedgeSize = Math.min(activePair.size, Math.floor(filledQty))
          const cid = `${clientPrefix}${tick.snapshot.market}:${nowMs}:repair:buy:${missingAsset}`
          lastActionMs = nowMs
          if (missingAsset === tokenA) activePair.cidA = cid
          else activePair.cidB = cid
          if (missingAsset === tokenA) activePair.statusA = 'submitted'
          else activePair.statusB = 'submitted'
          // reset leg fill tracking for the missing leg retry
          if (missingAsset === tokenA) {
            activePair.filledQtyA = 0
            activePair.filledNotionalA = 0
            activePair.fillPriceA = null
          } else {
            activePair.filledQtyB = 0
            activePair.filledNotionalB = 0
            activePair.fillPriceB = null
          }

          log(`[HYBRID-PROD-2] repair hedge leg`, {
            filledAsset,
            missingAsset,
            hedgeSize,
            missingAsk,
          })

          return [
            {
              kind: 'place_limit',
              clientOrderId: cid,
              assetId: missingAsset,
              side: 'BUY',
              price: missingAsk,
              size: hedgeSize,
              orderType: 'FOK',
              reason: `HYBRID-PROD-2 REPAIR: complete hedge for filled ${filledAsset} @ bid=${filledBid.toFixed(
                3,
              )}, buy missing ${missingAsset} @ ${missingAsk.toFixed(3)}`,
            },
          ]
        }

        // Otherwise, if we've been unhedged too long or the missing leg isn't profitable, unwind.
        if (ageMs >= maxUnhedgedHoldMs || !stillProfitable) {
          lastActionMs = nowMs
          const why =
            `HYBRID-PROD-2 UNWIND: unhedged(${filledAsset}) ageMs=${ageMs} stillProfitable=${stillProfitable} ` +
            `missingAsk=${missingAsk.toFixed(3)} missingBid=${missingBid.toFixed(3)}`
          const unwind = buildUnwindIntent({
            market: tick.snapshot.market,
            nowMs,
            assetId: filledAsset,
            bid: filledBid,
            size: Math.floor(filledQty),
            why,
          })
          log(`[HYBRID-PROD-2] unwind`, { filledAsset, size: filledQty, bid: filledBid, why })
          activePair = null
          return unwind ? [unwind] : []
        }
      }

      // Otherwise: waiting for fills; do nothing.
      return []
    }

    // 2) If we are unbalanced without an active pair (e.g. restart), attempt to hedge or unwind.
    const unbalanced = (qtyA > 0 && qtyB <= 0) || (qtyB > 0 && qtyA <= 0)
    if (unbalanced) {
      const filledAsset = qtyA > 0 ? tokenA : tokenB
      const missingAsset = qtyA > 0 ? tokenB : tokenA
      const filledQty = Math.floor(qtyA > 0 ? qtyA : qtyB)
      const filledAvg = posAvg(portfolio, filledAsset)
      const filledBid = filledAsset === tokenA ? bidA : bidB
      const missingAsk = missingAsset === tokenA ? askA : askB

      const stillProfitable =
        filledAvg !== null
          ? pairLockedProfitPerShare({
              priceA: filledAsset === tokenA ? filledAvg : missingAsk,
              priceB: filledAsset === tokenA ? missingAsk : filledAvg,
            }) >= minLockedProfitPerShare
          : false

      // Prefer hedging if it still locks profit after buffers; otherwise unwind to get flat.
      if (stillProfitable && filledQty >= minPairSize && remainingCapital > 0) {
        const hedgeSize = Math.min(maxPairSize, filledQty)
        const total = totalBufferedCostForPairs({ askA: missingAsk, askB: 0, pairs: hedgeSize })
        if (canAffordCost({ totalCostBuffered: total, remainingCapital })) {
          lastActionMs = nowMs
          const cid = `${clientPrefix}${tick.snapshot.market}:${nowMs}:bootstrap:buy:${missingAsset}`
          log(`[HYBRID-PROD-2] bootstrap hedge`, { filledAsset, missingAsset, hedgeSize, missingAsk })
          return [
            {
              kind: 'place_limit',
              clientOrderId: cid,
              assetId: missingAsset,
              side: 'BUY',
              price: missingAsk,
              size: hedgeSize,
              orderType: 'FOK',
              reason: `HYBRID-PROD-2 BOOTSTRAP: hedge missing leg ${missingAsset} @ ${missingAsk.toFixed(
                3,
              )} for existing ${filledAsset}`,
            },
          ]
        }
      }

      // Unwind.
      if (filledBid > 0 && filledQty > 0) {
        lastActionMs = nowMs
        const unwind = buildUnwindIntent({
          market: tick.snapshot.market,
          nowMs,
          assetId: filledAsset,
          bid: filledBid,
          size: filledQty,
          why: `HYBRID-PROD-2 BOOTSTRAP UNWIND: unbalanced position in ${filledAsset}`,
        })
        return unwind ? [unwind] : []
      }
      return []
    }

    // 3) WAIT unless we can open a fresh arbitrage pair with enough time left.
    if (tLeft < minSecondsLeftToEnter) return []
    if (remainingCapital < minTradeValue) return []

    const locked = pairLockedProfitPerShare({ priceA: askA, priceB: askB })
    if (locked < minLockedProfitPerShare) return []

    const size = computePairSize({ askA, askB, remainingCapital })
    if (size < minPairSize) return []
    if (!canAffordPairs({ askA, askB, pairs: size, remainingCapital })) return []

    const reason =
      `HYBRID-PROD-2 ARB: buy BOTH @ asks A=${askA.toFixed(3)} B=${askB.toFixed(
        3,
      )} ` +
      `costBuffered=${((askA + askB) * costBuffer).toFixed(3)} locked=${locked.toFixed(3)} ` +
      `size=${size} cash=${cash.toFixed(2)} reserved=${reserved.toFixed(2)} tLeft=${tLeft}s`

    const { intents, pair } = buildPairIntents({
      market: tick.snapshot.market,
      nowMs,
      tokenA,
      tokenB,
      askA,
      askB,
      size,
      reason,
    })
    activePair = pair
    lastActionMs = nowMs
    log(`[HYBRID-PROD-2] enter pair`, {
      market: tick.snapshot.market,
      tokenA,
      tokenB,
      askA,
      askB,
      size,
      locked,
    })
    return intents
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, lastMarketSnap) => {
    // Keep internal cash accounting in sync with fills.
    if (ev.kind === 'fill') {
      const f = ev.fill
      if (f.clientOrderId && f.clientOrderId.startsWith(clientPrefix)) {
        const notional = f.price * f.size
        if (f.side === 'BUY') cash = cash - notional
        else cash = cash + notional
      }

      // Update activePair fill bookkeeping.
      if (activePair && f.clientOrderId) {
        if (f.clientOrderId === activePair.cidA && f.side === 'BUY') {
          activePair.filledQtyA += f.size
          activePair.filledNotionalA += f.price * f.size
          activePair.fillPriceA =
            activePair.filledQtyA > 0 ? activePair.filledNotionalA / activePair.filledQtyA : null
          if (activePair.filledQtyA + 1e-6 >= activePair.size) activePair.statusA = 'filled'
        }
        if (f.clientOrderId === activePair.cidB && f.side === 'BUY') {
          activePair.filledQtyB += f.size
          activePair.filledNotionalB += f.price * f.size
          activePair.fillPriceB =
            activePair.filledQtyB > 0 ? activePair.filledNotionalB / activePair.filledQtyB : null
          if (activePair.filledQtyB + 1e-6 >= activePair.size) activePair.statusB = 'filled'
        }
      }
      return []
    }

    // Order finalized / rejected => mark failures for active pair legs (important in backtests).
    if (activePair && ev.clientOrderId && ev.clientOrderId.startsWith(clientPrefix)) {
      const cid = ev.clientOrderId
      if (ev.kind === 'order_done' && ev.reason === 'killed') {
        if (cid === activePair.cidA) activePair.statusA = 'failed'
        if (cid === activePair.cidB) activePair.statusB = 'failed'
      }
      if (ev.kind === 'order_rejected') {
        if (cid === activePair.cidA) activePair.statusA = 'failed'
        if (cid === activePair.cidB) activePair.statusB = 'failed'
      }
    }

    // If we have an unhedged position and get an account event but no market snapshot,
    // we can’t safely unwind/repair (needs bestBid/Ask). So we only act on ticks.
    void lastMarketSnap
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}

