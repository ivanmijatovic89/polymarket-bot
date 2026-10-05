import { windowFromSlug } from '../polymarket/upDownSlugWindow.js'
import { HttpError, type ApiClient } from './api.js'
import type { ApiRow, Market } from './types.js'

export const DAY_SECONDS = 86_400
export const WINDOW_SECONDS = 900

export function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected UTC YYYY-MM-DD, got ${value}`)
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value)
    throw new Error(`Invalid date: ${value}`)
  return ms / 1000
}

export function dates(from: string, to: string): string[] {
  const start = parseDate(from)
  const end = parseDate(to)
  if (end <= start) throw new Error('--to must be after --from (exclusive UTC boundary)')
  const values: string[] = []
  for (let t = start; t < end; t += DAY_SECONDS)
    values.push(new Date(t * 1000).toISOString().slice(0, 10))
  return values
}

export function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size))
  return output
}

function stringArray(value: unknown): string[] {
  const array: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(array) || !array.every((x) => typeof x === 'string'))
    throw new Error('Invalid Gamma token/outcome array')
  return array as string[]
}

export function normalizeMarket(raw: ApiRow, resolution: ApiRow | undefined): Market {
  if (typeof raw.slug !== 'string' || !/^btc-updown-15m-\d+$/.test(raw.slug))
    throw new Error('Unexpected market slug')
  const window = windowFromSlug(raw.slug)
  if (!window || typeof raw.conditionId !== 'string' || !/^0x[a-f\d]{64}$/i.test(raw.conditionId))
    throw new Error('Invalid Gamma market identity')
  const tokens = stringArray(raw.clobTokenIds)
  const outcomes = stringArray(raw.outcomes)
  if (tokens.length !== 2 || outcomes.length !== 2 || new Set(tokens).size !== 2)
    throw new Error('Expected two distinct BTC outcome tokens')
  const payouts = resolution?.payouts
  const resolved = resolution?.status === 'resolved'
  if (
    resolved &&
    (!Array.isArray(payouts) ||
      payouts.length !== 2 ||
      !payouts.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000) ||
      payouts.reduce((a: number, n: number) => a + n, 0) !== 1_000_000)
  ) {
    throw new Error(`Invalid resolved payout vector: ${raw.slug}`)
  }
  const events = raw.events as ApiRow[] | undefined
  return {
    slug: raw.slug,
    condition_id: raw.conditionId.toLowerCase(),
    event_id: String(events?.[0]?.id ?? ''),
    symbol: 'btc',
    timeframe: '15m',
    market_start: window.startMs / 1000,
    market_end: window.endMs / 1000,
    token_ids: tokens,
    outcomes,
    payouts: resolved ? (payouts as number[]).map(String) : [],
    resolved,
    raw_json: JSON.stringify(raw),
    resolution_json: JSON.stringify(resolution ?? null),
  }
}

export interface Catalog {
  date: string
  expected: string[]
  missing: string[]
  markets: Market[]
}

export async function discoverDay(client: ApiClient, day: string): Promise<Catalog> {
  const start = parseDate(day)
  const expected = Array.from(
    { length: 96 },
    (_, i) => `btc-updown-15m-${start + i * WINDOW_SECONDS}`,
  )
  const found = new Map<string, ApiRow>()
  // The existing Gamma helper on main demonstrates batch slug selection.
  // Gamma requires repeated slug parameters, handled here by exact encoded URL.
  for (const batch of chunks(expected, 40)) {
    for (const closed of [true, false]) {
      const pending = batch.filter((slug) => !found.has(slug))
      if (!pending.length) break
      const query = new URLSearchParams({ closed: String(closed), limit: String(pending.length) })
      for (const slug of pending) query.append('slug', slug)
      const response = await client.get(`/markets?${query}`, {}, true)
      if (!Array.isArray(response)) throw new Error('Gamma catalog did not return an array')
      for (const raw of response as ApiRow[]) {
        if (typeof raw.slug !== 'string' || !pending.includes(raw.slug))
          throw new Error('Gamma returned an unrequested market')
        found.set(raw.slug, raw)
      }
    }
  }
  // Gamma's list endpoint can omit an inactive market that still exists at its
  // direct slug endpoint. Only a direct 404 is evidence of an unavailable slug;
  // transient errors and mismatched responses must not become coverage gaps.
  for (const slug of expected.filter((value) => !found.has(value))) {
    let raw: unknown
    try {
      raw = await client.get(`/markets/slug/${encodeURIComponent(slug)}`, {}, true)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue
      throw error
    }
    if (!raw || typeof raw !== 'object' || (raw as ApiRow).slug !== slug)
      throw new Error(`Gamma direct lookup returned an unexpected market: ${slug}`)
    found.set(slug, raw as ApiRow)
  }
  const resolutions = new Map<string, ApiRow>()
  for (const batch of chunks([...found.values()], 20)) {
    const response = (await client.get('/v2/resolutions', {
      condition: batch.map((r) => String(r.conditionId)).join(','),
    })) as { data?: ApiRow[] }
    if (!Array.isArray(response.data)) throw new Error('Invalid resolutions response')
    for (const row of response.data) resolutions.set(String(row.condition_id).toLowerCase(), row)
  }
  return {
    date: day,
    expected,
    missing: expected.filter((slug) => !found.has(slug)),
    markets: expected.flatMap((slug) => {
      const raw = found.get(slug)
      return raw
        ? [normalizeMarket(raw, resolutions.get(String(raw.conditionId).toLowerCase()))]
        : []
    }),
  }
}
