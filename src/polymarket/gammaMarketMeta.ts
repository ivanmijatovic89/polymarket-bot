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

  return {
    ...raw,
    slug,
    outcomes,
    clobTokenIds,
    ...(typeof raw.question === 'string' ? { question: raw.question } : {}),
  }
}


