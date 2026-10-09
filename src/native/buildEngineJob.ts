/**
 * `buildEngineJob(MarketJobData, dataRoots)` (21 §5, §9; 01 §3.1, §6 M1 step
 * 6): the one TS builder shared by the parity harness, `--sequential` and the
 * worker shim. It asserts the native `MarketJobData` invariants (21 §4),
 * short-circuits the TS-decided skips without a spawn (21 §13), resolves the
 * market input to a verified local absolute path (21 §9 steps 1-2) and the
 * feed day files under the data root (step 3), and returns an `EngineJob`
 * that passes the generated schema (21 §3, §19).
 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs, type Stats } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MarketJobData } from '../backtest/jobTypes.js'
import type { ReadFrom } from '../db/telonexMarkets.js'
import { windowFromSlug } from '../polymarket/upDownSlugWindow.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { canonicalJson } from './contract/canonicalJson.js'
import type {
  CandidateSpec,
  EngineJob,
  FeedAvailability,
  FeedFile,
  InputFormat,
  JobBudget,
  JobOutputs,
  MarketRules,
  ModelConfig,
  SkipReason,
  Window,
} from './contract/generated.js'
import { createContractValidators, type ContractValidators } from './contract/validate.js'
import { NativeError } from './errors.js'
import { dayFileFixCommand, feedDayFiles } from './feeds.js'
import { executionProblems, numberToDecimalString, validateModelConfig } from './modelConfig.js'

/** `EngineJob` schema version this shim builds (21 §5, 20 §3). */
export const JOB_SCHEMA_VERSION = 1 as const

/** v1 universe (21 §5.1, D06). */
export const NATIVE_SLUG_RE = /^btc-updown-(5m|15m)-[0-9]{10}$/

/** Input formats this shim builds jobs for (15 §4; the binary checks support, 21 §5.1). */
export const TELONEX_DELTA_FORMAT: Readonly<InputFormat> = {
  name: 'telonex-delta-typed',
  version: 1,
}

/** Logical market input of a native job (21 §4 `input`, 15 I-8). */
export interface NativeInputRef {
  /**
   * Canonical path: repository-relative `data/...` (resolved under the data
   * root, 00 §5) or absolute. Never `r2://` (that is `r2Url`).
   */
  path: string
  /** R2 object for `local-or-download-from-r2-to-local` and `r2` (21 §9 step 1). */
  r2Url: string | null
  bytes: number
  sha256: string | null
  format: InputFormat
}

/**
 * The native fields of `MarketJobData` (21 §4). `MarketJobData` stays
 * TS-owned (`src/backtest/jobTypes.ts`); its native sub-objects are the
 * generated contract types (21 §3).
 */
export interface NativeJobFields {
  jobSchemaVersion: typeof JOB_SCHEMA_VERSION
  modelConfig: ModelConfig
  /** Captured rules record (21 §7); the empty form before M3a (21 §7.2). */
  rules: MarketRules
  /** Group jobs only; absent = one candidate from `strategyParams` keyed by `submissionUid` (21 §4). */
  candidates?: CandidateSpec[]
  conditionId: string | null
  input: NativeInputRef
  /**
   * The submission's `--read-from` (21 §9 step 1, 40 §6.1).
   */
  // D-PENDING: 21 §4 lists no read-mode field although 21 §9 and 40 §6.1 branch on it; chose a `readFrom` field next to `input`.
  readFrom: ReadFrom
  feedAvailability: FeedAvailability
  /** Producer wall clock when `feedAvailability` was resolved; provenance only (21 §4, §5.3). */
  asOfMs: number
  /** Calibration replays only (15 I-39, M10, out of this goal per D70). */
  ownActivity: null
  /** Write a ledger (22 §4.1); not result-affecting. */
  ledger: boolean
  /**
   * The strategy's `describe.requiredFeeds` (20 §5.1), which decides the
   * feed day files of 21 §9 step 3.
   */
  // D-PENDING: 21 §4 has no field for the strategy's required feeds although 21 §9 step 3 resolves day files for them; chose a `requiredFeeds` field copied by the producer from describe.
  requiredFeeds: ExternalFeedsRequestConfig | null
}

/** A native market job: the BullMQ payload with the 21 §4 additions. */
export type NativeMarketJobData = MarketJobData & NativeJobFields

