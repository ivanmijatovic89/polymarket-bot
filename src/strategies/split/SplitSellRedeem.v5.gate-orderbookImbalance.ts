import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
// import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
// import { TimeWindowVolatility, type VolatilitySnapshot } from '../../strategy/plugins/TimeWindowVolatility.js'
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

  // netChangeThreshold: z.coerce.number().finite().default(0.05),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.v5.gate-orderbookImbalance',
  title: 'Split + sell with dwell + time filters v5.gate-orderbookImbalance',
  description: '(ob_8_upBidDepth / (ob_8_upBidDepth + ob_8_downBidDepth)) <= 0.398997042449',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const name = 'SplitSellRedeem.v5.gate-orderbookImbalance'

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

  // const externalFeedsPlugin = new ExternalFeedsRequestPlugin({
  //   rtdsCryptoPrices: { binanceSymbols: ['btcusdt'], chainlinkSymbols: ['btc/usd'] },
  //   binanceWsSpotPrice: { symbol: 'btcusdt' },
  //   polymarketPriceToBeat: { enabled: true },
  // })

  // const windows = {
  //   '60s': 60_000,
  // } as const
  // const timeWindowVolatilityPlugin = new TimeWindowVolatility({ windows, trackPrice: 'bid' })

  const plugins: Plugin[] = [
    timeWindowGatePlugin,
    dwellGatePlugin,
    // externalFeedsPlugin,
    // timeWindowVolatilityPlugin
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

    // (ob_8_upBidDepth / (ob_8_upBidDepth + ob_8_downBidDepth)) <= 0.398997042449
    const upBidsDepthLvl8 = tick.snapshot.byAssetId[upAssetId]?.bidsDepthByLevel?.[8] ?? 0
    const downBidsDepthLvl8 = tick.snapshot.byAssetId[downAssetId]?.bidsDepthByLevel?.[8] ?? 0
    if (upBidsDepthLvl8 === 0 && downBidsDepthLvl8 === 0) return []
    const totalBidDepth = upBidsDepthLvl8 + downBidsDepthLvl8
    const imbalance = upBidsDepthLvl8 / totalBidDepth

    if (imbalance <= 0.398997042449) return []

    const intentMeta =
      imbalance !== null
        ? {
            imbalance,
          }
        : undefined

    sellPlaced = true

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
        ...(intentMeta ? { meta: intentMeta } : {}),
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
