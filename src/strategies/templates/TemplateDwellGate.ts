import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  dwellRangeFrom: z.coerce.number().finite().default(0.2),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(60),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'TemplateDwellGate',
  title: 'Template dwell gate',
  description: 'Template dwell gate',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'TemplateDwellGate'

  const plugins: Plugin[] = [
    new DwellGatePlugin({
      from: cfg.dwellRangeFrom,
      to: cfg.dwellRangeTo,
      requiredMs: cfg.dwellSecondsRequired * 1000,
      trackPrice: cfg.dwellTrackPrice,
      log: true,
    }),
  ]

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

    void portfolio
    const dwell =
      (ctx?.plugins?.['dwellGate'] as { dwellUpOk?: unknown; dwellDownOk?: unknown } | undefined) ??
      undefined
    const dwellUpOk = dwell?.dwellUpOk === true
    const dwellDownOk = dwell?.dwellDownOk === true

    // Pick side to sell
    const upBid = tick.snapshot.byAssetId[upAssetId]?.bestBid ?? null
    const downBid = tick.snapshot.byAssetId[downAssetId]?.bestBid ?? null

    const upCanSell = dwellUpOk && upBid !== null
    const downCanSell = dwellDownOk && downBid !== null

    let side: 'UP' | 'DOWN' | null = null
    if (upCanSell && !downCanSell) side = 'UP'
    else if (!upCanSell && downCanSell) side = 'DOWN'
    else if (upCanSell && downCanSell)
      side = (upBid as number) <= (downBid as number) ? 'UP' : 'DOWN'

    if (!side) return []

    // Place sell
    const assetId = side === 'UP' ? upAssetId : downAssetId
    const bestBid = side === 'UP' ? upBid! : downBid!

    console.log(`🟢 ${side} can sell assetId=${assetId.slice(-8)} bestBid=${bestBid}`)

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