/** Data roots (00 §5 "Data roots"): `--data-root`, default `<repository root>/data`. */
export interface DataRoots {
  dataRoot: string
}

/** Download `r2Url` to `absPath` atomically, failing on a size mismatch. */
export type R2Download = (r2Url: string, absPath: string, expectedBytes: number) => Promise<void>

export interface BuildEngineJobOptions {
  /** Non-semantic outputs (21 §5.1); default no trace, `decisions`, no ledger. */
  outputs?: Partial<JobOutputs>
  /** Non-semantic budget (21 §5.1); default 40 §8.2 item 1 before M6. */
  budget?: JobBudget
  /** Parent of the per-job temp dir for `--read-from r2` (21 §9 step 1). */
  tempRoot?: string
  /** R2 download (tests); default `downloadR2ToLocal`. */
  download?: R2Download
  /** `[read-from]` log lines (21 §9 step 1); default `console.log`. */
  log?: (line: string) => void
}

/** Result of {@link buildEngineJob}. */
export type BuiltEngineJob =
  | {
      kind: 'job'
      job: EngineJob
      /** Removes per-job temp files (`--read-from r2`); idempotent. */
      cleanup: () => Promise<void>
    }
  | {
      /** TS-decided skip: never spawned, `eventsProcessed: 0` (21 §13). */
      kind: 'short_circuit'
      slug: string | null
      skipReason: Extract<SkipReason, 'no_slug' | 'no_resolution' | 'unresolved_outcome'>
    }

let validators: ContractValidators | null = null
function contractValidators(): ContractValidators {
  validators ??= createContractValidators()
  return validators
}

function invalid(cause: string, message: string): NativeError {
  return new NativeError('invalid_input', cause, message)
}

/**
 * Default per-job budget before the M6 benchmark: `120 s + 5 s × k` for `k`
 * candidates, one thread per job (40 §8.2 item 1, §7.2), inside the 21 §5.1
 * range.
 */
export function defaultBudget(candidates: number): JobBudget {
  return { wallMs: Math.min(3_600_000, 120_000 + 5_000 * candidates), threads: 1 }
}

/** 21 §4 invariants of a native `MarketJobData` that are submission-level bugs. */
function assertNativeInvariants(job: NativeMarketJobData): void {
  if (job.jobSchemaVersion !== JOB_SCHEMA_VERSION) {
    throw invalid(
      'version',
      `jobSchemaVersion ${String(job.jobSchemaVersion)} is not built by this shim`,
    )
  }
  if ('nativeProfile' in job) {
    throw invalid(
      'schema',
      'nativeProfile MUST be absent on native jobs; the profile is modelConfig.profile (21 §4)',
    )
  }
  if (job.order !== 'recorded' || job.timeDriven !== false) {
    throw invalid(
      'flag',
      `native jobs replay in recorded order without time-driven mode (21 §4, 20 §5.6)`,
    )
  }
  if (job.inputMode !== 'telonex-delta') {
    // recorder-v4 lands in M7 and journal in M8 (01 §6); recorded and
    // telonex-paired are never native (20 §5.6).
    throw invalid(
      'input_mode',
      `input mode ${job.inputMode} is not supported by this shim yet (telonex-delta only)`,
    )
  }
  if (job.ownActivity !== null) {
    throw invalid(
      'schema',
      'ownActivity is for calibration replays (15 I-39), not built by this shim',
    )
  }
  validateModelConfig(job.modelConfig)
  const mc = job.modelConfig
  // 21 §4: the legacy fields equal the ModelConfig values, so they cannot diverge silently.
  if (mc.execution.models.latency === 'compat') {
    const want = mc.execution.compatLatency
    if (job.latency.delayMs !== want.delayMs || job.latency.jitterMs !== want.jitterMs) {
      throw invalid(
        'model_config',
        `legacy latency ${JSON.stringify(job.latency)} != modelConfig.execution.compatLatency ${JSON.stringify(want)}`,
      )
    }
  }
  if (job.startingCapital === undefined) {
    throw invalid(
      'model_config',
      'legacy startingCapital is missing (21 §4: it MUST equal modelConfig.capital)',
    )
  }
  let legacy: string
  try {
    legacy = numberToDecimalString(job.startingCapital)
  } catch (err) {
    throw invalid('model_config', `legacy startingCapital: ${(err as Error).message}`)
  }
  if (legacy !== mc.capital.startingCapitalUsdc) {
    throw invalid(
      'model_config',
      `legacy startingCapital ${legacy} != modelConfig.capital.startingCapitalUsdc ${mc.capital.startingCapitalUsdc}`,
    )
  }
  if (job.ledger) {
    throw invalid('flag', '--ledger lands in M3b (22 §4.1, 20 §5.6); no ledger path is built yet')
  }
}

