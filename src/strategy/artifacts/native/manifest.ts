/**
 * Build manifest of a native artifact (31 §5.4) and the local cache layout
 * (31 §6.1). The manifest lets anyone recompute the source hash and replay
 * the build: the source-hash input with the full file list, the rendered
 * flags with host paths replaced by their remap targets, toolchain and git
 * provenance, the build wall time and the `describe` output.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  BUILD_MANIFEST_VERSION,
  NATIVE_ARTIFACT_FORMAT_VERSION,
  NATIVE_TARGET,
  type BuildProfile,
} from './policy.js'
import { computeSourceHash, sha256Hex, type SourceHashInput } from './sourceHash.js'

export type ToolchainProvenance = {
  rustc: string
  cargo: string
  macosSdk: string
  ld: string
  cc: string
  clt: string
  host: string
}

export type GitProvenance = {
  strategy: { repo: string; commit: string; dirty: boolean; allowDirty: boolean }
  engine: { commit: string; dirty: boolean; sourceHash: string }
}

export type BuildManifest = {
  manifestVersion: number
  artifact: {
    sha256: string
    sizeBytes: number
    kind: 'native'
    variant: 'standard'
    target: string
    profile: BuildProfile
    formatVersion: number
    strategyId: string
  }
  package: { name: string; bin: string; entrypoint: string; engineRelPath: string | null }
  sourceHash: string
  sourceHashInput: SourceHashInput
  build: {
    command: string[]
    env: Record<string, string>
    renderedConfig: string
    backgroundQos: boolean
    /** CARGO_BUILD_JOBS of the build, null when unthrottled (31 §4.5). */
    buildJobs: number | null
    wallTimeMs: { cargo: number; total: number }
  }
  toolchain: ToolchainProvenance
  git: GitProvenance
  describe: unknown
  /** Required checks this build did not run, named with their reason (00 R14). */
  pendingChecks: string[]
  builtAt: string
}

export function makeManifest(args: Omit<BuildManifest, 'manifestVersion'>): BuildManifest {
  if (args.artifact.target !== NATIVE_TARGET)
    throw new Error(`unsupported target ${args.artifact.target}`)
  if (computeSourceHash(args.sourceHashInput) !== args.sourceHash) {
    throw new Error('manifest source hash does not match its input')
  }
  return { manifestVersion: BUILD_MANIFEST_VERSION, ...args }
}

/** The local cache paths of 31 §6.1: `<dir>/<sha>` and `<dir>/<sha>.build.json`. */
export function cachePaths(cacheDir: string, sha256: string): { binary: string; manifest: string } {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a sha256: ${sha256}`)
  return {
    binary: path.join(cacheDir, sha256),
    manifest: path.join(cacheDir, `${sha256}.build.json`),
  }
}

function writeAtomic(target: string, data: Buffer | string, mode: number): void {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, data, { mode })
  chmodSync(tmp, mode)
  renameSync(tmp, target)
}

export type CacheWriteResult = {
  binaryPath: string
  manifestPath: string
  /** The binary was already in the cache with the same bytes. */
  alreadyCached: boolean
}

/**
 * Write the binary (mode 0755) and its manifest into the local cache, each
 * via a temp file in the same directory and a rename (atomic on one
 * filesystem). An existing binary is kept when its sha256 matches; a cached
 * file whose bytes do not match its name is replaced. An existing manifest is
 * kept: it records the first build of those bytes, as the TS provenance row
 * does (src/strategy/artifacts/publish.ts).
 */
export function writeToLocalCache(
  cacheDir: string,
  bytes: Buffer,
  manifest: BuildManifest,
): CacheWriteResult {
  const sha = sha256Hex(bytes)
  if (sha !== manifest.artifact.sha256) throw new Error('manifest sha256 does not match the bytes')
  mkdirSync(cacheDir, { recursive: true })
  const paths = cachePaths(cacheDir, sha)
  let alreadyCached = false
  if (existsSync(paths.binary) && sha256Hex(readFileSync(paths.binary)) === sha)
    alreadyCached = true
  else writeAtomic(paths.binary, bytes, 0o755)
  if (!existsSync(paths.manifest))
    writeAtomic(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 0o644)
  return { binaryPath: paths.binary, manifestPath: paths.manifest, alreadyCached }
}

/**
 * Source-hash dedupe in the local cache (31 §5.6 step 2, §7.2 with
 * --local-only): the sha of a cached manifest with the same source hash,
 * target, variant and profile but different bytes, or null.
 *
 * - A cache manifest that cannot be read is an error, never skipped (00 R14).
 * - The reused binary must still hash to its name; a mismatch is an error.
 * - A build from a dirty strategy or engine tree is never reused for a clean
 *   build. D-PENDING: 31 §5.6 keys dedupe on the source hash only, which
 *   excludes the engine commit and the dirty flags embedded in the binary
 *   (§5.3); chose to skip dirty cached builds when the new build is clean, so
 *   a clean publish never returns bytes that report engineDirty = true.
 */
export function findSameSourceInCache(
  cacheDir: string,
  key: {
    sourceHash: string
    target: string
    variant: string
    profile: string
    sha256: string
    /** The new build comes from a dirty strategy or engine tree. */
    dirty: boolean
  },
): string | null {
  if (!existsSync(cacheDir)) return null
  const names = readdirSync(cacheDir)
    .filter((n) => /^[0-9a-f]{64}\.build\.json$/.test(n))
    .sort()
  for (const name of names) {
    const file = path.join(cacheDir, name)
    let m: Partial<BuildManifest>
    try {
      m = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildManifest>
    } catch (err) {
      throw new Error(
        `unreadable build manifest in the local cache: ${file} (${err instanceof Error ? err.message : String(err)}); remove it or the cache entry`,
      )
    }
    const a = m.artifact
    if (
      m.sourceHash !== key.sourceHash ||
      a?.target !== key.target ||
      a.variant !== key.variant ||
      a.profile !== key.profile ||
      a.sha256 === key.sha256
    )
      continue
    if (`${a.sha256}.build.json` !== name)
      throw new Error(`${file} describes ${a.sha256}, not the sha in its name`)
    const cachedDirty = m.git?.strategy.dirty === true || m.git?.engine.dirty === true
    if (cachedDirty && !key.dirty) continue
    const bin = path.join(cacheDir, a.sha256)
    if (!existsSync(bin)) continue
    const actual = sha256Hex(readFileSync(bin))
    if (actual !== a.sha256)
      throw new Error(`cached binary ${bin} hashes to ${actual}, not its name; remove it`)
    return a.sha256
  }
  return null
}

export { NATIVE_ARTIFACT_FORMAT_VERSION }
