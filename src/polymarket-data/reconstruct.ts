/**
 * Rebuilding a market's fills from per-wallet `/activity` rows (deep-backfill).
 *
 * Pure, because three properties of `/activity` make this subtler than it looks
 * and all are worth pinning down in tests:
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
 *
 * 3. Also because of (1), storing the aggregated taker activity row verbatim
 *    breaks the one-row-per-fill contract `polymarket_trades` promises: fill
 *    counts, per-fill prices, and `verify`'s row comparison all skew. So when the
 *    taker `/trades` query is COMPLETE we take the taker side from ITS per-fill
 *    rows and drop the aggregated taker activity rows; only the maker side comes
 *    from `/activity`. When that query is capped we cannot, so the aggregated row
 *    stands in and the market is flagged (`takerCapped`) rather than pretending.
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
  takerTrades: ApiTrade[],
  takerCapped: boolean,
  conditionId: string,
): ReconstructResult {
  const takerKeys = takerKeysOf(takerTrades)
  const rows: ReconstructedRow[] = []
  const wallets = new Set<string>()

  for (const activities of perWalletActivities) {
    for (const a of activities) {
      if (a.type !== 'TRADE') continue
      if (a.conditionId !== conditionId) continue

      const wallet = a.proxyWallet.toLowerCase()
      const side = a.side ?? 'BUY'
      const asset = a.asset ?? ''
      const tx = a.transactionHash ?? ''
      const isTaker = takerKeys.has(takerKey({ wallet, tx, asset, side }))

      // Taker side: when the taker `/trades` query is COMPLETE, drop the
      // (possibly aggregated) taker activity row here and re-add the per-fill
      // taker rows from `/trades` below. When capped, keep it — an aggregated
      // stand-in the market is explicitly flagged for.
      if (isTaker && !takerCapped) continue

      const size = a.size ?? 0
      const usdcSize = a.usdcSize ?? size * (a.price ?? 0)
      // Store the EFFECTIVE price so that `usdc_size = size * price` holds for
      // every row in the table, whichever stage wrote it.
      const price = size > 0 ? usdcSize / size : (a.price ?? 0)

      wallets.add(wallet)
      rows.push({
        wallet,
        side,
        outcomeIndex: typeof a.outcomeIndex === 'number' ? a.outcomeIndex : null,
        asset,
        size,
        price,
        usdcSize,
        isTaker,
        tsMs: a.timestamp * 1000,
        txHash: tx,
      })
    }
  }

  // Per-fill taker rows from `/trades` (source of truth when complete). A taker
  // sweep is one aggregated activity row but several `/trades` rows, so this is
  // what restores the one-row-per-fill count and true per-fill prices.
  if (!takerCapped) {
    for (const t of takerTrades) {
      const wallet = t.proxyWallet.toLowerCase()
      wallets.add(wallet)
      rows.push({
        wallet,
        side: t.side,
        outcomeIndex: t.outcomeIndex,
        asset: t.asset,
        size: t.size,
        price: t.price,
        usdcSize: t.size * t.price,
        isTaker: true,
        tsMs: t.timestamp * 1000,
        txHash: t.transactionHash,
      })
    }
  }

  let volume = 0
  let sharesTotal = 0
  for (const r of rows) {
    volume += r.usdcSize
    sharesTotal += r.size
  }

  return { rows, wallets: wallets.size, volume, sharesVolume: sharesTotal / 2 }
}
