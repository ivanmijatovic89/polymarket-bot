import type { AnyMarketMessage, MarketOrderBooksSnapshot } from '../orderbook/OrderBookEngine.js'
import type { MarketTick } from '../strategy/Strategy.js'
import { createExampleMakerQuoteStrategy } from '../strategies/exampleMakerQuote.js'
import { OrderManager } from '../trading/OrderManager.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import { BacktestExecution } from '../trading/execution/BacktestExecution.js'

function makeSnapshot(params: {
  ts: number
  market: string
  assetId: string
  bestBid: number
  bestAsk: number
}): MarketOrderBooksSnapshot {
  const bids = [{ price: params.bestBid, size: 100 }]
  const asks = [{ price: params.bestAsk, size: 100 }]
  return {
    market: params.market,
    timestamp: params.ts,
    byAssetId: {
      [params.assetId]: {
        market: params.market,
        assetId: params.assetId,
        timestamp: params.ts,
        bestBid: params.bestBid,
        bestAsk: params.bestAsk,
        mid: (params.bestBid + params.bestAsk) / 2,
        spread: params.bestAsk - params.bestBid,
        bids,
        asks,
      },
    },
  }
}

function makeTick(args: {
  ts: number
  snapshot: MarketOrderBooksSnapshot
  msg: AnyMarketMessage
}): MarketTick {
  return {
    source: { kind: 'parquet', filePath: '(smoke)', ingestSeq: BigInt(args.ts) },
    msg: args.msg,
    snapshot: args.snapshot,
  }
}

async function runScenario(label: string, size: number): Promise<void> {
  console.log(`\n[smoke] scenario=${label} size=${size}`)

  const strategy = createExampleMakerQuoteStrategy({
    size,
    improveBy: 0.001,
    maxSpread: 0.5,
    orderType: 'GTC',
  })

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

  const market = 'm1'
  const assetId = 'asset1'

  // Tick 1: wide spread. Strategy will decide and queue intents, but latency delays execution.
  const s1 = makeSnapshot({ ts: 1000, market, assetId, bestBid: 0.4, bestAsk: 0.6 })
  const m1: AnyMarketMessage = {
    event_type: 'book',
    asset_id: assetId,
    market,
    bids: [{ price: '0.4', size: '100' }],
    asks: [{ price: '0.6', size: '100' }],
    timestamp: '1000',
    hash: 'h1',
  }
  await runner.onMarketTick(makeTick({ ts: 1000, snapshot: s1, msg: m1 }))

  // Tick 2: same book. Queued intents execute now and the orders become resting (not marketable).
  const s2 = makeSnapshot({ ts: 2000, market, assetId, bestBid: 0.4, bestAsk: 0.6 })
  const m2: AnyMarketMessage = {
    event_type: 'price_change',
    market,
    price_changes: [],
    timestamp: '2000',
  }
  await runner.onMarketTick(makeTick({ ts: 2000, snapshot: s2, msg: m2 }))

  // Tick 3: best ask touches quoted bid (~0.401), triggering a MAKER fill via BacktestExecution.onMarketTick().
  const s3 = makeSnapshot({ ts: 3000, market, assetId, bestBid: 0.4, bestAsk: 0.401 })
  const m3: AnyMarketMessage = {
    event_type: 'price_change',
    market,
    price_changes: [],
    timestamp: '3000',
  }
  await runner.onMarketTick(makeTick({ ts: 3000, snapshot: s3, msg: m3 }))

  console.log('[smoke] portfolio', runner.getPortfolio().snapshot())
}

async function main(): Promise<void> {
  await runScenario('fills_expected', 5)
  await runScenario('risk_block_expected', 1000)
}

main().catch((err) => {
  console.error('[smoke] failed', err)
  process.exit(1)
})
