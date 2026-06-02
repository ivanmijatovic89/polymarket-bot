import '../../config/env.js'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../db/index.js'
import { backtestRuns } from '../../db/schema.js'
import { getBacktestRunById, insertBacktestRun } from '../../db/backtests.js'
import { computeBatchStats } from '../../backtest/stats/batchStats.js'
import { computeChunkedBatchStats } from '../../backtest/stats/chunkedBatchStats.js'
import type { MarketStats } from '../../backtest/stats/marketStats.js'

type CliArgs = {
  id?: number
  filter?: string
  split: number
  help: boolean
}

type FilterOp = '>' | '<' | '>=' | '<=' | '==' | '!='
type Filter = {
  field: string
  op: FilterOp
  value: number
}
type FilterGroup = Filter[]

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

type MarketStatsLike = MarketStats & {
  intentMeta?: IntentMeta[]
}

function parseCliArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { help: false, split: 0.7 }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
    if (arg === '--id' && args[i + 1]) {
      const n = Number(args[i + 1])
      if (Number.isFinite(n)) parsed.id = n
      i += 1
      continue
    }
    if (arg?.startsWith('--id=')) {
      const raw = arg.slice('--id='.length)
      const n = Number(raw)
      if (Number.isFinite(n)) parsed.id = n
      continue
    }
    if (arg === '--filter' && args[i + 1]) {
      const next = args[i + 1]
      if (next) parsed.filter = next
      i += 1
      continue
    }
    if (arg?.startsWith('--filter=')) {
      parsed.filter = arg.slice('--filter='.length)
      continue
    }
    if (arg === '--split' && args[i + 1]) {
      const n = Number(args[i + 1])
      parsed.split = Number.isFinite(n) ? n : parsed.split
      i += 1
      continue
    }
    if (arg?.startsWith('--split=')) {
      const n = Number(arg.slice('--split='.length))
      parsed.split = Number.isFinite(n) ? n : parsed.split
      continue
    }

    if (parsed.id === undefined) {
      const n = Number(arg)
      if (Number.isFinite(n)) {
        parsed.id = n
        continue
      }
    }
    if (!parsed.filter) {
      if (arg) parsed.filter = arg
    }
  }

  return parsed
}

function printHelp(): void {
  console.log(`
Usage: npx tsx src/cli/research/insert-in-db-backtest-feature-tests.ts <backtestId> [filter]
       npx tsx src/cli/research/insert-in-db-backtest-feature-tests.ts --id <backtestId> --filter "<filter>" --split 0.7

Description:
  Loads backtest by ID, filters marketStats by feature filters, computes batchStats
  + chunkedBatchStats, and inserts derived normalized backtest runs.

Filter format:
  field>number
  field< number
  field>=number
  field<=number
  field==number
  field!=number
  Vise filtera se spaja sa &: netChange_45s>0.05&highLowRange_20s<20
  OR je podrzan sa | i opcionalnim zagradama:
  (ta_tf1h_wickRatio>=0.55&ta_tf1h_wickRatio<=0.77)|(ta_tf1h_wickRatio>=1.00&ta_tf1h_wickRatio<=1.34)

Important (shell quoting):
  Use quotes if you have > or < so the shell doesn't treat it as redirection.

Examples:
  npx tsx src/cli/research/insert-in-db-backtest-feature-tests.ts 247 "netChange_45s>0.05"
  npx tsx src/cli/research/insert-in-db-backtest-feature-tests.ts 247 "netChange_45s>0.05&highLowRange_20s<20"
  npx tsx src/cli/research/insert-in-db-backtest-feature-tests.ts --id 247 --filter "netChange_45s>0.05" --split 0.727
`)
}

