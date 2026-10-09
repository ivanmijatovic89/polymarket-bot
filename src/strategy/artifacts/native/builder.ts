/**
 * The canonical builder of native strategy artifacts (31 §4): package
 * loading, `cargo build --locked --offline` with the rendered build policy,
 * the post-link steps and gates of 31 §4.4, the source hash (31 §5.2) and the
 * artifact identity (31 §5.1).
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeEngineIdentity, type EngineIdentity } from './engineIdentity.js'
import {
  checkDescribe,
  checkSelftest,
  dylibViolations,
  findPathLeaks,
  parseDylibAllowlist,
  parseOtoolL,
  parseSingleJsonDocument,
  pathLeakNeedles,
} from './gates.js'
import {
  cargoConfigViolations,
  ENGINE_ROOT,
  realpathOr,
  run,
  runOk,
  type HostContext,
} from './host.js'
import {
  checkPackageRules,
  gitignoreHasTargetRule,
  type CargoMetadata,
  type CargoMetadataPackage,
  type RuleReport,
} from './packageRules.js'
import {
  BUILD_CONFIG_REL,
  DEPLOYMENT_TARGET,
  DYLIB_ALLOWLIST_REL,
  ENGINE_LOCK_REL,
  ENGINE_TOOLCHAIN_REL,
  NATIVE_TARGET,
  PMB_SDK_MANIFEST_REL,
  STRATEGY_ID_RE,
  remapHostPaths,
  remapPairs,
  renderBuildConfig,
  type BuildConfigValues,
  type BuildProfile,
} from './policy.js'
import {
  classifyDepInfo,
  computeSourceHash,
  normalizeFileEntries,
  parseDepInfo,
  sha256Hex,
  type SourceFileEntry,
  type SourceHashInput,
} from './sourceHash.js'
import { enforceTargetBudget, withBuilderLock } from './targetDir.js'
import { parseCargoLock, scanToml, tomlStringValue } from './toml.js'

export class NativeBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativeBuildError'
  }
}

export type Toolchain = {
  /** Full `rustc -vV` output. */
  rustcVerbose: string
  /** `release:` line of `rustc -vV`, e.g. 1.89.0. */
  rustcRelease: string
}

/** `rustc -vV` as selected by the package's rust-toolchain.toml (31 §3 item 1). */
export function readToolchain(
  packageRoot: string,
  env: NodeJS.ProcessEnv,
  engineRoot: string = ENGINE_ROOT,
): Toolchain {
  const out = runOk('rustc', ['-vV'], { cwd: packageRoot, env })
  const release = /^release: (.+)$/m.exec(out)?.[1]?.trim()
  if (!release) throw new NativeBuildError(`cannot read the rustc release from:\n${out}`)
  const pinned = pinnedChannel(readFileSync(path.join(engineRoot, ENGINE_TOOLCHAIN_REL), 'utf8'))
  if (release !== pinned) {
    throw new NativeBuildError(
      `rustc in ${packageRoot} is ${release}, but native/rust-toolchain.toml pins ${pinned} (31 §3 item 1)`,
    )
  }
  return { rustcVerbose: out.trimEnd(), rustcRelease: release }
}

/** `toolchain.channel` of a rust-toolchain.toml. */
export function pinnedChannel(toolchainToml: string): string {
  const e = scanToml(toolchainToml).entries.find((x) => x.path === 'toolchain.channel')
  const v = e ? tomlStringValue(e.value) : null
  if (!v) throw new NativeBuildError('native/rust-toolchain.toml has no toolchain.channel')
  return v
}

export type LoadedPackage = {
  packageRoot: string
  manifestText: string
  metadata: CargoMetadata
  pkg: CargoMetadataPackage
  bins: string[]
  rules: RuleReport
  /** Path packages (no source) of the dependency graph: their manifests join the source hash (31 §5.2). */
  pathManifests: string[]
  /** True once `native/crates/pmb-sdk` exists in the engine (pre-SDK phase otherwise). */
  sdkAvailable: boolean
}

