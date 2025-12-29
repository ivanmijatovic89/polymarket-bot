import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

/**
 * Basic FAK strategy that buys once when bestAsk price reaches target price.
 * - Monitors bestAsk price from orderbook for both assets (UP/DOWN)
 * - When bestAsk reaches targetPrice on either asset, buys that asset using FOK order type
 * - Executes only once per strategy instance
 */
export const BasicFakConfigSchema = z.strictObject({
  assetId: z.string().min(1).optional(),
  size: z.coerce.number().finite().default(5),
  targetPrice: z.coerce.number().finite().default(0.30),
  /**
   * When to place the take-profit SELL, based on USER ws order updates (`ws_order_update.status`)
   * for the BUY order.
   *
   * This is intentionally separate from USER_WS_FILL_AT_STATUS:
   * - USER_WS_FILL_AT_STATUS controls when portfolio-impacting `fill` events are emitted.
   * - sellWhenStatus controls when this strategy attempts to place the SELL.
   */
  sellWhenStatus: z.enum(['MATCHED', 'MINED', 'CONFIRMED']).default('MINED'),
  /**
   * Take profit absolute increment (in probability units). Default 0.01 = +1 cent.
   *
   * NOTE: kept as `takeProfitPct` to avoid breaking existing strict config parsing.
   */
  takeProfitPct: z.coerce.number().finite().default(0.01),
  /**
   * If true, wait for the long position to exist before placing SELL (avoids naked sells).
   * For testing you may set to false to send SELL as soon as status threshold is reached.
   */
  requirePositionBeforeSell: z.coerce.boolean().default(true),
})

export type BasicFakConfig = z.infer<typeof BasicFakConfigSchema>

export const definition: StrategyDefinition<BasicFakConfig> = {
  id: 'basicFak.v1',
  title: 'Basic FAK v1',
  description: 'Buys 5 shares when bestAsk reaches 0.30 on either asset, executes only once.',
  schema: BasicFakConfigSchema,
  create: (params) => createBasicFakStrategy(params),
}

function pickTwoAssetIds(tick: MarketTick, preferred?: string): [string, string] | null {
  // If preferred asset is specified, still check both assets but prioritize preferred
  if (preferred && tick.snapshot.byAssetId[preferred]) {
    const ids = Object.keys(tick.snapshot.byAssetId).sort()
    const otherId = ids.find(id => id !== preferred)
    if (otherId) return [preferred, otherId]
  }

  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(1, p))
}

const STATUS_RANK: Record<'MATCHED' | 'MINED' | 'CONFIRMED', number> = {
  MATCHED: 1,
  MINED: 2,
  CONFIRMED: 3,
}

