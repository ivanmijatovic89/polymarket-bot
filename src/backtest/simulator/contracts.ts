/** JSON-only display data. Nothing in this module runs or restores a strategy. */
import type { CapitalSnapshot } from '../../strategy/Strategy.js'

export type Outcome = 'UP' | 'DOWN'
export type DisplayBook = {
  timestamp: number
  bid: number | null
  ask: number | null
  bids: [number, number][]
  asks: [number, number][]
}
export type DisplayOrder = {
  id: string
  orderId: string | null
  assetId: string
  market: string | null
  outcome: string
  side: string
  price: number
  size: number
  filled: number
  remaining: number
  state: string
  type: string
  postOnly: boolean
  cancelRequested: boolean
  meta: Record<string, unknown> | null
}
export type DisplayPosition = { qty: number; cost: number; average: number | null }
export type DisplayState = {
  /** Absent in older traces. Never substitute aggregate run capital. */
  capital?: Readonly<CapitalSnapshot> | null
  up: DisplayPosition
  down: DisplayPosition
  orders: DisplayOrder[]
  cashDelta: number
  fees: number
  fills: number
  realized: number
}
export type TraceAction = {
  seq: number
  kind: string
  label: string
  state: number
  context: number
  detail: unknown
}
export type TraceFrame = {
  tick: number
  seq: number
  time: number
  exchangeTime: number
  receiveTime: number | null
  ingestSeq: string | null
  kind: string
  up: DisplayBook | null
  down: DisplayBook | null
  state: number
  context: number
  actions: TraceAction[]
}
export type TraceChunk = {
  version: 1
  frames: TraceFrame[]
  states: DisplayState[]
  contexts: unknown[]
}
export type ChunkIndex = {
  id: number
  firstTick: number
  lastTick: number
  startTime: number
  endTime: number
  bytes: number
}
export type ActionIndex = {
  tick: number
  seq: number
  time: number
  kind: string
  label: string
  /** Present only for fills. */
  price?: number
  outcome?: string
  side?: string
}
export type ChartPoint = {
  tick: number
  time: number
  upBid: number | null
  upAsk: number | null
  downBid: number | null
  downAsk: number | null
}
export type ReplayProvenance = {
  runId: number
  slug: string
  marketIndex: number
  strategy: string
  params: Record<string, unknown>
  artifactSha256: string | null
  originalCommit: string | null
  currentCommit: string
  sourceFingerprint: string
  dataset: string
  datasetSha256: string
  inputMode: string
  order: string
  timeDriven: boolean
  latency: { delayMs: number; jitterMs: number }
  window: { startMs: number; endMs: number } | null
  initialCapital: number
  outcome: Outcome
  settings: Record<string, unknown>
  warnings: string[]
}
export type ComparisonRow = {
  field: string
  saved: number
  replay: number | null
  matches: boolean
}
export type TraceManifest = {
  version: 1
  provenance: ReplayProvenance
  chunks: ChunkIndex[]
  actions: ActionIndex[]
  chart: ChartPoint[]
  ticks: number
  eventsProcessed: number
  startTime: number
  endTime: number
  comparison: ComparisonRow[]
  resultMatches: boolean
  durationMs: number
}
export type SimulatorStatus = {
  id: string
  runId: number
  slug: string
  status: 'queued' | 'running' | 'ready' | 'failed' | 'canceled'
  ticks: number
  message: string
  createdAt: number
}

export function emptyDisplayState(): DisplayState {
  return {
    capital: null,
    up: { qty: 0, cost: 0, average: null },
    down: { qty: 0, cost: 0, average: null },
    orders: [],
    cashDelta: 0,
    fees: 0,
    fills: 0,
    realized: 0,
  }
}

/** Capital comes from the engine; conditional PnL remains a separate cash-flow calculation. */
export function displayMetrics(state: DisplayState) {
  const pairs = Math.min(state.up.qty, state.down.qty)
  return {
    pairs,
    unpairedUp: state.up.qty - pairs,
    unpairedDown: state.down.qty - pairs,
    capital: state.capital ?? null,
    pnlIfUp: state.cashDelta + state.up.qty,
    pnlIfDown: state.cashDelta + state.down.qty,
  }
}

/** The amounts in the engine's rejection reason describe the funding check itself. */
export function capitalRejection(detail: unknown) {
  if (!detail || typeof detail !== 'object' || !('reason' in detail)) return null
  if (typeof detail.reason !== 'string') return null
  const match = /^insufficient_capital\(required=([\d.eE+-]+),available=([\d.eE+-]+)\)$/.exec(
    detail.reason,
  )
  if (!match) return null
  const required = Number(match[1]),
    available = Number(match[2])
  if (!Number.isFinite(required) || !Number.isFinite(available) || required < 0) return null
  return { required, available, shortfall: Math.max(0, required - available) }
}
