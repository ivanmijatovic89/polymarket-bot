import '../../config/env.js'
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { closeDb } from '../../db/index.js'
import type { MarketJobData } from '../../backtest/jobTypes.js'
import { utcDatesCovering } from '../../binance/paths.js'
import {
  DEFAULT_DATA_ROOT,
  REPO_ROOT,
  buildOracleEnv,
  canonicalJson,
  cellStartingCapital,
  loadCell,
  modelConfigSha256,
  readMarketSet,
  sha256Hex,
  type ParityCell,
} from '../../backtest/parity/cell.js'
import { intArg, one, parseArgv } from '../../backtest/parity/cliArgs.js'
import {
  ExerciserCoverageAcc,
  FeedCoverageAcc,
  GenericCoverageAcc,
  coverageVerdict,
  exerciserFeatures,
} from '../../backtest/parity/coverage.js'
import { DIFF_RULES_VERSION } from '../../backtest/parity/diff.js'
import { diffTraceFiles, scanTrace } from '../../backtest/parity/stream.js'
import {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  computeTotals,
  fileIdentity,
  fileSha256,
  renderSummary,
  writeJsonAtomic,
  type FileIdentity,
  type MarketEntry,
  type ParityManifest,
} from '../../backtest/parity/manifest.js'
import { classifyMarket, loadMatchers, verdictLabel } from '../../backtest/parity/matchers.js'
import {
  buildParityJobs,
  resolveParityStrategy,
  seededShuffle,
} from '../../backtest/parity/marketJob.js'
import {
  ORACLE_ALLOWLIST_FILE,
  PARITY_DIR,
  checkOracleTree,
  parseOracleAllowlist,
  readEnginePaths,
  resolvePin,
} from '../../backtest/parity/oracle.js'
import {
  assertEngineJobStrategy,
  checkDescribe,
  engineJobFor,
  loadEngineJobBuilder,
  nativeJobFor,
} from '../../backtest/parity/rustJob.js'
import {
  NativeError,
  describeNative,
  runNativeJob,
  type NativeDescribe,
  type NativeMarketJobData,
} from '../../native/index.js'
import { TRACE_FORMAT, TRACE_VERSION } from '../../backtest/parity/trace.js'
import { prepareOracleTree } from '../../backtest/parity/oracleTree.js'
import {
  cacheTreeHashes,
  restoreFromCache,
  storeInCache,
  traceCacheKey,
} from '../../backtest/parity/traceCache.js'
import { externalFeedsRequest } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { EXERCISER_SCHEDULE_VERSION } from '../../strategies/testing/engine-exerciser.js'

const USAGE = `Usage (from the repository root):
  npx tsx scripts/parity/run-parity.ts --cell native/parity/cells/<cell>.json --out-dir <dir outside the repo>
      [--data-root <repo>/data] [--concurrency 4] [--slugs a,b | --limit N]
      [--pin <sha>] [--oracle-tree head|pin] [--oracle-patch <file.patch> ...]
      [--repeat-ts [--repeat-seed 1]] [--trace-cache <dir>] [--plain]
      [--rust-bin <canonical artifact binary> [--rust-only]] [--tolerance <x>]

Runs one parity cell (native/spec/60-verification.md §4): builds each market's
MarketJobData (read-only catalog lookups through src/db/telonexMarkets.ts),
writes <dir>/jobs/<slug>.json and the TS trace <dir>/ts/<slug>.ts.jsonl.gz
under the pinned oracle environment (OR-7), and with --rust-bin also the
native MarketJobData <dir>/jobs/<slug>.native.json (21 §4), the EngineJob
(src/native buildEngineJob), the Rust trace through the src/native runner
(\`<bin> run --job … --trace … --trace-level …\`, result validated per 21 §19)
and the v2 diff (22 §3.4).
Writes <dir>/manifest.json (HR-7) and <dir>/summary.md.

--slugs/--limit/--tolerance and a dirty oracle tree (OR-3) make the run non-gating.
--repeat-ts re-runs TS on a seeded 10% sample (at least 20 markets) and requires
byte-identical traces (OR-9). --trace-cache reuses TS traces whose key (engine
trees, job, input identities, oracle env, patch set) is unchanged (OR-12).
--oracle-tree pin runs TS from a scratch copy of the pin with this checkout's
parity tooling and twins (OR-17); --oracle-patch applies a patch set to it
(PM-1) and an equal Rust trace is then \`identical-patched\`. --rust-only reuses <dir>/jobs and the TS traces.
Exit 0 only with zero TS failures, zero unclassified and zero markets matched
by an open Rust-bug entry (HR-8).`

