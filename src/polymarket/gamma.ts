export const GAMMA_DEFAULT = 'https://gamma-api.polymarket.com'

export async function fetchGammaMarketBySlug(args: {
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
