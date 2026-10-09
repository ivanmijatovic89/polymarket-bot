/**
 * Host side of the native builder: engine root, tool paths, the sanitized
 * environment every tool runs with, build throttling, and process helpers
 * (31 §3, §4.5).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { definedPaths, scanToml, tomlStringValue } from './toml.js'

/** Default target-directory budget of 31 §4.5 (10 GiB per host). */
export const TARGET_DIR_BUDGET_BYTES = 10 * 1024 ** 3

/** Engine checkout running this builder: src/strategy/artifacts/native → repository root, realpath. */
export const ENGINE_ROOT = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
)

export type HostContext = {
  engineRoot: string
  home: string
  cargoHome: string
  rustupHome: string
  /** Shared target directory of this host and toolchain (31 §4.5). */
  targetDir: string
  /** Environment for cargo, rustc and the Xcode tools. */
  toolEnv: NodeJS.ProcessEnv
  /** Run cargo (build, clippy, fmt) under `taskpolicy -b` (background QoS, 31 §4.5). */
  backgroundQos: boolean
  /** CARGO_BUILD_JOBS of every cargo run, or null when unthrottled (31 §4.5, 40 §17 item 3). */
  buildJobs: number | null
  /** Host-wide builder lock (31 §4.5: one build at a time per host). */
  lockPath: string
  /** Target-directory budget; above it the LRU profile directory is deleted (31 §4.5). */
  targetBudgetBytes: number
}

/**
 * Variables passed through to cargo and the toolchain. Everything else is
 * dropped: RUSTFLAGS, CARGO_ENCODED_RUSTFLAGS, CARGO_PROFILE_*, CARGO_BUILD_*,
 * RUSTC_WRAPPER, RUSTUP_TOOLCHAIN and friends would silently change or
 * override the pinned build policy (31 §4.2, 00 R14). CARGO_BUILD_JOBS and
 * RUSTUP_TOOLCHAIN are set by the builder itself.
 */
const TOOL_ENV_PASSTHROUGH = ['PATH', 'HOME', 'TMPDIR', 'DEVELOPER_DIR'] as const

/**
 * Fixed values for every tool run. RUSTUP_AUTO_INSTALL=0: a missing pinned
 * toolchain is an error, never a download (31 §3 items 1-2, 00 R14).
 */
const FIXED_TOOL_ENV = { LANG: 'C', TZ: 'UTC', RUSTUP_AUTO_INSTALL: '0' } as const

/** `toolchain.channel` of a rust-toolchain.toml. */
export function pinnedChannel(toolchainToml: string): string {
  const e = scanToml(toolchainToml).entries.find((x) => x.path === 'toolchain.channel')
  const v = e ? tomlStringValue(e.value) : null
  if (!v) throw new Error('native/rust-toolchain.toml has no toolchain.channel')
  return v
}

/**
 * The toolchain every rustc and cargo call of the pipeline runs with: the
 * channel pinned by native/rust-toolchain.toml, set through RUSTUP_TOOLCHAIN,
 * which rustup ranks above a directory override and above the package's own
 * rust-toolchain.toml. A package therefore cannot select the compiler (or a
 * `[toolchain] path` binary) that runs before gate 1 compares its toolchain
 * file (31 §3 items 1-2, §2.2).
 */
export function enginePinnedChannel(engineRoot: string = ENGINE_ROOT): string {
  return pinnedChannel(readFileSync(path.join(engineRoot, 'native', 'rust-toolchain.toml'), 'utf8'))
}

/**
 * CARGO_BUILD_JOBS for a host class (40 §17 item 3): 4 on M4 hosts, 2 on
 * M1 Pro hosts; null for any other host (the caller then requires an
 * explicit value).
 */
export function defaultBuildJobs(cpuBrand: string): number | null {
  const b = cpuBrand.trim()
  if (/^Apple M4(?: |$)/.test(b) && !/^Apple M4 (?:Pro|Max)/.test(b)) return 4
  if (/^Apple M1 Pro(?: |$)/.test(b)) return 2
  return null
}

/** Build throttling of 31 §4.5: `background` (default) or `interactive` (an author's own machine). */
export type BuildQos = 'background' | 'interactive'

/**
 * Jobs cap for this host (31 §4.5 "builds MUST cap jobs", 40 §17 item 3). An
 * explicit CARGO_BUILD_JOBS (the inventory `cargo_build_jobs` override)
 * wins; else the host-class value; an unknown host class at background QoS
 * is an error (00 R14). Interactive builds run unthrottled unless
 * CARGO_BUILD_JOBS is set.
 * D-PENDING: 31 §4.5 requires the cap and background QoS on hosts that run
 * backtests but does not say how the builder knows the host role; chose
 * background QoS by default on every host (opt-out `--qos default` for an
 * author's own machine) and an error for host classes 40 §17 does not list.
 */
export function resolveBuildJobs(
  qos: BuildQos,
  explicit: string | undefined,
  cpuBrand: () => string,
): number | null {
  if (explicit !== undefined && explicit !== '') {
    if (!/^[1-9][0-9]*$/.test(explicit))
      throw new Error(
        `CARGO_BUILD_JOBS must be a positive integer (got ${JSON.stringify(explicit)})`,
      )
    return Number.parseInt(explicit, 10)
  }
  if (qos === 'interactive') return null
  const brand = cpuBrand()
  const jobs = defaultBuildJobs(brand)
  if (jobs === null) {
    throw new Error(
      `no CARGO_BUILD_JOBS value for host class ${JSON.stringify(brand)} (40 §17 item 3 sets M4 and M1 Pro); set CARGO_BUILD_JOBS, or pass --qos default for an interactive build on your own machine`,
    )
  }
  return jobs
}

