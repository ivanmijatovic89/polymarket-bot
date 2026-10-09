/**
 * Rust `strategy:check` (31 §7.1) and `strategy:publish --local-only`
 * (31 §7.2, §7.5) on top of the canonical builder.
 *
 * Local-only never uploads and never touches a database (31 §7.5, 00 R13):
 * this module imports neither the R2 client nor the DB layer.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildNative,
  engineIdentity,
  gitTopLevel,
  loadPackage,
  NativeBuildError,
  readToolchain,
  renderHostBuildConfig,
  type BuiltArtifact,
  type LoadedPackage,
  type Toolchain,
} from './builder.js'
import type { EngineIdentity } from './engineIdentity.js'
import { bootstrapToolEnv, makeHostContext, run, type HostContext } from './host.js'
import {
  cachePaths,
  findSameSourceInCache,
  makeManifest,
  writeToLocalCache,
  type BuildManifest,
  type ToolchainProvenance,
} from './manifest.js'
import {
  CLIPPY_CONF_DIR_REL,
  DETERMINISM_LINTS,
  NATIVE_ARTIFACT_FORMAT_VERSION,
  NATIVE_LOCAL_CACHE_REL,
  NATIVE_TARGET,
  type BuildProfile,
} from './policy.js'

export type GateStatus = 'pass' | 'fail' | 'pending' | 'skipped'
export type GateResult = { gate: number; name: string; status: GateStatus; detail: string[] }

export type NativeRunOptions = {
  packageDir: string
  targetDir?: string
  backgroundQos?: boolean
  log?: (msg: string) => void
}

type Session = {
  host: HostContext
  toolchain: Toolchain
  loaded: LoadedPackage
  engine: EngineIdentity
  log: (msg: string) => void
}

function openSession(opts: NativeRunOptions): Session {
  const log = opts.log ?? ((m: string) => console.log(m))
  const packageRoot = path.resolve(opts.packageDir)
  const toolchain = readToolchain(packageRoot, bootstrapToolEnv())
  const host = makeHostContext({
    rustcRelease: toolchain.rustcRelease,
    ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    ...(opts.backgroundQos !== undefined ? { backgroundQos: opts.backgroundQos } : {}),
  })
  const loaded = loadPackage(packageRoot, host)
  const engine = engineIdentity(host)
  return { host, toolchain, loaded, engine, log }
}

function gate1(s: Session): GateResult {
  const { violations, pending } = s.loaded.rules
  return {
    gate: 1,
    name: 'toolchain and package rules, lock subset (31 §2.2, §3)',
    status: violations.length > 0 ? 'fail' : 'pass',
    detail: [...violations, ...pending.map((p) => `pending: ${p}`)],
  }
}

function gate2(s: Session): GateResult {
  const r = run('cargo', ['fmt', '--all', '--check'], {
    cwd: s.loaded.packageRoot,
    env: s.host.toolEnv,
  })
  return {
    gate: 2,
    name: 'cargo fmt --check',
    status: r.status === 0 ? 'pass' : 'fail',
    detail: r.status === 0 ? [] : [(r.stdout + r.stderr).trim().slice(0, 4000)],
  }
}

/**
 * Gate 3 (31 §7.1, 30 §11): clippy with CLIPPY_CONF_DIR set to the engine's
 * config, `-D warnings`, and the determinism lints with `-F`.
 * D-PENDING: before pmb-sdk exists no package can satisfy the forbid level
 * (its own main needs stdout and args, which strategy_main! will hide);
 * chose `-D` for the determinism lints in that pre-SDK phase and `-F` as
 * soon as native/crates/pmb-sdk exists.
 */
