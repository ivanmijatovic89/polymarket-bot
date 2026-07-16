import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Hex } from 'viem'
import { storageRoot } from '../storage/paths.js'
import type { DiscoveryChunk, MatchedTransaction } from './discovery.js'

const VERSION = 1

export type ScopeLocator = {
  symbol: string
  timeframe: string
  date: string
}

type StoredTransaction = Omit<MatchedTransaction, 'blockNumber'> & { blockNumber: string }

export type StoredDiscoveryChunk = Omit<
  DiscoveryChunk,
  'fromBlock' | 'toBlock' | 'transactions'
> & {
  version: number
  fromBlock: string
  toBlock: string
  toBlockHash: Hex
  transactions: StoredTransaction[]
}

export function chainScopeDir(scope: ScopeLocator): string {
  return path.join(
    storageRoot(),
    'chain',
    'staging',
    `symbol=${scope.symbol}`,
    `timeframe=${scope.timeframe}`,
    `date=${scope.date}`,
  )
}

function discoveryDir(scope: ScopeLocator): string {
  return path.join(chainScopeDir(scope), 'discovery')
}

function stored(chunk: DiscoveryChunk, toBlockHash: Hex): StoredDiscoveryChunk {
  return {
    version: VERSION,
    ...chunk,
    fromBlock: chunk.fromBlock.toString(),
    toBlock: chunk.toBlock.toString(),
    toBlockHash,
    transactions: chunk.transactions.map((transaction) => ({
      ...transaction,
      blockNumber: transaction.blockNumber.toString(),
    })),
  }
}

function restored(chunk: StoredDiscoveryChunk): DiscoveryChunk {
  if (chunk.version !== VERSION)
    throw new Error(`unsupported discovery checkpoint v${chunk.version}`)
  return {
    ...chunk,
    fromBlock: BigInt(chunk.fromBlock),
    toBlock: BigInt(chunk.toBlock),
    transactions: chunk.transactions.map((transaction) => ({
      ...transaction,
      blockNumber: BigInt(transaction.blockNumber),
    })),
  }
}

export async function writeDiscoveryChunk(
  scope: ScopeLocator,
  chunk: DiscoveryChunk,
  toBlockHash: Hex,
): Promise<string> {
  const dir = discoveryDir(scope)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, `${chunk.fromBlock}-${chunk.toBlock}.json`)
  const tmp = `${target}.tmp`
  await writeFile(tmp, `${JSON.stringify(stored(chunk, toBlockHash))}\n`)
  await rename(tmp, target)
  return target
}

export async function readDiscoveryChunks(
  scope: ScopeLocator,
  expectedFrom?: bigint,
): Promise<Array<{ chunk: DiscoveryChunk; toBlockHash: Hex }>> {
  const dir = discoveryDir(scope)
  let files: string[]
  try {
    files = (await readdir(dir))
      .filter((file) => /^\d+-\d+\.json$/.test(file))
      .sort((a, b) => {
        return Number(BigInt(a.split('-')[0]!) - BigInt(b.split('-')[0]!))
      })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const output: Array<{ chunk: DiscoveryChunk; toBlockHash: Hex }> = []
  let next = expectedFrom
  for (const file of files) {
    const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as StoredDiscoveryChunk
    const chunk = restored(parsed)
    if (next !== undefined && chunk.fromBlock !== next) {
      throw new Error(`non-contiguous discovery checkpoint at ${chunk.fromBlock}, expected ${next}`)
    }
    next = chunk.toBlock + 1n
    output.push({ chunk, toBlockHash: parsed.toBlockHash })
  }
  return output
}

export async function clearChainScope(scope: ScopeLocator): Promise<void> {
  await rm(chainScopeDir(scope), { recursive: true, force: true })
}
