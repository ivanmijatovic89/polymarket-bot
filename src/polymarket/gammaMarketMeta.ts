function parseJsonArrayString(s: unknown): unknown[] | null {
  if (typeof s !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export type GammaMarketMeta = Record<string, unknown> & {
  slug: string
  outcomes: string[]
  clobTokenIds: string[]
  /** Lowercased outcome -> tokenId */
  outcomeTokenMap: Record<string, string>
  /** Convenience for Up/Down markets; null if not detected */
  upAssetId: string | null
  /** Convenience for Up/Down markets; null if not detected */
  downAssetId: string | null
  question?: string
}

/**
 * Build a "market meta" object from a raw Gamma market payload (or DB rawJson).
 *
 * - Preserves all original fields via spread
 * - Overrides `outcomes` and `clobTokenIds` to be parsed string arrays (Gamma encodes them as JSON strings)
 */
export function buildGammaMarketMeta(
  raw: Record<string, unknown>,
  slug: string,
): GammaMarketMeta | null {
  const outcomesRaw = parseJsonArrayString(raw.outcomes) ?? []
  const clobTokenIdsRaw = parseJsonArrayString(raw.clobTokenIds) ?? []

  const outcomes = outcomesRaw.filter((x): x is string => typeof x === 'string')
  const clobTokenIds = clobTokenIdsRaw.filter((x): x is string => typeof x === 'string')

  // For this repo's use-cases we expect at least two outcomes + two token ids.
  if (outcomes.length < 2) return null
  if (clobTokenIds.length < 2) return null

  const outcomeTokenMap: Record<string, string> = {}
  let upAssetId: string | null = null
  let downAssetId: string | null = null
  const k = Math.min(outcomes.length, clobTokenIds.length)
  for (let i = 0; i < k; i += 1) {
    const outcome = outcomes[i]
    const tokenId = clobTokenIds[i]
    const o = typeof outcome === 'string' ? outcome.toLowerCase() : ''
    const id = typeof tokenId === 'string' && tokenId.length > 0 ? tokenId : undefined
    if (!id || !o) continue

    outcomeTokenMap[o] = id
    if (upAssetId === null && o.includes('up')) upAssetId = id
    if (downAssetId === null && o.includes('down')) downAssetId = id
  }

  return {
    ...raw,
    slug,
    outcomes,
    clobTokenIds,
    outcomeTokenMap,
    upAssetId,
    downAssetId,
    ...(typeof raw.question === 'string' ? { question: raw.question } : {}),
  }
}


