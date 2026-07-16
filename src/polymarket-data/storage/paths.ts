import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { POLYMARKET_DATA_STORAGE_DIR } from '../../config/polymarketData.js'

export type FactKind = 'trades' | 'positions' | 'activity'

export type MarketFactLocator = {
  id: number
  slug: string
  symbol: string
  timeframe: string
  marketStartMs: number
}

export function storageRoot(): string {
  return path.resolve(POLYMARKET_DATA_STORAGE_DIR)
}

function partitionValue(name: string, value: string): string {
  if (!/^[a-z0-9]+$/.test(value)) {
    throw new Error(`Invalid ${name} for Parquet path: ${value}`)
  }
  return value
}

function marketSlug(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Invalid market slug for Parquet filename: ${slug}`)
  }
  return slug
}

export function marketMonth(marketStartMs: number): string {
  if (!Number.isFinite(marketStartMs)) {
    throw new Error(`Invalid market start timestamp for Parquet path: ${marketStartMs}`)
  }
  const date = new Date(marketStartMs)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid market start timestamp for Parquet path: ${marketStartMs}`)
  }
  const iso = date.toISOString()
  return iso.slice(0, 7)
}

export function marketFactPath(
  kind: 'trades' | 'positions',
  market: MarketFactLocator,
  root = storageRoot(),
): string {
  if (!Number.isSafeInteger(market.id) || market.id <= 0) {
    throw new Error(`Invalid market id for Parquet row: ${market.id}`)
  }
  const symbol = partitionValue('symbol', market.symbol)
  const timeframe = partitionValue('timeframe', market.timeframe)
  const month = marketMonth(market.marketStartMs)
  const slug = marketSlug(market.slug)
  return path.join(
    root,
    'staging',
    kind,
    `symbol=${symbol}`,
    `timeframe=${timeframe}`,
    `month=${month}`,
    `${slug}.parquet`,
  )
}

/** Temporary compatibility path used only by the one-time layout migration. */
export function legacyMarketFactPath(
  kind: 'trades' | 'positions',
  marketId: number,
  root = storageRoot(),
): string {
  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error(`Invalid market id for legacy Parquet path: ${marketId}`)
  }
  return path.join(root, 'facts', kind, `market-${marketId}.parquet`)
}

export function walletActivityPath(wallet: string): string {
  if (!/^0x[0-9a-f]{40}$/i.test(wallet)) throw new Error(`Invalid wallet address: ${wallet}`)
  return path.join(storageRoot(), 'facts', 'activity', `${wallet.toLowerCase()}.parquet`)
}

export function catalogPath(): string {
  return path.join(storageRoot(), 'polymarket.duckdb')
}

async function listParquetFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listParquetFiles(entryPath)))
    else if (entry.isFile() && entry.name.endsWith('.parquet')) files.push(entryPath)
  }
  return files
}

export async function listFactFiles(kind: FactKind): Promise<string[]> {
  const root = storageRoot()
  const dirs =
    kind === 'activity'
      ? [path.join(root, 'facts', kind)]
      : [path.join(root, 'staging', kind), path.join(root, 'facts', kind)]
  const files = (await Promise.all(dirs.map(listParquetFiles))).flat()
  return files.sort()
}
