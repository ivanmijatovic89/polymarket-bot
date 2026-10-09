// L1 engine-only benchmark driver (16 §13.2 L1, 01 §6 M1 step 7).
//
// Feeds the prebuilt `EngineJob` files of one bench set (16 §13.1) to
// `<bin> run --job <file> [--tape-dir <dir>]` (20 §5.4), one process per
// market with T processes in flight, for one or more arms (configurations:
// binary, T, QoS clamp, tape dir; 16 §13.3). One discarded warm-up per arm,
// then `--reps` repetitions interleaved ABBA across arms (16 §13.5). It
// records wall time, ok markets/s, market-candidates/s, CPU (user + sys from
// each process's rusage via `/usr/bin/time -l`), peak RSS, the diagnostics
// the binary reports (input path, cache, strategyTicksSkipped, phases), the
// load average, `ps` checks at start, during and end, the Redis/MySQL CPU
// share and the effective QoS, and hashes every run's deterministic sections
// (16 §13.7). Appends one row to
// `native/reports/bench-<milestone>-<yyyymmdd>-<host>.{md,json}` (16 §13.8).
//
//   npm run native:bench:l1 -- --milestone M1 --set native/bench/sets/smoke-50.json \
//     --jobs-dir <dir> --arm bin=data/strategy-artifacts/native/<sha>,T=8 \
//     [--arm bin=data/strategy-artifacts/native/<sha>,T=8,tape-dir=data/native-tapes]
//
// Arm keys: bin (required), T (required), qos (default utility; default |
// utility | background), tape-dir, label (default A, B, …).
// Exit: 0 ok; 2 determinism mismatch; 3 a market failed (the row is marked
// FAILED); 1 usage or input error. No Redis, MySQL, R2 or network: it only
// spawns the given binaries and reads the host's process table.

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  readLiteral,
  resultSections,
  setDigest,
  sha256Hex,
} from '../../native/bench/harness/canonicalJson.js'
import {
  PRE_START_SAMPLES,
  classifyConditions,
  type PsCheck,
} from '../../native/bench/harness/conditions.js'
import { collectHostFacts, type HostFacts } from '../../native/bench/harness/hostFacts.js'
import {
  checkJob,
  checkJobInput,
  checkRunConsistency,
  stableStringify,
  type CheckedJob,
} from '../../native/bench/harness/jobs.js'
import { parseBenchSet, type BenchSet } from '../../native/bench/harness/manifest.js'
import { checkArms, parseArm, type ArmSpec, type Qos } from '../../native/bench/harness/arms.js'
import {
  effectiveQos,
  psCheck,
  sampleServices,
  type ServiceSample,
} from '../../native/bench/harness/probes.js'
import {
  checkDeterminism,
  marketDiagnostics,
  rowFailures,
  runDiagnostics,
  summarizeRuns,
  type ArmInfo,
  type BinaryInfo,
  type DescribeBinary,
  type L1Row,
  type MarketRecord,
  type RunRecord,
  type ServiceCpu,
} from '../../native/bench/harness/report.js'
import { appendRow, prettierFormatter, reportBase } from '../../native/bench/harness/reportFile.js'
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
const LOAD_SAMPLE_MS = 5000
const PS_EVERY_SAMPLES = 6 // a `ps` check every 30 s during the row

class UsageError extends Error {
  override name = 'UsageError'
}

interface Options {
  set: string
  arms: ArmSpec[]
  jobsDir: string
  dataRoot: string
  reps: number
  milestone: string
  outDir: string
  host: string | undefined
  date: string
  quietHostConfirmed: boolean
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
  if (v === undefined) throw new UsageError(`${name} is required`)
  if (!/^[1-9][0-9]*$/.test(v)) throw new UsageError(`${name} must be a positive integer, got ${v}`)
  return Number(v)
}

function parseOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      set: { type: 'string' },
      arm: { type: 'string', multiple: true },
      'jobs-dir': { type: 'string' },
      'data-root': { type: 'string', default: path.join(REPO_ROOT, 'data') },
      reps: { type: 'string', default: '3' },
      milestone: { type: 'string' },
      'out-dir': { type: 'string', default: path.join(REPO_ROOT, 'native/reports') },
      host: { type: 'string' },
      date: { type: 'string' },
      'quiet-host-confirmed': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 0) throw new UsageError(`unexpected arguments: ${positionals.join(' ')}`)
  if (values.set === undefined) throw new UsageError('--set <manifest.json> is required')
  if (values.milestone === undefined) throw new UsageError('--milestone (M1, M5a, …) is required')
  const arms = (values.arm ?? []).map(parseArm)
  checkArms(arms)
  if (values['jobs-dir'] === undefined) {
    // D-PENDING: render jobs through src/native (buildEngineJob, M1 step 6)
    // once it exists on this branch.
    throw new UsageError(
      '--jobs-dir is required: rendering jobs through src/native is not available yet',
    )
  }
  const date = values.date ?? localDate(new Date())
  if (!/^[0-9]{8}$/.test(date)) throw new UsageError('--date must be yyyymmdd')
  return {
    set: path.resolve(values.set),
    arms,
    jobsDir: path.resolve(values['jobs-dir']),
    dataRoot: path.resolve(values['data-root']),
    reps: positiveInt('--reps', values.reps),
    milestone: values.milestone,
    outDir: path.resolve(values['out-dir']),
    host: values.host,
    date,
    quietHostConfirmed: values['quiet-host-confirmed'],
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

function describeBinary(p: string): { describe: DescribeBinary | null; error: string | null } {
  try {
    const out = execFileSync(p, ['describe'], { encoding: 'utf8', timeout: 30_000 })
    const doc = JSON.parse(out) as { binary?: Record<string, unknown> }
    const b = doc.binary ?? {}
    const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    return {
      describe: {
        engineVersion: s(b.engineVersion),
        engineCommit: s(b.engineCommit),
        engineDirty: typeof b.engineDirty === 'boolean' ? b.engineDirty : null,
        rustc: s(b.rustc),
        target: s(b.target),
        buildProfile: s(b.buildProfile),
      },
      error: null,
    }
  } catch (e) {
    return { describe: null, error: (e as Error).message.split('\n')[0] ?? 'failed' }
  }
}

/**
 * Canonical (01 §6, 31 §6.1): `data/strategy-artifacts/native/<sha256>`
 * named by its own sha, with `<sha>.build.json` next to it, and `describe`
 * reporting `buildProfile = artifact` and `engineDirty = false` (20 §3).
 * Profile and rustc come from the binary, never from a CLI declaration.
 */
function binaryInfo(p: string): BinaryInfo {
  const st = fs.statSync(p, { throwIfNoEntry: false })
  if (!st?.isFile()) throw new UsageError(`binary ${p} does not exist`)
  fs.accessSync(p, fs.constants.X_OK)
  const sha256 = sha256File(p)
  const base = path.basename(p)
  if (/^[0-9a-f]{64}$/.test(base) && base !== sha256) {
    throw new UsageError(`binary ${p}: file name says ${base} but its sha256 is ${sha256}`)
  }
  const reasons: string[] = []
  if (path.dirname(p) !== CANONICAL_DIR || base !== sha256) {
    reasons.push('not data/strategy-artifacts/native/<its sha256>')
  }
  const manifest = path.join(path.dirname(p), `${sha256}.build.json`)
  let buildManifestSha256: string | null = null
  if (fs.existsSync(manifest)) {
    const bytes = fs.readFileSync(manifest)
    try {
      JSON.parse(bytes.toString('utf8'))
      buildManifestSha256 = sha256Hex(bytes)
    } catch {
      reasons.push(`${sha256}.build.json is not JSON`)
    }
  } else {
    reasons.push(`no ${sha256.slice(0, 12)}….build.json build manifest (31 §5.4)`)
  }
  const { describe, error } = describeBinary(p)
  if (describe === null) reasons.push(`describe failed: ${error}`)
  else {
    if (describe.buildProfile !== 'artifact')
      reasons.push(`buildProfile ${describe.buildProfile ?? 'unknown'}`)
    if (describe.engineDirty !== false) reasons.push('engineDirty is not false')
  }
  return {
    path: p,
    sha256,
    canonical: reasons.length === 0,
    canonicalReasons: reasons,
    buildManifestSha256,
    describe,
  }
}

/** Loads and checks every job; the sha256 pass is the first read of the inputs (cold-read note). */
function loadJobs(
  set: BenchSet,
  jobsDir: string,
  dataRoot: string,
): { jobs: CheckedJob[]; coldRead: L1Row['coldRead'] } {
  const jobs: CheckedJob[] = []
  const missing: string[] = []
  let bytes = 0
  let readMs = 0
  for (const m of set.markets) {
    const jobPath = path.join(jobsDir, `${m.slug}.json`)
    if (!fs.existsSync(jobPath)) {
      missing.push(m.slug)
      continue
    }
    const job = checkJob(JSON.parse(fs.readFileSync(jobPath, 'utf8')) as unknown, m, jobPath)
    checkJobInput(job, m, dataRoot)
    const st = fs.statSync(job.input.path, { throwIfNoEntry: false })
    if (!st?.isFile()) throw new UsageError(`${m.slug}: input ${job.input.path} does not exist`)
    if (st.size !== m.bytes) {
      throw new UsageError(
        `${m.slug}: source is ${st.size} bytes, the manifest pins ${m.bytes} (source changed; 16 §13.1)`,
      )
    }
    const t0 = process.hrtime.bigint()
    const sha = sha256File(job.input.path)
    readMs += Number(process.hrtime.bigint() - t0) / 1e6
    bytes += st.size
    if (sha !== m.sha256) {
      throw new UsageError(
        `${m.slug}: source sha256 ${sha} differs from the manifest (source changed; 16 §13.1)`,
      )
    }
    jobs.push(job)
  }
  if (missing.length > 0) {
    throw new UsageError(
      `${missing.length} job file(s) missing in ${jobsDir}, e.g. ${missing.slice(0, 3).join(', ')}`,
    )
  }
  return {
    jobs,
    coldRead: {
      files: jobs.length,
      bytes,
      elapsedMs: readMs,
      note:
        'first read by this driver (sha256 verification, includes hashing); cold only for files ' +
        'not already in the page cache (the driver cannot purge it without root)',
    },
  }
}

function runCommand(cmd: string, args: readonly string[]): string {
  return execFileSync(cmd, args, { cwd: path.join(REPO_ROOT, 'native'), encoding: 'utf8' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const wrapperOf = (qos: Qos): string[] => (qos === 'default' ? [] : [TASKPOLICY, '-c', qos])

function runArgsOf(arm: ArmSpec): string[] {
  return arm.tapeDir === null ? [] : ['--tape-dir', arm.tapeDir]
}

function failedRecord(job: CheckedJob, code: number, wallMs: number, why: string): MarketRecord {
  return {
    idx: job.idx,
    slug: job.slug,
    exitCode: code,
    status: 'no-result',
    candidateStatus: null,
    errorClass: why,
    ok: false,
    wallMs,
    usage: {
      realMs: wallMs,
      userMs: 0,
      sysMs: 0,
      maxRssBytes: 0,
      peakFootprintBytes: null,
      instructions: null,
      cycles: null,
    },
    detSha256: '',
    crossSha256: '',
    inputPath: null,
    diagnostics: {
      cacheHits: null,
      cacheMisses: null,
      strategyTicksSkipped: null,
      phases: null,
      bytesDecoded: null,
    },
  }
}

function runOne(arm: ArmSpec, job: CheckedJob, timeFile: string): Promise<MarketRecord> {
  const args = [
    '-l',
    '-o',
    timeFile,
    ...wrapperOf(arm.qos),
    arm.bin,
    'run',
    '--job',
    job.jobPath,
    ...runArgsOf(arm),
  ]
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
      const exitCode = code ?? -1
      const stdout = Buffer.concat(out).toString('utf8')
      if (signal !== null || stdout.trim() === '') {
        fs.rmSync(timeFile, { force: true })
        console.error(
          `${job.slug}: ${signal !== null ? `killed by ${signal}` : `exit ${exitCode}, no EngineResult`}\n${errTail}`,
        )
        resolve(failedRecord(job, exitCode, wallMs, signal ?? 'no EngineResult on stdout'))
        return
      }
      try {
        const sections = resultSections(stdout)
        const usage = parseTimeL(fs.readFileSync(timeFile, 'utf8'))
        fs.rmSync(timeFile, { force: true })
        const status = readLiteral(sections.root, 'status')
        const cand = readLiteral(sections.root, 'candidates', 0, 'status')
        const errClass =
          readLiteral(sections.root, 'error', 'class') ??
          readLiteral(sections.root, 'candidates', 0, 'error', 'class')
        const inputPath = readLiteral(sections.root, 'diagnostics', 'inputPath')
        const ok = exitCode === 0 && status === 'ok' && cand === 'ok'
        if (!ok)
          console.error(
            `${job.slug}: exit ${exitCode}, status ${String(status)}, candidate ${String(cand)}`,
          )
        resolve({
          idx: job.idx,
          slug: job.slug,
          exitCode,
          status: typeof status === 'string' ? status : 'unknown',
          candidateStatus: typeof cand === 'string' ? cand : null,
          errorClass: typeof errClass === 'string' ? errClass : null,
          ok,
          wallMs,
          usage,
          detSha256: sha256Hex(sections.deterministic),
          crossSha256: sha256Hex(sections.crossBinary),
          inputPath: typeof inputPath === 'string' ? inputPath : null,
          diagnostics: marketDiagnostics(sections.root),
        })
      } catch (e) {
        reject(new Error(`${job.slug}: ${(e as Error).message}\n${errTail}`))
      }
    })
  })
}

