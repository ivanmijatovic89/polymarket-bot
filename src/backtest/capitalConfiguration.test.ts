import assert from 'node:assert/strict'
import test from 'node:test'
import type { Job } from 'bullmq'
import * as z from 'zod'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import { buildRunnerForMarket } from './runSingleMarket.js'
import { makeMarketProcessor } from './marketProcessor.js'
import type { MarketJobData } from './jobTypes.js'
import { WORKER_LAUNCH_SHA } from './commitGate.js'

const definition: StrategyDefinition<unknown> = {
  id: 'capital-wiring-test',
  schema: z.strictObject({}),
  create: () => ({
    strategy: { name: 'capital-wiring-test', onMarketTick: () => [], onAccountEvent: () => [] },
  }),
}

test('fresh sequential runners and worker payloads use the producer allowance independently', async () => {
  const job: MarketJobData = {
    submissionUid: 'test',
    batchUid: 'test',
    idx: 0,
    filePath: '/unused.parquet',
    slug: null,
    marketMeta: undefined,
    marketResolution: null,
    strategyId: definition.id,
    strategyParams: {},
    inputMode: 'recorded',
    order: 'recorded',
    timeDriven: false,
    latency: { delayMs: 140, jitterMs: 20 },
    strategyWindow: null,
    commitSha: WORKER_LAUNCH_SHA,
    startingCapital: 123.45,
  }
  const sequential = buildRunnerForMarket({ ...job, strategyDefinition: definition })
  assert.equal(sequential.runner.getPortfolio().snapshot().capital!.cash, 123.45)
  sequential.runner.getPortfolio().apply({
    kind: 'positions_split',
    split: { id: 'spent', tsMs: 1, assetIdA: 'a', assetIdB: 'b', size: 100, splitCost: 100 },
  })
  assert.equal(sequential.runner.getPortfolio().snapshot().capital!.cash, 23.45)
  const next = buildRunnerForMarket({ ...job, strategyDefinition: definition })
  assert.equal(next.runner.getPortfolio().snapshot().capital!.cash, 123.45)
  assert.notEqual(next.strategy, sequential.strategy)

  let received = false
  const processor = makeMarketProcessor({
    machineId: 'test-worker',
    runMarket: async (input) => {
      received = true
      assert.equal(input.startingCapital, job.startingCapital)
      assert.deepEqual(input.latency, job.latency)
      const worker = buildRunnerForMarket({ ...input, strategyDefinition: definition })
      assert.deepEqual(
        worker.runner.getPortfolio().snapshot().capital,
        next.runner.getPortfolio().snapshot().capital,
      )
      return {
        idx: input.idx,
        slug: null,
        marketStats: null,
        eventsProcessed: 0,
        eventsByType: {},
        durationMs: 0,
      }
    },
  })
  await processor({ data: JSON.parse(JSON.stringify(job)) } as Job<MarketJobData>)
  assert.equal(received, true)
})
