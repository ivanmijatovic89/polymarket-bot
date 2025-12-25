import { loadPolymarketConfigFromEnv } from './config.js'

export async function fetchGammaMarketBySlug(args: {
  slug: string
}): Promise<Record<string, unknown> | null> {
  const gammaBaseUrl = loadPolymarketConfigFromEnv().gamma.baseUrl
  const url = `${gammaBaseUrl}/markets?slug=${encodeURIComponent(args.slug)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gamma HTTP ${res.status}: ${await res.text()}`)
  const arr: unknown = await res.json()
  const first = Array.isArray(arr) ? (arr[0] ?? null) : null
  if (!first || typeof first !== 'object') return null
  return first as Record<string, unknown>
}
