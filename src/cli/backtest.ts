import 'dotenv/config'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import * as parquet from '@dsnp/parquetjs'
import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type { AnyMarketMessage } from '../market/orderbook/index.js'
import { MarketEngine } from '../market/MarketEngine.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import { OrderManager } from '../trading/OrderManager.js'
import { BacktestExecution } from '../trading/execution/BacktestExecution.js'
import { getStrategyDefinition } from '../strategy/strategyRegistry.js'
import type { Strategy } from '../strategy/Strategy.js'
import { buildStrategyFromCliArgs, printCliArgsError } from './helpers/strategyArgs.js'
import { parseArgs } from './helpers/backtestArgs.js'
import { sleep } from '../utils/sleep.js'
import { toBigInt } from '../utils/toBigInt.js'
import { MinHeap } from '../utils/minHeap.js'
import { computeMarketStats } from '../backtest/stats/marketStats.js'
import { computeBatchStats } from '../backtest/stats/batchStats.js'
import type { MarketStats } from '../backtest/stats/marketStats.js'
import { parseSlugFromFilename, getMarketResolution } from '../backtest/stats/marketResolution.js'
import type { Fill } from '../strategy/Strategy.js'
import { listAzureBlobs } from '../parquet/listAzureBlobs.js'
import { openParquetFromAzureBlobBatched } from '../parquet/AzureBlobStreamReader.js'

installProcessCrashHandlers({ prefix: 'backtest' })

type ReplayRow = {
  ingest_seq?: unknown
  ts_local_ms?: unknown
  ts_exchange_ms?: unknown
  event_type?: unknown
  raw_json?: unknown
}

type ReplayApplyEvent = {
  msg: AnyMarketMessage
  rawJson: string
  market: string
  source: { kind: 'parquet'; filePath: string; ingestSeq: bigint }
}

/**
 * Replay parquet WS events and reconstruct order books tick-by-tick.
 *
 * The market is auto-detected from the first decoded event.
 * All assets within that market are replayed (e.g. both tokens).
 */
