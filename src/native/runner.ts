/**
 * Protocol-v2 runner (20 §1-§5): native artifact download and verification
 * (one download per machine, one sha256 check per process; the WIP logic of
 * `fef5f199:src/strategy/artifacts/native.ts:46-84`), `describe` (20 §5.1)
 * and `run` (20 §5.4) under the process rules of 20 §2 (G6 environment, G8
 * EPIPE, G9 64 MiB stdout cap) and the exit codes of 20 §4. Protocol v1
 * (`<bin> --job`, `--profile`) is not supported (20 §1).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, mkdtempSync, promises as fs, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { StrategyArtifactRef } from '../strategy/artifacts/types.js'
import { SHA256_HEX_RE } from '../strategy/artifacts/types.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { contractSha256 } from './contract/canonicalJson.js'
import type { EngineJob, EngineResult, ErrorClass, TraceLevel } from './contract/generated.js'
import { classOfExitCode, exitCodesOfClass, NativeError, oneLine } from './errors.js'
import { CONTRACT_DIR, REPO_ROOT } from './modelConfig.js'
import { validateEngineResult } from './result.js'

/** The only protocol this runner speaks (20 §1). */
export const NATIVE_PROTOCOL_VERSION = 2

/** `EngineJob` / `EngineResult` versions this TS side builds and reads (20 §3, 21 §3). */
export const TS_JOB_SCHEMA_VERSIONS: readonly number[] = [1]
export const TS_OUTPUT_SCHEMA_VERSIONS: readonly number[] = [1]

/** G9: one stdout document is at most 64 MiB. */
export const MAX_STDOUT_BYTES = 64 * 1024 * 1024

/** R2 prefix and machine-local cache layout of native binaries (identity = sha256 of the bytes, 20 §1). */
export const NATIVE_ARTIFACT_R2_PREFIX = 'strategy-artifacts/native'

export function nativeArtifactR2Key(sha256: string): string {
  return `${NATIVE_ARTIFACT_R2_PREFIX}/${sha256}`
}

/** `data/strategy-artifacts/native/<sha256>` under the artifact cache root (01 §6 M1 step 5). */
export function nativeArtifactCachePath(sha256: string, cacheRoot: string): string {
  return path.join(cacheRoot, 'native', sha256)
}

/**
 * The artifact reference of a native job (21 §4 `strategyArtifact`).
 */
// D-PENDING: 21 §4 and 31 §8 need `kind: 'native'` and `target` on StrategyArtifactRef (src/strategy/artifacts/types.ts, another stream); chose a local extension type until that file carries them.
export type NativeArtifactRef = StrategyArtifactRef & { kind: 'native'; target: string }

export interface EnsureArtifactOptions {
  /** Artifact cache root; default `artifactCacheDir()` (`data/strategy-artifacts`). */
  cacheRoot?: string
  /** R2 download (tests); default `downloadR2ToLocal`. */
  download?: (r2Url: string, absPath: string) => Promise<void>
}

const verifiedBinaries = new Map<string, Promise<string>>()

/**
 * Download (once per machine) and sha256-verify (once per process) a native
 * binary; returns its executable path. Memoized per sha; a rejected load is
 * evicted so a retry starts fresh (WIP `native.ts:46-56`). A cached copy
 * that fails the hash is deleted and downloaded once more; a freshly
 * downloaded copy that fails is `data_defect: integrity_mismatch` (the R2
 * object is wrong, 40 §6.1 item 3).
 */