type Child = { code: number; tail: string }

function runChild(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; logFile: string; cwd?: string },
): Promise<Child> {
  return new Promise((resolve) => {
    const log = createWriteStream(opts.logFile)
    const child = spawn(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, env: opts.env })
    let tail = ''
    const keep = (chunk: Buffer) => {
      log.write(chunk)
      tail = (tail + chunk.toString('utf8')).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (err) => {
      tail += `\n${err.message}`
    })
    child.on('close', (code) => {
      log.end()
      resolve({ code: code ?? 1, tail })
    })
  })
}

async function pool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const item = items[next++]!
        await fn(item)
      }
    },
  )
  await Promise.all(workers)
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-3).join(' | ')
}

/** Feed day files a market needs (window plus the 5 min lookback, 14 F-47). */
function feedDayFiles(
  job: MarketJobData,
  feeds: ReturnType<typeof externalFeedsRequest>,
  dataRoot: string,
): string[] {
  const w = job.strategyWindow
  if (!w) return []
  const days = utcDatesCovering(w.startMs - 300_000, w.endMs)
  const out: string[] = []
  // D-PENDING: the harness assumes BTC markets (S15-CL is BTC 15m, D38); feed pairs are BTCUSDT and btcusd as the TS loaders derive them from the slug.
  if (feeds.binanceWsSpotPrice)
    for (const d of days)
      out.push(
        path.join(dataRoot, 'binance', 'aggTrades', 'BTCUSDT', `BTCUSDT-aggTrades-${d}.parquet`),
      )
  if (feeds.rtdsCryptoPrices)
    for (const d of days)
      out.push(
        path.join(
          dataRoot,
          'telonex',
          'crypto_prices',
          'btcusd',
          `btcusd-crypto-prices-${d}.parquet`,
        ),
      )
  return out
}

async function inputIdentities(
  job: MarketJobData,
  feedFiles: string[],
): Promise<MarketEntry['inputs']> {
  const missing: string[] = []
  let market: FileIdentity | null = null
  if (existsSync(job.filePath)) market = await fileIdentity(job.filePath)
  else missing.push(job.filePath)
  const feeds: FileIdentity[] = []
  for (const f of feedFiles) {
    if (existsSync(f)) feeds.push(await fileIdentity(f))
    else missing.push(f)
  }
  return { market, feedFiles: feeds, missing }
}

/** The exerciser schedule a cell runs (60 §5.7), from the validated params; null for other strategies. */
function exerciserScheduleOf(cell: ParityCell, params: Record<string, unknown>): number | null {
  const id = 'id' in cell.tsStrategy ? cell.tsStrategy.id : null
  if (id === 'engine-exerciser') return EXERCISER_SCHEDULE_VERSION
  if (id === 'feed-exerciser' && params.trade === true) return EXERCISER_SCHEDULE_VERSION
  return null
}

