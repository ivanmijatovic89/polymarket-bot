import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  buildStrategyFromConfig,
  resolveStrategyFromArtifact,
  type ResolveStrategyResult,
} from '../../cli/helpers/strategyArgs.js'
import {
  getGammaMetadataBySlugs,
  getMarketsBySlugs,
  listEligibleTelonexMarkets,
  type Market as TelonexMarket,
  type ReadFrom,
} from '../../db/telonexMarkets.js'
import { getDb, backtestRuns } from '../../db/index.js'
import type { GammaMarketMeta } from '../../polymarket/gammaMarketMeta.js'
import { windowFromSlug, windowStartMsFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { artifactCachePath } from '../../strategy/artifacts/loader.js'
import { externalFeedsRequest } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { getMarketResolution as getTelonexMarketResolution } from '../stats/telonexMarketResolution.js'
import type { MarketJobData } from '../jobTypes.js'
import type { RunSingleMarketLatency } from '../runSingleMarket.js'
import { getCurrentGitSha } from '../workerIdentity.js'
import { eq } from 'drizzle-orm'

/**
 * Producer-side job building for the parity harness: the same telonex-delta
 * resolution `src/cli/backtest.ts` performs per market (eligibility module,
 * telonex resolution, token-map meta, slug window, Gamma priceToBeat), ending
 * in the exact `MarketJobData` a backtest worker receives. Read-only on MySQL.
 */

export const DEFAULT_DATA_ROOT = '/Users/mijat/Sites/polymarket-bot/data'

export type ParityStrategySelection = {
  strategyId?: string
  artifactSha256?: string
  rawParams: Record<string, unknown>
}

/**
 * Point dataset lookups at `dataRoot` (a worktree has no `data/` of its own):
 * Binance aggTrades + Telonex crypto_prices via their documented env
 * overrides (explicit env wins), artifacts copied into this checkout's cache
 * (the loader requires the cache under the repo root so `#pmb/*` resolves to
 * THIS checkout's engine). Returns the env to hand to child processes.
 */
export function useDataRoot(dataRoot: string): Record<string, string> {
  const env = {
    BINANCE_DATA_BASE_DIR: process.env.BINANCE_DATA_BASE_DIR || path.join(dataRoot, 'binance'),
    TELONEX_CRYPTO_PRICES_BASE_DIR:
      process.env.TELONEX_CRYPTO_PRICES_BASE_DIR || path.join(dataRoot, 'telonex', 'crypto_prices'),
  }
  Object.assign(process.env, env)
  return env
}

/** Copy a published artifact bundle from `dataRoot` into this checkout's cache (hash is verified on load). */
export function stageArtifact(sha256: string, dataRoot: string): void {
  const dest = artifactCachePath(sha256)
  if (existsSync(dest)) return
  const src = path.join(dataRoot, 'strategy-artifacts', `${sha256}.mjs`)
  if (!existsSync(src)) return // loader falls back to its R2 download
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

/** Raw params of a recorded run (read-only). */
export async function paramsFromRun(runId: number): Promise<{
  params: Record<string, unknown>
  strategy: string
  artifactSha256: string | null
  cmd: string | null
}> {
  const [row] = await getDb()
    .select({
      params: backtestRuns.params,
      strategy: backtestRuns.strategy,
      sha: backtestRuns.strategyArtifactSha256,
      cmd: backtestRuns.cmd,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, runId))
    .limit(1)
  if (!row) throw new Error(`backtest run ${runId} not found`)
  return {
    params: (row.params ?? {}) as Record<string, unknown>,
    strategy: row.strategy,
    artifactSha256: row.sha ?? null,
    cmd: row.cmd ?? null,
  }
}

export async function resolveParityStrategy(
  sel: ParityStrategySelection,
  dataRoot: string,
): Promise<ResolveStrategyResult> {
  if (sel.artifactSha256) {
    stageArtifact(sel.artifactSha256, dataRoot)
    return resolveStrategyFromArtifact({ sha256: sel.artifactSha256, rawParams: sel.rawParams })
  }
  if (!sel.strategyId) throw new Error('missing --strategy or --strategy-artifact')
  return buildStrategyFromConfig({ strategyId: sel.strategyId, rawParams: sel.rawParams })
}

/** Mirror of the private `buildMetaFromTokenMap` in src/cli/backtest.ts (keep in sync). */
function buildMetaFromTokenMap(
  slug: string,
  tokenMap: Record<string, string>,
  extra: { startDateMs: number | null; endDateMs: number | null; question: string | null },
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
  const windowStartMs = windowStartMsFromSlug(slug)
  if (windowStartMs !== null) meta.eventStartTime = new Date(windowStartMs).toISOString()
  if (extra.startDateMs != null) meta.startDate = new Date(extra.startDateMs).toISOString()
  if (extra.endDateMs != null) meta.endDate = new Date(extra.endDateMs).toISOString()
  if (extra.question) meta.question = extra.question
  return meta as GammaMarketMeta
}

/** Resolve a dataset path the way a worker would, but against `dataRoot`'s checkout. */
export function resolveDatasetPath(dataset: string, dataRoot: string): string {
  if (dataset.startsWith('r2://') || path.isAbsolute(dataset)) return dataset
  return path.resolve(path.dirname(dataRoot), dataset)
}

export type BuildJobsArgs = {
  slugs: string[]
  built: ResolveStrategyResult
  latency: RunSingleMarketLatency
  startingCapital: number
  readFrom: ReadFrom
  dataRoot: string
}

/**
 * One `MarketJobData` per eligible slug (ineligible / unknown slugs are
 * reported in `missing`). `filePath` is absolute (resolved against the data
 * root) so any executor can open it without knowing the repo layout.
 */
export async function buildParityJobs(
  args: BuildJobsArgs,
): Promise<{ jobs: MarketJobData[]; missing: string[] }> {
  const requiredFeeds = externalFeedsRequest(args.built)
  const rows = await getMarketsBySlugs(args.slugs, {
    converter: 'delta-typed',
    readFrom: args.readFrom,
    requiredFeeds,
  })
  const bySlug = new Map(rows.map((r) => [r.slug, r] as const))
  const gamma =
    requiredFeeds.polymarketPriceToBeat?.enabled === true
      ? await getGammaMetadataBySlugs(args.slugs)
      : null
  const commitSha = getCurrentGitSha()
  const jobs: MarketJobData[] = []
  const missing: string[] = []
  args.slugs.forEach((slug, idx) => {
    const row = bySlug.get(slug)
    if (!row || !row.dataset) {
      missing.push(slug)
      return
    }
    jobs.push(jobFromRow({ ...args, row, idx, gamma, commitSha }))
  })
  return { jobs, missing }
}

function jobFromRow(
  args: BuildJobsArgs & {
    row: TelonexMarket
    idx: number
    gamma: Map<string, { priceToBeat: number | null; syncedAtMs: number | null }> | null
    commitSha: string
  },
): MarketJobData {
  const { row, built } = args
  const slug = row.slug
  const marketResolution = getTelonexMarketResolution(row)
  const marketMeta = marketResolution
    ? buildMetaFromTokenMap(slug, marketResolution.tokenMap, {
        startDateMs: row.startDateMs,
        endDateMs: row.endDateMs,
        question: row.question,
      })
    : undefined
  return {
    startingCapital: args.startingCapital,
    submissionUid: `parity-${slug}`,
    batchUid: `parity-${slug}`,
    idx: args.idx,
    filePath: resolveDatasetPath(row.dataset!, args.dataRoot),
    slug,
    marketMeta,
    marketResolution,
    strategyId: built.strategyId,
    strategyParams: built.params,
    ...(built.artifact ? { strategyArtifact: built.artifact.ref } : {}),
    inputMode: 'telonex-delta',
    order: 'recorded',
    timeDriven: false,
    latency: args.latency,
    strategyWindow: windowFromSlug(slug),
    commitSha: args.commitSha,
    ...(args.gamma ? { gammaPriceToBeat: args.gamma.get(slug) ?? null } : {}),
  }
}

/** Deterministic PRNG (mulberry32) for reproducible market sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Seeded random sample of eligible telonex-delta markets (same eligibility as
 * the producer, incl. the strategy's required feeds). Candidates are ordered
 * chronologically, restricted to locally present files when reading local,
 * then Fisher–Yates shuffled with `seed`. Stable for a fixed [fromMs, toMs].
 */
export async function selectParitySlugs(args: {
  symbol: string
  timeframe: string
  limit: number
  seed: number
  fromMs: number
  toMs?: number
  readFrom: ReadFrom
  requiredFeeds: ExternalFeedsRequestConfig
  dataRoot: string
}): Promise<string[]> {
  const rows = await listEligibleTelonexMarkets({
    symbol: args.symbol,
    timeframe: args.timeframe,
    converter: 'delta-typed',
    readFrom: args.readFrom,
    requiredFeeds: args.requiredFeeds,
    fromMs: args.fromMs,
    ...(args.toMs !== undefined ? { toMs: args.toMs } : {}),
    limit: Number.MAX_SAFE_INTEGER,
  })
  const candidates = rows
    .filter(
      (r) =>
        r.dataset &&
        (args.readFrom !== 'local' || existsSync(resolveDatasetPath(r.dataset, args.dataRoot))),
    )
    .map((r) => r.slug)
  const rand = mulberry32(args.seed)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
  }
  return candidates.slice(0, args.limit)
}
