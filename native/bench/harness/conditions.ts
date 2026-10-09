// Benchmark conditions and the `non-idle` label (16 §13.5).
//
// A row is `idle` only when every quiet-host condition holds over the whole
// row: the operator confirms the fleet worker and Global Runtime are paused;
// no other backtest, build, test, parity run or fleet process is seen by the
// `ps` checks at the start, during and at the end of the row; the 1-minute
// load average stayed < 1.0 for the 60 s before the start and below the
// in-row limit during it; the row starts and ends inside the 01:00–07:00
// window; the host is on AC power with Low Power Mode off; every binary is
// canonical (01 §6); and the protocol's 3 repetitions ran. Any other row is
// `non-idle`: its numbers serve only as interleaved before/after pairs within
// one sitting, never as regression or gate evidence.

export type ConditionLabel = 'idle' | 'non-idle'

/** Kinds of other work that make a row `non-idle` (16 §13.5 "Quiet host"). */
export type WorkKind =
  | 'fleet-worker'
  | 'global-runtime'
  | 'backtest'
  | 'parity'
  | 'bench'
  | 'build'
  | 'test'
  | 'trading-bot'

export interface PsRow {
  pid: number
  ppid: number
  /** Full command line (`ps -o args=`). */
  args: string
}

export interface OtherWork {
  pid: number
  kind: WorkKind
  /** Command line, truncated for the report. */
  args: string
  /** Working directory (`lsof -d cwd`), when it could be read. */
  cwd: string | null
}

/** One `ps` check of the row (start, during, end). */
export interface PsCheck {
  /** ms since the row started (negative: before it). */
  tMs: number
  phase: 'start' | 'during' | 'end'
  work: OtherWork[]
}

export interface ConditionInputs {
  /** `--quiet-host-confirmed`: fleet worker drained and Global Runtime paused. */
  quietHostConfirmed: boolean
  /** Every `ps` check of the row. */
  psChecks: readonly PsCheck[]
  /** 1-minute load averages sampled over the 60 s before start (empty: not sampled). */
  preStartLoad1: readonly number[]
  /** 1-minute load averages sampled during the row. */
  rowLoad1: readonly number[]
  /** Largest number of concurrent `run` processes of any arm (its own load). */
  maxConcurrency: number
  /** Local start and end of the row (first warm-up start, last repetition end). */
  start: Date
  end: Date
  binariesCanonical: boolean
  /** true on AC power; null when unknown. */
  acPower: boolean | null
  /** true when Low Power Mode is on; null when unknown. */
  lowPowerMode: boolean | null
  /** Measured repetitions per arm. */
  reps: number
}

export interface ConditionVerdict {
  label: ConditionLabel
  /** Why the row is `non-idle` (empty when idle). */
  reasons: string[]
}

export const PRE_START_SAMPLES = 13 // every 5 s over 60 s, both ends included
export const QUIET_LOAD1 = 1.0
export const WINDOW_START_HOUR = 1
export const WINDOW_END_HOUR = 7
export const PROTOCOL_REPS = 3

/**
 * In-row load limit: the row's own `T` runnable processes plus the quiet
 * margin. D-PENDING: 16 §13.5 says the load "is recorded during the run" but
 * states no in-row limit; `T + 1.0` is the simplest limit consistent with the
 * pre-start one (anything above it is someone else's work).
 */
