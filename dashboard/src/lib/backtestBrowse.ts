export const BACKTEST_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'markets-total-desc', label: 'Markets total: high to low' },
  { value: 'markets-total-asc', label: 'Markets total: low to high' },
  { value: 'pnl-desc', label: 'PnL: high to low' },
  { value: 'pnl-asc', label: 'PnL: low to high' },
  { value: 'ev-desc', label: 'EV / played: high to low' },
  { value: 'ev-asc', label: 'EV / played: low to high' },
  { value: 'ev-total-desc', label: 'EV / total: high to low' },
  { value: 'ev-total-asc', label: 'EV / total: low to high' },
  { value: 'win-rate-desc', label: 'Win rate: high to low' },
  { value: 'win-rate-asc', label: 'Win rate: low to high' },
] as const

export type BacktestSort = (typeof BACKTEST_SORT_OPTIONS)[number]['value']
export type BacktestStatus = 'completed' | 'partial' | 'failed'
export const BACKTEST_METRIC_OPTIONS = [
  { value: 'markets-total', label: 'Markets total' },
  { value: 'markets-played', label: 'Markets played' },
  { value: 'ev-played', label: 'EV / played' },
  { value: 'ev-total', label: 'EV / total' },
  { value: 'pnl', label: 'PnL' },
] as const
export type BacktestMetric = (typeof BACKTEST_METRIC_OPTIONS)[number]['value']
export type BacktestNumericFilter = {
  metric: BacktestMetric
  operator: 'gt' | 'lt'
  value: number
}
export type BacktestFilters = {
  protocol: string
  model: string
  strategy: string
  symbol: string
  status: BacktestStatus | ''
}
export type BacktestBrowseState = BacktestFilters & {
  numericFilters: BacktestNumericFilter[]
  limit: number
  page: number
  sort: BacktestSort
  snapshot?: number
}

export const EMPTY_BACKTEST_FILTERS: BacktestFilters = {
  protocol: '',
  model: '',
  strategy: '',
  symbol: '',
  status: '',
}

export const DEFAULT_BACKTEST_LIMIT = 100

function positiveInteger(raw: string | null, fallback: number): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function readNumericFilter(raw: string): BacktestNumericFilter | undefined {
  const [metricRaw, operator, valueRaw, extra] = raw.split(':')
  const metric = BACKTEST_METRIC_OPTIONS.find((option) => option.value === metricRaw)?.value
  const value = valueRaw?.trim() ? Number(valueRaw) : NaN
  if (
    !metric ||
    (operator !== 'gt' && operator !== 'lt') ||
    !Number.isFinite(value) ||
    extra !== undefined
  ) {
    return undefined
  }
  return { metric, operator, value }
}

export function readBacktestBrowseState(
  sp: URLSearchParams,
  defaultLimit = DEFAULT_BACKTEST_LIMIT,
): BacktestBrowseState {
  const status = sp.get('status')
  const sort = sp.get('sort')
  const snapshotRaw = sp.get('snapshot')
  const snapshot = snapshotRaw?.trim() ? Number(snapshotRaw) : undefined
  return {
    protocol: sp.get('protocol') ?? '',
    model: sp.get('model') ?? '',
    strategy: sp.get('strategy') ?? '',
    symbol: sp.get('symbol') ?? '',
    status: status === 'completed' || status === 'partial' || status === 'failed' ? status : '',
    numericFilters: sp.getAll('condition').flatMap((raw) => {
      const filter = readNumericFilter(raw)
      return filter ? [filter] : []
    }),
    limit: Math.min(500, positiveInteger(sp.get('limit'), defaultLimit)),
    page: positiveInteger(sp.get('page'), 1),
    sort: BACKTEST_SORT_OPTIONS.find((option) => option.value === sort)?.value ?? 'newest',
    snapshot:
      snapshot !== undefined && Number.isSafeInteger(snapshot) && snapshot >= 0
        ? snapshot
        : undefined,
  }
}

export function backtestBrowseParams(state: BacktestBrowseState): URLSearchParams {
  const sp = new URLSearchParams()
  for (const key of ['protocol', 'model', 'strategy', 'symbol', 'status'] as const) {
    if (state[key]) sp.set(key, state[key])
  }
  for (const filter of state.numericFilters) {
    sp.append('condition', `${filter.metric}:${filter.operator}:${filter.value}`)
  }
  if (state.limit !== DEFAULT_BACKTEST_LIMIT) sp.set('limit', String(state.limit))
  if (state.page !== 1) sp.set('page', String(state.page))
  if (state.sort !== 'newest') sp.set('sort', state.sort)
  if (state.snapshot !== undefined) sp.set('snapshot', String(state.snapshot))
  return sp
}

/** Protocol and model changes discard dependent selections from the old scope. */
export function changeBacktestFilter<K extends keyof BacktestFilters>(
  state: BacktestBrowseState,
  key: K,
  value: BacktestFilters[K],
): BacktestBrowseState {
  const next = { ...state, [key]: value, page: 1, snapshot: undefined }
  if (key === 'protocol') {
    next.model = ''
    next.strategy = ''
  }
  if (key === 'model') next.strategy = ''
  return next
}

export function backtestPageBounds(total: number, limit: number, requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const page = Math.min(pageCount, Math.max(1, requestedPage))
  const offset = (page - 1) * limit
  return {
    page,
    pageCount,
    offset,
    start: total === 0 ? 0 : offset + 1,
    end: Math.min(total, offset + limit),
  }
}

export function backtestPageNumbers(page: number, pageCount: number): Array<number | 'ellipsis'> {
  const pages = new Set([1, pageCount])
  for (let n = Math.max(1, page - 1); n <= Math.min(pageCount, page + 1); n++) pages.add(n)
  const result: Array<number | 'ellipsis'> = []
  let previous = 0
  for (const n of [...pages].sort((a, b) => a - b)) {
    if (n - previous === 2) result.push(previous + 1)
    else if (n - previous > 2) result.push('ellipsis')
    result.push(n)
    previous = n
  }
  return result
}
