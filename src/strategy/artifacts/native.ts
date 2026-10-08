import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { downloadR2ToLocal } from '../../telonex/fetchConvertedToLocal.js'
import { fileExists } from '../../utils/fs.js'
import { sha256OfFile } from '../../utils/hash.js'
import type { ExternalFeedsRequestConfig } from '../plugins/ExternalFeedsRequestPlugin.js'
import {
  ArtifactDownloadError,
  ArtifactIntegrityError,
  ArtifactShapeError,
  artifactCacheDir,
} from './loader.js'
import { SHA256_HEX_RE, type StrategyArtifactRef } from './types.js'

/**
 * Native (Rust) strategy artifacts: one self-contained executable per
 * strategy build (engine + strategy), identity = sha256 of the binary.
 * Contract: native/BINARY-PROTOCOL.md. Workers spawn one process per market
 * job (or per candidate group); the whole replay runs inside Rust.
 */

export const NATIVE_ARTIFACT_PROTOCOL_VERSION = 1
export const NATIVE_ARTIFACT_R2_PREFIX = 'strategy-artifacts/native'

export function nativeArtifactR2Key(sha256: string): string {
  return `${NATIVE_ARTIFACT_R2_PREFIX}/${sha256}`
}

export function nativeArtifactCachePath(sha256: string): string {
  return path.join(artifactCacheDir(), 'native', sha256)
}

export function isNativeArtifactRef(ref: StrategyArtifactRef | undefined): boolean {
  return ref?.kind === 'native'
}

/** Thrown for exit code 2: deterministic bad input (params/job) — never retry. */
export class NativeInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativeInputError'
  }
}

const verifiedBinaries = new Map<string, Promise<string>>()

/** Download (once per machine) + hash-verify (once per process); returns the executable path. */
export function ensureNativeArtifact(ref: StrategyArtifactRef): Promise<string> {
  const existing = verifiedBinaries.get(ref.sha256)
  if (existing) return existing
  const promise = loadNativeArtifact(ref)
  verifiedBinaries.set(ref.sha256, promise)
  promise.catch(() => verifiedBinaries.delete(ref.sha256))
  return promise
}

async function loadNativeArtifact(ref: StrategyArtifactRef): Promise<string> {
  if (!SHA256_HEX_RE.test(ref.sha256)) {
    throw new ArtifactShapeError(`[artifact] invalid sha256 ${JSON.stringify(ref.sha256)}`)
  }
  const binPath = nativeArtifactCachePath(ref.sha256)
  if (!(await fileExists(binPath))) {
    try {
      await downloadR2ToLocal(ref.r2Url, binPath)
    } catch (err) {
      throw new ArtifactDownloadError(
        `[artifact] native ${ref.sha256.slice(0, 12)} download failed: ${err instanceof Error ? err.message : String(err)} (${ref.r2Url})`,
        { cause: err },
      )
    }
  }
  const actual = await sha256OfFile(binPath)
  if (actual !== ref.sha256) {
    await fs.unlink(binPath).catch(() => {})
    throw new ArtifactIntegrityError({
      expected: ref.sha256,
      actual,
      source: `${binPath} (${ref.r2Url})`,
    })
  }
  await fs.chmod(binPath, 0o755)
  return binPath
}

type ExecResult = { code: number; stdout: string; stderr: string }

function execBinary(
  binPath: string,
  args: string[],
  stdin: string | null,
  onStderrLine?: (line: string) => void,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    let pending = ''
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => {
      const s = b.toString('utf8')
      err += s
      if (!onStderrLine) return
      pending += s
      let nl: number
      while ((nl = pending.indexOf('\n')) >= 0) {
        onStderrLine(pending.slice(0, nl))
        pending = pending.slice(nl + 1)
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (onStderrLine && pending) onStderrLine(pending)
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: err })
    })
    if (stdin !== null) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

function failure(binPath: string, cmd: string, r: ExecResult): Error {
  const msg = `[native] ${path.basename(binPath).slice(0, 12)} ${cmd} exited ${r.code}: ${r.stderr.trim().split('\n').slice(-5).join(' | ')}`
  return r.code === 2 ? new NativeInputError(msg) : new Error(msg)
}

export type NativeDescribe = {
  protocolVersion: number
  id: string
  engineVersion: string
  params: Record<string, unknown>
  requiredFeeds: ExternalFeedsRequestConfig | null
}

/** Validate params and read the strategy's identity + feed requirements. */
export async function describeNative(
  binPath: string,
  params: Record<string, unknown>,
): Promise<NativeDescribe> {
  const r = await execBinary(binPath, ['describe', '--params', JSON.stringify(params)], null)
  if (r.code !== 0) throw failure(binPath, 'describe', r)
  const parsed = JSON.parse(r.stdout) as NativeDescribe
  if (parsed.protocolVersion !== NATIVE_ARTIFACT_PROTOCOL_VERSION) {
    throw new ArtifactShapeError(
      `[native] protocol version ${parsed.protocolVersion}, this engine supports ${NATIVE_ARTIFACT_PROTOCOL_VERSION} — rebuild the strategy`,
    )
  }
  return parsed
}

/** Run one market job (MarketJobData JSON) and return RunSingleMarketOutput. */
export async function runNativeJob<TJob, TResult>(
  binPath: string,
  job: TJob,
  opts?: { profile?: 'ts-compat' | 'realistic'; log?: (line: string) => void },
): Promise<TResult> {
  const args = ['run', '--job', '-']
  if (opts?.profile) args.push('--profile', opts.profile)
  const r = await execBinary(binPath, args, JSON.stringify(job), opts?.log ?? ((l) => console.log(l)))
  if (r.code !== 0) throw failure(binPath, 'run', r)
  return JSON.parse(r.stdout) as TResult
}

/** Shared candidate replay: same market, N param sets, one read. Results in input order. */
export async function runNativeGroup<TJob, TResult>(
  binPath: string,
  jobs: TJob[],
  opts?: { profile?: 'ts-compat' | 'realistic'; log?: (line: string) => void },
): Promise<TResult[]> {
  const args = ['run-group', '--jobs', '-']
  if (opts?.profile) args.push('--profile', opts.profile)
  const r = await execBinary(binPath, args, JSON.stringify(jobs), opts?.log ?? ((l) => console.log(l)))
  if (r.code !== 0) throw failure(binPath, 'run-group', r)
  return JSON.parse(r.stdout) as TResult[]
}
