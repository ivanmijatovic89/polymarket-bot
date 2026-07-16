import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { Plugin } from '../../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../../strategy/plugins/TimeWindowGatePlugin.js'
import { DwellGatePlugin } from '../../../strategy/plugins/DwellGatePlugin.js'
import { ExternalFeedsRequestPlugin } from '../../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

// Freeze doc: see gate-exit-sweep-freeze.md. Base = run 415 (SplitSellRedeem.v5) with
// the pre-existing `unwind` mechanism (SplitSellRedeem.v5.unwind, unchanged) PLUS one
// new exit: a TIME-based forced unwind. If the price-triggered unwind
// (soldSide ask recovers to >= unwindPriceX) has not fired by
// `forceUnwindBeforeCloseSeconds` before window close, buy back the sold side at
// market (ask) unconditionally — capping worst-case tail loss instead of holding the
// naked position into resolution. forceUnwindBeforeCloseSeconds=0 disables this
// (reproduces v5.unwind exactly).
export const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(10),
  sellSize: z.coerce.number().finite().positive().default(10),
  unwindPriceX: z.coerce.number().finite().min(0).max(1).default(0.7),
  forceUnwindBeforeCloseSeconds: z.coerce.number().finite().nonnegative().default(0),

  dwellRangeFrom: z.coerce.number().finite().default(0.25),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(40),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),

  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(240),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})

export type Config = z.infer<typeof ConfigSchema>

const WINDOW_MS = 15 * 60 * 1000

function parseWindowEndMsFromSlug(slug: unknown): number | null {
  if (typeof slug !== 'string') return null
  const m = /-(\d{9,})$/.exec(slug)
  if (!m) return null
  const epochStartSec = Number(m[1])
  if (!Number.isFinite(epochStartSec)) return null
  return epochStartSec * 1000 + WINDOW_MS
}

export const definition: StrategyDefinition<Config> = {
  id: 'SplitSellRedeem.exitSweep',
  title: 'SplitSellRedeem v5 base + price unwind + time-forced unwind (sweep)',
  description:
    'run-415 base strategy plus the existing price-triggered unwind (buy back the sold side once its ask recovers past unwindPriceX) plus a new time-forced unwind that caps tail loss if the price trigger never fires before window close.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const name = 'SplitSellRedeem.exitSweep'

  let splitRequested = false
  let sellPlaced = false
  let unwindPlaced = false
  let soldAssetId: string | null = null
  let soldSide: 'UP' | 'DOWN' | null = null
  let lastMarketKey: string | null = null
  let warnedMissingMarket = false
  let windowEndMs: number | null = null

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
    rtdsCryptoPrices: { binanceSymbols: ['btcusdt'], chainlinkSymbols: ['btc/usd'] },
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
      | { market?: { upAssetId?: string | null; downAssetId?: string | null; slug?: string } }
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
    if (windowEndMs === null) {
      windowEndMs = parseWindowEndMsFromSlug(m?.market?.slug) ?? nowMs + WINDOW_MS
    }

    const marketKey = tick.snapshot.market ?? null
    const shouldReset = marketKey && lastMarketKey && marketKey !== lastMarketKey
    if (shouldReset) {
      splitRequested = false
      sellPlaced = false
      unwindPlaced = false
      soldAssetId = null
      soldSide = null
      windowEndMs = null
      timeWindowGatePlugin.reset()
      dwellGatePlugin.reset()
    }
    if (marketKey) lastMarketKey = marketKey

    if (sellPlaced) {
      if (!unwindPlaced && soldAssetId) {
        const bestAsk = tick.snapshot.byAssetId[soldAssetId]?.bestAsk ?? null
        const currentQty = portfolio.positionsByAssetId[soldAssetId]?.qty ?? 0
        const buySize = Math.max(0, cfg.splitShares - currentQty)

        const priceTriggered = bestAsk !== null && bestAsk >= cfg.unwindPriceX
        const timeTriggered =
          cfg.forceUnwindBeforeCloseSeconds > 0 &&
          windowEndMs !== null &&
          windowEndMs - nowMs <= cfg.forceUnwindBeforeCloseSeconds * 1000 &&
          bestAsk !== null

        if ((priceTriggered || timeTriggered) && buySize > 0) {
          unwindPlaced = true
          return [
            {
              kind: 'place_limit',
              clientOrderId: `${name}:${soldAssetId}:unwind:${Math.floor(nowMs / 1000)}`,
              assetId: soldAssetId,
              side: 'BUY',
              price: safeProbabilityPrice((bestAsk as number) + 0.01),
              size: buySize,
              orderType: 'GTC',
              reason: priceTriggered
                ? `unwind_${soldSide ?? 'UNKNOWN'}_price>=${cfg.unwindPriceX}`
                : `unwind_${soldSide ?? 'UNKNOWN'}_timeForced<=${cfg.forceUnwindBeforeCloseSeconds}s`,
            },
          ]
        }
      }
      return []
    }

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

    const assetId = side === 'UP' ? upAssetId : downAssetId
    const bestBid = side === 'UP' ? upBid! : downBid!
    const sellPrice = safeProbabilityPrice(bestBid - 0.01)

    sellPlaced = true
    soldAssetId = assetId
    soldSide = side
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