/**
 * The run's candidates (21 §4, §8): the given array checked against C1, C2
 * and C4, or one candidate from `strategyParams` keyed by `submissionUid`.
 */
function candidatesOf(job: NativeMarketJobData): CandidateSpec[] {
  if (job.candidates === undefined) {
    return [{ key: job.submissionUid, index: 0, params: job.strategyParams, execution: null }]
  }
  const list = job.candidates
  if (list.length === 0) throw invalid('params', 'candidates is empty (21 §5.1: 1..maxCandidates)')
  const keys = new Set<string>()
  const pairs = new Set<string>()
  list.forEach((c, i) => {
    if (c.index !== i)
      throw invalid('params', `candidate ${c.key} has index ${c.index}, expected ${i} (21 §8 C1)`)
    if (keys.has(c.key)) throw invalid('params', `duplicate candidate key ${c.key} (21 §8 C1)`)
    keys.add(c.key)
    if (c.execution !== null) {
      if (job.modelConfig.profile === 'ts-compat') {
        throw invalid(
          'params',
          `candidate ${c.key}: ts-compat candidates cannot vary execution (21 §8 C4)`,
        )
      }
      const problems = executionProblems(job.modelConfig.profile, c.execution)
      if (problems.length > 0)
        throw invalid('model_config', `candidate ${c.key}: ${problems.join('; ')}`)
    }
    // C2: params may hold floats (21 §18 N7), so they are compared as JSON text of the normalized object.
    const effective = c.execution ?? job.modelConfig.execution
    const pair = `${JSON.stringify(sortKeys(c.params))}\u0000${canonicalJson(effective)}`
    if (pairs.has(pair))
      throw invalid(
        'params',
        `candidate ${c.key} duplicates another (params, execution) pair (21 §8 C2)`,
      )
    pairs.add(pair)
  })
  return list
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (typeof v !== 'object' || v === null) return v
  const o = v as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, sortKeys(o[k])]),
  )
}

/** 21 §5.1 window: the slug window; `strategyWindow`, when present, must equal it. */
function windowOf(job: NativeMarketJobData, slug: string): Window {
  const w = windowFromSlug(slug)
  if (!w) throw invalid('window', `no window derivable from slug ${slug}`)
  const sw = job.strategyWindow
  if (sw !== null && (sw.startMs !== w.startMs || sw.endMs !== w.endMs)) {
    throw invalid(
      'window',
      `strategyWindow ${JSON.stringify(sw)} != slug window ${JSON.stringify(w)} (21 §5.1)`,
    )
  }
  return w
}

/** 14 §6.2 consistency of the producer's price-to-beat resolution with the strategy's request. */
function assertFeedAvailability(job: NativeMarketJobData): void {
  const requested = job.requiredFeeds?.polymarketPriceToBeat?.enabled === true
  const ptb = job.feedAvailability.priceToBeat
  if (!requested) {
    if (ptb !== null || job.gammaPriceToBeat !== undefined) {
      throw invalid(
        'feed_availability',
        'price-to-beat is resolved but the strategy does not request it (14 §6.2)',
      )
    }
    return
  }
  if (ptb === null || job.gammaPriceToBeat === undefined) {
    throw invalid(
      'feed_availability',
      'the strategy requests price-to-beat but the producer did not resolve it (14 §6.2)',
    )
  }
  if (ptb.status === 'fed') {
    const v = job.gammaPriceToBeat?.priceToBeat
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw invalid(
        'feed_availability',
        'feedAvailability.priceToBeat is fed but gammaPriceToBeat has no finite value (14 §6.2)',
      )
    }
  } else if (ptb.status.startsWith('unavailable_') && !ptb.message) {
    throw invalid(
      'feed_availability',
      `feedAvailability.priceToBeat ${ptb.status} needs a message (14 §6.2)`,
    )
  }
}

