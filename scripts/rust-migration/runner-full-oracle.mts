/** Actual pinned StrategyRunner/OrderManager/Portfolio/PluginSet bodies.
 * Scripted providers, strategy and execution edges are fixture inputs only.
 * No private runner body or accounting/execution-manager method is replaced.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { StrategyRunner } from '../../src/trading/StrategyRunner.js'
import { OrderManager } from '../../src/trading/OrderManager.js'
import { Portfolio } from '../../src/trading/Portfolio.js'
import { PluginSet } from '../../src/strategy/plugins/PluginSet.js'
import type { AccountEvent, MarketTick, Strategy } from '../../src/strategy/Strategy.js'
import type { ExecutionAdapter, OrderManagerContext } from '../../src/trading/OrderManager.js'

type Input = Record<string, any>
const copy = (x: unknown) =>
  x === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(x, (_, value) =>
          typeof value === 'bigint' ? { $bigint: value.toString() } : value,
        ),
      )
function numericBits(root: unknown) {
  const result: Record<string, string> = {}
  const active = new WeakSet<object>()
  const work: ({ value: unknown; path: string } | { leave: object })[] = [{ value: root, path: '' }]
  while (work.length) {
    const item = work.pop()!
    if ('leave' in item) {
      active.delete(item.leave)
      continue
    }
    const { value, path } = item
    if (typeof value === 'number') {
      const bytes = Buffer.alloc(8)
      bytes.writeDoubleBE(value)
      result[path] = bytes.toString('hex')
    } else if (value !== null && typeof value === 'object' && !active.has(value)) {
      active.add(value)
      work.push({ leave: value })
      for (const key of Object.keys(value))
        work.push({
          value: (value as Record<string, unknown>)[key],
          path: `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        })
    }
  }
  return result
}
async function run(input: Input) {
  const trace: any[] = []
  const ticks = new Map<string, MarketTick>()
  const events = new Map<string, AccountEvent>()
  const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>()
  const errors = new Map<string, Error>()
  const receipts = new Map<string, { status: string; error?: unknown }>()
  const retained: any[] = []
  const retainedMetadata: any[] = []
  const identities = new WeakMap<object, number>()
  let identity = 0
  const id = (x: any) =>
    x && typeof x === 'object'
      ? (identities.get(x) ?? (identities.set(x, ++identity), identity))
      : x
  let now = input.nowMs ?? 12345
  let market = input.market
  let balance = input.balance
  let warmup = input.warmup
  let generation = 0
  let marketCalls = 0
  let accountCalls = 0
  let executionCalls = 0
  const originalNow = Date.now
  const originalConsole = { log: console.log, warn: console.warn, error: console.error }
  Date.now = () => {
    trace.push({ kind: 'clock', now })
    return now
  }
  for (const kind of ['log', 'warn', 'error'] as const)
    console[kind] = (...args) =>
      trace.push({
        kind: 'console',
        level: kind,
        args: copy(
          args.map((v) =>
            v instanceof Error ? { name: v.name, message: v.message, errorId: id(v) } : v,
          ),
        ),
      })
  const gate = (name: string) => {
    let g = gates.get(name)
    if (!g) {
      let resolve!: () => void
      const promise = new Promise<void>((r) => (resolve = r))
      g = { promise, resolve }
      gates.set(name, g)
    }
    return g
  }
  const plans = (origin: string, n: number) => input[`${origin}Plans`]?.[n] ?? {}
  const fail = (plan: Input) => {
    if (plan.errorId) throw errors.get(plan.errorId)!
    if (plan.error)
      throw Object.assign(new Error(plan.error.message ?? String(plan.error)), {
        name: plan.error.name ?? 'Error',
      })
  }
  const execution = {} as ExecutionAdapter
  for (const method of [
    'placeLimit',
    'placeBatch',
    'cancelOrder',
    'cancelAll',
    'cancelBatch',
    'cancelMarket',
    'mergePositions',
    'splitPositions',
    'onMarketTick',
  ] as const) {
    ;(execution as any)[method] = async (...args: any[]) => {
      const context: OrderManagerContext = args[args.length - 1]
      const plan = plans('execution', executionCalls++)
      trace.push({
        kind: 'execution',
        method,
        args: copy(args),
        portfolioId: id(context.portfolio),
        marketId: id(context.lastMarket),
      })
      if (plan.gate) await gate(plan.gate).promise
      fail(plan)
      return { events: (plan.eventIds ?? []).map((key: string) => events.get(key)!) }
    }
  }
  const manager = new OrderManager({
    execution,
    dryRun: input.dryRun ?? false,
    log: (message, extra) => trace.push({ kind: 'managerLog', message, extra: copy(extra) }),
  })
  const makePlugins = () => {
    if (!input.plugins) return undefined
    const set = new PluginSet()
    let seen = 0
    set.register({
      id: 'fixture',
      handlesSyntheticTicks: input.pluginSynthetic === true,
      captureMarketTick(tick) {
        trace.push({ kind: 'capture', tickId: id(tick), sourceId: id(tick.source), generation })
        if (input.captureErrorAt === seen) throw new Error('capture failed')
      },
      onMarketTick(tick, ctx) {
        seen++
        trace.push({ kind: 'pluginTick', tickId: id(tick), context: copy(ctx), generation })
      },
      snapshot() {
        trace.push({ kind: 'pluginSnapshot', generation })
        return { generation, seen }
      },
      reset() {
        trace.push({ kind: 'pluginReset', generation })
        seen = 0
      },
    })
    return set
  }
  const makeStrategy = (): Strategy => {
    const player = ++generation
    trace.push({ kind: 'createStrategy', player })
    return {
      name: 'fixture',
      ...(input.requiredFeeds !== undefined ? { requiredFeeds: input.requiredFeeds } : {}),
      async onMarketTick(tick, portfolio, ctx) {
        const plan = plans('market', marketCalls++)
        trace.push({
          kind: 'strategyMarket',
          player,
          tickId: id(tick),
          sourceId: id(tick.source),
          portfolioId: id(portfolio),
          marketId: id(tick.snapshot),
          contextId: id(ctx),
          portfolio: copy(portfolio),
          context: copy(ctx),
          portfolioNumberBits: numericBits(portfolio),
          contextNumberBits: numericBits(ctx),
        })
        retained.push({ tick, portfolio, ctx, player })
        if (plan.gate) await gate(plan.gate).promise
        fail(plan)
        return plan.intents ?? []
      },
      async onAccountEvent(event, portfolio, books, ctx) {
        const plan = plans('account', accountCalls++)
        trace.push({
          kind: 'strategyAccount',
          player,
          eventId: id(event),
          portfolioId: id(portfolio),
          marketId: id(books),
          contextId: id(ctx),
          event: copy(event),
          portfolio: copy(portfolio),
          context: copy(ctx),
          portfolioNumberBits: numericBits(portfolio),
          contextNumberBits: numericBits(ctx),
        })
        retained.push({ event, portfolio, books, ctx, player })
        if (plan.gate) await gate(plan.gate).promise
        fail(plan)
        return plan.intents ?? []
      },
    }
  }
  const observe = (kind: string, ...args: any[]) =>
    trace.push({
      kind,
      ...(args.length
        ? { args: copy(args), ids: args.map(id), numberBits: numericBits(args) }
        : {}),
    })
  let runner: StrategyRunner
  try {
    const initialPlugins = makePlugins()
    runner = new StrategyRunner({
      strategy: makeStrategy(),
      ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
      ...(input.strategyParams !== undefined ? { strategyParams: input.strategyParams } : {}),
      ...(input.externalFeedsEnabled !== undefined
        ? { externalFeedsEnabled: input.externalFeedsEnabled }
        : {}),
      orderManager: manager,
      ...(input.createStrategy === false
        ? {}
        : {
            createStrategy: () => {
              const strategy = makeStrategy(),
                pluginSet = makePlugins()
              return { strategy, ...(pluginSet ? { pluginSet } : {}) }
            },
          }),
      ...(initialPlugins ? { pluginSet: initialPlugins } : {}),
      ...(input.portfolio ? { portfolio: new Portfolio(input.portfolio) } : {}),
      ...(input.startingCapital !== undefined ? { startingCapital: input.startingCapital } : {}),
      ...(input.maxEventsPerDrain !== undefined
        ? { maxEventsPerDrain: input.maxEventsPerDrain }
        : {}),
      ...(input.skipLateStartAfterMs !== undefined
        ? { skipLateStartAfterMs: input.skipLateStartAfterMs }
        : {}),
      ...(input.intentExecutionMode ? { intentExecutionMode: input.intentExecutionMode } : {}),
      getMarket: () => {
        trace.push({ kind: 'provider', name: 'market' })
        return market
      },
      getBalance: () => {
        trace.push({ kind: 'provider', name: 'balance' })
        return balance
      },
      getWarmup: () => {
        trace.push({ kind: 'provider', name: 'warmup' })
        return warmup
      },
      observer: {
        onCapital: (...args) => observe('onCapital', ...args),
        onContext: (...args) => observe('onContext', ...args),
        onDecision: (...args) => observe('onDecision', ...args),
        onAccountEvent: (...args) => observe('onAccountEvent', ...args),
      },
      intentLog: (message, extra) => trace.push({ kind: 'intentLog', message, extra: copy(extra) }),
      log: (message, extra) => trace.push({ kind: 'runnerLog', message, extra: copy(extra) }),
    })
    for (const op of input.operations) {
      if (op.kind === 'error')
        errors.set(op.id, Object.assign(new Error(op.message), { name: op.name ?? 'Error' }))
      else if (op.kind === 'tick') {
        const tick = op.tick as MarketTick
        if (typeof (tick.source as any).ingestSeq === 'string')
          (tick.source as any).ingestSeq = BigInt((tick.source as any).ingestSeq)
        ticks.set(op.id, tick)
      } else if (op.kind === 'event') events.set(op.id, op.event)
      else if (op.kind === 'now') now = op.nowMs
      else if (op.kind === 'providers') {
        market = op.market
        balance = op.balance
        warmup = op.warmup
      } else if (op.kind === 'mutateTick') Object.assign(ticks.get(op.id)!.snapshot, op.fields)
      else if (op.kind === 'mutateEvent') Object.assign(events.get(op.id)!, op.fields)
      else if (op.kind === 'release') gate(op.gate).resolve()
      else if (op.kind === 'pump')
        for (let i = 0; i < (op.turns ?? 20); i++) await Promise.resolve()
      else if (op.kind === 'submitTick' || op.kind === 'submitAccount') {
        const status = { status: 'pending' } as { status: string; error?: unknown }
        receipts.set(op.receipt, status)
        try {
          const promise =
            op.kind === 'submitTick'
              ? runner.onMarketTick(ticks.get(op.id)!)
              : runner.onAccountEvent(events.get(op.id)!)
          promise.then(
            () => {
              status.status = 'fulfilled'
            },
            (error) => {
              status.status = 'rejected'
              status.error = { name: error.name, message: error.message, errorId: id(error) }
            },
          )
        } catch (error: any) {
          status.status = 'capture_rejected'
          status.error = { name: error.name, message: error.message, errorId: id(error) }
        }
      } else if (op.kind === 'pluginCacheOverride') {
        Object.defineProperty(initialPlugins!, 'cached', {
          get: () => op.value,
          set: () => undefined,
          configurable: true,
        })
      } else if (op.kind === 'strategyMeta') {
        const metadata = runner.getStrategyMeta()
        retainedMetadata.push(metadata)
        trace.push({
          kind: 'strategyMeta',
          value: copy(metadata),
          rootId: id(metadata),
          paramsId: id(metadata?.params),
          requestedId: id(metadata?.externalFeeds.requested),
          enabledId: id(metadata?.externalFeeds.enabled),
          retained: copy(retainedMetadata),
          numberBits: numericBits(metadata),
        })
      } else if (op.kind === 'mutateParams') Object.assign(input.strategyParams, op.fields)
      else if (op.kind === 'observe')
        trace.push({
          kind: 'observation',
          receipts: copy(Object.fromEntries(receipts)),
          portfolio: copy(runner.getPortfolio().snapshot()),
          market: copy(runner.getLastMarketSnapshot()),
          retained: copy(retained),
          retainedNumberBits: numericBits(retained),
        })
      else throw new Error(`unknown fixture operation ${op.kind}`)
    }
    return {
      trace,
      receipts: Object.fromEntries(receipts),
      portfolio: copy(runner.getPortfolio().snapshot()),
      market: copy(runner.getLastMarketSnapshot()),
      retained: copy(retained),
      retainedNumberBits: numericBits(retained),
    }
  } catch (error: any) {
    return { trace, error: { name: error.name, message: error.message } }
  } finally {
    Date.now = originalNow
    Object.assign(console, originalConsole)
  }
}
const cases = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
const output = []
for (const entry of cases) output.push({ name: entry.name, result: await run(entry.input) })
writeFileSync(process.argv[3]!, JSON.stringify(output))