export function ensureNativeArtifact(
  ref: StrategyArtifactRef,
  opts: EnsureArtifactOptions = {},
): Promise<string> {
  const existing = verifiedBinaries.get(ref.sha256)
  if (existing) return existing
  const promise = loadNativeArtifact(ref, opts)
  verifiedBinaries.set(ref.sha256, promise)
  promise.catch(() => verifiedBinaries.delete(ref.sha256))
  return promise
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function loadNativeArtifact(
  ref: StrategyArtifactRef,
  opts: EnsureArtifactOptions,
): Promise<string> {
  if (!SHA256_HEX_RE.test(ref.sha256)) {
    throw new NativeError(
      'invalid_input',
      'artifact_incompatible',
      `invalid artifact sha256 ${JSON.stringify(ref.sha256)}`,
    )
  }
  const cacheRoot =
    opts.cacheRoot ?? (await import('../strategy/artifacts/loader.js')).artifactCacheDir()
  const download =
    opts.download ??
    (async (url: string, to: string) => {
      const { downloadR2ToLocal } = await import('../telonex/fetchConvertedToLocal.js')
      await downloadR2ToLocal(url, to)
    })
  const binPath = nativeArtifactCachePath(ref.sha256, cacheRoot)
  const fetch = async (): Promise<void> => {
    try {
      await download(ref.r2Url, binPath)
    } catch (err) {
      throw new NativeError(
        'runtime',
        'r2_download',
        `native artifact ${ref.sha256.slice(0, 12)} download failed: ${(err as Error).message} (${ref.r2Url})`,
      )
    }
  }
  let fresh = false
  if (!(await exists(binPath))) {
    await fetch()
    fresh = true
  }
  let actual = await sha256OfFile(binPath)
  if (actual !== ref.sha256 && !fresh) {
    await fs.unlink(binPath).catch(() => {})
    await fetch()
    fresh = true
    actual = await sha256OfFile(binPath)
  }
  if (actual !== ref.sha256) {
    await fs.unlink(binPath).catch(() => {})
    throw new NativeError(
      'data_defect',
      'integrity_mismatch',
      `native artifact hash mismatch for ${binPath} (${ref.r2Url}): expected ${ref.sha256}, got ${actual}`,
    )
  }
  await fs.chmod(binPath, 0o755)
  return binPath
}

/**
 * G6: the binary runs with exactly this environment; nothing else is
 * inherited (no credentials, no `BACKTEST_*`, no `BOT_ENV`).
 */
export function nativeChildEnv(pmbLog?: string): Record<string, string> {
  return {
    TZ: 'UTC',
    LANG: 'C',
    RUST_BACKTRACE: '1',
    ...(pmbLog === undefined ? {} : { PMB_LOG: pmbLog }),
  }
}

let processWorkDir: string | null = null
/** G6: cwd is a per-process temp directory. */
function workDir(): string {
  processWorkDir ??= mkdtempSync(path.join(os.tmpdir(), 'pmb-native-'))
  return processWorkDir
}

interface ExecResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stdoutOverflow: boolean
  stderrTail: string
  timedOut: boolean
}

function execBinary(
  binPath: string,
  args: string[],
  opts: { log?: (line: string) => void; pmbLog?: string; killAfterMs?: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      cwd: workDir(),
      env: nativeChildEnv(opts.pmbLog),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    let outBytes = 0
    let overflow = false
    let tail = ''
    let pending = ''
    let timedOut = false
    const timer =
      opts.killAfterMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, opts.killAfterMs)
    child.stdout.on('data', (b: Buffer) => {
      if (overflow) return
      outBytes += b.length
      if (outBytes > MAX_STDOUT_BYTES) {
        overflow = true
        out.length = 0
        child.kill('SIGKILL')
        return
      }
      out.push(b)
    })
    // A decoding stream, so a UTF-8 sequence split across chunks stays intact.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (s: string) => {
      tail = (tail + s).slice(-4000)
      if (!opts.log) return
      pending += s
      let nl: number
      while ((nl = pending.indexOf('\n')) >= 0) {
        opts.log(pending.slice(0, nl))
        pending = pending.slice(nl + 1)
      }
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(new NativeError('runtime', 'io', `spawn ${binPath}: ${err.message}`))
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      if (opts.log && pending) opts.log(pending)
      resolve({
        code,
        signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stdoutOverflow: overflow,
        stderrTail: tail,
        timedOut,
      })
    })
  })
}

