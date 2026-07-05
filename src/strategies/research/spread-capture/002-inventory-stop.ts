import type {
  Intent,
  MarketTick,
  OpenOrder,
  PortfolioSnapshot,
  Strategy,
} from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import { isWarmed, safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

const WINDOW_MS = 15 * 60 * 1000

export const ConfigSchema = z.strictObject({
  /** Full sets to split (1 set = 1 UP + 1 DOWN share, costs $1). */
  sizeUsd: z.coerce.number().finite().positive().default(5),
  /** Ask distance above each leg's mid. */
  offset: z.coerce.number().finite().positive().max(0.49).default(0.05),
  /**
   * A leg holding SURPLUS inventory (the other leg already sold) is only
   * quoted while |mid - 0.5| <= reArmBand: 0 = never quote the survivor
   * (pure inventory stop), 0.5 = always quote (baseline behavior).
   */
  reArmBand: z.coerce.number().finite().nonnegative().max(0.5).default(0),
  /** Reprice when |mid - quoted ref mid| reaches this; 1 = never (unreachable). */
  repriceDelta: z.coerce.number().finite().positive().default(0.01),
  /** Stop quoting and cancel resting asks this many seconds before window end. */
  quoteStopSec: z.coerce.number().finite().nonnegative().default(420),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'spread-capture.002-inventory-stop',
  title: 'Spread capture with inventory stop',
  description:
    'Splits collateral into UP+DOWN full sets and rests symmetric maker asks offset above each leg mid. The moment one leg sells, the surviving leg stops quoting and is held to the $1-redemption hedge, unless its mid returns within reArmBand of 0.5. Reprices on mid drift, stops quoting near expiry.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

const ACTIVE_STATES: ReadonlySet<OpenOrder['state']> = new Set([
  'requested',
  'open',
  'partially_filled',
])

function parseWindowEndMsFromSlug(slug: unknown): number | null {
  if (typeof slug !== 'string') return null
  const m = /-(\d{9,})$/.exec(slug)
  if (!m || !m[1]) return null
  const epochStartSec = Number(m[1])
  if (!Number.isFinite(epochStartSec)) return null
  return epochStartSec * 1000 + WINDOW_MS
}

function round2(p: number): number {
  return Math.round(p * 100) / 100
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'spread-capture.002-inventory-stop'

  // Episode state, reset on market rotation.
  let lastMarketKey: string | null = null
  let windowEndMs: number | null = null
  let splitRequested = false
  let cutoffDone = false
  let askSeq = 0
  const cancelRequested = new Set<string>()

  const resetEpisode = () => {
    windowEndMs = null
    splitRequested = false
    cutoffDone = false
    askSeq = 0
    cancelRequested.clear()
  }

  const findActiveAsk = (portfolio: PortfolioSnapshot, assetId: string): OpenOrder | null => {
    for (const order of Object.values(portfolio.openOrdersByClientId)) {
      if (order.assetId !== assetId) continue
      if (order.side !== 'SELL') continue
      if (!ACTIVE_STATES.has(order.state)) continue
      return order
    }
    return null
  }

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

    const marketKey = tick.snapshot.market ?? null
    if (marketKey && lastMarketKey && marketKey !== lastMarketKey) resetEpisode()
    if (marketKey) lastMarketKey = marketKey

    if (windowEndMs === null) {
      windowEndMs = parseWindowEndMsFromSlug(ctx?.market?.slug) ?? nowMs + WINDOW_MS
    }

    if (!isWarmed(ctx)) return []

    const msToEnd = windowEndMs - nowMs

    // Cutoff: cancel resting asks once, hold remaining inventory to resolution.
    if (msToEnd <= cfg.quoteStopSec * 1000) {
      if (cutoffDone) return []
      cutoffDone = true
      return [{ kind: 'cancel_all', reason: `quote_stop<=${cfg.quoteStopSec}s_to_end` }]
    }

    const up = tick.snapshot.byAssetId[upAssetId]
    const down = tick.snapshot.byAssetId[downAssetId]

    // Split once, on the first tick where both legs have a usable book.
    if (!splitRequested) {
      const upReady = up?.bestBid != null && up.bestAsk != null && up.mid != null
      const downReady = down?.bestBid != null && down.bestAsk != null && down.mid != null
      if (!upReady || !downReady) return []
      splitRequested = true
      return [
        {
          kind: 'split_positions',
          assetIdA: upAssetId,
          assetIdB: downAssetId,
          size: cfg.sizeUsd,
          reason: 'initial_split_full_sets',
        },
      ]
    }

    const intents: Intent[] = []

    for (const assetId of [upAssetId, downAssetId]) {
      const mid = tick.snapshot.byAssetId[assetId]?.mid ?? null
      if (mid === null || !Number.isFinite(mid)) continue

      const otherAssetId = assetId === upAssetId ? downAssetId : upAssetId
      const qty = portfolio.positionsByAssetId[assetId]?.qty ?? 0
      const otherQty = portfolio.positionsByAssetId[otherAssetId]?.qty ?? 0
      // Surplus inventory means the other leg already sold. The survivor is
      // held to the redemption hedge instead of being quoted, unless its mid
      // has come back near 0.5 (outcome uncertainty returned).
      const surplus = qty > otherQty
      const allowedToQuote = !surplus || Math.abs(mid - 0.5) <= cfg.reArmBand

      const activeAsk = findActiveAsk(portfolio, assetId)

      if (activeAsk) {
        if (!allowedToQuote) {
          if (!cancelRequested.has(activeAsk.clientOrderId)) {
            cancelRequested.add(activeAsk.clientOrderId)
            intents.push({
              kind: 'cancel_order',
              clientOrderId: activeAsk.clientOrderId,
              reason: `inventory_stop mid=${mid.toFixed(4)}`,
            })
          }
          continue
        }
        // Reference mid is implied by the resting price: ref = price - offset.
        const refMid = activeAsk.price - cfg.offset
        if (
          Math.abs(mid - refMid) >= cfg.repriceDelta &&
          !cancelRequested.has(activeAsk.clientOrderId)
        ) {
          cancelRequested.add(activeAsk.clientOrderId)
          intents.push({
            kind: 'cancel_order',
            clientOrderId: activeAsk.clientOrderId,
            reason: `reprice mid=${mid.toFixed(4)} ref=${refMid.toFixed(4)}`,
          })
        }
        continue
      }

      if (!allowedToQuote) continue
      if (qty < 1) continue

      const askPrice = safeProbabilityPrice(round2(mid + cfg.offset))
      if (askPrice < 0.01 || askPrice > 0.99) continue

      askSeq += 1
      intents.push({
        kind: 'place_limit',
        clientOrderId: `${name}:${marketKey ?? 'mkt'}:${assetId === upAssetId ? 'up' : 'down'}:${askSeq}`,
        assetId,
        side: 'SELL',
        price: askPrice,
        size: qty,
        orderType: 'GTC',
        reason: `quote mid=${mid.toFixed(4)}+${cfg.offset}`,
      })
    }

    return intents
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
