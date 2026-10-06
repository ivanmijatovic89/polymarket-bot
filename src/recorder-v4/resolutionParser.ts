import {
  RECORDER_SCHEMA_VERSION,
  type RecordedMarket,
  type ResolutionObservation,
} from './types.js'

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function array(value: unknown): unknown[] | null {
  try {
    const result: unknown = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(result) ? result : null
  } catch {
    return null
  }
}

function decimal(value: unknown): string | null {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value
        : null
  return text !== null && /^\d+(?:\.\d+)?$/.test(text) ? text : null
}

/** Gamma lifecycle finality is required; a quoted price of 1 is not resolution. */
export function parseResolutionObservation(
  market: RecordedMarket,
  rawJson: string,
  observedAtMs: number,
): ResolutionObservation {
  const raw = object(JSON.parse(rawJson))
  if (!raw || raw.slug !== market.slug || raw.conditionId !== market.conditionId) {
    throw new Error('Resolution response market identity mismatch')
  }
  const lifecycle =
    typeof raw.umaResolutionStatus === 'string' ? raw.umaResolutionStatus.toLowerCase() : ''
  let status: ResolutionObservation['status'] =
    lifecycle === 'resolved'
      ? 'resolved'
      : ['disputed', 'challenged', 'arbitration'].includes(lifecycle)
        ? 'disputed'
        : ['proposed', 'reproposed'].includes(lifecycle)
          ? 'proposed'
          : ['', 'active', 'initialized', 'posed', 'pending'].includes(lifecycle)
            ? 'pending'
            : 'unknown'
  const tokenIds = array(raw.clobTokenIds)
  const outcomes = array(raw.outcomes)
  const prices = array(raw.outcomePrices)
  let payouts: Record<string, string> | null = null
  let winningTokenId: string | null = null
  let winningOutcome: string | null = null
  if (status === 'resolved') {
    const validMapping =
      tokenIds?.length === 2 &&
      outcomes?.length === 2 &&
      prices?.length === 2 &&
      market.tokenIds.every((token) => tokenIds.includes(token)) &&
      tokenIds[0] !== tokenIds[1] &&
      outcomes.every(
        (outcome, index) =>
          typeof outcome === 'string' &&
          outcome.toLowerCase() ===
            market.outcomes[market.tokenIds.indexOf(tokenIds[index] as string)]?.toLowerCase(),
      )
    const amounts = prices?.map(decimal)
    const validPayouts =
      amounts?.length === 2 &&
      amounts.every((value) => value !== null && Number(value) >= 0 && Number(value) <= 1) &&
      Math.abs(amounts.reduce<number>((sum, value) => sum + Number(value), 0) - 1) < 1e-9
    if (
      raw.closed !== true ||
      !validMapping ||
      !validPayouts ||
      !tokenIds ||
      !outcomes ||
      !amounts
    ) {
      status = 'unknown'
    } else {
      payouts = Object.fromEntries(tokenIds.map((token, index) => [String(token), amounts[index]!]))
      const winner = amounts.findIndex((value) => Number(value) === 1)
      if (winner >= 0) {
        winningTokenId = String(tokenIds[winner])
        winningOutcome = String(outcomes[winner])
      }
    }
  }
  const metadata = (Array.isArray(raw.events) ? raw.events : [])
    .map((event: unknown) => object(object(event)?.eventMetadata))
    .find((event) => event !== null)
  return {
    schemaVersion: RECORDER_SCHEMA_VERSION,
    slug: market.slug,
    conditionId: market.conditionId,
    observedAtMs,
    status,
    winningOutcome,
    winningTokenId,
    payouts,
    priceToBeat: decimal(metadata?.priceToBeat),
    finalPrice: decimal(metadata?.finalPrice),
    source: `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(market.slug)}`,
    rawJson,
  }
}