export async function replayOrderBookForMarket(params: {
  filePaths?: string[]
  readers?: parquet.ParquetReader[]
  order?: 'recorded' | 'exchange_time'
  timeDriven?: boolean
  shouldStop?: () => boolean
  onSnapshot: (
    snapshot: MarketOrderBooksSnapshot,
    rawEvent: ReplayApplyEvent,
  ) => void | Promise<void>
}): Promise<void> {
  const filePaths = params.filePaths ?? []
  if (filePaths.length === 0 && !params.readers)
    throw new Error('[backtest] replayOrderBookForMarket: filePaths or readers is required')

  const order = params.order ?? 'recorded'
  const timeDriven = params.timeDriven ?? false

  const readers = params.readers ?? await Promise.all(filePaths.map((p) => parquet.ParquetReader.openFile(p)))
  try {
    const cursors = readers.map((r) => r.getCursor())

    const heap = new MinHeap()
    for (let i = 0; i < cursors.length; i += 1) {
      const row = (await cursors[i]!.next()) as ReplayRow | null
      if (!row) continue
      const tsLocal = toBigInt(row.ts_local_ms, 0n)
      const tsEx = toBigInt(row.ts_exchange_ms, tsLocal)
      const keyTs = order === 'exchange_time' ? tsEx : tsLocal
      const keySeq = toBigInt(row.ingest_seq, 0n)
      heap.push({ fileIdx: i, row, keySeq, keyTs })
    }

    let activeMarket: string | undefined

    const eng = new MarketEngine()

    let prevKeyTs: bigint | undefined
    while (true) {
      if (params.shouldStop?.()) break
      const item = heap.pop()
      if (!item) break

      if (timeDriven) {
        if (prevKeyTs !== undefined && item.keyTs >= prevKeyTs) {
          const delta = item.keyTs - prevKeyTs
          const ms = Number(delta > 10_000n ? 10_000n : delta)
          await sleep(ms)
        }
        prevKeyTs = item.keyTs
      }

      const row = item.row
      const rowEventType = typeof row.event_type === 'string' ? row.event_type : undefined
      const rawJson =
        typeof row.raw_json === 'string' ? row.raw_json : JSON.stringify(row.raw_json ?? null)
      const ingestSeq = toBigInt(row.ingest_seq, 0n)
      const filePath = filePaths[item.fileIdx] ?? '(unknown)'

      // Fast-path skip for non-market-channel types without JSON parse.
      if (
        rowEventType &&
        rowEventType !== 'book' &&
        rowEventType !== 'price_change' &&
        rowEventType !== 'tick_size_change' &&
        rowEventType !== 'last_trade_price'
      ) {
        // skip
      } else {
        const msg = await eng.handleRaw({
          rawJson,
          source: { kind: 'parquet', filePath, ingestSeq },
        })
        if (msg) {
          const market = msg.market
          if (!activeMarket) activeMarket = market
          if (activeMarket === market) {
            // Only run strategy ticks on book+price_change (per project rules).
            if (msg.event_type === 'book' || msg.event_type === 'price_change') {
              await params.onSnapshot(eng.snapshot(), {
                msg,
                rawJson,
                market: activeMarket,
                source: { kind: 'parquet', filePath, ingestSeq },
              })
            }
          }
        }
      }

      const next = (await cursors[item.fileIdx]!.next()) as ReplayRow | null
      if (next) {
        const tsLocal = toBigInt(next.ts_local_ms, 0n)
        const tsEx = toBigInt(next.ts_exchange_ms, tsLocal)
        const keyTs = order === 'exchange_time' ? tsEx : tsLocal
        const keySeq = toBigInt(next.ingest_seq, 0n)
        heap.push({ fileIdx: item.fileIdx, row: next, keySeq, keyTs })
      }
    }
  } finally {
    await Promise.all(readers.map((r) => r.close().catch(() => undefined)))
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)
  const built = (() => {
    try {
      return buildStrategyFromCliArgs({ argv: args, script: 'backtest' })
    } catch (err) {
      printCliArgsError({ script: 'backtest', err })
      process.exit(2)
    }
  })()
  let filePaths = parsed.filePaths

  // If --symbol is provided with --azure-blob, list files automatically
  if (parsed.symbol && parsed.azureBlob) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!connectionString) {
      console.error('[backtest] AZURE_STORAGE_CONNECTION_STRING environment variable is required when using --azure-blob')
      process.exit(2)
    }
    if (!parsed.azureContainer) {
      console.error('[backtest] --azure-container is required when using --azure-blob')
      process.exit(2)
    }

    console.log(`[backtest] listing files for symbol=${parsed.symbol} limit=${parsed.limit ?? 'all'}`)
    try {
      filePaths = await listAzureBlobs({
        connectionString,
        containerName: parsed.azureContainer,
        symbol: parsed.symbol,
        limit: parsed.limit
      })
      console.log(`[backtest] found ${filePaths.length} files`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backtest] failed to list blobs: ${msg}`)
      process.exit(2)
    }
  }

  if (filePaths.length === 0) {
    console.error(
      'Usage:\n' +
        '  Orderbook replay (default):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '  Azure Blob Storage (with explicit files):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] --azure-blob --azure-container <container> <blob1> [blob2 ...]\n' +
        '  Azure Blob Storage (with symbol):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] --azure-blob --azure-container <container> --symbol <symbol> [--limit N]\n' +
        '    Requires AZURE_STORAGE_CONNECTION_STRING environment variable',
    )
    process.exit(2)
  }

  // Azure Blob Storage configuration
  const useAzureStreaming = parsed.azureBlob
  let azureConnectionString: string | undefined
  let azureContainerName: string | undefined

  if (useAzureStreaming) {
    azureConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!azureConnectionString) {
      console.error('[backtest] AZURE_STORAGE_CONNECTION_STRING environment variable is required when using --azure-blob')
      process.exit(2)
    }
    if (!parsed.azureContainer) {
      console.error('[backtest] --azure-container is required when using --azure-blob')
      process.exit(2)
    }
    azureContainerName = parsed.azureContainer

    console.log(`[backtest] streaming ${filePaths.length} files from Azure Blob Storage (batched download & process)`)
    console.log(`[backtest] container=${azureContainerName}`)
  }

  const fileCount = filePaths.length
  console.log(`[backtest] mode=orderbook files=${fileCount}`)
  console.log(`[backtest] order=${parsed.order}`)
  console.log(`[backtest] timeDriven=${parsed.timeDriven}`)
  console.log(`[backtest] azureBlob=${parsed.azureBlob} (streaming=${useAzureStreaming})`)

  let shouldStop = false
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[backtest] ${signal} received, stopping...`)
    shouldStop = true
  }
  installSignalHandlers({ onSignal: shutdown })

  let events = 0
  const byType = new Map<string, number>()

  const mkRunner = (): {
    strategy: Strategy
    runner: StrategyRunner
  } => {
    const def = getStrategyDefinition(built.strategyId)
    const strategy = def.create(built.params as never)
    const exec = new BacktestExecution()
    const orderManager = new OrderManager({
      execution: exec,
      dryRun: false,
      log: (msg, extra) => console.log(msg, extra ?? ''),
    })
    const runner = new StrategyRunner({
      strategy,
      orderManager,
      log: (msg, extra) => console.log(msg, extra ?? ''),
    })
    return { strategy, runner }
  }

  console.log(`[backtest] strategy=${built.strategyId}`)

  // Stats tracking
  const initialCapital = parseFloat(process.env.INITIAL_CAPITAL ?? '10000')
  const marketStats: MarketStats[] = []

  // IMPORTANT: each parquet file corresponds to a single 15m market episode.
  // We replay them sequentially (do NOT heap-merge by ingest_seq across files).
  try {
    // Azure streaming: download and process files in parallel
    // Local files: process directly from disk in parallel
    if (useAzureStreaming && azureConnectionString && azureContainerName) {
      // Parallel processing with controlled concurrency
      const concurrency = parseInt(process.env.AZURE_CONCURRENCY ?? '10', 10)
      console.log(`[backtest] processing ${filePaths.length} files with concurrency=${concurrency}`)

      const overallStartTime = Date.now()

      // Process files in parallel with concurrency limit
      const processFile = async (blobName: string, index: number) => {
        const progress = `[${index + 1}/${filePaths.length}]`
        console.log(`${progress} [backtest] downloading & processing: ${blobName}`)

        // Download and open the file
        const fileStartTime = Date.now()
        const reader = await openParquetFromAzureBlobBatched(
          azureConnectionString!,
          azureContainerName!,
          [blobName],
          1
        ).next().then(result => result.value?.reader)

        if (!reader) {
          console.warn(`${progress} [backtest] failed to open: ${blobName}`)
          return null
        }

        const downloadTime = ((Date.now() - fileStartTime) / 1000).toFixed(2)

        const active = mkRunner()
        const runner = active.runner

        // Parse slug and fetch market resolution
        const slug = parseSlugFromFilename(blobName)
        const marketResolution = slug ? await getMarketResolution(slug) : null

        // Track market data during replay
        let currentMarketId: string | undefined
        let currentMarketTrades: Fill[] = []
        const seenFillIds = new Set<string>()
        let localEvents = 0

        // Process with pre-opened reader
        const processStartTime = Date.now()
        await replayOrderBookForMarket({
          readers: [reader],
          order: parsed.order,
          timeDriven: parsed.timeDriven,
          shouldStop: () => shouldStop,
          onSnapshot: async (snap, raw) => {
            if (shouldStop) return
            localEvents++
            events += 1
            byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)

            if (!currentMarketId) {
              currentMarketId = snap.market
            }

            await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })

            if (currentMarketId) {
              const portfolio = runner.getPortfolio().snapshot()
              for (const fill of portfolio.recentFills) {
                if (fill.market === currentMarketId && !seenFillIds.has(fill.id)) {
                  currentMarketTrades.push(fill)
                  seenFillIds.add(fill.id)
                }
              }
            }
          },
        })

        // Close reader immediately after processing
        await reader.close().catch(() => undefined)

        const processTime = ((Date.now() - processStartTime) / 1000).toFixed(2)
        const totalTime = ((Date.now() - fileStartTime) / 1000).toFixed(2)

        // Compute stats AFTER replay
        let stats: MarketStats | null = null
        if (slug && currentMarketId && marketResolution) {
          const portfolio = runner.getPortfolio().snapshot()
          const finalPositions = portfolio.positionsByAssetId
          const realizedPnl = portfolio.realizedPnlTotal ?? 0

          const upAssetId = marketResolution.tokenMap['UP']
          const downAssetId = marketResolution.tokenMap['DOWN']
          const hasPositions =
            (upAssetId && finalPositions[upAssetId] && finalPositions[upAssetId]!.qty > 0) ||
            (downAssetId && finalPositions[downAssetId] && finalPositions[downAssetId]!.qty > 0)

          if ((hasPositions || currentMarketTrades.length > 0) && marketResolution.outcome !== null) {
            stats = computeMarketStats({
              marketId: currentMarketId,
              trades: currentMarketTrades,
              finalPositions,
              realizedPnl,
              finalOutcome: marketResolution.outcome,
              tokenMap: marketResolution.tokenMap,
            })

            console.log(
              `${progress} [backtest] ✓ market=${currentMarketId} slug=${slug} pnl=${stats.pnl} trades=${stats.tradeCount} (dl=${downloadTime}s proc=${processTime}s total=${totalTime}s events=${localEvents})`,
            )
          } else if (marketResolution.outcome === null) {
            console.warn(`${progress} [backtest] Market not resolved yet for slug: ${slug}`)
          } else {
            console.log(`${progress} [backtest] ✓ no positions/trades (${totalTime}s)`)
          }
        } else if (!slug) {
          console.warn(`${progress} [backtest] Could not parse slug from: ${blobName}`)
        }

        return stats
      }

      // Run with controlled concurrency
      const results: (MarketStats | null)[] = []
      for (let i = 0; i < filePaths.length; i += concurrency) {
        if (shouldStop) break
        const batch = filePaths.slice(i, i + concurrency)
        const batchResults = await Promise.all(
          batch.map((blobName, batchIndex) => processFile(blobName, i + batchIndex))
        )
        results.push(...batchResults)
      }

      // Collect non-null stats
      marketStats.push(...results.filter((s): s is MarketStats => s !== null))

      const overallElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(2)
      console.log(`[backtest] ✓ processed ${filePaths.length} files in ${overallElapsed}s total (${(filePaths.length / parseFloat(overallElapsed)).toFixed(2)} files/sec)`)
    } else {
      // Local file processing - also parallel for speed
      const concurrency = parseInt(process.env.LOCAL_CONCURRENCY ?? '10', 10)
      console.log(`[backtest] processing ${filePaths.length} local files with concurrency=${concurrency}`)

      const overallStartTime = Date.now()

      const processFile = async (fp: string, index: number) => {
        const progress = `[${index + 1}/${filePaths.length}]`
        console.log(`${progress} [backtest] processing: ${fp}`)

        const fileStartTime = Date.now()
        const active = mkRunner()
        const runner = active.runner

        const slug = parseSlugFromFilename(fp)
        const marketResolution = slug ? await getMarketResolution(slug) : null

        let currentMarketId: string | undefined
        let currentMarketTrades: Fill[] = []
        const seenFillIds = new Set<string>()
        let localEvents = 0

        await replayOrderBookForMarket({
          filePaths: [fp],
          order: parsed.order,
          timeDriven: parsed.timeDriven,
          shouldStop: () => shouldStop,
          onSnapshot: async (snap, raw) => {
            if (shouldStop) return
            localEvents++
            events += 1
            byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)

            if (!currentMarketId) {
              currentMarketId = snap.market
            }

            await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })

            if (currentMarketId) {
              const portfolio = runner.getPortfolio().snapshot()
              for (const fill of portfolio.recentFills) {
                if (fill.market === currentMarketId && !seenFillIds.has(fill.id)) {
                  currentMarketTrades.push(fill)
                  seenFillIds.add(fill.id)
                }
              }
            }
          },
        })

        const totalTime = ((Date.now() - fileStartTime) / 1000).toFixed(2)

        // Compute stats AFTER replay
        let stats: MarketStats | null = null
        if (slug && currentMarketId && marketResolution) {
          const portfolio = runner.getPortfolio().snapshot()
          const finalPositions = portfolio.positionsByAssetId
          const realizedPnl = portfolio.realizedPnlTotal ?? 0

          const upAssetId = marketResolution.tokenMap['UP']
          const downAssetId = marketResolution.tokenMap['DOWN']
          const hasPositions =
            (upAssetId && finalPositions[upAssetId] && finalPositions[upAssetId]!.qty > 0) ||
            (downAssetId && finalPositions[downAssetId] && finalPositions[downAssetId]!.qty > 0)

          if ((hasPositions || currentMarketTrades.length > 0) && marketResolution.outcome !== null) {
            stats = computeMarketStats({
              marketId: currentMarketId,
              trades: currentMarketTrades,
              finalPositions,
              realizedPnl,
              finalOutcome: marketResolution.outcome,
              tokenMap: marketResolution.tokenMap,
            })

            console.log(
              `${progress} [backtest] ✓ market=${currentMarketId} slug=${slug} pnl=${stats.pnl} trades=${stats.tradeCount} (${totalTime}s events=${localEvents})`,
            )
          } else if (marketResolution.outcome === null) {
            console.warn(`${progress} [backtest] Market not resolved yet for slug: ${slug}`)
          } else {
            console.log(`${progress} [backtest] ✓ no positions/trades (${totalTime}s)`)
          }
        } else if (!slug) {
          console.warn(`${progress} [backtest] Could not parse slug from: ${fp}`)
        }

        return stats
      }

      // Run with controlled concurrency
      const results: (MarketStats | null)[] = []
      for (let i = 0; i < filePaths.length; i += concurrency) {
        if (shouldStop) break
        const batch = filePaths.slice(i, i + concurrency)
        const batchResults = await Promise.all(
          batch.map((fp, batchIndex) => processFile(fp, i + batchIndex))
        )
        results.push(...batchResults)
      }

      // Collect non-null stats
      marketStats.push(...results.filter((s): s is MarketStats => s !== null))

      const overallElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(2)
      console.log(`[backtest] ✓ processed ${filePaths.length} files in ${overallElapsed}s total (${(filePaths.length / parseFloat(overallElapsed)).toFixed(2)} files/sec)`)
    }

    // Compute batch stats
    if (marketStats.length > 0) {
      const batchStats = computeBatchStats(marketStats, initialCapital)

      // Print results
      console.log('\n[backtest] ===== MARKET STATS =====')
      for (const stats of marketStats) {
        console.log(JSON.stringify(stats, null, 2))
      }

      console.log('\n[backtest] ===== BATCH STATS =====')
      console.log(JSON.stringify(batchStats, null, 2))
    }

    console.log('\n[backtest] orderbook summary', {
      events,
      byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    })
  } finally {
    // Cleanup: readers are closed immediately after processing in batched mode
    // No cleanup needed here
  }
}

main().catch((err) => {
  console.error('[backtest] failed', err)
  process.exit(1)
})