/** The last stderr line: the binary's one-line human reason on a non-zero exit (20 §4). */
function lastStderrLine(tail: string): string {
  const lines = tail.split('\n').filter((l) => l.trim() !== '')
  return oneLine(lines[lines.length - 1] ?? '(no stderr)')
}

/**
 * Classifies an exit that produced no usable stdout document (20 §4): a
 * signal is `killed: signal`, a known exit code its class, anything else
 * `engine_fault: panic`.
 */
function exitFailure(r: ExecResult, what: string): NativeError {
  if (r.timedOut) {
    return new NativeError(
      'killed',
      'backstop_timeout',
      `${what}: killed by the shim backstop (40 §8.2)`,
    )
  }
  if (r.stdoutOverflow) {
    return new NativeError(
      'invalid_output',
      'line_too_large',
      `${what}: stdout exceeded ${MAX_STDOUT_BYTES} bytes (20 G9)`,
    )
  }
  if (r.signal !== null) {
    return new NativeError(
      'killed',
      'signal',
      `${what}: executor died by ${r.signal}: ${lastStderrLine(r.stderrTail)}`,
    )
  }
  const cls: ErrorClass = (r.code !== null ? classOfExitCode(r.code) : null) ?? 'engine_fault'
  const cause =
    cls === 'engine_fault' ? 'panic' : cls === 'invalid_output' ? 'schema' : 'unclassified'
  return new NativeError(
    cls,
    cause,
    `${what}: exit ${String(r.code)} without a result document: ${lastStderrLine(r.stderrTail)}`,
  )
}

/** One `describe` per-params entry (20 §5.1). */
export type DescribeParamsResult =
  | { ok: true; params: Record<string, unknown>; requiredFeeds: ExternalFeedsRequestConfig | null }
  | { ok: false; errors: Array<{ path: string; message: string }> }

/**
 * The `describe` document (20 §5.1), as far as TS reads it.
 */
