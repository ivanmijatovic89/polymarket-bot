// L0 micro-benchmark driver (16 §13.2 L0, 01 §6 M1 step 7).
//
// Runs the engine crates' criterion benches `--reps` times, interleaved
// across bench targets (forward order on odd repetitions, reverse on even),
// each run with its own `CRITERION_HOME` so no run's raw samples overwrite
// another's. Records criterion's raw samples and estimates per run, the
// median/min/max of the per-run medians (16 §13.5), the load average, `ps`
// checks and the effective QoS, and appends one row to
// `native/reports/bench-<milestone>-<yyyymmdd>-<host>.{md,json}` (16 §13.8).
// L0 uses the workspace `bench` profile and is read only as before/after
// A/B (01 §6 M1 step 7).
//
//   npm run native:bench:l0 -- --milestone M1 [--reps 3] [--qos utility]
//     [--target pmb-book/book ...] [--data-root data] [--allow-missing-markets]
//
// The benches are built first (`cargo bench --no-run`, not measured).

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  PRE_START_SAMPLES,
  classifyConditions,
  type PsCheck,
} from '../../native/bench/harness/conditions.js'
import { collectHostFacts } from '../../native/bench/harness/hostFacts.js'
import {
  readCriterionHome,
  summarizeL0,
  type BenchTarget,
  type L0Row,
  type L0Run,
} from '../../native/bench/harness/l0.js'
import { effectiveQos, psCheck } from '../../native/bench/harness/probes.js'
import { appendRow, reportBase } from '../../native/bench/harness/reportFile.js'
import { loadSummary, type LoadSample } from '../../native/bench/harness/stats.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NATIVE = path.join(REPO_ROOT, 'native')
const TASKPOLICY = '/usr/sbin/taskpolicy'
const QOS_CLAMPS = ['default', 'utility', 'background'] as const
type Qos = (typeof QOS_CLAMPS)[number]
const DEFAULT_TARGETS = ['pmb-core/fixed', 'pmb-book/book', 'pmb-replay/decode']
const LOAD_SAMPLE_MS = 5000
const PS_EVERY_SAMPLES = 6

class UsageError extends Error {
  override name = 'UsageError'
}

function localDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${localDate(d).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTarget(t: string): BenchTarget {
  const m = /^([a-z0-9_-]+)\/([a-z0-9_-]+)$/.exec(t)
  if (!m || m[1] === undefined || m[2] === undefined)
    throw new UsageError(`--target must be <package>/<bench>, got ${t}`)
  return { package: m[1], bench: m[2] }
}

function cargoBench(
  target: BenchTarget,
  wrapper: readonly string[],
  env: NodeJS.ProcessEnv,
  extra: readonly string[],
  log: string,
): Promise<void> {
  const args = ['bench', '--locked', '-p', target.package, '--bench', target.bench, ...extra]
  const [cmd, ...pre] = wrapper.length > 0 ? [...wrapper, 'cargo'] : ['cargo']
  return new Promise((resolve, reject) => {
    const out = fs.openSync(log, 'a')
    const child = spawn(cmd!, [...pre, ...args], { cwd: NATIVE, env, stdio: ['ignore', out, out] })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      fs.closeSync(out)
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `cargo ${args.join(' ')} failed (${signal ?? `exit ${code}`}); log ${log}:\n` +
              fs.readFileSync(log, 'utf8').slice(-3000),
          ),
        )
    })
  })
}

