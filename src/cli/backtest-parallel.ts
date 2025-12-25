import { createParquetReplaySource } from '../parquet/replay/parquetReplaySource.js'
import { createMarketEventHandler } from '../market/marketEventHandler.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import * as parquet from '@dsnp/parquetjs'
import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type { AnyMarketMessage } from '../market/orderbook/index.js'
import { MarketEngine } from '../market/MarketEngine.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import {
  computeMergeOpportunities,
  mergePnlPctTotal,
  sumMergeCost,
  sumMergePnl,
} from '../trading/portfolioMetrics.js'
import { OrderManager } from '../trading/OrderManager.js'
import { BacktestExecution } from '../trading/execution/BacktestExecution.js'
import { getStrategyDefinition } from '../strategy/strategyRegistry.js'
import type { AccountEvent, Fill, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import { buildStrategyFromCliArgs, printCliArgsError } from './helpers/strategyArgs.js'
import { Worker, isMainThread } from 'worker_threads'
import { cpus } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

installProcessCrashHandlers({ prefix: 'backtest-parallel' })

function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

type BacktestMode = 'raw' | 'orderbook'

function parseModeValue(raw: string | undefined): BacktestMode {
  if (raw === 'orderbook') return 'orderbook'
  return 'raw'
}

function parseArgs(argv: string[]): {
  filePaths: string[]
  mode: BacktestMode
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  carry: boolean
  concurrency: number
  verbose: boolean
  workers: number
} {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false
  let mode: BacktestMode = 'raw'
  let carry = false
  let concurrency = 0 // 0 means unlimited (process all files concurrently)
  let verbose = false
  let workers = 0 // 0 means disabled, >0 enables worker threads

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    switch (a) {
      case '--mode':
        mode = parseModeValue(argv[i + 1])
        i += 1
        break
      case '--order':
        order = parseOrderValue(argv[i + 1])
        i += 1
        break
      case '--time-driven':
      case '--realtime':
        timeDriven = true
        break
      case '--carry':
      case '--carry-portfolio':
        carry = true
        break
      case '--concurrency':
        const val = parseInt(argv[i + 1] ?? '0', 10)
        concurrency = Number.isFinite(val) && val >= 0 ? val : 0
        i += 1
        break
      case '--workers':
        const wval = parseInt(argv[i + 1] ?? '0', 10)
        workers = Number.isFinite(wval) && wval >= 0 ? wval : 0
        i += 1
        break
      case '--verbose':
      case '-v':
        verbose = true
        break
      case '--strategy':
        i += 1 // consume value
        break
      default:
        if (a.startsWith('--strategy=')) {
          // Inline strategy, consumed elsewhere
        } else if (a.startsWith('--param=')) {
          // Inline param, consumed elsewhere
        } else if (a.startsWith('--concurrency=')) {
          const val = parseInt(a.slice('--concurrency='.length), 10)
          concurrency = Number.isFinite(val) && val >= 0 ? val : 0
        } else if (a.startsWith('--workers=')) {
          const wval = parseInt(a.slice('--workers='.length), 10)
          workers = Number.isFinite(wval) && wval >= 0 ? wval : 0
        } else if (a.startsWith('-')) {
          // Unknown flag: ignore
        } else {
          filePaths.push(a)
        }
        break
    }
  }

  return { filePaths, mode, order, timeDriven, carry, concurrency, verbose, workers }
}

type ReplayRow = {
  ingest_seq?: unknown
  ts_local_ms?: unknown
  ts_exchange_ms?: unknown
  event_type?: unknown
  raw_json?: unknown
}

function toBigInt(v: unknown, fallback: bigint): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v)
    } catch {
      return fallback
    }
  }
  return fallback
}

type HeapItem = {
  fileIdx: number
  row: ReplayRow
  keySeq: bigint
  keyTs: bigint
}

function less(a: HeapItem, b: HeapItem): boolean {
  // Requirement: sort by ingest_seq (tick-by-tick replay).
  if (a.keySeq !== b.keySeq) return a.keySeq < b.keySeq
  if (a.keyTs !== b.keyTs) return a.keyTs < b.keyTs
  return a.fileIdx < b.fileIdx
}

