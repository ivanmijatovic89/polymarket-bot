import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import {
  TimeWindowVolatility,
  type VolatilitySnapshot,
} from '../../strategy/plugins/TimeWindowVolatility.js'
import { TechnicalIndicatorsPlugin } from '../../strategy/plugins/TechnicalIndicatorsPlugin.js'
import { safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(10),
  sellSize: z.coerce.number().finite().positive().default(10),

  dwellRangeFrom: z.coerce.number().finite().default(0.2),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(40),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),

  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(240),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.v5.4-research-metrics-and-technical-indicators',
  title: 'Split + sell with dwell + time filters v5.4-research-metrics-and-technical-indicators',
  description: 'Get TA plugin + ',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const name = 'SplitSellRedeem.v5.4-research-metrics-and-technical-indicators'

  // Episode state
  let splitRequested = false
  let sellPlaced = false
  let lastMarketKey: string | null = null
  let warnedMissingMarket = false

  const timeWindowGatePlugin = new TimeWindowGatePlugin({
    allowAfterMs: cfg.timeFilterAllowTradingAfterSeconds * 1000,
    disableAfterMs: cfg.timeFilterDisableTradingAfterSeconds * 1000,
    // log: { everyMs: 15000 },
  })

  const dwellGatePlugin = new DwellGatePlugin({
    from: cfg.dwellRangeFrom,
    to: cfg.dwellRangeTo,
    requiredMs: cfg.dwellSecondsRequired * 1000,
    trackPrice: cfg.dwellTrackPrice,
    // log: { everyMs: 5000 },
  })

  const externalFeedsPlugin = new ExternalFeedsRequestPlugin({
    rtdsCryptoPrices: {}, // symbols follow the traded market (TRADING_SYMBOL); rtds is live-only
    binanceWsSpotPrice: {}, // pair follows the traded market (TRADING_SYMBOL live, slug in backtests)
    polymarketPriceToBeat: { enabled: true },
  })

  const windows = {
    '1s': 1_000,
    '3s': 3_000,
    '5s': 5_000,
    '10s': 10_000,
    '20s': 20_000,
    '30s': 30_000,
    '45s': 45_000,
    '60s': 60_000,
    '120s': 120_000,
    '180s': 180_000,
    '220s': 220_000,
  } as const

  const timeWindowVolatilityPlugin = new TimeWindowVolatility({ windows, trackPrice: 'bid' })

  const technicalIndicatorsPlugin = new TechnicalIndicatorsPlugin()

  const plugins: Plugin[] = [
    timeWindowGatePlugin,
    dwellGatePlugin,
    externalFeedsPlugin,
    timeWindowVolatilityPlugin,
    technicalIndicatorsPlugin,
  ]

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      console.log(`[${name}][⚠️] early return: invalid nowMs`, { nowMs })
      return []
    }

    const m = ctx as
      | { market?: { upAssetId?: string | null; downAssetId?: string | null } }
      | undefined
    const upAssetId = m?.market?.upAssetId ?? null
    const downAssetId = m?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) {
      if (!warnedMissingMarket) {
        console.log(`[${name}][⚠️] waiting for ctx.market`, {
          upAssetId,
          downAssetId,
          hasCtx: !!ctx,
          hasMarket: !!m?.market,
        })
        warnedMissingMarket = true
      }
      return []
    }
    // Reset warning flag when market becomes available
    if (warnedMissingMarket) {
      console.log(`[${name}][🟢] ctx.market now available`)
      warnedMissingMarket = false
    }

    // Reset on market change
    const marketKey = tick.snapshot.market ?? null
    const shouldReset = marketKey && lastMarketKey && marketKey !== lastMarketKey
    if (shouldReset) {
      console.log(`[${name}][🔄] market change detected - resetting state`, {
        from: lastMarketKey,
        to: marketKey,
        prevSplitRequested: splitRequested,
        prevSellPlaced: sellPlaced,
      })
      splitRequested = false
      sellPlaced = false
      // PluginSet is also reset by StrategyRunner on market change, but keep an explicit reset
      // here to preserve the original strategy semantics (and avoid any stale pre-reset state).
      timeWindowGatePlugin.reset()
      dwellGatePlugin.reset()
    }
    if (marketKey) lastMarketKey = marketKey

    if (sellPlaced) {
      // Don't log every tick when sellPlaced, just silently return
      return []
    }

    // Split once
    if (!splitRequested) {
      // Preserve original semantics: dwell/time tracking starts AFTER split has been requested.
      timeWindowGatePlugin.reset()
      dwellGatePlugin.reset()
      console.log(`[${name}][🚀] requesting split`, {
        marketKey,
        upAssetId: upAssetId.slice(0, 20) + '...',
        downAssetId: downAssetId.slice(0, 20) + '...',
        splitShares: cfg.splitShares,
      })
      splitRequested = true
      return [
        {
          kind: 'split_positions',
          assetIdA: upAssetId,
          assetIdB: downAssetId,
          size: cfg.splitShares,
          costPerShare: 0,
          reason: 'initial_split',
        },
      ]
    }

    const withinWindow =
      (ctx?.plugins?.['timeWindowGate'] as { withinWindow?: unknown } | undefined)?.withinWindow ===
      true
    const dwellSnap =
      (ctx?.plugins?.['dwellGate'] as { dwellUpOk?: unknown; dwellDownOk?: unknown } | undefined) ??
      undefined
    const dwellUpOk = dwellSnap?.dwellUpOk === true
    const dwellDownOk = dwellSnap?.dwellDownOk === true

    if (!withinWindow) return []

    // Pick side to sell
    const upBid = tick.snapshot.byAssetId[upAssetId]?.bestBid ?? null
    const downBid = tick.snapshot.byAssetId[downAssetId]?.bestBid ?? null
    const upQty = portfolio.positionsByAssetId[upAssetId]?.qty ?? 0
    const downQty = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0

    const upCanSell = dwellUpOk && upQty >= cfg.sellSize && upBid !== null
    const downCanSell = dwellDownOk && downQty >= cfg.sellSize && downBid !== null

    let side: 'UP' | 'DOWN' | null = null
    if (upCanSell && !downCanSell) side = 'UP'
    else if (!upCanSell && downCanSell) side = 'DOWN'
    else if (upCanSell && downCanSell)
      side = (upBid as number) <= (downBid as number) ? 'UP' : 'DOWN'

    if (!side) return []

    // Place sell
    const assetId = side === 'UP' ? upAssetId : downAssetId
    const bestBid = side === 'UP' ? upBid! : downBid!
    const sellPrice = safeProbabilityPrice(bestBid - 0.01)

    sellPlaced = true

    const volSnap = ctx?.plugins?.['timeWindowVolatility'] as VolatilitySnapshot | undefined
    // GET ONLY highLowRange AND netChange
    const volByAsset = volSnap?.byAssetId?.[assetId]

    // for each window, get the highLowRange and netChange
    const windowsMetrics = Object.keys(volByAsset ?? {}).map((window) => {
      return {
        window,
        highLowRange: volByAsset?.[window]?.highLowRange ?? null,
        netChange: volByAsset?.[window]?.netChange ?? null,
      }
    })

    const orderbook = ctx?.metrics?.orderbook
    const upBook = tick.snapshot.byAssetId[upAssetId]
    const downBook = tick.snapshot.byAssetId[downAssetId]
    const orderbookLevels = (() => {
      if (!orderbook || !upBook || !downBook) return undefined
      const upBids = upBook.bidsDepthByLevel ?? []
      const upAsks = upBook.asksDepthByLevel ?? []
      const downBids = downBook.bidsDepthByLevel ?? []
      const downAsks = downBook.asksDepthByLevel ?? []
      const levels = Math.max(
        0,
        Math.min(
          orderbook.depthLevels ?? 0,
          upBids.length,
          upAsks.length,
          downBids.length,
          downAsks.length,
        ),
      )
      if (levels <= 0) return undefined
      const out: Array<{
        level: number
        isMyOrderOnWeakBidSide: boolean
        weakBidSide: string
        weakBidRatio: number
        // weakAskSide: string
        // weakAskRatio: number
        upBidDepth: number
        // upAskDepth: number
        downBidDepth: number
        // downAskDepth: number
      }> = []
      for (let i = 0; i < levels; i += 1) {
        out.push({
          level: i + 1,
          isMyOrderOnWeakBidSide: orderbook.weakBidSideByLevel[i] === side ? true : false,
          weakBidSide: orderbook.weakBidSideByLevel[i] ?? 'NONE',
          weakBidRatio: orderbook.weakBidRatioByLevel[i] ?? 0,
          // weakAskSide: orderbook.weakAskSideByLevel[i] ?? 'NONE',
          // weakAskRatio: orderbook.weakAskRatioByLevel[i] ?? 0,
          upBidDepth: upBids[i] ?? 0,
          // upAskDepth: upAsks[i] ?? 0,
          downBidDepth: downBids[i] ?? 0,
          // downAskDepth: downAsks[i] ?? 0,
        })
      }
      return out
    })()

    const technicalIndicatorsSnap = technicalIndicatorsPlugin.snapshot()

    const intentMeta = {
      tradeSide: side,
      ...(windowsMetrics.length > 0 ? { windowsMetrics } : {}),
      ...(orderbookLevels ? { orderbookLevels } : {}),
      ...(technicalIndicatorsSnap ? { technicalIndicators: technicalIndicatorsSnap } : {}),
    }
    const hasIntentMeta = Object.keys(intentMeta).length > 0

    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${assetId}:sell:${Math.floor(nowMs / 1000)}`,
        assetId,
        side: 'SELL',
        price: sellPrice,
        size: cfg.sellSize,
        orderType: 'GTC',
        reason: `${side}_dwell>=${cfg.dwellSecondsRequired}s; bestBid=${bestBid.toFixed(4)}`,
        ...(hasIntentMeta ? { meta: intentMeta } : {}),
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
