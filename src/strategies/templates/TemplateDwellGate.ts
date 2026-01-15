import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import * as strategyToolkit from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  dwellRangeFrom: z.coerce.number().finite().default(0.20),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(60),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'TemplateDwellGate',
  title: 'Template dwell gate',
  description:
    'Template dwell gate',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'TemplateDwellGate'

  let lastMarketKey: string | null = null

  type DwellLogState = {
    inSinceMs: number | null
    lastBucket: number
  }

  const dwellLogEveryMs = 5000
  const dwellRange = {
    lo: Math.min(cfg.dwellRangeFrom, cfg.dwellRangeTo),
    hi: Math.max(cfg.dwellRangeFrom, cfg.dwellRangeTo),
  }

  const upLogState: DwellLogState = { inSinceMs: null, lastBucket: -1 }
  const downLogState: DwellLogState = { inSinceMs: null, lastBucket: -1 }

  function updateDwellLog(args: {
    label: 'UP' | 'DOWN'
    nowMs: number
    price: number | null | undefined
    state: DwellLogState
  }) {
    const inRange =
      typeof args.price === 'number' &&
      Number.isFinite(args.price) &&
      args.price >= dwellRange.lo &&
      args.price <= dwellRange.hi

    if (!inRange) {
      if (args.state.inSinceMs !== null) {
        console.log(`🔴 ${args.label} left range`)
      }
      args.state.inSinceMs = null
      args.state.lastBucket = -1
      return
    }

    if (args.state.inSinceMs === null) {
      args.state.inSinceMs = args.nowMs
      args.state.lastBucket = -1
      console.log(`🟡 ${args.label} entered range`)
    }

    const elapsedMs = args.nowMs - args.state.inSinceMs
    const bucket = Math.floor(elapsedMs / dwellLogEveryMs)
    if (bucket !== args.state.lastBucket) {
      args.state.lastBucket = bucket
      console.log(
        `🟡 ${args.label} ${Math.floor(elapsedMs / 1000)}s in range ` +
          `[${dwellRange.lo.toFixed(2)}-${dwellRange.hi.toFixed(2)}] ${args.price}`,
      )
    }
  }

  const dwellGate = strategyToolkit.createDwellGate({
    from: cfg.dwellRangeFrom,
    to: cfg.dwellRangeTo,
    requiredMs: cfg.dwellSecondsRequired * 1000,
    trackPrice: cfg.dwellTrackPrice,
  })

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot, ctx?: StrategyContext): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return []

    const m = ctx as { market?: { upAssetId?: string | null; downAssetId?: string | null } } | undefined
    const upAssetId = m?.market?.upAssetId ?? null
    const downAssetId = m?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []

    // Reset on market change
    const marketKey = tick.snapshot.market ?? null
    if (marketKey && lastMarketKey && marketKey !== lastMarketKey) {
      dwellGate.reset()
      upLogState.inSinceMs = null
      upLogState.lastBucket = -1
      downLogState.inSinceMs = null
      downLogState.lastBucket = -1
    }
    if (marketKey) lastMarketKey = marketKey

    // Dwell check (always update, even outside window)
    const { dwellUpOk, dwellDownOk } = dwellGate.update({
      nowMs,
      upAssetId,
      downAssetId,
      snapshot: tick.snapshot,
    })

    // Pick side to sell
    const upBid = tick.snapshot.byAssetId[upAssetId]?.bestBid ?? null
    const downBid = tick.snapshot.byAssetId[downAssetId]?.bestBid ?? null
    const upAsk = tick.snapshot.byAssetId[upAssetId]?.bestAsk ?? null
    const downAsk = tick.snapshot.byAssetId[downAssetId]?.bestAsk ?? null

    const upTrackPrice = cfg.dwellTrackPrice === 'bid' ? upBid : upAsk
    const downTrackPrice = cfg.dwellTrackPrice === 'bid' ? downBid : downAsk

    updateDwellLog({ label: 'UP', nowMs, price: upTrackPrice, state: upLogState })
    updateDwellLog({ label: 'DOWN', nowMs, price: downTrackPrice, state: downLogState })

    const upCanSell = dwellUpOk && upBid !== null
    const downCanSell = dwellDownOk && downBid !== null

    let side: 'UP' | 'DOWN' | null = null
    if (upCanSell && !downCanSell) side = 'UP'
    else if (!upCanSell && downCanSell) side = 'DOWN'
    else if (upCanSell && downCanSell) side = (upBid as number) <= (downBid as number) ? 'UP' : 'DOWN'

    if (!side) return []

    // Place sell
    const assetId = side === 'UP' ? upAssetId : downAssetId
    const bestBid = side === 'UP' ? upBid! : downBid!

    console.log(`🟢 ${side} can sell`);

    return [];
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}