// D-PENDING: the v1 schema bundle (20 §5.2) has no describe schema, so 21 §3's "no hand-written types" cannot apply to it yet; chose a minimal hand-written type of the fields TS reads, checked structurally at runtime (R14).
export interface NativeDescribe {
  type: 'describe'
  protocolVersion: number
  binary: {
    engineVersion: string
    engineCommit: string
    engineDirty: boolean
    sdkVersion: string
    rustc: string
    target: string
    buildProfile: string
    contractSha256: string
  }
  capabilities: {
    subcommands: string[]
    inputModes: string[]
    profiles: string[]
    jobSchemaVersions: number[]
    outputSchemaVersions: number[]
    modelConfigVersions: number[]
    rulesTables: Array<{ version: string }>
    features: string[]
    traceFormat: string
    ledgerFormat: string
    journalFormat: string
    maxCandidates: number
    realOrders: boolean
  }
  engineConstants?: Record<string, unknown>
  strategy: {
    id: string
    paramsSchema: unknown
    results: DescribeParamsResult[]
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

let bundleSha: string | null = null
/** `contractSha256` of the checked-in v1 bundle (21 §3), computed once per process. */
export function checkedInContractSha256(
  dir: string = path.join(CONTRACT_DIR, 'schema', 'v1'),
): string {
  if (dir === path.join(CONTRACT_DIR, 'schema', 'v1') && bundleSha !== null) return bundleSha
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((name) => ({
      name,
      schema: JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as unknown,
    }))
  const sha = contractSha256(files)
  if (dir === path.join(CONTRACT_DIR, 'schema', 'v1')) bundleSha = sha
  return sha
}

/**
 * The compatibility checks TS makes on every `describe` before any use
 * (20 §1, §3): protocol 2, a standard (`realOrders: false`) build, the
 * checked-in contract, a job and output schema version TS supports, and
 * optionally the expected target triple. Returns the problems.
 */
export function describeProblems(
  doc: NativeDescribe,
  expected: { contractSha256: string; target?: string; buildProfile?: string },
): string[] {
  const problems: string[] = []
  if (doc.protocolVersion !== NATIVE_PROTOCOL_VERSION) {
    problems.push(
      `protocolVersion ${doc.protocolVersion}; TS speaks only ${NATIVE_PROTOCOL_VERSION} (20 §1)`,
    )
  }
  if (doc.capabilities.realOrders !== false) {
    problems.push(
      'realOrders is true: workers and the producer refuse the real-orders variant (20 §1)',
    )
  }
  if (doc.binary.contractSha256 !== expected.contractSha256) {
    problems.push(
      `contractSha256 ${doc.binary.contractSha256} != checked-in ${expected.contractSha256} (21 §3)`,
    )
  }
  if (!doc.capabilities.jobSchemaVersions.some((v) => TS_JOB_SCHEMA_VERSIONS.includes(v))) {
    problems.push(
      `no common jobSchemaVersion in ${JSON.stringify(doc.capabilities.jobSchemaVersions)}`,
    )
  }
  if (!doc.capabilities.outputSchemaVersions.some((v) => TS_OUTPUT_SCHEMA_VERSIONS.includes(v))) {
    problems.push(
      `no common outputSchemaVersion in ${JSON.stringify(doc.capabilities.outputSchemaVersions)}`,
    )
  }
  if (expected.buildProfile !== undefined && doc.binary.buildProfile !== expected.buildProfile) {
    problems.push(
      `buildProfile ${doc.binary.buildProfile} != ${expected.buildProfile} (31 §8 step 3)`,
    )
  }
  if (expected.target !== undefined && doc.binary.target !== expected.target) {
    problems.push(`target ${doc.binary.target} != ${expected.target} (D12)`)
  }
  return problems
}

function parseDescribe(text: string): NativeDescribe {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new NativeError(
      'invalid_output',
      'schema',
      'describe stdout is not one JSON document (20 G1)',
    )
  }
  const ok =
    isRecord(doc) &&
    doc.type === 'describe' &&
    typeof doc.protocolVersion === 'number' &&
    isRecord(doc.binary) &&
    typeof doc.binary.contractSha256 === 'string' &&
    typeof doc.binary.engineVersion === 'string' &&
    typeof doc.binary.target === 'string' &&
    isRecord(doc.capabilities) &&
    Array.isArray(doc.capabilities.jobSchemaVersions) &&
    Array.isArray(doc.capabilities.outputSchemaVersions) &&
    typeof doc.capabilities.realOrders === 'boolean' &&
    isRecord(doc.strategy) &&
    typeof doc.strategy.id === 'string' &&
    Array.isArray(doc.strategy.results)
  if (!ok) {
    // A v1 binary prints a different shape; the version check below needs the field.
    if (
      isRecord(doc) &&
      typeof doc.protocolVersion === 'number' &&
      doc.protocolVersion !== NATIVE_PROTOCOL_VERSION
    ) {
      throw new NativeError(
        'invalid_input',
        'version',
        `binary speaks protocol ${doc.protocolVersion}; TS speaks only ${NATIVE_PROTOCOL_VERSION} (20 §1)`,
      )
    }
    throw new NativeError('invalid_output', 'schema', 'describe output lacks the 20 §5.1 fields')
  }
  return doc as unknown as NativeDescribe
}

export interface DescribeOptions {
  /** `--params '<json>'`: one param set; an invalid set exits 2 (20 §5.1). */
  params?: Record<string, unknown>
  /** `--params-file`: one result per element; per-element errors exit 0. */
  paramsList?: Array<Record<string, unknown>>
  /** Expected target triple (worker gate, D12). */
  target?: string
  /** Required build profile, e.g. `artifact` for the producer (31 §8 step 3). */
  buildProfile?: string
  /** Checked-in contract sha; default the v1 bundle of this checkout. */
  contractSha256?: string
}

/**
 * `<bin> describe [--params …] [--params-file …]` (20 §5.1), followed by the
 * 20 §1/§3 compatibility checks. An incompatible binary is
 * `invalid_input: artifact_incompatible` (or `version`); invalid params with
 * `--params` are `invalid_input: params` carrying the binary's messages.
 */
export async function describeNative(
  binPath: string,
  opts: DescribeOptions = {},
): Promise<NativeDescribe> {
  if (opts.params !== undefined && opts.paramsList !== undefined) {
    throw new Error('describeNative: --params and --params-file are exclusive')
  }
  const args = ['describe']
  let paramsFile: string | null = null
  if (opts.params !== undefined) args.push('--params', JSON.stringify(opts.params))
  if (opts.paramsList !== undefined) {
    paramsFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pmb-describe-')), 'params.json')
    await fs.writeFile(paramsFile, JSON.stringify(opts.paramsList))
    args.push('--params-file', paramsFile)
  }
  let r: ExecResult
  try {
    r = await execBinary(binPath, args, {})
  } finally {
    if (paramsFile !== null) await fs.rm(path.dirname(paramsFile), { recursive: true, force: true })
  }
  if (r.signal !== null || r.stdoutOverflow || r.stdout.trim() === '')
    throw exitFailure(r, 'describe')
  const doc = parseDescribe(r.stdout)
  const problems = describeProblems(doc, {
    contractSha256: opts.contractSha256 ?? checkedInContractSha256(),
    ...(opts.target === undefined ? {} : { target: opts.target }),
    ...(opts.buildProfile === undefined ? {} : { buildProfile: opts.buildProfile }),
  })
  if (problems.length > 0) {
    const versionOnly = doc.protocolVersion !== NATIVE_PROTOCOL_VERSION
    throw new NativeError(
      'invalid_input',
      versionOnly ? 'version' : 'artifact_incompatible',
      problems.join('; '),
    )
  }
  if (r.code !== 0) {
    const first = doc.strategy.results.find(
      (x): x is Extract<DescribeParamsResult, { ok: false }> => !x.ok,
    )
    const detail = first
      ? first.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
      : lastStderrLine(r.stderrTail)
    throw new NativeError(
      classOfExitCode(r.code ?? 1) ?? 'invalid_input',
      'params',
      `describe rejected the params: ${detail}`,
    )
  }
  return doc
}

const describeCache = new Map<string, Promise<NativeDescribe>>()

/**
 * `describeNative` cached per process by (binary path, canonical options)
 * (31 §8 step 5); a rejected call is evicted.
 */
export function describeNativeCached(
  binPath: string,
  opts: DescribeOptions = {},
): Promise<NativeDescribe> {
  const key = `${binPath}\u0000${JSON.stringify(sortedKeys(opts))}`
  const hit = describeCache.get(key)
  if (hit) return hit
  const p = describeNative(binPath, opts)
  describeCache.set(key, p)
  p.catch(() => describeCache.delete(key))
  return p
}

function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys)
  if (!isRecord(v)) return v
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, sortedKeys(v[k])]),
  )
}

