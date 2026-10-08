/** Admission oracle calls pinned MarketEngine and real StrategyRunner entrypoints.
 * Runner processing bodies are instrumented here; this isolates the admission
 * contract, not strategy/execution/accounting acceptance. */
import { readFileSync } from 'node:fs'
import { MarketEngine } from '../../src/market/MarketEngine.js'
import { StrategyRunner } from '../../src/trading/StrategyRunner.js'
const document = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
const copy = (value: any): any =>
  JSON.parse(
    JSON.stringify(value, (_, v) => {
      if (typeof v === 'bigint') return String(v)
      if (typeof v === 'string' && /[\uD800-\uDFFF]/u.test(v)) {
        // Neutral fixture tag for lone code units; paired astral characters do
        // not match this Unicode-mode expression. Typed source probes use slots.
        return { $utf16: Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)) }
      }
      return v
    }),
  )
function sourceMutation(source: any, spec: any) {
  if (spec.localTimeBits) source.tsLocalMs = Buffer.from(spec.localTimeBits, 'hex').readDoubleBE()
  if (spec.sequence !== undefined) source.ingestSeq = BigInt(spec.sequence)
  if (spec.removeSequence) delete source.ingestSeq
  if (spec.undefinedSequence) source.ingestSeq = undefined
  if (spec.filePathUnits) source.filePath = String.fromCharCode(...spec.filePathUnits)
  if (spec.nestedValue !== undefined) source.extra.value = spec.nestedValue
}
function sourceProbe(source: any) {
  const units = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i))
  const bits = Buffer.alloc(8)
  if (typeof source.tsLocalMs === 'number') bits.writeDoubleBE(source.tsLocalMs)
  return {
    keys: Object.keys(source).map(units),
    sequenceType: typeof source.ingestSeq,
    sequence: typeof source.ingestSeq === 'bigint' ? String(source.ingestSeq) : null,
    localTimeBits:
      typeof source.tsLocalMs === 'number'
        ? Number.isNaN(source.tsLocalMs)
          ? 'NaN'
          : bits.toString('hex')
        : null,
    filePathUnits: typeof source.filePath === 'string' ? units(source.filePath) : null,
  }
}
const results = []
for (const c of document.cases) {
  const input = c.input,
    plans = input.callbacks ?? {},
    combined = !!input.combined,
    awaited = !!input.awaited
  const events: any[] = [],
    retained: any[] = [],
    observations: any[] = [],
    receipts: any[] = [],
    serialReceipts: any[] = []
  let provider: any = 'initial'
  const originals = new Map<string, any>()
  const sources = new Map<string, any>()
  const gates = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; reject: (e: any) => void }
  >()
  function disposition(id: string): void | Promise<void> {
    const plan = plans[id] ?? {}
    if (plan.throw) throw new Error(`process:${id}`)
    if (plan.gate) {
      let gate = gates.get(plan.gate)
      if (!gate) {
        let resolve!: () => void, reject!: (e: any) => void
        const promise = new Promise<void>((r, j) => {
          resolve = r
          reject = j
        })
        gate = { promise, resolve, reject }
        gates.set(plan.gate, gate)
      }
      return gate.promise
    }
    if (plan.ready)
      return plan.reject ? Promise.reject(new Error(`process:${id}`)) : Promise.resolve()
  }
  function receipt(id: any, promise: Promise<any>, isSerial = false, original?: any) {
    const row: any = { id, result: null as any }
    if (input.identityProbe && !isSerial) row.returnSame = null
    ;(isSerial ? serialReceipts : receipts).push(row)
    promise.then(
      (value) => {
        row.result = { ok: isSerial ? true : copy(value) }
        if (input.identityProbe && !isSerial) row.returnSame = value === original
      },
      (error) => {
        row.result = { error: { name: error.name, message: error.message } }
      },
    )
  }
  const captures = new WeakMap<object, any>()
  const runner: any = new StrategyRunner({
    strategy: { name: 'dispatch-oracle', onMarketTick: () => [], onAccountEvent: () => [] },
    orderManager: {} as any,
    pluginSet: {
      captureMarketTick(tick: any) {
        captures.set(tick, copy(provider))
        if (plans[String(tick.snapshot.timestamp)]?.captureThrow)
          throw new Error(`capture:${tick.snapshot.timestamp}`)
      },
    } as any,
  })
  // These private body hooks are intentionally separate from the pinned
  // capture + runSerial implementation and its actual public entrypoints.
  runner.processMarketTick = async (tick: any) => {
    const id = String(tick.snapshot.timestamp)
    events.push({
      kind: 'process',
      id,
      captured: captures.get(tick),
      provider: copy(provider),
      tick: copy(tick),
    })
    await disposition(id)
  }
  runner.enqueueAccountEvent = (event: any) => {
    runner.fixtureAccount = event
  }
  runner.drainAccountEvents = async () => {
    const id = runner.fixtureAccount.id
    events.push({ kind: 'process', id, captured: null, provider: copy(provider), tick: null })
    await disposition(id)
  }
  const realError = console.error,
    realWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  const engine = new MarketEngine({
    onTick(tick) {
      const id = String(tick.snapshot.timestamp)
      retained.push(tick)
      const event: any = { kind: 'capture', id, provider: copy(provider), tick: copy(tick) }
      if (input.identityProbe) {
        const original = originals.get(id),
          msg = tick.msg as any
        event.identity = {
          messageSame: msg === original,
          changesSame: msg.price_changes === original.price_changes,
          changeObjectsSame: msg.price_changes.map(
            (change: any, i: number) => change === original.price_changes[i],
          ),
        }
      }
      events.push(event)
      if (combined) {
        const result = runner.onMarketTick(tick as any)
        if (awaited) return result
        result.catch(() => {})
        return
      }
      if (plans[id]?.captureThrow) throw new Error(`capture:${id}`)
      return disposition(id)
    },
  })
  try {
    for (const op of input.operations) {
      if (op.kind === 'submit') {
        events.push({ kind: 'receipt', id: op.id })
        const source = op.sourceId
          ? sources.get(op.sourceId)
          : copy(op.source ?? { kind: 'live', attempt: 1 })
        if (!op.sourceId && 'ingestSeq' in source) source.ingestSeq = BigInt(source.ingestSeq)
        if (input.identityProbe)
          for (const message of op.messages) originals.set(String(message.timestamp), message)
        receipt(
          op.id,
          op.rawJson !== undefined
            ? engine.handleRaw({ rawJson: op.rawJson, source, bootstrap: op.bootstrap })
            : engine.handleDecoded({ messages: op.messages, source, bootstrap: op.bootstrap }),
          false,
          input.identityProbe ? op.messages.at(-1) : undefined,
        )
      } else if (op.kind === 'source_create') {
        const source = copy(op.source ?? { kind: 'live', attempt: 1 })
        if ('ingestSeq' in source) source.ingestSeq = BigInt(source.ingestSeq)
        sourceMutation(source, op)
        sources.set(op.id, source)
      } else if (op.kind === 'source_mutate') {
        sourceMutation(sources.get(op.id), op)
      } else if (op.kind === 'account') {
        receipt(
          op.id,
          runner.onAccountEvent({ kind: 'account_stream_status', tsMs: 1, id: op.id }),
          true,
        )
      } else if (op.kind === 'provider') provider = copy(op.value)
      else if (op.kind === 'reset') engine.reset()
      else if (op.kind === 'resolve') {
        const gate = gates.get(op.gate)
        if (gate) {
          if (op.error) gate.reject(new Error(op.error))
          else gate.resolve()
        }
      } else if (op.kind === 'flush') {
        for (let i = 0; i < input.operations.length * 12 + 64; i++) await Promise.resolve()
      } else throw new Error(`Unknown fixture operation ${op.kind}`)
      observations.push({
        state: copy(engine.snapshot()),
        events: copy(events),
        statuses:
          op.kind === 'flush'
            ? { frames: copy(receipts), serial: copy(serialReceipts), depth: runner.serialDepth }
            : null,
      })
    }
    const result: any = { observations, retained: retained.map(copy) }
    if (input.sourceProbe) {
      const ids = [...sources.keys()].sort()
      result.sourceProbes = {
        sources: ids.map((id) => ({ id, probe: sourceProbe(sources.get(id)) })),
        ticks: retained.map((tick) => ({
          probe: sourceProbe(tick.source),
          sameSources: ids.map((id) => tick.source === sources.get(id)),
          sameTickSources: retained.map((other) => tick.source === other.source),
        })),
      }
    }
    results.push({ name: c.name, result })
  } finally {
    console.error = realError
    console.warn = realWarn
  }
}
process.stdout.write(JSON.stringify(results))