class MinHeap {
  private readonly arr: HeapItem[] = []

  size(): number {
    return this.arr.length
  }

  push(x: HeapItem): void {
    this.arr.push(x)
    this.bubbleUp(this.arr.length - 1)
  }

  pop(): HeapItem | undefined {
    const n = this.arr.length
    if (n === 0) return undefined
    const top = this.arr[0]
    const last = this.arr.pop()
    if (last && n > 1) {
      this.arr[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2)
      const parent = this.arr[p]
      const cur = this.arr[i]
      if (!parent || !cur) return
      if (!less(cur, parent)) return
      this.arr[p] = cur
      this.arr[i] = parent
      i = p
    }
  }

  private bubbleDown(i: number): void {
    const n = this.arr.length
    while (true) {
      const l = i * 2 + 1
      const r = i * 2 + 2
      let smallest = i
      if (l < n && less(this.arr[l]!, this.arr[smallest]!)) smallest = l
      if (r < n && less(this.arr[r]!, this.arr[smallest]!)) smallest = r
      if (smallest === i) return
      const tmp = this.arr[i]!
      this.arr[i] = this.arr[smallest]!
      this.arr[smallest] = tmp
      i = smallest
    }
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Process items concurrently with optional concurrency limit.
 * If concurrency is 0 or undefined, all items are processed concurrently.
 */
async function processConcurrently<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency?: number,
): Promise<R[]> {
  if (!concurrency || concurrency <= 0 || concurrency >= items.length) {
    // Process all items concurrently (no limit)
    return Promise.all(items.map(processor))
  }

  // Process items with concurrency limit using a sliding window approach
  const results: R[] = []
  const executing: Promise<void>[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const p = processor(item).then((result) => {
      results[i] = result
      // Remove this promise from executing array when done
      const idx = executing.indexOf(wrappedPromise)
      if (idx >= 0) executing.splice(idx, 1)
    })

    const wrappedPromise = p as Promise<void>
    executing.push(wrappedPromise)

    if (executing.length >= concurrency) {
      // Wait for at least one to complete before starting more
      await Promise.race(executing)
    }
  }

  // Wait for all remaining promises to complete
  await Promise.all(executing)
  return results
}

type ReplayApplyEvent = {
  msg: AnyMarketMessage
  rawJson: string
  market: string
  source: { kind: 'parquet'; filePath: string; ingestSeq: bigint }
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

function realizedPnlTotal(p: PortfolioSnapshot): number {
  if (typeof p.realizedPnlTotal === 'number' && Number.isFinite(p.realizedPnlTotal))
    return round8(p.realizedPnlTotal)
  let sum = 0
  for (const pos of Object.values(p.positionsByAssetId)) {
    if (Number.isFinite(pos.realizedPnl)) sum += pos.realizedPnl
  }
  return round8(sum)
}

function safeFinite(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

function isSettlementFill(f: Fill): boolean {
  return (
    (typeof f.orderId === 'string' &&
      (f.orderId.startsWith('bt-merge:') || f.orderId.startsWith('bt-settle:'))) ||
    (typeof f.clientOrderId === 'string' &&
      (f.clientOrderId.includes(':merge:') || f.clientOrderId.includes(':settle:')))
  )
}

function settlementActionSummary(fills: Fill[]): {
  count: number
  merge: boolean
  redeem: boolean
} {
  let merge = false
  let redeem = false
  for (const f of fills) {
    const cid = typeof f.clientOrderId === 'string' ? f.clientOrderId : ''
    const oid = typeof f.orderId === 'string' ? f.orderId : ''
    if (!merge && (cid.includes(':merge:') || oid.startsWith('bt-merge:'))) merge = true
    if (!redeem && (cid.includes(':settle:') || oid.startsWith('bt-settle:'))) redeem = true
    if (merge && redeem) break
  }
  return { count: (merge ? 1 : 0) + (redeem ? 1 : 0), merge, redeem }
}

async function applySyntheticFills(params: {
  runner: StrategyRunner
  fills: Fill[]
}): Promise<void> {
  for (const f of params.fills) {
    const ev: AccountEvent = { kind: 'fill', fill: f }
    await params.runner.onAccountEvent(ev)
  }
}

/**
 * Backtest-only settlement:
 * - "Merge" any paired YES/NO holdings into $1 collateral per pair (synthetic fills at 1 and 0).
 * - Liquidate any remaining holdings in this market at the last observed bestBid (fallback bestAsk).
 *
 * Why: strategies like `hybrid_production` track internal cash based on fills; without settlement,
 * capital stays locked across sequential 15m episodes and the bot stops trading after a few markets.
 */
async function settleMarketEpisode(params: {
  runner: StrategyRunner
  strategyName: string
  market: string
}): Promise<void> {
  const last = params.runner.getLastMarketSnapshot()
  if (!last) return

  // Work off a market-filtered snapshot so we only settle the episode that just ended.
  const before = params.runner.getPortfolio().snapshot()
  const p = portfolioForMarket(before, params.market)
  const mergeOps = computeMergeOpportunities(p)

  const tsMs = safeFinite(last.timestamp, before.nowMs)
  const fills: Fill[] = []

  // 1) MERGE paired positions (guaranteed $1 per pair; deterministic even if winner inference is wrong).
  let mergedQty = 0
  for (const op of mergeOps) {
    const qty = safeFinite(op.mergeQty, 0)
    if (!(qty > 0)) continue
    const [a, b] = op.assetIds
    if (!a || !b) continue
    mergedQty = round8(mergedQty + qty)

    // Synthetic merge: sell one leg at 1, the other at 0 -> net proceeds = qty * 1.
    // (This avoids adding new event kinds and works with strategy cash accounting.)
    fills.push({
      id: `${params.strategyName}:${params.market}:merge:${tsMs}:${a}:1`,
      tsMs,
      market: params.market,
      assetId: a,
      side: 'SELL',
      price: 1.0,
      size: qty,
      clientOrderId: `${params.strategyName}:${params.market}:merge:${tsMs}:${a}`,
      orderId: `bt-merge:${params.strategyName}:${params.market}:${a}`,
      liquidity: 'TAKER',
    })
    fills.push({
      id: `${params.strategyName}:${params.market}:merge:${tsMs}:${b}:1`,
      tsMs,
      market: params.market,
      assetId: b,
      side: 'SELL',
      price: 0.0,
      size: qty,
      clientOrderId: `${params.strategyName}:${params.market}:merge:${tsMs}:${b}`,
      orderId: `bt-merge:${params.strategyName}:${params.market}:${b}`,
      liquidity: 'TAKER',
    })
  }

  if (fills.length > 0) await applySyntheticFills({ runner: params.runner, fills })

  // 2) REDEEM any remaining single-sided positions at payout:
  // winner asset pays 1, loser pays 0. We infer winner from the final orderbook snapshot.
  const afterMerge = params.runner.getPortfolio().snapshot()
  const p2 = portfolioForMarket(afterMerge, params.market)
  const redeems: Fill[] = []

  const assetIds = Object.keys(last.byAssetId ?? {}).sort()
  if (assetIds.length < 2) return
  const a = assetIds[0]
  const b = assetIds[1]
  if (!a || !b || a === b) return

  const bookA = last.byAssetId[a]
  const bookB = last.byAssetId[b]
  const bidA = safeFinite(bookA?.bestBid, 0) || safeFinite(bookA?.bestAsk, 0)
  const bidB = safeFinite(bookB?.bestBid, 0) || safeFinite(bookB?.bestAsk, 0)
  const winner = bidA >= bidB ? a : b

  for (const [assetId, pos] of Object.entries(p2.positionsByAssetId)) {
    const qty = safeFinite(pos?.qty, 0)
    if (!(qty > 0)) continue
    const payout = assetId === winner ? 1.0 : 0.0

    redeems.push({
      id: `${params.strategyName}:${params.market}:settle:${tsMs}:${assetId}:1`,
      tsMs,
      market: params.market,
      assetId,
      side: 'SELL',
      price: payout,
      size: qty,
      clientOrderId: `${params.strategyName}:${params.market}:settle:${tsMs}:${assetId}`,
      orderId: `bt-settle:${params.strategyName}:${params.market}:${assetId}`,
      liquidity: 'TAKER',
    })
  }

  if (redeems.length > 0) await applySyntheticFills({ runner: params.runner, fills: redeems })
}

function portfolioForMarket(p: PortfolioSnapshot, market: string): PortfolioSnapshot {
  const positionsByAssetId: PortfolioSnapshot['positionsByAssetId'] = {}
  const marketByAssetId: PortfolioSnapshot['marketByAssetId'] = {}

  for (const [assetId, m] of Object.entries(p.marketByAssetId ?? {})) {
    if (m !== market) continue
    marketByAssetId[assetId] = m
    const pos = p.positionsByAssetId[assetId]
    if (pos) positionsByAssetId[assetId] = pos
  }

  // Fallback: if marketByAssetId wasn't populated, try best-effort from open orders + fills.
  if (Object.keys(positionsByAssetId).length === 0) {
    for (const [assetId, pos] of Object.entries(p.positionsByAssetId)) {
      const inferred =
        p.recentFills.find((f) => f.assetId === assetId)?.market ??
        Object.values(p.openOrdersByClientId).find((o) => o.assetId === assetId)?.market
      if (inferred !== market) continue
      positionsByAssetId[assetId] = pos
      marketByAssetId[assetId] = market
    }
  }

  const openOrdersByClientId: PortfolioSnapshot['openOrdersByClientId'] = {}
  for (const [cid, o] of Object.entries(p.openOrdersByClientId)) {
    if (o.market === market) openOrdersByClientId[cid] = o
  }

  const recentFills = p.recentFills.filter((f) => f.market === market)

  return {
    nowMs: p.nowMs,
    ...(typeof p.realizedPnlTotal === 'number' ? { realizedPnlTotal: p.realizedPnlTotal } : {}),
    positionsByAssetId,
    openOrdersByClientId,
    recentFills,
    marketByAssetId,
  }
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
    throw new Error('[backtest-parallel] replayOrderBookForMarket: filePaths is required')

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
  const startTime = Date.now()
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)
  const built = (() => {
    try {
      return buildStrategyFromCliArgs({ argv: args, script: 'backtest-parallel' })
    } catch (err) {
      printCliArgsError({ script: 'backtest-parallel', err })
      process.exit(2)
    }
  })()
  const filePaths = parsed.filePaths
  if (filePaths.length === 0) {
    console.error(
      'Usage:\n' +
        '  Raw replay (existing):\n' +
        '    tsx src/cli/backtest-parallel.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '  Orderbook replay:\n' +
        '    tsx src/cli/backtest-parallel.ts --strategy <id> [--param key=value ...] --mode orderbook <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--carry] [--concurrency N] [--workers N] [--verbose]\n' +
        '\n' +
        '  Options:\n' +
        '    --concurrency N    Process N files concurrently (default: unlimited, ignored if --carry or --workers is used)\n' +
        '    --workers N        Use N worker threads for true parallel execution (default: 0=disabled, auto=CPU count)\n' +
        '    --verbose, -v      Enable detailed logging during processing (reduces performance)',
    )
    process.exit(2)
  }

  if (parsed.mode === 'orderbook') {
    console.log(`[backtest-parallel] mode=orderbook files=${filePaths.length}`)
    console.log(`[backtest-parallel] order=${parsed.order}`)
    console.log(`[backtest-parallel] carry=${parsed.carry}`)
    console.log(`[backtest-parallel] concurrency=${parsed.concurrency === 0 ? 'unlimited' : parsed.concurrency}`)

    // Worker thread mode
    if (parsed.workers > 0 && !parsed.carry) {
      const poolSize = parsed.workers
      console.log(`[backtest-parallel] using ${poolSize} worker threads for true parallel execution`)

      // Worker script path: use .js when running compiled code, .ts when using tsx
      const workerScriptPath = join(__dirname, 'backtest-worker.js')

      type WorkerInput = {
        filePath: string
        strategyId: string
        params: Record<string, unknown>
        order: 'recorded' | 'exchange_time'
      }

      type WorkerOutput = {
        success: boolean
        filePath: string
        market: string
        tradeFills: number
        realizedPnlDelta: number
        mergeQty: number
        pnl: number
        cost: number
        pnlPct: number
        events: number
        byType: Record<string, number>
        error?: string
      }

      const workers: Worker[] = []
      const availableWorkers: Worker[] = []
      const pendingTasks: Array<{
        input: WorkerInput
        resolve: (result: WorkerOutput) => void
        reject: (error: Error) => void
      }> = []

      // Create worker pool (no tsx loader needed for compiled JS)
      for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(workerScriptPath)

        worker.on('error', (error) => {
          console.error(`[backtest-parallel] Worker ${i} error:`, error)
        })

        worker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`[backtest-parallel] Worker ${i} exited with code ${code}`)
          }
        })

