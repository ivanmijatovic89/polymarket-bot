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
import { AzureBlobDownloader } from '../parquet/AzureBlobDownloader.js'

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
  const filePaths = parsed.filePaths
  if (filePaths.length === 0) {
    console.error(
      'Usage:\n' +
        '  Orderbook replay (default):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '  Azure Blob Storage:\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] --azure-blob --azure-container <container> <blob1> [blob2 ...]\n' +
        '    Requires AZURE_STORAGE_CONNECTION_STRING environment variable',
    )
    process.exit(2)
  }

  // Handle Azure Blob Storage downloads
  let localFilePaths: string[] = filePaths
  let tempFiles: string[] = []
  let downloader: AzureBlobDownloader | undefined

  if (parsed.azureBlob) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!connectionString) {
      console.error('[backtest] AZURE_STORAGE_CONNECTION_STRING environment variable is required when using --azure-blob')
      process.exit(2)
    }
    if (!parsed.azureContainer) {
      console.error('[backtest] --azure-container is required when using --azure-blob')
      process.exit(2)
    }

    downloader = new AzureBlobDownloader(connectionString)
    console.log(`[backtest] downloading ${filePaths.length} files from Azure Blob Storage`)
    console.log(`[backtest] container=${parsed.azureContainer}`)

    try {
      localFilePaths = []
      for (const blobName of filePaths) {
        console.log(`[backtest] downloading blob: ${blobName}`)
        const tempPath = await downloader.downloadToTempFile(parsed.azureContainer, blobName)
        localFilePaths.push(tempPath)
        tempFiles.push(tempPath)
      }
      console.log(`[backtest] downloaded ${localFilePaths.length} files to temporary locations`)
    } catch (err) {
      console.error('[backtest] failed to download files from Azure Blob Storage:', err)
      // Cleanup any downloaded files
      if (downloader) {
        for (const tempPath of tempFiles) {
          await downloader.cleanupTempFile(tempPath).catch(() => undefined)
        }
      }
      process.exit(1)
    }
  }

  console.log(`[backtest] mode=orderbook files=${localFilePaths.length}`)
  console.log(`[backtest] order=${parsed.order}`)
  console.log(`[backtest] timeDriven=${parsed.timeDriven}`)
  console.log(`[backtest] azureBlob=${parsed.azureBlob}`)

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
    for (const fp of localFilePaths) {
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
  } finally {
    // Cleanup temporary files downloaded from Azure Blob Storage
    if (downloader && tempFiles.length > 0) {
      console.log(`[backtest] cleaning up ${tempFiles.length} temporary files`)
      for (const tempPath of tempFiles) {
        await downloader.cleanupTempFile(tempPath)
      }
    }
  }
}

main().catch((err) => {
  console.error('[backtest] failed', err)
  process.exit(1)
})