function splitOrGroups(raw: string): string[] {
  const cleaned = raw.replace(/[()]/g, ' ')
  return cleaned
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseFilters(filterRaw?: string): FilterGroup[] {
  if (!filterRaw) return []

  const groups = splitOrGroups(filterRaw)
  const ops: FilterOp[] = ['>=', '<=', '!=', '==', '>', '<']
  const parsedGroups: FilterGroup[] = []

  for (const groupRaw of groups) {
    const parts = groupRaw
      .split('&')
      .map((part) => part.trim())
      .filter(Boolean)
    const filters: Filter[] = []

    for (const part of parts) {
      let matched = false
      for (const op of ops) {
        const idx = part.indexOf(op)
        if (idx <= 0) continue
        const field = part.slice(0, idx).trim()
        const rawValue = part.slice(idx + op.length).trim()
        const value = Number.parseFloat(rawValue)
        if (!field || !Number.isFinite(value)) {
          throw new Error(`[insert-in-db] Invalid filter: "${part}"`)
        }
        filters.push({ field, op, value })
        matched = true
        break
      }
      if (!matched && part.includes('=')) {
        const idx = part.indexOf('=')
        const field = part.slice(0, idx).trim()
        const rawValue = part.slice(idx + 1).trim()
        const value = Number.parseFloat(rawValue)
        if (!field || !Number.isFinite(value)) {
          throw new Error(`[insert-in-db] Invalid filter: "${part}"`)
        }
        filters.push({ field, op: '==', value })
        matched = true
      }
      if (!matched) {
        throw new Error(
          `[insert-in-db] Invalid filter: "${part}". If you use > or <, wrap the filter in quotes.`,
        )
      }
    }

    if (filters.length > 0) parsedGroups.push(filters)
  }

  return parsedGroups
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function getFeatureValue(row: MarketStatsLike, field: string): number | null {
  const direct = toNumber((row as Record<string, unknown>)[field])
  if (direct !== null) return direct

  const meta = Array.isArray(row.intentMeta) ? row.intentMeta[0] : undefined
  if (!meta) return null

  if (field.startsWith('netChange_')) {
    const window = field.slice('netChange_'.length)
    const metric = meta.windowsMetrics?.find((m) => m.window === window)
    return toNumber(metric?.netChange)
  }
  if (field.startsWith('highLowRange_')) {
    const window = field.slice('highLowRange_'.length)
    const metric = meta.windowsMetrics?.find((m) => m.window === window)
    return toNumber(metric?.highLowRange)
  }

  const obMatch = /^ob_(\d+)_([A-Za-z0-9]+)$/.exec(field)
  if (obMatch) {
    const level = Number(obMatch[1])
    const key = obMatch[2]
    const levelData = meta.orderbookLevels?.find((l) => l.level === level)
    if (!levelData) return null
    switch (key) {
      case 'upBidDepth':
        return toNumber(levelData.upBidDepth)
      case 'downBidDepth':
        return toNumber(levelData.downBidDepth)
      case 'weakBidRatio':
        return toNumber(levelData.weakBidRatio)
      case 'isMyOrderOnWeakBidSide':
        return toNumber(levelData.isMyOrderOnWeakBidSide)
      case 'weakBidSide':
        return null
      default:
        return null
    }
  }

  if (field.startsWith('ta_tf1h_')) {
    const key = field.slice('ta_tf1h_'.length)
    const tf1h = meta.technicalIndicators?.tf1h as Record<string, unknown> | undefined
    return toNumber(tf1h?.[key])
  }
  if (field.startsWith('ta_tf15m_')) {
    const key = field.slice('ta_tf15m_'.length)
    const tf15m = meta.technicalIndicators?.tf15m as Record<string, unknown> | undefined
    return toNumber(tf15m?.[key])
  }
  if (field.startsWith('ta_meta_')) {
    const key = field.slice('ta_meta_'.length)
    const metaObj = meta.technicalIndicators?.meta as Record<string, unknown> | undefined
    return toNumber(metaObj?.[key])
  }

  return null
}

function matchesFilters(row: MarketStatsLike, groups: FilterGroup[]): boolean {
  if (groups.length === 0) return true

  const matchesGroup = (filters: Filter[]): boolean => {
    for (const filter of filters) {
      const value = getFeatureValue(row, filter.field)
      if (value === null || !Number.isFinite(value)) return false

      switch (filter.op) {
        case '>':
          if (!(value > filter.value)) return false
          break
        case '<':
          if (!(value < filter.value)) return false
          break
        case '>=':
          if (!(value >= filter.value)) return false
          break
        case '<=':
          if (!(value <= filter.value)) return false
          break
        case '==':
          if (!(value === filter.value)) return false
          break
        case '!=':
          if (!(value !== filter.value)) return false
          break
      }
    }
    return true
  }

  return groups.some((g) => matchesGroup(g))
}

function resetMarketStatsForGate(row: MarketStatsLike): MarketStatsLike {
  return {
    ...row,
    pnl: 0,
    cost: 0,
    feesPaid: 0,
    upShares: 10,
    downShares: 10,
    mergableShares: 10,
    splitCost: 10,
    tradeCount: 0,
    tradeAsMaker: 0,
    tradeAsTaker: 0,
    avgEntryPriceUp: null,
    avgEntryPriceDown: null,
    intentMeta: [],
  }
}

function parseJsonValue<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

async function fetchInitialCapital(id: number): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ capitalInitial: backtestRuns.capitalInitial })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, id))
    .limit(1)
  const raw = row?.capitalInitial
  if (raw === null || raw === undefined) {
    throw new Error('[insert-in-db] capitalInitial is missing or invalid')
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error('[insert-in-db] capitalInitial is missing or invalid')
  }
  return n
}

function coerceMarketStats(raw: unknown): MarketStatsLike[] {
  const parsed = parseJsonValue<unknown[]>(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('[insert-in-db] marketStats is not an array')
  }
  return parsed as MarketStatsLike[]
}

