// L1 engine-only benchmark driver (16 §13.2 L1, 01 §6 M1 step 7).
//
// Feeds prebuilt `EngineJob` files of one bench set (16 §13.1) to
// `<bin> run --job <file>` (20 §5.4), one process per market with
// `--concurrency` processes in flight, and records wall time, markets/s,
// CPU (user + sys from each process's rusage via `/usr/bin/time -l`), peak
// RSS, the load average and the 16 §13.5 conditions. One discarded warm-up
// per binary, then `--reps` repetitions (ABBA when two binaries are given).
// Every run's deterministic sections are hashed and compared (16 §13.7).
// Writes `native/bench/results/<set>-<yyyymmdd>-<host>.{md,json}`.
//
//   npm run native:bench:l1 -- --set native/bench/sets/smoke-50.json \
//     --bin data/strategy-artifacts/native/<sha256> --jobs-dir <dir> --concurrency 8
//
// No Redis, MySQL, R2 or network: it only spawns the given binaries.

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  resultSections,
  readLiteral,
  setDigest,
  sha256Hex,
} from '../../native/bench/harness/canonicalJson.js'
import {
  PRE_START_SAMPLES,
  classifyConditions,
  countFleetProcesses,
} from '../../native/bench/harness/conditions.js'
import { collectHostFacts, type HostFacts } from '../../native/bench/harness/hostFacts.js'
import {
  checkJob,
  checkRunConsistency,
  stableStringify,
  type CheckedJob,
} from '../../native/bench/harness/jobs.js'
import { parseBenchSet, type BenchSet } from '../../native/bench/harness/manifest.js'
import {
  checkDeterminism,
  renderMarkdown,
  summarizeRuns,
  type BenchReport,
  type BinaryInfo,
  type MarketRecord,
  type RunRecord,
} from '../../native/bench/harness/report.js'
import { parseTimeL } from '../../native/bench/harness/rusage.js'
import {
  abbaSchedule,
  loadSummary,
  runMetrics,
  type LoadSample,
} from '../../native/bench/harness/stats.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CANONICAL_DIR = path.join(REPO_ROOT, 'data/strategy-artifacts/native')
const TIME = '/usr/bin/time'
const TASKPOLICY = '/usr/sbin/taskpolicy'
const QOS_CLAMPS = ['default', 'utility', 'background'] as const
type Qos = (typeof QOS_CLAMPS)[number]
const LOAD_SAMPLE_MS = 5000

class UsageError extends Error {
  override name = 'UsageError'
}

interface Options {
  set: string
  bins: string[]
  jobsDir: string
  concurrency: number
  reps: number
  qos: Qos
  profile: string
  outDir: string
  host: string | undefined
  date: string
  quietHostConfirmed: boolean
  force: boolean
  dryRun: boolean
}

function localDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function positiveInt(name: string, v: string | undefined): number {
  if (v === undefined) throw new UsageError(`--${name} is required`)
  if (!/^[1-9][0-9]*$/.test(v))
    throw new UsageError(`--${name} must be a positive integer, got ${v}`)
  return Number(v)
}

function parseOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      set: { type: 'string' },
      bin: { type: 'string', multiple: true },
      'jobs-dir': { type: 'string' },
      concurrency: { type: 'string' },
      reps: { type: 'string', default: '3' },
      qos: { type: 'string', default: 'utility' },
      profile: { type: 'string', default: 'artifact' },
      'out-dir': { type: 'string', default: path.join(REPO_ROOT, 'native/bench/results') },
      host: { type: 'string' },
      date: { type: 'string' },
      'quiet-host-confirmed': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 0) throw new UsageError(`unexpected arguments: ${positionals.join(' ')}`)
  if (values.set === undefined) throw new UsageError('--set <manifest.json> is required')
  const bins = values.bin ?? []
  if (bins.length < 1 || bins.length > 2)
    throw new UsageError('give one --bin, or two to compare (A/B)')
  if (values['jobs-dir'] === undefined) {
    // D-PENDING: render jobs through src/native (buildEngineJob, M1 step 6)
    // once it exists on this branch.
    throw new UsageError(
      '--jobs-dir is required: rendering jobs through src/native is not available yet',
    )
  }
  const qos = values.qos as Qos
  if (!QOS_CLAMPS.includes(qos)) {
    throw new UsageError(
      `--qos must be one of ${QOS_CLAMPS.join(', ')} (taskpolicy -c can only lower QoS)`,
    )
  }
  const date = values.date ?? localDate(new Date())
  if (!/^[0-9]{8}$/.test(date)) throw new UsageError('--date must be yyyymmdd')
  return {
    set: path.resolve(values.set),
    bins: bins.map((b) => path.resolve(b)),
    jobsDir: path.resolve(values['jobs-dir']),
    concurrency: positiveInt('concurrency', values.concurrency),
    reps: positiveInt('reps', values.reps),
    qos,
    profile: values.profile,
    outDir: path.resolve(values['out-dir']),
    host: values.host,
    date,
    quietHostConfirmed: values['quiet-host-confirmed'],
    force: values.force,
    dryRun: values['dry-run'],
  }
}

