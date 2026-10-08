import '../../config/env.js'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  createWriteStream,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb } from '../../db/index.js'
import type { MarketJobData } from '../../backtest/jobTypes.js'
import { dateMsArg, intArg, one, parseArgv } from '../../backtest/parity/cliArgs.js'
import {
  EXERCISER_FEATURES,
  exerciserCoverage,
  genericCoverage,
  type ExerciserFeature,
  type GenericCoverage,
} from '../../backtest/parity/coverage.js'
import { compareRecords, diffTraces, DEFAULT_TOLERANCE } from '../../backtest/parity/diff.js'
import {
  DEFAULT_DATA_ROOT,
  buildParityJobs,
  resolveParityStrategy,
  selectParitySlugs,
  useDataRoot,
} from '../../backtest/parity/marketJob.js'
import { readTrace } from '../../backtest/parity/trace.js'
import { externalFeedsRequest } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { getCurrentGitSha } from '../../backtest/workerIdentity.js'
import { JOB_VALUE_FLAGS, jobOptionsFromArgv } from './common.js'

const USAGE = `Usage (run from the repo/worktree root):
  npx tsx scripts/parity/run-parity.ts --out-dir <dir>
      (--slugs a,b,… | --slugs-file <file> | --symbol btc --timeframe 15m --limit N --random-seed S [--from 2026-01-01] [--to <date>])
      (--strategy <id> | --strategy-artifact <sha256> | --params-from-run <id>) [--param k=v …]
      [--latency-delay-ms 0] [--latency-jitter-ms 0] [--starting-capital <usdc>]
      [--read-from local|r2] [--data-root ${DEFAULT_DATA_ROOT}] [--concurrency 4] [--plain]
      [--rust-bin <path> [--rust-out-dir <dir>] [--rust-only]] [--tolerance 1e-6]

Writes <dir>/jobs/<slug>.json (MarketJobData, what a worker receives), <dir>/<slug>.ts.jsonl.gz
(canonical TS trace), <dir>/manifest.json and <dir>/coverage.md. With --rust-bin, also runs
\`<rust-bin> --job <job> --trace <rust-out-dir>/<slug>.rust.jsonl\` per market and diffs.
--rust-only reuses <dir>/jobs and existing TS traces (no DB, no TS replay).`

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SELF_DIR, '..', '..', '..')
const TS_TRACE_ENTRY = path.join(SELF_DIR, 'ts-trace.ts')

type MarketResult = {
  slug: string
  ts: { ok: boolean; durationMs: number; error?: string; coverage?: GenericCoverage }
  exerciser?: ExerciserFeature[]
  rust?: { ok: boolean; durationMs: number; error?: string }
  diff?: { equal: boolean; firstDivergence?: string; finalStatsEqual: boolean }
}

function run(
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; logFile: string },
): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const log = createWriteStream(opts.logFile)
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: opts.env })
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
  items: T[],
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

function lastLine(text: string): string {
  return text.trim().split('\n').slice(-3).join(' | ')
}

function readSlugs(p: ReturnType<typeof parseArgv>): string[] | null {
  const list = one(p, 'slugs')
  if (list)
    return list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const file = one(p, 'slugs-file')
  if (file)
    return readFileSync(file, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
  return null
}

function coverageMarkdown(results: MarketResult[], exerciser: boolean): string {
  const lines: string[] = []
  const ok = results.filter((r) => r.ts.coverage)
  lines.push(`## Per-market counts (${ok.length} traced of ${results.length})`, '')
  lines.push(
    '| market | ticks | synth | intents | cascades | taker | maker | killed | rejected | expired | canceled | cancel_failed | split | merge | pnl |',
  )
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const r of results) {
    const c = r.ts.coverage
    if (!c) {
      lines.push(`| ${r.slug} | ERROR: ${r.ts.error ?? 'unknown'} |`)
      continue
    }
    lines.push(
      `| ${r.slug} | ${c.ticks} | ${c.syntheticTicks} | ${c.intents} | ${c.cascades} | ${c.takerFills} | ${c.makerFills} | ${c.killed} | ${c.rejected} | ${c.expired} | ${c.canceled} | ${c.cancelFailed} | ${c.splits} | ${c.merges} | ${c.pnl ?? 'n/a'} |`,
    )
  }
  if (exerciser && ok.length > 0) {
    lines.push('', `## Exerciser checklist (markets hitting each feature, of ${ok.length})`, '')
    lines.push('| feature | markets |', '|---|---:|')
    for (const f of EXERCISER_FEATURES) {
      const n = ok.filter((r) => r.exerciser?.includes(f)).length
      lines.push(`| ${f} | ${n}/${ok.length} |`)
    }
  }
  const diffed = results.filter((r) => r.diff)
  if (diffed.length > 0) {
    lines.push(
      '',
      `## Rust parity (${diffed.filter((r) => r.diff!.equal).length}/${diffed.length} equal)`,
      '',
    )
    lines.push('| market | trace | final stats | first divergence |', '|---|---|---|---|')
    for (const r of diffed)
      lines.push(
        `| ${r.slug} | ${r.diff!.equal ? 'EQUAL' : 'DIFF'} | ${r.diff!.finalStatsEqual ? 'equal' : 'differ'} | ${r.diff!.firstDivergence ?? ''} |`,
      )
  }
  return lines.join('\n') + '\n'
}

