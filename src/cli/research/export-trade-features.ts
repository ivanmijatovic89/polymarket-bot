import fs from 'node:fs/promises'
import path from 'node:path'
import { closeDb } from '../../db/index.js'
import { getBacktestRunById } from '../../db/backtests.js'

type WindowMetric = {
  window: string
  netChange?: number
  highLowRange?: number
}

type OrderbookLevel = {
  level: number
  upBidDepth?: number
  downBidDepth?: number
  weakBidSide?: string
  weakBidRatio?: number
  isMyOrderOnWeakBidSide?: boolean
}

type TechnicalIndicators = {
  meta?: {
    session?: string
    dayOfWeekUTC?: number
    hourOfDayUTC?: number
  }
  tf1h?: {
    rv20?: number
    rv80?: number
    bbWidth?: number
    atr14Pct?: number
    wickRatio?: number
    hlRangePct?: number
    rv20Over80?: number
  }
  tf15m?: {
    rv20?: number
    atr14Pct?: number
    wickRatio?: number
    hlRangePct?: number
  }
}

type IntentMeta = {
  windowsMetrics?: WindowMetric[]
  orderbookLevels?: OrderbookLevel[]
  technicalIndicators?: TechnicalIndicators
}

type MarketStatsLike = {
  slug?: string
  pnl?: number
  intentMeta?: IntentMeta[]
}

const WINDOWS = ['1s', '3s', '5s', '10s', '20s', '30s', '45s', '60s', '120s', '180s', '220s']

const ORDERBOOK_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const CSV_HEADERS = [
  'slug',
  'isWin',
  'pnl',
  ...WINDOWS.map((w) => `netChange_${w}`),
  ...WINDOWS.map((w) => `highLowRange_${w}`),
  ...ORDERBOOK_LEVELS.flatMap((lvl) => [
    `ob_${lvl}_upBidDepth`,
    `ob_${lvl}_downBidDepth`,
    `ob_${lvl}_weakBidSide`,
    `ob_${lvl}_weakBidRatio`,
    `ob_${lvl}_isMyOrderOnWeakBidSide`,
  ]),
  'ta_tf1h_rv20',
  'ta_tf1h_rv80',
  'ta_tf1h_bbWidth',
  'ta_tf1h_atr14Pct',
  'ta_tf1h_wickRatio',
  'ta_tf1h_hlRangePct',
  'ta_tf1h_rv20Over80',
  'ta_tf15m_rv20',
  'ta_tf15m_atr14Pct',
  'ta_tf15m_wickRatio',
  'ta_tf15m_hlRangePct',
  'ta_meta_session',
  'ta_meta_dayOfWeekUTC',
  'ta_meta_hourOfDayUTC',
]

const ORDERBOOK_HEADERS = [
  'slug',
  'isWin',
  'pnl',
  ...ORDERBOOK_LEVELS.flatMap((lvl) => [
    `ob_${lvl}_upBidDepth`,
    `ob_${lvl}_downBidDepth`,
    `ob_${lvl}_weakBidSide`,
    `ob_${lvl}_weakBidRatio`,
    `ob_${lvl}_isMyOrderOnWeakBidSide`,
  ]),
]

const NETCHANGE_HEADERS = ['slug', 'isWin', 'pnl', ...WINDOWS.map((w) => `netChange_${w}`)]
const HIGHLOW_HEADERS = ['slug', 'isWin', 'pnl', ...WINDOWS.map((w) => `highLowRange_${w}`)]
const TA_HEADERS = [
  'slug',
  'isWin',
  'pnl',
  'ta_tf1h_rv20',
  'ta_tf1h_rv80',
  'ta_tf1h_bbWidth',
  'ta_tf1h_atr14Pct',
  'ta_tf1h_wickRatio',
  'ta_tf1h_hlRangePct',
  'ta_tf1h_rv20Over80',
  'ta_tf15m_rv20',
  'ta_tf15m_atr14Pct',
  'ta_tf15m_wickRatio',
  'ta_tf15m_hlRangePct',
  'ta_meta_session',
  'ta_meta_dayOfWeekUTC',
  'ta_meta_hourOfDayUTC',
]

