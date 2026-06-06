import '../config/env.js'
import { getCurrentGitSha, getMachineId } from '../backtest/workerIdentity.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import { randomBytes, randomUUID } from 'crypto'
import {
  buildStrategyFromCliArgs,
  buildStrategyFromConfig,
  printCliArgsError,
} from './helpers/strategyArgs.js'
import { planExtension } from '../backtest/extendPlanner.js'
import {
  applyExtensionToRun,
  clearExtensionLock,
  ExtensionLockHeldError,
  markRunForExtendingBatch,
} from '../db/backtests.js'
import { parseArgs } from './helpers/backtestArgs.js'
import { buildBacktestCmdInline } from './helpers/backtestCmd.js'
import { resolveParquetFilesFromDirs } from './helpers/resolveParquetFilesFromDirs.js'
import { computeBatchStats } from '../backtest/stats/batchStats.js'
import { computeChunkedBatchStats } from '../backtest/stats/chunkedBatchStats.js'
import type { MarketStats } from '../backtest/stats/marketStats.js'
import {
  parseSlugFromFilename,
  getMarketResolution,
  type MarketResolution,
} from '../backtest/stats/marketResolution.js'
import { getMarketResolution as getTelonexMarketResolution } from '../backtest/stats/telonexMarketResolution.js'
import { runSingleMarket } from '../backtest/runSingleMarket.js'
import {
  AGGREGATE_JOB_OPTS,
  AGGREGATE_QUEUE,
  MARKET_JOB_OPTS,
  MARKET_QUEUE,
  closeRedisConnection,
  getAggregateQueue,
  getFlowProducer,
  getQueueEvents,
  getRedisConnection,
} from '../backtest/queue.js'
import {
  aggregateJobId,
  marketJobId,
  type AggregateJobData,
  type MarketJobData,
} from '../backtest/jobTypes.js'
import { Timer } from '../utils/timer.js'
import { closeDb } from '../db/index.js'
import {
  getMarketsBySlugs,
  getMarketBySlug,
  getMarketsBySymbol,
  type Market,
} from '../db/markets.js'
import {
  getMarketsBySlugs as getTelonexMarketsBySlugs,
  getMarketBySlug as getTelonexMarketBySlug,
  listEligibleTelonexMarkets,
  type Market as TelonexMarket,
  type Converter,
  type ReadFrom,
} from '../db/telonexMarkets.js'
import { getBacktestRunSummaryByBatchUid, insertBacktestRun } from '../db/backtests.js'
import { buildGammaMarketMeta, type GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import { fetchGammaMarketBySlug } from '../polymarket/gamma.js'

installProcessCrashHandlers({ prefix: 'backtest' })

function formatDurationHuman(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSeconds = Math.round(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}min ${seconds} sec`
}

function converterForInputMode(inputMode: 'telonex-delta' | 'telonex-paired'): Converter {
  return inputMode === 'telonex-delta' ? 'delta-typed' : 'paired'
}

function randomBatchUidSuffix(): string {
  return randomBytes(3).toString('hex')
}

async function resolveAvailableBatchUid(
  baseBatchUid: string,
  options: { redisHasAggregateJob?: (candidate: string) => Promise<boolean> } = {},
): Promise<string> {
  let firstConflict: string | null = null

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? baseBatchUid : `${baseBatchUid}-${randomBatchUidSuffix()}`
    const existingRun = await getBacktestRunSummaryByBatchUid(candidate)
    if (existingRun) {
      firstConflict ??= `MySQL run id=${existingRun.id}, marketsPersisted=${existingRun.marketsPersisted}`
      continue
    }

    if (options.redisHasAggregateJob && (await options.redisHasAggregateJob(candidate))) {
      firstConflict ??= 'Redis aggregate job'
      continue
    }

    if (candidate !== baseBatchUid) {
      console.warn(
        `[backtest] batchUid=${baseBatchUid} already exists (${firstConflict ?? 'conflict'}); ` +
          `using batchUid=${candidate}`,
      )
    }
    return candidate
  }

  throw new Error(`[backtest] could not allocate available batchUid for base=${baseBatchUid}`)
}

function argvWithBatchUid(argv: string[], batchUid: string): string[] {
  const out: string[] = []
  let found = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--batchUid') {
      out.push(arg, batchUid)
      found = true
      i += 1
      continue
    }
    if (typeof arg === 'string' && arg.startsWith('--batchUid=')) {
      out.push(`--batchUid=${batchUid}`)
      found = true
      continue
    }
    if (typeof arg === 'string') out.push(arg)
  }

  if (!found) out.push('--batchUid', batchUid)
  return out
}

function buildBacktestCmdWithBatchUid(argv: string[], batchUid: string): string {
  return buildBacktestCmdInline(argvWithBatchUid(argv, batchUid), { preferArgv: true })
}

// Parses `<symbol>-updown-<timeframe>-<epochSeconds>` → window-start ms.
// `eventStartTime` (window open) is what TimeWindowGate / parseGammaMarketStartMs need.
function windowStartMsFromSlug(slug: string): number | null {
  const m = slug.match(/^[a-z]+-updown-[^-]+-(\d+)$/)
  if (!m) return null
  const sec = Number(m[1])
  if (!Number.isFinite(sec)) return null
  return sec * 1000
}

function timeframeMsFromSlug(slug: string): number | null {
  const m = slug.match(/^[a-z]+-updown-([^-]+)-\d+$/)
  if (!m) return null
  const tf = m[1]?.toLowerCase() ?? ''
  const parsed = tf.match(/^(\d+)([mhd])$/)
  if (!parsed) return null
  const n = Number(parsed[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = parsed[2]
  if (unit === 'm') return n * 60_000
  if (unit === 'h') return n * 3_600_000
  if (unit === 'd') return n * 86_400_000
  return null
}

function buildMetaFromTokenMap(
  slug: string,
  tokenMap: Record<string, string>,
  extra?: { startDateMs?: number | null; endDateMs?: number | null; question?: string | null },
): GammaMarketMeta | undefined {
  const upAssetId = tokenMap['UP']
  const downAssetId = tokenMap['DOWN']
  if (!upAssetId || !downAssetId) return undefined
  const meta: Record<string, unknown> = {
    slug,
    outcomes: ['UP', 'DOWN'],
    clobTokenIds: [upAssetId, downAssetId],
    outcomeTokenMap: { up: upAssetId, down: downAssetId },
    upAssetId,
    downAssetId,
  }
  // Gamma's `startDate` is market creation; `eventStartTime` is the 15m window open.
  // Strategies read window-start via parseGammaMarketStartMs which prefers eventStartTime.
  // The slug's trailing epoch IS the window start, so derive eventStartTime from it.
  const windowStartMs = windowStartMsFromSlug(slug)
  if (windowStartMs !== null) {
    meta.eventStartTime = new Date(windowStartMs).toISOString()
  }
  if (extra?.startDateMs != null) {
    meta.startDate = new Date(extra.startDateMs).toISOString()
  }
  if (extra?.endDateMs != null) {
    meta.endDate = new Date(extra.endDateMs).toISOString()
  }
  if (extra?.question) {
    meta.question = extra.question
  }
  return meta as GammaMarketMeta
}

async function main(): Promise<void> {
  const timer = new Timer()
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)

  // -----------------------------------------------------------------
  // Extension flow — short-circuit the normal selection / strategy
  // resolution. parent run drives strategy + params + universe; the rest
  // of the CLI flow (BullMQ enqueue or sequential loop) continues with
  // the planned slug set.
  //
  // Inheritance contract: --strategy, --param, --symbol, --timeframe,
  // --input-mode, --read-from, --slug, --dir, --batchUid, --baselineId,
  // and positional file paths are forbidden alongside --extend (rejected
  // by parseArgs). --limit, --latest, --random, --from-ms, --to-ms,
  // --comment are user-supplied selection / metadata flags that apply
  // FRESHLY for this extension — they're NOT inherited from the parent.
  // -----------------------------------------------------------------
  const isExtend = parsed.extend !== undefined
  let extensionPlan: Awaited<ReturnType<typeof planExtension>> | null = null

  if (isExtend) {
    extensionPlan = await planExtension({
      parentRunId: parsed.extend!,
      ...(parsed.fromMs !== undefined && { fromMs: parsed.fromMs }),
      ...(parsed.toMs !== undefined && { toMs: parsed.toMs }),
      ...(parsed.limit !== undefined && { limit: parsed.limit }),
      ...(parsed.latest ? { latest: true } : {}),
      ...(parsed.random ? { random: true } : {}),
    })
    if (extensionPlan.kind === 'parent-not-found') {
      console.error(`[backtest] --extend ${parsed.extend}: run not found`)
      await closeDb()
      process.exit(2)
    }
    if (extensionPlan.kind === 'parent-not-telonex') {
      console.error(
        `[backtest] --extend ${parsed.extend}: run is not a telonex run (input_mode=${extensionPlan.inputMode ?? 'null'}); cannot extend`,
      )
      await closeDb()
      process.exit(2)
    }
    if (extensionPlan.kind === 'parent-missing-metadata') {
      console.error(
        `[backtest] --extend ${parsed.extend}: run is missing coverage metadata columns ` +
          `(${extensionPlan.missing.join(', ')}). Run scripts/backfill-backtest-coverage-meta.ts first.`,
      )
      await closeDb()
      process.exit(2)
    }
    if (extensionPlan.kind === 'extend-in-progress') {
      console.error(
        `[backtest] --extend ${parsed.extend}: another extension is already in progress ` +
          `(extending_at = ${extensionPlan.since.toISOString()}). ` +
          `Wait for it to finish, or — if the previous extender crashed — release the lock with:\n` +
          `  UPDATE backtest_runs SET extending_at = NULL WHERE id = ${parsed.extend};`,
      )
      await closeDb()
      process.exit(2)
    }
    if (extensionPlan.kind === 'nothing-to-extend') {
      console.log(
        `[backtest] --extend ${parsed.extend}: nothing to extend (no missing markets match the filter).`,
      )
      await closeDb()
      process.exit(0)
    }
    // extensionPlan.kind === 'ok' from here

    const plan = extensionPlan.plan
    const pct =
      plan.eligibleInRangeCount > 0
        ? Math.round((plan.parentCoveredCount / plan.eligibleInRangeCount) * 1000) / 10
        : 0
    console.log(
      `[backtest] Extending run #${plan.parent.id} (${plan.parent.strategy} / ${plan.parent.symbol} / ${plan.parent.timeframe} / ${plan.parent.converter} / ${plan.parent.readFrom})`,
    )
    console.log(
      `[backtest] Parent covered: ${plan.parentCoveredCount} / ${plan.eligibleInRangeCount} eligible-in-range (${pct}%)`,
    )
    const limitTag = parsed.limit !== undefined ? ` (limited from ${plan.availableCount})` : ''
    console.log(
      `[backtest] Extending by ${plan.candidates.length} markets${limitTag}, ` +
        `order=${parsed.random ? 'random' : parsed.latest ? 'newest-first' : 'oldest-first'}`,
    )
    const firstMs = plan.candidates[0]?.marketStartMs
    const lastMs = plan.candidates[plan.candidates.length - 1]?.marketStartMs
    if (firstMs !== undefined && lastMs !== undefined) {
      console.log(
        `[backtest] First market: ${new Date(firstMs).toISOString()}, last: ${new Date(lastMs).toISOString()}`,
      )
    }
    console.log(`[backtest] New batchUid: ${plan.newBatchUid}`)
  }

  const planOk = extensionPlan && extensionPlan.kind === 'ok' ? extensionPlan.plan : null

  let batchUid = isExtend
    ? // Extension batchUid is deterministic from parent's current batchUid;
      // planExtension already generated it, no need to resolve a free slot.
      planOk!.newBatchUid
    : await resolveAvailableBatchUid(parsed.batchUid ?? randomUUID())
  let cmd = buildBacktestCmdWithBatchUid(args, batchUid)
  const built = isExtend
    ? (() => {
        try {
          return buildStrategyFromConfig({
            strategyId: planOk!.parent.strategy,
            rawParams: planOk!.parent.params,
          })
        } catch (err) {
          printCliArgsError({ script: 'backtest', err })
          process.exit(2)
        }
      })()
    : (() => {
        try {
          return buildStrategyFromCliArgs({ argv: args, script: 'backtest' })
        } catch (err) {
          printCliArgsError({ script: 'backtest', err })
          process.exit(2)
        }
      })()

  // Override the effective input shape for extend so downstream code (logging,
  // per-market loop, marketContexts builder) sees what the parent run is.
  const effectiveInputMode = isExtend
    ? (planOk!.parent.inputMode as 'telonex-delta' | 'telonex-paired')
    : parsed.inputMode
  const isTelonex = effectiveInputMode !== 'recorded'
  const converter: Converter | null = isTelonex
    ? isExtend
      ? (planOk!.parent.converter as Converter)
      : converterForInputMode(parsed.inputMode as 'telonex-delta' | 'telonex-paired')
    : null
  const readFrom: ReadFrom | null = isTelonex
    ? isExtend
      ? (planOk!.parent.readFrom as ReadFrom)
      : (parsed.readFrom as ReadFrom)
    : null

  let filePaths: string[] = []
  const recordedBySlug = new Map<string, Market>()
  const telonexBySlug = new Map<string, TelonexMarket>()

  if (isExtend) {
    // Skip the normal selection logic entirely — candidates already come
    // from the extension planner.
    for (const m of planOk!.candidates) {
      if (m.dataset === null || m.dataset.trim() === '') continue
      filePaths.push(m.dataset)
      telonexBySlug.set(m.slug, m)
    }
  } else if (!isTelonex) {
    // ---- recorded flow: query `markets` table ----
    if (parsed.slugs && parsed.slugs.length > 0) {
      try {
        const uniqueSlugs = Array.from(new Set(parsed.slugs))
        const results = await getMarketsBySlugs(uniqueSlugs)
        const marketMap = new Map(results.map((m) => [m.slug, m] as const))
        const foundMarkets = uniqueSlugs
          .map((slug) => marketMap.get(slug))
          .filter((m): m is Market => m !== undefined)
        for (const m of foundMarkets) recordedBySlug.set(m.slug, m)
        const missingSlugs = uniqueSlugs.filter((slug) => !marketMap.has(slug))
        if (missingSlugs.length > 0) {
          console.warn(`[backtest] Missing markets for slugs: ${missingSlugs.join(', ')}`)
        }
        filePaths = foundMarkets
          .map((m) => m.dataset)
          .filter((d): d is string => d !== null && d.trim() !== '')
        if (filePaths.length === 0) {
          console.error(
            `[backtest] No markets found in database for slugs: ${uniqueSlugs.join(', ')}`,
          )
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from database for slugs: ${uniqueSlugs.join(', ')}`,
        )
      } catch (err) {
        console.error('[backtest] Failed to load markets from database:', err)
        process.exit(2)
      }
    } else if (parsed.symbol) {
      try {
        const marketRecords = await getMarketsBySymbol(parsed.symbol, {
          ...(parsed.limit !== undefined && { limit: parsed.limit }),
          ...(parsed.random ? { random: true } : {}),
          ...(parsed.latest ? { latest: true } : {}),
          onlyWithDataset: true,
        })
        for (const m of marketRecords) recordedBySlug.set(m.slug, m)
        filePaths = marketRecords
          .map((m) => m.dataset)
          .filter((d): d is string => d !== null && d.trim() !== '')
        if (filePaths.length === 0) {
          console.error(`[backtest] No markets found in database for symbol: ${parsed.symbol}`)
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from database for symbol: ${parsed.symbol}`,
        )
      } catch (err) {
        console.error(`[backtest] Failed to load markets from database:`, err)
        process.exit(2)
      }
    } else {
      try {
        const fromDirs =
          parsed.dirs && parsed.dirs.length > 0
            ? await resolveParquetFilesFromDirs(parsed.dirs)
            : []
        if (parsed.dirs && parsed.dirs.length > 0) {
          console.log(
            `[backtest] Loaded ${fromDirs.length} parquet file(s) from dirs: ${parsed.dirs.join(', ')}`,
          )
        }
        filePaths = [...parsed.filePaths, ...fromDirs]
        if (filePaths.length > 0) {
          filePaths = Array.from(new Set(filePaths)).sort()
        }
      } catch (err) {
        console.error('[backtest] Failed to load parquet files from --dir:', err)
        process.exit(2)
      }
    }
  } else {
    // ---- telonex flow: query `telonex_markets` ⋈ `telonex_market_conversions` ----
    const conv = converter!
    const rf = readFrom!
    if (parsed.slugs && parsed.slugs.length > 0) {
      try {
        const uniqueSlugs = Array.from(new Set(parsed.slugs))
        const results = await getTelonexMarketsBySlugs(uniqueSlugs, {
          converter: conv,
          readFrom: rf,
        })
        const marketMap = new Map(results.map((m) => [m.slug, m] as const))
        const found = uniqueSlugs
          .map((slug) => marketMap.get(slug))
          .filter((m): m is TelonexMarket => m !== undefined)
        for (const m of found) telonexBySlug.set(m.slug, m)
        const missing = uniqueSlugs.filter((slug) => !marketMap.has(slug))
        if (missing.length > 0) {
          console.warn(
            `[backtest] no ${conv} conversion for slug(s): ${missing.join(', ')}, skipping`,
          )
        }
        filePaths = found
          .map((m) => m.dataset)
          .filter((d): d is string => d !== null && d.trim() !== '')
        if (filePaths.length === 0) {
          console.error(
            `[backtest] No telonex markets found for slugs: ${uniqueSlugs.join(', ')} (converter=${conv}, readFrom=${rf})`,
          )
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from telonex_markets for slugs: ${uniqueSlugs.join(', ')}`,
        )
      } catch (err) {
        console.error('[backtest] Failed to load telonex markets:', err)
        process.exit(2)
      }
    } else if (parsed.symbol) {
      try {
        const results = await listEligibleTelonexMarkets({
          symbol: parsed.symbol,
          timeframe: parsed.timeframe,
          converter: conv,
          readFrom: rf,
          ...(parsed.limit !== undefined && { limit: parsed.limit }),
          ...(parsed.random ? { random: true } : {}),
          ...(parsed.latest ? { latest: true } : {}),
        })
        const withDataset = results.filter((m) => m.dataset !== null && m.dataset.trim() !== '')
        const missingDataset = results.length - withDataset.length
        if (missingDataset > 0) {
          console.warn(
            `[backtest] ${missingDataset} telonex market(s) missing ${rf} dataset path, skipping`,
          )
        }
        for (const m of withDataset) telonexBySlug.set(m.slug, m)
        filePaths = withDataset.map((m) => m.dataset).filter((d): d is string => d !== null)
        if (filePaths.length === 0) {
          console.error(
            `[backtest] No telonex markets found for symbol=${parsed.symbol} timeframe=${parsed.timeframe} (converter=${conv}, readFrom=${rf})`,
          )
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from telonex_markets for symbol=${parsed.symbol} timeframe=${parsed.timeframe}`,
        )
      } catch (err) {
        console.error('[backtest] Failed to load telonex markets:', err)
        process.exit(2)
      }
    } else {
      // dir / explicit file paths — same as recorded
      try {
        const fromDirs =
          parsed.dirs && parsed.dirs.length > 0
            ? await resolveParquetFilesFromDirs(parsed.dirs)
            : []
        if (parsed.dirs && parsed.dirs.length > 0) {
          console.log(
            `[backtest] Loaded ${fromDirs.length} parquet file(s) from dirs: ${parsed.dirs.join(', ')}`,
          )
        }
        filePaths = [...parsed.filePaths, ...fromDirs]
        if (filePaths.length > 0) {
          filePaths = Array.from(new Set(filePaths)).sort()
        }
      } catch (err) {
        console.error('[backtest] Failed to load parquet files from --dir:', err)
        process.exit(2)
      }
    }
  }

  if (filePaths.length === 0) {
    console.error(
      'Usage:\n' +
        '  Recorded (WS replay, markets table):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --symbol <btc|eth|sol|...> [--limit N] [--random|--latest]\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --slug <slug1[,slug2,...]>\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --dir <dir1> [--dir <dir2> ...]\n' +
        '  Telonex (telonex_markets table, requires --read-from local|r2):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --input-mode telonex-delta --read-from local --symbol btc [--timeframe 15m] [--limit N]\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --input-mode telonex-paired --read-from r2 --slug <slug>\n',
    )
    process.exit(2)
  }

  const effectiveTimeframe = isExtend ? planOk!.parent.timeframe : parsed.timeframe
  console.log(`[backtest] mode=${effectiveInputMode} files=${filePaths.length}`)
  if (isTelonex) {
    console.log(
      `[backtest] converter=${converter} readFrom=${readFrom} timeframe=${effectiveTimeframe}`,
    )
  } else {
    console.log(`[backtest] order=${parsed.order}`)
    console.log(`[backtest] timeDriven=${parsed.timeDriven}`)
  }
  if (parsed.latest) console.log(`[backtest] latest=true`)

  let shouldStop = false
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[backtest] ${signal} received, stopping...`)
    shouldStop = true
  }
  installSignalHandlers({ onSignal: shutdown })

  console.log(`[backtest] strategy=${built.strategyId}`)

  const initialCapital = parseFloat(process.env.INITIAL_CAPITAL ?? '1000')
  const totalMarkets = filePaths.length

  const latencyMs = Math.max(0, Math.trunc(Number(process.env.BACKTEST_LATENCY_DELAY ?? '0') || 0))
  const jitterMs = Math.max(0, Math.trunc(Number(process.env.BACKTEST_LATENCY_JITTER ?? '20') || 0))

  // ---- Pre-resolve every market context in the producer so that workers
  // ---- never need to touch MySQL / Gamma. This preserves the existing DB
  // ---- lookup + Gamma fallback behavior 1:1 with PR1.
  type ResolvedContext = {
    idx: number
    filePath: string
    slug: string | null
    marketMeta: GammaMarketMeta | undefined
    marketResolution: MarketResolution | null
    strategyWindow: { startMs: number; endMs: number } | null
  }
  const marketContexts: ResolvedContext[] = []

  for (let idx = 0; idx < filePaths.length; idx += 1) {
    const fp = filePaths[idx]!
    if (shouldStop) break
    const slug = parseSlugFromFilename(fp)
    let marketResolution: MarketResolution | null = null
    let marketMeta: GammaMarketMeta | undefined

    if (isTelonex) {
      let row = slug ? (telonexBySlug.get(slug) ?? null) : null
      if (!row && slug) {
        row = await getTelonexMarketBySlug(slug, { converter: converter!, readFrom: readFrom! })
        if (row) telonexBySlug.set(slug, row)
      }
      if (row) {
        marketResolution = getTelonexMarketResolution(row)
        if (marketResolution) {
          marketMeta = buildMetaFromTokenMap(slug!, marketResolution.tokenMap, {
            startDateMs: row.startDateMs,
            endDateMs: row.endDateMs,
            question: row.question,
          })
        }
      } else if (slug) {
        console.warn(`[backtest] no telonex_markets row for slug=${slug}, skipping stats`)
      }
    } else {
      let dbMarket =
        slug && recordedBySlug.size > 0
          ? (recordedBySlug.get(slug) ?? null)
          : slug
            ? await getMarketBySlug(slug)
            : null
      marketResolution = slug ? await getMarketResolution(slug, fp) : null
      if (slug) {
        const refreshed = await getMarketBySlug(slug)
        if (refreshed) {
          dbMarket = refreshed
          recordedBySlug.set(slug, refreshed)
        }
      }
      marketMeta = (() => {
        if (!slug) return undefined
        if (!dbMarket) return undefined
        const raw = dbMarket.rawJson
        if (!raw || typeof raw !== 'object') return undefined
        const built = buildGammaMarketMeta(raw as Record<string, unknown>, slug)
        return built ?? undefined
      })()
      if (!marketMeta && slug) {
        try {
          const raw = await fetchGammaMarketBySlug({ slug })
          if (raw && typeof raw === 'object') {
            const built = buildGammaMarketMeta(raw, slug)
            if (built) marketMeta = built
          }
        } catch {
          // best-effort
        }
      }
      if (!marketMeta && slug && marketResolution) {
        marketMeta = buildMetaFromTokenMap(slug, marketResolution.tokenMap)
      }
    }

    if (slug && marketMeta) {
      const id = typeof marketMeta.id === 'string' ? marketMeta.id : undefined
      const q = typeof marketMeta.question === 'string' ? marketMeta.question : undefined
      console.log('[backtest] market meta', {
        slug,
        ...(id ? { id } : {}),
        ...(q ? { question: q } : {}),
      })
    }
    if (slug && !marketMeta) {
      console.warn(`[backtest] market meta unavailable for slug: ${slug}`)
    }

    const strategyWindow = (() => {
      if (!isTelonex || !slug) return null
      const startMs = windowStartMsFromSlug(slug)
      const durationMs = timeframeMsFromSlug(slug)
      if (startMs === null || durationMs === null) {
        console.warn(
          `[backtest] could not derive strategy window from slug=${slug}; processing all ticks`,
        )
        return null
      }
      return { startMs, endMs: startMs + durationMs }
    })()

    marketContexts.push({ idx, filePath: fp, slug, marketMeta, marketResolution, strategyWindow })
  }

  if (shouldStop) {
    console.log('[backtest] shutdown requested before dispatch; aborting')
    await closeDb()
    return
  }

  const useBullMQ = !parsed.sequential

  // -----------------------------------------------------------------
  // SEQUENTIAL path — same in-process loop as PR1; kept as an opt-in
  // fallback (`--sequential`) for verification and Redis-less smoke runs.
  // -----------------------------------------------------------------
  if (!useBullMQ) {
    const machineId = getMachineId()
    const commitSha = getCurrentGitSha()
    const marketStats: MarketStats[] = []
    let events = 0
    const byType = new Map<string, number>()
    const backtestStartMs = Date.now()
    let completedMarkets = 0
    let completedMarketsMsTotal = 0

    for (const ctx of marketContexts) {
      if (shouldStop) break
      const marketIdx = ctx.idx + 1
      console.log(`[backtest][${marketIdx}/${totalMarkets}] replay file=${ctx.filePath}`)
      const marketStartMs = Date.now()

      const result = await runSingleMarket({
        idx: ctx.idx,
        filePath: ctx.filePath,
        slug: ctx.slug,
        marketMeta: ctx.marketMeta,
        marketResolution: ctx.marketResolution,
        strategyId: built.strategyId,
        strategyParams: built.params as Record<string, unknown>,
        inputMode: effectiveInputMode,
        order: parsed.order,
        timeDriven: parsed.timeDriven,
        latency: { delayMs: latencyMs, jitterMs },
        strategyWindow: ctx.strategyWindow,
        machineId,
        commitSha,
        shouldStop: () => shouldStop,
      })

      events += result.eventsProcessed
      for (const [t, c] of Object.entries(result.eventsByType)) {
        byType.set(t, (byType.get(t) ?? 0) + c)
      }

      if (result.marketStats) {
        marketStats.push(result.marketStats)
        if (result.skipReason === 'no_activity') {
          console.log(
            `[backtest] market=${result.marketStats.marketId} slug=${ctx.slug} outcome=${result.marketStats.finalOutcome} pnl=${result.marketStats.pnl} trades=0 (no in-window positions/trades)`,
          )
        } else {
          const pnlColor = result.marketStats.pnl >= 0 ? '\x1b[32m' : '\x1b[31m'
          const resetColor = '\x1b[0m'
          console.log(
            `${pnlColor}[backtest] market=${result.marketStats.marketId} slug=${ctx.slug} outcome=${result.marketStats.finalOutcome} pnl=${result.marketStats.pnl} trades=${result.marketStats.tradeCount}${resetColor}`,
          )
        }
      } else if (result.skipReason === 'no_slug') {
        console.warn(
          `[backtest] Could not parse slug from filename: ${ctx.filePath}, skipping stats`,
        )
      } else if (result.skipReason === 'no_resolution') {
        console.warn(
          `[backtest] Could not get market resolution for slug: ${ctx.slug}, skipping stats`,
        )
      } else if (result.skipReason === 'unresolved_outcome') {
        console.warn(`[backtest] Market not resolved yet for slug: ${ctx.slug}, skipping stats`)
      }

      const marketElapsedMs = Date.now() - marketStartMs
      completedMarkets += 1
      completedMarketsMsTotal += marketElapsedMs
      const avgPerMarketMs = completedMarketsMsTotal / Math.max(1, completedMarkets)
      const remainingMarkets = Math.max(0, totalMarkets - completedMarkets)
      const etaMs = avgPerMarketMs * remainingMarkets
      const totalElapsedMs = Date.now() - backtestStartMs
      console.log(
        `[backtest][${completedMarkets}/${totalMarkets}] finished in ${formatDurationHuman(marketElapsedMs)} | elapsed ${formatDurationHuman(
          totalElapsedMs,
        )} | eta ${formatDurationHuman(etaMs)}`,
      )
    }

    if (isExtend) {
      // Extension UPDATE flow: persist the new markets into the parent run
      // and recompute stats over the UNION (existing + new). batchUid is
      // already updated on the parent via markRunForExtendingBatch.
      try {
        await markRunForExtendingBatch(planOk!.parent.id, batchUid, cmd)
      } catch (err) {
        if (err instanceof ExtensionLockHeldError) {
          console.error(`[backtest] ${err.message}`)
          await closeDb()
          process.exit(2)
        }
        throw err
      }
      try {
        await applyExtensionToRun({
          parentRunId: planOk!.parent.id,
          marketStats: marketStats as unknown as unknown[],
          failedMarkets: null,
        })
      } catch (err) {
        // applyExtensionToRun's transaction rolled back; release the lock so
        // a retry isn't blocked by a now-meaningless flag.
        await clearExtensionLock(planOk!.parent.id).catch(() => {})
        throw err
      }
      console.log(
        `\n[backtest] ===== EXTENSION APPLIED to run #${planOk!.parent.id}: +${marketStats.length} markets =====`,
      )
    } else {
      // CRITICAL invariant: marketContexts iteration order == input order, so
      // marketStats already arrives sorted. Aggregation happens here in-process.
      const batchStats = computeBatchStats(marketStats, initialCapital)
      const chunkedBatchStats = computeChunkedBatchStats(
        marketStats,
        initialCapital,
        [96, 200, 300],
      )

      await insertBacktestRun({
        batchUid,
        baselineId: parsed.baselineId ?? null,
        cmd,
        comment: parsed.comment ?? null,
        strategy: built.strategyId,
        params: built.params as Record<string, unknown>,
        symbol: parsed.symbol ?? null,
        timeframe: parsed.timeframe ?? null,
        inputMode: parsed.inputMode ?? null,
        converter: converter ?? null,
        readFrom: readFrom ?? null,
        slugs: parsed.slugs ?? null,
        limit: parsed.limit ?? null,
        random: parsed.random ?? false,
        latest: parsed.latest ?? false,
        batchStats,
        chunkedBatchStats: chunkedBatchStats as unknown as Record<string, unknown>,
        marketStats: marketStats as unknown as unknown[],
      })

      console.log('\n[backtest] ===== BATCH STATS =====')
      console.log(JSON.stringify(batchStats, null, 2))
    }

    console.log('\n[backtest] orderbook summary', {
      events,
      byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      ...timer.summary(),
    })

    await closeDb()
    return
  }

  // -----------------------------------------------------------------
  // BULLMQ path — enqueue children + parent aggregate, wait or detach.
  // -----------------------------------------------------------------
  const producerCommitSha = getCurrentGitSha()

  // Sanity-check Redis up front so we fail with a clear message rather than
  // hanging inside FlowProducer if the daemon isn't running.
  try {
    await getRedisConnection().ping()
  } catch (err) {
    console.error(
      `[backtest] Redis ping failed at ${process.env.REDIS_URL ?? 'redis://localhost:6379'}.\n` +
        `Start Redis (brew services start redis) or pass --sequential to bypass the queue.\n`,
      err,
    )
    await closeDb()
    process.exit(2)
  }

  const aggregateQueue = getAggregateQueue()
  if (!isExtend) {
    // Skip resolveAvailableBatchUid for extends — newBatchUid is deterministic
    // and we want a hard failure if it somehow collides (would indicate a bug
    // in generateExtensionBatchUid or simultaneous extends of same run).
    batchUid = await resolveAvailableBatchUid(batchUid, {
      redisHasAggregateJob: async (candidate) =>
        (await aggregateQueue.getJob(aggregateJobId(candidate))) !== undefined,
    })
  }
  cmd = buildBacktestCmdWithBatchUid(args, batchUid)

  if (isExtend) {
    // Eagerly UPDATE backtest_runs.batch_uid AND .cmd before the BullMQ flow
    // enqueues. Dashboard lookups by batchUid then find the parent run
    // immediately during processing — not just on completion. This also
    // atomically takes the concurrent-extend lock; a second --extend on the
    // same run hitting this same call will get ExtensionLockHeldError.
    try {
      await markRunForExtendingBatch(planOk!.parent.id, batchUid, cmd)
    } catch (err) {
      if (err instanceof ExtensionLockHeldError) {
        console.error(`[backtest] ${err.message}`)
        await closeDb()
        process.exit(2)
      }
      throw err
    }
  }

  const flow = getFlowProducer()
  const aggData: AggregateJobData = {
    batchUid,
    totalMarkets,
    initialCapital,
    insertMeta: {
      baselineId: parsed.baselineId ?? null,
      cmd,
      comment: parsed.comment ?? null,
      strategy: built.strategyId,
      params: built.params as Record<string, unknown>,
      symbol: isExtend ? planOk!.parent.symbol : (parsed.symbol ?? null),
      timeframe: isExtend ? planOk!.parent.timeframe : (parsed.timeframe ?? null),
      inputMode: effectiveInputMode ?? null,
      converter: converter ?? null,
      readFrom: readFrom ?? null,
      slugs: parsed.slugs ?? null,
      limit: parsed.limit ?? null,
      random: parsed.random ?? false,
      latest: parsed.latest ?? false,
    },
    ...(isExtend ? { extension: { parentRunId: planOk!.parent.id } } : {}),
  }

  const children = marketContexts.map((ctx) => {
    const data: MarketJobData = {
      batchUid,
      idx: ctx.idx,
      filePath: ctx.filePath,
      slug: ctx.slug,
      marketMeta: ctx.marketMeta,
      marketResolution: ctx.marketResolution,
      strategyId: built.strategyId,
      strategyParams: built.params as Record<string, unknown>,
      inputMode: effectiveInputMode,
      order: parsed.order,
      timeDriven: parsed.timeDriven,
      latency: { delayMs: latencyMs, jitterMs },
      strategyWindow: ctx.strategyWindow,
      commitSha: producerCommitSha,
    }
    return {
      name: 'market',
      queueName: MARKET_QUEUE,
      data,
      opts: { ...MARKET_JOB_OPTS, jobId: marketJobId(batchUid, ctx.idx) },
    }
  })

  console.log(
    `[backtest] enqueueing flow batchUid=${batchUid} totalMarkets=${totalMarkets} commitSha=${producerCommitSha.slice(0, 8) || 'unknown'}`,
  )

  const node = await flow.add({
    name: 'aggregate-batch',
    queueName: AGGREGATE_QUEUE,
    data: aggData,
    children,
    opts: {
      ...AGGREGATE_JOB_OPTS,
      jobId: aggregateJobId(batchUid),
      // If a child exhausts retries, still run the aggregator with the rest
      // (the aggregator records exhausted children into backtest_run_failures).
      // BullMQ option name as of v5: `ignoreDependencyOnFailure`.
      ignoreDependencyOnFailure: true,
    },
  })

  console.log(`[backtest] enqueued: aggregate jobId=${node.job.id ?? aggregateJobId(batchUid)}`)

  if (parsed.detach) {
    console.log(`[backtest] --detach: batchUid=${batchUid}`)
    console.log(`[backtest] watch progress at http://127.0.0.1:3051/ (npm run dashboard)`)
    await closeRedisConnection()
    await closeDb()
    return
  }

  // Live progress: subscribe to market QueueEvents for completion stream;
  // wait on the aggregate parent's `waitUntilFinished` for the blocking handle.
  const marketEvents = getQueueEvents(MARKET_QUEUE)
  const aggregateEvents = getQueueEvents(AGGREGATE_QUEUE)
  await marketEvents.waitUntilReady()
  await aggregateEvents.waitUntilReady()

  const startWaitMs = Date.now()
  // Per-jobId terminal state so retries don't double-count.
  // BullMQ emits `failed` on every failed attempt (MARKET_JOB_OPTS sets
  // attempts: 3); a job that fails-then-succeeds would otherwise bump
  // both `failed` and `completed`, pushing the counter past totalMarkets
  // and skipping the `completed + failed === totalMarkets` summary gate.
  const terminalState = new Map<string, 'completed' | 'failed'>()
  let completed = 0
  let failed = 0

  // Only count events for child market jobs (`<batchUid>-m-<idx>`), not
  // the aggregate parent (`<batchUid>-agg`) which can also match
  // `includes(batchUid)`.
  const isOurChild = (jobId: string): boolean => jobId.startsWith(`${batchUid}-m-`)

  const printProgress = (): void => {
    const total = totalMarkets
    const elapsedMs = Date.now() - startWaitMs
    const avgMs = completed > 0 ? elapsedMs / completed : 0
    const remaining = Math.max(0, total - completed - failed)
    const etaMs = avgMs * remaining
    console.log(
      `[backtest][${completed + failed}/${total}] completed=${completed} failed=${failed} | elapsed ${formatDurationHuman(elapsedMs)} | eta ${formatDurationHuman(etaMs)}`,
    )
  }

  const maybePrintProgress = (): void => {
    if (
      (completed + failed) % Math.max(1, Math.floor(totalMarkets / 20)) === 0 ||
      completed + failed === totalMarkets
    ) {
      printProgress()
    }
  }

  const onCompleted = ({ jobId }: { jobId: string }): void => {
    if (!isOurChild(jobId)) return
    const prev = terminalState.get(jobId)
    if (prev === 'completed') return // dedup duplicate event
    if (prev === 'failed') failed -= 1 // promoted from a retried failure
    terminalState.set(jobId, 'completed')
    completed += 1
    maybePrintProgress()
  }
  const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }): void => {
    if (!isOurChild(jobId)) return
    // Skip intermediate retry-failures; only count the terminal failure
    // (the one that has no successor `completed` and no further retry).
    // We can't tell from QueueEvents alone whether this is terminal, so
    // we tentatively mark `failed` and let a later `completed` for the
    // same jobId roll it back. The previous-state dedup handles double
    // `failed` events at the same attempt index.
    const prev = terminalState.get(jobId)
    if (prev === 'failed' || prev === 'completed') return
    terminalState.set(jobId, 'failed')
    failed += 1
    console.warn(`[backtest] child failed jobId=${jobId} reason=${failedReason}`)
    maybePrintProgress()
  }

  marketEvents.on('completed', onCompleted)
  marketEvents.on('failed', onFailed)

  // Allow Ctrl+C to *actually* detach: race the live wait against a promise
  // that resolves the first time SIGINT fires, then exit the process so the
  // user gets their shell back. The batch keeps running because workers
  // poll Redis independently of this producer.
  let detachedByUser = false
  const detachPromise = new Promise<'detached'>((resolveDetach) => {
    const handler = (): void => {
      detachedByUser = true
      console.log(
        `\n[backtest] SIGINT: detaching from batch ${batchUid}. ` +
          `Workers continue in background; resume at http://127.0.0.1:3051/ (npm run dashboard)`,
      )
      resolveDetach('detached')
    }
    process.once('SIGINT', handler)
    process.once('SIGTERM', handler)
  })

  try {
    const outcome = await Promise.race([
      node.job.waitUntilFinished(aggregateEvents).then((r) => ({ kind: 'done' as const, r })),
      detachPromise.then(() => ({ kind: 'detached' as const })),
    ])

    if (outcome.kind === 'done') {
      const r = outcome.r as { totalSucceeded: number; totalFailed: number; totalSkipped: number }
      console.log(
        `[backtest] aggregator done: succeeded=${r.totalSucceeded} failed=${r.totalFailed} skipped=${r.totalSkipped}`,
      )
    }
  } catch (err) {
    if (!detachedByUser) {
      console.error('[backtest] aggregator failed:', err)
    }
  } finally {
    marketEvents.off('completed', onCompleted)
    marketEvents.off('failed', onFailed)
    // Close listeners eagerly so the event loop can drain.
    await Promise.allSettled([marketEvents.close(), aggregateEvents.close()])
    await closeRedisConnection()
    await closeDb()
    console.log('\n[backtest] timer', timer.summary())
    if (detachedByUser) {
      // Hard-exit so any lingering ioredis reconnect timers or BullMQ
      // background polls don't keep us alive past the user's Ctrl+C.
      process.exit(0)
    }
  }
}

main().catch(async (err) => {
  console.error('[backtest] failed', err)
  await closeDb()
  process.exit(1)
})