async function run(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.help || args.id === undefined || !Number.isFinite(args.id)) {
    printHelp()
    if (args.id === undefined) process.exit(1)
    return
  }
  if (!Number.isFinite(args.split) || args.split <= 0 || args.split >= 1) {
    throw new Error('[insert-in-db] --split must be between 0 and 1 (exclusive)')
  }

  const id = Math.trunc(args.id)
  const filters = parseFilters(args.filter)
  try {
    const row = await getBacktestRunById(id)
    if (!row) {
      throw new Error(`[insert-in-db] backtest id not found: ${id}`)
    }

    const marketStats = coerceMarketStats(row.marketStats)
    const initialCapital = await fetchInitialCapital(id)

    const totalMarkets = marketStats.length
    const searchCount = Math.floor(totalMarkets * args.split)
    const searchMarkets = marketStats.slice(0, searchCount)
    const testMarkets = marketStats.slice(searchCount)

    const baseParams =
      row.params && typeof row.params === 'object' && !Array.isArray(row.params)
        ? (row.params as Record<string, unknown>)
        : {}
    const mergedParams: Record<string, unknown> = {
      ...baseParams,
      ...(args.filter ? { featureFilter: args.filter } : {}),
    }

    const baseComment = args.filter ? `research | filter=${args.filter}` : 'research | filter=none'

    const batchUid = randomUUID()

    const insertGroup = async (
      label: 'ALL' | 'SEARCH' | 'TEST',
      groupMarkets: MarketStatsLike[],
    ) => {
      const childBatchUid = `${batchUid}-${label.toLowerCase()}`
      const skipped = groupMarkets.filter((m) => matchesFilters(m, filters))
      const kept = groupMarkets.filter((m) => !matchesFilters(m, filters))
      const keptAll = groupMarkets.map((m) =>
        matchesFilters(m, filters) ? resetMarketStatsForGate(m) : m,
      )

      const baselineBatchStats = computeBatchStats(groupMarkets as MarketStats[], initialCapital)
      const baselineChunkedBatchStats = computeChunkedBatchStats(
        groupMarkets as MarketStats[],
        initialCapital,
        [96, 200, 300],
      )

      const keptBatchStats = computeBatchStats(keptAll as MarketStats[], initialCapital)
      const keptChunkedBatchStats = computeChunkedBatchStats(
        keptAll as MarketStats[],
        initialCapital,
        [96, 200, 300],
      )

      const skippedBatchStats = computeBatchStats(skipped as MarketStats[], initialCapital)
      const skippedChunkedBatchStats = computeChunkedBatchStats(
        skipped as MarketStats[],
        initialCapital,
        [96, 200, 300],
      )

      await insertBacktestRun({
        batchUid: `${childBatchUid}-baseline`,
        baselineId: String(id),
        cmd: '',
        comment: `${label} > BASELINE | ${baseComment}`,
        strategy: row.strategy,
        params: mergedParams,
        symbol: row.symbol ?? null,
        slugs: row.slugs ?? null,
        limit: row.limit ?? null,
        random: row.random ?? false,
        latest: row.latest ?? false,
        batchStats: baselineBatchStats,
        chunkedBatchStats: baselineChunkedBatchStats as unknown as Record<string, unknown>,
        marketStats: groupMarkets as unknown as unknown[],
      })

      await insertBacktestRun({
        batchUid: `${childBatchUid}-kept`,
        baselineId: String(id),
        cmd: '',
        comment: `${label} > KEPT (after gate) | ${baseComment}`,
        strategy: row.strategy,
        params: mergedParams,
        symbol: row.symbol ?? null,
        slugs: row.slugs ?? null,
        limit: row.limit ?? null,
        random: row.random ?? false,
        latest: row.latest ?? false,
        batchStats: keptBatchStats,
        chunkedBatchStats: keptChunkedBatchStats as unknown as Record<string, unknown>,
        marketStats: keptAll as unknown as unknown[],
      })

      await insertBacktestRun({
        batchUid: `${childBatchUid}-skipped`,
        baselineId: String(id),
        cmd: '',
        comment: `${label} > SKIPPED (bad regime) | ${baseComment}`,
        strategy: row.strategy,
        params: mergedParams,
        symbol: row.symbol ?? null,
        slugs: row.slugs ?? null,
        limit: row.limit ?? null,
        random: row.random ?? false,
        latest: row.latest ?? false,
        batchStats: skippedBatchStats,
        chunkedBatchStats: skippedChunkedBatchStats as unknown as Record<string, unknown>,
        marketStats: skipped as unknown as unknown[],
      })

      return {
        total: groupMarkets.length,
        baselinePnl: baselineBatchStats.pnlTotal,
        baselineMarketsPlayed: baselineBatchStats.marketsPlayed,
        kept: kept.length,
        skipped: skipped.length,
        keptPnl: keptBatchStats.pnlTotal,
        skippedPnl: skippedBatchStats.pnlTotal,
        keptMarketsPlayed: keptBatchStats.marketsPlayed,
        skippedMarketsPlayed: skippedBatchStats.marketsPlayed,
      }
    }

    const allSummary = await insertGroup('ALL', marketStats)
    const searchSummary = await insertGroup('SEARCH', searchMarkets)
    const testSummary = await insertGroup('TEST', testMarkets)

    console.log('[insert-in-db] inserted filtered backtest runs', {
      fromId: id,
      filter: args.filter ?? null,
      batchUid,
      all: allSummary,
      search: searchSummary,
      test: testSummary,
    })
  } finally {
    await closeDb()
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  closeDb().catch(() => undefined)
  process.exit(1)
})
