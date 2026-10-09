/**
 * CLI glue of the Rust branch of `strategy:publish` and `strategy:check`
 * (31 §7). The language is detected from a `Cargo.toml` with
 * `[package.metadata.pmb]` in `--repo`, or from a `.rs` entrypoint (31 §7);
 * everything else goes to the unchanged TS path.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { NativeBuildError } from './builder.js'
import { publishNativeLocalOnly, runNativeCheck } from './pipeline.js'
import { definedPaths, scanToml } from './toml.js'

/** True when `dir` holds a Cargo.toml with `[package.metadata.pmb]` (31 §7). */
export function isRustStrategyPackage(dir: string): boolean {
  const manifest = path.join(dir, 'Cargo.toml')
  if (!existsSync(manifest)) return false
  const text = readFileSync(manifest, 'utf8')
  try {
    return definedPaths(scanToml(text)).some(
      (p) => p === 'package.metadata.pmb' || p.startsWith('package.metadata.pmb.'),
    )
  } catch {
    // Unreadable for the scanner: detect the header literally; the builder
    // then reports the manifest problem loudly.
    return /^\s*\[\s*package\.metadata\.pmb\s*\]/m.test(text)
  }
}

/** Value of `--name <v>` or `--name=<v>` in argv, else null. */
export function argValue(argv: string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === name) return argv[i + 1] ?? null
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1)
  }
  return null
}

/**
 * Whether a `strategy:publish` invocation is the Rust branch: `--bin`,
 * `--local-only`, a `.rs` entrypoint, or a `--repo` that is a Rust strategy
 * package. The TS path never accepts these, so detection cannot steal a
 * valid TS invocation.
 */
export function isNativePublishInvocation(argv: string[]): boolean {
  if (argv.some((a) => a === '--bin' || a.startsWith('--bin=') || a === '--local-only')) return true
  const entry = argValue(argv, '--entrypoint')
  if (entry !== null && entry.endsWith('.rs')) return true
  const repo = argValue(argv, '--repo')
  return repo !== null && isRustStrategyPackage(path.resolve(repo))
}

/** Whether a `strategy:check` invocation targets a Rust strategy package. */
export function isNativeCheckInvocation(argv: string[]): boolean {
  const repo = argValue(argv, '--repo')
  return repo !== null && isRustStrategyPackage(path.resolve(repo))
}

export type NativePublishArgs = {
  repo: string
  bin: string
  localOnly: boolean
  allowDirty: boolean
  skipChecks: boolean
  parityCheck: boolean
  targetDir: string | null
  backgroundQos: boolean
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

const PUBLISH_USAGE =
  'usage: npm run strategy:publish -- --local-only --repo <package dir> (--bin <name> | --entrypoint src/bin/<name>.rs) [--allow-dirty] [--skip-checks] [--parity-check] [--target-dir <dir>] [--qos background|default]'

/** Parse the Rust publish flags (31 §7.2). Unknown flags are errors (00 R14). */
export function parseNativePublishArgs(argv: string[]): NativePublishArgs {
  let repo: string | null = null
  let bin: string | null = null
  let entrypoint: string | null = null
  let targetDir: string | null = null
  let qos: string | null = null
  const flags = { localOnly: false, allowDirty: false, skipChecks: false, parityCheck: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const eq = a.indexOf('=')
    const name = a.startsWith('--') && eq !== -1 ? a.slice(0, eq) : a
    const takeValue = (): string => {
      const v = eq !== -1 && a.startsWith('--') ? a.slice(eq + 1) : argv[++i]
      if (v === undefined || v === '')
        throw new UsageError(`${name} needs a value\n${PUBLISH_USAGE}`)
      return v
    }
    if (name === '--repo') repo = takeValue()
    else if (name === '--bin') bin = takeValue()
    else if (name === '--entrypoint') entrypoint = takeValue()
    else if (name === '--target-dir') targetDir = takeValue()
    else if (name === '--qos') qos = takeValue()
    else if (a === '--local-only') flags.localOnly = true
    else if (a === '--allow-dirty') flags.allowDirty = true
    else if (a === '--skip-checks') flags.skipChecks = true
    else if (a === '--parity-check') flags.parityCheck = true
    else if (name === '--profile' || name === '--features' || name === '--release') {
      throw new UsageError(
        `${name} is refused: every publish builds the artifact profile of the standard variant (31 §7.2 step 3, §5.5)`,
      )
    } else throw new UsageError(`unknown argument: ${a}\n${PUBLISH_USAGE}`)
  }
  if (!repo) throw new UsageError(PUBLISH_USAGE)
  if (bin !== null && entrypoint !== null)
    throw new UsageError('--bin and --entrypoint are mutually exclusive')
  if (entrypoint !== null) {
    const m = /^(?:\.\/)?src\/bin\/([A-Za-z0-9_-]+)\.rs$/.exec(entrypoint)
    if (!m)
      throw new UsageError(
        `--entrypoint must be src/bin/<name>.rs relative to --repo (got ${entrypoint})`,
      )
    bin = m[1]!
  }
  if (bin === null) throw new UsageError(PUBLISH_USAGE)
  if (qos !== null && qos !== 'background' && qos !== 'default')
    throw new UsageError(`--qos must be background or default (got ${qos})`)
  return {
    repo: path.resolve(repo),
    bin,
    targetDir: targetDir === null ? null : path.resolve(targetDir),
    backgroundQos: qos === 'background',
    ...flags,
  }
}

const CHECK_USAGE =
  'usage: npm run strategy:check -- --repo <package dir> [--target-dir <dir>] [--qos background|default]'

export function parseNativeCheckArgs(argv: string[]): {
  repo: string
  targetDir: string | null
  backgroundQos: boolean
} {
  let repo: string | null = null
  let targetDir: string | null = null
  let qos: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const eq = a.indexOf('=')
    const name = a.startsWith('--') && eq !== -1 ? a.slice(0, eq) : a
    const takeValue = (): string => {
      const v = eq !== -1 && a.startsWith('--') ? a.slice(eq + 1) : argv[++i]
      if (v === undefined || v === '') throw new UsageError(`${name} needs a value\n${CHECK_USAGE}`)
      return v
    }
    if (name === '--repo') repo = takeValue()
    else if (name === '--target-dir') targetDir = takeValue()
    else if (name === '--qos') qos = takeValue()
    else throw new UsageError(`unknown argument: ${a}\n${CHECK_USAGE}`)
  }
  if (!repo) throw new UsageError(CHECK_USAGE)
  if (qos !== null && qos !== 'background' && qos !== 'default')
    throw new UsageError(`--qos must be background or default (got ${qos})`)
  return {
    repo: path.resolve(repo),
    targetDir: targetDir === null ? null : path.resolve(targetDir),
    backgroundQos: qos === 'background',
  }
}

