#!/usr/bin/env tsx
import '../../config/env.js'
import { closeDb } from '../../db/index.js'
import { assertStorageHeadroom, formatGiB } from '../storage/disk.js'
import { firstBlockAtOrAfter } from './blockRange.js'
import { readDiscoveryChunks, writeDiscoveryChunk, type ScopeLocator } from './checkpoints.js'
import { discoverMatchedTransactions } from './discovery.js'
import {
  buildMarketCandidates,
  completedReceiptTransactions,
  writeReceiptBatchParquet,
} from './parquet.js'
import { verifyDiscoveredReceipts } from './receipts.js'
import { ChainRpcClient } from './rpc.js'
import { loadChainMarketScope } from './scope.js'
import type { Timeframe } from '../marketSeries.js'
import { verifyChainCandidates } from './verification.js'

const LABEL = '[polymarket-data:chain:backfill]'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIMEFRAMES = new Set<Timeframe>(['5m', '15m', '1h', '4h', '1d'])

type Args = ScopeLocator & {
  maxChunks: number | null
  discoveryOnly: boolean
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

function parseArgs(argv: string[]): Args {
  const date = option(argv, '--date')
  const symbol = option(argv, '--symbol')?.toLowerCase()
  const timeframe = option(argv, '--timeframe') as Timeframe | undefined
  if (
    !date ||
    !DATE_RE.test(date) ||
    Date.parse(`${date}T00:00:00Z`) !== Date.parse(`${date}T00:00:00.000Z`)
  ) {
    throw new Error('usage: --date YYYY-MM-DD --symbol btc --timeframe 5m')
  }
  if (!symbol || !/^[a-z0-9]+$/.test(symbol)) throw new Error('--symbol is required')
  if (!timeframe || !TIMEFRAMES.has(timeframe))
    throw new Error('--timeframe must be 5m, 15m, 1h, 4h, or 1d')
  const rawMaxChunks = option(argv, '--max-chunks')
  const maxChunks = rawMaxChunks === undefined ? null : Number(rawMaxChunks)
  if (maxChunks !== null && (!Number.isSafeInteger(maxChunks) || maxChunks < 1)) {
    throw new Error('--max-chunks must be an integer >= 1')
  }
  const known = new Set([
    '--date',
    date,
    '--symbol',
    symbol,
    '--timeframe',
    timeframe,
    '--max-chunks',
    rawMaxChunks,
    '--discovery-only',
  ])
  const unknown = argv.filter((value) => !known.has(value))
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(', ')}`)
  return { date, symbol, timeframe, maxChunks, discoveryOnly: argv.includes('--discovery-only') }
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function elapsed(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

async function assertSameBlock(
  primary: ChainRpcClient,
  secondary: ChainRpcClient,
  number: bigint,
  expectedHash?: string,
): Promise<string> {
  const [a, b] = await Promise.all([primary.block(number), secondary.block(number)])
  if (
    a.number.toLowerCase() !== b.number.toLowerCase() ||
    a.hash.toLowerCase() !== b.hash.toLowerCase() ||
    a.timestamp.toLowerCase() !== b.timestamp.toLowerCase()
  ) {
    throw new Error(`RPC providers disagree on block ${number}`)
  }
  if (expectedHash && a.hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`checkpoint block ${number} changed from ${expectedHash} to ${a.hash}`)
  }
  return a.hash
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const primaryUrl = process.env.POLYGON_RPC_URL
  if (!primaryUrl) throw new Error('POLYGON_RPC_URL is required')
  const secondaryUrl = process.env.POLYGON_RPC_URL_SECONDARY?.trim() || 'https://polygon.drpc.org'
  if (primaryUrl === secondaryUrl)
    throw new Error('primary and secondary RPC URLs must be independent')
  const free = await assertStorageHeadroom()
  const fromMs = Date.parse(`${args.date}T00:00:00Z`)
  const toMs = fromMs + 24 * 60 * 60_000
  const scope = await loadChainMarketScope({
    symbol: args.symbol,
    timeframe: args.timeframe as Timeframe,
    fromMs,
    toMs,
  })
  const primary = new ChainRpcClient({ url: primaryUrl, timeoutMs: 120_000, maxAttempts: 8 })
  const secondary = new ChainRpcClient({ url: secondaryUrl, timeoutMs: 120_000, maxAttempts: 8 })
  const [fromBlock, afterBlock] = await Promise.all([
    firstBlockAtOrAfter(primary, BigInt(Math.floor(scope.scanFromMs / 1000))),
    firstBlockAtOrAfter(primary, BigInt(Math.ceil(scope.scanToMs / 1000))),
  ])
  const toBlock = afterBlock - 1n
  await Promise.all([
    assertSameBlock(primary, secondary, fromBlock),
    assertSameBlock(primary, secondary, toBlock),
  ])
  console.log(
    `${LABEL} scope=${args.symbol}/${args.timeframe}/${args.date} markets=${scope.markets.length} ` +
      `tokens=${scope.tokens.length} blocks=${fromBlock}-${toBlock} (${toBlock - fromBlock + 1n}) ` +
      `scan=${new Date(scope.scanFromMs).toISOString()}..${new Date(scope.scanToMs).toISOString()} ` +
      `free=${formatGiB(free)}`,
  )

  const stored = await readDiscoveryChunks(args, fromBlock)
  if (stored.length > 0) {
    const last = stored.at(-1)!
    if (last.chunk.toBlock > toBlock) throw new Error('discovery checkpoint extends past scope')
    await assertSameBlock(primary, secondary, last.chunk.toBlock, last.toBlockHash)
    console.log(
      `${LABEL} resume discovery chunks=${stored.length} next_block=${last.chunk.toBlock + 1n}`,
    )
  }
  const previous = stored.at(-1)
  const nextBlock = previous ? previous.chunk.toBlock + 1n : fromBlock
  const verificationChunk = 1_000n
  const requestedTo =
    args.maxChunks === null
      ? toBlock
      : nextBlock + verificationChunk * BigInt(args.maxChunks) - 1n > toBlock
        ? toBlock
        : nextBlock + verificationChunk * BigInt(args.maxChunks) - 1n
  const startedAt = Date.now()
  if (nextBlock <= requestedTo) {
    await discoverMatchedTransactions(primary, secondary, {
      fromBlock: nextBlock,
      toBlock: requestedTo,
      tokens: scope.tokens,
      verificationChunk,
      concurrency: 4,
      onChunk: async (chunk, progress) => {
        const toBlockHash = await assertSameBlock(primary, secondary, chunk.toBlock)
        await writeDiscoveryChunk(args, chunk, toBlockHash as `0x${string}`)
        const percent = Number((progress.completedBlocks * 10_000n) / progress.totalBlocks) / 100
        console.log(
          `${LABEL} discovery ${percent.toFixed(1)}% blocks=${chunk.fromBlock}-${chunk.toBlock} ` +
            `all_logs=${progress.allLogs} target_txs=${progress.targetTransactions} ` +
            `requests=${progress.primary.httpRequests + progress.secondary.httpRequests} ` +
            `retries=${progress.primary.retries + progress.secondary.retries} ` +
            `rate_limits=${progress.primary.rateLimits + progress.secondary.rateLimits} ` +
            `timeouts=${progress.primary.timeouts + progress.secondary.timeouts} ` +
            `download=${mb(progress.primary.responseBytes + progress.secondary.responseBytes)} ` +
            `elapsed=${elapsed(startedAt)}`,
        )
      },
    })
  }
  const allCheckpoints = await readDiscoveryChunks(args, fromBlock)
  const discoveredThrough = allCheckpoints.at(-1)?.chunk.toBlock ?? fromBlock - 1n
  if (discoveredThrough < toBlock) {
    console.log(
      `${LABEL} discovery checkpointed through ${discoveredThrough}; ` +
        `${toBlock - discoveredThrough} blocks remain`,
    )
    return
  }
  const discovery = allCheckpoints.flatMap(({ chunk }) => chunk.transactions)
  console.log(
    `${LABEL} discovery complete chunks=${allCheckpoints.length} matched_logs=${discovery.length} ` +
      `unique_txs=${new Set(discovery.map((row) => row.transactionHash)).size}`,
  )
  if (args.discoveryOnly) return

  const completed = await completedReceiptTransactions(args)
  const remaining = discovery.filter((row) => !completed.has(row.transactionHash.toLowerCase()))
  console.log(
    `${LABEL} receipt resume complete=${completed.size} remaining_txs=` +
      `${new Set(remaining.map((row) => row.transactionHash)).size}`,
  )
  let batches = 0
  await verifyDiscoveredReceipts(primary, secondary, remaining, {
    tokens: scope.tokens,
    batchSize: 25,
    concurrency: 2,
    retainResults: false,
    onBatch: async (receipts, progress) => {
      await writeReceiptBatchParquet(args, receipts)
      batches += 1
      if (batches % 20 === 0) await assertStorageHeadroom()
      const percent = progress.total === 0 ? 100 : (progress.completed / progress.total) * 100
      console.log(
        `${LABEL} receipts ${percent.toFixed(1)}% txs=${progress.completed}/${progress.total} ` +
          `trades=${progress.trades} requests=${progress.primary.httpRequests + progress.secondary.httpRequests} ` +
          `retries=${progress.primary.retries + progress.secondary.retries} ` +
          `rate_limits=${progress.primary.rateLimits + progress.secondary.rateLimits} ` +
          `timeouts=${progress.primary.timeouts + progress.secondary.timeouts} ` +
          `download=${mb(progress.primary.responseBytes + progress.secondary.responseBytes)} ` +
          `elapsed=${elapsed(startedAt)}`,
      )
    },
  })
  const finalCompleted = await completedReceiptTransactions(args)
  const expected = new Set(discovery.map((row) => row.transactionHash.toLowerCase()))
  const missing = [...expected].filter((hash) => !finalCompleted.has(hash))
  if (missing.length > 0)
    throw new Error(`${missing.length} discovered receipts were not checkpointed`)
  console.log(
    `${LABEL} receipt extraction complete txs=${expected.size} ` +
      `download=${mb(primary.metrics.responseBytes + secondary.metrics.responseBytes)} ` +
      `elapsed=${elapsed(startedAt)}`,
  )
  const candidateFiles = await buildMarketCandidates(args, scope.markets)
  console.log(`${LABEL} built ${candidateFiles.length} per-market chain candidates`)
  const verification = await verifyChainCandidates(args, scope.markets)
  console.log(
    `${LABEL} verification passed=${verification.report.passedMarkets}/` +
      `${verification.report.markets} report=${verification.path}`,
  )
  if (!verification.report.passed) {
    const failures = verification.report.results
      .filter((result) => !result.passed)
      .slice(0, 5)
      .map(
        (result) =>
          `${result.slug}(chain=${result.chainRows},api=${result.apiRows},` +
          `api_missing=${result.missingFromApi}/${result.missingFromChain},` +
          `gamma_drift=${result.gammaDriftShares})`,
      )
    throw new Error(`chain candidates failed verification: ${failures.join(', ')}`)
  }
}

main()
  .then(async () => closeDb())
  .catch(async (error) => {
    console.error(`${LABEL} ${(error as Error).message}`)
    await closeDb().catch(() => {})
    process.exit(1)
  })
