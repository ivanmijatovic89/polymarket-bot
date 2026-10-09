import { readFile, writeFile } from 'node:fs/promises'
import { Portfolio } from '../../src/trading/Portfolio.js'
import { OrderManager } from '../../src/trading/OrderManager.js'
import { BacktestExecution } from '../../src/trading/execution/BacktestExecution.js'
import { OrderBookEngine } from '../../src/market/orderbook/OrderBookEngine.js'
import { computePositionMetrics } from '../../src/trading/positionMetrics.js'
import { computeOrderbookMetrics } from '../../src/trading/orderbookMetrics.js'
import { computeMarketStats } from '../../src/backtest/stats/marketStats.js'
import { computeBatchStats } from '../../src/backtest/stats/batchStats.js'
import { computeBacktestSegments } from '../../src/backtest/stats/backtestSegments.js'
import { seededRandom } from './common.mjs'
import type { AccountEvent, Intent } from '../../src/strategy/Strategy.js'
import type { MarketOrderBooksSnapshot } from '../../src/market/orderbook/index.js'

type Case = {
  name: string
  market: string
  upId: string
  downId: string
  startingCapital: number
  latencyMs?: number
  jitterMs?: number
  seed?: number
  cancelLatency?: boolean
  makerFillMode?: 'touch_or_better' | 'worst_queue'
  mode?: 'queued' | 'immediate'
  outcome: 'UP' | 'DOWN'
  steps: Array<{
    nowMs: number
    up?: { bids: number[][]; asks: number[][] }
    down?: { bids: number[][]; asks: number[][] }
    tick?: boolean
    events?: AccountEvent[]
    intents?: Intent[]
    callbacks?: Record<string, Intent[]>
  }>
}
const [inputPath, outputPath] = process.argv.slice(2)
const input = JSON.parse(await readFile(inputPath!, 'utf8')) as {
  cases: Case[]
  aggregations: Array<{
    name: string
    markets: Parameters<typeof computeBatchStats>[0]
    initialCapital: number
  }>
  fixed: Array<[number, number]>
}
const results = []
for (const c of input.cases) {
  const p = new Portfolio({ startingCapital: c.startingCapital })
  p.initializeClock(1000)
  const manager = new OrderManager({
    execution: new BacktestExecution({
      latencyMs: c.latencyMs ?? 0,
      jitterMs: c.jitterMs ?? 0,
      cancelLatency: c.cancelLatency ?? true,
      makerFillMode: c.makerFillMode ?? 'worst_queue',
    }),
  })
  const rng = Math.random
  Math.random = seededRandom(c.seed ?? 7)
  const books = [
    new OrderBookEngine({ market: c.market, assetId: c.upId }),
    new OrderBookEngine({ market: c.market, assetId: c.downId }),
  ]
  const present = new Set<number>()
  const frames = []
  try {
    for (const step of c.steps) {
      for (const [i, key] of ['up', 'down'].entries()) {
        const b = step[key as 'up' | 'down']
        if (b) {
          books[i]!.applyBook({
            event_type: 'book',
            asset_id: i === 0 ? c.upId : c.downId,
            market: c.market,
            timestamp: String(step.nowMs),
            hash: '',
            bids: b.bids.map(([price, size]) => ({ price: String(price), size: String(size) })),
            asks: b.asks.map(([price, size]) => ({ price: String(price), size: String(size) })),
          })
          present.add(i)
        }
      }
      const lastMarket: MarketOrderBooksSnapshot = {
        market: c.market,
        timestamp: step.nowMs,
        byAssetId: Object.fromEntries(
          [...present].map((i) => [i === 0 ? c.upId : c.downId, books[i]!.snapshot()]),
        ),
      }
      const metrics = () => ({
        position: computePositionMetrics({
          portfolio: p.snapshot(),
          upAssetId: c.upId,
          downAssetId: c.downId,
        }),
        ...(present.size === 2
          ? {
              orderbook: computeOrderbookMetrics({
                upBook: lastMarket.byAssetId[c.upId]!,
                downBook: lastMarket.byAssetId[c.downId]!,
              }),
            }
          : {}),
      })
      const ctx = () => ({ nowMs: step.nowMs, lastMarket, portfolio: p.snapshot() })
      const events: unknown[] = []
      const queue: AccountEvent[] = []
      if (step.tick !== false) queue.push(...(await manager.onMarketTick(ctx())))
      queue.push(...(step.events ?? []))
      const drain = async () => {
        let count = 0
        const called = new Set<string>()
        while (queue.length) {
          if (++count > 4200) {
            queue.length = 0
            break
          }
          const e = queue.shift()!
          p.apply(e)
          manager.reconcileActiveOrders(p.snapshot(), e)
          events.push(
            JSON.parse(
              JSON.stringify({
                event: e,
                portfolio: manager.withPendingCapital(p.snapshot()),
                metrics: metrics(),
              }),
            ),
          )
          if (step.callbacks?.[e.kind] && !called.has(e.kind)) {
            called.add(e.kind)
            queue.push(
              ...(await manager.handleIntents(step.callbacks[e.kind]!, ctx(), {
                mode: c.mode ?? 'immediate',
              })),
            )
          }
        }
      }
      await drain()
      if (step.intents) {
        queue.push(
          ...(await manager.handleIntents(step.intents, ctx(), { mode: c.mode ?? 'immediate' })),
        )
        await drain()
      }
      frames.push(
        JSON.parse(JSON.stringify({ events, portfolio: p.snapshot(), metrics: metrics() })),
      )
    }
    const snap = p.snapshot()
    const trades = snap.recentFills.map((f) => ({
      ...f,
      ...(snap.ordersByClientId[f.clientOrderId ?? '']?.meta
        ? { intentMeta: snap.ordersByClientId[f.clientOrderId ?? '']!.meta }
        : {}),
    }))
    results.push({
      name: c.name,
      frames,
      stats: computeMarketStats({
        slug: c.name,
        marketId: c.market,
        finalOutcome: c.outcome,
        tokenMap: { UP: c.upId, DOWN: c.downId },
        trades,
        splits: snap.recentSplits as never,
        finalPositions: snap.positionsByAssetId,
        realizedPnl: snap.realizedPnlTotal ?? 0,
      }),
    })
  } finally {
    Math.random = rng
  }
}
const aggregations = input.aggregations.map((c) => ({
  name: c.name,
  batch: computeBatchStats(c.markets, c.initialCapital).toRunColumns(),
  segments: computeBacktestSegments(c.markets as never, c.initialCapital),
}))
await writeFile(
  outputPath!,
  JSON.stringify({ results, aggregations, fixed: input.fixed.map(([n, d]) => n.toFixed(d)) }),
)
