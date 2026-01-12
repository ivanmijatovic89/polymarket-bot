import type { MarketStats } from './marketStats.js'

export type BatchStats = {
  /** Starting capital for the backtest batch (USDC). */
  capitalInitial: number
  /** Ending capital for the backtest batch (USDC). */
  capitalFinal: number

  /** Total PnL across all markets in the batch (USDC). */
  pnlTotal: number

  marketsTotal: number
  marketsWon: number
  marketsLost: number
  /** Markets with pnl === 0 (breakeven). */
  marketsBreakeven: number
  /** marketsWon + marketsLost (excludes breakeven). */
  marketsDecisive: number

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
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const round4 = (n: number): number => Math.round(n * 10000) / 10000

/**
 * Computes aggregated statistics across all markets in a backtest batch.
 */
export function computeBatchStats(results: MarketStats[], initialCapital: number): BatchStats {
  const acc = results.reduce(
    (a, r) => {
      a.pnlTotal += r.pnl
      a.tradesTotal += r.tradeCount
      a.tradesMaker += r.tradeAsMaker
      a.tradesTaker += r.tradeAsTaker

      if (r.pnl > 0) {
        a.marketsWon += 1
        a.pnlWinSum += r.pnl
        a.pnlMaxWin = Math.max(a.pnlMaxWin, r.pnl)
      } else if (r.pnl < 0) {
        a.marketsLost += 1
        a.pnlLoseSum += r.pnl
        a.pnlMaxLose = Math.min(a.pnlMaxLose, r.pnl)
      } else {
        a.marketsBreakeven += 1
      }

      return a
    },
    {
      pnlTotal: 0,
      tradesTotal: 0,
      tradesMaker: 0,
      tradesTaker: 0,
      marketsWon: 0,
      marketsLost: 0,
      marketsBreakeven: 0,
      pnlWinSum: 0,
      pnlLoseSum: 0,
      pnlMaxWin: 0,
      pnlMaxLose: 0,
    },
  )

  const marketsTotal = results.length
  const marketsDecisive = acc.marketsWon + acc.marketsLost

  const winRate = marketsDecisive > 0 ? acc.marketsWon / marketsDecisive : 0
  const winRatePct = winRate * 100

  const capitalFinal = initialCapital + acc.pnlTotal

  const pnlAvgWin = acc.marketsWon > 0 ? acc.pnlWinSum / acc.marketsWon : 0
  const pnlAvgLose = acc.marketsLost > 0 ? acc.pnlLoseSum / acc.marketsLost : 0

  return {
    capitalInitial: initialCapital,
    capitalFinal: round2(capitalFinal),

    pnlTotal: round2(acc.pnlTotal),

    marketsTotal,
    marketsWon: acc.marketsWon,
    marketsLost: acc.marketsLost,
    marketsBreakeven: acc.marketsBreakeven,
    marketsDecisive,

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
  }
}
