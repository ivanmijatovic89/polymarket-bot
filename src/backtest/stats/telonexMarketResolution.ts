import type { Market as TelonexMarket } from '../../db/telonexMarkets.js'
import type { MarketResolution } from './marketResolution.js'

/**
 * Build resolution from a telonex_markets row.
 * - tokenMap: { UP: assetId0, DOWN: assetId1 } — telonex stores outcome_0='Up', outcome_1='Down' uniformly.
 * - outcome: resolved only when telonex_status='resolved' AND result_id is set; otherwise null.
 *
 * No Gamma fallback, no DB writes — telonex_markets is authoritative for these fields.
 */
export function getMarketResolution(row: TelonexMarket): MarketResolution | null {
  if (!row.assetId0 || !row.assetId1) {
    console.warn(
      `[telonexMarketResolution] missing asset ids for slug=${row.slug} assetId0=${row.assetId0} assetId1=${row.assetId1}`,
    )
    return null
  }

  const tokenMap: Record<string, string> = {
    UP: row.assetId0,
    DOWN: row.assetId1,
  }

  let outcome: 'UP' | 'DOWN' | null = null
  if (row.telonexStatus === 'resolved' && row.resultId !== null) {
    if (row.resultId === '0') outcome = 'UP'
    else if (row.resultId === '1') outcome = 'DOWN'
    else {
      console.warn(
        `[telonexMarketResolution] unexpected result_id=${row.resultId} for slug=${row.slug}`,
      )
    }
  }

  return { tokenMap, outcome }
}