function cpuBrandString(): string {
  const r = spawnSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : `unknown (${process.platform}/${process.arch})`
}

export function makeHostContext(opts: {
  targetDir?: string
  qos?: BuildQos
  rustcRelease: string
}): HostContext {
  const home = os.homedir()
  const cargoHome = path.resolve(process.env['CARGO_HOME'] || path.join(home, '.cargo'))
  const rustupHome = path.resolve(process.env['RUSTUP_HOME'] || path.join(home, '.rustup'))
  const targetDir = path.resolve(
    opts.targetDir ?? path.join(home, '.cache', 'pmb', 'target', opts.rustcRelease),
  )
  const qos = opts.qos ?? 'background'
  const buildJobs = resolveBuildJobs(qos, process.env['CARGO_BUILD_JOBS'], cpuBrandString)
  const toolEnv: NodeJS.ProcessEnv = {
    ...FIXED_TOOL_ENV,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    RUSTUP_TOOLCHAIN: enginePinnedChannel(),
    ...(buildJobs !== null ? { CARGO_BUILD_JOBS: String(buildJobs) } : {}),
  }
  for (const k of TOOL_ENV_PASSTHROUGH) {
    const v = process.env[k]
    if (v !== undefined) toolEnv[k] = v
  }
  return {
    engineRoot: ENGINE_ROOT,
    home,
    cargoHome,
    rustupHome,
    targetDir,
    toolEnv,
    backgroundQos: qos === 'background',
    buildJobs,
    lockPath: path.join(home, '.cache', 'pmb', 'builder.lock'),
    targetBudgetBytes: TARGET_DIR_BUDGET_BYTES,
  }
}

/** `cargo <args>`, wrapped in `taskpolicy -b` when the host builds at background QoS (31 §4.5). */
export function cargoCommand(host: HostContext, args: string[]): [string, string[]] {
  return host.backgroundQos ? ['taskpolicy', ['-b', 'cargo', ...args]] : ['cargo', args]
}

/** Minimal environment before the host context exists (rustc release lookup, sync-lock). */
export function bootstrapToolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...FIXED_TOOL_ENV, RUSTUP_TOOLCHAIN: enginePinnedChannel() }
  for (const k of [...TOOL_ENV_PASSTHROUGH, 'CARGO_HOME', 'RUSTUP_HOME', 'CARGO_BUILD_JOBS']) {
    const v = process.env[k]
    if (v !== undefined) env[k] = v
  }
  return env
}

export type RunResult = {
  status: number | null
  stdout: string
  stderr: string
  signal: NodeJS.Signals | null
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; inheritStderr?: boolean },
): RunResult {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    stdio: ['ignore', 'pipe', opts.inheritStderr ? 'inherit' : 'pipe'],
  })
  if (res.error) throw new Error(`${cmd} ${args.join(' ')}: ${res.error.message}`)
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    signal: res.signal,
  }
}

/** Run and require exit 0; returns stdout. */
export function runOk(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): string {
  const r = run(cmd, args, opts)
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (exit ${r.status ?? r.signal}): ${r.stderr.trim().slice(0, 2000)}`,
    )
  }
  return r.stdout
}

export function realpathOr(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * Table roots a user cargo config MAY set: they change neither the bytes nor
 * which sources are compiled. Everything else is refused, notably `build`,
 * `target`, `profile`, `env` and `unstable` (merged into the pinned policy;
 * rustflags arrays are concatenated), and `patch`, `paths`, `source`,
 * `registries`, `registry` and `credential-provider`, which can replace an
 * engine-pinned crate (with its build script) by package-supplied code
 * without changing the lock bytes (31 §2.2 "compiling strategy code executes
 * no strategy-authored code", §3 item 3).
 */
export const CARGO_CONFIG_ALLOWED_ROOTS = [
  'alias',
  'cache',
  'cargo-new',
  'future-incompat-report',
  'http',
  'net',
  'term',
] as const

/** Violations of one cargo config file's text (pure; 31 §2.2, §4.2). */
export function cargoConfigTextViolations(file: string, text: string): string[] {
  let paths: string[]
  try {
    paths = definedPaths(scanToml(text))
  } catch (err) {
    return [
      `${file}: unreadable cargo config (${err instanceof Error ? err.message : String(err)})`,
    ]
  }
  const allowed: readonly string[] = CARGO_CONFIG_ALLOWED_ROOTS
  const bad = paths.filter((p) => !allowed.includes(p.split('.')[0]!))
  return bad.length > 0
    ? [
        `${file}: sets ${bad.join(', ')}; a cargo config may set only ${CARGO_CONFIG_ALLOWED_ROOTS.join(', ')} (the build policy and the sources are engine-owned)`,
      ]
    : []
}

/**
 * Cargo merges `.cargo/config.toml` files from the working directory upwards
 * and from CARGO_HOME into the build; each one is checked against
 * CARGO_CONFIG_ALLOWED_ROOTS. The pipeline runs cargo with the package root
 * as working directory.
 * D-PENDING: 31 §4 is silent on user cargo config; chose to refuse every key
 * outside a short allowlist instead of ignoring the file.
 */
export function cargoConfigViolations(packageRoot: string, cargoHome: string): string[] {
  const files: string[] = []
  let dir = packageRoot
  for (;;) {
    files.push(path.join(dir, '.cargo', 'config.toml'), path.join(dir, '.cargo', 'config'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  files.push(path.join(cargoHome, 'config.toml'), path.join(cargoHome, 'config'))
  const out: string[] = []
  for (const f of files) {
    if (!existsSync(f)) continue
    out.push(...cargoConfigTextViolations(f, readFileSync(f, 'utf8')))
  }
  return out
}
