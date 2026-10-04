import { accountWalletMarket } from './accounting.js'
import type { Activity, FeedRow, Market, Position, WalletMarket } from './types.js'

export const ACCOUNTING_VERSION = 6

export function groupRows<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const output = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    const group = output.get(id)
    if (group) group.push(row)
    else output.set(id, [row])
  }
  return output
}

/** Only wallets discovered in the complete all-side trade feed are ranked. */
export function summarizeMarket(
  market: Market,
  trades: FeedRow[],
  activities: Activity[],
  positions: Position[],
  fetchedWallets: Set<string>,
): WalletMarket[] {
  const byWallet = <T extends { proxy_wallet: string }>(rows: T[]) =>
    groupRows(rows, (row) => row.proxy_wallet.toLowerCase())
  const tradeGroups = byWallet(trades)
  const activityGroups = byWallet(activities)
  const positionGroups = byWallet(positions)
  return [...tradeGroups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([wallet, walletTrades]) =>
      accountWalletMarket({
        market,
        wallet,
        trades: walletTrades,
        activities: activityGroups.get(wallet) ?? [],
        positions: positionGroups.get(wallet) ?? [],
        fetched: fetchedWallets.has(wallet),
      }),
    )
}

export function coverageRow(slug: string, market: Market | undefined, summaries: WalletMarket[]) {
  return {
    slug,
    condition_id: market?.condition_id ?? '',
    market_start: Number(slug.split('-').at(-1)),
    found: Boolean(market),
    trade_count: summaries.reduce((n, row) => n + row.trade_count, 0),
    wallet_count: summaries.length,
    complete_wallets: summaries.filter((row) => row.quality === 'complete').length,
    unresolved_wallets: summaries.filter((row) => row.quality === 'unresolved').length,
    pending_wallets: summaries.filter((row) => row.quality === 'pending_resolution').length,
  }
}