async function main(): Promise<number> {
  const p = parseArgv(process.argv.slice(2), {
    values: [
      'cell',
      'out-dir',
      'data-root',
      'concurrency',
      'slugs',
      'limit',
      'pin',
      'repeat-seed',
      'rust-bin',
      'tolerance',
      'trace-cache',
      'engine-job-builder',
      'oracle-tree',
      'oracle-patch',
    ],
    switches: ['repeat-ts', 'rust-only', 'plain', 'help'],
  })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return 0
  }
  if (p.positionals.length > 0)
    throw new Error(`unexpected arguments: ${p.positionals.join(' ')}\n\n${USAGE}`)
  const cellFile = one(p, 'cell')
  const outDirArg = one(p, 'out-dir')
  if (!cellFile || !outDirArg) throw new Error(`missing --cell or --out-dir\n\n${USAGE}`)
  const outDir = path.resolve(outDirArg)
  if (outDir === REPO_ROOT || outDir.startsWith(REPO_ROOT + path.sep))
    throw new Error(
      `--out-dir must be outside the repository (${REPO_ROOT}); traces are never committed`,
    )
  const cell = loadCell(path.resolve(cellFile))
  const dataRoot = path.resolve(one(p, 'data-root') ?? DEFAULT_DATA_ROOT)
  if (!existsSync(dataRoot)) throw new Error(`--data-root ${dataRoot} does not exist`)
  const concurrency = intArg(p, 'concurrency', 4)
  if (concurrency < 1) throw new Error('--concurrency must be >= 1')
  const rustBin = one(p, 'rust-bin')
  const rustOnly = p.switches.has('rust-only')
  if (rustOnly && !rustBin) throw new Error('--rust-only requires --rust-bin')
  const tolRaw = one(p, 'tolerance')
  const tolerance = tolRaw === undefined ? undefined : Number(tolRaw)
  if (tolerance !== undefined && !(tolerance >= 0))
    throw new Error('--tolerance must be a number >= 0')
  const traceExt = p.switches.has('plain') ? '.jsonl' : '.jsonl.gz'

  const nonGating: string[] = []
  if (!cell.gating) nonGating.push(`cell ${cell.cell} is non-gating (${cell.milestone})`)
  if (tolerance !== undefined) nonGating.push(`--tolerance ${tolerance} (VP-3)`)
  if (!rustBin) nonGating.push('TS side only (no --rust-bin)')

  // Market set (MS-1), cell cap, and an optional exploration subset.
  const setFile = path.join(PARITY_DIR, 'sets', `${cell.set}.txt`)
  const setSlugs = readMarketSet(setFile)
  const setSha = sha256Hex(readFileSync(setFile))
  let slugs =
    cell.marketLimit !== undefined ? setSlugs.slice(0, cell.marketLimit) : setSlugs.slice()
  const subset = one(p, 'slugs')
  const limit = one(p, 'limit') !== undefined ? intArg(p, 'limit', 0) : undefined
  if (subset && limit !== undefined) throw new Error('--slugs and --limit are mutually exclusive')
  if (subset) {
    const wanted = subset
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const notInSet = wanted.filter((s) => !slugs.includes(s))
    if (notInSet.length > 0)
      throw new Error(`--slugs not in set ${cell.set}: ${notInSet.join(', ')}`)
    slugs = wanted
    nonGating.push(`--slugs subset (${slugs.length} of ${setSlugs.length})`)
  } else if (limit !== undefined) {
    if (limit < 1) throw new Error('--limit must be >= 1')
    slugs = slugs.slice(0, limit)
    nonGating.push(`--limit ${limit} (${slugs.length} of ${setSlugs.length})`)
  }

  // Oracle pin and tree (OR-1, OR-3).
  const enginePaths = readEnginePaths()
  const allowlist = parseOracleAllowlist(readFileSync(ORACLE_ALLOWLIST_FILE, 'utf8'))
  const pin = resolvePin(one(p, 'pin'))
  const tree = checkOracleTree(pin, enginePaths, allowlist)
  if (!tree.oracleTreeClean)
    nonGating.push(
      `oracle tree not clean (OR-3): ${tree.workingTreeClean ? '' : 'dirty working tree; '}${tree.disallowed.length} non-allowlisted engine-path change(s)`,
    )

  // Pinned oracle environment (OR-7, HR-3).
  const oracleEnv = buildOracleEnv(cell, dataRoot, process.env)
  const oracleEnvSha256 = sha256Hex(canonicalJson(oracleEnv))
  const mcSha = modelConfigSha256(cell.modelConfig)

  // TS sources: this checkout (default) or a scratch copy of the pin with the
  // tooling copied in and the patch set applied (OR-17, PM-1, HR-4).
  const patchFiles = (p.values.get('oracle-patch') ?? []).map((f) => path.resolve(f))
  const treeMode = one(p, 'oracle-tree') ?? (patchFiles.length > 0 ? 'pin' : 'head')
  if (treeMode !== 'head' && treeMode !== 'pin')
    throw new Error('--oracle-tree must be head or pin')
  if (patchFiles.length > 0 && treeMode !== 'pin')
    throw new Error('--oracle-patch applies to the pin tree (--oracle-tree pin)')
  for (const f of patchFiles)
    if (!existsSync(f)) throw new Error(`--oracle-patch ${f} does not exist`)
  const oracleTree =
    treeMode === 'pin' ? prepareOracleTree(pin, patchFiles, path.join(outDir, 'oracle-tree')) : null
  const tsRoot = oracleTree?.root ?? REPO_ROOT

  const jobsDir = path.join(outDir, 'jobs')
  const tsDir = path.join(outDir, 'ts')
  const logsDir = path.join(outDir, 'logs')
  for (const d of [jobsDir, tsDir, logsDir]) mkdirSync(d, { recursive: true })

  // Strategy and jobs.
  const built = await resolveParityStrategy(
    'id' in cell.tsStrategy
      ? { strategyId: cell.tsStrategy.id, rawParams: cell.params.values }
      : { artifactSha256: cell.tsStrategy.artifactSha256, rawParams: cell.params.values },
    dataRoot,
  )
  const feeds = externalFeedsRequest(built)
  const schedule = exerciserScheduleOf(cell, built.params as Record<string, unknown>)
  let jobs: MarketJobData[]
  const missingCatalog: string[] = []
  if (rustOnly) {
    const files = new Set(readdirSync(jobsDir))
    jobs = slugs.map((s) => {
      if (!files.has(`${s}.json`))
        throw new Error(`--rust-only: missing ${path.join(jobsDir, `${s}.json`)}`)
      return JSON.parse(readFileSync(path.join(jobsDir, `${s}.json`), 'utf8')) as MarketJobData
    })
  } else {
    const res = await buildParityJobs({
      slugs,
      built,
      latency: {
        delayMs: cell.modelConfig.execution.compatLatency.delayMs,
        jitterMs: cell.modelConfig.execution.compatLatency.jitterMs,
      },
      startingCapital: cellStartingCapital(cell),
      readFrom: cell.readFrom,
      dataRoot,
    })
    jobs = res.jobs
    missingCatalog.push(...res.missing)
    for (const job of jobs) writeJsonAtomic(path.join(jobsDir, `${job.slug}.json`), job)
    // The native MarketJobData of each market (21 §4, HR-2), written even
    // without --rust-bin so a later --rust-only run reuses it. Feed
    // availability is resolved once at asOfMs (14 §6.2, OR-8).
    const asOfMs = Date.now()
    for (const job of jobs) {
      const facts = res.catalog.get(job.slug!)
      let bytes = facts?.conversionSizeBytes ?? null
      if (bytes === null) {
        // D-PENDING: 21 §4 input.bytes comes from the catalog; for a conversion without a recorded size the harness uses the local file size and says so (MS-5 still records the input's size and sha256).
        bytes = statSync(job.filePath).size
        console.error(
          `[run-parity] ${job.slug}: the catalog has no conversion size; native job uses the local size ${bytes}`,
        )
      }
      const native = nativeJobFor(job, cell, {
        conditionId: facts?.conditionId ?? null,
        bytes,
        requiredFeeds: feeds,
        asOfMs,
      })
      writeJsonAtomic(path.join(jobsDir, `${job.slug}.native.json`), native)
    }
  }
  // The pin tree has no git history of this branch: its jobs carry an empty
  // commitSha (provenance only, D12), which the worker commit gate accepts.
  const tsJobsDir = oracleTree ? path.join(outDir, 'jobs-oracle') : jobsDir
  if (oracleTree)
    for (const job of jobs)
      writeJsonAtomic(path.join(tsJobsDir, `${job.slug}.json`), { ...job, commitSha: '' })
  await closeDb()
  if (jobs.length === 0) throw new Error('no markets to run')

  const startedAt = Date.now()
  console.error(
    `[run-parity] cell=${cell.cell} markets=${jobs.length} ts=${'id' in cell.tsStrategy ? cell.tsStrategy.id : cell.tsStrategy.artifactSha256.slice(0, 12)} ` +
      `rust=${rustBin ? cell.rustStrategyId : 'off'} level=${cell.traceLevel} concurrency=${concurrency} pin=${pin.slice(0, 10)} oracleTreeClean=${tree.oracleTreeClean}`,
  )

  const builderOverride = one(p, 'engine-job-builder')
  if (builderOverride) nonGating.push(`--engine-job-builder ${builderOverride} (harness self-test)`)
  const buildEngineJob = rustBin ? await loadEngineJobBuilder(builderOverride) : null
  const rustSha = rustBin ? await fileSha256(rustBin) : null
  // 20 §5.1 pre-flight through the src/native runner (G6 env; protocol 2,
  // standard build, checked-in contract), then the cell checks: same strategy
  // id, params, feeds, trace format (fail loud, R14).
  let rustBinary: NativeDescribe['binary'] | null = null
  if (rustBin) {
    const doc = await describeNative(path.resolve(rustBin), {
      params: built.params as Record<string, unknown>,
    })
    const problems = checkDescribe(doc, cell, {
      params: built.params as Record<string, unknown>,
      requiredFeeds: feeds,
    })
    if (problems.length > 0)
      throw new Error(
        `--rust-bin ${rustBin} does not match cell ${cell.cell}:\n  ${problems.join('\n  ')}`,
      )
    rustBinary = doc.binary
  }
  const rustDir = path.join(outDir, 'rust')
  if (rustBin) mkdirSync(rustDir, { recursive: true })
  const matchers = loadMatchers(path.join(PARITY_DIR, 'matchers'))
  const tsTraceEntry = path.join(tsRoot, 'src', 'cli', 'parity', 'ts-trace.ts')

  // OR-12 trace cache (HR-4): only on a clean working tree, whose tree hashes describe the code.
  const cacheArg = one(p, 'trace-cache')
  const cacheDir = cacheArg ? path.resolve(cacheArg) : null
  if (cacheDir && (cacheDir === REPO_ROOT || cacheDir.startsWith(REPO_ROOT + path.sep)))
    throw new Error('--trace-cache must be outside the repository')
  const cacheTrees =
    cacheDir && tree.workingTreeClean
      ? cacheTreeHashes(enginePaths, oracleTree ? pin : 'HEAD', 'HEAD')
      : null
  if (cacheDir && !cacheTrees)
    console.error(
      '[run-parity] --trace-cache disabled: the working tree is dirty (OR-12 keys on git trees)',
    )

  const runTs = async (job: MarketJobData, out: string, logName: string): Promise<Child> =>
    runChild(
      process.execPath,
      [
        '--import',
        'tsx',
        tsTraceEntry,
        '--job',
        path.join(tsJobsDir, `${job.slug}.json`),
        '--out',
        out,
        '--level',
        cell.traceLevel,
        '--quiet',
      ],
      { env: oracleEnv, logFile: path.join(logsDir, logName), cwd: tsRoot },
    )

  const entries = new Map<string, MarketEntry>()
  let done = 0
  await pool(jobs, concurrency, async (job) => {
    const slug = job.slug!
    const tsTrace = path.join(tsDir, `${slug}.ts${traceExt}`)
    const entry: MarketEntry = {
      slug,
      inputs: await inputIdentities(job, feedDayFiles(job, feeds, dataRoot)),
      ts: { ok: false, durationMs: 0 },
      verdict: null,
    }
    entries.set(slug, entry)
    const cacheKey =
      cacheDir && cacheTrees
        ? traceCacheKey({
            trees: cacheTrees,
            job,
            inputs: entry.inputs,
            oracleEnv,
            traceLevel: cell.traceLevel,
            patchSetSha256: oracleTree?.patchSetSha256 ?? null,
            oracleTree: oracleTree ? 'pin' : 'head',
          })
        : null
    if (
      !rustOnly &&
      cacheDir &&
      cacheKey &&
      restoreFromCache(cacheDir, cacheKey, traceExt, tsTrace)
    ) {
      entry.ts = { ok: true, durationMs: 0, cache: 'hit', cacheKey }
    } else if (!rustOnly) {
      const t0 = Date.now()
      const r = await runTs(job, tsTrace, `${slug}.ts.log`)
      entry.ts = { ok: r.code === 0 && existsSync(tsTrace), durationMs: Date.now() - t0 }
      if (!entry.ts.ok) entry.ts.error = lastLines(r.tail)
      else if (cacheDir && cacheKey) {
        storeInCache(cacheDir, cacheKey, traceExt, tsTrace)
        entry.ts.cache = 'miss'
        entry.ts.cacheKey = cacheKey
      }
    } else {
      entry.ts = { ok: existsSync(tsTrace), durationMs: 0 }
      if (!entry.ts.ok) entry.ts.error = `missing ${tsTrace}`
    }
    if (entry.ts.ok) {
      entry.ts.trace = tsTrace
      // One streamed pass: coverage and the sha256 of the decompressed bytes.
      const gen = new GenericCoverageAcc()
      const fc = cell.traceLevel === 'feeds' ? new FeedCoverageAcc() : null
      const ex = schedule !== null ? new ExerciserCoverageAcc() : null
      entry.ts.traceSha256 = await scanTrace(tsTrace, (r) => {
        gen.add(r)
        fc?.add(r)
        ex?.add(r)
      })
      entry.coverage = {
        generic: gen.c,
        ...(fc ? { feeds: fc.c } : {}),
        ...(ex ? { exerciser: [...ex.result()].sort() } : {}),
      }
    } else {
      entry.verdict = { verdict: 'excluded', reason: `ts_failed: ${entry.ts.error ?? ''}` }
    }

    if (rustBin && buildEngineJob && rustBinary && entry.ts.ok) {
      const rustTrace = path.join(rustDir, `${slug}.rust${traceExt}`)
      const rustLog = path.join(logsDir, `${slug}.rust.log`)
      const t0 = Date.now()
      let rustError: string | null = null
      try {
        const native = JSON.parse(
          readFileSync(path.join(jobsDir, `${slug}.native.json`), 'utf8'),
        ) as NativeMarketJobData
        const engineJob = await engineJobFor(buildEngineJob, native, dataRoot, {
          tracePath: rustTrace,
          traceLevel: cell.traceLevel,
        })
        assertEngineJobStrategy(engineJob, cell)
        writeJsonAtomic(path.join(rustDir, `${slug}.engine-job.json`), engineJob)
        const log = createWriteStream(rustLog)
        try {
          const out = await runNativeJob(path.resolve(rustBin), engineJob, {
            engineVersion: rustBinary.engineVersion,
            tracePath: rustTrace,
            traceLevel: cell.traceLevel,
            log: (line) => log.write(`${line}\n`),
          })
          if (out.result.status !== 'ok' || out.exitCode !== 0)
            rustError = `result ${out.result.status} exit ${out.exitCode}: ${JSON.stringify(out.result.error ?? out.result.candidates[0]?.error ?? null)}`
          else if (!existsSync(rustTrace)) rustError = `no trace at ${rustTrace}`
        } finally {
          log.end()
        }
      } catch (err) {
        rustError = err instanceof NativeError ? err.message : String(err)
      }
      entry.rust = { ok: rustError === null, durationMs: Date.now() - t0 }
      if (rustError !== null) {
        entry.rust.error = lastLines(rustError)
        entry.verdict = { verdict: 'unclassified', reason: `rust_failed: ${entry.rust.error}` }
      } else {
        entry.rust.trace = rustTrace
        const { diff: d, eventKinds } = await diffTraceFiles(
          tsTrace,
          rustTrace,
          tolerance !== undefined ? { tolerance } : {},
        )
        const first = d.failures[0]
        entry.diff = {
          equal: d.equal,
          gating: d.gating,
          failures: d.failureTotal,
          autoClasses: d.autoClasses as Record<string, number>,
          sequenceDivergence: d.sequenceDivergence,
          firstFailure: first
            ? `#${first.index + 1} ${first.path}: ${JSON.stringify(first.a)} vs ${JSON.stringify(first.b)}`
            : null,
        }
        const c = classifyMarket(d, eventKinds, matchers)
        // 60 HR-6: Rust equal to the patched oracle is `identical-patched` (PM-2).
        entry.verdict =
          c.verdict.verdict === 'identical' && patchFiles.length > 0
            ? { verdict: 'identical-patched' }
            : c.verdict
        entry.openRustBug = c.openRustBug
      }
    }
    done++
    const g = entry.coverage?.generic
    const f = entry.coverage?.feeds
    console.error(
      `[run-parity] ${done}/${jobs.length} ${slug} ts=${entry.ts.ok ? `ok ticks=${g?.ticks} synthetic=${g?.syntheticTicks} intents=${g?.intents}${f ? ` binance=${f.binanceTicks} chainlink=${f.chainlinkTicks} ptb=${f.priceToBeatTicks}` : ''}` : `FAIL ${entry.ts.error}`}` +
        (entry.rust ? ` rust=${entry.rust.ok ? 'ok' : `FAIL ${entry.rust.error}`}` : '') +
        (entry.verdict ? ` verdict=${verdictLabel(entry.verdict)}` : ''),
    )
  })

  // OR-9 oracle self-check: seeded 10% sample, at least 20 markets.
  if (p.switches.has('repeat-ts') && !rustOnly) {
    const ok = jobs.filter((j) => entries.get(j.slug!)?.ts.ok)
    const n = Math.min(ok.length, Math.max(20, Math.ceil(ok.length * 0.1)))
    const sample = seededShuffle(ok.map((j) => j.slug!).sort(), intArg(p, 'repeat-seed', 1)).slice(
      0,
      n,
    )
    const repeatDir = path.join(outDir, 'ts-repeat')
    mkdirSync(repeatDir, { recursive: true })
    await pool(sample, concurrency, async (slug) => {
      const job = jobs.find((j) => j.slug === slug)!
      const out = path.join(repeatDir, `${slug}.ts${traceExt}`)
      const r = await runTs(job, out, `${slug}.ts-repeat.log`)
      const entry = entries.get(slug)!
      const identical =
        r.code === 0 && existsSync(out) && (await scanTrace(out)) === entry.ts.traceSha256
      entry.repeat = { identical }
      if (!identical)
        entry.verdict = { verdict: 'excluded', reason: 'nondeterministic-oracle (OR-9)' }
    })
    console.error(
      `[run-parity] OR-9: re-ran ${sample.length} market(s); non-identical: ${sample.filter((s) => !entries.get(s)!.repeat!.identical).length}`,
    )
  } else if (cell.gating) nonGating.push('no --repeat-ts (OR-9)')

  const markets = slugs.flatMap((s) => {
    const e = entries.get(s)
    if (e) return [e]
    if (missingCatalog.includes(s))
      return [
        {
          slug: s,
          inputs: { market: null, feedFiles: [], missing: [] },
          ts: { ok: false, durationMs: 0, error: 'not eligible in the catalog' },
          verdict: { verdict: 'excluded' as const, reason: 'not eligible in the catalog (MS-5)' },
        },
      ]
    return []
  })
  const hits = markets
    .filter((m) => m.coverage?.exerciser)
    .map((m) => new Set(m.coverage!.exerciser))
  const manifest: ParityManifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    command: ['npx', 'tsx', 'scripts/parity/run-parity.ts', ...process.argv.slice(2)].join(' '),
    createdAt: new Date(startedAt).toISOString(),
    asOfMs: startedAt,
    cell: {
      name: cell.cell,
      file: path.relative(REPO_ROOT, path.resolve(cellFile)),
      sha256: sha256Hex(readFileSync(path.resolve(cellFile))),
      gating: cell.gating,
      traceLevel: cell.traceLevel,
      profile: cell.profile,
      tsStrategy: cell.tsStrategy,
      rustStrategyId: cell.rustStrategyId,
      params: built.params,
    },
    gating: nonGating.length === 0,
    nonGatingReasons: nonGating,
    oracle: {
      pin,
      head: tree.head,
      oracleTreeClean: tree.oracleTreeClean,
      workingTreeClean: tree.workingTreeClean,
      changedEnginePaths: tree.changed,
      disallowed: tree.disallowed,
      oracleEnv,
      oracleEnvSha256,
      tree: oracleTree ? 'pin' : 'head',
      patches: oracleTree?.patches ?? [],
      patchSetSha256: oracleTree?.patchSetSha256 ?? null,
    },
    exerciserScheduleVersion: schedule,
    traceFormat: `${TRACE_FORMAT}/${TRACE_VERSION}`,
    diffRulesVersion: DIFF_RULES_VERSION,
    tolerance: tolerance ?? null,
    modelConfigSha256: mcSha,
    marketSet: {
      name: cell.set,
      file: path.relative(REPO_ROOT, setFile),
      sha256: setSha,
      size: setSlugs.length,
      selected: slugs.length,
    },
    rust:
      rustBin && rustSha
        ? { bin: path.resolve(rustBin), sha256: rustSha, binary: rustBinary }
        : null,
    markets,
    totals: computeTotals(markets),
    coverage: {
      exerciser: schedule !== null ? coverageVerdict(exerciserFeatures(schedule), hits) : null,
    },
  }
  const manifestFile = path.join(outDir, 'manifest.json')
  writeJsonAtomic(manifestFile, manifest)
  const summary = renderSummary([
    { file: manifestFile, sha256: await fileSha256(manifestFile), manifest },
  ])
  writeFileSync(path.join(outDir, 'summary.md'), summary)
  console.log(summary)
  const t = manifest.totals
  const openRust = markets.filter((m) => m.openRustBug).length
  console.error(
    `[run-parity] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${JSON.stringify(t)} openRustBug=${openRust} gating=${manifest.gating} -> ${manifestFile}`,
  )
  return t.tsFailed === 0 && t.unclassified === 0 && openRust === 0 ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (err: unknown) => {
    console.error(`[run-parity] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    await closeDb().catch(() => {})
    process.exitCode = 2
  })
