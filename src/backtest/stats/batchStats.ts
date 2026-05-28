import type { MarketStats } from './marketStats.js'

export type BatchStats = {
  /** Starting capital for the backtest batch (USDC). */
  capitalInitial: number
  /** Ending capital for the backtest batch (USDC). */
  capitalFinal: number

  /** Total PnL across all markets in the batch (USDC). */
  pnlTotal: number
  /** Total taker fees paid across all markets (USDC). */
  totalFeesPaid: number
  /** avg(pnlsMarketsTotal) / std(pnlsMarketsTotal) */
  qualitySystem: number | null
  /** avg(pnlsMarketsPlayed) / std(pnlsMarketsPlayed) */
  qualityTrade: number | null
  /** Empirical expected PnL per market (pnlTotal / marketsTotal). */
  evPerMarketPlayed: number
  evPerMarketTotal: number

  marketsTotal: number
  /** Markets where the strategy placed 0 trades (tradeCount === 0). */
  marketsSkipped: number
  /** Subset of skipped markets explicitly marked as no in-window activity. */
  marketsNoInWindowActivity: number
  /** Markets with 1+ trades but flat pnl (pnl === 0). */
  marketsFlatWithTrades: number
  /** Markets where the strategy placed >= 1 trade (tradeCount > 0). */
  marketsPlayed: number
  marketsWon: number
  marketsLost: number

  /** wins / decisive (0..1). */
  winRate: number
  /** winRate * 100 as a number. */
  winRatePct: number
  /** winRate * 100 formatted to 2 decimals (string). */
  winRatePctStr: string

  tradesTotal: number
  tradesMaker: number
  tradesTaker: number

  pnlAvgWin: number
  pnlAvgLose: number
  pnlMaxWin: number
  pnlMaxLose: number

  /** Maximum consecutive winning markets. */
  streakMaxWin: number
  /** Maximum consecutive losing markets. */
  streakMaxLose: number
  /** Total PnL accumulated during the max win streak. */
  streakMaxWinPnl: number
  /** Total PnL accumulated during the max lose streak. */
  streakMaxLosePnl: number
  /** Maximum consecutive skipped markets. */
  streakMaxSkipped: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const round4 = (n: number): number => Math.round(n * 10000) / 10000

const computeQuality = (pnls: number[]): number | null => {
  if (pnls.length === 0) return null
  const avg = pnls.reduce((sum, v) => sum + v, 0) / pnls.length
  const variance = pnls.reduce((sum, v) => sum + (v - avg) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  if (!Number.isFinite(std) || std === 0) return null
  return round4(avg / std)
}

/**
 * Computes aggregated statistics across all markets in a backtest batch.
 */
export function computeBatchStats(results: MarketStats[], initialCapital: number): BatchStats {
  const acc = results.reduce(
    (a, r) => {
      a.pnlTotal += r.pnl
      a.totalFeesPaid += r.feesPaid
      a.tradesTotal += r.tradeCount
      a.tradesMaker += r.tradeAsMaker
      a.tradesTaker += r.tradeAsTaker

      if (r.pnl > 0) {
        a.marketsPlayed += 1
        a.marketsWon += 1
        a.pnlWinSum += r.pnl
        a.pnlMaxWin = Math.max(a.pnlMaxWin, r.pnl)
        // Win streak tracking
        a.currentWinStreak += 1
        a.currentWinStreakPnl += r.pnl
        if (a.currentWinStreak > a.streakMaxWin) {
          a.streakMaxWin = a.currentWinStreak
          a.streakMaxWinPnl = a.currentWinStreakPnl
        }
        // Reset lose streak and skipped streak
        a.currentLoseStreak = 0
        a.currentLoseStreakPnl = 0
        a.currentSkippedStreak = 0
      } else if (r.pnl < 0) {
        a.marketsPlayed += 1
        a.marketsLost += 1
        a.pnlLoseSum += r.pnl
        a.pnlMaxLose = Math.min(a.pnlMaxLose, r.pnl)
        // Lose streak tracking
        a.currentLoseStreak += 1
        a.currentLoseStreakPnl += r.pnl
        if (a.currentLoseStreak > a.streakMaxLose) {
          a.streakMaxLose = a.currentLoseStreak
          a.streakMaxLosePnl = a.currentLoseStreakPnl
        }
        // Reset win streak and skipped streak
        a.currentWinStreak = 0
        a.currentWinStreakPnl = 0
        a.currentSkippedStreak = 0
      } else {
        a.marketsSkipped += 1
        if (r.tradeCount > 0) a.marketsFlatWithTrades += 1
        if (r.skipReason === 'no_in_window_activity') a.marketsNoInWindowActivity += 1
        // Skipped streak tracking
        a.currentSkippedStreak += 1
        if (a.currentSkippedStreak > a.streakMaxSkipped) {
          a.streakMaxSkipped = a.currentSkippedStreak
        }
      }

      return a
    },
    {
      pnlTotal: 0,
      totalFeesPaid: 0,
      tradesTotal: 0,
      tradesMaker: 0,
      tradesTaker: 0,
      marketsSkipped: 0,
      marketsNoInWindowActivity: 0,
      marketsFlatWithTrades: 0,
      marketsPlayed: 0,
      marketsWon: 0,
      marketsLost: 0,
      pnlWinSum: 0,
      pnlLoseSum: 0,
      pnlMaxWin: 0,
      pnlMaxLose: 0,
      // Streak tracking
      currentWinStreak: 0,
      currentWinStreakPnl: 0,
      currentLoseStreak: 0,
      currentLoseStreakPnl: 0,
      streakMaxWin: 0,
      streakMaxWinPnl: 0,
      streakMaxLose: 0,
      streakMaxLosePnl: 0,
      currentSkippedStreak: 0,
      streakMaxSkipped: 0,
    },
  )

  const marketsTotal = results.length
  const marketsDecisive = acc.marketsWon + acc.marketsLost

  const winRate = marketsDecisive > 0 ? acc.marketsWon / marketsDecisive : 0
  const winRatePct = winRate * 100

  const capitalFinal = initialCapital + acc.pnlTotal
  const evPerMarketPlayed = acc.marketsPlayed > 0 ? acc.pnlTotal / acc.marketsPlayed : 0
  const evPerMarketTotal = marketsTotal > 0 ? acc.pnlTotal / marketsTotal : 0

  const pnlAvgWin = acc.marketsWon > 0 ? acc.pnlWinSum / acc.marketsWon : 0
  const pnlAvgLose = acc.marketsLost > 0 ? acc.pnlLoseSum / acc.marketsLost : 0

  const pnlsMarketsTotal = results.map((r) => r.pnl)
  const pnlsMarketsPlayed = results.filter((r) => r.pnl > 0 || r.pnl < 0).map((r) => r.pnl)
  const qualitySystem = computeQuality(pnlsMarketsTotal)
  const qualityTrade = computeQuality(pnlsMarketsPlayed)

  return {
    capitalInitial: initialCapital,
    capitalFinal: round2(capitalFinal),

    pnlTotal: round2(acc.pnlTotal),
    totalFeesPaid: round2(acc.totalFeesPaid),
    qualitySystem,
    qualityTrade,
    evPerMarketPlayed: round2(evPerMarketPlayed),
    evPerMarketTotal: round2(evPerMarketTotal),

    marketsTotal,
    marketsSkipped: acc.marketsSkipped,
    marketsNoInWindowActivity: acc.marketsNoInWindowActivity,
    marketsFlatWithTrades: acc.marketsFlatWithTrades,
    marketsPlayed: acc.marketsPlayed,
    marketsWon: acc.marketsWon,
    marketsLost: acc.marketsLost,

    winRate: round4(winRate),
    winRatePct: round2(winRatePct),
    winRatePctStr: winRatePct.toFixed(2),

    tradesTotal: acc.tradesTotal,
    tradesMaker: acc.tradesMaker,
    tradesTaker: acc.tradesTaker,

    pnlAvgWin: round2(pnlAvgWin),
    pnlAvgLose: round2(pnlAvgLose),
    pnlMaxWin: round2(acc.pnlMaxWin),
    pnlMaxLose: round2(acc.pnlMaxLose),

    streakMaxWin: acc.streakMaxWin,
    streakMaxLose: acc.streakMaxLose,
    streakMaxWinPnl: round2(acc.streakMaxWinPnl),
    streakMaxLosePnl: round2(acc.streakMaxLosePnl),
    streakMaxSkipped: acc.streakMaxSkipped,
  }
}
