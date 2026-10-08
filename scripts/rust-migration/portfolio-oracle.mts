/** Independent pinned production account-ledger oracle; decode once per case. */
import { readFileSync } from 'node:fs'
import { Portfolio } from '../../src/trading/Portfolio.js'
import type { AccountEvent, OpenOrder } from '../../src/strategy/Strategy.js'

type AliasPath = { root: 'event' | 'snapshot'; id: string; path: string[] }
type RawAliasOperation =
  | { op: 'allocate'; id: string; event: AccountEvent }
  | { op: 'set' | 'delete'; id: string; path: string[]; value?: unknown }
  | { op: 'link'; id: string; path: string[]; source: AliasPath }
  | { op: 'apply' | 'retain'; id: string }
  | { op: 'observe'; label: string }
  | { op: 'same'; label: string; left: AliasPath; right: AliasPath }

type Step = { event?: AccountEvent; initializeClock?: number; capture?: boolean }
type Case = {
  name: string
  input: {
    initialNowMs?: number
    options?: { startingCapital?: number; maxRecentFills?: number }
    steps: Step[]
    aliasProbe?: boolean
    mutableAliasesProbe?: boolean
    rawAliasOperations?: RawAliasOperation[]
  }
}
const opaqueFields = new Set([
  'meta',
  'intentMeta',
  'opaqueOrder',
  'opaqueFill',
  'opaqueSplit',
  'adapterTrace',
  'executionReceipt',
])
function pointerKey(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}
function opaqueObjectKeys(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const visit = (node: unknown, path: string, opaque: boolean) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}/${index}`, opaque))
      return
    }
    if (node === null || typeof node !== 'object') return
    if (opaque) result[path] = Object.keys(node)
    for (const [key, child] of Object.entries(node))
      visit(child, `${path}/${pointerKey(key)}`, opaque || opaqueFields.has(key))
  }
  visit(value, '', false)
  return result
}
function opaqueNumberBits(value: unknown, allNumbers = false): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (node: unknown, path: string, opaque: boolean) => {
    if (typeof node === 'number' && opaque) {
      const buffer = Buffer.alloc(8)
      buffer.writeDoubleBE(node)
      result[path] = buffer.toString('hex')
      return
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}/${index}`, opaque))
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node))
      visit(child, `${path}/${pointerKey(key)}`, opaque || opaqueFields.has(key))
  }
  visit(value, '', allNumbers)
  return result
}

function mutableObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') throw new Error('alias path is not an object')
  return value as Record<string, unknown>
}
function ownPropertyKeys(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const work: { value: unknown; path: string }[] = [{ value, path: '' }]
  while (work.length) {
    const item = work.pop()!
    if (item.value === null || typeof item.value !== 'object') continue
    const keys = Object.keys(item.value)
    result[item.path] = keys
    for (const key of keys)
      work.push({ value: mutableObject(item.value)[key], path: `${item.path}/${pointerKey(key)}` })
  }
  return result
}
function rawAliasScenario(p: Portfolio, operations: RawAliasOperation[]): unknown[] {
  const events = new Map<string, AccountEvent>()
  const retained = new Map<string, ReturnType<Portfolio['snapshot']>>()
  const observations: unknown[] = []
  const resolve = (selection: AliasPath): unknown => {
    let value: unknown =
      selection.root === 'event' ? events.get(selection.id) : retained.get(selection.id)
    for (const key of selection.path) value = mutableObject(value)[key]
    return value
  }
  for (const operation of operations) {
    switch (operation.op) {
      case 'allocate':
        if (events.has(operation.id)) throw new Error('duplicate admitted event identity')
        events.set(operation.id, operation.event)
        break
      case 'set':
      case 'delete':
      case 'link': {
        let object: unknown = events.get(operation.id)
        for (const key of operation.path.slice(0, -1)) object = mutableObject(object)[key]
        const target = mutableObject(object),
          key = operation.path.at(-1)!
        if (operation.op === 'delete') delete target[key]
        else target[key] = operation.op === 'link' ? resolve(operation.source) : operation.value
        break
      }
      case 'apply':
        p.apply(events.get(operation.id)!)
        break
      case 'retain':
        retained.set(operation.id, p.snapshot())
        break
      case 'same':
        observations.push({
          label: operation.label,
          same: resolve(operation.left) === resolve(operation.right),
        })
        break
      case 'observe': {
        const current = p.snapshot()
        const payloadIdentities = (snapshot: ReturnType<Portfolio['snapshot']>) => ({
          fills: snapshot.recentFills.map((fill) =>
            [...events]
              .filter(([, event]) => event.kind === 'fill' && event.fill === fill)
              .map(([id]) => id),
          ),
          splits: (snapshot.recentSplits ?? []).map((split) =>
            [...events]
              .filter(([, event]) => event.kind === 'positions_split' && event.split === split)
              .map(([id]) => id),
          ),
        })
        observations.push({
          label: operation.label,
          current: JSON.parse(JSON.stringify(current)),
          currentNumberBits: opaqueNumberBits(current, true),
          currentKeys: ownPropertyKeys(current),
          currentPayloadIdentities: payloadIdentities(current),
          retained: Object.fromEntries(
            [...retained].map(([id, snapshot]) => [
              id,
              {
                snapshot: JSON.parse(JSON.stringify(snapshot)),
                snapshotNumberBits: opaqueNumberBits(snapshot, true),
                keys: ownPropertyKeys(snapshot),
                sameAsCurrent: snapshot === current,
                payloadIdentities: payloadIdentities(snapshot),
              },
            ]),
          ),
          events: Object.fromEntries(
            [...events].map(([id, event]) => [
              id,
              {
                value: JSON.parse(JSON.stringify(event)),
                numberBits: opaqueNumberBits(event, true),
                keys: ownPropertyKeys(event),
              },
            ]),
          ),
        })
        break
      }
    }
  }
  return observations
}

