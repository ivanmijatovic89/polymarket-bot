import path from 'node:path'
import { readJson, writeJson } from './files.js'

export const MARKET_FAMILIES = {
  'btc:15m': { symbol: 'btc', timeframe: '15m', windowSeconds: 900, enabled: true },
  'btc:5m': { symbol: 'btc', timeframe: '5m', windowSeconds: 300, enabled: false },
  'eth:15m': { symbol: 'eth', timeframe: '15m', windowSeconds: 900, enabled: false },
  'eth:5m': { symbol: 'eth', timeframe: '5m', windowSeconds: 300, enabled: false },
} as const
export type MarketFamilyId = keyof typeof MARKET_FAMILIES
export const DEFAULT_FAMILY: MarketFamilyId = 'btc:15m'

export function marketFamily(id: string = DEFAULT_FAMILY) {
  if (!Object.hasOwn(MARKET_FAMILIES, id)) throw new Error(`Unknown research market: ${id}`)
  const family = MARKET_FAMILIES[id as MarketFamilyId]
  if (!family.enabled) throw new Error(`Research market ${id} is not enabled yet`)
  return { id: id as MarketFamilyId, ...family, windowsPerDay: 86400 / family.windowSeconds }
}

export async function datasetFamily(root: string) {
  const config = await readJson<{ version: number; market: string }>(
    path.join(root, 'dataset.json'),
  )
  if (config && config.version !== 1) throw new Error('Unsupported dataset identity version')
  // All datasets written before the identity file existed were BTC 15-minute.
  return marketFamily(config?.market ?? DEFAULT_FAMILY)
}

/** Called while holding the dataset writer lock. One root belongs to one family. */
export async function ensureDatasetFamily(root: string, requested = DEFAULT_FAMILY) {
  const family = marketFamily(requested)
  const hasIdentity = await readJson(path.join(root, 'dataset.json'))
  const hasLegacyData = await readJson(path.join(root, 'index.json'))
  const existing = hasIdentity || hasLegacyData ? await datasetFamily(root) : family
  if (existing.id !== family.id)
    throw new Error(`Dataset belongs to ${existing.id}, not ${family.id}`)
  await writeJson(path.join(root, 'dataset.json'), { version: 1, market: family.id })
  return family
}