export function rowLoadLimit(maxConcurrency: number): number {
  return maxConcurrency + QUIET_LOAD1
}

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function classifyConditions(c: ConditionInputs): ConditionVerdict {
  const reasons: string[] = []
  if (!c.quietHostConfirmed) {
    reasons.push('quiet host not confirmed (fleet worker and Global Runtime not paused)')
  }
  const seen = new Map<number, OtherWork>()
  for (const check of c.psChecks) for (const w of check.work) seen.set(w.pid, w)
  if (seen.size > 0) {
    const byKind = new Map<WorkKind, number>()
    for (const w of seen.values()) byKind.set(w.kind, (byKind.get(w.kind) ?? 0) + 1)
    const phases = [...new Set(c.psChecks.filter((x) => x.work.length > 0).map((x) => x.phase))]
    reasons.push(
      `other work seen by ps (${phases.join(', ')}): ` +
        [...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(', '),
    )
  }
  if (c.psChecks.length === 0) reasons.push('no ps check recorded')
  if (c.preStartLoad1.length < PRE_START_SAMPLES) {
    reasons.push('no 60 s pre-start load sampling')
  } else {
    const max = Math.max(...c.preStartLoad1)
    if (!(max < QUIET_LOAD1)) {
      reasons.push(
        `1-minute load average reached ${max.toFixed(2)} before start (needs < ${QUIET_LOAD1})`,
      )
    }
  }
  if (c.rowLoad1.length === 0) {
    reasons.push('no load sampling during the row')
  } else {
    const max = Math.max(...c.rowLoad1)
    const limit = rowLoadLimit(c.maxConcurrency)
    if (!(max < limit)) {
      reasons.push(
        `1-minute load average reached ${max.toFixed(2)} during the row (limit T + ${QUIET_LOAD1} = ${limit.toFixed(2)})`,
      )
    }
  }
  const startH = c.start.getHours()
  if (!(startH >= WINDOW_START_HOUR && startH < WINDOW_END_HOUR)) {
    reasons.push(`started at ${hhmm(c.start)}, outside the 01:00-07:00 benchmark window`)
  } else {
    const endH = c.end.getHours()
    if (!sameLocalDay(c.start, c.end) || endH >= WINDOW_END_HOUR) {
      reasons.push(
        `ended at ${hhmm(c.end)}, after the 07:00 end of the window (the fleet resume of 01 §8.1 H5)`,
      )
    }
  }
  if (!c.binariesCanonical) reasons.push('non-canonical binary (not a canonical artifact build)')
  if (c.acPower !== true)
    reasons.push(c.acPower === null ? 'power source unknown' : 'not on AC power')
  if (c.lowPowerMode !== false) {
    reasons.push(c.lowPowerMode === null ? 'Low Power Mode state unknown' : 'Low Power Mode on')
  }
  if (c.reps < PROTOCOL_REPS) {
    reasons.push(`${c.reps} repetition(s) per arm (16 §13.5 needs ${PROTOCOL_REPS}; off-protocol)`)
  }
  return { label: reasons.length === 0 ? 'idle' : 'non-idle', reasons }
}

/** Parses `ps -Ao pid=,ppid=,args=` output. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*([0-9]+)\s+([0-9]+)\s+(.*?)\s*$/.exec(line)
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] })
  }
  return rows
}

/**
 * The driver's own process tree: itself, its ancestors (the npm/tsx
 * launchers) and every descendant (esbuild service, `time`, `run`). These
 * are never "other work", whatever paths their command lines contain (the
 * native clone's `node_modules` is a symlink into the fleet copy, 01 §8.1 H2).
 */
export function ownTree(rows: readonly PsRow[], selfPid: number): Set<number> {
  const parent = new Map<number, number>()
  const children = new Map<number, number[]>()
  for (const r of rows) {
    parent.set(r.pid, r.ppid)
    const list = children.get(r.ppid) ?? []
    list.push(r.pid)
    children.set(r.ppid, list)
  }
  const out = new Set<number>([selfPid])
  for (let p = parent.get(selfPid); p !== undefined && p > 1 && !out.has(p); p = parent.get(p)) {
    out.add(p)
  }
  const stack = [selfPid]
  while (stack.length > 0) {
    const p = stack.pop()!
    for (const c of children.get(p) ?? []) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  return out
}

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const NODE_EXES = new Set(['node', 'tsx', 'bun', 'deno'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
/** node flags that take the next token as their value. */
const NODE_VALUE_FLAGS = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
])
const BUILD_EXES = new Set([
  'cargo',
  'rustc',
  'clippy-driver',
  'rustdoc',
  'cc',
  'clang',
  'ld',
  'ld64',
  'tsc',
])
/** Cargo test, bench and doctest binaries: `target/<profile>/deps/<name>-<16 hex>`. */
const CARGO_TEST_BINARY = /\/target\/(?:[^/\s]+\/)*deps\/[A-Za-z0-9_]+-[0-9a-f]{16}$/
const CARGO_BUILD_SCRIPT = /\/target\/(?:[^/\s]+\/)*build\/[^/\s]+\/build-script-[A-Za-z0-9_-]+$/

function classifyScript(script: string): WorkKind | null {
  if (/(^|\/)src\/cli\/backtestWorker\.ts$/.test(script)) return 'fleet-worker'
  if (/(^|\/)src\/cli\/global-runtime\.ts$/.test(script)) return 'global-runtime'
  if (/(^|\/)src\/cli\/backtest\.ts$/.test(script)) return 'backtest'
  if (/(^|\/)src\/cli\/trading-bot\.ts$/.test(script)) return 'trading-bot'
  if (/(^|\/)src\/cli\/parity\/|(^|\/)(ts-trace|run-parity)\.ts$/.test(script)) return 'parity'
  if (/(^|\/)scripts\/native\/bench-l[01]\.ts$/.test(script)) return 'bench'
  return null
}

function classifyNpmScript(name: string): WorkKind | null {
  if (/^worker:/.test(name)) return 'fleet-worker'
  if (/^(global-runtime|fleet:runtime)/.test(name)) return 'global-runtime'
  if (/^backtest/.test(name)) return 'backtest'
  if (/^trade:bot/.test(name)) return 'trading-bot'
  if (/parity/.test(name)) return 'parity'
  if (/^native:bench:l[01]$/.test(name)) return 'bench'
  if (name === 'test' || /:test$/.test(name)) return 'test'
  if (/^(lint|build|code:|native:(ci|verify):)|:build$/.test(name)) return 'build'
  return null
}

/**
 * Classifies one command line as other work, or null. Matching is on the
 * executable and the script it runs, never on a path substring, so the
 * fleet-copy paths that symlinked `node_modules` produce, a tmux server that
 * still names the worker command, or a shell whose `-c` text mentions a
 * script are not counted.
 */
export function classifyProcess(args: string): WorkKind | null {
  const tokens = args.split(/\s+/).filter((t) => t !== '')
  const exe = tokens[0]
  if (exe === undefined) return null
  const name = basename(exe)
  if (CARGO_TEST_BINARY.test(exe)) return 'test'
  if (CARGO_BUILD_SCRIPT.test(exe)) return 'build'
  if (name === 'cargo') {
    const sub = tokens.slice(1).find((t) => !t.startsWith('-') && !t.startsWith('+'))
    return sub === 'test' || sub === 'nextest' || sub === 'bench' ? 'test' : 'build'
  }
  if (name === 'cargo-nextest') return 'test'
  if (BUILD_EXES.has(name)) return 'build'
  if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
    const i = tokens.findIndex((t, k) => k > 0 && !t.startsWith('-'))
    const sub = i < 0 ? undefined : tokens[i]
    if (sub === 'test' || sub === 't') return 'test'
    if (sub === 'run' || sub === 'run-script') {
      const script = tokens.slice(i + 1).find((t) => !t.startsWith('-'))
      return script === undefined ? null : classifyNpmScript(script)
    }
    return null
  }
  if (SHELLS.has(name)) {
    const script = tokens.slice(1).find((t) => !t.startsWith('-'))
    if (script === undefined || tokens.slice(1).includes('-c')) return null
    if (basename(script) === 'run-worker.sh') return 'fleet-worker'
    if (/(^|\/)scripts\/native\/(ci|verify)-local\.sh$/.test(script)) return 'build'
    return null
  }
  if (NODE_EXES.has(name)) {
    for (let k = 1; k < tokens.length; k++) {
      const t = tokens[k]!
      if (NODE_VALUE_FLAGS.has(t)) {
        k++
        continue
      }
      if (t === '--test') return 'test'
      if (t.startsWith('-')) continue
      if (t.includes('/node_modules/')) {
        const bin = basename(t)
        if (bin === 'tsc' || bin === 'eslint' || bin === 'prettier' || bin === 'next')
          return 'build'
        if (bin === 'vitest' || bin === 'jest' || bin === 'mocha') return 'test'
        if (bin === 'npm-cli.js') return classifyProcess(['npm', ...tokens.slice(k + 1)].join(' '))
        continue // a launcher such as node_modules/.bin/tsx: the script follows
      }
      return classifyScript(t)
    }
    return null
  }
  return null
}

/** Other work in a `ps` snapshot, excluding the driver's own tree. */
export function findOtherWork(rows: readonly PsRow[], selfPid: number): OtherWork[] {
  const own = ownTree(rows, selfPid)
  const out: OtherWork[] = []
  for (const r of rows) {
    if (own.has(r.pid)) continue
    const kind = classifyProcess(r.args)
    if (kind !== null) out.push({ pid: r.pid, kind, args: r.args.slice(0, 240), cwd: null })
  }
  return out
}

/** Parses `lsof -a -d cwd -Fn -p <pids>` output into pid → cwd. */
export function parseLsofCwd(text: string): Map<number, string> {
  const out = new Map<number, string>()
  let pid: number | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) out.set(pid, line.slice(1))
  }
  return out
}

