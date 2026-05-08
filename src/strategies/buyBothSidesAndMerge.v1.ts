import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as strategyToolkit from '../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  assetId: z.string().min(1).optional(),
  size: z.coerce.number().finite().default(5),
  triggerPrice: z.coerce.number().finite().default(0.4),
  buyPriceBump: z.coerce.number().finite().default(0.05),
  mergeWhenStatus: z.enum(['MATCHED', 'MINED', 'CONFIRMED']).default('MINED'),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'buyBothSidesAndMerge.v1',
  title: 'Buy both sides + merge v1',
  description:
    'When either side bestAsk <= triggerPrice, buy BOTH sides (FOK). After both orders are CONFIRMED, merge min(qtyA, qtyB).',
  schema: ConfigSchema,
  create: (params) => ({ strategy: createStrategy(params) }),
}

function pickTwoAssetIds(tick: MarketTick, preferred?: string): [string, string] | null {
  if (preferred && tick.snapshot.byAssetId[preferred]) {
    const ids = Object.keys(tick.snapshot.byAssetId).sort()
    const otherId = ids.find((id) => id !== preferred)
    if (otherId) return [preferred, otherId]
  }

  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'buy_both_and_merge'

  let hasPlacedBuys = false
  let hasSentMerge = false

  let assetA: string | null = null
  let assetB: string | null = null
  let buyCidA: string | null = null
  let buyCidB: string | null = null

  const onMarketTick = (tick: MarketTick, _portfolio: PortfolioSnapshot): Intent[] => {
    void _portfolio
    if (hasPlacedBuys) return []

    const ids = pickTwoAssetIds(tick, cfg.assetId)
    if (!ids) return []
    const [a, b] = ids

    const bookA = tick.snapshot.byAssetId[a]
    const bookB = tick.snapshot.byAssetId[b]
    const askA = bookA?.bestAsk ?? null
    const askB = bookB?.bestAsk ?? null
    if (askA === null || askB === null) return []

    if (!(askA <= cfg.triggerPrice || askB <= cfg.triggerPrice)) return []

    const now = tick.snapshot.timestamp || Date.now()
    hasPlacedBuys = true
    assetA = a
    assetB = b

    const bump = Number.isFinite(cfg.buyPriceBump) ? cfg.buyPriceBump : 0.05
    const priceA = strategyToolkit.safeProbabilityPrice(askA + bump)
    const priceB = strategyToolkit.safeProbabilityPrice(askB + bump)

    buyCidA = `${name}:${a}:buy:${now}`
    buyCidB = `${name}:${b}:buy:${now}`

    return [
      {
        kind: 'place_limit',
        clientOrderId: buyCidA,
        assetId: a,
        side: 'BUY',
        price: priceA,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'trigger_buy_both',
      },
      {
        kind: 'place_limit',
        clientOrderId: buyCidB,
        assetId: b,
        side: 'BUY',
        price: priceB,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'trigger_buy_both',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (_ev, portfolio) => {
    if (!hasPlacedBuys) return []
    if (hasSentMerge) return []
    if (!assetA || !assetB || !buyCidA || !buyCidB) return []

    if (!strategyToolkit.isOrderTradeStatusAtLeast(portfolio, buyCidA, cfg.mergeWhenStatus))
      return []
    if (!strategyToolkit.isOrderTradeStatusAtLeast(portfolio, buyCidB, cfg.mergeWhenStatus))
      return []

    const qA = portfolio.positionsByAssetId[assetA]?.qty ?? 0
    const qB = portfolio.positionsByAssetId[assetB]?.qty ?? 0
    const mergable = Math.min(qA, qB)
    if (!Number.isFinite(mergable) || mergable <= 0) return []

    hasSentMerge = true
    console.log('Strategy > onAccountEvent > merge_positions', {
      assetIdA: assetA,
      assetIdB: assetB,
      size: mergable,
      reason: `merge_after_${cfg.mergeWhenStatus}`,
    })
    return [
      {
        kind: 'merge_positions',
        assetIdA: assetA,
        assetIdB: assetB,
        size: mergable,
        reason: `merge_after_${cfg.mergeWhenStatus}`,
      },
    ]
  }

  return { name, onMarketTick, onAccountEvent }
}
