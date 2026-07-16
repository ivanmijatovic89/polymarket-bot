export type WalletAggregate = {
  rows: number
  size: number
  usdcSize: number
}

export type WalletAggregateVerdict = {
  ok: boolean
  rowDiff: number
  sizeDiff: number
  usdcDiff: number
  note: string
}

/**
 * Both sides are the same public `/trades?user=...&market=...` representation,
 * so row count and aggregate economics must all agree. This catches accidental
 * removal of genuine identical-looking fills as well as missing pages.
 */
export function walletAggregateVerdict(
  stored: WalletAggregate,
  live: WalletAggregate,
): WalletAggregateVerdict {
  const sizeDiff = Math.abs(stored.size - live.size)
  const usdcDiff = Math.abs(stored.usdcSize - live.usdcSize)
  const rowDiff = Math.abs(stored.rows - live.rows)
  const sizeTolerance = Math.max(0.05, Math.max(stored.rows, live.rows) * 5e-6)
  const usdcTolerance = Math.max(0.05, Math.max(stored.rows, live.rows) * 5e-6)
  const ok = rowDiff === 0 && sizeDiff <= sizeTolerance && usdcDiff <= usdcTolerance
  return {
    ok,
    rowDiff,
    sizeDiff,
    usdcDiff,
    note:
      `stored(size=${stored.size.toFixed(6)},usdc=${stored.usdcSize.toFixed(6)}) ` +
      `api(size=${live.size.toFixed(6)},usdc=${live.usdcSize.toFixed(6)})`,
  }
}