export function createBasicFakStrategy(cfg: BasicFakConfig): Strategy {
  const name = 'basic_fak'
  let hasPlacedBuy = false
  let hasPlacedSell = false

  let boughtAssetId: string | null = null
  let buyClientOrderId: string | null = null
  let buyOrderId: string | null = null
  let buyLimitPrice: number | null = null

  // Set to true once BUY order status reaches threshold (MATCHED/MINED/CONFIRMED).
  let allowSell = false

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    void portfolio

    // BUY is one-shot. SELL is handled via onAccountEvent based on status threshold.
    if (hasPlacedBuy) return []

    const assetIds = pickTwoAssetIds(tick, cfg.assetId)
    if (!assetIds) return []

    const [assetA, assetB] = assetIds

    // Check both assets to see which one (if any) has reached target price
    const bookA = tick.snapshot.byAssetId[assetA]
    const bookB = tick.snapshot.byAssetId[assetB]

    // Check asset A
    if (bookA && bookA.bestAsk !== null && bookA.bestAsk <= cfg.targetPrice) {
      const now = tick.snapshot.timestamp || Date.now()
      hasPlacedBuy = true
      boughtAssetId = assetA
      buyLimitPrice = bookA.bestAsk
      buyClientOrderId = `${name}:${assetA}:buy:${now}`
      console.log('[basicFak.v1] > placing buy order', {
        kind: 'place_limit',
        clientOrderId: buyClientOrderId,
        assetId: assetA,
        side: 'BUY',
        price: bookA.bestAsk,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'target_price_reached',
      })
      return [
        {
          kind: 'place_limit',
          clientOrderId: buyClientOrderId,
          assetId: assetA,
          side: 'BUY',
          price: bookA.bestAsk,
          size: cfg.size,
          orderType: 'FOK',
          reason: 'target_price_reached',
        },
      ]
    }

    // Check asset B
    if (bookB && bookB.bestAsk !== null && bookB.bestAsk <= cfg.targetPrice) {
      const now = tick.snapshot.timestamp || Date.now()
      hasPlacedBuy = true
      boughtAssetId = assetB
      buyLimitPrice = bookB.bestAsk
      buyClientOrderId = `${name}:${assetB}:buy:${now}`
      console.log('placing buy order', {
        kind: 'place_limit',
        clientOrderId: buyClientOrderId,
        assetId: assetB,
        side: 'BUY',
        price: bookB.bestAsk,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'target_price_reached',
      })
      return [
        {
          kind: 'place_limit',
          clientOrderId: buyClientOrderId,
          assetId: assetB,
          side: 'BUY',
          price: bookB.bestAsk,
          size: cfg.size,
          orderType: 'FOK',
          reason: 'target_price_reached',
        },
      ]
    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, portfolio) => {
    if (!hasPlacedBuy) return []
    if (hasPlacedSell) return []
    if (!boughtAssetId || !buyClientOrderId) return []

    // Fallback: in live, USER WS fills can arrive before we see order_accepted (and before we know orderId).
    // Capture orderId as soon as we see a BUY fill for the asset we just bought.
    if (ev.kind === 'fill') {
      if (
        ev.fill.side === 'BUY' &&
        ev.fill.assetId === boughtAssetId &&
        typeof ev.fill.orderId === 'string' &&
        ev.fill.orderId.length > 0
      ) {
        if (!buyOrderId) buyOrderId = ev.fill.orderId
      }
      // Don't return: other event types may follow in the same drain.
    }

    // Link clientOrderId -> orderId (live + backtest).
    if (ev.kind === 'order_accepted' && ev.clientOrderId === buyClientOrderId) {
      if (ev.orderId) buyOrderId = ev.orderId
      console.log('Strategy > onAccountEvent > order_accepted');
      return []
    }

    // If BUY got rejected/killed/canceled, never sell.
    if (ev.kind === 'order_rejected' && ev.clientOrderId === buyClientOrderId) {
      hasPlacedSell = true
      console.log('Strategy > onAccountEvent > order_rejected');
      return []
    }
    if (ev.kind === 'order_done' && ev.clientOrderId === buyClientOrderId) {
      console.log('Strategy > onAccountEvent > order_done');
      if (ev.reason !== 'filled') {
        hasPlacedSell = true
        console.log('Strategy > onAccountEvent > order_done > not filled');
        return []
      }
      // If we ever see order_done=filled from some source, allow sell immediately.
      allowSell = true
      // Continue to place sell below (if allowed + position policy satisfied).
    }

    // Decouple SELL timing from USER_WS_FILL_AT_STATUS:
    // watch USER ws order updates and wait until status reaches the configured threshold.
    if (ev.kind === 'ws_order_update') {
      // If we don't yet know orderId, infer it from a matching BUY update on the same asset.
      if (!buyOrderId) {
        if (ev.order.assetId === boughtAssetId && ev.order.side === 'BUY') {
          buyOrderId = ev.order.orderId
        } else {
          return []
        }
      }
      if (ev.order.orderId !== buyOrderId) return []
      const s = ev.order.status
      if (s === 'MATCHED' || s === 'MINED' || s === 'CONFIRMED') {
        if (STATUS_RANK[s] >= STATUS_RANK[cfg.sellWhenStatus]) allowSell = true
      }
    }
    console.log('Strategy > onAccountEvent > allowSell', allowSell);
    console.log('Strategy > onAccountEvent > allowSell', cfg.sellWhenStatus);

    if (!allowSell) return []

    const pos = portfolio.positionsByAssetId[boughtAssetId]
    if (cfg.requirePositionBeforeSell) {
      if (!pos || !Number.isFinite(pos.qty) || pos.qty <= 0) return []
    }

    const entry = (pos?.avgEntryPrice ?? buyLimitPrice) ?? null
    if (entry === null || !Number.isFinite(entry)) return []

    const tpInc = Number.isFinite(cfg.takeProfitPct) ? cfg.takeProfitPct : 0.01
    const sellPrice = clamp01(entry + tpInc)
    // Sell the full position qty (i.e. "sell all I bought"), which also handles partial fills.
    // If requirePositionBeforeSell=true (default), `pos.qty` is guaranteed to be > 0 here.
    const sizeToSell = pos ? pos.qty : 0

    if (!Number.isFinite(sizeToSell) || sizeToSell <= 0) return []

    const now = portfolio.nowMs || Date.now()
    hasPlacedSell = true
    console.log('[basicFak.v1] > placing sell order', {
      kind: 'place_limit',
      clientOrderId: `${name}:${boughtAssetId}:sell:${now}`,
      assetId: boughtAssetId,
      side: 'SELL',
      price: sellPrice,
      size: sizeToSell,
      orderType: 'GTC',
      reason: `tp_plus_${tpInc}_sell_when_${cfg.sellWhenStatus}`,
    })

    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${boughtAssetId}:sell:${now}`,
        assetId: boughtAssetId,
        side: 'SELL',
        price: sellPrice,
        size: sizeToSell,
        orderType: 'GTC',
        reason: `tp_plus_${tpInc}_sell_when_${cfg.sellWhenStatus}`,
      },
    ]
  }

  return { name, onMarketTick, onAccountEvent }
}

