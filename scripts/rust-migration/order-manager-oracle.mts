/** Actual pinned OrderManager/Portfolio bodies. All simulation belongs to the execution seam. */
import { readFileSync } from 'node:fs'
import {
  OrderManager,
  type ExecutionAdapter,
  type OrderManagerContext,
} from '../../src/trading/OrderManager.js'
import { Portfolio } from '../../src/trading/Portfolio.js'
import type { AccountEvent, Intent } from '../../src/strategy/Strategy.js'

type Operation = {
  op: string
  intents?: Intent[]
  mode?: 'queued' | 'immediate'
  index?: number
  nowMs?: number
  events?: AccountEvent[]
  getter?: { intentIndex: number; field: string; thrown: object; returns?: unknown[] }
}
type Case = {
  name: string
  input: {
    dryRun?: boolean
    withoutPortfolio?: boolean
    startingCapital?: number
    minGtdOffsetMs?: number
    market?: string
    seed?: AccountEvent[]
    execution?: { events?: AccountEvent[]; error?: string }[]
    operations: Operation[]
  }
}
const pathKey = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1')
function probe(value: unknown): unknown {
  const keys: Record<string, string[]> = {},
    bits: Record<string, string> = {}
  const work: { value: unknown; path: string }[] = [{ value, path: '' }]
  while (work.length) {
    const { value: current, path } = work.pop()!
    if (typeof current === 'number') {
      const buffer = new ArrayBuffer(8),
        view = new DataView(buffer)
      view.setFloat64(0, current, false)
      bits[path] = view.getBigUint64(0, false).toString(16).padStart(16, '0')
    } else if (current !== null && typeof current === 'object') {
      keys[path] = Object.keys(current)
      for (const key of Object.keys(current))
        work.push({
          value: (current as Record<string, unknown>)[key],
          path: `${path}/${pathKey(key)}`,
        })
    }
  }
  return { value: JSON.parse(JSON.stringify(value)), keys, bits }
}
async function run({ name, input }: Case): Promise<unknown> {
  const p = new Portfolio({ startingCapital: input.startingCapital ?? 500 })
  p.initializeClock(0)
  for (const event of input.seed ?? []) p.apply(event)
  const calls: { operation: string; intent: unknown; context: OrderManagerContext }[] = []
  const logs: { message: string; extra?: unknown }[] = []
  const results = [...(input.execution ?? [])]
  const execute = (operation: string) => async (intent: unknown, context: OrderManagerContext) => {
    calls.push({ operation, intent, context })
    const result = results.shift()
    if (result?.error !== undefined) throw result.error
    return { events: result?.events ?? [] }
  }
  const adapter: ExecutionAdapter = {
    placeLimit: execute('place_limit'),
    placeBatch: execute('place_batch'),
    cancelOrder: execute('cancel_order'),
    cancelAll: execute('cancel_all'),
    cancelBatch: execute('cancel_batch'),
    cancelMarket: execute('cancel_market'),
    mergePositions: execute('merge_positions'),
    splitPositions: execute('split_positions'),
    onMarketTick: async (context) => {
      calls.push({ operation: 'market_tick', intent: null, context })
      return { events: [] }
    },
  }
  const manager = new OrderManager({
    execution: adapter,
    dryRun: input.dryRun,
    minGtdOffsetMs: input.minGtdOffsetMs,
    log: (message, extra) => logs.push({ message, extra }),
  })
  const outputs: AccountEvent[][] = [],
    operations: unknown[] = [],
    original: Intent[] = []
  const books = input.market
    ? ({ market: input.market } as OrderManagerContext['lastMarket'])
    : undefined
  for (const operation of input.operations) {
    const context: OrderManagerContext = {
      nowMs: operation.nowMs ?? 1000,
      ...(books ? { lastMarket: books } : {}),
      ...(!input.withoutPortfolio ? { portfolio: p.snapshot() } : {}),
    }
    let events: AccountEvent[] = [],
      error: unknown
    let getterCalls = 0
    const thrown = operation.getter?.thrown
    try {
      if (operation.op === 'handle') {
        if (operation.getter) {
          Object.defineProperty(
            operation.intents![operation.getter.intentIndex],
            operation.getter.field,
            {
              enumerable: true,
              configurable: true,
              get: () => {
                const index = getterCalls++
                if (index < (operation.getter?.returns?.length ?? 0))
                  return operation.getter!.returns![index]
                throw thrown
              },
            },
          )
        }
        original.push(...operation.intents!)
        events = await manager.handleIntents(operation.intents!, context, {
          mode: operation.mode ?? 'immediate',
        })
        outputs.push(events)
      } else if (operation.op === 'tick') {
        events = await manager.onMarketTick(context)
        outputs.push(events)
      } else if (operation.op === 'begin') manager.beginMarket()
      else if (operation.op === 'apply') {
        for (const event of outputs[operation.index!]!) {
          p.apply(event)
          manager.reconcileActiveOrders(p.snapshot(), event)
        }
      } else if (operation.op === 'reconcile') {
        for (const event of outputs[operation.index!]!)
          manager.reconcileActiveOrders(p.snapshot(), event)
      } else if (operation.op === 'seed') {
        for (const event of operation.events ?? []) p.apply(event)
      }
    } catch (caught) {
      error = caught
    }
    const snapshot = p.snapshot(),
      pending = manager.withPendingCapital(snapshot)
    const shared = [
      'positionsByAssetId',
      'openOrdersByClientId',
      'wsOpenOrdersByOrderId',
      'ordersByClientId',
      'recentFills',
      'marketByAssetId',
    ].filter(
      (key) =>
        (snapshot as unknown as Record<string, unknown>)[key] ===
        (pending as unknown as Record<string, unknown>)[key],
    )
    operations.push({
      op: operation.op,
      events: probe(events),
      ...(error !== undefined ? { error } : {}),
      ...(operation.getter ? { getterCalls, thrownOriginal: error === thrown } : {}),
      snapshot: probe(snapshot),
      pending: probe(pending),
      samePendingRoot: snapshot === pending,
      pendingFrozen: Object.isFrozen(pending),
      capitalFrozen: Object.isFrozen(pending.capital),
      shared,
    })
  }
  return {
    name,
    result: {
      operations,
      calls: calls.map((call) => ({
        operation: call.operation,
        intent: probe(call.intent),
        context: probe(call.context),
        originalIntent: original.includes(call.intent as Intent),
      })),
      logs: logs.map((log) => ({
        message: log.message,
        extra: log.extra === undefined ? null : probe(log.extra),
      })),
    },
  }
}
const input = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { cases: Case[] }
process.stdout.write(JSON.stringify(await Promise.all(input.cases.map(run))))
