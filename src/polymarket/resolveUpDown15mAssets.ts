import {
  getCurrentUpDown15mMarket,
  type UpDown15mMarket,
  type UpDown15mSymbol,
} from './upDown15m.js'

export type ResolvedUpDown15mAssets = {
  market: UpDown15mMarket
  slug: string
  assetsIds: string[]
  label: string
  tokenMap: Record<string, string>
}

export async function resolveCurrentUpDown15mAssets(args: {
  symbol: UpDown15mSymbol
  date?: Date
}): Promise<ResolvedUpDown15mAssets> {
  const m = await getCurrentUpDown15mMarket(args.symbol, args.date ?? new Date())
  if (!m) {
    throw new Error(
      `[resolveUpDown15mAssets] No current ${args.symbol.toUpperCase()} 15m Up/Down market found on Gamma`,
    )
  }

  const assetsIds = m.clobTokenIds.slice(0, 2)
  const tokenMap: Record<string, string> = {}
  for (let i = 0; i < 2; i += 1) {
    const outcome = m.outcomes[i]
    const tokenId = m.clobTokenIds[i]
    if (typeof outcome === 'string' && typeof tokenId === 'string') tokenMap[outcome] = tokenId
  }

  return {
    market: m,
    slug: m.slug,
    assetsIds,
    label: `gamma:${m.slug}`,
    tokenMap,
  }
}
