/**
 * Host side of the native builder: engine root, tool paths, the sanitized
 * environment every tool runs with, and process helpers (31 §4.5).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { definedPaths, scanToml } from './toml.js'

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
  /** Run cargo builds under `taskpolicy -b` (background QoS, 31 §4.5). */
  backgroundQos: boolean
}

/**
 * Variables passed through to cargo and the toolchain. Everything else is
 * dropped: RUSTFLAGS, CARGO_ENCODED_RUSTFLAGS, CARGO_PROFILE_*, CARGO_BUILD_*
 * (except jobs), RUSTC_WRAPPER, RUSTUP_TOOLCHAIN and friends would silently
 * change or override the pinned build policy (31 §4.2, 00 R14).
 */
const TOOL_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'TMPDIR',
  'CARGO_BUILD_JOBS',
  'DEVELOPER_DIR',
] as const

export function makeHostContext(opts: {
  targetDir?: string
  backgroundQos?: boolean
  rustcRelease: string
}): HostContext {
  const home = os.homedir()
  const cargoHome = path.resolve(process.env['CARGO_HOME'] || path.join(home, '.cargo'))
  const rustupHome = path.resolve(process.env['RUSTUP_HOME'] || path.join(home, '.rustup'))
  const targetDir = path.resolve(
    opts.targetDir ?? path.join(home, '.cache', 'pmb', 'target', opts.rustcRelease),
  )
  const toolEnv: NodeJS.ProcessEnv = {
    LANG: 'C',
    TZ: 'UTC',
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
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
    backgroundQos: opts.backgroundQos ?? false,
  }
}

/** Minimal environment before the host context exists (rustc release lookup). */
export function bootstrapToolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LANG: 'C', TZ: 'UTC' }
  for (const k of [...TOOL_ENV_PASSTHROUGH, 'CARGO_HOME', 'RUSTUP_HOME']) {
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

/** Table roots of a user cargo config that would change the pinned build (31 §4.2). */
const CARGO_CONFIG_FORBIDDEN_ROOTS = ['build', 'target', 'profile', 'env', 'unstable']

/**
 * Cargo merges `.cargo/config.toml` files from the package root upwards and
 * from CARGO_HOME into the build. A file that sets build, target, profile,
 * env or unstable keys would be merged with the rendered policy (rustflags
 * arrays are concatenated), so the build refuses it.
 * D-PENDING: 31 §4 is silent on user cargo config; chose to refuse any such
 * file instead of ignoring it.
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
    let paths: string[]
    try {
      paths = definedPaths(scanToml(readFileSync(f, 'utf8')))
    } catch (err) {
      out.push(
        `${f}: unreadable cargo config (${err instanceof Error ? err.message : String(err)})`,
      )
      continue
    }
    const bad = paths.filter((p) => CARGO_CONFIG_FORBIDDEN_ROOTS.includes(p.split('.')[0]!))
    if (bad.length > 0)
      out.push(`${f}: sets ${bad.join(', ')}, which would change the pinned build policy`)
  }
  return out
}