function parseArgs(argv: string[]) {
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key) continue
    if (key.startsWith('--')) {
      const value = argv[i + 1]
      if (value && !value.startsWith('--')) {
        args.set(key, value)
        i += 1
      } else {
        args.set(key, '')
      }
    }
  }
  return args
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function csvEscape(value: string): string {
  if (value.includes('"')) {
    value = value.replace(/"/g, '""')
  }
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value}"`
  }
  return value
}

function toCsvRow(values: Array<string | number | boolean | null | undefined>) {
  return values
    .map((value) => {
      if (value === null || value === undefined || value === '') return ''
      return csvEscape(String(value))
    })
    .join(',')
}

function pickValues(headers: string[], row: Record<string, string | number | boolean | null>) {
  return headers.map((key) => row[key] ?? '')
}

function pickRow(
  headers: string[],
  row: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const picked: Record<string, string | number | boolean | null> = {}
  for (const key of headers) {
    picked[key] = row[key] ?? null
  }
  return picked
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const idRaw = args.get('--id')
  const id = idRaw ? Number(idRaw) : NaN
  const splitRaw = args.get('--split')
  const splitRatio = splitRaw ? Number(splitRaw) : 0.7

  if (!Number.isFinite(id)) {
    throw new Error(
      'Usage: tsx src/cli/research/export-trade-features.ts --id <backtestId> [--split 0.7]',
    )
  }
  if (!Number.isFinite(splitRatio) || splitRatio <= 0 || splitRatio >= 1) {
    throw new Error('[export-trade-features] --split must be between 0 and 1 (exclusive)')
  }

  const row = await getBacktestRunById(id)
  if (!row) {
    throw new Error(`[export-trade-features] backtest id not found: ${id}`)
  }

  const rawStats = row.marketStats
  if (!Array.isArray(rawStats)) {
    throw new Error('[export-trade-features] marketStats is not an array')
  }

  const outputDir = path.join(process.cwd(), 'data', 'research-backtest', String(id))
  await fs.mkdir(outputDir, { recursive: true })

  const allCsvRows: string[] = [toCsvRow(CSV_HEADERS)]
  const allJsonRows: Array<Record<string, string | number | boolean | null>> = []

  for (const item of rawStats) {
    if (!isObject(item)) continue
    const market = item as MarketStatsLike
    const pnl = toNumber(market.pnl)
    if (pnl === null || pnl === 0) continue

    const slug = typeof market.slug === 'string' ? market.slug : ''
    const isWin = pnl > 0

    const firstMeta = Array.isArray(market.intentMeta) ? market.intentMeta[0] : undefined
    const windowsMetrics = Array.isArray(firstMeta?.windowsMetrics) ? firstMeta?.windowsMetrics : []
    const orderbookLevels = Array.isArray(firstMeta?.orderbookLevels)
      ? firstMeta?.orderbookLevels
      : []
    const technicalIndicators = isObject(firstMeta?.technicalIndicators)
      ? (firstMeta?.technicalIndicators as TechnicalIndicators)
      : undefined

    const windowMap = new Map<string, WindowMetric>()
    for (const metric of windowsMetrics) {
      if (!metric || typeof metric.window !== 'string') continue
      windowMap.set(metric.window, metric)
    }

    const orderbookMap = new Map<number, OrderbookLevel>()
    for (const level of orderbookLevels) {
      if (!level || typeof level.level !== 'number') continue
      orderbookMap.set(level.level, level)
    }

    const rowObj: Record<string, string | number | boolean | null> = {
      slug,
      isWin,
      pnl,
    }

    for (const window of WINDOWS) {
      const metric = windowMap.get(window)
      rowObj[`netChange_${window}`] = toNumber(metric?.netChange) ?? null
    }
    for (const window of WINDOWS) {
      const metric = windowMap.get(window)
      rowObj[`highLowRange_${window}`] = toNumber(metric?.highLowRange) ?? null
    }

    for (const level of ORDERBOOK_LEVELS) {
      const ob = orderbookMap.get(level)
      rowObj[`ob_${level}_upBidDepth`] = toNumber(ob?.upBidDepth) ?? null
      rowObj[`ob_${level}_downBidDepth`] = toNumber(ob?.downBidDepth) ?? null
      rowObj[`ob_${level}_weakBidSide`] =
        typeof ob?.weakBidSide === 'string' ? ob?.weakBidSide : null
      rowObj[`ob_${level}_weakBidRatio`] = toNumber(ob?.weakBidRatio) ?? null
      rowObj[`ob_${level}_isMyOrderOnWeakBidSide`] =
        typeof ob?.isMyOrderOnWeakBidSide === 'boolean' ? ob?.isMyOrderOnWeakBidSide : null
    }

    rowObj['ta_tf1h_rv20'] = toNumber(technicalIndicators?.tf1h?.rv20) ?? null
    rowObj['ta_tf1h_rv80'] = toNumber(technicalIndicators?.tf1h?.rv80) ?? null
    rowObj['ta_tf1h_bbWidth'] = toNumber(technicalIndicators?.tf1h?.bbWidth) ?? null
    rowObj['ta_tf1h_atr14Pct'] = toNumber(technicalIndicators?.tf1h?.atr14Pct) ?? null
    rowObj['ta_tf1h_wickRatio'] = toNumber(technicalIndicators?.tf1h?.wickRatio) ?? null
    rowObj['ta_tf1h_hlRangePct'] = toNumber(technicalIndicators?.tf1h?.hlRangePct) ?? null
    rowObj['ta_tf1h_rv20Over80'] = toNumber(technicalIndicators?.tf1h?.rv20Over80) ?? null

    rowObj['ta_tf15m_rv20'] = toNumber(technicalIndicators?.tf15m?.rv20) ?? null
    rowObj['ta_tf15m_atr14Pct'] = toNumber(technicalIndicators?.tf15m?.atr14Pct) ?? null
    rowObj['ta_tf15m_wickRatio'] = toNumber(technicalIndicators?.tf15m?.wickRatio) ?? null
    rowObj['ta_tf15m_hlRangePct'] = toNumber(technicalIndicators?.tf15m?.hlRangePct) ?? null

    rowObj['ta_meta_session'] =
      typeof technicalIndicators?.meta?.session === 'string'
        ? technicalIndicators?.meta?.session
        : null
    rowObj['ta_meta_dayOfWeekUTC'] = toNumber(technicalIndicators?.meta?.dayOfWeekUTC) ?? null
    rowObj['ta_meta_hourOfDayUTC'] = toNumber(technicalIndicators?.meta?.hourOfDayUTC) ?? null

    allJsonRows.push(rowObj)
    allCsvRows.push(toCsvRow(pickValues(CSV_HEADERS, rowObj)))
  }

  const total = allJsonRows.length
  const searchCount = Math.floor(total * splitRatio)
  const searchJsonRows = allJsonRows.slice(0, searchCount)
  const testJsonRows = allJsonRows.slice(searchCount)

  const searchCsvRows = [toCsvRow(CSV_HEADERS)]
  for (const row of searchJsonRows) {
    searchCsvRows.push(toCsvRow(pickValues(CSV_HEADERS, row)))
  }
  const testCsvRows = [toCsvRow(CSV_HEADERS)]
  for (const row of testJsonRows) {
    testCsvRows.push(toCsvRow(pickValues(CSV_HEADERS, row)))
  }

  const orderbookDir = path.join(outputDir, 'orderbook')
  const netChangeDir = path.join(outputDir, 'netChange')
  const highLowRangeDir = path.join(outputDir, 'highLowRange')
  const taDir = path.join(outputDir, 'ta')

  await fs.mkdir(orderbookDir, { recursive: true })
  await fs.mkdir(netChangeDir, { recursive: true })
  await fs.mkdir(highLowRangeDir, { recursive: true })
  await fs.mkdir(taDir, { recursive: true })

  const orderbookAllCsv = [toCsvRow(ORDERBOOK_HEADERS)]
  const orderbookAllJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of allJsonRows) {
    orderbookAllJson.push(pickRow(ORDERBOOK_HEADERS, row))
    orderbookAllCsv.push(toCsvRow(pickValues(ORDERBOOK_HEADERS, row)))
  }
  const orderbookSearchCsv = [toCsvRow(ORDERBOOK_HEADERS)]
  const orderbookSearchJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of searchJsonRows) {
    orderbookSearchJson.push(pickRow(ORDERBOOK_HEADERS, row))
    orderbookSearchCsv.push(toCsvRow(pickValues(ORDERBOOK_HEADERS, row)))
  }
  const orderbookTestCsv = [toCsvRow(ORDERBOOK_HEADERS)]
  const orderbookTestJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of testJsonRows) {
    orderbookTestJson.push(pickRow(ORDERBOOK_HEADERS, row))
    orderbookTestCsv.push(toCsvRow(pickValues(ORDERBOOK_HEADERS, row)))
  }

  const netChangeAllCsv = [toCsvRow(NETCHANGE_HEADERS)]
  const netChangeAllJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of allJsonRows) {
    netChangeAllJson.push(pickRow(NETCHANGE_HEADERS, row))
    netChangeAllCsv.push(toCsvRow(pickValues(NETCHANGE_HEADERS, row)))
  }
  const netChangeSearchCsv = [toCsvRow(NETCHANGE_HEADERS)]
  const netChangeSearchJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of searchJsonRows) {
    netChangeSearchJson.push(pickRow(NETCHANGE_HEADERS, row))
    netChangeSearchCsv.push(toCsvRow(pickValues(NETCHANGE_HEADERS, row)))
  }
  const netChangeTestCsv = [toCsvRow(NETCHANGE_HEADERS)]
  const netChangeTestJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of testJsonRows) {
    netChangeTestJson.push(pickRow(NETCHANGE_HEADERS, row))
    netChangeTestCsv.push(toCsvRow(pickValues(NETCHANGE_HEADERS, row)))
  }

  const highLowAllCsv = [toCsvRow(HIGHLOW_HEADERS)]
  const highLowAllJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of allJsonRows) {
    highLowAllJson.push(pickRow(HIGHLOW_HEADERS, row))
    highLowAllCsv.push(toCsvRow(pickValues(HIGHLOW_HEADERS, row)))
  }
  const highLowSearchCsv = [toCsvRow(HIGHLOW_HEADERS)]
  const highLowSearchJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of searchJsonRows) {
    highLowSearchJson.push(pickRow(HIGHLOW_HEADERS, row))
    highLowSearchCsv.push(toCsvRow(pickValues(HIGHLOW_HEADERS, row)))
  }
  const highLowTestCsv = [toCsvRow(HIGHLOW_HEADERS)]
  const highLowTestJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of testJsonRows) {
    highLowTestJson.push(pickRow(HIGHLOW_HEADERS, row))
    highLowTestCsv.push(toCsvRow(pickValues(HIGHLOW_HEADERS, row)))
  }

  const taAllCsv = [toCsvRow(TA_HEADERS)]
  const taAllJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of allJsonRows) {
    taAllJson.push(pickRow(TA_HEADERS, row))
    taAllCsv.push(toCsvRow(pickValues(TA_HEADERS, row)))
  }
  const taSearchCsv = [toCsvRow(TA_HEADERS)]
  const taSearchJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of searchJsonRows) {
    taSearchJson.push(pickRow(TA_HEADERS, row))
    taSearchCsv.push(toCsvRow(pickValues(TA_HEADERS, row)))
  }
  const taTestCsv = [toCsvRow(TA_HEADERS)]
  const taTestJson: Array<Record<string, string | number | boolean | null>> = []
  for (const row of testJsonRows) {
    taTestJson.push(pickRow(TA_HEADERS, row))
    taTestCsv.push(toCsvRow(pickValues(TA_HEADERS, row)))
  }

  const allCsvPath = path.join(outputDir, 'ALL_trades_features.csv')
  const allJsonPath = path.join(outputDir, 'ALL_trades_features.json')
  const searchCsvPath = path.join(outputDir, 'SEARCH_trades_features.csv')
  const searchJsonPath = path.join(outputDir, 'SEARCH_trades_features.json')
  const testCsvPath = path.join(outputDir, 'TEST_trades_features.csv')
  const testJsonPath = path.join(outputDir, 'TEST_trades_features.json')

  await fs.writeFile(allCsvPath, allCsvRows.join('\n'))
  await fs.writeFile(allJsonPath, JSON.stringify(allJsonRows, null, 2))
  await fs.writeFile(searchCsvPath, searchCsvRows.join('\n'))
  await fs.writeFile(searchJsonPath, JSON.stringify(searchJsonRows, null, 2))
  await fs.writeFile(testCsvPath, testCsvRows.join('\n'))
  await fs.writeFile(testJsonPath, JSON.stringify(testJsonRows, null, 2))

  await fs.writeFile(path.join(orderbookDir, 'ALL_trades_features.csv'), orderbookAllCsv.join('\n'))
  await fs.writeFile(
    path.join(orderbookDir, 'ALL_trades_features.json'),
    JSON.stringify(orderbookAllJson, null, 2),
  )
  await fs.writeFile(
    path.join(orderbookDir, 'SEARCH_trades_features.csv'),
    orderbookSearchCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(orderbookDir, 'SEARCH_trades_features.json'),
    JSON.stringify(orderbookSearchJson, null, 2),
  )
  await fs.writeFile(
    path.join(orderbookDir, 'TEST_trades_features.csv'),
    orderbookTestCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(orderbookDir, 'TEST_trades_features.json'),
    JSON.stringify(orderbookTestJson, null, 2),
  )

  await fs.writeFile(path.join(netChangeDir, 'ALL_trades_features.csv'), netChangeAllCsv.join('\n'))
  await fs.writeFile(
    path.join(netChangeDir, 'ALL_trades_features.json'),
    JSON.stringify(netChangeAllJson, null, 2),
  )
  await fs.writeFile(
    path.join(netChangeDir, 'SEARCH_trades_features.csv'),
    netChangeSearchCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(netChangeDir, 'SEARCH_trades_features.json'),
    JSON.stringify(netChangeSearchJson, null, 2),
  )
  await fs.writeFile(
    path.join(netChangeDir, 'TEST_trades_features.csv'),
    netChangeTestCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(netChangeDir, 'TEST_trades_features.json'),
    JSON.stringify(netChangeTestJson, null, 2),
  )

  await fs.writeFile(
    path.join(highLowRangeDir, 'ALL_trades_features.csv'),
    highLowAllCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(highLowRangeDir, 'ALL_trades_features.json'),
    JSON.stringify(highLowAllJson, null, 2),
  )
  await fs.writeFile(
    path.join(highLowRangeDir, 'SEARCH_trades_features.csv'),
    highLowSearchCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(highLowRangeDir, 'SEARCH_trades_features.json'),
    JSON.stringify(highLowSearchJson, null, 2),
  )
  await fs.writeFile(
    path.join(highLowRangeDir, 'TEST_trades_features.csv'),
    highLowTestCsv.join('\n'),
  )
  await fs.writeFile(
    path.join(highLowRangeDir, 'TEST_trades_features.json'),
    JSON.stringify(highLowTestJson, null, 2),
  )

  await fs.writeFile(path.join(taDir, 'ALL_trades_features.csv'), taAllCsv.join('\n'))
  await fs.writeFile(
    path.join(taDir, 'ALL_trades_features.json'),
    JSON.stringify(taAllJson, null, 2),
  )
  await fs.writeFile(path.join(taDir, 'SEARCH_trades_features.csv'), taSearchCsv.join('\n'))
  await fs.writeFile(
    path.join(taDir, 'SEARCH_trades_features.json'),
    JSON.stringify(taSearchJson, null, 2),
  )
  await fs.writeFile(path.join(taDir, 'TEST_trades_features.csv'), taTestCsv.join('\n'))
  await fs.writeFile(
    path.join(taDir, 'TEST_trades_features.json'),
    JSON.stringify(taTestJson, null, 2),
  )

  await closeDb()
  console.log(
    `[export-trade-features] wrote ALL=${total} SEARCH=${searchJsonRows.length} TEST=${testJsonRows.length} -> ${path.relative(
      process.cwd(),
      outputDir,
    )}`,
  )
}

main().catch((err) => {
  console.error('[export-trade-features] failed', err)
  closeDb().catch(() => {})
  process.exit(1)
})
