import { multisetDifference } from './accounting.js'
import { abs, decimal, sum, units } from './decimal.js'
import type { FeedRow, Market, WalletMarket } from './types.js'

export const VOLUME_WARNING = 'corroborated_source_volume_disagreement'
export const UNRESOLVED_VOLUME = 'unresolved_source_volume_disagreement'

class UncorroboratedVolumeError extends Error {}

export interface VolumeEvidence {
  version: 1
  condition_id: string
  observed_at: string
  page_size: 137
  aggregate_shares: string
  all_trades: FeedRow[]
  taker_trades: FeedRow[]
}

/** A narrow source exception, never a general volume or wallet-PnL tolerance. */
export function volumeCandidate(market: Market, trades: FeedRow[], expected: bigint) {
  const fail = () => {
    throw new UncorroboratedVolumeError(
      `Uncorroborated trade volume mismatch: ${market.slug}; downloaded=${decimal(actual)} API=${decimal(expected)}`,
    )
  }
  const takers = trades.filter((row) => row.is_taker)
  const actual = sum(takers.map((row) => units(row.size)))
  const difference = actual - expected
  // An isolated pre-window opening burst, with every same-second fill included.
  // Select by time, never a subset chosen to force the aggregate to match.
  // Magnitude alone cannot corroborate or invalidate the detailed ledger:
  // repeated feeds and every participant's accounting must still pass below.
  if (!market.resolved || expected <= 0n || difference <= 1n) return fail()
  const firstTime = takers.reduce((minimum, row) => Math.min(minimum, row.timestamp), Infinity)
  // Some opening fills are minutes apart. Choose the entire first five minutes
  // before the market window, independent of the discrepancy's amount.
  const isOpening = (row: FeedRow) =>
    row.timestamp <= firstTime + 300 && row.timestamp < market.market_start
  const first = takers.filter(isOpening)
  const lastTime = first.reduce((maximum, row) => Math.max(maximum, row.timestamp), -Infinity)
  const nextTime = takers
    .filter((row) => !isOpening(row))
    .reduce((minimum, row) => Math.min(minimum, row.timestamp), Infinity)
  if (
    first.length === 0 ||
    !Number.isFinite(nextTime) ||
    lastTime >= market.market_start ||
    nextTime - lastTime < 60 ||
    first.some((row) => units(row.size) <= 0n) ||
    abs(sum(first.map((row) => units(row.size))) - difference) > 1n ||
    sum(trades.map((row) => units(row.size))) !== 2n * actual
  )
    return fail()
  const transactions = [...new Set(first.map((row) => row.transaction_hash.toLowerCase()))].sort()
  if (transactions.length !== first.length) return fail()
  const walletSet = new Set<string>()
  for (const taker of first) {
    const pair = trades.filter(
      (row) => row.transaction_hash.toLowerCase() === taker.transaction_hash.toLowerCase(),
    )
    const pairWallets = new Set(pair.map((row) => row.proxy_wallet.toLowerCase()))
    if (
      pair.length < 2 ||
      pairWallets.size < 2 ||
      pair.filter((row) => row.is_taker).length !== 1 ||
      pair.some((row) => row.timestamp !== taker.timestamp || units(row.size) <= 0n) ||
      sum(pair.filter((row) => !row.is_taker).map((row) => units(row.size))) !== units(taker.size)
    )
      return fail()
    for (const wallet of pairWallets) walletSet.add(wallet)
  }
  const wallets = [...walletSet].sort()
  const transaction = transactions.length === 1 ? transactions[0] : undefined
  return {
    transaction,
    transactions,
    first_timestamp: firstTime,
    last_timestamp: lastTime,
    taker_fill_count: first.length,
    wallets,
    downloaded_shares: decimal(actual),
    difference: decimal(difference),
  }
}

export function validateVolumeEvidence(
  market: Market,
  trades: FeedRow[],
  expected: bigint,
  evidence: VolumeEvidence,
  summaries: Pick<WalletMarket, 'wallet' | 'condition_id' | 'quality'>[],
) {
  validateRepeatedVolumeEvidence(market, trades, expected, evidence)
  const candidate = volumeCandidate(market, trades, expected)
  if (
    candidate.wallets.some(
      (wallet) =>
        !summaries.some(
          (row) =>
            row.wallet === wallet &&
            row.condition_id === market.condition_id &&
            row.quality === 'complete',
        ),
    )
  )
    throw new UncorroboratedVolumeError(`Source-volume corroboration failed: ${market.slug}`)
  return candidate
}

/** Unstable or incomplete repeat feeds remain fatal; they are not aggregate-only gaps. */
function validateRepeatedVolumeEvidence(
  market: Market,
  trades: FeedRow[],
  expected: bigint,
  evidence: VolumeEvidence,
) {
  if (
    evidence.version !== 1 ||
    evidence.condition_id !== market.condition_id ||
    evidence.page_size !== 137 ||
    !Number.isFinite(Date.parse(evidence.observed_at)) ||
    units(evidence.aggregate_shares) !== expected ||
    multisetDifference(trades, evidence.all_trades) !== 0 ||
    multisetDifference(
      trades.filter((row) => row.is_taker),
      evidence.taker_trades,
    ) !== 0
  )
    throw new Error(`Source-volume corroboration failed: ${market.slug}`)
}

/** Retain a stable aggregate discrepancy without claiming complete market accounting. */
export function assessVolumeEvidence(
  market: Market,
  trades: FeedRow[],
  expected: bigint,
  evidence: VolumeEvidence,
  summaries: Pick<WalletMarket, 'wallet' | 'condition_id' | 'quality'>[],
) {
  try {
    const candidate = validateVolumeEvidence(market, trades, expected, evidence, summaries)
    return { code: VOLUME_WARNING, difference: candidate.difference, candidate, reason: null }
  } catch (error) {
    if (!(error instanceof UncorroboratedVolumeError)) throw error
    return {
      code: UNRESOLVED_VOLUME,
      difference: decimal(
        sum(trades.filter((row) => row.is_taker).map((row) => units(row.size))) - expected,
      ),
      candidate: null,
      reason: error.message,
    }
  }
}

/** Every observed participant is affected when the missing/excess volume is unlocalized. */
export function applyVolumeQuality(market: Market, summary: WalletMarket): WalletMarket {
  if (!market.source_warnings?.includes(UNRESOLVED_VOLUME)) return summary
  return {
    ...summary,
    quality: 'unresolved',
    issues: [...new Set([...summary.issues, UNRESOLVED_VOLUME])].sort(),
  }
}