/** `ps -o time=` (`[[dd-]hh:]mm:ss.cc`) → ms of CPU time. */
export function parsePsCpuTime(text: string): number {
  const m = /^\s*(?:([0-9]+)-)?(?:([0-9]+):)?([0-9]+):([0-9]+(?:\.[0-9]+)?)\s*$/.exec(text)
  if (!m || m[3] === undefined || m[4] === undefined) {
    throw new Error(`unexpected ps cpu time ${JSON.stringify(text)}`)
  }
  const days = m[1] === undefined ? 0 : Number(m[1])
  const hours = m[2] === undefined ? 0 : Number(m[2])
  return Math.round(((days * 24 + hours) * 3600 + Number(m[3]) * 60 + Number(m[4])) * 1000)
}

/** Shared services whose CPU share 16 §13.5 records (they keep serving other hosts). */
export const SERVICE_NAMES = ['redis-server', 'mysqld'] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

/** pids of the shared services in a `ps -Ao pid=,ppid=,args=` snapshot. */
export function servicePids(rows: readonly PsRow[]): Array<{ pid: number; name: ServiceName }> {
  const out: Array<{ pid: number; name: ServiceName }> = []
  for (const r of rows) {
    const exe = basename(r.args.split(/\s+/)[0] ?? '')
    for (const n of SERVICE_NAMES) if (exe === n) out.push({ pid: r.pid, name: n })
  }
  return out
}
