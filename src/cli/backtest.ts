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
import { AzureBlobDownloader, type DownloadedBlob } from '../parquet/AzureBlobDownloader.js'
import { Semaphore } from '../utils/Semaphore.js'

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
  filePaths: string[]
  order?: 'recorded' | 'exchange_time'
  timeDriven?: boolean
  shouldStop?: () => boolean
  onSnapshot: (
    snapshot: MarketOrderBooksSnapshot,
    rawEvent: ReplayApplyEvent,
  ) => void | Promise<void>
}): Promise<void> {
  const filePaths = params.filePaths
  if (filePaths.length === 0)
    throw new Error('[backtest] replayOrderBookForMarket: filePaths is required')

  const order = params.order ?? 'recorded'
  const timeDriven = params.timeDriven ?? false

  const readers = await Promise.all(filePaths.map((p) => parquet.ParquetReader.openFile(p)))
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
  let downloader: AzureBlobDownloader | null = null
  const tempFiles: string[] = []

  // Statistics tracking
  type AzureStats = {
    totalBlobs: number
    downloadTimeMs: number
    processingTimeMs: number
  }
  let azureStats: AzureStats | null = null

  // Declare shared variables before Azure block
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

  const initialCapital = parseFloat(process.env.INITIAL_CAPITAL ?? '10000')
  const marketStats: MarketStats[] = []

  console.log(`[backtest] strategy=${built.strategyId}`)

  // Handle Azure Blob Storage mode
  if (parsed.useAzure) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!connectionString) {
      console.error('[backtest] ERROR: AZURE_STORAGE_CONNECTION_STRING environment variable not set')
      process.exit(2)
    }

    const containerName = parsed.azureContainer
    if (!containerName) {
      console.error('[backtest] ERROR: --azure-container is required when using --azure mode')
      process.exit(2)
    }

    downloader = new AzureBlobDownloader(connectionString)

    console.log(`[backtest] mode=azure container=${containerName} prefix=${parsed.azurePrefix || '(none)'}`)

    let blobNames: string[] = []

    // If blob names provided as arguments
    if (filePaths.length > 0) {
      blobNames = filePaths
    }
    // If using prefix-based discovery
    else if (parsed.azurePrefix) {
      const { BlobServiceClient } = await import('@azure/storage-blob')
      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
      const containerClient = blobServiceClient.getContainerClient(containerName)

      const blobs: string[] = []
      for await (const blob of containerClient.listBlobsFlat({ prefix: parsed.azurePrefix })) {
        if (blob.name.endsWith('.parquet')) {
          blobs.push(blob.name)
        }
        if (parsed.azureLimit && blobs.length >= parsed.azureLimit) {
          break
        }
      }

      console.log(`[backtest] found ${blobs.length} blobs`)
      blobNames = blobs
    } else {
      console.error('[backtest] ERROR: Either provide blob names or use --azure-prefix')
      process.exit(2)
    }

    if (blobNames.length === 0) {
      console.error('[backtest] ERROR: No blobs found to process')
      process.exit(2)
    }

    console.log(`[backtest] processing ${blobNames.length} blobs with parallel download pipeline...`)

    const pipelineStartTime = Date.now()
    let totalDownloadTime = 0
    let totalProcessingTime = 0

    // Result type for processFile (thread-safe, no shared state mutations)
    type FileStats = {
      events: number
      byType: Map<string, number>
      marketStat: MarketStats | null
      downloadTime: number
      processingTime: number
      tempFilePath: string
    }

    type ProcessTask = {
      blob: DownloadedBlob
      downloadTime: number
      index: number
    }

    const processFile = async (task: ProcessTask): Promise<FileStats> => {
      const { blob, downloadTime, index } = task
      const fp = blob.tempFilePath

      console.log(`[backtest] processing file ${index + 1}/${blobNames.length}: ${blob.originalBlobName}`)
      const processingStart = Date.now()

      // Local counters (thread-safe, no shared state)
      let localEvents = 0
      const localByType = new Map<string, number>()

      const active = mkRunner()
      const runner = active.runner

      // Parse slug and fetch market resolution
      const slug = parseSlugFromFilename(fp)
      const marketResolution = slug ? await getMarketResolution(slug) : null

      // Track market data during replay
      let currentMarketId: string | undefined
      let currentMarketTrades: Fill[] = []
      const seenFillIds = new Set<string>()

      // Replay orderbook
      await replayOrderBookForMarket({
        filePaths: [fp],
        order: parsed.order,
        timeDriven: parsed.timeDriven,
        shouldStop: () => shouldStop,
        onSnapshot: async (snap, raw) => {
          if (shouldStop) return

          // Local accumulation (no race conditions)
          localEvents += 1
          localByType.set(raw.msg.event_type, (localByType.get(raw.msg.event_type) ?? 0) + 1)

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

      // Compute stats
      let marketStat: MarketStats | null = null

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
          marketStat = computeMarketStats({
            marketId: currentMarketId,
            trades: currentMarketTrades,
            finalPositions,
            realizedPnl,
            finalOutcome: marketResolution.outcome,
            tokenMap: marketResolution.tokenMap,
          })

          console.log(
            `[backtest] market=${currentMarketId} slug=${slug} outcome=${marketStat.finalOutcome} pnl=${marketStat.pnl} trades=${marketStat.tradeCount}`,
          )
        } else if (marketResolution.outcome === null) {
          console.warn(`[backtest] Market not resolved yet for slug: ${slug}, skipping stats`)
        } else {
          console.log(`[backtest] market=${currentMarketId} no positions or trades, skipping stats`)
        }
      } else if (!slug) {
        console.warn(`[backtest] Could not parse slug from filename: ${fp}, skipping stats`)
      } else if (!marketResolution) {
        console.warn(`[backtest] Could not get market resolution for slug: ${slug}, skipping stats`)
      }

      const processingEnd = Date.now()
      const processingTime = processingEnd - processingStart
      console.log(`[backtest] file ${index + 1} processing took ${(processingTime / 1000).toFixed(2)}s`)

      // Return results instead of mutating globals
      return {
        events: localEvents,
        byType: localByType,
        marketStat,
        downloadTime,
        processingTime,
        tempFilePath: fp,
      }
    }

    // Configuration for parallel processing
    const DOWNLOAD_CONCURRENCY = parseInt(process.env.AZURE_DOWNLOAD_CONCURRENCY || '8')
    const PROCESS_CONCURRENCY = parseInt(process.env.PROCESS_CONCURRENCY || '2')
    const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10')

    console.log(`[backtest] parallel config: ${DOWNLOAD_CONCURRENCY} concurrent downloads, ${PROCESS_CONCURRENCY} concurrent processing, batch size ${BATCH_SIZE}`)

    // Collect all file stats for aggregation
    const allFileStats: FileStats[] = []
    const processSemaphore = new Semaphore(PROCESS_CONCURRENCY)

    // Process in batches to manage memory
    for (let batchStart = 0; batchStart < blobNames.length; batchStart += BATCH_SIZE) {
      if (shouldStop) break

      const batchEnd = Math.min(batchStart + BATCH_SIZE, blobNames.length)
      const batchNames = blobNames.slice(batchStart, batchEnd)

      console.log(`[backtest] ===== Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(blobNames.length / BATCH_SIZE)}: files ${batchStart + 1}-${batchEnd} =====`)

      // Phase 1: Download batch (8 concurrent downloads)
      console.log(`[backtest] downloading ${batchNames.length} files with ${DOWNLOAD_CONCURRENCY} concurrent connections...`)
      const batchDownloadStart = Date.now()

      const downloadPromises = batchNames.map((name, idx) =>
        downloader!.downloadToTempFile(containerName, name).then((blob) => ({
          blob,
          index: batchStart + idx,
          name,
        })),
      )

      const downloads = await Promise.all(downloadPromises)
      const batchDownloadTime = Date.now() - batchDownloadStart
      totalDownloadTime += batchDownloadTime

      console.log(`[backtest] batch download completed in ${(batchDownloadTime / 1000).toFixed(2)}s (${(batchDownloadTime / batchNames.length / 1000).toFixed(2)}s avg per file)`)

      // Phase 2: Process batch with concurrency limit (2-3 concurrent processing)
      console.log(`[backtest] processing ${batchNames.length} files with ${PROCESS_CONCURRENCY} concurrent workers...`)
      const batchProcessStart = Date.now()

      const processPromises = downloads.map(async ({ blob, index, name }) => {
        await processSemaphore.acquire()
        try {
          console.log(`[backtest] [worker] processing ${index + 1}/${blobNames.length}: ${name} (${processSemaphore.waiting()} waiting)`)
          return await processFile({ blob, downloadTime: 0, index })
        } finally {
          processSemaphore.release()
        }
      })

      const batchResults = await Promise.all(processPromises)
      const batchProcessTime = Date.now() - batchProcessStart
      totalProcessingTime += batchProcessTime

      console.log(`[backtest] batch processing completed in ${(batchProcessTime / 1000).toFixed(2)}s (${(batchProcessTime / batchNames.length / 1000).toFixed(2)}s avg per file)`)

      allFileStats.push(...batchResults)

      // Phase 3: Cleanup batch temp files immediately (free memory)
      console.log(`[backtest] cleaning up ${batchResults.length} temp files...`)
      await Promise.all(batchResults.map((r) => downloader!.cleanupTempFile(r.tempFilePath)))

      const batchTotalTime = Date.now() - batchDownloadStart
      console.log(`[backtest] batch ${Math.floor(batchStart / BATCH_SIZE) + 1} total time: ${(batchTotalTime / 1000).toFixed(2)}s\n`)
    }

    const pipelineEndTime = Date.now()

    // Aggregate stats from all processed files
    console.log(`[backtest] aggregating stats from ${allFileStats.length} files...`)

    // Total events
    events = allFileStats.reduce((sum, stat) => sum + stat.events, 0)

    // Merge event type counts
    for (const stat of allFileStats) {
      for (const [type, count] of stat.byType) {
        byType.set(type, (byType.get(type) ?? 0) + count)
      }
    }

    // Collect market stats (filter out null)
    const allMarketStats = allFileStats.map((stat) => stat.marketStat).filter((s): s is MarketStats => s !== null)
    marketStats.push(...allMarketStats)

    console.log(`[backtest] aggregated: ${events} events, ${byType.size} event types, ${allMarketStats.length} market stats`)

    azureStats = {
      totalBlobs: blobNames.length,
      downloadTimeMs: totalDownloadTime,
      processingTimeMs: totalProcessingTime,
    }

    console.log(`[backtest] pipeline completed in ${((pipelineEndTime - pipelineStartTime) / 1000).toFixed(2)}s`)
    console.log(`[backtest] total download: ${(totalDownloadTime / 1000).toFixed(2)}s, total processing: ${(totalProcessingTime / 1000).toFixed(2)}s`)
    console.log(`[backtest] speedup from parallelization: ${((totalDownloadTime + totalProcessingTime) / (pipelineEndTime - pipelineStartTime)).toFixed(2)}x`)

    // Set filePaths to empty to skip the regular processing loop
    filePaths = []
  }

  if (filePaths.length === 0 && !parsed.useAzure) {
    console.error(
      'Usage:\n' +
        '  Local files:\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '\n' +
        '  Azure Blob Storage (explicit files):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] --azure --azure-container <container> <blob1> [blob2 ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '\n' +
        '  Azure Blob Storage (auto-discover with prefix):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] --azure --azure-container <container> --azure-prefix <prefix> [--azure-limit <N>] [--order recorded|exchange_time] [--time-driven]\n' +
        '\n' +
        'Examples:\n' +
        '  tsx src/cli/backtest.ts --strategy hybrid_production --azure --azure-container markets-parquet --azure-prefix "data/events/btc/2025-12-22/" --azure-limit 5\n' +
        '  tsx src/cli/backtest.ts --strategy winner_limit --param threshold=0.03 --azure --azure-container markets-parquet "data/events/btc/2025-12-22/btc-updown-15m-1766364300.parquet"',
    )
    process.exit(2)
  }

  // For non-Azure mode, print file info and process files
  if (!parsed.useAzure && filePaths.length > 0) {
    console.log(`[backtest] mode=orderbook files=${filePaths.length}`)
    console.log(`[backtest] order=${parsed.order}`)
    console.log(`[backtest] timeDriven=${parsed.timeDriven}`)
  }

  // IMPORTANT: each parquet file corresponds to a single 15m market episode.
  // We replay them sequentially (do NOT heap-merge by ingest_seq across files).
  for (const fp of filePaths) {
    if (shouldStop) break
    console.log(`[backtest] orderbook replay file=${fp}`)
    const active = mkRunner()
    const runner = active.runner

    // Parse slug and fetch market resolution (tokenMap + outcome) in one call
    const slug = parseSlugFromFilename(fp)
    const marketResolution = slug ? await getMarketResolution(slug) : null

    // Track market data during replay
    let currentMarketId: string | undefined
    let currentMarketTrades: Fill[] = []
    const seenFillIds = new Set<string>()

    // Always replay - stats are optional
    await replayOrderBookForMarket({
      filePaths: [fp],
      order: parsed.order,
      timeDriven: parsed.timeDriven,
      shouldStop: () => shouldStop,
      onSnapshot: async (snap, raw) => {
        if (shouldStop) return
        events += 1
        byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)

        // Track market ID on first snapshot
        if (!currentMarketId) {
          currentMarketId = snap.market
        }

        await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })

        // Collect fills from portfolio (avoid duplicates)
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

    // Compute stats AFTER replay (only if we have all required data)
    if (slug && currentMarketId && marketResolution) {
      const portfolio = runner.getPortfolio().snapshot()
      const finalPositions = portfolio.positionsByAssetId
      const realizedPnl = portfolio.realizedPnlTotal ?? 0

      // Check if we have positions for this market
      const upAssetId = marketResolution.tokenMap['UP']
      const downAssetId = marketResolution.tokenMap['DOWN']
      const hasPositions =
        (upAssetId && finalPositions[upAssetId] && finalPositions[upAssetId]!.qty > 0) ||
        (downAssetId && finalPositions[downAssetId] && finalPositions[downAssetId]!.qty > 0)

      if ((hasPositions || currentMarketTrades.length > 0) && marketResolution.outcome !== null) {
        const stats = computeMarketStats({
          marketId: currentMarketId,
          trades: currentMarketTrades,
          finalPositions,
          realizedPnl,
          finalOutcome: marketResolution.outcome,
          tokenMap: marketResolution.tokenMap,
        })

        marketStats.push(stats)
        console.log(
          `[backtest] market=${currentMarketId} slug=${slug} outcome=${stats.finalOutcome} pnl=${stats.pnl} trades=${stats.tradeCount}`,
        )
      } else if (marketResolution.outcome === null) {
        console.warn(
          `[backtest] Market not resolved yet for slug: ${slug}, skipping stats`,
        )
      } else {
        console.log(`[backtest] market=${currentMarketId} no positions or trades, skipping stats`)
      }
    } else if (!slug) {
      console.warn(`[backtest] Could not parse slug from filename: ${fp}, skipping stats`)
    } else if (!marketResolution) {
      console.warn(`[backtest] Could not get market resolution for slug: ${slug}, skipping stats`)
    }
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

  // Print Azure statistics
  if (azureStats) {
    const totalTimeMs = azureStats.downloadTimeMs + azureStats.processingTimeMs
    console.log('\n[backtest] ===== AZURE BLOB STATISTICS =====')
    console.log(JSON.stringify({
      totalBlobs: azureStats.totalBlobs,
      downloadTimeSeconds: (azureStats.downloadTimeMs / 1000).toFixed(2),
      processingTimeSeconds: (azureStats.processingTimeMs / 1000).toFixed(2),
      totalTimeSeconds: (totalTimeMs / 1000).toFixed(2),
      averageDownloadPerBlobMs: (azureStats.downloadTimeMs / azureStats.totalBlobs).toFixed(0),
      averageProcessingPerBlobMs: (azureStats.processingTimeMs / azureStats.totalBlobs).toFixed(0),
    }, null, 2))
  }

  // Cleanup Azure temporary files
  if (tempFiles.length > 0 && downloader) {
    console.log('\n[backtest] cleaning up Azure temporary files...')
    for (const tempFile of tempFiles) {
      await downloader.cleanupTempFile(tempFile)
    }
    console.log('[backtest] cleanup completed')
  }
}

main().catch((err) => {
  console.error('[backtest] failed', err)
  process.exit(1)
})