export interface RunNativeJobOptions {
  /** `engineVersion` recorded at submission (21 §12 echo assertion), e.g. from `describe`. */
  engineVersion: string
  /** `--trace`, `--trace-level`, `--ledger`: override `job.outputs` (20 §5.4). */
  tracePath?: string
  traceLevel?: TraceLevel
  ledgerPath?: string
  /** `--stack-mb` (G11) and `--tape-dir` (16 §7.5). */
  stackMb?: number
  tapeDir?: string
  /** Directory for the job file; default the per-process work dir. */
  jobDir?: string
  /** stderr NDJSON lines (G1). */
  log?: (line: string) => void
  /** `PMB_LOG` verbosity (G2, G6). */
  pmbLog?: string
}

export interface NativeRunOutcome {
  /** The validated result (21 §19); `status` may be `error`. */
  result: EngineResult
  exitCode: number
  /** Shim wall clock at spawn and exit (21 §12). */
  startedAtMs: number
  finishedAtMs: number
}

/** `run` arguments (20 §5.4). */
export function runArgs(
  jobFile: string,
  opts: Omit<RunNativeJobOptions, 'engineVersion'>,
): string[] {
  const args = ['run', '--job', jobFile]
  if (opts.tracePath !== undefined) args.push('--trace', opts.tracePath)
  if (opts.traceLevel !== undefined) args.push('--trace-level', opts.traceLevel)
  if (opts.ledgerPath !== undefined) args.push('--ledger', opts.ledgerPath)
  if (opts.stackMb !== undefined) args.push('--stack-mb', String(opts.stackMb))
  if (opts.tapeDir !== undefined) args.push('--tape-dir', opts.tapeDir)
  return args
}

