/**
 * Rebuilding a market's fills from per-wallet `/activity` rows (deep-backfill).
 *
 * Pure, because two properties of `/activity` make this subtler than it looks
 * and both are worth pinning down in tests:
 *
 * 1. An activity row can AGGREGATE one taker order that swept several makers.
 *    `size` and `usdcSize` are then totals, and `price` is neither their ratio
 *    nor an average. A real row: size=2880.23, price=0.5950, usdcSize=1762.45 →
 *    implied price 0.6119. So `price` cannot be trusted, and the pair
 *    (size, usdcSize) can.
 *
 * 2. Because of (1), a taker cannot be identified by matching size+price against
 *    the taker-only `/trades` rows — an aggregated row never matches a per-fill
 *    row, and every aggregated taker would be silently filed as a maker.
 */

import type { ApiActivity } from './activityApi.js'
import type { ApiTrade } from './dataApi.js'

export type ReconstructedRow = {
  wallet: string
  side: 'BUY' | 'SELL'
  outcomeIndex: number | null
  asset: string
  size: number
  price: number
  usdcSize: number
  isTaker: boolean
  tsMs: number
  txHash: string
}

/**
 * (wallet, tx, asset, side) — deliberately coarser than a fill. A wallet cannot
 * be both maker and taker for the same token and side inside one transaction, so
 * this is exact for the question "was this wallet the taker here?", and it
 * survives aggregation.
 */
export function takerKey(parts: {
  wallet: string
  tx: string
  asset: string
  side: string
}): string {
  // Lowercase the wallet here rather than trusting callers: the taker set is
  // built from /trades rows and probed with /activity rows, and the two
  // endpoints disagree on address casing.
  return [parts.wallet.toLowerCase(), parts.tx, parts.asset, parts.side].join('|')
}

export function takerKeysOf(takerTrades: ApiTrade[]): Set<string> {
  const keys = new Set<string>()
  for (const t of takerTrades) {
    keys.add(
      takerKey({
        wallet: t.proxyWallet.toLowerCase(),
        tx: t.transactionHash,
        asset: t.asset,
        side: t.side,
      }),
    )
  }
  return keys
}

export type ReconstructResult = {
  rows: ReconstructedRow[]
  wallets: number
  /** USDC that changed hands (sum over all rows). */
  volume: number
  /** Shares with each match counted once — the value Gamma reports as volumeNum. */
  sharesVolume: number
}

export function buildReconstructedRows(
  perWalletActivities: ApiActivity[][],
  takerKeys: Set<string>,
  conditionId: string,
): ReconstructResult {
  const rows: ReconstructedRow[] = []
  const wallets = new Set<string>()
  let volume = 0
  let sharesTotal = 0

  for (const activities of perWalletActivities) {
    for (const a of activities) {
      if (a.type !== 'TRADE') continue
      if (a.conditionId !== conditionId) continue

      const wallet = a.proxyWallet.toLowerCase()
      const side = a.side ?? 'BUY'
      const asset = a.asset ?? ''
      const tx = a.transactionHash ?? ''
      const size = a.size ?? 0

      const usdcSize = a.usdcSize ?? size * (a.price ?? 0)
      // Store the EFFECTIVE price so that `usdc_size = size * price` holds for
      // every row in the table, whichever stage wrote it.
      const price = size > 0 ? usdcSize / size : (a.price ?? 0)

      wallets.add(wallet)
      volume += usdcSize
      sharesTotal += size

      rows.push({
        wallet,
        side,
        outcomeIndex: typeof a.outcomeIndex === 'number' ? a.outcomeIndex : null,
        asset,
        size,
        price,
        usdcSize,
        isTaker: takerKeys.has(takerKey({ wallet, tx, asset, side })),
        tsMs: a.timestamp * 1000,
        txHash: tx,
      })
    }
  }

  return { rows, wallets: wallets.size, volume, sharesVolume: sharesTotal / 2 }
}