        workers.push(worker)
        availableWorkers.push(worker)
      }

      const executeTask = (input: WorkerInput): Promise<WorkerOutput> => {
        return new Promise((resolve, reject) => {
          if (availableWorkers.length > 0) {
            const worker = availableWorkers.shift()!

            const messageHandler = (result: WorkerOutput) => {
              worker.off('message', messageHandler)
              worker.off('error', errorHandler)
              availableWorkers.push(worker)
              resolve(result)

              // Process next task in queue
              if (pendingTasks.length > 0) {
                const task = pendingTasks.shift()!
                executeTask(task.input).then(task.resolve).catch(task.reject)
              }
            }

            const errorHandler = (error: Error) => {
              worker.off('message', messageHandler)
              worker.off('error', errorHandler)
              availableWorkers.push(worker)
              reject(error)
            }

            worker.once('message', messageHandler)
            worker.once('error', errorHandler)
            worker.postMessage(input)
          } else {
            pendingTasks.push({ input, resolve, reject })
          }
        })
      }

      // Submit all tasks
      let completed = 0
      const results = await Promise.all(
        filePaths.map(async (fp) => {
          const input: WorkerInput = {
            filePath: fp,
            strategyId: built.strategyId,
            params: built.params,
            order: parsed.order,
          }

          const result = await executeTask(input)
          completed++
          console.log(`[backtest-parallel] completed ${completed}/${filePaths.length}: ${fp}`)

          if (!result.success) {
            console.error(`[backtest-parallel] ERROR processing ${fp}:`, result.error)
          }

          return result
        })
      )

      // Terminate all workers
      await Promise.all(workers.map(w => w.terminate()))

      // Aggregate results
      const marketRows = results.map(r => ({
        filePath: r.filePath,
        market: r.market,
        tradeFills: r.tradeFills,
        realizedPnlDelta: r.realizedPnlDelta,
        mergeQty: r.mergeQty,
        pnl: r.pnl,
        cost: r.cost,
        pnlPct: r.pnlPct,
      }))

      const totalEvents = results.reduce((sum, r) => sum + r.events, 0)
      const totalByType = new Map<string, number>()
      for (const r of results) {
        for (const [type, count] of Object.entries(r.byType)) {
          totalByType.set(type, (totalByType.get(type) ?? 0) + count)
        }
      }

      // Print summary
      const traded = marketRows.filter((r) => r.tradeFills > 0)
      const wins = traded.filter((r) => r.realizedPnlDelta > 0)
      const losses = traded.filter((r) => r.realizedPnlDelta <= 0)
      const totalPnl = round8(traded.reduce((acc, r) => acc + r.realizedPnlDelta, 0))
      const avgWin = round8(
        wins.length ? wins.reduce((acc, r) => acc + r.realizedPnlDelta, 0) / wins.length : 0,
      )
      const avgLose = round8(
        losses.length ? losses.reduce((acc, r) => acc + r.realizedPnlDelta, 0) / losses.length : 0,
      )

      console.log('[backtest-parallel] strategy pnl', {
        markets: marketRows.length,
        tradedMarkets: traded.length,
        successfulTrades: wins.length,
        unsuccessfulTrades: losses.length,
        totalPnl,
        avgWin,
        avgLose,
        rows: marketRows,
      })

      console.log('[backtest-parallel] orderbook summary', {
        events: totalEvents,
        byType: Object.fromEntries([...totalByType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      })
      console.log(`[backtest-parallel] completed in ${(Date.now() - startTime) / 1000}s`)
      return
    }

    let shouldStop = false
    const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
      console.log(`[backtest-parallel] ${signal} received, stopping...`)
      shouldStop = true
    }
    installSignalHandlers({ onSignal: shutdown })

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

    // Default: each parquet file is treated as an independent market episode with fresh bot state/capital.
    // Use --carry to keep a single runner/portfolio across all files.
    const carried = parsed.carry ? mkRunner() : null
    console.log(`[backtest-parallel] strategy=${built.strategyId}`)

    type MarketPnlRow = {
      filePath: string
      market: string
      tradeFills: number
      realizedPnlDelta: number
      mergeQty: number
      pnl: number
      cost: number
      pnlPct: number
    }

    type EpisodeResult = {
      marketRow: MarketPnlRow
      events: number
      byType: Map<string, number>
    }

    const processMarketEpisode = async (fp: string, carriedActive: { strategy: Strategy; runner: StrategyRunner } | null = null): Promise<EpisodeResult> => {
      const active = carriedActive ?? mkRunner()
      const runner = active.runner
      const strategy = active.strategy

      // Track realized PnL changes for this episode (includes synthetic settlement fills).
      const episodeRealizedBefore = safeFinite(runner.getPortfolio().snapshot().realizedPnlTotal, 0)

      let events = 0
      const byType = new Map<string, number>()

      await replayOrderBookForMarket({
        filePaths: [fp],
        order: parsed.order,
        shouldStop: () => shouldStop,
        onSnapshot: async (snap, raw) => {
          if (shouldStop) return
          events += 1
          byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)

          await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })
        },
      })

      const market = runner.getLastMarketSnapshot()?.market ?? '(unknown)'
      const allBefore = runner.getPortfolio().snapshot()
      const pBefore = market !== '(unknown)' ? portfolioForMarket(allBefore, market) : allBefore
      const tradeFillsBefore = pBefore.recentFills.filter((f: Fill) => !isSettlementFill(f)).length
      const settlementBefore = settlementActionSummary(
        pBefore.recentFills.filter((f: Fill) => isSettlementFill(f)),
      )
      const sharesByAssetIdBefore = Object.fromEntries(
        Object.entries(pBefore.positionsByAssetId).map(([assetId, pos]) => [assetId, (pos as any).qty]),
      )
      const mergeOps = computeMergeOpportunities(pBefore)
      const totalPnl = sumMergePnl(mergeOps)
      const totalCost = sumMergeCost(mergeOps)
      const totalPnlPct = mergePnlPctTotal(mergeOps)
      const totalMergeQty = round8(mergeOps.reduce((acc, o) => acc + (o.mergeQty ?? 0), 0))

      // Settle this market episode so capital doesn't remain locked across sequential 15m files.
      let episodeRealizedAfter = episodeRealizedBefore
      if (market !== '(unknown)') {
        await settleMarketEpisode({ runner, strategyName: strategy.name, market })
        const allAfter = runner.getPortfolio().snapshot()
        episodeRealizedAfter = safeFinite(allAfter.realizedPnlTotal, episodeRealizedBefore)
      }

      const marketRow: MarketPnlRow = {
        filePath: fp,
        market,
        tradeFills: tradeFillsBefore,
        realizedPnlDelta: round8(episodeRealizedAfter - episodeRealizedBefore),
        mergeQty: totalMergeQty,
        pnl: totalPnl,
        cost: totalCost,
        pnlPct: totalPnlPct,
      }

      return { marketRow, events, byType }
    }

    let marketRows: MarketPnlRow[] = []
    let totalEvents = 0
    const totalByType = new Map<string, number>()

    if (parsed.carry) {
      // Sequential for carry mode (must process files in order to maintain portfolio state)
      for (const fp of filePaths) {
        if (shouldStop) break
        const result = await processMarketEpisode(fp, carried)
        marketRows.push(result.marketRow)
        totalEvents += result.events
        for (const [k, v] of result.byType) {
          totalByType.set(k, (totalByType.get(k) ?? 0) + v)
        }
      }
    } else {
      // Parallel processing for independent episodes
      // Use sliding window concurrency control: 0 = unlimited, or specify a limit
      const concurrencyLimit = parsed.concurrency > 0 ? parsed.concurrency : 0
      console.log(`[backtest-parallel] processing ${filePaths.length} files with concurrency=${concurrencyLimit === 0 ? 'unlimited' : concurrencyLimit}`)

      let completed = 0
      const results = await processConcurrently(
        filePaths,
        async (fp) => {
          const result = await processMarketEpisode(fp)
          completed++
          console.log(`[backtest-parallel] completed ${completed}/${filePaths.length}: ${fp}`)
          return result
        },
        concurrencyLimit,
      )

      for (const result of results) {
        marketRows.push(result.marketRow)
        totalEvents += result.events
        for (const [k, v] of result.byType) {
          totalByType.set(k, (totalByType.get(k) ?? 0) + v)
        }
      }
    }

    // Strategy-level PnL across markets (based on realized PnL deltas per episode).
    // A "traded market" is one that had at least one non-settlement fill.
    const traded = marketRows.filter((r) => r.tradeFills > 0)
    const wins = traded.filter((r) => r.realizedPnlDelta > 0)
    const losses = traded.filter((r) => r.realizedPnlDelta <= 0)
    const totalPnl = round8(traded.reduce((acc, r) => acc + r.realizedPnlDelta, 0))
    const avgWin = round8(
      wins.length ? wins.reduce((acc, r) => acc + r.realizedPnlDelta, 0) / wins.length : 0,
    )
    const avgLose = round8(
      losses.length ? losses.reduce((acc, r) => acc + r.realizedPnlDelta, 0) / losses.length : 0,
    )

    console.log('[backtest-parallel] strategy pnl', {
      markets: marketRows.length,
      tradedMarkets: traded.length,
      successfulTrades: wins.length,
      unsuccessfulTrades: losses.length,
      totalPnl,
      avgWin,
      avgLose,
      rows: marketRows,
    })

    console.log('[backtest-parallel] orderbook summary', {
      events: totalEvents,
      byType: Object.fromEntries([...totalByType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    })
    console.log(`[backtest-parallel] completed in ${(Date.now() - startTime) / 1000}s`)
    return
  }

  const order = parsed.order
  const timeDriven = parsed.timeDriven

  console.log(`[backtest-parallel] files=${filePaths.length}`)
  console.log(`[backtest-parallel] order=${order}`)
  console.log(`[backtest-parallel] timeDriven=${timeDriven}`)

  const handler = createMarketEventHandler()

  let doneResolve: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    doneResolve = resolve
  })

  const source = createParquetReplaySource({ filePaths, order, timeDriven })

  source.onEvent((ev) => {
    handler.handle(ev)
  })

  source.onStatus((s) => {
    if (s.kind === 'connected') {
      console.log(`[backtest-parallel] started (${s.info ?? 'parquet'})`)
      return
    }
    if (s.kind === 'disconnected') {
      console.log(`[backtest-parallel] finished (${s.info ?? 'done'})`)
      doneResolve?.()
      return
    }
    if (s.kind === 'reconnecting') {
      // replay source doesn't reconnect, but keep this for interface parity
      console.log(`[backtest-parallel] reconnecting in ${s.delayMs}ms (${s.info ?? ''})`)
    }
  })

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[backtest-parallel] ${signal} received, stopping...`)
    source.stop()
  }
  installSignalHandlers({ onSignal: shutdown })

  source.start()
  await done

  const snap = handler.snapshot()
  console.log('[backtest-parallel] summary', snap)
  console.log(`[backtest-parallel] completed in ${(Date.now() - startTime) / 1000}s`)
}

// Only run main() if NOT in a worker thread
if (isMainThread) {
  main().catch((err) => {
    console.error('[backtest-parallel] failed', err)
    process.exit(1)
  })
}