/**
 * The exit code a single-candidate `run` result implies (20 §4, §5.4): 0
 * when the result and its candidate are ok, else the codes of the error
 * class.
 */
export function expectedExitCodes(result: EngineResult): number[] {
  if (result.status === 'error') return result.error ? exitCodesOfClass(result.error.class) : []
  const failed = result.candidates.find((c) => c.status === 'error')
  if (failed === undefined) return [0]
  return failed.error ? exitCodesOfClass(failed.error.class) : []
}

/**
 * Runs one single-candidate `EngineJob` with `<bin> run --job <file>` (20
 * §5.4) and returns the validated result. The job file is written
 * atomically and removed afterwards. The shim backstop kills the process at
 * `2 × budget.wallMs + 30 s` (40 §8.2 item 2). A result whose status
 * disagrees with the exit code is `invalid_output` (20 §5.4).
 */
export async function runNativeJob(
  binPath: string,
  job: EngineJob,
  opts: RunNativeJobOptions,
): Promise<NativeRunOutcome> {
  if (job.run.candidates.length !== 1) {
    throw new NativeError(
      'invalid_input',
      'params',
      `run takes exactly one candidate, got ${job.run.candidates.length} (20 §5.4)`,
    )
  }
  const dir = opts.jobDir ?? workDir()
  await fs.mkdir(dir, { recursive: true })
  const base = `${job.market.slug}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const jobFile = path.join(dir, `${base}.engine-job.json`)
  await fs.writeFile(`${jobFile}.tmp`, JSON.stringify(job))
  await fs.rename(`${jobFile}.tmp`, jobFile)
  const startedAtMs = Date.now()
  let r: ExecResult
  try {
    r = await execBinary(binPath, runArgs(jobFile, opts), {
      ...(opts.log === undefined ? {} : { log: opts.log }),
      ...(opts.pmbLog === undefined ? {} : { pmbLog: opts.pmbLog }),
      killAfterMs: 2 * job.budget.wallMs + 30_000,
    })
  } finally {
    await fs.rm(jobFile, { force: true })
  }
  const finishedAtMs = Date.now()
  if (r.signal !== null || r.stdoutOverflow || r.timedOut)
    throw exitFailure(r, `run ${job.market.slug}`)
  let raw: unknown
  try {
    raw = JSON.parse(r.stdout)
  } catch {
    if (r.code !== 0) throw exitFailure(r, `run ${job.market.slug}`)
    throw new NativeError(
      'invalid_output',
      'schema',
      `run ${job.market.slug}: stdout is not one JSON document (20 G1)`,
    )
  }
  const result = validateEngineResult(job, raw, { engineVersion: opts.engineVersion })
  const exitCode = r.code ?? -1
  if (!expectedExitCodes(result).includes(exitCode)) {
    throw new NativeError(
      'invalid_output',
      'schema',
      `run ${job.market.slug}: exit ${exitCode} disagrees with the result status (20 §5.4, expected ${JSON.stringify(expectedExitCodes(result))})`,
    )
  }
  return { result, exitCode, startedAtMs, finishedAtMs }
}

/** For tests: forget the per-process artifact memo. */
export function resetNativeArtifactMemo(): void {
  verifiedBinaries.clear()
}

/** Repository root, re-exported for CLIs. */
export { REPO_ROOT }
