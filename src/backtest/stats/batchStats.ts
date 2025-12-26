import type { MarketStats } from './marketStats.js'

export type BatchStats = {
  initialCapital: number
  finalCapital: number
  totalPnl: number
  totalMarkets: number
  winningMarkets: number
  losingMarkets: number
  winRate: number
  totalTrades: number
}

/**
 * Computes aggregated statistics across all markets in a backtest batch.
 */
export function computeBatchStats(results: MarketStats[], initialCapital: number): BatchStats {
  const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0)
  const finalCapital = initialCapital + totalPnl
  const totalMarkets = results.length
  const winningMarkets = results.filter((r) => r.pnl > 0).length
  const losingMarkets = results.filter((r) => r.pnl < 0).length
  const totalTrades = results.reduce((sum, r) => sum + r.tradeCount, 0)
  const winRate = totalMarkets > 0 ? winningMarkets / totalMarkets : 0

  return {
    initialCapital,
    finalCapital: Math.round(finalCapital * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalMarkets,
    winningMarkets,
    losingMarkets,
    winRate: Math.round(winRate * 10000) / 10000, // 4 decimal places for percentage
    totalTrades,
  }
}