async function runSet(
  arm: ArmSpec,
  jobs: readonly CheckedJob[],
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
      markets[i] = await runOne(arm, job, path.join(tmpDir, `${tag}-${job.idx}.time`))
    }
  }
  await Promise.all(Array.from({ length: Math.min(arm.concurrency, jobs.length) }, worker))
  return { wallMs: Number(process.hrtime.bigint() - t0) / 1e6, markets }
}

function serviceCpu(
  start: readonly ServiceSample[],
  end: readonly ServiceSample[],
  during: readonly ServiceSample[],
  wallMs: number,
): ServiceCpu[] {
  return end.flatMap((e) => {
    const s = start.find((x) => x.pid === e.pid)
    if (s === undefined) return []
    const cpuMs = e.cpuMs - s.cpuMs
    return [
      {
        name: e.name,
        pid: e.pid,
        cpuMs,
        coresAvg: wallMs > 0 ? cpuMs / wallMs : 0,
        pcpuSamples: during.filter((x) => x.pid === e.pid).map((x) => x.pcpu),
      },
    ]
  })
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
  const { jobs, coldRead } = loadJobs(set, opts.jobsDir, opts.dataRoot)
  const run = checkRunConsistency(set, jobs)
  const binaries = new Map<string, BinaryInfo>()
  for (const a of opts.arms) if (!binaries.has(a.bin)) binaries.set(a.bin, binaryInfo(a.bin))
  const host: HostFacts = collectHostFacts(runCommand, {
    ...(opts.host !== undefined ? { host: opts.host } : {}),
    hostname: os.hostname(),
    node: process.versions.node,
  })
  const meta = { milestone: opts.milestone, date: opts.date, host: host.host }
  const base = reportBase(opts.outDir, opts.milestone, opts.date, host.host)
  const arms: ArmInfo[] = opts.arms.map((a) => ({
    label: a.label,
    binary: binaries.get(a.bin)!,
    concurrency: a.concurrency,
    qos: a.qos,
    effectiveQos: effectiveQos(wrapperOf(a.qos)),
    tapeDir: a.tapeDir,
    runArgs: runArgsOf(a),
    cacheBudget: 'none (process per job)',
  }))
  const schedule = abbaSchedule(opts.arms.length, opts.reps)
  console.log(
    `set ${set.name}: ${jobs.length} markets; arms ${arms
      .map(
        (a) =>
          `${a.label}=${a.binary.sha256.slice(0, 12)} T=${a.concurrency} qos ${a.qos} (effective ${a.effectiveQos.className ?? 'unknown'})${a.tapeDir === null ? '' : ` tape ${a.tapeDir}`}`,
      )
      .join(
        '; ',
      )}; schedule ${schedule.map((s) => `${opts.arms[s.arm]!.label}${s.warmup ? 'w' : ''}`).join(' ')}`,
  )
  if (opts.dryRun) {
    console.log(`dry run: inputs valid; would append a row to ${base}.{md,json}`)
    return 0
  }

  const preStartLoad1: number[] = []
  if (opts.quietHostConfirmed) {
    console.log('sampling the 1-minute load average for 60 s before start (16 §13.5)')
    for (let i = 0; i < PRE_START_SAMPLES; i++) {
      preStartLoad1.push(os.loadavg()[0]!)
      if (i + 1 < PRE_START_SAMPLES) await sleep(LOAD_SAMPLE_MS)
    }
  }
  const psTop = execFileSync('ps', ['-Ao', 'pcpu=,pid=,comm=', '-r'], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, 10)
    .map((l) => l.trim())
  const started = new Date()
  const t0 = Date.now()
  const psChecks: PsCheck[] = [psCheck(process.pid, 'start', 0)]
  const servicesStart = sampleServices()
  const servicesDuring: ServiceSample[] = []
  const loadSamples: LoadSample[] = [{ tMs: 0, load1: os.loadavg()[0]! }]
  let tick = 0
  const sampler = setInterval(() => {
    loadSamples.push({ tMs: Date.now() - t0, load1: os.loadavg()[0]! })
    if (++tick % PS_EVERY_SAMPLES === 0) {
      psChecks.push(psCheck(process.pid, 'during', Date.now() - t0))
      servicesDuring.push(...sampleServices())
    }
  }, LOAD_SAMPLE_MS)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-bench-l1-'))
  const runs: RunRecord[] = []
  try {
    for (const [i, slot] of schedule.entries()) {
      const arm = opts.arms[slot.arm]!
      const loadBefore = os.loadavg()
      const startedAt = new Date().toISOString()
      const { wallMs, markets } = await runSet(arm, jobs, tmpDir, `${i}`)
      const loadAfter = os.loadavg()
      const inputPaths: Record<string, number> = {}
      for (const m of markets) {
        const k = m.inputPath ?? 'unreported'
        inputPaths[k] = (inputPaths[k] ?? 0) + 1
      }
      const record: RunRecord = {
        order: i + 1,
        arm: arm.label,
        rep: slot.rep,
        warmup: slot.warmup,
        startedAt,
        metrics: runMetrics(
          wallMs,
          markets.map((m) => ({ usage: m.usage, ok: m.ok, candidates: 1 })),
          host.logicalCpu,
        ),
        loadBefore,
        loadAfter,
        digest: setDigest(markets.map((m) => ({ idx: m.idx, candidate: 0, sha256: m.detSha256 }))),
        crossDigest: setDigest(
          markets.map((m) => ({ idx: m.idx, candidate: 0, sha256: m.crossSha256 })),
        ),
        inputPaths,
        diagnostics: runDiagnostics(markets),
        markets,
      }
      runs.push(record)
      console.log(
        `${record.order}/${schedule.length} ${arm.label} ${slot.warmup ? 'warm-up' : `rep ${slot.rep}`}: ` +
          `${(wallMs / 1000).toFixed(3)} s, ${record.metrics.marketsPerS.toFixed(2)} ok markets/s, ` +
          `${record.metrics.failedMarkets} failed, load ${loadBefore[0]!.toFixed(2)} → ${loadAfter[0]!.toFixed(2)}, ` +
          `digest ${record.digest.slice(0, 12)}`,
      )
    }
  } finally {
    clearInterval(sampler)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  const ended = new Date()
  const rowWallMs = Date.now() - t0
  loadSamples.push({ tMs: rowWallMs, load1: os.loadavg()[0]! })
  psChecks.push(psCheck(process.pid, 'end', rowWallMs))
  const services = serviceCpu(servicesStart, sampleServices(), servicesDuring, rowWallMs)

  const verdict = classifyConditions({
    quietHostConfirmed: opts.quietHostConfirmed,
    psChecks,
    preStartLoad1,
    rowLoad1: loadSamples.map((s) => s.load1),
    maxConcurrency: Math.max(...opts.arms.map((a) => a.concurrency)),
    start: started,
    end: ended,
    binariesCanonical: arms.every((a) => a.binary.canonical),
    acPower: host.powerSource === null ? null : host.powerSource === 'AC Power',
    lowPowerMode: host.lowPowerMode,
    reps: opts.reps,
  })
  const armBinary = Object.fromEntries(arms.map((a) => [a.label, a.binary.sha256]))
  const determinism = checkDeterminism(runs, armBinary)
  const failureReasons = rowFailures(runs, determinism)
  const row: L1Row = {
    level: 'L1',
    generatedAt: new Date().toISOString(),
    set: {
      name: set.name,
      path: opts.set.startsWith(REPO_ROOT + path.sep)
        ? path.relative(REPO_ROOT, opts.set)
        : opts.set,
      sha256: sha256Hex(manifestBytes),
      inputMode: set.inputMode,
      strategy: set.strategy,
      modelConfigSha256: sha256Hex(stableStringify(run.modelConfig)),
      modelConfig: run.modelConfig,
      markets: set.markets.map((m) => ({
        idx: m.idx,
        slug: m.slug,
        sha256: m.sha256,
        bytes: m.bytes,
        file: m.file,
      })),
    },
    dataRoot: opts.dataRoot,
    jobsDir: opts.jobsDir,
    host,
    conditions: {
      label: verdict.label,
      reasons: verdict.reasons,
      quietHostConfirmed: opts.quietHostConfirmed,
      psChecks,
      preStartLoad1,
      loadDuring: loadSummary(loadSamples),
      loadSamples,
      services,
      psTop,
      startedAtLocal: localStamp(started),
      endedAtLocal: localStamp(ended),
    },
    reps: opts.reps,
    wrapper: `${TIME} -l -o <file> [${TASKPOLICY} -c <qos>] <bin> run --job <job> [--tape-dir <dir>]`,
    arms,
    coldRead,
    runs,
    summary: summarizeRuns(runs),
    determinism,
    failed: failureReasons.length > 0,
    failureReasons,
  }
  const file = appendRow(base, meta, row, prettierFormatter(REPO_ROOT))
  console.log(
    `appended row ${file.rows.length} to ${base}.md and .json (${verdict.label}${row.failed ? ', FAILED' : ''})`,
  )
  if (!determinism.ok) {
    console.error('DETERMINISM MISMATCH: deterministic sections differ between runs (16 §13.7)')
    return 2
  }
  if (row.failed) {
    console.error(`ROW FAILED: ${failureReasons.join('; ')}`)
    return 3
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    const expected =
      e instanceof Error &&
      ['UsageError', 'ManifestError', 'JobError', 'ReportFileError'].includes(e.name)
    console.error(expected ? `bench-l1: ${(e as Error).message}` : e)
    process.exit(1)
  },
)
