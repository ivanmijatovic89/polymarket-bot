import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { TimeWindowVolatility } from '../../strategy/plugins/TimeWindowVolatility.js'
import { safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(100),
  sellSize: z.coerce.number().finite().positive().default(10),

  dwellRangeFrom: z.coerce.number().finite().default(0.20),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(60),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),

  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(180),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),

  volatilityWindows: z.coerce.number().finite().positive().default(2),
  volatilityAvgAbsChange: z.coerce.number().finite().positive().default(0.0018),
  volatilityNetChange: z.coerce.number().finite().positive().default(0.010),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.v5',
  title: 'Split + sell with dwell + time filters v5',
  description:
    'Splits collateral into UP+DOWN (full set). Tracks dwell time per side and trades only within an allowed time window.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const name = 'SplitSellRedeem.v5'

  // Episode state
  let splitRequested = false
  let sellPlaced = false
  let lastMarketKey: string | null = null
  let warnedMissingMarket = false

  const volatilityWindowKey = `${cfg.volatilityWindows}s`;
  const volatilityPlugin = new TimeWindowVolatility({ windows: { [volatilityWindowKey]: cfg.volatilityWindows * 1000 }, trackPrice: 'bid' })

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
    rtdsCryptoPrices: { binanceSymbols: ['btcusdt'], chainlinkSymbols: ['btc/usd'] },
    binanceWsSpotPrice: { symbol: 'btcusdt' },
    polymarketPriceToBeat: { enabled: true },
  })

  const plugins: Plugin[] = [timeWindowGatePlugin, dwellGatePlugin, externalFeedsPlugin, volatilityPlugin]

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot, ctx?: StrategyContext): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      console.log(`[${name}][⚠️] early return: invalid nowMs`, { nowMs })
      return []
    }

    const m = ctx as { market?: { upAssetId?: string | null; downAssetId?: string | null } } | undefined
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

    const withinWindow = (ctx?.plugins?.['timeWindowGate'] as { withinWindow?: unknown } | undefined)?.withinWindow === true
    const dwellSnap = (ctx?.plugins?.['dwellGate'] as { dwellUpOk?: unknown; dwellDownOk?: unknown } | undefined) ?? undefined
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
    else if (upCanSell && downCanSell) side = (upBid as number) <= (downBid as number) ? 'UP' : 'DOWN'

    if (!side) return []

    const volatilitySnap = (ctx?.plugins?.['timeWindowVolatility'] as VolatilitySnapshot | undefined) ?? undefined
    if(!volatilitySnap){
      console.log(`[${name}][⚠️] no volatility snapshot`, { volatilitySnap })
      return []
    }

    const assetId = side === 'UP' ? upAssetId : downAssetId

    const volatilityStats = volatilitySnap?.byAssetId[assetId]?.[volatilityWindowKey] ?? null
    if (!volatilityStats){
      console.log(`[${name}][⚠️] no volatility stats for ${assetId}`, { volatilityStats })
      return []
    }

    // skip if !ready
    if(!volatilityStats.ready){
      console.log(`[${name}][⚠️] volatility stats not ready for ${assetId}`, { volatilityStats })
      return []
    }


    // skip if avgAbsChange > TH
    if(volatilityStats.avgAbsChange && volatilityStats.avgAbsChange <= cfg.volatilityAvgAbsChange){
      console.log(`[${name}][⚠️] avgAbsChange > threshold for ${assetId}`, { volatilityStats })
      return []
    }
    // skip if abs(netChange) > TH2

    // Place sell
    const bestBid = side === 'UP' ? upBid! : downBid!
    const sellPrice = safeProbabilityPrice(bestBid - 0.01)

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
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
