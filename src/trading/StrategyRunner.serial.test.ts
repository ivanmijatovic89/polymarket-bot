import test from 'node:test'
import assert from 'node:assert/strict'
import { StrategyRunner } from './StrategyRunner.js'
import type { OrderManager } from './OrderManager.js'
import type { AccountEvent, MarketTick, Strategy } from '../strategy/Strategy.js'

/**
 * The serial dispatch funnel is the live/backtest parity guarantee: entry
 * points must run one at a time in arrival order even when callers
 * fire-and-forget while a hook is awaiting slow I/O (live order placement).
 */

function makeTick(ts: number): MarketTick {
  return {
    source: { kind: 'live', attempt: 1 },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: {
      market: 'm1',
      timestamp: ts,
      byAssetId: {},
    } as MarketTick['snapshot'],
  }
}

const statusEvent: AccountEvent = {
  kind: 'account_stream_status',
  source: 'user_ws',
  status: 'connected',
  tsMs: 1,
} as AccountEvent

const noopOrderManager = {
  onMarketTick: async () => [],
  handleIntents: async () => [],
} as unknown as OrderManager

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('fire-and-forget entries run strictly one at a time, in arrival order', async () => {
  const log: string[] = []
  const firstTickGate = deferred()
  let tickCount = 0

  const strategy: Strategy = {
    name: 'serial-test',
    onMarketTick: async (tick) => {
      tickCount += 1
      log.push(`tick-enter:${tick.snapshot.timestamp}`)
      if (tickCount === 1) await firstTickGate.promise // simulate slow live I/O
      log.push(`tick-exit:${tick.snapshot.timestamp}`)
      return []
    },
    onAccountEvent: (ev) => {
      log.push(`account:${ev.kind}`)
      return []
    },
  }

  const runner = new StrategyRunner({ strategy, orderManager: noopOrderManager })

  // Live-style dispatch: nothing awaited, all submitted while tick 1 is stuck.
  const p1 = runner.onMarketTick(makeTick(1))
  const p2 = runner.onMarketTick(makeTick(2))
  const p3 = runner.onAccountEvent(statusEvent)

  // Give the event loop room: without the funnel, tick 2 and the account
  // event would interleave into tick 1's await gap right here.
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(log, ['tick-enter:1'])

  firstTickGate.resolve()
  await Promise.all([p1, p2, p3])

  assert.deepEqual(log, [
    'tick-enter:1',
    'tick-exit:1',
    'tick-enter:2',
    'tick-exit:2',
    'account:account_stream_status',
  ])
})

test('a throwing entry rejects its own caller but does not break the chain', async () => {
  const log: string[] = []
  const strategy: Strategy = {
    name: 'serial-test',
    onMarketTick: (tick) => {
      log.push(`tick:${tick.snapshot.timestamp}`)
      if (tick.snapshot.timestamp === 1) throw new Error('boom')
      return []
    },
    onAccountEvent: () => [],
  }
  const runner = new StrategyRunner({ strategy, orderManager: noopOrderManager })

  const p1 = runner.onMarketTick(makeTick(1))
  const p2 = runner.onMarketTick(makeTick(2))

  await assert.rejects(p1, /boom/)
  await p2
  assert.deepEqual(log, ['tick:1', 'tick:2'])
})

test('sequentially awaited calls (backtest style) behave as before', async () => {
  const log: string[] = []
  const strategy: Strategy = {
    name: 'serial-test',
    onMarketTick: (tick) => {
      log.push(`tick:${tick.snapshot.timestamp}`)
      return []
    },
    onAccountEvent: (ev) => {
      log.push(`account:${ev.kind}`)
      return []
    },
  }
  const runner = new StrategyRunner({ strategy, orderManager: noopOrderManager })

  await runner.onMarketTick(makeTick(1))
  await runner.onAccountEvent(statusEvent)
  await runner.onMarketTick(makeTick(2))

  assert.deepEqual(log, ['tick:1', 'account:account_stream_status', 'tick:2'])
})
