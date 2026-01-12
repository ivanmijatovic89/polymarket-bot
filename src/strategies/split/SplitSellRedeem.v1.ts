import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import * as strategyToolkit from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(100),
  triggerBidBelow: z.coerce.number().finite().default(0.29),
  sellPrice: z.coerce.number().finite().default(0.31),
  sellSize: z.coerce.number().finite().positive().default(10),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.v1',
  title: 'Split + sell GTC on bid drop v1',
  description:
    'Splits collateral into UP+DOWN (full set). Then when bestBid drops below threshold, places a GTC sell at a fixed limit price.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'SplitSellRedeem.v1'

  let splitRequested = false
  let sellPlaced = false
  let soldSide: 'UP' | 'DOWN' | null = null

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot, ctx?: unknown): Intent[] => {
    const m = ctx as { market?: { upAssetId?: string | null; downAssetId?: string | null } } | undefined
    const upAssetId = m?.market?.upAssetId ?? null
    const downAssetId = m?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []

    // One-shot: once we place a sell (either side), do nothing forever.
    if (sellPlaced) return []

    // 1) Split once at the beginning of the episode.
    // NOTE: this will execute on the *next* tick under default queued execution mode.
    if (!splitRequested) {
      splitRequested = true
      return [
        {
          kind: 'split_positions',
          assetIdA: upAssetId,
          assetIdB: downAssetId,
          size: cfg.splitShares,
          // Accounting default: 0.5 per share so total cost == splitShares.
          costPerShare: 0,
          reason: 'initial_split',
        },
      ]
    }

    // 2) On each tick: track best bids.
    const upBid = tick.snapshot.byAssetId[upAssetId]?.bestBid ?? null
    const downBid = tick.snapshot.byAssetId[downAssetId]?.bestBid ?? null

    const trigger = cfg.triggerBidBelow
    const sellPrice = strategyToolkit.safeProbabilityPrice(cfg.sellPrice)
    const sellSize = cfg.sellSize

    const intents: Intent[] = []

    // When bestBid < trigger, place exactly ONE GTC sell total (UP *or* DOWN).
    // If both trigger on the same tick, pick the side with the LOWER bid (tie-break UP).
    const candidates: Array<{ side: 'UP' | 'DOWN'; assetId: string; bid: number }> = []
    if (upBid !== null && Number.isFinite(upBid) && upBid < trigger) {
      const qty = portfolio.positionsByAssetId[upAssetId]?.qty ?? 0
      if (Number.isFinite(qty) && qty >= sellSize) candidates.push({ side: 'UP', assetId: upAssetId, bid: upBid })
    }
    if (downBid !== null && Number.isFinite(downBid) && downBid < trigger) {
      const qty = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0
      if (Number.isFinite(qty) && qty >= sellSize)
        candidates.push({ side: 'DOWN', assetId: downAssetId, bid: downBid })
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => (a.bid !== b.bid ? a.bid - b.bid : a.side === 'UP' ? -1 : 1))
      const chosen = candidates[0]!
      sellPlaced = true
      soldSide = chosen.side
      intents.push({
        kind: 'place_limit',
        clientOrderId: `${name}:${chosen.assetId}:sell:${Math.floor((tick.snapshot.timestamp || Date.now()) / 1000)}`,
        assetId: chosen.assetId,
        side: 'SELL',
        price: sellPrice,
        size: sellSize,
        orderType: 'GTC',
        reason: `${chosen.side}_bestBid(${chosen.bid.toFixed(4)})<${trigger}`,
      })
      return intents
    }

    return intents
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => {
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}

