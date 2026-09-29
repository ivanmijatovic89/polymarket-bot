/** JSON-only display data. Nothing in this module runs or restores a strategy. */
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
    up: { qty: 0, cost: 0, average: null },
    down: { qty: 0, cost: 0, average: null },
    orders: [],
    cashDelta: 0,
    fees: 0,
    fills: 0,
    realized: 0,
  }
}

/** Display cash is fill cash flow; it is not an execution-enforced wallet. */
export function displayMetrics(state: DisplayState, capital: number) {
  const pairs = Math.min(state.up.qty, state.down.qty)
  const reserved = state.orders
    .filter((o) => o.side === 'BUY')
    .reduce((sum, o) => sum + o.price * o.remaining, 0)
  return {
    pairs,
    unpairedUp: state.up.qty - pairs,
    unpairedDown: state.down.qty - pairs,
    cash: capital + state.cashDelta,
    reserved,
    pnlIfUp: state.cashDelta + state.up.qty,
    pnlIfDown: state.cashDelta + state.down.qty,
  }
}
