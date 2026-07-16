import { access, mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import {
  legacyMarketFactPath,
  marketFactPath,
  storageRoot,
  type MarketFactLocator,
} from './paths.js'

export type LayoutMigrationResult = {
  trades: number
  positions: number
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function legacyIds(kind: 'trades' | 'positions', root: string): Promise<number[]> {
  const dir = path.join(root, 'facts', kind)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names
    .map((name) => /^market-(\d+)\.parquet$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b)
}

/**
 * Move accepted per-market snapshots into the Hive staging hierarchy.
 *
 * This never rewrites or downloads a Parquet file: same-filesystem rename keeps
 * its bytes unchanged. All mappings and target collisions are checked before
 * the first move, so an invalid catalog row fails closed.
 */
export async function migrateLegacyMarketFacts(
  markets: MarketFactLocator[],
  root = storageRoot(),
): Promise<LayoutMigrationResult> {
  const byId = new Map(markets.map((market) => [market.id, market]))
  const plan: Array<{
    kind: 'trades' | 'positions'
    source: string
    target: string
  }> = []

  for (const kind of ['trades', 'positions'] as const) {
    for (const id of await legacyIds(kind, root)) {
      const market = byId.get(id)
      if (!market) throw new Error(`Legacy ${kind} file has no market metadata: market-${id}`)
      const source = legacyMarketFactPath(kind, id, root)
      const target = marketFactPath(kind, market, root)
      if (await exists(target)) {
        throw new Error(`Refusing to overwrite existing staged ${kind} file: ${target}`)
      }
      plan.push({ kind, source, target })
    }
  }

  const result: LayoutMigrationResult = { trades: 0, positions: 0 }
  for (const item of plan) {
    await mkdir(path.dirname(item.target), { recursive: true })
    await rename(item.source, item.target)
    result[item.kind] += 1
  }

  for (const kind of ['trades', 'positions'] as const) {
    await rmdir(path.join(root, 'facts', kind)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error
    })
  }
  return result
}