function gate3(s: Session): GateResult {
  const { rendered } = renderHostBuildConfig(s.host, s.engine, s.toolchain)
  const work = mkdtempSync(path.join(os.tmpdir(), 'pmb-native-clippy-'))
  try {
    const configPath = path.join(work, 'artifact-build.toml')
    writeFileSync(configPath, rendered)
    const level = s.loaded.sdkAvailable ? '-F' : '-D'
    const lintArgs = DETERMINISM_LINTS.flatMap((l) => [level, l])
    const args = [
      'clippy',
      '--locked',
      '--offline',
      '--all-targets',
      '--profile',
      'iterate',
      '--config',
      configPath,
      '--',
      '-D',
      'warnings',
      ...lintArgs,
    ]
    const env = {
      ...s.host.toolEnv,
      CARGO_TARGET_DIR: s.host.targetDir,
      PMB_BUILD_PROFILE: 'iterate',
      CLIPPY_CONF_DIR: path.join(s.host.engineRoot, CLIPPY_CONF_DIR_REL),
    }
    const r = run('cargo', args, { cwd: s.loaded.packageRoot, env })
    const detail = r.status === 0 ? [] : [r.stderr.trim().slice(-6000)]
    if (!s.loaded.sdkAvailable)
      detail.push('pre-SDK phase: determinism lints at deny (-D), not forbid (-F)')
    return {
      gate: 3,
      name: 'clippy with the engine config and determinism lints',
      status: r.status === 0 ? 'pass' : 'fail',
      detail,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function pendingGate(gate: number, name: string, why: string): GateResult {
  return { gate, name, status: 'pending', detail: [why] }
}

const GATE4_NAME = 'cargo test --profile iterate (testkit), deny-network sandbox'
const GATE7_NAME = 'behavioral smoke: run-group equivalence, interests A/B, ns/callback'

function gate6(built: BuiltArtifact[]): GateResult {
  const detail: string[] = []
  const byId = new Map<string, string[]>()
  for (const b of built) byId.set(b.strategyId, [...(byId.get(b.strategyId) ?? []), b.bin])
  for (const [id, bins] of byId)
    if (bins.length > 1)
      detail.push(`strategy id ${id} is declared by several bins: ${bins.join(', ')}`)
  const status: GateStatus = detail.length > 0 ? 'fail' : 'pass'
  detail.push('pending pmb-sdk: paramsSchema and requirements checks')
  return { gate: 6, name: 'describe: id grammar and uniqueness', status, detail }
}

function printGate(log: (m: string) => void, prefix: string, g: GateResult): void {
  log(`${prefix} gate ${g.gate} ${g.name}: ${g.status.toUpperCase()}`)
  for (const d of g.detail) for (const line of d.split('\n')) log(`${prefix}   ${line}`)
}

/**
 * `strategy:check -- --repo <dir>` for a Rust package (31 §7.1). Gates that
 * compile anything (3, 5, 6) are skipped when gate 1 fails: a package that
 * breaks the package rules may carry a build script, and compiling it would
 * execute strategy-authored code (31 §9).
 */
export function runNativeCheck(opts: NativeRunOptions): { ok: boolean; gates: GateResult[] } {
  const s = openSession(opts)
  const prefix = '[strategy:check]'
  const gates: GateResult[] = []
  const push = (g: GateResult): void => {
    gates.push(g)
    printGate(s.log, prefix, g)
  }
  const g1 = gate1(s)
  push(g1)
  push(gate2(s))
  if (g1.status === 'fail') {
    push({ gate: 3, name: 'clippy', status: 'skipped', detail: ['gate 1 failed'] })
  } else push(gate3(s))
  push(pendingGate(4, GATE4_NAME, 'pending pmb-sdk (testkit)'))
  if (g1.status === 'fail') {
    push({
      gate: 5,
      name: 'builder build of every bin (iterate)',
      status: 'skipped',
      detail: ['gate 1 failed'],
    })
    push({ gate: 6, name: 'describe', status: 'skipped', detail: ['gate 1 failed'] })
  } else {
    const built: BuiltArtifact[] = []
    const detail: string[] = []
    for (const bin of s.loaded.bins) {
      try {
        const b = buildNative({
          loaded: s.loaded,
          bin,
          profile: 'iterate',
          host: s.host,
          toolchain: s.toolchain,
          engine: s.engine,
          log: s.log,
        })
        b.cleanup()
        built.push(b)
        detail.push(`${bin}: ${b.strategyId} sha256=${b.sha256} (iterate, not cached)`)
      } catch (err) {
        detail.push(`${bin}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const ok5 = built.length === s.loaded.bins.length
    push({
      gate: 5,
      name: 'builder build of every bin (iterate) with the post-link steps of 31 §4.4',
      status: ok5 ? 'pass' : 'fail',
      detail,
    })
    push(
      ok5
        ? gate6(built)
        : { gate: 6, name: 'describe', status: 'skipped', detail: ['gate 5 failed'] },
    )
  }
  push(pendingGate(7, GATE7_NAME, 'pending pmb-sdk (run-group and interests)'))
  const ok = gates.every((g) => g.status !== 'fail')
  const pending = gates.filter((g) => g.status === 'pending').length
  s.log(`${prefix} ${ok ? 'OK' : 'FAILED'}${pending ? ` (${pending} gates pending pmb-sdk)` : ''}`)
  return { ok, gates }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

function probe(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  pick: (out: string) => string,
): string {
  try {
    const r = run(cmd, args, { cwd, env, timeoutMs: 30_000 })
    if (r.status !== 0) return `unavailable (exit ${r.status})`
    return pick(r.stdout.trim() !== '' ? r.stdout : r.stderr)
  } catch (err) {
    return `unavailable (${err instanceof Error ? err.message : String(err)})`
  }
}

/** Toolchain provenance recorded in the manifest (31 §5.2 last paragraph, §6.2 built_with). */
export function toolchainProvenance(
  host: HostContext,
  toolchain: Toolchain,
  cwd: string,
): ToolchainProvenance {
  const env = host.toolEnv
  return {
    rustc: toolchain.rustcVerbose,
    cargo: probe('cargo', ['-V'], env, cwd, firstLine),
    macosSdk: probe('xcrun', ['--show-sdk-version'], env, cwd, firstLine),
    ld: probe('ld', ['-v'], env, cwd, firstLine),
    cc: probe('cc', ['--version'], env, cwd, firstLine),
    clt: probe(
      'pkgutil',
      ['--pkg-info=com.apple.pkg.CLTools_Executables'],
      env,
      cwd,
      (o) => /^version: (.+)$/m.exec(o)?.[1] ?? firstLine(o),
    ),
    host: os.hostname(),
  }
}

export type LocalPublishResult = {
  sha256: string
  strategyId: string
  binaryPath: string
  manifestPath: string
  alreadyCached: boolean
  /** Set when 31 §5.6 step 2 reused an earlier sha with the same source hash. */
  reusedFor: string | null
  profile: BuildProfile
}

export type LocalPublishOptions = NativeRunOptions & {
  bin: string
  allowDirty: boolean
  skipChecks: boolean
  /** Also build the parity-check binary next to the artifact (60 §8.1); local cache only. */
  parityCheck: boolean
  /** Returns an error message when the id collides with a TS strategy id (31 §7.2 step 5). */
  idCollision?: (id: string) => string | null
  /** Local cache directory; default `<engine>/data/strategy-artifacts/native` (31 §6.1). Tests only. */
  cacheDir?: string
}

/**
 * `strategy:publish -- --local-only --repo <pkg> --bin <name>` (31 §7.2,
 * §7.5): gates of 31 §7.1 (minus 2 and 4 with --skip-checks), the canonical
 * `artifact` build, id checks, local-cache dedupe, and the cache write. No
 * R2, no database.
 */
export function publishNativeLocalOnly(opts: LocalPublishOptions): LocalPublishResult[] {
  const s = openSession(opts)
  const prefix = '[strategy:publish]'
  const fail = (msg: string): never => {
    throw new NativeBuildError(msg)
  }

  // Step 1: package and bin.
  if (!s.loaded.bins.includes(opts.bin)) {
    fail(
      `bin ${JSON.stringify(opts.bin)} not found in ${s.loaded.packageRoot} (bins: ${s.loaded.bins.join(', ') || 'none'})`,
    )
  }
  const repoRoot =
    gitTopLevel(s.loaded.packageRoot, s.host.toolEnv) ??
    fail(`${s.loaded.packageRoot} is not inside a git repository`)

  // Step 2: provenance.
  const git = (args: string[]): string => {
    const r = run('git', ['-C', s.loaded.packageRoot, ...args], {
      cwd: s.loaded.packageRoot,
      env: s.host.toolEnv,
    })
    if (r.status !== 0) fail(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
    return r.stdout.trim()
  }
  const commit = git(['rev-parse', 'HEAD'])
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', '.']) !== ''
  if (dirty && !opts.allowDirty) {
    fail(
      'the strategy package has uncommitted changes — commit first, or pass --allow-dirty (recorded in the manifest)',
    )
  }
  const remote = run('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
    cwd: repoRoot,
    env: s.host.toolEnv,
  })
  const repo = remote.status === 0 ? remote.stdout.trim() : repoRoot
  s.log(
    `${prefix} native local-only: ${s.loaded.pkg.name} bin ${opts.bin} (commit ${commit.slice(0, 12)}${dirty ? ', DIRTY' : ''}; engine ${s.engine.commit.slice(0, 12)}${s.engine.dirty ? ', DIRTY' : ''})`,
  )

  // Step 3: gates.
  const g1 = gate1(s)
  printGate(s.log, prefix, g1)
  if (g1.status === 'fail') fail('gate 1 failed')
  if (!opts.skipChecks) {
    const g2 = gate2(s)
    printGate(s.log, prefix, g2)
    if (g2.status === 'fail') fail('gate 2 (cargo fmt --check) failed — fix or pass --skip-checks')
  }
  const g3 = gate3(s)
  printGate(s.log, prefix, g3)
  if (g3.status === 'fail') fail('gate 3 (clippy) failed')
  if (!opts.skipChecks)
    printGate(s.log, prefix, pendingGate(4, GATE4_NAME, 'pending pmb-sdk (testkit)'))

  const profiles: BuildProfile[] = opts.parityCheck ? ['artifact', 'parity-check'] : ['artifact']
  const cacheDir = opts.cacheDir ?? path.join(s.host.engineRoot, NATIVE_LOCAL_CACHE_REL)
  const provenance = toolchainProvenance(s.host, s.toolchain, s.loaded.packageRoot)
  const sdkDep = s.loaded.pkg.dependencies.some((d) => d.name === 'pmb-sdk' && d.kind === null)
  const results: LocalPublishResult[] = []
  for (const profile of profiles) {
    // Gate 5: the canonical build itself (31 §7.2 step 3).
    const built = buildNative({
      loaded: s.loaded,
      bin: opts.bin,
      profile,
      host: s.host,
      toolchain: s.toolchain,
      engine: s.engine,
      log: s.log,
    })
    try {
      printGate(s.log, prefix, {
        gate: 5,
        name: `builder build (${profile}) with the post-link steps of 31 §4.4`,
        status: 'pass',
        detail: [
          `${built.strategyId} sha256=${built.sha256} source_hash=${built.sourceHash} (${built.wallTimeMs.cargo} ms cargo, ${built.wallTimeMs.total} ms total)`,
        ],
      })
      printGate(s.log, prefix, gate6([built]))
      printGate(
        s.log,
        prefix,
        pendingGate(7, GATE7_NAME, 'pending pmb-sdk (run-group and interests)'),
      )

      // Step 5: id checks.
      const collision = opts.idCollision?.(built.strategyId) ?? null
      if (collision) fail(collision)

      // Step 4: dedupe against the local cache only (31 §7.2 with --local-only, §5.6).
      const reused = findSameSourceInCache(cacheDir, {
        sourceHash: built.sourceHash,
        target: NATIVE_TARGET,
        variant: 'standard',
        profile,
        sha256: built.sha256,
      })
      if (reused) {
        const paths = cachePaths(cacheDir, reused)
        s.log(
          `${prefix} source hash ${built.sourceHash} is already cached as ${reused}; reusing it, the new bytes ${built.sha256} are not written (31 §5.6 step 2)`,
        )
        results.push({
          sha256: reused,
          strategyId: built.strategyId,
          binaryPath: paths.binary,
          manifestPath: paths.manifest,
          alreadyCached: true,
          reusedFor: built.sha256,
          profile,
        })
        continue
      }

      // Step 8: prime the local cache.
      const manifest: BuildManifest = makeManifest({
        artifact: {
          sha256: built.sha256,
          sizeBytes: built.bytes.length,
          kind: 'native',
          variant: 'standard',
          target: NATIVE_TARGET,
          profile,
          formatVersion: NATIVE_ARTIFACT_FORMAT_VERSION,
          strategyId: built.strategyId,
        },
        package: {
          name: s.loaded.pkg.name,
          bin: opts.bin,
          entrypoint: path
            .relative(repoRoot, path.join(s.loaded.packageRoot, 'src', 'bin', `${opts.bin}.rs`))
            .split(path.sep)
            .join('/'),
          engineRelPath: sdkDep
            ? path.relative(s.loaded.packageRoot, s.host.engineRoot).split(path.sep).join('/')
            : null,
        },
        sourceHash: built.sourceHash,
        sourceHashInput: built.sourceHashInput,
        build: {
          command: ['cargo', ...built.cargoArgs],
          env: built.buildEnv.CARGO_TARGET_DIR
            ? { ...built.buildEnv, CARGO_TARGET_DIR: '/pmb/target' }
            : built.buildEnv,
          renderedConfig: built.renderedConfigRemapped,
          backgroundQos: s.host.backgroundQos,
          wallTimeMs: built.wallTimeMs,
        },
        toolchain: provenance,
        git: {
          strategy: { repo, commit, dirty, allowDirty: opts.allowDirty },
          engine: {
            commit: s.engine.commit,
            dirty: s.engine.dirty,
            sourceHash: s.engine.sourceHash,
          },
        },
        describe: built.describe,
        builtAt: new Date().toISOString(),
      })
      const written = writeToLocalCache(cacheDir, built.bytes, manifest)
      results.push({
        sha256: built.sha256,
        strategyId: built.strategyId,
        binaryPath: written.binaryPath,
        manifestPath: written.manifestPath,
        alreadyCached: written.alreadyCached,
        reusedFor: null,
        profile,
      })
    } finally {
      built.cleanup()
    }
  }
  return results
}
