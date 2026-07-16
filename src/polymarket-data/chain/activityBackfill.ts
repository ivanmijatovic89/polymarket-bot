#!/usr/bin/env tsx
import '../../config/env.js'
import { closeDb } from '../../db/index.js'
import type { Timeframe } from '../marketSeries.js'
import { assertStorageHeadroom, formatGiB } from '../storage/disk.js'
import { discoverActivity } from './activityDiscovery.js'
import { publishActivity, readActivityCheckpoints, writeActivityChunk } from './activityParquet.js'
import { firstBlockAtOrAfter } from './blockRange.js'
import type { ScopeLocator } from './checkpoints.js'
import { ChainRpcClient } from './rpc.js'
import { loadChainMarketScope } from './scope.js'

const LABEL = '[polymarket-data:chain:activity]'
const TIMEFRAMES = new Set<Timeframe>(['5m', '15m', '1h', '4h', '1d'])

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function args(): ScopeLocator & { maxChunks: number | null } {
  const date = value('--date')
  const symbol = value('--symbol')?.toLowerCase()
  const timeframe = value('--timeframe') as Timeframe | undefined
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date YYYY-MM-DD is required')
  if (!symbol || !/^[a-z0-9]+$/.test(symbol)) throw new Error('--symbol is required')
  if (!timeframe || !TIMEFRAMES.has(timeframe)) throw new Error('--timeframe is invalid')
  const maxChunksRaw = value('--max-chunks')
  const maxChunks = maxChunksRaw === undefined ? null : Number(maxChunksRaw)
  if (maxChunks !== null && (!Number.isSafeInteger(maxChunks) || maxChunks < 1)) {
    throw new Error('--max-chunks must be an integer >= 1')
  }
  return { date, symbol, timeframe, maxChunks }
}

async function sameBlock(
  primary: ChainRpcClient,
  secondary: ChainRpcClient,
  number: bigint,
  expected?: string,
): Promise<string> {
  const [a, b] = await Promise.all([primary.block(number), secondary.block(number)])
  if (a.hash.toLowerCase() !== b.hash.toLowerCase()) {
    throw new Error(`providers disagree on activity block ${number}`)
  }
  if (expected && a.hash.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`activity checkpoint block ${number} changed`)
  }
  return a.hash
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

async function main(): Promise<void> {
  const locator = args()
  const free = await assertStorageHeadroom()
  const fromMs = Date.parse(`${locator.date}T00:00:00Z`)
  const scope = await loadChainMarketScope({
    symbol: locator.symbol,
    timeframe: locator.timeframe as Timeframe,
    fromMs,
    toMs: fromMs + 24 * 60 * 60_000,
  })
  const primary = new ChainRpcClient({
    url:
      process.env.POLYGON_ACTIVITY_RPC_URL_PRIMARY?.trim() ||
      'https://tenderly.rpc.polygon.community',
    timeoutMs: 180_000,
    maxAttempts: 20,
  })
  const secondary = new ChainRpcClient({
    url: process.env.POLYGON_ACTIVITY_RPC_URL_SECONDARY?.trim() || 'https://polygon.drpc.org',
    timeoutMs: 180_000,
    maxAttempts: 20,
  })
  const [fromBlock, afterBlock] = await Promise.all([
    firstBlockAtOrAfter(primary, BigInt(Math.floor(scope.scanFromMs / 1000))),
    firstBlockAtOrAfter(primary, BigInt(Math.ceil(scope.scanToMs / 1000))),
  ])
  const toBlock = afterBlock - 1n
  await Promise.all([
    sameBlock(primary, secondary, fromBlock),
    sameBlock(primary, secondary, toBlock),
  ])
  const stored = await readActivityCheckpoints(locator, fromBlock)
  const last = stored.at(-1)
  if (last) await sameBlock(primary, secondary, BigInt(last.toBlock), last.toBlockHash)
  const nextBlock = last ? BigInt(last.toBlock) + 1n : fromBlock
  const requestedTo =
    locator.maxChunks === null
      ? toBlock
      : nextBlock + 1_000n * BigInt(locator.maxChunks) - 1n > toBlock
        ? toBlock
        : nextBlock + 1_000n * BigInt(locator.maxChunks) - 1n
  console.log(
    `${LABEL} scope=${locator.symbol}/${locator.timeframe}/${locator.date} ` +
      `markets=${scope.markets.length} blocks=${fromBlock}-${toBlock} ` +
      `resume_chunks=${stored.length} free=${formatGiB(free)}`,
  )
  const startedAt = Date.now()
  if (nextBlock <= requestedTo) {
    await discoverActivity(primary, secondary, {
      fromBlock: nextBlock,
      toBlock: requestedTo,
      markets: scope.markets.map((market) => ({
        marketId: market.id,
        conditionId: market.conditionId,
      })),
      tokens: scope.tokens,
      includeStandard: scope.markets.some((market) => !market.negativeRisk),
      includeNegativeRisk: scope.markets.some((market) => market.negativeRisk),
      primaryStep: 100n,
      secondaryStep: 100n,
      verificationChunk: 1_000n,
      concurrency: 1,
      retainResults: false,
      onChunk: async (chunk, progress) => {
        const hash = await sameBlock(primary, secondary, chunk.toBlock)
        await writeActivityChunk(locator, chunk, hash)
        await assertStorageHeadroom()
        const percent = Number((progress.completedBlocks * 10_000n) / progress.totalBlocks) / 100
        console.log(
          `${LABEL} ${percent.toFixed(1)}% blocks=${chunk.fromBlock}-${chunk.toBlock} ` +
            `logs=${progress.allLogs} rows=${progress.targetRows} ` +
            `requests=${progress.primary.httpRequests + progress.secondary.httpRequests} ` +
            `retries=${progress.primary.retries + progress.secondary.retries} ` +
            `download=${mb(progress.primary.responseBytes + progress.secondary.responseBytes)} ` +
            `elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        )
      },
    })
  }
  const complete = await readActivityCheckpoints(locator, fromBlock)
  const through = complete.at(-1) ? BigInt(complete.at(-1)!.toBlock) : fromBlock - 1n
  if (through < toBlock) {
    console.log(`${LABEL} checkpointed through ${through}; ${toBlock - through} blocks remain`)
    return
  }
  if (through !== toBlock) throw new Error(`activity stopped at ${through}, expected ${toBlock}`)
  const published = await publishActivity(locator)
  console.log(`${LABEL} published ${complete.length} verified chunks to ${published}`)
}

main()
  .then(async () => closeDb())
  .catch(async (error) => {
    console.error(`${LABEL} ${(error as Error).message}`)
    await closeDb().catch(() => {})
    process.exit(1)
  })
