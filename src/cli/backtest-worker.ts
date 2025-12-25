/**
 * Worker thread for parallel backtest execution.
 * Each worker processes a single parquet file independently.
 */

import { parentPort } from 'worker_threads'
import { replayOrderBookForMarket } from './backtest-parallel.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import { OrderManager } from '../trading/OrderManager.js'
import { BacktestExecution } from '../trading/execution/BacktestExecution.js'
import { getStrategyDefinition } from '../strategy/strategyRegistry.js'
import {
  computeMergeOpportunities,
  mergePnlPctTotal,
  sumMergeCost,
  sumMergePnl,
} from '../trading/portfolioMetrics.js'
import type { Fill, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'

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

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8
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

function portfolioForMarket(p: PortfolioSnapshot, market: string): PortfolioSnapshot {
  const positionsByAssetId: PortfolioSnapshot['positionsByAssetId'] = {}
  const marketByAssetId: PortfolioSnapshot['marketByAssetId'] = {}

  for (const [assetId, m] of Object.entries(p.marketByAssetId ?? {})) {
    if (m !== market) continue
    marketByAssetId[assetId] = m
    const pos = p.positionsByAssetId[assetId]
    if (pos) positionsByAssetId[assetId] = pos
  }

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

async function applySyntheticFills(params: {
  runner: StrategyRunner
  fills: Fill[]
}): Promise<void> {
  for (const f of params.fills) {
    await params.runner.onAccountEvent({ kind: 'fill', fill: f })
  }
}

async function settleMarketEpisode(params: {
  runner: StrategyRunner
  strategyName: string
  market: string
}): Promise<void> {
  const last = params.runner.getLastMarketSnapshot()
  if (!last) return

  const before = params.runner.getPortfolio().snapshot()
  const p = portfolioForMarket(before, params.market)
  const mergeOps = computeMergeOpportunities(p)

  const tsMs = safeFinite(last.timestamp, before.nowMs)
  const fills: Fill[] = []

  let mergedQty = 0
  for (const op of mergeOps) {
    const qty = safeFinite(op.mergeQty, 0)
    if (!(qty > 0)) continue
    const [a, b] = op.assetIds
    if (!a || !b) continue
    mergedQty = round8(mergedQty + qty)

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

async function processFile(input: WorkerInput): Promise<WorkerOutput> {
  try {
    const def = getStrategyDefinition(input.strategyId)
    const strategy = def.create(input.params as never)
    const exec = new BacktestExecution()
    const orderManager = new OrderManager({
      execution: exec,
      dryRun: false,
      log: () => {}, // Disable logging in workers
    })
    const runner = new StrategyRunner({
      strategy,
      orderManager,
      log: () => {}, // Disable logging in workers
    })

    const episodeRealizedBefore = safeFinite(runner.getPortfolio().snapshot().realizedPnlTotal, 0)

    let events = 0
    const byType = new Map<string, number>()

    await replayOrderBookForMarket({
      filePaths: [input.filePath],
      order: input.order,
      onSnapshot: async (snap, raw) => {
        events += 1
        byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)
        await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })
      },
    })

    const market = runner.getLastMarketSnapshot()?.market ?? '(unknown)'
    const allBefore = runner.getPortfolio().snapshot()
    const pBefore = market !== '(unknown)' ? portfolioForMarket(allBefore, market) : allBefore
    const tradeFillsBefore = pBefore.recentFills.filter((f) => !isSettlementFill(f)).length

    const mergeOps = computeMergeOpportunities(pBefore)
    const totalPnl = sumMergePnl(mergeOps)
    const totalCost = sumMergeCost(mergeOps)
    const totalPnlPct = mergePnlPctTotal(mergeOps)
    const totalMergeQty = round8(mergeOps.reduce((acc, o) => acc + (o.mergeQty ?? 0), 0))

    let episodeRealizedAfter = episodeRealizedBefore
    if (market !== '(unknown)') {
      await settleMarketEpisode({ runner, strategyName: strategy.name, market })
      const allAfter = runner.getPortfolio().snapshot()
      episodeRealizedAfter = safeFinite(allAfter.realizedPnlTotal, episodeRealizedBefore)
    }

    return {
      success: true,
      filePath: input.filePath,
      market,
      tradeFills: tradeFillsBefore,
      realizedPnlDelta: round8(episodeRealizedAfter - episodeRealizedBefore),
      mergeQty: totalMergeQty,
      pnl: totalPnl,
      cost: totalCost,
      pnlPct: totalPnlPct,
      events,
      byType: Object.fromEntries(byType.entries()),
    }
  } catch (error) {
    return {
      success: false,
      filePath: input.filePath,
      market: '(error)',
      tradeFills: 0,
      realizedPnlDelta: 0,
      mergeQty: 0,
      pnl: 0,
      cost: 0,
      pnlPct: 0,
      events: 0,
      byType: {},
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Main worker execution
if (parentPort) {
  parentPort.on('message', (input: WorkerInput) => {
    processFile(input)
      .then((result) => {
        parentPort!.postMessage(result)
      })
      .catch((error) => {
        parentPort!.postMessage({
          success: false,
          filePath: input.filePath,
          market: '(error)',
          tradeFills: 0,
          realizedPnlDelta: 0,
          mergeQty: 0,
          pnl: 0,
          cost: 0,
          pnlPct: 0,
          events: 0,
          byType: {},
          error: error instanceof Error ? error.message : String(error),
        })
      })
  })
}
