/** Independent pinned TypeScript market frame/orderbook fixture driver. */
import { readFileSync } from 'node:fs'
import { MarketEngine, type EngineSource, type EngineTick } from '../../src/market/MarketEngine.js'
import type { AnyMarketMessage } from '../../src/market/orderbook/types.js'
import type { OrderBookEngine } from '../../src/market/orderbook/OrderBookEngine.js'

type Operation = {
  kind: string
  source?: Record<string, unknown>
  bootstrap?: boolean
  rawJson?: string
  messages?: AnyMarketMessage[]
}
type Input = {
  expectedAssetIds?: [string, string]
  depthLevels?: number
  operations: Operation[]
  retainTicks?: boolean
}
// Iterative projection avoids adding JSON.stringify's JavaScript call-stack
// limit to the production decoder's acceptance domain in this test harness.
function copy(value: unknown): any {
  const holder: Record<string, any> = Object.create(null)
  const tasks: { parent: any; key: string | number; value: any }[] = [
    { parent: holder, key: 'root', value },
  ]
  while (tasks.length) {
    const task = tasks.pop()!
    const value = task.value
    if (value === undefined) continue
    if (typeof value === 'bigint') {
      task.parent[task.key] = String(value)
      continue
    }
    if (typeof value === 'number') {
      task.parent[task.key] = Number.isFinite(value) ? value : null
      continue
    }
    if (value === null || typeof value !== 'object') {
      task.parent[task.key] = value
      continue
    }
    const target = Array.isArray(value) ? [] : Object.create(null)
    task.parent[task.key] = target
    const keys = Object.keys(value)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!
      tasks.push({ parent: target, key, value: value[key] })
    }
  }
  return holder.root
}
function writeJson(value: unknown): string {
  const chunks: string[] = []
  const tasks: ({ kind: 'value'; value: any } | { kind: 'text'; text: string })[] = [
    { kind: 'value', value },
  ]
  while (tasks.length) {
    const task = tasks.pop()!
    if (task.kind === 'text') {
      chunks.push(task.text)
      continue
    }
    const value = task.value
    if (value === null || typeof value !== 'object') {
      chunks.push(JSON.stringify(value) ?? 'null')
      continue
    }
    if (Array.isArray(value)) {
      chunks.push('[')
      tasks.push({ kind: 'text', text: ']' })
      for (let index = value.length - 1; index >= 0; index--) {
        tasks.push({ kind: 'value', value: value[index] })
        if (index > 0) tasks.push({ kind: 'text', text: ',' })
      }
    } else {
      chunks.push('{')
      tasks.push({ kind: 'text', text: '}' })
      const keys = Object.keys(value).filter((key) => value[key] !== undefined)
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!
        tasks.push(
          { kind: 'value', value: value[key] },
          { kind: 'text', text: ':' },
          { kind: 'text', text: JSON.stringify(key) },
        )
        if (index > 0) tasks.push({ kind: 'text', text: ',' })
      }
    }
  }
  return chunks.join('')
}
function safeInspect(engine: MarketEngine) {
  try {
    return inspect(engine)
  } catch (error) {
    return { inspectionError: { name: (error as Error).name, message: (error as Error).message } }
  }
}
function inspect(engine: MarketEngine) {
  const books = engine.getOrderBookEngine()
  const internals = books as unknown as { enginesByAssetId: Map<string, OrderBookEngine> }
  return {
    snapshot: books.snapshot(),
    snapshotAssetKeys: Object.keys(books.snapshot().byAssetId),
    isWarm: books.isWarm(),
    missingBooks: books.missingBooks(),
    lastUpdateTsByAssetId: [...books.getLastUpdateTsByAssetId()],
    states: Object.fromEntries(
      [...internals.enginesByAssetId].map(([asset, book]) => {
        const state = book.getState()
        return [
          asset,
          {
            state: { ...state, bids: [...state.bids.values()], asks: [...state.asks.values()] },
            recentTrades: book.getRecentTrades(),
          },
        ]
      }),
    ),
  }
}
function snapshotNumericBits(snapshot: EngineTick['snapshot']) {
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  const bits = (value: number) => {
    view.setFloat64(0, value, false)
    return view.getBigUint64(0, false).toString(16).padStart(16, '0')
  }
  const optional = (value: number | null) => (value === null ? null : bits(value))
  const levels = (values: { price: number; size: number }[]) =>
    values.map((level) => [bits(level.price), bits(level.size)])
  return {
    timestamp: bits(snapshot.timestamp),
    books: Object.entries(snapshot.byAssetId).map(([key, book]) => ({
      key,
      timestamp: bits(book.timestamp),
      depthLevels: bits(book.depthLevels),
      bestBid: optional(book.bestBid),
      bestAsk: optional(book.bestAsk),
      mid: optional(book.mid),
      spread: optional(book.spread),
      bids: levels(book.bids),
      asks: levels(book.asks),
      bidsDepthByLevel: book.bidsDepthByLevel.map(bits),
      asksDepthByLevel: book.asksDepthByLevel.map(bits),
    })),
  }
}
async function run(input: Input) {
  let ticks: EngineTick[] = []
  const retained: EngineTick[] = []
  const engine = new MarketEngine({
    ...(input.expectedAssetIds ? { expectedAssetIds: input.expectedAssetIds } : {}),
    onTick: (tick) => {
      ticks.push(copy(tick))
      if (input.retainTicks) retained.push(tick)
    },
  })
  const originalDepth = process.env.WEB_UI_ORDERBOOK_LEVELS
  if (input.depthLevels === undefined) delete process.env.WEB_UI_ORDERBOOK_LEVELS
  else process.env.WEB_UI_ORDERBOOK_LEVELS = String(input.depthLevels)
  try {
    const steps = []
    for (const operation of input.operations) {
      ticks = []
      let message: AnyMarketMessage | null = null
      let error: { name: string; message: string } | undefined
      const source = { ...(operation.source ?? { kind: 'live', attempt: 1 }) }
      if ('ingestSeq' in source) source.ingestSeq = BigInt(source.ingestSeq as string)
      try {
        if (operation.kind === 'reset') engine.reset()
        else if (operation.kind === 'raw')
          message = await engine.handleRaw({
            rawJson: operation.rawJson!,
            source: source as EngineSource,
            bootstrap: operation.bootstrap,
          })
        else if (operation.kind === 'decoded')
          message = await engine.handleDecoded({
            messages: operation.messages!,
            source: source as EngineSource,
            bootstrap: operation.bootstrap,
          })
        else throw new Error('unknown market fixture operation')
      } catch (caught) {
        error = { name: (caught as Error).name, message: (caught as Error).message }
      }
      steps.push(
        copy({
          ...safeInspect(engine),
          message,
          messageKeys: message && typeof message === 'object' ? Object.keys(message) : [],
          ticks,
          ...(error ? { error } : {}),
        }),
      )
    }
    return {
      steps,
      final: copy(safeInspect(engine)),
      ...(input.retainTicks
        ? {
            retainedTicks: copy(retained),
            retainedNumericBits: retained.map((tick) => snapshotNumericBits(tick.snapshot)),
          }
        : {}),
    }
  } finally {
    if (originalDepth === undefined) delete process.env.WEB_UI_ORDERBOOK_LEVELS
    else process.env.WEB_UI_ORDERBOOK_LEVELS = originalDepth
  }
}
const document = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  cases: { name: string; input: Input }[]
}
const results = []
for (const { name, input } of document.cases) results.push({ name, result: await run(input) })
process.stdout.write(writeJson(results))