function sha256File(p: string): string {
  const h = createHash('sha256')
  const fd = fs.openSync(p, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      h.update(buf.subarray(0, n))
    }
  } finally {
    fs.closeSync(fd)
  }
  return h.digest('hex')
}

function binaryInfo(p: string, label: string): BinaryInfo {
  const st = fs.statSync(p, { throwIfNoEntry: false })
  if (!st?.isFile()) throw new UsageError(`binary ${p} does not exist`)
  fs.accessSync(p, fs.constants.X_OK)
  const sha256 = sha256File(p)
  const base = path.basename(p)
  if (/^[0-9a-f]{64}$/.test(base) && base !== sha256) {
    throw new UsageError(`binary ${p}: file name says ${base} but its sha256 is ${sha256}`)
  }
  return { label, path: p, sha256, canonical: path.dirname(p) === CANONICAL_DIR && base === sha256 }
}

function loadJobs(set: BenchSet, jobsDir: string): CheckedJob[] {
  const jobs: CheckedJob[] = []
  const missing: string[] = []
  for (const m of set.markets) {
    const jobPath = path.join(jobsDir, `${m.slug}.json`)
    if (!fs.existsSync(jobPath)) {
      missing.push(m.slug)
      continue
    }
    const job = checkJob(JSON.parse(fs.readFileSync(jobPath, 'utf8')) as unknown, m, jobPath)
    const st = fs.statSync(job.inputPath, { throwIfNoEntry: false })
    if (!st?.isFile()) throw new UsageError(`${m.slug}: input ${job.inputPath} does not exist`)
    if (m.bytes !== null && st.size !== m.bytes) {
      throw new UsageError(
        `${m.slug}: source is ${st.size} bytes, the manifest pins ${m.bytes} (source changed; 16 §13.1)`,
      )
    }
    if (m.sha256 !== null) {
      const sha = sha256File(job.inputPath)
      if (sha !== m.sha256) {
        throw new UsageError(
          `${m.slug}: source sha256 ${sha} differs from the manifest (source changed; 16 §13.1)`,
        )
      }
    }
    jobs.push(job)
  }
  if (missing.length > 0) {
    throw new UsageError(
      `${missing.length} job file(s) missing in ${jobsDir}, e.g. ${missing.slice(0, 3).join(', ')}`,
    )
  }
  return jobs
}

function runCommand(cmd: string, args: readonly string[]): string {
  return execFileSync(cmd, args, { cwd: path.join(REPO_ROOT, 'native'), encoding: 'utf8' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ChildResult {
  record: MarketRecord
}

function runOne(bin: string, job: CheckedJob, qos: Qos, timeFile: string): Promise<ChildResult> {
  const wrap = qos === 'default' ? [] : [TASKPOLICY, '-c', qos]
  const args = ['-l', '-o', timeFile, ...wrap, bin, 'run', '--job', job.jobPath]
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint()
    const child = spawn(TIME, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let errTail = ''
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => {
      errTail = (errTail + b.toString('utf8')).slice(-4000)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
      try {
        if (signal !== null) throw new Error(`killed by ${signal}`)
        const stdout = Buffer.concat(out).toString('utf8')
        if (stdout.trim() === '') throw new Error(`exit ${code} with no EngineResult on stdout`)
        const sections = resultSections(stdout)
        const usage = parseTimeL(fs.readFileSync(timeFile, 'utf8'))
        fs.rmSync(timeFile, { force: true })
        const status = readLiteral(sections.root, 'status')
        const inputPath = readLiteral(sections.root, 'diagnostics', 'inputPath')
        resolve({
          record: {
            idx: job.idx,
            slug: job.slug,
            exitCode: code ?? -1,
            status: typeof status === 'string' ? status : 'unknown',
            wallMs,
            usage,
            detSha256: sha256Hex(sections.deterministic),
            crossSha256: sha256Hex(sections.crossBinary),
            inputPath: typeof inputPath === 'string' ? inputPath : null,
          },
        })
      } catch (e) {
        reject(new Error(`${job.slug}: ${(e as Error).message}\n${errTail}`))
      }
    })
  })
}

async function runSet(
  bin: BinaryInfo,
  jobs: readonly CheckedJob[],
  opts: Options,
  tmpDir: string,
  tag: string,
): Promise<{ wallMs: number; markets: MarketRecord[] }> {
  const markets: MarketRecord[] = new Array<MarketRecord>(jobs.length)
  let next = 0
  const t0 = process.hrtime.bigint()
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      const job = jobs[i]
      if (job === undefined) return
      const timeFile = path.join(tmpDir, `${tag}-${job.idx}.time`)
      markets[i] = (await runOne(bin.path, job, opts.qos, timeFile)).record
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker))
  return { wallMs: Number(process.hrtime.bigint() - t0) / 1e6, markets }
}

