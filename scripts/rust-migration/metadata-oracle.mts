// Test-only independent JS object graph oracle; no strategy bundle execution.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

type Container = Record<string, unknown> | unknown[]
type Encoded = { kind: string; bits?: string; value?: unknown; units?: number[]; id?: string }
type Action = {
  op: string
  id?: string
  from?: string
  array?: boolean
  key?: number[]
  value?: Encoded
  index?: number
  length?: number
  same?: string
}
type Case = { name: string; actions: Action[]; expected?: unknown[] }
const text = (units: number[]) => units.map((unit) => String.fromCharCode(unit)).join('')
const units = (text: string) =>
  Array.from({ length: text.length }, (_, index) => text.charCodeAt(index))
function decode(value: Encoded, roots: Map<string, Container>): unknown {
  switch (value.kind) {
    case 'missing':
      return undefined
    case 'null':
      return null
    case 'bool':
      return value.value
    case 'number':
      return Buffer.from(value.bits!, 'hex').readDoubleBE()
    case 'string':
      return text(value.units!)
    case 'ref':
      return roots.get(value.id!)!
    case 'tree':
      return structuredClone(value.value)
    default:
      throw new Error('Unknown fixture value')
  }
}
function encode(value: unknown, same: Container | undefined): unknown {
  if (value === undefined) return { kind: 'missing' }
  if (value === null) return { kind: 'null' }
  if (typeof value === 'boolean') return { kind: 'bool', value }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { kind: 'nan' }
    const buffer = Buffer.alloc(8)
    buffer.writeDoubleBE(value)
    return { kind: 'number', bits: buffer.toString('hex') }
  }
  if (typeof value === 'string') return { kind: 'string', units: units(value) }
  return {
    kind: 'reference',
    array: Array.isArray(value),
    same: same === undefined ? null : value === same,
  }
}
function run(row: Case) {
  const roots = new Map<string, Container>()
  const output: unknown[] = []
  for (const action of row.actions) {
    const object = roots.get(action.id!) as Record<string, unknown>
    switch (action.op) {
      case 'new':
        roots.set(action.id!, action.array ? [] : {})
        break
      // DefineProperty retains a literal __proto__ field rather than invoking
      // Object.prototype's setter; metadata ingestion has data-property semantics.
      case 'set':
        Object.defineProperty(object, text(action.key!), {
          value: decode(action.value!, roots),
          writable: true,
          enumerable: true,
          configurable: true,
        })
        break
      case 'push':
        ;(object as unknown as unknown[]).push(decode(action.value!, roots))
        break
      case 'index':
        object[action.index!] = decode(action.value!, roots)
        break
      case 'length':
        ;(object as unknown as unknown[]).length = action.length!
        break
      case 'delete':
        delete object[text(action.key!)]
        break
      case 'deleteIndex':
        delete object[action.index!]
        break
      case 'alias':
        roots.set(action.id!, roots.get(action.from!)!)
        break
      case 'getAlias': {
        const parent = roots.get(action.from!) as Record<string, unknown>
        roots.set(action.id!, parent[action.index ?? text(action.key!)] as Container)
        break
      }
      case 'drop':
        roots.delete(action.id!)
        break
      case 'collect':
        break // Native collection must preserve JS reachable values.
      case 'snapshot': {
        try {
          output.push({
            kind: 'snapshot',
            json: JSON.stringify(decode(action.value!, roots)) ?? null,
          })
        } catch (error) {
          if (
            !(error instanceof TypeError) ||
            !error.message.startsWith('Converting circular structure to JSON')
          )
            throw error
          output.push({
            kind: 'error',
            error: 'TypeError',
            message: 'Converting circular structure to JSON',
          })
        }
        break
      }
      case 'keys':
        output.push({ kind: 'keys', units: Object.keys(object).map(units) })
        break
      case 'probe': {
        const key = action.index ?? text(action.key!)
        const value = Object.hasOwn(object, key) ? object[key] : undefined
        output.push({
          kind: 'probe',
          value: encode(value, action.same === undefined ? undefined : roots.get(action.same)),
          truthy: Boolean(value),
        })
        break
      }
      default:
        throw new Error('Unknown fixture action')
    }
  }
  if (row.expected !== undefined && JSON.stringify(output) !== JSON.stringify(row.expected))
    throw new Error('Actual pinned Observer trace differs from generic JS replay')
  return { name: row.name, output }
}
function treeValue(value: unknown): Encoded {
  return { kind: 'tree', value: structuredClone(value) }
}
async function observerCase(sourcePath: string): Promise<Case> {
  const source = fs.readFileSync(sourcePath)
  if (
    crypto.createHash('sha256').update(source).digest('hex') !==
    '9dc0a9806229f96c309ad53e3cf6105e86fcbf6859fb6de7757d94f6f7fee682'
  )
    throw new Error('Pinned Observer bytes differ')
  // This reviewed helper has only crypto/fs/path imports plus erased types.
  // Synthetic source.kind prevents its optional Parquet file-read branch.
  const { Observer } = await import(pathToFileURL(sourcePath).href)
  const observer = new Observer('fixture', 'market', 'up', 'down')
  const meta: Record<string, unknown> = { decision: 'buy' }
  const portfolio = { positionsByAssetId: {}, ordersByClientId: {} }
  const actions: Action[] = [
    { op: 'new', id: 'meta' },
    { op: 'set', id: 'meta', key: units('decision'), value: { kind: 'tree', value: 'buy' } },
    { op: 'new', id: 'tape' },
  ]
  for (const [key, value] of Object.entries(observer.tape))
    actions.push({ op: 'set', id: 'tape', key: units(key), value: treeValue(value) })
  actions.push(
    { op: 'getAlias', id: 'path', from: 'tape', key: units('path') },
    { op: 'getAlias', id: 'errors', from: 'tape', key: units('errors') },
  )
  for (const [id, from] of [
    ['order', 'meta'],
    ['history', 'order'],
    ['trade', 'history'],
    ['stats', 'trade'],
  ])
    actions.push({ op: 'alias', id, from })
  const expected: unknown[] = []
  let pathLength = 0
  let errorsLength = 0
  let attached = false
  const capture = () => {
    for (const [key, value] of Object.entries(observer.tape)) {
      if (key === 'path' || key === 'errors') continue
      actions.push({ op: 'set', id: 'tape', key: units(key), value: treeValue(value) })
    }
    for (const value of observer.tape.path.slice(pathLength))
      actions.push({ op: 'push', id: 'path', value: treeValue(value) })
    for (const value of observer.tape.errors.slice(errorsLength))
      actions.push({ op: 'push', id: 'errors', value: treeValue(value) })
    pathLength = observer.tape.path.length
    errorsLength = observer.tape.errors.length
    if (!attached && meta.pairLeagueTape === observer.tape) {
      actions.push({
        op: 'set',
        id: 'meta',
        key: units('pairLeagueTape'),
        value: { kind: 'ref', id: 'tape' },
      })
      attached = true
    }
    actions.push({ op: 'snapshot', value: { kind: 'ref', id: 'stats' } })
    expected.push({ kind: 'snapshot', json: JSON.stringify(meta) })
  }
  await observer.tick(
    { source: { kind: 'metadata-fixture' }, snapshot: { timestamp: 1 } },
    portfolio,
  )
  capture()
  observer.place(
    { clientOrderId: 'order', assetId: 'up', price: 0.5, size: 2, reason: 'fixture', meta },
    portfolio,
    2,
  )
  capture()
  const fill = {
    id: 'fill',
    clientOrderId: 'order',
    assetId: 'up',
    price: 0.5,
    size: 1,
    liquidity: 'MAKER',
    feeRateBps: 0,
    side: 'BUY',
    tsMs: 3,
  }
  observer.account({ kind: 'fill', fill }, portfolio)
  capture()
  await observer.tick(
    { source: { kind: 'metadata-fixture' }, snapshot: { timestamp: 4 } },
    portfolio,
  )
  capture()
  observer.account({ kind: 'fill', fill: { ...fill, tsMs: 5 } }, portfolio)
  capture()
  observer.account(
    { kind: 'order_done', clientOrderId: 'order', reason: 'canceled', tsMs: 6 },
    portfolio,
  )
  capture()
  actions.push(
    { op: 'drop', id: 'meta' },
    { op: 'drop', id: 'order' },
    { op: 'drop', id: 'history' },
    { op: 'drop', id: 'trade' },
    { op: 'collect' },
    { op: 'snapshot', value: { kind: 'ref', id: 'stats' } },
  )
  expected.push({ kind: 'snapshot', json: JSON.stringify(meta) })
  return { name: 'actual-pinned-observer-metadata-operation-trace', actions, expected }
}
if (process.argv[2] === '--observer-fixture') {
  process.stdout.write(JSON.stringify(await observerCase(process.argv[3]!)))
} else {
  const rows = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as Case[]
  process.stdout.write(JSON.stringify(rows.map(run)))
}
