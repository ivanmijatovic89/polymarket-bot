/**
 * repro-risk-cap.ts — minimal reproduction for PROPOSALS P-001.
 *
 * Calls the shared risk gate (src/trading/riskLimits.ts) directly, with no
 * backtest and no I/O, to show that a BTC 15m player cannot legally hold more
 * than 2,000 shares of one outcome — which is what LEVELS.md quantity 3,000
 * requires (levels 5, 10, 15, … 300).
 *
 * Usage (from repo root):
 *   tsx protocols/pair-game-opus/tools/repro-risk-cap.ts
 *
 * Read-only: touches no database, no files, no network.
 */
import { enforceRiskLimits, DEFAULT_RISK_LIMITS } from '../../../src/trading/riskLimits.js'
import type { PlaceLimitIntent, PortfolioSnapshot } from '../../../src/strategy/Strategy.js'

const ASSET = 'UP-token'

function portfolioHolding(qty: number): PortfolioSnapshot {
  return {
    nowMs: 0,
    realizedPnlTotal: 0,
    positionsByAssetId:
      qty > 0 ? { [ASSET]: { assetId: ASSET, qty, avgEntryPrice: 0.48, costBasis: 0.48 * qty } } : {},
    openOrdersByClientId: {},
    ordersByClientId: {},
    recentFills: [],
    marketByAssetId: {},
  }
}

function buy(size: number): PlaceLimitIntent {
  return {
    kind: 'place_limit',
    clientOrderId: `probe-${size}`,
    assetId: ASSET,
    side: 'BUY',
    price: 0.48,
    size,
    orderType: 'GTC',
  }
}

function probe(label: string, held: number, size: number): void {
  const r = enforceRiskLimits({
    nowMs: 0,
    intents: [buy(size)],
    portfolio: portfolioHolding(held),
  })
  const reason = r.blocked[0]?.reason ?? '-'
  console.log(
    `${label.padEnd(46)} held=${String(held).padEnd(5)} buy=${String(size).padEnd(5)} ` +
      `${r.allowed.length > 0 ? 'ALLOWED' : `BLOCKED ${reason}`}`,
  )
}

console.log(`DEFAULT_RISK_LIMITS = ${JSON.stringify(DEFAULT_RISK_LIMITS)}`)
console.log('(OrderManager never passes a `limits` override, so these are the only limits there are)')
console.log('')
probe('flat, single order at the cap', 0, 2000)
probe('flat, single order one share over the cap', 0, 2001)
probe('flat, one order the size a level-5 leg needs', 0, 3000)
probe('holding 2000, top up by one share', 2000, 1)
probe('holding 2000, top up in a legal-size chunk', 2000, 1000)
console.log('')
console.log('Conclusion: chunking does not help — maxOrderSize caps a single order at 2,000 and')
console.log('maxAbsPosition caps the resulting position at 2,000, so 3,000 shares of one outcome')
console.log('is unreachable by any sequence of legal player actions.')
