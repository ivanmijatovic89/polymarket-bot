const GAMMA_DEFAULT = 'https://gamma-api.polymarket.com'

function floorTo15mUtc(date: Date): Date {
  const ms = date.getTime()
  const fifteen = 15 * 60 * 1000
  return new Date(Math.floor(ms / fifteen) * fifteen)
}

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function buildSlug(date: Date): string {
  const windowStart = floorTo15mUtc(date)
  const epoch = toEpochSeconds(windowStart)
  return `btc-updown-15m-${epoch}`
}

function parseJsonArrayString(s: unknown): unknown[] | null {
  if (typeof s !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function fetchGammaMarketBySlug(args: {
  gammaBaseUrl: string
  slug: string
}): Promise<Record<string, unknown> | null> {
  const url = `${args.gammaBaseUrl}/markets?slug=${encodeURIComponent(args.slug)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gamma HTTP ${res.status}: ${await res.text()}`)
  const arr: unknown = await res.json()
  const first = Array.isArray(arr) ? (arr[0] ?? null) : null
  if (!first || typeof first !== 'object') return null
  return first as Record<string, unknown>
}

export type BtcUpDown15mMarket = {
  slug: string
  question?: string
  outcomes: string[]
  clobTokenIds: string[]
}

/**
 * Returns the active "Bitcoin Up or Down (15 minute intervals)" market for the current
 * 15-minute UTC window.
 *
 * Defensive: Gamma can be ahead/behind around boundaries, so we also try previous window.
 */
export async function getCurrentBtcUpDown15mMarket(
  date = new Date(),
): Promise<BtcUpDown15mMarket | null> {
  const gammaBaseUrl = process.env.GAMMA_API_BASE_URL ?? GAMMA_DEFAULT

  const candidates = [buildSlug(date), buildSlug(new Date(date.getTime() - 15 * 60 * 1000))]

  for (const slug of candidates) {
    const raw = await fetchGammaMarketBySlug({ gammaBaseUrl, slug })
    if (!raw) continue

    const outcomesRaw = parseJsonArrayString(raw.outcomes) ?? []
    const clobTokenIdsRaw = parseJsonArrayString(raw.clobTokenIds) ?? []

    const outcomes = outcomesRaw.filter((x): x is string => typeof x === 'string')
    const clobTokenIds = clobTokenIdsRaw.filter((x): x is string => typeof x === 'string')

    if (outcomes.length < 2) continue
    if (clobTokenIds.length < 2) continue

    return {
      slug,
      outcomes,
      clobTokenIds,
      ...(typeof raw.question === 'string' ? { question: raw.question } : {}),
    }
  }

  return null
}