function readIfExists(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/**
 * Load a strategy package and evaluate the package rules of 31 §2.2 and the
 * lock-subset rule of 31 §3 (strategy:check gate 1).
 */
export function loadPackage(packageDir: string, host: HostContext): LoadedPackage {
  const packageRoot = realpathOr(path.resolve(packageDir))
  const manifestPath = path.join(packageRoot, 'Cargo.toml')
  if (!existsSync(manifestPath)) throw new NativeBuildError(`no Cargo.toml in ${packageRoot}`)
  const manifestText = readFileSync(manifestPath, 'utf8')
  const metadataJson = run(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--offline'],
    {
      cwd: packageRoot,
      env: host.toolEnv,
    },
  )
  if (metadataJson.status !== 0) {
    throw new NativeBuildError(
      `cargo metadata --locked --offline failed in ${packageRoot}:\n${metadataJson.stderr.trim()}`,
    )
  }
  const metadata = JSON.parse(metadataJson.stdout) as CargoMetadata
  if (metadata.workspace_members.length !== 1) {
    throw new NativeBuildError(
      `a strategy package is a single-package workspace; found ${metadata.workspace_members.length} members`,
    )
  }
  const pkg = metadata.packages.find((p) => p.id === metadata.workspace_members[0])
  if (!pkg) throw new NativeBuildError('cargo metadata: workspace member not found')

  const sdkManifestAbs = path.join(host.engineRoot, PMB_SDK_MANIFEST_REL)
  const sdkManifest = existsSync(sdkManifestAbs) ? realpathOr(sdkManifestAbs) : null
  const sdkNode = metadata.packages.find((p) => p.name === 'pmb-sdk' && p.source === null)
  const binSources = new Map<string, string>()
  const bins: string[] = []
  for (const t of pkg.targets) {
    if (!t.kind.includes('bin')) continue
    bins.push(t.name)
    const src = readIfExists(t.src_path)
    if (src !== null) binSources.set(t.name, src)
  }
  const pkgLockText = readIfExists(path.join(packageRoot, 'Cargo.lock'))
  const repoRoot = gitTopLevel(packageRoot, host.toolEnv)
  const rules = checkPackageRules({
    packageRoot,
    manifestText,
    pkg,
    workspaceRoot: realpathOr(metadata.workspace_root),
    sdkManifest,
    resolvedSdkManifest: sdkNode ? realpathOr(sdkNode.manifest_path) : null,
    packageToolchain: readIfExists(path.join(packageRoot, 'rust-toolchain.toml')),
    engineToolchain: readFileSync(path.join(host.engineRoot, ENGINE_TOOLCHAIN_REL), 'utf8'),
    packageLock: pkgLockText === null ? null : parseCargoLock(pkgLockText),
    engineLock: parseCargoLock(readFileSync(path.join(host.engineRoot, ENGINE_LOCK_REL), 'utf8')),
    packageGitignoresTarget: gitignoreHasTargetRule(
      readIfExists(path.join(packageRoot, '.gitignore')) ?? '',
    ),
    repoRootIgnoresTarget:
      repoRoot !== null &&
      gitignoreHasTargetRule(readIfExists(path.join(repoRoot, '.gitignore')) ?? ''),
    binSources,
  })
  if (repoRoot === null) rules.violations.push(`${packageRoot} is not inside a git repository`)
  for (const v of cargoConfigViolations(packageRoot, host.cargoHome)) rules.violations.push(v)
  const pathManifests = metadata.packages
    .filter((p) => p.source === null)
    .map((p) => realpathOr(p.manifest_path))
  return {
    packageRoot,
    manifestText,
    metadata,
    pkg,
    bins: bins.sort(),
    rules,
    pathManifests,
    sdkAvailable: sdkManifest !== null,
  }
}

export function gitTopLevel(dir: string, env: NodeJS.ProcessEnv): string | null {
  const r = run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { cwd: dir, env })
  return r.status === 0 ? realpathOr(r.stdout.trim()) : null
}