/** A canonical input path resolved under the data root (00 §5, 21 §9 step 1). */
export function resolveUnderDataRoot(canonical: string, dataRoot: string): string {
  if (canonical.startsWith('r2://')) {
    throw invalid('path', `input path ${canonical} is an R2 URL; R2 goes in input.r2Url (20 G3)`)
  }
  if (path.isAbsolute(canonical)) return canonical
  const parts = canonical.split('/')
  if (parts[0] !== 'data' || parts.length < 2 || parts.includes('..')) {
    throw invalid('path', `input path ${canonical} is neither absolute nor under data/ (00 §5)`)
  }
  return path.join(dataRoot, ...parts.slice(1))
}

async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await fs.stat(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new NativeError('runtime', 'io', `stat ${p}: ${(err as Error).message}`)
  }
}

/**
 * Per-process verification index (40 §6.1 item 2): `(dev, ino, bytes,
 * mtime)` → verified sha256, so a file is hashed once per process, not per
 * job. The persistent host index (`data/native/verified-inputs.idx`) is M6.
 */
const verifiedSha = new Map<string, string>()

function identityKey(st: Stats): string {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`
}

async function sha256Of(file: string, st: Stats): Promise<string> {
  const key = identityKey(st)
  const known = verifiedSha.get(key)
  if (known !== undefined) return known
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (b) => hash.update(b))
      .on('error', reject)
      .on('end', () => resolve())
  })
  const hex = hash.digest('hex')
  verifiedSha.set(key, hex)
  return hex
}

/** Integrity of a local copy against the job's `bytes` and `sha256` (21 §9 step 2). Null when it matches. */
async function integrityProblem(
  file: string,
  st: Stats,
  ref: NativeInputRef,
): Promise<string | null> {
  if (st.size !== ref.bytes) return `${file}: ${st.size} bytes, the job expects ${ref.bytes}`
  if (ref.sha256 !== null) {
    const got = await sha256Of(file, st)
    if (got !== ref.sha256) return `${file}: sha256 ${got}, the job expects ${ref.sha256}`
  }
  return null
}

async function defaultDownload(
  r2Url: string,
  absPath: string,
  expectedBytes: number,
): Promise<void> {
  // Loaded lazily: the R2 client reads its credentials only when used, and
  // parity runs (local inputs only, 60 MS-5) never reach this.
  const { downloadR2ToLocal } = await import('../telonex/fetchConvertedToLocal.js')
  await downloadR2ToLocal(r2Url, absPath, { expectedBytes })
}

/**
 * 21 §9 steps 1-2: the market input as a verified local absolute path.
 * `local`: the canonical file must exist (`data_missing: input_missing`) and
 * match (`data_missing: integrity_mismatch`). `local-or-download-from-r2-to-local`:
 * download when missing; a mismatching pre-existing copy is quarantined
 * (`<path>.bad-<ts>`) and re-downloaded once (40 §6.1 item 3). `r2`: download
 * into the per-job temp dir. A freshly downloaded copy that mismatches is
 * `data_defect: integrity_mismatch`; a failed download is `runtime: r2_download`.
 */
async function resolveInput(
  job: NativeMarketJobData,
  slug: string,
  roots: DataRoots,
  opts: BuildEngineJobOptions,
  temps: string[],
): Promise<string> {
  const ref = job.input
  const log = opts.log ?? ((line: string) => console.log(line))
  const download = opts.download ?? defaultDownload
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) {
    throw invalid('schema', `input.bytes ${ref.bytes} is not a positive integer`)
  }
  const fetch = async (to: string): Promise<void> => {
    if (ref.r2Url === null) {
      throw invalid('path', `--read-from ${job.readFrom} needs input.r2Url`)
    }
    log(`[read-from] R2 download slug=${slug} <- ${ref.r2Url}`)
    try {
      await download(ref.r2Url, to, ref.bytes)
    } catch (err) {
      throw new NativeError('runtime', 'r2_download', `${ref.r2Url}: ${(err as Error).message}`)
    }
    log(`[read-from] R2 done slug=${slug} bytes=${ref.bytes} -> ${to}`)
    const st = await statOrNull(to)
    const problem =
      st === null ? `${to} is missing after download` : await integrityProblem(to, st, ref)
    if (problem !== null) {
      throw new NativeError(
        'data_defect',
        'integrity_mismatch',
        `freshly downloaded ${problem} (15 I-8)`,
      )
    }
  }

  if (job.readFrom === 'r2') {
    const dir = await fs.mkdtemp(path.join(opts.tempRoot ?? os.tmpdir(), 'pmb-native-job-'))
    temps.push(dir)
    const to = path.join(dir, path.basename(ref.path))
    await fetch(to)
    return to
  }

  const canonical = resolveUnderDataRoot(ref.path, roots.dataRoot)
  const st = await statOrNull(canonical)
  if (st === null) {
    if (job.readFrom === 'local') {
      throw new NativeError('data_missing', 'input_missing', `${canonical} is not on this host`, {
        path: canonical,
        fixCommand: `npm run telonex:download-converted-r2-to-local -- --converter delta-typed --slug ${slug}`,
      })
    }
    await fetch(canonical)
    return canonical
  }
  const problem = await integrityProblem(canonical, st, ref)
  if (problem === null) {
    if (job.readFrom !== 'local') log(`[read-from] LOCAL hit slug=${slug} ${canonical}`)
    return canonical
  }
  if (job.readFrom === 'local') {
    throw new NativeError('data_missing', 'integrity_mismatch', problem, { path: canonical })
  }
  const quarantine = `${canonical}.bad-${Date.now()}`
  await fs.rename(canonical, quarantine)
  log(`[read-from] quarantined ${canonical} -> ${quarantine} (${problem})`)
  await fetch(canonical)
  return canonical
}

/** 21 §9 step 3: every day file present, with its size (`data_missing: day_file_missing` before spawn). */
async function resolveFeedFiles(
  slug: string,
  window: Window,
  req: ExternalFeedsRequestConfig | null,
  roots: DataRoots,
): Promise<FeedFile[]> {
  const out: FeedFile[] = []
  for (const f of feedDayFiles(roots.dataRoot, slug, window, req)) {
    const st = await statOrNull(f.path)
    if (st === null) {
      const fixCommand = dayFileFixCommand(f)
      throw new NativeError(
        'data_missing',
        'day_file_missing',
        `${f.feed} day file ${f.day} for ${f.symbol} is missing (${f.path}); run ${fixCommand}`,
        { path: f.path, fixCommand },
      )
    }
    out.push({ feed: f.feed, symbol: f.symbol, day: f.day, path: f.path, bytes: st.size })
  }
  return out
}

/**
 * Builds the `EngineJob` of one native market job (21 §5) or the TS
 * short-circuit of 21 §13. Throws `NativeError` with the 20 §4 class and
 * cause of the failure.
 */
export async function buildEngineJob(
  job: NativeMarketJobData,
  dataRoots: DataRoots,
  opts: BuildEngineJobOptions = {},
): Promise<BuiltEngineJob> {
  if (!path.isAbsolute(dataRoots.dataRoot)) {
    throw invalid('path', `data root ${dataRoots.dataRoot} is not absolute`)
  }
  assertNativeInvariants(job)
  // 21 §13: TS-decided skips, in the TS order, without a spawn.
  if (job.slug === null) return { kind: 'short_circuit', slug: null, skipReason: 'no_slug' }
  const slug = job.slug
  if (job.marketResolution === null)
    return { kind: 'short_circuit', slug, skipReason: 'no_resolution' }
  const outcome = job.marketResolution.outcome
  if (outcome === null) return { kind: 'short_circuit', slug, skipReason: 'unresolved_outcome' }

  if (!NATIVE_SLUG_RE.test(slug))
    throw invalid('market', `slug ${slug} is outside the v1 universe (D06)`)
  const window = windowOf(job, slug)
  const up = job.marketResolution.tokenMap['UP']
  const down = job.marketResolution.tokenMap['DOWN']
  if (!up || !down || up === down) {
    throw invalid('market', `${slug}: token ids need distinct non-empty UP and DOWN (21 §5.1)`)
  }
  const candidates = candidatesOf(job)
  assertFeedAvailability(job)
  if (
    job.input.format.name !== TELONEX_DELTA_FORMAT.name ||
    job.input.format.version !== TELONEX_DELTA_FORMAT.version
  ) {
    throw invalid(
      'input_mode',
      `telonex-delta needs input format ${JSON.stringify(TELONEX_DELTA_FORMAT)}`,
    )
  }

  const temps: string[] = []
  const cleanup = async (): Promise<void> => {
    for (const dir of temps.splice(0)) await fs.rm(dir, { recursive: true, force: true })
  }
  try {
    const inputPath = await resolveInput(job, slug, dataRoots, opts, temps)
    const feedFiles = await resolveFeedFiles(slug, window, job.requiredFeeds, dataRoots)
    const engineJob: EngineJob = {
      jobSchemaVersion: JOB_SCHEMA_VERSION,
      run: {
        strategyId: job.strategyId,
        // assertNativeInvariants admits telonex-delta only (M1).
        inputMode: 'telonex-delta',
        modelConfig: job.modelConfig,
        candidates,
      },
      market: {
        slug,
        conditionId: job.conditionId,
        window,
        tokenIds: { UP: up, DOWN: down },
        outcome,
        rules: job.rules,
        ...(job.gammaPriceToBeat === undefined ? {} : { gammaPriceToBeat: job.gammaPriceToBeat }),
        feedAvailability: job.feedAvailability,
        input: {
          path: inputPath,
          bytes: job.input.bytes,
          sha256: job.input.sha256,
          format: job.input.format,
        },
        recorderV4: null,
        journal: null,
        ownActivity: null,
        feedFiles,
      },
      outputs: {
        tracePath: opts.outputs?.tracePath ?? null,
        traceLevel: opts.outputs?.traceLevel ?? 'decisions',
        ledgerPath: opts.outputs?.ledgerPath ?? null,
      },
      budget: opts.budget ?? defaultBudget(candidates.length),
    }
    assertEngineJob(engineJob)
    return { kind: 'job', job: engineJob, cleanup }
  } catch (err) {
    await cleanup()
    throw err
  }
}

/** The generated schema check of a built or rendered job (21 §3, §19); `invalid_input: schema`. */
export function assertEngineJob(job: unknown): asserts job is EngineJob {
  const v = contractValidators()
  if (!v.engineJob(job)) {
    const e = v.lastErrors()[0]
    throw invalid(
      'schema',
      `EngineJob fails the schema: ${e ? `${e.instancePath || '/'} ${e.message ?? e.keyword}` : 'invalid'}`,
    )
  }
}

/**
 * Renders a job whose file paths are relative to `baseDir` (a committed
 * fixture job, 60 §12 FX-1a) into the absolute-path form that 21 §5.1
 * requires: `market.input.path` and `market.feedFiles[].path`.
 */
export function absolutizeJobPaths(job: EngineJob, baseDir: string): EngineJob {
  const at = (p: string): string => {
    if (p.startsWith('r2://')) throw invalid('path', `${p}: jobs carry local paths only (20 G3)`)
    return path.isAbsolute(p) ? p : path.resolve(baseDir, p)
  }
  return {
    ...job,
    market: {
      ...job.market,
      input: { ...job.market.input, path: at(job.market.input.path) },
      feedFiles: job.market.feedFiles.map((f) => ({ ...f, path: at(f.path) })),
    },
  }
}

/**
 * Checks the files of an absolute-path job before dispatch (21 §9 steps
 * 2-3): the input exists and matches `bytes`/`sha256`; each feed day file
 * exists and matches `bytes`.
 */
export async function verifyJobFiles(job: EngineJob): Promise<void> {
  const input = job.market.input
  const st = await statOrNull(input.path)
  if (st === null)
    throw new NativeError('data_missing', 'input_missing', `${input.path} is missing`, {
      path: input.path,
    })
  const problem = await integrityProblem(input.path, st, { ...input, r2Url: null })
  if (problem !== null)
    throw new NativeError('data_missing', 'integrity_mismatch', problem, { path: input.path })
  for (const f of job.market.feedFiles) {
    const fs_ = await statOrNull(f.path)
    if (fs_ === null) {
      const fixCommand = dayFileFixCommand(f)
      throw new NativeError(
        'data_missing',
        'day_file_missing',
        `${f.path} is missing; run ${fixCommand}`,
        {
          path: f.path,
          fixCommand,
        },
      )
    }
    if (fs_.size !== f.bytes) {
      throw new NativeError(
        'data_missing',
        'integrity_mismatch',
        `${f.path}: ${fs_.size} bytes, the job expects ${f.bytes}`,
        {
          path: f.path,
        },
      )
    }
  }
}