async function main(): Promise<number> {
  const p = parseArgv(process.argv.slice(2), {
    values: [
      ...JOB_VALUE_FLAGS,
      'out-dir',
      'slugs',
      'slugs-file',
      'symbol',
      'timeframe',
      'limit',
      'random-seed',
      'from',
      'to',
      'concurrency',
      'rust-bin',
      'rust-out-dir',
      'tolerance',
    ],
    switches: ['plain', 'rust-only', 'help'],
  })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return 0
  }
  const outDir = one(p, 'out-dir')
  if (!outDir) throw new Error(`missing --out-dir\n\n${USAGE}`)
  const jobsDir = path.join(outDir, 'jobs')
  const logsDir = path.join(outDir, 'logs')
  mkdirSync(jobsDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
  const dataRoot = one(p, 'data-root') ?? DEFAULT_DATA_ROOT
  const dataEnv = useDataRoot(dataRoot)
  const concurrency = intArg(p, 'concurrency', 4)
  const rustBin = one(p, 'rust-bin')
  const rustOnly = p.switches.has('rust-only')
  const rustOutDir = one(p, 'rust-out-dir') ?? path.join(outDir, 'rust')
  const tolerance = Number(one(p, 'tolerance') ?? DEFAULT_TOLERANCE)
  const traceExt = p.switches.has('plain') ? '.ts.jsonl' : '.ts.jsonl.gz'
  const tsTracePath = (slug: string) => {
    const gz = path.join(outDir, `${slug}.ts.jsonl.gz`)
    const plain = path.join(outDir, `${slug}.ts.jsonl`)
    return rustOnly ? (existsSync(gz) ? gz : plain) : path.join(outDir, `${slug}${traceExt}`)
  }

  let jobs: MarketJobData[]
  let manifestBase: Record<string, unknown>
  if (rustOnly) {
    if (!rustBin) throw new Error('--rust-only requires --rust-bin')
    jobs = readdirSync(jobsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(path.join(jobsDir, f), 'utf8')) as MarketJobData)
    const prev = path.join(outDir, 'manifest.json')
    manifestBase = existsSync(prev)
      ? (JSON.parse(readFileSync(prev, 'utf8')) as Record<string, unknown>)
      : {}
  } else {
    const opts = await jobOptionsFromArgv(p)
    const built = await resolveParityStrategy(opts.selection, opts.dataRoot)
    let slugs = readSlugs(p)
    const fromMs = dateMsArg(p, 'from')
    const toMs = dateMsArg(p, 'to')
    const seed = intArg(p, 'random-seed', 1)
    if (!slugs) {
      const symbol = one(p, 'symbol')
      const limit = intArg(p, 'limit', 0)
      if (!symbol || limit <= 0)
        throw new Error(
          `select markets with --slugs/--slugs-file or --symbol + --limit\n\n${USAGE}`,
        )
      slugs = await selectParitySlugs({
        symbol,
        timeframe: one(p, 'timeframe') ?? '15m',
        limit,
        seed,
        fromMs: fromMs ?? 0,
        ...(toMs !== undefined ? { toMs } : {}),
        readFrom: opts.readFrom,
        requiredFeeds: externalFeedsRequest(built),
        dataRoot: opts.dataRoot,
      })
    }
    const built2 = await buildParityJobs({
      slugs,
      built,
      latency: opts.latency,
      startingCapital: opts.startingCapital,
      readFrom: opts.readFrom,
      dataRoot: opts.dataRoot,
    })
    if (built2.missing.length > 0)
      console.warn(`[run-parity] not eligible / unknown, skipped: ${built2.missing.join(', ')}`)
    jobs = built2.jobs
    for (const job of jobs)
      writeFileSync(path.join(jobsDir, `${job.slug}.json`), JSON.stringify(job, null, 2) + '\n')
    writeFileSync(path.join(outDir, 'slugs.txt'), jobs.map((j) => j.slug).join('\n') + '\n')
    manifestBase = {
      createdAt: new Date().toISOString(),
      commitSha: getCurrentGitSha(),
      strategyId: built.strategyId,
      strategyArtifact: built.artifact?.ref ?? null,
      params: built.params,
      latency: opts.latency,
      startingCapital: opts.startingCapital,
      readFrom: opts.readFrom,
      dataRoot: opts.dataRoot,
      selection: one(p, 'symbol')
        ? {
            symbol: one(p, 'symbol'),
            timeframe: one(p, 'timeframe') ?? '15m',
            limit: intArg(p, 'limit', 0),
            seed,
            fromMs: fromMs ?? 0,
            toMs: toMs ?? null,
          }
        : { slugs },
      deterministic: opts.latency.delayMs === 0 || opts.latency.jitterMs === 0,
    }
  }
  await closeDb()
  if (jobs.length === 0) throw new Error('no markets to run')
  console.error(
    `[run-parity] ${jobs.length} market(s), strategy=${jobs[0]!.strategyId}, latency=${jobs[0]!.latency.delayMs}/${jobs[0]!.latency.jitterMs}, concurrency=${concurrency}`,
  )

  const childEnv = { ...process.env, ...dataEnv }
  const results: MarketResult[] = []
  let done = 0
  await pool(jobs, concurrency, async (job) => {
    const slug = job.slug ?? `market-${job.idx}`
    const jobFile = path.join(jobsDir, `${slug}.json`)
    const tsTrace = tsTracePath(slug)
    const result: MarketResult = { slug, ts: { ok: false, durationMs: 0 } }
    results.push(result)
    if (!rustOnly) {
      const t0 = Date.now()
      const r = await run(
        process.execPath,
        [
          '--import',
          'tsx',
          TS_TRACE_ENTRY,
          '--job',
          jobFile,
          '--out',
          tsTrace,
          '--data-root',
          dataRoot,
          '--quiet',
        ],
        { env: childEnv, logFile: path.join(logsDir, `${slug}.ts.log`) },
      )
      result.ts = { ok: r.code === 0, durationMs: Date.now() - t0 }
      if (r.code !== 0) result.ts.error = lastLine(r.tail)
    } else {
      result.ts = { ok: existsSync(tsTrace), durationMs: 0 }
      if (!result.ts.ok) result.ts.error = `missing ${tsTrace}`
    }
    const tsRecords = result.ts.ok ? readTrace(tsTrace) : null
    if (tsRecords) {
      result.ts.coverage = genericCoverage(tsRecords)
      if (job.strategyId === 'engine-exerciser')
        result.exerciser = [...exerciserCoverage(tsRecords)]
    }
    if (rustBin && tsRecords) {
      mkdirSync(rustOutDir, { recursive: true })
      const rustTrace = path.join(rustOutDir, `${slug}.rust.jsonl`)
      const t0 = Date.now()
      const r = await run(
        rustBin,
        ['--job', path.resolve(jobFile), '--trace', path.resolve(rustTrace)],
        {
          env: childEnv,
          logFile: path.join(logsDir, `${slug}.rust.log`),
        },
      )
      result.rust = { ok: r.code === 0 && existsSync(rustTrace), durationMs: Date.now() - t0 }
      if (!result.rust.ok) result.rust.error = lastLine(r.tail)
      else {
        const rustRecords = readTrace(rustTrace)
        const d = diffTraces(tsRecords, rustRecords, { tolerance })
        const first = d.divergences[0]
        const fa = tsRecords.at(-1)
        const fb = rustRecords.at(-1)
        result.diff = {
          equal: d.equal,
          finalStatsEqual:
            fa?.t === 'final' &&
            fb?.t === 'final' &&
            compareRecords(fa, fb, tolerance).length === 0,
          ...(first
            ? {
                firstDivergence: `#${first.index + 1} ${first.mismatches
                  .slice(0, 3)
                  .map((m) => `${m.path}: ${JSON.stringify(m.a)} vs ${JSON.stringify(m.b)}`)
                  .join('; ')}`,
              }
            : {}),
        }
      }
    }
    done++
    const c = result.ts.coverage
    console.error(
      `[run-parity] ${done}/${jobs.length} ${slug} ts=${result.ts.ok ? `ok ticks=${c?.ticks} intents=${c?.intents} pnl=${c?.pnl}` : `FAIL ${result.ts.error}`}` +
        (result.rust ? ` rust=${result.rust.ok ? 'ok' : `FAIL ${result.rust.error}`}` : '') +
        (result.diff
          ? ` diff=${result.diff.equal ? 'EQUAL' : `DIFF ${result.diff.firstDivergence}`}`
          : ''),
    )
  })

  results.sort((a, b) => a.slug.localeCompare(b.slug))
  const exerciser = jobs[0]!.strategyId === 'engine-exerciser'
  const md = coverageMarkdown(results, exerciser)
  writeFileSync(path.join(outDir, rustBin ? 'coverage-rust.md' : 'coverage.md'), md)
  writeFileSync(
    path.join(outDir, rustBin ? 'manifest-rust.json' : 'manifest.json'),
    JSON.stringify({ ...manifestBase, markets: results }, null, 2) + '\n',
  )
  console.log(md)
  const failed = results.filter(
    (r) => !r.ts.ok || (r.rust && !r.rust.ok) || (r.diff && !r.diff.equal),
  )
  return failed.length === 0 ? 0 : 1
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