async function main(): Promise<number> {
  if (process.platform !== 'darwin')
    throw new UsageError('the L1 driver runs on macOS hosts (16 §13.5)')
  const opts = parseOptions(process.argv.slice(2))
  const manifestBytes = fs.readFileSync(opts.set)
  const set = parseBenchSet(
    manifestBytes.toString('utf8'),
    opts.set,
    path.basename(opts.set, '.json'),
  )
  const binaries = opts.bins.map((b, i) => binaryInfo(b, i === 0 ? 'A' : 'B'))
  if (binaries.length === 2 && binaries[0]!.sha256 === binaries[1]!.sha256) {
    throw new UsageError('both --bin arguments are the same binary')
  }
  const jobs = loadJobs(set, opts.jobsDir)
  const run = checkRunConsistency(set, jobs)
  const host: HostFacts = collectHostFacts(runCommand, {
    ...(opts.host !== undefined ? { host: opts.host } : {}),
    hostname: os.hostname(),
    node: process.versions.node,
  })
  const base = path.join(opts.outDir, `${set.name}-${opts.date}-${host.host}`)
  for (const ext of ['.md', '.json']) {
    if (!opts.force && fs.existsSync(base + ext))
      throw new UsageError(`${base + ext} exists (use --force to replace)`)
  }
  const schedule = abbaSchedule(binaries.length, opts.reps)
  console.log(
    `set ${set.name}: ${jobs.length} markets; binaries ${binaries.map((b) => `${b.label}=${b.sha256.slice(0, 12)}`).join(' ')}; ` +
      `T=${opts.concurrency}; qos ${opts.qos}; schedule ${schedule.map((s) => (s.warmup ? `${binaries[s.bin]!.label}w` : binaries[s.bin]!.label)).join(' ')}`,
  )
  if (opts.dryRun) {
    console.log(`dry run: inputs valid; would write ${base}.{md,json}`)
    return 0
  }

  const started = new Date()
  const psArgs = execFileSync('ps', ['-Ao', 'pid=,args='], { encoding: 'utf8' })
  const fleetProcessCount = countFleetProcesses(psArgs, process.pid)
  const psTop = execFileSync('ps', ['-Ao', 'pcpu=,pid=,comm=', '-r'], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, 10)
    .map((l) => l.trim())
  const preStartLoad1: number[] = []
  if (opts.quietHostConfirmed) {
    console.log('sampling the 1-minute load average for 60 s before start (16 §13.5)')
    for (let i = 0; i < PRE_START_SAMPLES; i++) {
      preStartLoad1.push(os.loadavg()[0]!)
      if (i + 1 < PRE_START_SAMPLES) await sleep(LOAD_SAMPLE_MS)
    }
  }
  const t0 = Date.now()
  const loadSamples: LoadSample[] = [{ tMs: 0, load1: os.loadavg()[0]! }]
  const sampler = setInterval(
    () => loadSamples.push({ tMs: Date.now() - t0, load1: os.loadavg()[0]! }),
    LOAD_SAMPLE_MS,
  )

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-bench-l1-'))
  const runs: RunRecord[] = []
  try {
    for (const [i, slot] of schedule.entries()) {
      const bin = binaries[slot.bin]!
      const loadBefore = os.loadavg()
      const startedAt = new Date().toISOString()
      const { wallMs, markets } = await runSet(bin, jobs, opts, tmpDir, `${i}`)
      const loadAfter = os.loadavg()
      const inputPaths: Record<string, number> = {}
      for (const m of markets) {
        const k = m.inputPath ?? 'unreported'
        inputPaths[k] = (inputPaths[k] ?? 0) + 1
      }
      const record: RunRecord = {
        order: i + 1,
        bin: bin.label,
        rep: slot.rep,
        warmup: slot.warmup,
        startedAt,
        metrics: runMetrics(
          wallMs,
          markets.map((m) => m.usage),
          host.logicalCpu,
        ),
        loadBefore,
        loadAfter,
        digest: setDigest(markets.map((m) => ({ idx: m.idx, candidate: 0, sha256: m.detSha256 }))),
        crossDigest: setDigest(
          markets.map((m) => ({ idx: m.idx, candidate: 0, sha256: m.crossSha256 })),
        ),
        failedMarkets: markets.filter((m) => m.exitCode !== 0).length,
        inputPaths,
        markets,
      }
      runs.push(record)
      console.log(
        `${record.order}/${schedule.length} ${bin.label} ${slot.warmup ? 'warm-up' : `rep ${slot.rep}`}: ` +
          `${(wallMs / 1000).toFixed(3)} s, ${record.metrics.marketsPerS.toFixed(2)} markets/s, ` +
          `load ${loadBefore[0]!.toFixed(2)} → ${loadAfter[0]!.toFixed(2)}, digest ${record.digest.slice(0, 12)}`,
      )
    }
  } finally {
    clearInterval(sampler)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  loadSamples.push({ tMs: Date.now() - t0, load1: os.loadavg()[0]! })

  const verdict = classifyConditions({
    quietHostConfirmed: opts.quietHostConfirmed,
    fleetProcessCount,
    preStartLoad1,
    startLocalHour: started.getHours(),
    binariesCanonical: binaries.every((b) => b.canonical),
    acPower: host.powerSource === null ? null : host.powerSource === 'AC Power',
    lowPowerMode: host.lowPowerMode,
  })
  const allInputPaths: Record<string, number> = {}
  for (const r of runs.filter((x) => !x.warmup)) {
    for (const [k, v] of Object.entries(r.inputPaths))
      allInputPaths[k] = (allInputPaths[k] ?? 0) + v
  }
  const report: BenchReport = {
    schemaVersion: 1,
    level: 'L1',
    generatedAt: new Date().toISOString(),
    set: {
      name: set.name,
      path: opts.set.startsWith(REPO_ROOT + path.sep)
        ? path.relative(REPO_ROOT, opts.set)
        : opts.set,
      sha256: sha256Hex(manifestBytes),
      markets: jobs.length,
    },
    host,
    conditions: {
      label: verdict.label,
      reasons: verdict.reasons,
      quietHostConfirmed: opts.quietHostConfirmed,
      fleetProcessCount,
      preStartLoad1,
      loadDuring: loadSummary(loadSamples),
      loadSamples,
      psTop,
      startedAtLocal: localStamp(started),
    },
    config: {
      concurrency: opts.concurrency,
      reps: opts.reps,
      qos: opts.qos,
      qosMechanism:
        opts.qos === 'default'
          ? 'no clamp; effective class not read back'
          : `taskpolicy -c ${opts.qos} per process; effective class not read back`,
      profile: `${opts.profile} (declared)`,
      cacheBudget: 'none (process per job)',
      inputPaths: allInputPaths,
      strategyId: run.strategyId,
      modelConfigSha256: sha256Hex(stableStringify(run.modelConfig)),
      modelConfig: run.modelConfig,
      jobsDir: opts.jobsDir,
      wrapper: `${TIME} -l -o <file>${opts.qos === 'default' ? '' : ` ${TASKPOLICY} -c ${opts.qos}`}`,
    },
    binaries,
    runs,
    summary: summarizeRuns(runs),
    determinism: checkDeterminism(runs),
  }
  fs.mkdirSync(opts.outDir, { recursive: true })
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(`${base}.md`, renderMarkdown(report))
  console.log(`wrote ${base}.md and ${base}.json (${verdict.label})`)
  if (!report.determinism.ok) {
    console.error('DETERMINISM MISMATCH: deterministic sections differ between runs (16 §13.7)')
    return 2
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    const expected =
      e instanceof Error && ['UsageError', 'ManifestError', 'JobError'].includes(e.name)
    console.error(expected ? `bench-l1: ${(e as Error).message}` : e)
    process.exit(1)
  },
)
