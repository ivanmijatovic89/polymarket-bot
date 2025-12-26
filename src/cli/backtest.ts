import 'dotenv/config'
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
import { AzureBlobDownloader } from '../parquet/AzureBlobDownloader.js'

installProcessCrashHandlers({ prefix: 'backtest' })

function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

function parseArgs(argv: string[]): {
  filePaths: string[]
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  carry: boolean
  azureBlob: boolean
  azureContainer?: string
} {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false
  let carry = false
  let azureBlob = false
  let azureContainer: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--mode') {
      const v = argv[i + 1]
      if (v !== 'orderbook') {
        throw new Error(
          `[backtest] unsupported --mode ${String(v)} (raw mode removed; omit --mode or use --mode orderbook)`,
        )
      }
      i += 1 // consume value
      continue
    }
    if (a === '--order') {
      order = parseOrderValue(argv[i + 1])
      i += 1 // consume value
      continue
    }
    if (a === '--time-driven' || a === '--realtime') {
      timeDriven = true
      continue
    }
    if (a === '--carry' || a === '--carry-portfolio') {
      carry = true
      continue
    }
    if (a === '--azure-blob') {
      azureBlob = true
      continue
    }
    if (a === '--azure-container') {
      azureContainer = argv[i + 1]
      i += 1 // consume value
      continue
    }
    if (a === '--strategy') {
      i += 1 // consume value
      continue
    }
    if (a.startsWith('--strategy=')) {
      continue
    }
    if (a === '--param') {
      i += 1 // consume key=value
      continue
    }
    if (a.startsWith('--param=')) {
      continue
    }
    if (a.startsWith('-')) {
      // Unknown flag: ignore for now.
      continue
    }

    filePaths.push(a)
  }

  return { filePaths, order, timeDriven, carry, azureBlob, ...(azureContainer ? { azureContainer } : {}) }
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

  if (mergedQty > 0) {
    const totalPnl = sumMergePnl(mergeOps)
    const totalCost = sumMergeCost(mergeOps)
    const totalPnlPct = mergePnlPctTotal(mergeOps)
    console.log(`[backtest] settle_merge market=${params.market}`, {
      mergedQty: round8(mergedQty),
      cost: totalCost,
      pnl: totalPnl,
      pnlPct: totalPnlPct,
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
  let redeemedQty = 0

  for (const [assetId, pos] of Object.entries(p2.positionsByAssetId)) {
    const qty = safeFinite(pos?.qty, 0)
    if (!(qty > 0)) continue
    const payout = assetId === winner ? 1.0 : 0.0
    redeemedQty = round8(redeemedQty + qty)

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

  if (redeemedQty > 0) {
    console.log(`[backtest] settle_redeem market=${params.market}`, {
      winnerAssetId: winner,
      redeemedQty: round8(redeemedQty),
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
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven] [--carry]\n' +
        '  Azure Blob Storage:\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] --azure-blob --azure-container <container> <blob1> [blob2 ...] [--order recorded|exchange_time] [--time-driven] [--carry]\n' +
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
  console.log(`[backtest] carry=${parsed.carry}`)
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

  // Default: each parquet file is treated as an independent market episode with fresh bot state/capital.
  // Use --carry to keep a single runner/portfolio across all files.
  const carried = parsed.carry ? mkRunner() : null
  console.log(`[backtest] strategy=${built.strategyId}`)

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
  const marketRows: MarketPnlRow[] = []

  // IMPORTANT: each parquet file corresponds to a single 15m market episode.
  // We replay them sequentially (do NOT heap-merge by ingest_seq across files).
  try {
    for (const fp of localFilePaths) {
      if (shouldStop) break
      console.log(`[backtest] orderbook replay file=${fp}`)
      const active = carried ?? mkRunner()
      const runner = active.runner
      const strategy = active.strategy

      // Track realized PnL changes for this episode (includes synthetic settlement fills).
      const episodeRealizedBefore = safeFinite(runner.getPortfolio().snapshot().realizedPnlTotal, 0)

      await replayOrderBookForMarket({
        filePaths: [fp],
        order: parsed.order,
        timeDriven: parsed.timeDriven,
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
    const tradeFillsBefore = pBefore.recentFills.filter((f) => !isSettlementFill(f)).length
    const settlementBefore = settlementActionSummary(
      pBefore.recentFills.filter((f) => isSettlementFill(f)),
    )
    const sharesByAssetIdBefore = Object.fromEntries(
      Object.entries(pBefore.positionsByAssetId).map(([assetId, pos]) => [assetId, pos.qty]),
    )
    const mergeOps = computeMergeOpportunities(pBefore)
    const totalPnl = sumMergePnl(mergeOps)
    const totalCost = sumMergeCost(mergeOps)
    const totalPnlPct = mergePnlPctTotal(mergeOps)
    const totalMergeQty = round8(mergeOps.reduce((acc, o) => acc + (o.mergeQty ?? 0), 0))

    console.log(`[backtest] portfolio_pre_settlement market=${market}`, {
      tradeFills: tradeFillsBefore,
      settlementFills: settlementBefore.count,
      settlement: { merge: settlementBefore.merge, redeem: settlementBefore.redeem },
      positions: pBefore.positionsByAssetId,
      sharesByAssetId: sharesByAssetIdBefore,
      openOrders: Object.keys(pBefore.openOrdersByClientId).length,
      realizedPnl: realizedPnlTotal(pBefore),
      merge: {
        opportunities: mergeOps,
        totalPnl,
        totalCost,
        totalPnlPct,
      },
    })

    // Settle this market episode so capital doesn't remain locked across sequential 15m files.
    let episodeRealizedAfter = episodeRealizedBefore
    if (market !== '(unknown)') {
      console.log(`[backtest] settling market=${market}`)
      await settleMarketEpisode({ runner, strategyName: strategy.name, market })

      const allAfter = runner.getPortfolio().snapshot()
      episodeRealizedAfter = safeFinite(allAfter.realizedPnlTotal, episodeRealizedBefore)
      const pAfter = portfolioForMarket(allAfter, market)
      const tradeFillsAfter = pAfter.recentFills.filter((f) => !isSettlementFill(f)).length
      const settlementAfter = settlementActionSummary(
        pAfter.recentFills.filter((f) => isSettlementFill(f)),
      )
      const sharesByAssetIdAfter = Object.fromEntries(
        Object.entries(pAfter.positionsByAssetId).map(([assetId, pos]) => [assetId, pos.qty]),
      )
      console.log(`[backtest] portfolio_post_settlement market=${market}`, {
        tradeFills: tradeFillsAfter,
        settlementFills: settlementAfter.count,
        settlement: { merge: settlementAfter.merge, redeem: settlementAfter.redeem },
        positions: pAfter.positionsByAssetId,
        sharesByAssetId: sharesByAssetIdAfter,
        openOrders: Object.keys(pAfter.openOrdersByClientId).length,
        realizedPnl: realizedPnlTotal(pAfter),
      })
    }

      marketRows.push({
        filePath: fp,
        market,
        tradeFills: tradeFillsBefore,
        realizedPnlDelta: round8(episodeRealizedAfter - episodeRealizedBefore),
        mergeQty: totalMergeQty,
        pnl: totalPnl,
        cost: totalCost,
        pnlPct: totalPnlPct,
      })
    }

    // Strategy-level PnL across markets (based on realized PnL deltas per episode).
    // A "traded market" is one that had at least one non-settlement fill.
    const traded = marketRows.filter((r) => r.tradeFills > 0)
    const wins = traded.filter((r) => r.realizedPnlDelta > 0)
    const losses = traded.filter((r) => r.realizedPnlDelta <= 0)
    const totalPnl2 = round8(traded.reduce((acc, r) => acc + r.realizedPnlDelta, 0))
    const avgWin = round8(
      wins.length ? wins.reduce((acc, r) => acc + r.realizedPnlDelta, 0) / wins.length : 0,
    )
    const avgLose = round8(
      losses.length ? losses.reduce((acc, r) => acc + r.realizedPnlDelta, 0) / losses.length : 0,
    )

    console.log('[backtest] strategy pnl', {
      markets: marketRows.length,
      tradedMarkets: traded.length,
      successfulTrades: wins.length,
      unsuccessfulTrades: losses.length,
      totalPnl: totalPnl2,
      avgWin,
      avgLose,
      rows: marketRows,
    })

    console.log('[backtest] orderbook summary', {
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
