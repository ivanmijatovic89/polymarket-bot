import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { Plugin } from '../../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../../strategy/plugins/TimeWindowGatePlugin.js'
import { DwellGatePlugin } from '../../../strategy/plugins/DwellGatePlugin.js'
import { ExternalFeedsRequestPlugin } from '../../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

// Freeze doc: /tmp/claude-501/.../scratchpad/gate-exit-sweep-freeze.md (see also
// spawned session notes). This strategy is `run 415`'s exact base (SplitSellRedeem.v5)
// plus ONE additional entry gate: an order-book depth-imbalance BAND. The metric
// (upBidsDepthLvl8 / totalBidDepth) is copied verbatim from the pre-existing
// SplitSellRedeem.v5.gate-orderbookImbalance research file so the sweep uses a
// real, previously-measured signal rather than an invented one. `imbalanceGateMin`
// / `imbalanceGateMax` default to [0, 1] (gate disabled = reproduces run 415 exactly).
export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(10),
  sellSize: z.coerce.number().finite().positive().default(10),

  dwellRangeFrom: z.coerce.number().finite().default(0.25),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(40),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),

  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(240),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),

  // Entry gate under test: only sell when the UP-side depth fraction
  // (upBidsDepthLvl8 / (upBidsDepthLvl8 + downBidsDepthLvl8)) falls in [min, max].
  imbalanceGateMin: z.coerce.number().finite().min(0).max(1).default(0),
  imbalanceGateMax: z.coerce.number().finite().min(0).max(1).default(1),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.gateSweep',
  title: 'SplitSellRedeem v5 base + order-book imbalance band gate (sweep)',
  description:
    'run-415 base strategy plus one additional entry gate: only sells the dwell-qualified side when the UP-side L8 bid-depth fraction sits inside [imbalanceGateMin, imbalanceGateMax]. Gate disabled (min=0,max=1) reproduces run 415 exactly.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const name = 'SplitSellRedeem.gateSweep'

  let splitRequested = false
  let sellPlaced = false
  let lastMarketKey: string | null = null
  let warnedMissingMarket = false

  const timeWindowGatePlugin = new TimeWindowGatePlugin({
    allowAfterMs: cfg.timeFilterAllowTradingAfterSeconds * 1000,
    disableAfterMs: cfg.timeFilterDisableTradingAfterSeconds * 1000,
  })

  const dwellGatePlugin = new DwellGatePlugin({
    from: cfg.dwellRangeFrom,
    to: cfg.dwellRangeTo,
    requiredMs: cfg.dwellSecondsRequired * 1000,
    trackPrice: cfg.dwellTrackPrice,
  })

  const externalFeedsPlugin = new ExternalFeedsRequestPlugin({
    binanceWsSpotPrice: {}, // pair follows the traded market (TRADING_SYMBOL live, slug in backtests)
    polymarketPriceToBeat: { enabled: true },
  })

  const plugins: Plugin[] = [timeWindowGatePlugin, dwellGatePlugin, externalFeedsPlugin]

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return []

    const m = ctx as
      | { market?: { upAssetId?: string | null; downAssetId?: string | null } }
      | undefined
    const upAssetId = m?.market?.upAssetId ?? null
    const downAssetId = m?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) {
      if (!warnedMissingMarket) {
        console.log(`[${name}][⚠️] waiting for ctx.market`)
        warnedMissingMarket = true
      }
      return []
    }
    if (warnedMissingMarket) warnedMissingMarket = false

    const marketKey = tick.snapshot.market ?? null
    const shouldReset = marketKey && lastMarketKey && marketKey !== lastMarketKey
    if (shouldReset) {
      splitRequested = false
      sellPlaced = false
      timeWindowGatePlugin.reset()
      dwellGatePlugin.reset()
    }
    if (marketKey) lastMarketKey = marketKey

    if (sellPlaced) return []

    if (!splitRequested) {
      timeWindowGatePlugin.reset()
      dwellGatePlugin.reset()
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

    // Imbalance gate: same L8 bid-depth metric as SplitSellRedeem.v5.gate-orderbookImbalance.
    const upBidsDepthLvl8 = tick.snapshot.byAssetId[upAssetId]?.bidsDepthByLevel?.[8] ?? 0
    const downBidsDepthLvl8 = tick.snapshot.byAssetId[downAssetId]?.bidsDepthByLevel?.[8] ?? 0
    const totalBidDepth = upBidsDepthLvl8 + downBidsDepthLvl8
    if (totalBidDepth > 0) {
      const imbalance = upBidsDepthLvl8 / totalBidDepth
      if (imbalance < cfg.imbalanceGateMin || imbalance > cfg.imbalanceGateMax) return []
    }

    const assetId = side === 'UP' ? upAssetId : downAssetId
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
        reason: `${side}_dwell>=${cfg.dwellSecondsRequired}s; bestBid=${bestBid.toFixed(4)}; imbGate=[${cfg.imbalanceGateMin},${cfg.imbalanceGateMax}]`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
