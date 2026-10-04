import { multisetDifference } from './accounting.js'
import { abs, decimal, sum, units } from './decimal.js'
import type { FeedRow, Market, WalletMarket } from './types.js'

export const VOLUME_WARNING = 'corroborated_source_volume_disagreement'

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
    throw new Error(
      `Uncorroborated trade volume mismatch: ${market.slug}; downloaded=${decimal(actual)} API=${decimal(expected)}; cached pages retained`,
    )
  }
  const takers = trades.filter((row) => row.is_taker)
  const actual = sum(takers.map((row) => units(row.size)))
  const difference = actual - expected
  // At most 10 shares and 0.1% of volume, in a resolved market, matched by one
  // earliest pre-window fill. This does not establish the aggregate's cause.
  if (
    !market.resolved ||
    expected <= 0n ||
    difference <= 1n ||
    difference > 10_000_000n ||
    difference * 1000n > actual
  )
    return fail()
  const firstTime = takers.reduce((minimum, row) => Math.min(minimum, row.timestamp), Infinity)
  const first = takers.filter((row) => row.timestamp === firstTime)
  if (
    first.length !== 1 ||
    firstTime >= market.market_start ||
    abs(units(first[0]!.size) - difference) > 1n ||
    sum(trades.map((row) => units(row.size))) !== 2n * actual
  )
    return fail()
  const transaction = first[0]!.transaction_hash.toLowerCase()
  const pair = trades.filter((row) => row.transaction_hash.toLowerCase() === transaction)
  const wallets = [...new Set(pair.map((row) => row.proxy_wallet.toLowerCase()))].sort()
  if (
    pair.length !== 2 ||
    wallets.length !== 2 ||
    pair.filter((row) => row.is_taker).length !== 1 ||
    pair.some((row) => row.timestamp !== firstTime || units(row.size) !== units(first[0]!.size))
  )
    return fail()
  return {
    transaction,
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
  const candidate = volumeCandidate(market, trades, expected)
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
    ) !== 0 ||
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
    throw new Error(`Source-volume corroboration failed: ${market.slug}`)
  return candidate
}