async function main(): Promise<number> {
  if (process.platform !== 'darwin') throw new UsageError('the L0 driver runs on macOS hosts')
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: true,
    options: {
      milestone: { type: 'string' },
      reps: { type: 'string', default: '3' },
      qos: { type: 'string', default: 'utility' },
      target: { type: 'string', multiple: true },
      'data-root': { type: 'string', default: path.join(REPO_ROOT, 'data') },
      'allow-missing-markets': { type: 'boolean', default: false },
      'out-dir': { type: 'string', default: path.join(REPO_ROOT, 'native/reports') },
      host: { type: 'string' },
      date: { type: 'string' },
      'quiet-host-confirmed': { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 0) throw new UsageError(`unexpected arguments: ${positionals.join(' ')}`)
  if (values.milestone === undefined) throw new UsageError('--milestone (M1, M5a, …) is required')
  if (!/^[1-9][0-9]*$/.test(values.reps)) throw new UsageError('--reps must be a positive integer')
  const reps = Number(values.reps)
  const qos = values.qos as Qos
  if (!QOS_CLAMPS.includes(qos))
    throw new UsageError(`--qos must be one of ${QOS_CLAMPS.join(', ')}`)
  const targets = (values.target ?? DEFAULT_TARGETS).map(parseTarget)
  const dataRoot = path.resolve(values['data-root'])
  const date = values.date ?? localDate(new Date())
  const wrapper = qos === 'default' ? [] : [TASKPOLICY, '-c', qos]
  const run = (cmd: string, args: readonly string[]): string =>
    execFileSync(cmd, args, { cwd: NATIVE, encoding: 'utf8' })
  const host = collectHostFacts(run, {
    ...(values.host !== undefined ? { host: values.host } : {}),
    hostname: os.hostname(),
    node: process.versions.node,
  })
  const meta = { milestone: values.milestone, date, host: host.host }
  const base = reportBase(path.resolve(values['out-dir']), values.milestone, date, host.host)
  const commit = run('git', ['rev-parse', 'HEAD']).trim()
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).trim() !== ''
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PMB_BENCH_DATA_ROOT: dataRoot,
    ...(values['allow-missing-markets'] ? { PMB_BENCH_ALLOW_MISSING: '1' } : {}),
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-bench-l0-'))
  const log = path.join(tmp, 'cargo.log')
  console.log(`building ${targets.map((t) => `${t.package}/${t.bench}`).join(', ')} (not measured)`)
  for (const t of targets) await cargoBench(t, [], env, ['--no-run'], log)

  const preStartLoad1: number[] = []
  if (values['quiet-host-confirmed']) {
    console.log('sampling the 1-minute load average for 60 s before start (16 §13.5)')
    for (let i = 0; i < PRE_START_SAMPLES; i++) {
      preStartLoad1.push(os.loadavg()[0]!)
      if (i + 1 < PRE_START_SAMPLES) await sleep(LOAD_SAMPLE_MS)
    }
  }
  const started = new Date()
  const t0 = Date.now()
  const psChecks: PsCheck[] = [psCheck(process.pid, 'start', 0)]
  const loadSamples: LoadSample[] = [{ tMs: 0, load1: os.loadavg()[0]! }]
  let tick = 0
  const sampler = setInterval(() => {
    loadSamples.push({ tMs: Date.now() - t0, load1: os.loadavg()[0]! })
    if (++tick % PS_EVERY_SAMPLES === 0)
      psChecks.push(psCheck(process.pid, 'during', Date.now() - t0))
  }, LOAD_SAMPLE_MS)
  const runs: L0Run[] = []
  try {
    for (let rep = 1; rep <= reps; rep++) {
      const order = rep % 2 === 1 ? targets : [...targets].reverse()
      for (const target of order) {
        const home = path.join(tmp, `criterion-${rep}-${target.package}-${target.bench}`)
        const loadBefore = os.loadavg()
        const startedAt = new Date().toISOString()
        const r0 = Date.now()
        await cargoBench(target, wrapper, { ...env, CRITERION_HOME: home }, [], log)
        const results = readCriterionHome(home)
        if (results.length === 0) throw new Error(`${target.package}/${target.bench}: no results`)
        runs.push({
          rep,
          target,
          startedAt,
          wallMs: Date.now() - r0,
          loadBefore,
          loadAfter: os.loadavg(),
          results,
        })
        console.log(
          `rep ${rep} ${target.package}/${target.bench}: ${results.length} benches, ${((Date.now() - r0) / 1000).toFixed(1)} s, load ${loadBefore[0]!.toFixed(2)} → ${os.loadavg()[0]!.toFixed(2)}`,
        )
      }
    }
  } finally {
    clearInterval(sampler)
  }
  const ended = new Date()
  loadSamples.push({ tMs: Date.now() - t0, load1: os.loadavg()[0]! })
  psChecks.push(psCheck(process.pid, 'end', Date.now() - t0))
  const verdict = classifyConditions({
    quietHostConfirmed: values['quiet-host-confirmed'],
    psChecks,
    preStartLoad1,
    rowLoad1: loadSamples.map((s) => s.load1),
    maxConcurrency: 1,
    start: started,
    end: ended,
    binariesCanonical: true, // L0 uses the workspace bench profile by design (01 §6 M1 step 7)
    acPower: host.powerSource === null ? null : host.powerSource === 'AC Power',
    lowPowerMode: host.lowPowerMode,
    reps,
  })
  const markets = fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => /^(market|skip) /.test(l))
  const row: L0Row = {
    level: 'L0',
    generatedAt: new Date().toISOString(),
    host,
    commit,
    dirty,
    profile: 'bench',
    qos,
    effectiveQos: effectiveQos(wrapper).className,
    dataRoot,
    conditions: {
      label: verdict.label,
      reasons: verdict.reasons,
      psChecks,
      loadSamples,
      loadDuring: loadSummary(loadSamples),
      startedAtLocal: localStamp(started),
      endedAtLocal: localStamp(ended),
    },
    reps,
    targets,
    runs,
    summary: summarizeL0(runs),
    notes: [...new Set(markets)].slice(0, 40),
  }
  const file = appendRow(base, meta, row)
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`appended row ${file.rows.length} to ${base}.md and .json (${verdict.label})`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    const expected = e instanceof Error && ['UsageError', 'ReportFileError'].includes(e.name)
    console.error(expected ? `bench-l0: ${(e as Error).message}` : e)
    process.exit(1)
  },
)
