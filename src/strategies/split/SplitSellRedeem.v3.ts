import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
import { safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(100),
  sellSize: z.coerce.number().finite().positive().default(10),

  dwellRangeFrom: z.coerce.number().finite().default(0.2),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(60),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),

  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(180),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.v3',
  title: 'Split + sell with dwell + time filters v3',
  description:
    'Splits collateral into UP+DOWN (full set). Tracks dwell time per side and trades only within an allowed time window.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'SplitSellRedeem.v3'

  // Episode state
  let splitRequested = false
  let sellPlaced = false
  let lastMarketKey: string | null = null

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

  const plugins: Plugin[] = [timeWindowGatePlugin, dwellGatePlugin]

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return []

    const upAssetId = ctx?.market?.upAssetId ?? null
    const downAssetId = ctx?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []

    // Reset on market change
    const marketKey = tick.snapshot.market ?? null
    if (marketKey && lastMarketKey && marketKey !== lastMarketKey) {
      splitRequested = false
      sellPlaced = false
      dwellGatePlugin.reset()
      timeWindowGatePlugin.reset()
    }
    if (marketKey) lastMarketKey = marketKey

    if (sellPlaced) return []

    // Split once
    if (!splitRequested) {
      splitRequested = true
      // Preserve original semantics: dwell/time tracking starts AFTER split has been requested.
      dwellGatePlugin.reset()
      timeWindowGatePlugin.reset()
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
    const dwell =
      (ctx?.plugins?.['dwellGate'] as { dwellUpOk?: unknown; dwellDownOk?: unknown } | undefined) ??
      undefined
    const dwellUpOk = dwell?.dwellUpOk === true
    const dwellDownOk = dwell?.dwellDownOk === true

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