const document = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { cases: Case[] }
const results = document.cases.map(({ name, input }) => {
  const realNow = Date.now
  Date.now = () => input.initialNowMs ?? 9_000_000
  let p: Portfolio
  try {
    p = new Portfolio(input.options)
  } catch (error) {
    return { name, result: { error: error instanceof Error ? error.message : String(error) } }
  } finally {
    Date.now = realNow
  }
  const snapshots: unknown[] = []
  const cacheReuse: boolean[] = []
  const encodedEvents: unknown[] = []
  const opaqueKeys: Record<string, string[]>[] = []
  const opaqueBits: Record<string, string>[] = []
  const snapshotNumberBits: Record<string, string>[] = []
  const mapKeys: Record<string, string[]>[] = []
  const capture = () => {
    const current = p.snapshot()
    cacheReuse.push(current === p.snapshot())
    snapshots.push(JSON.parse(JSON.stringify(current)))
    opaqueKeys.push(opaqueObjectKeys(current))
    opaqueBits.push(opaqueNumberBits(current))
    snapshotNumberBits.push(opaqueNumberBits(current, true))
    mapKeys.push({
      positionsByAssetId: Object.keys(current.positionsByAssetId),
      openOrdersByClientId: Object.keys(current.openOrdersByClientId),
      wsOpenOrdersByOrderId: Object.keys(current.wsOpenOrdersByOrderId ?? {}),
      ordersByClientId: Object.keys(current.ordersByClientId),
      marketByAssetId: Object.keys(current.marketByAssetId),
    })
  }
  capture()
  let retainedSnapshot: ReturnType<Portfolio['snapshot']> | undefined
  let retainedOpenOrder: OpenOrder | undefined
  let retainedHistory: unknown
  for (const step of input.steps) {
    if (step.event) {
      encodedEvents.push(JSON.parse(JSON.stringify(step.event)))
      p.apply(step.event)
    } else if (step.initializeClock !== undefined) p.initializeClock(step.initializeClock)
    if (input.aliasProbe && !retainedSnapshot && step.event?.kind === 'order_submitted') {
      retainedSnapshot = p.snapshot()
      retainedOpenOrder = retainedSnapshot.openOrdersByClientId[step.event.order.clientOrderId]
      retainedHistory = retainedSnapshot.ordersByClientId[step.event.order.clientOrderId]
    }
    if (step.capture !== false) capture()
  }
  let mutableAliases: unknown
  if (input.mutableAliasesProbe) {
    const retained = p.snapshot()
    const position = retained.positionsByAssetId.up!
    const recentFill = retained.recentFills[0]!
    const recentSplit = retained.recentSplits![0]!
    const open = retained.openOrdersByClientId.a!
    const submitted = input.steps.find((step) => step.event?.kind === 'order_submitted')!.event
    const rawFill = input.steps.find((step) => step.event?.kind === 'fill')!.event
    const rawSplit = input.steps.find((step) => step.event?.kind === 'positions_split')!.event
    if (
      submitted?.kind !== 'order_submitted' ||
      rawFill?.kind !== 'fill' ||
      rawSplit?.kind !== 'positions_split'
    )
      throw new Error('alias probe setup')
    mutableAliases = {
      recentFillIsRawInput: recentFill === rawFill.fill,
      recentSplitIsRawInput: recentSplit === rawSplit.split,
      openOrderIsRawInput: open === submitted.order,
      orderMetaIsShared:
        open.meta === retained.ordersByClientId.a!.meta && open.meta === submitted.order.meta,
    }
    position.qty = 123
    rawFill.fill.intentMeta!.probe = 'mutated-after-apply'
    rawSplit.split.reason = 'mutated-after-apply'
    submitted.order.meta!.probe = 'mutated-after-apply'
    p.apply({ kind: 'account_stream_status', tsMs: 1200, source: 'user_ws', status: 'connected' })
    mutableAliases = {
      ...(mutableAliases as Record<string, unknown>),
      retainedAfterExternalMutation: JSON.parse(JSON.stringify(retained)),
      currentAfterExternalMutation: JSON.parse(JSON.stringify(p.snapshot())),
    }
  }
  return {
    name,
    result: {
      snapshots,
      cacheReuse,
      mapKeys,
      encodedEvents,
      opaqueKeys,
      opaqueBits,
      snapshotNumberBits,
      ...(input.rawAliasOperations
        ? { rawAliasObservations: rawAliasScenario(p, input.rawAliasOperations) }
        : {}),
    },
    ...(input.mutableAliasesProbe ? { mutableAliases } : {}),
    ...(input.aliasProbe
      ? {
          referenceAliasing: {
            retainedSnapshot: JSON.parse(JSON.stringify(retainedSnapshot)),
            retainedOpenOrder: JSON.parse(JSON.stringify(retainedOpenOrder)),
            retainedHistory: JSON.parse(JSON.stringify(retainedHistory)),
            sameOpenOrderIdentity:
              retainedOpenOrder ===
              retainedSnapshot?.openOrdersByClientId[retainedOpenOrder!.clientOrderId],
          },
        }
      : {}),
  }
})
process.stdout.write(JSON.stringify(results))