/** Render native/build/artifact-build.toml for this host (31 §4.1). */
export function renderHostBuildConfig(
  host: HostContext,
  engine: EngineIdentity,
  toolchain: Toolchain,
): { template: string; rendered: string; values: BuildConfigValues } {
  const template = readFileSync(path.join(host.engineRoot, BUILD_CONFIG_REL), 'utf8')
  const values: BuildConfigValues = {
    CARGO_HOME: host.cargoHome,
    RUSTUP_HOME: host.rustupHome,
    ENGINE_ROOT: host.engineRoot,
    ENGINE_ROOT_REALPATH: realpathOr(host.engineRoot),
    TARGET_DIR: host.targetDir,
    PMB_ENGINE_SOURCE_HASH: engine.sourceHash,
    PMB_ENGINE_COMMIT: engine.commit,
    PMB_ENGINE_DIRTY: engine.dirty ? 'true' : 'false',
    PMB_RUSTC: toolchain.rustcRelease,
  }
  return { template, rendered: renderBuildConfig(template, values), values }
}

export type BuiltArtifact = {
  /** Final signed binary, in a private temp directory the caller removes with `cleanup`. */
  binaryPath: string
  bytes: Buffer
  /** Artifact identity: sha256 of the final signed bytes (31 §5.1, D17). */
  sha256: string
  strategyId: string
  profile: BuildProfile
  bin: string
  sourceHash: string
  sourceHashInput: SourceHashInput
  describe: unknown
  engine: EngineIdentity
  toolchain: Toolchain
  cargoArgs: string[]
  /** Rendered build config with host paths replaced by their remap targets (31 §5.4). */
  renderedConfigRemapped: string
  buildEnv: Record<string, string>
  wallTimeMs: { cargo: number; total: number }
  cleanup: () => void
}

const BINARY_ENV = { TZ: 'UTC', LANG: 'C', RUST_BACKTRACE: '1' } // 20 G6
const ONE_SHOT_TIMEOUT_MS = 120_000

