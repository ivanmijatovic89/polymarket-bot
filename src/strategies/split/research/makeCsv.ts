import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type WindowMetric = {
  window: string
  netChange: number
  highLowRange: number
}

type MarketResult = {
  pnl: number
  slug?: string
  intentMeta?: Array<{
    windowsMetrics?: WindowMetric[]
  }>
  tradeIntentMeta?: Array<{
    intentMeta?: {
      windowsMetrics?: WindowMetric[]
    }
  }>
}

const WINDOWS = ['1s', '3s', '5s', '10s', '20s', '30s', '45s', '60s', '120s', '180s', '220s']

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const inputPath = path.join(__dirname, 'results-SplitSellRedeem.v5.1-research-metrics.ts')
const netChangePath = path.join(__dirname, 'netChange.csv')
const highLowRangePath = path.join(__dirname, 'highLowRange.csv')
const netChangeJsonPath = path.join(__dirname, 'netChange.json')
const highLowRangeJsonPath = path.join(__dirname, 'highLowRange.json')
const tradesCsvPath = path.join(__dirname, 'trades.csv')
const tradesJsonPath = path.join(__dirname, 'trades.json')

const csvEscape = (value: string): string => {
  if (value.includes('"')) {
    value = value.replace(/"/g, '""')
  }
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value}"`
  }
  return value
}

const toCsvRow = (values: Array<string | number | boolean | null | undefined>) =>
  values
    .map((value) => {
      if (value === null || value === undefined || value === '') {
        return ''
      }
      return csvEscape(String(value))
    })
    .join(',')

const main = () => {
  const raw = fs.readFileSync(inputPath, 'utf8').trim()
  const markets = JSON.parse(raw) as MarketResult[]

  const header = ['slug', 'PNL', 'isWin', ...WINDOWS]
  const tradesHeader = ['slug', 'PNL', 'isWin']
  const netChangeRows = [toCsvRow(header)]
  const highLowRows = [toCsvRow(header)]
  const tradesRows = [toCsvRow(tradesHeader)]
  const netChangeJson: Array<Record<string, string | number | boolean>> = []
  const highLowJson: Array<Record<string, string | number | boolean>> = []
  const tradesJson: Array<Record<string, string | number | boolean>> = []

  for (const market of markets) {
    if (market.pnl === 0) continue

    const isWin = market.pnl > 0
    const windowsMetrics =
      market.intentMeta?.[0]?.windowsMetrics ??
      market.tradeIntentMeta?.[0]?.intentMeta?.windowsMetrics ??
      []
    const metricMap = new Map(windowsMetrics.map((metric) => [metric.window, metric]))

    const netChangeRow = [
      market.slug ?? '',
      market.pnl,
      isWin,
      ...WINDOWS.map((window) => metricMap.get(window)?.netChange ?? ''),
    ]
    const highLowRow = [
      market.slug ?? '',
      market.pnl,
      isWin,
      ...WINDOWS.map((window) => metricMap.get(window)?.highLowRange ?? ''),
    ]

    netChangeRows.push(toCsvRow(netChangeRow))
    highLowRows.push(toCsvRow(highLowRow))

    const base = {
      slug: market.slug ?? '',
      PNL: market.pnl,
      isWin,
    }
    tradesRows.push(toCsvRow([base.slug, base.PNL, base.isWin]))
    tradesJson.push({ ...base })
    netChangeJson.push({
      ...base,
      ...Object.fromEntries(
        WINDOWS.map((window) => [window, metricMap.get(window)?.netChange ?? null]),
      ),
    })
    highLowJson.push({
      ...base,
      ...Object.fromEntries(
        WINDOWS.map((window) => [window, metricMap.get(window)?.highLowRange ?? null]),
      ),
    })
  }

  fs.writeFileSync(netChangePath, netChangeRows.join('\n'))
  fs.writeFileSync(highLowRangePath, highLowRows.join('\n'))
  fs.writeFileSync(tradesCsvPath, tradesRows.join('\n'))
  fs.writeFileSync(netChangeJsonPath, JSON.stringify(netChangeJson, null, 2))
  fs.writeFileSync(highLowRangeJsonPath, JSON.stringify(highLowJson, null, 2))
  fs.writeFileSync(tradesJsonPath, JSON.stringify(tradesJson, null, 2))
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')
if (isMain) {
  main()
}
