import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import * as strategyToolkit from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(2),
  // sellSize: z.coerce.number().finite().positive().default(10),

  // dwellRangeFrom: z.coerce.number().finite().default(0.20),
  // dwellRangeTo: z.coerce.number().finite().default(0.35),
  // dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(60),
  // dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),

  // timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(180),
  // timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.v4',
  title: 'Split test',
  description:
    'Splits test',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'SplitSellRedeem.v4'

  // Episode state
  let splitRequested = false
  let sellPlaced = false

  let splitLogged = false

  let startTimeMs: number | null = null
  let lastLoggedSecond = -1
  const delayMs = 3000 // 3 seconds delay

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot, ctx?: StrategyContext): Intent[] => {
    const nowMs = tick.snapshot.timestamp || Date.now()
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return []

    const m = ctx as { market?: { upAssetId?: string | null; downAssetId?: string | null } } | undefined
    const upAssetId = m?.market?.upAssetId ?? null
    const downAssetId = m?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []


    // Initialize start time on first tick
    if (startTimeMs === null) {
      startTimeMs = nowMs
      console.log('[split.v4] ⏱️  Starting countdown, will split in 3 seconds...')
    }

    // Check if delay has passed
    const elapsedMs = nowMs - startTimeMs
    const remainingMs = Math.max(0, delayMs - elapsedMs)

    if (remainingMs > 0) {
      // Log countdown every second
      const secondsRemaining = Math.ceil(remainingMs / 1000)
      if (secondsRemaining !== lastLoggedSecond) {
        lastLoggedSecond = secondsRemaining
        console.log(`[split.v4] ⏱️  Countdown: ${secondsRemaining} second(s) remaining...`)
      }
      return []
    }

    if (sellPlaced) return []

    // Split once
    if (!splitRequested) {
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

    const upQty = portfolio.positionsByAssetId[upAssetId]?.qty ?? 0
    const downQty = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0

    if( upQty === 0 && downQty === 0 ) return [];

    if( upQty > 0 && downQty > 0 && !splitLogged ) {
      splitLogged = true
      console.log(`[split.v4] upQty: ${upQty}, downQty: ${downQty}`);
    }

    return [];
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}
