import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { getDb, backtestRuns, backtestRunMarkets } from '../../db/index.js'
import { getMarketBySlug, getGammaMetadataBySlugs } from '../../db/telonexMarkets.js'
import { getMarketBySlug as getRecordedMarket } from '../../db/markets.js'
import { resolveStrategyFromArtifact } from '../../cli/helpers/strategyArgs.js'
import { parseRecordedBacktestArgs } from '../../cli/helpers/backtestArgs.js'
import { resolveStartingCapital } from '../../cli/helpers/capitalArgs.js'
import { getStrategyDefinition } from '../../strategy/strategyRegistry.js'
import { localOutputPath } from '../../telonex/localOutputPath.js'
import { downloadR2ToLocal, fileExists } from '../../telonex/fetchConvertedToLocal.js'
import { buildGammaMarketMeta, type GammaMarketMeta } from '../../polymarket/gammaMarketMeta.js'
import { windowFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { DEFAULT_RISK_LIMITS } from '../../trading/riskLimits.js'
import { resolveMaxEventsPerDrain } from '../../trading/runnerConfig.js'
import { binanceFeedLatencyMs, rtdsChainlinkLatencyMs } from '../feeds/wireBacktestExternalFeeds.js'
import type { RunSingleMarketInput } from '../runSingleMarket.js'
import type { ReplayProvenance } from './contracts.js'

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const part of createReadStream(file)) hash.update(part as Buffer)
  return hash.digest('hex')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return entry.isFile() && file.endsWith('.ts') && !file.endsWith('.test.ts') ? [file] : []
  })
}