function runBinary(
  bin: string,
  args: string[],
  workDir: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = run(bin, args, { cwd: workDir, env: { ...BINARY_ENV }, timeoutMs: ONE_SHOT_TIMEOUT_MS })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function codesign(bin: string, identifier: string, env: NodeJS.ProcessEnv, cwd: string): void {
  runOk('codesign', ['--force', '--sign', '-', '--identifier', identifier, bin], { cwd, env })
}

/**
 * Build one bin of a loaded package with the given profile through the full
 * canonical pipeline of 31 §4.1-§4.4 and §5.1-§5.2. Every failed step throws
 * (31 §4.4: "there is no override flag").
 */
export function buildNative(args: {
  loaded: LoadedPackage
  bin: string
  profile: BuildProfile
  host: HostContext
  toolchain: Toolchain
  engine: EngineIdentity
  log: (msg: string) => void
}): BuiltArtifact {
  const t0 = Date.now()
  const { loaded, bin, profile, host, toolchain, engine, log } = args
  if (!loaded.bins.includes(bin)) {
    throw new NativeBuildError(
      `bin ${JSON.stringify(bin)} not found in ${loaded.packageRoot} (bins: ${loaded.bins.join(', ') || 'none'})`,
    )
  }
  const { template, rendered, values } = renderHostBuildConfig(host, engine, toolchain)
  const work = mkdtempSync(path.join(os.tmpdir(), 'pmb-native-build-'))
  const cleanup = (): void => rmSync(work, { recursive: true, force: true })
  try {
    const configPath = path.join(work, 'artifact-build.toml')
    writeFileSync(configPath, rendered)
    mkdirSync(host.targetDir, { recursive: true })

    // --- cargo build (31 §4.1) ----------------------------------------------
    const cargoArgs = [
      'build',
      '--locked',
      '--offline',
      '--profile',
      profile,
      '--bin',
      bin,
      '--config',
      configPath,
    ]
    // The binary reports its profile as describe.binary.buildProfile (20 §3).
    // D-PENDING: 31 §4.1 does not say how the profile name reaches the binary;
    // chose env PMB_BUILD_PROFILE on the cargo process (read with env!), so the
    // rendered config stays identical for every profile.
    const buildEnv: Record<string, string> = {
      CARGO_TARGET_DIR: host.targetDir,
      PMB_BUILD_PROFILE: profile,
    }
    const env = { ...host.toolEnv, ...buildEnv }
    const cmd = host.backgroundQos ? 'taskpolicy' : 'cargo'
    const cmdArgs = host.backgroundQos ? ['-b', 'cargo', ...cargoArgs] : cargoArgs
    log(
      `[native-build] cargo ${cargoArgs.slice(0, -1).join(' ')} <rendered artifact-build.toml>${host.backgroundQos ? ' (background QoS)' : ''}`,
    )
    const staged = path.join(work, bin)
    // One build at a time per host (31 §4.5): cargo uplifts every bin to
    // <target>/<triple>/<profile>/<bin>, so the build and the copy of its
    // output and dep-info happen under the host-wide builder lock.
    const { cargoMs, depInfoText } = withBuilderLock(host.lockPath, log, () => {
      enforceTargetBudget(host.targetDir, profile, host.targetBudgetBytes, log)
      const tc = Date.now()
      const r = run(cmd, cmdArgs, { cwd: loaded.packageRoot, env, inheritStderr: true })
      const ms = Date.now() - tc
      if (r.status !== 0) {
        throw new NativeBuildError(`cargo build failed (exit ${r.status ?? r.signal})`)
      }
      const outDir = path.join(host.targetDir, NATIVE_TARGET, profile)
      const outBin = path.join(outDir, bin)
      const depInfoPath = path.join(outDir, `${bin}.d`)
      if (!existsSync(outBin) || !existsSync(depInfoPath)) {
        throw new NativeBuildError(`cargo produced no ${outBin} (or its dep-info)`)
      }
      copyFileSync(outBin, staged)
      return { cargoMs: ms, depInfoText: readFileSync(depInfoPath, 'utf8') }
    })

    // --- source hash (31 §5.2) ----------------------------------------------
    const depInfo = parseDepInfo(depInfoText)
    const roots = {
      engineRoot: host.engineRoot,
      packageRoot: loaded.packageRoot,
      excludedRoots: [path.join(host.cargoHome, 'registry'), host.rustupHome].map((p) =>
        realpathOr(p),
      ),
    }
    const classified = classifyDepInfo(
      [...depInfo.deps.map((d) => realpathOr(d)), ...loaded.pathManifests],
      roots,
    )
    if (classified.outside.length > 0) {
      // D-PENDING: generated sources under the target directory (OUT_DIR of a
      // dependency's build script) would land here; 31 §5.2 says fail, so we do.
      throw new NativeBuildError(
        `dep-info entries outside the engine root, the package root, the registry cache and the toolchain:\n  ${classified.outside.join('\n  ')}`,
      )
    }
    const files: SourceFileEntry[] = normalizeFileEntries(
      classified.files.map(([role, rel, abs]) => [role, rel, sha256Hex(readFileSync(abs))]),
    )
    const lockPath = path.join(loaded.packageRoot, 'Cargo.lock')
    const sourceHashInput: SourceHashInput = {
      v: 1,
      target: NATIVE_TARGET,
      profile,
      rustc: toolchain.rustcVerbose,
      deploymentTarget: DEPLOYMENT_TARGET,
      buildConfig: sha256Hex(template),
      lock: sha256Hex(readFileSync(lockPath)),
      files,
    }
    const sourceHash = computeSourceHash(sourceHashInput)

    // --- post-link steps (31 §4.4) ------------------------------------------
    const runDir = path.join(work, 'run')
    mkdirSync(runDir)
    // The canonical identifier needs the strategy id, which comes from code
    // (30 §4 rule 2) and is read through describe: sign provisionally first,
    // read the id, then sign canonically; every check below runs on the
    // canonically signed bytes.
    codesign(staged, 'pmb.provisional', host.toolEnv, work)
    const pre = runBinary(staged, ['describe'], runDir)
    if (pre.status !== 0) {
      throw new NativeBuildError(
        `describe failed before signing (exit ${pre.status}): ${pre.stderr.trim().slice(0, 2000)}`,
      )
    }
    const preDoc = parseSingleJsonDocument(pre.stdout, 'describe') as {
      strategy?: { id?: unknown }
    }
    const id = preDoc.strategy?.id
    if (typeof id !== 'string' || !STRATEGY_ID_RE.test(id)) {
      throw new NativeBuildError(
        `describe reported an invalid strategy id ${JSON.stringify(id)} (30 §4 rule 2)`,
      )
    }
    // Step 1: canonical ad-hoc signature.
    codesign(staged, `pmb.${id}`, host.toolEnv, work)
    // Step 2: verify it.
    const verify = run('codesign', ['--verify', '--strict', staged], {
      cwd: work,
      env: host.toolEnv,
    })
    if (verify.status !== 0)
      throw new NativeBuildError(`codesign --verify --strict failed: ${verify.stderr.trim()}`)
    // Step 3: dynamic libraries.
    const allowlist = parseDylibAllowlist(
      readFileSync(path.join(host.engineRoot, DYLIB_ALLOWLIST_REL), 'utf8'),
    )
    const dylibs = parseOtoolL(runOk('otool', ['-L', staged], { cwd: work, env: host.toolEnv }))
    const dylibErrors = dylibViolations(dylibs, allowlist)
    if (dylibErrors.length > 0)
      throw new NativeBuildError(`dynamic library gate failed:\n  ${dylibErrors.join('\n  ')}`)
    // Step 4: path leaks.
    const bytes = readFileSync(staged)
    const needles = pathLeakNeedles({
      home: host.home,
      cargoHome: host.cargoHome,
      rustupHome: host.rustupHome,
      engineRoot: host.engineRoot,
      packageRoot: loaded.packageRoot,
      targetDir: host.targetDir,
      realpath: realpathOr,
    })
    const leaks = findPathLeaks(bytes, needles)
    if (leaks.length > 0)
      throw new NativeBuildError(
        `path-leak gate failed; the binary contains:\n  ${leaks.join('\n  ')}`,
      )
    // Step 5: selftest.
    const st = runBinary(staged, ['selftest'], runDir)
    let stDoc: unknown = null
    try {
      stDoc = parseSingleJsonDocument(st.stdout, 'selftest')
    } catch (err) {
      throw new NativeBuildError(
        `${err instanceof Error ? err.message : String(err)}; stderr: ${st.stderr.trim().slice(0, 2000)}`,
      )
    }
    const stErrors = checkSelftest(stDoc, st.status)
    if (stErrors.length > 0)
      throw new NativeBuildError(`selftest gate failed:\n  ${stErrors.join('\n  ')}`)
    // Step 6: describe checks.
    const ds = runBinary(staged, ['describe'], runDir)
    if (ds.status !== 0)
      throw new NativeBuildError(
        `describe failed (exit ${ds.status}): ${ds.stderr.trim().slice(0, 2000)}`,
      )
    const describe = parseSingleJsonDocument(ds.stdout, 'describe')
    const checked = checkDescribe(describe, { profile })
    if (!checked.ok)
      throw new NativeBuildError(`describe gate failed:\n  ${checked.errors.join('\n  ')}`)
    if (checked.summary.strategyId !== id) {
      throw new NativeBuildError(
        `describe id changed after signing: ${id} → ${checked.summary.strategyId}`,
      )
    }
    // Step 7: identity.
    const sha256 = sha256Hex(bytes)
    const renderedConfigRemapped = remapHostPaths(rendered, remapPairs(values))
    return {
      binaryPath: staged,
      bytes,
      sha256,
      strategyId: id,
      profile,
      bin,
      sourceHash,
      sourceHashInput,
      describe,
      engine,
      toolchain,
      cargoArgs: [...cargoArgs.slice(0, -1), '<rendered artifact-build.toml>'],
      renderedConfigRemapped,
      buildEnv,
      wallTimeMs: { cargo: cargoMs, total: Date.now() - t0 },
      cleanup,
    }
  } catch (err) {
    cleanup()
    throw err
  }
}

/** Engine identity for this build (31 §5.3). */
export function engineIdentity(host: HostContext): EngineIdentity {
  return computeEngineIdentity(host.engineRoot, host.toolEnv)
}
