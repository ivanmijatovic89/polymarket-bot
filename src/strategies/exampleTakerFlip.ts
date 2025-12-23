import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'

/**
 * Very simple taker strategy that forces fills under the current backtest fill model:
 * - Buys with FOK at bestAsk when spread <= maxSpread
 * - Then sells with FOK at bestBid once it has a position
 *
 * This is NOT a profitable strategy; it exists to validate plumbing end-to-end.
 */
export type TakerFlipConfig = {
  assetId?: string
  size: number
  maxSpread: number
  cooldownMs: number
}

function pickAssetId(tick: MarketTick, preferred?: string): string | null {
  if (preferred && tick.snapshot.byAssetId[preferred]) return preferred
  const ids = Object.keys(tick.snapshot.byAssetId)
  return ids[0] ?? null
}

export function createExampleTakerFlipStrategy(cfg: TakerFlipConfig): Strategy {
  const name = 'example_taker_flip'
  let lastActionTs = -Infinity

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    const assetId = pickAssetId(tick, cfg.assetId)
    if (!assetId) return []

    const book = tick.snapshot.byAssetId[assetId]
    if (!book || book.bestBid === null || book.bestAsk === null || book.spread === null) return []
    if (book.spread > cfg.maxSpread) return []

    const pos = portfolio.positionsByAssetId[assetId]?.qty ?? 0
    const now = tick.snapshot.timestamp || Date.now()
    if (now - lastActionTs < cfg.cooldownMs) return []

    if (pos <= 0) {
      lastActionTs = now
      return [
        {
          kind: 'place_limit',
          clientOrderId: `${name}:${assetId}:buy:${now}`,
          assetId,
          side: 'BUY',
          price: book.bestAsk,
          size: cfg.size,
          orderType: 'FOK',
          reason: 'enter_buy_fok',
        },
      ]
    }

    lastActionTs = now
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${assetId}:sell:${now}`,
        assetId,
        side: 'SELL',
        price: book.bestBid,
        size: Math.min(cfg.size, pos),
        orderType: 'FOK',
        reason: 'exit_sell_fok',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}