export async function resolveSimulatorMarket(runId: number, slug: string) {
  if (!Number.isSafeInteger(runId) || runId < 1 || !/^[a-zA-Z0-9_-]{1,255}$/.test(slug)) {
    throw new Error('Invalid run or market identifier')
  }
  const db = getDb()
  const [row] = await db
    .select({ run: backtestRuns, market: backtestRunMarkets })
    .from(backtestRuns)
    .innerJoin(backtestRunMarkets, eq(backtestRunMarkets.runId, backtestRuns.id))
    .where(and(eq(backtestRuns.id, runId), eq(backtestRunMarkets.slug, slug)))
    .limit(1)
  if (!row) throw new Error('This market does not belong to the selected backtest run.')
  const { run, market } = row
  const warnings = [
    'Reconstructed replay: this run saved final statistics, not its original tick/order trace. Matching totals do not prove an identical historical path.',
    'Original dataset hashes and environment settings were not saved. Current input bytes are fingerprinted below.',
  ]
  const parsed = parseRecordedBacktestArgs(run.cmd)
  if (!parsed)
    warnings.push('Saved command could not be parsed; ordering uses the current backtest defaults.')
  const startingCapital = parsed?.startingCapital ?? resolveStartingCapital([])
  if (parsed?.startingCapital === undefined)
    warnings.push(
      'Per-market starting capital was not recorded. Replay applies the current environment/default allowance; older runs may predate capital enforcement.',
    )
  const envInt = (name: string, fallback: number) =>
    Math.max(0, Math.trunc(Number(process.env[name] ?? fallback) || 0))
  const latency = {
    delayMs: parsed?.latencyDelayMs ?? envInt('BACKTEST_LATENCY_DELAY', 0),
    jitterMs: parsed?.latencyJitterMs ?? envInt('BACKTEST_LATENCY_JITTER', 20),
  }
  if (parsed?.latencyDelayMs === undefined || parsed.latencyJitterMs === undefined) {
    warnings.push(
      'Latency flags were not fully saved; missing values use the dashboard environment/defaults shown below.',
    )
  }
  if (latency.delayMs > 0 && latency.jitterMs > 0)
    warnings.push('Nonzero jitter uses unseeded randomness; replay can differ on every run.')
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const sourceHash = createHash('sha256')
  const sources = sourceFiles('src').sort()
  for (const file of sources) sourceHash.update(file).update(readFileSync(file))
  if (market.commitSha !== currentCommit)
    warnings.push('The dashboard engine commit differs from the original worker commit.')
  if (
    execFileSync('git', ['diff', 'HEAD', '--', 'src'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }).trim()
  ) {
    warnings.push(
      'The dashboard has local source changes; the current source fingerprint includes them.',
    )
  }
  const artifact = run.strategyArtifactSha256
    ? await resolveStrategyFromArtifact({
        sha256: run.strategyArtifactSha256,
        rawParams: run.params,
        fallbackMeta: run.strategyArtifactMeta,
        allowRegistryIdCollision: true,
      })
    : null
  const definition = artifact?.definition ?? getStrategyDefinition(run.strategy)
  if (!artifact)
    warnings.push(
      'Registry strategy: using current local source because this run has no immutable strategy artifact.',
    )
  const params = (artifact?.params ?? definition.schema.parse(run.params)) as Record<
    string,
    unknown
  >
  const inputMode = run.inputMode ?? parsed?.inputMode ?? 'recorded'
  if (!['recorded', 'telonex-delta', 'telonex-paired'].includes(inputMode))
    throw new Error(`Unsupported input mode: ${inputMode}`)
  let filePath: string, dataset: string, meta: GammaMarketMeta | undefined
  const window = windowFromSlug(slug)
  if (inputMode === 'recorded') {
    const recorded = await getRecordedMarket(slug)
    if (!recorded?.dataset)
      throw new Error('The original recorded dataset is no longer in the market catalog.')
    dataset = recorded.dataset
    filePath = dataset.startsWith('r2://')
      ? path.resolve('data/simulator-inputs', `${slug}.parquet`)
      : path.resolve(dataset)
    meta = recorded.rawJson
      ? (buildGammaMarketMeta(recorded.rawJson as Record<string, unknown>, slug) ?? undefined)
      : undefined
  } else {
    const converter = inputMode === 'telonex-delta' ? 'delta-typed' : 'paired'
    const readFrom = run.readFrom === 'local' ? 'local' : 'local-or-download-from-r2-to-local'
    const catalog = await getMarketBySlug(slug, { converter, readFrom })
    if (!catalog?.dataset || !catalog.assetId0 || !catalog.assetId1) {
      throw new Error('Market dataset or token mapping is missing from the catalog.')
    }
    dataset = catalog.dataset
    filePath =
      readFrom === 'local'
        ? path.resolve(dataset)
        : localOutputPath({ converter, symbol: catalog.symbol, timeframe: catalog.timeframe, slug })
            .absolute
    const up = catalog.assetId0,
      down = catalog.assetId1
    meta = {
      slug,
      outcomes: ['UP', 'DOWN'],
      clobTokenIds: [up, down],
      outcomeTokenMap: { up, down },
      upAssetId: up,
      downAssetId: down,
      ...(window ? { eventStartTime: new Date(window.startMs).toISOString() } : {}),
      ...(catalog.startDateMs !== null
        ? { startDate: new Date(catalog.startDateMs).toISOString() }
        : {}),
      ...(catalog.endDateMs !== null ? { endDate: new Date(catalog.endDateMs).toISOString() } : {}),
      ...(catalog.question ? { question: catalog.question } : {}),
    }
  }
  if (!meta?.upAssetId || !meta.downAssetId)
    throw new Error('Cannot reconstruct this market’s UP/DOWN metadata.')
  if (!(await fileExists(filePath))) {
    if (!dataset.startsWith('r2://'))
      throw new Error('Historical parquet is missing on this dashboard host.')
    await downloadR2ToLocal(dataset, filePath)
  }
  const gamma = (await getGammaMetadataBySlugs([slug])).get(slug) ?? null
  const tokens = { UP: meta.upAssetId, DOWN: meta.downAssetId }
  const input: RunSingleMarketInput = {
    startingCapital,
    idx: market.idx,
    slug,
    filePath,
    marketMeta: meta,
    marketResolution: { tokenMap: tokens, outcome: market.finalOutcome },
    strategyId: artifact?.strategyId ?? run.strategy,
    strategyParams: params,
    strategyDefinition: definition,
    inputMode: inputMode as RunSingleMarketInput['inputMode'],
    order: parsed?.order ?? 'recorded',
    timeDriven: parsed?.timeDriven ?? false,
    latency,
    strategyWindow: inputMode === 'recorded' ? null : window,
    machineId: 'dashboard-simulator',
    commitSha: currentCommit,
    gammaPriceToBeat: gamma,
  }
  const provenance: ReplayProvenance = {
    runId,
    slug,
    marketIndex: market.idx,
    strategy: input.strategyId,
    params,
    artifactSha256: run.strategyArtifactSha256,
    originalCommit: market.commitSha,
    currentCommit,
    sourceFingerprint: sourceHash.digest('hex'),
    dataset,
    datasetSha256: await hashFile(filePath),
    inputMode,
    order: input.order,
    timeDriven: input.timeDriven,
    latency,
    window: input.strategyWindow ?? null,
    initialCapital: Number(run.capitalInitial),
    outcome: market.finalOutcome,
    settings: {
      startingCapital,
      maxEventsPerDrain: resolveMaxEventsPerDrain(),
      riskLimits: DEFAULT_RISK_LIMITS,
      makerFillMode: 'worst_queue',
      cancelLatency: true,
      binanceFeedLatencyMs: binanceFeedLatencyMs(),
      chainlinkFeedLatencyMs: rtdsChainlinkLatencyMs(),
      gammaPriceToBeat: gamma,
    },
    warnings,
  }
  return { input, provenance, expected: market, tokens }
}