/** Exit code: 0 ok, 1 build or gate failure, 2 usage error. */
export async function runNativePublishCli(argv: string[]): Promise<number> {
  const prefix = '[strategy:publish]'
  let args: NativePublishArgs
  try {
    args = parseNativePublishArgs(argv)
  } catch (err) {
    console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
  if (!args.localOnly) {
    // 31 §7.5: until M3a no native artifact is uploaded or recorded in any database.
    console.error(
      `${prefix} Rust packages publish only with --local-only until M3a (31 §7.5); full publish (R2 + strategy_artifacts row) is not implemented`,
    )
    return 2
  }
  try {
    // 31 §7.2 step 5: the id MUST NOT collide with a TS registry id. Loaded
    // lazily: importing the registry loads every TS strategy.
    const { strategyRegistry } = await import('../../strategyRegistry.js')
    const results = publishNativeLocalOnly({
      packageDir: args.repo,
      bin: args.bin,
      allowDirty: args.allowDirty,
      skipChecks: args.skipChecks,
      parityCheck: args.parityCheck,
      ...(args.targetDir !== null ? { targetDir: args.targetDir } : {}),
      backgroundQos: args.backgroundQos,
      idCollision: (id) =>
        Object.prototype.hasOwnProperty.call(strategyRegistry, id)
          ? `strategy id ${JSON.stringify(id)} collides with a TS registry strategy (31 §7.2 step 5, 30 §4 rule 2)`
          : null,
    })
    for (const r of results) {
      console.log(
        `${prefix} ${r.profile}: ${r.strategyId}${r.alreadyCached ? ' (already in the local cache)' : ''}`,
      )
      console.log(`${prefix}   sha256   ${r.sha256}`)
      console.log(`${prefix}   path     ${r.binaryPath}`)
      console.log(`${prefix}   manifest ${r.manifestPath}`)
    }
    return 0
  } catch (err) {
    console.error(
      `${prefix} ${err instanceof NativeBuildError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    )
    return 1
  }
}

export function runNativeCheckCli(argv: string[]): number {
  try {
    const args = parseNativeCheckArgs(argv)
    const { ok } = runNativeCheck({
      packageDir: args.repo,
      ...(args.targetDir !== null ? { targetDir: args.targetDir } : {}),
      backgroundQos: args.backgroundQos,
    })
    return ok ? 0 : 1
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`[strategy:check] ${err.message}`)
      return 2
    }
    console.error(
      `[strategy:check] ${err instanceof NativeBuildError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    )
    return 1
  }
}
