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
import type { GammaMarketMeta } from '../../polymarket/gammaMarketMeta.js'
import { windowFromSlug, windowStartMsFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { artifactCachePath } from '../../strategy/artifacts/loader.js'
import { externalFeedsRequest } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { getMarketResolution as getTelonexMarketResolution } from '../stats/telonexMarketResolution.js'
import type { MarketJobData } from '../jobTypes.js'
import type { RunSingleMarketLatency } from '../runSingleMarket.js'
import { getCurrentGitSha } from '../workerIdentity.js'

/**
 * Producer-side job building for the parity harness: the same telonex-delta
 * resolution `src/cli/backtest.ts` performs per market (eligibility module,
 * telonex resolution, token-map meta, slug window, Gamma priceToBeat), ending
 * in the `MarketJobData` a backtest worker receives (60 HR-2; validated
 * against the producer by H-1). Read-only on MySQL, and only through
 * `src/db/telonexMarkets.ts`.
 */

export type ParityStrategySelection = {
  strategyId?: string
  artifactSha256?: string
  rawParams: Record<string, unknown>
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

export async function resolveParityStrategy(
  sel: ParityStrategySelection,
  dataRoot: string,
): Promise<ResolveStrategyResult> {
  if (sel.artifactSha256) {
    stageArtifact(sel.artifactSha256, dataRoot)
    return resolveStrategyFromArtifact({ sha256: sel.artifactSha256, rawParams: sel.rawParams })
  }
  if (!sel.strategyId) throw new Error('missing strategy id or artifact sha256')
  return buildStrategyFromConfig({ strategyId: sel.strategyId, rawParams: sel.rawParams })
}

/** Mirror of the private `buildMetaFromTokenMap` in src/cli/backtest.ts:171-205 (keep in sync; H-1 checks it). */
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

/**
 * Resolve a catalog dataset path (`data/events/telonex/...`, relative to the
 * repository root) under `dataRoot` (00 §5 "Data roots"). Anything else is an
 * error (R14): parity jobs read only local inputs (60 MS-5).
 */
export function resolveDatasetPath(dataset: string, dataRoot: string): string {
  if (dataset.startsWith('r2://'))
    throw new Error(`parity reads local inputs only (MS-5): ${dataset}`)
  if (path.isAbsolute(dataset)) return dataset
  const parts = dataset.split('/')
  if (parts[0] !== 'data' || parts.length < 2)
    throw new Error(`dataset path ${dataset} is not under data/; cannot place it under --data-root`)
  return path.join(dataRoot, ...parts.slice(1))
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
 * One `MarketJobData` per eligible slug (ineligible or unknown slugs are
 * reported in `missing`). `filePath` is absolute (resolved under the data
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
    // One candidate per market; its key is the submission uid (21 §5, §8) and
    // the trace header's candidateKey (22 §3.2).
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

/** Deterministic PRNG (mulberry32) for reproducible market sampling (MS-2 "seeded random"). */
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

/** Fisher–Yates shuffle with a seeded PRNG (stable for a fixed input order and seed). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export type StratifiedCandidate = {
  slug: string
  marketStartMs: number
  localPath: string
  /** Outcome token ids (catalog asset ids), for the MS-3 edge scan. */
  assets?: string[]
}

/**
 * MS-2 / MS-5: seeded random selection stratified by calendar month (UTC).
 * Within each month the candidates (chronological) are shuffled with
 * `seed + month index`; the first `perMonth` with a local input are taken,
 * so a market without local data is replaced by the next seeded market and
 * reported in `replaced`.
 */
export function stratifiedByMonth(
  candidates: readonly StratifiedCandidate[],
  perMonth: number,
  seed: number,
  hasLocal: (c: StratifiedCandidate) => boolean,
): { selected: StratifiedCandidate[]; replaced: string[]; months: Record<string, number> } {
  const byMonth = new Map<string, StratifiedCandidate[]>()
  for (const c of candidates) {
    const m = new Date(c.marketStartMs).toISOString().slice(0, 7)
    const list = byMonth.get(m) ?? []
    list.push(c)
    byMonth.set(m, list)
  }
  const selected: StratifiedCandidate[] = []
  const replaced: string[] = []
  const months: Record<string, number> = {}
  const keys = [...byMonth.keys()].sort()
  keys.forEach((m, i) => {
    const pool = seededShuffle(
      byMonth
        .get(m)!
        .slice()
        .sort((a, b) => a.marketStartMs - b.marketStartMs),
      seed + i,
    )
    let taken = 0
    for (const c of pool) {
      if (taken >= perMonth) break
      if (!hasLocal(c)) {
        replaced.push(c.slug)
        continue
      }
      selected.push(c)
      taken++
    }
    months[m] = taken
  })
  selected.sort((a, b) => a.marketStartMs - b.marketStartMs)
  return { selected, replaced, months }
}

/** All eligible telonex-delta markets for a feed request (the only eligibility path, MS-2). */
export async function listParityCandidates(args: {
  symbol: string
  timeframe: string
  fromMs: number
  toMs?: number
  requiredFeeds: ExternalFeedsRequestConfig
  dataRoot: string
}): Promise<StratifiedCandidate[]> {
  const rows = await listEligibleTelonexMarkets({
    symbol: args.symbol,
    timeframe: args.timeframe,
    converter: 'delta-typed',
    readFrom: 'local',
    requiredFeeds: args.requiredFeeds,
    fromMs: args.fromMs,
    ...(args.toMs !== undefined ? { toMs: args.toMs } : {}),
    limit: Number.MAX_SAFE_INTEGER,
  })
  return rows
    .filter((r) => r.dataset)
    .map((r) => ({
      slug: r.slug,
      marketStartMs: r.marketStartMs,
      localPath: resolveDatasetPath(r.dataset!, args.dataRoot),
      assets: [r.assetId0, r.assetId1].filter(
        (a): a is string => typeof a === 'string' && a !== '',
      ),
    }))
}
