/**
 * Post-link gates of native strategy artifacts (31 §4.4): parsing and
 * deciding only. The builder runs the tools and feeds their output here.
 *
 * Pure module.
 */

import path from 'node:path'
import type { BuildProfile } from './policy.js'
import { NATIVE_TARGET, STRATEGY_ID_RE } from './policy.js'

/** Protocol version the builder accepts from `describe` (20 §1). */
export const NATIVE_PROTOCOL_VERSION = 2

/** Subcommands of the 20 §1 table. `live` exists only in the real-orders variant (31 §5.5). */
export const NATIVE_SUBCOMMANDS = [
  'describe',
  'schema',
  'selftest',
  'run',
  'run-group',
  'serve',
  'paper',
  'live',
] as const

/**
 * `capabilities.subcommands` of a standard build (20 §1, 31 §5.5): an array
 * of distinct names from the 20 §1 table, including `describe` and
 * `selftest` (which the builder runs) and never `live`. Anything else is a
 * violation, including a missing or mistyped field (00 R14).
 */
export function subcommandViolations(subs: unknown): string[] {
  if (!Array.isArray(subs) || !subs.every((x) => typeof x === 'string'))
    return ['capabilities.subcommands MUST be an array of subcommand names (20 §1)']
  const known: readonly string[] = NATIVE_SUBCOMMANDS
  const out: string[] = []
  for (const x of subs as string[])
    if (!known.includes(x)) out.push(`capabilities.subcommands lists unknown ${JSON.stringify(x)}`)
  if (new Set(subs).size !== subs.length) out.push('capabilities.subcommands has duplicates')
  for (const required of ['describe', 'selftest'])
    if (!subs.includes(required)) out.push(`capabilities.subcommands lacks "${required}"`)
  if (subs.includes('live'))
    out.push('capabilities.subcommands lists "live"; a standard build has no live subcommand')
  return out
}

/**
 * Install names printed by `otool -L <bin>` (31 §4.4 step 3). The first line
 * names the file itself and is skipped; each further line is
 * `<install name> (compatibility version x, current version y)`.
 */
export function parseOtoolL(output: string): string[] {
  const lines = output.split(/\r?\n/)
  const out: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue
    const m = /^(.*?)\s+\(compatibility version [^)]*\)$/.exec(line)
    out.push(m ? m[1]! : line)
  }
  return out
}

/**
 * Parse `native/build/dylib-allowlist.txt`: one absolute install name per
 * line, `#` comments. Every entry MUST be a system library under `/usr/lib/`
 * (31 §4.4 step 3): an allowlist entry outside it is a policy error.
 */
export function parseDylibAllowlist(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue
    if (!line.startsWith('/usr/lib/') || line.includes('..')) {
      throw new Error(`dylib allowlist entry outside /usr/lib: ${line}`)
    }
    out.push(line)
  }
  if (out.length === 0) throw new Error('dylib allowlist is empty')
  return out
}

/** Violations of the dynamic-library gate (31 §4.4 step 3). */
export function dylibViolations(installNames: string[], allowlist: string[]): string[] {
  const allowed = new Set(allowlist)
  const out: string[] = []
  for (const name of installNames) {
    if (name.startsWith('@'))
      out.push(
        `${name}: relative install names (@rpath, @loader_path, @executable_path) are forbidden`,
      )
    else if (name.startsWith('/opt/homebrew/') || name.startsWith('/usr/local/')) {
      out.push(`${name}: Homebrew and /usr/local libraries are forbidden`)
    } else if (!allowed.has(name)) out.push(`${name}: not in native/build/dylib-allowlist.txt`)
  }
  return out
}

/**
 * Host path strings that MUST NOT occur in the binary (31 §4.4 step 4): the
 * home directory, CARGO_HOME, RUSTUP_HOME, the engine root, the package root,
 * the shared target directory, each also as realpath and without the macOS
 * `/private` prefix, plus `/var/folders/` (covers `/private/var/folders`) and
 * any `/Users/` path.
 */
export function pathLeakNeedles(paths: {
  home: string
  cargoHome: string
  rustupHome: string
  engineRoot: string
  packageRoot: string
  targetDir: string
  realpath: (p: string) => string
}): string[] {
  const needles = new Set<string>(['/var/folders/', '/Users/'])
  for (const p of [
    paths.home,
    paths.cargoHome,
    paths.rustupHome,
    paths.engineRoot,
    paths.packageRoot,
    paths.targetDir,
  ]) {
    if (!path.isAbsolute(p) || p === '/')
      throw new Error(`path-leak needle must be an absolute non-root path: ${p}`)
    for (const v of [p, paths.realpath(p)]) {
      needles.add(v)
      if (v.startsWith('/private/')) needles.add(v.slice('/private'.length))
    }
  }
  return [...needles].sort()
}

/** Needles found in the bytes (31 §4.4 step 4). */
export function findPathLeaks(bytes: Uint8Array, needles: string[]): string[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return needles.filter((n) => buf.includes(Buffer.from(n, 'utf8')))
}

export type DescribeSummary = {
  strategyId: string
  protocolVersion: number
  binary: Record<string, unknown>
  capabilities: Record<string, unknown>
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/**
 * Check the `describe` document of 20 §5.1 as 31 §4.4 step 6 requires:
 * `type = "describe"`, `protocolVersion = 2`, `binary.target` is
 * aarch64-apple-darwin, `binary.buildProfile` is the requested profile,
 * `capabilities.realOrders` is false (every builder command here builds the
 * standard variant, 31 §5.5), and `strategy.id` follows the id grammar
 * (30 §4 rule 2). Returns the summary or the list of violations.
 */
export function checkDescribe(
  doc: unknown,
  expect: { profile: BuildProfile },
): { ok: true; summary: DescribeSummary } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(doc)) return { ok: false, errors: ['describe output is not a JSON object'] }
  if (doc['type'] !== 'describe')
    errors.push(`type is ${JSON.stringify(doc['type'])}, expected "describe"`)
  if (doc['protocolVersion'] !== NATIVE_PROTOCOL_VERSION) {
    errors.push(
      `protocolVersion is ${JSON.stringify(doc['protocolVersion'])}, expected ${NATIVE_PROTOCOL_VERSION}`,
    )
  }
  const binary = doc['binary']
  const caps = doc['capabilities']
  const strategy = doc['strategy']
  if (!isRecord(binary)) errors.push('binary is missing')
  else {
    if (binary['target'] !== NATIVE_TARGET) {
      errors.push(
        `binary.target is ${JSON.stringify(binary['target'])}, expected "${NATIVE_TARGET}"`,
      )
    }
    if (binary['buildProfile'] !== expect.profile) {
      errors.push(
        `binary.buildProfile is ${JSON.stringify(binary['buildProfile'])}, expected "${expect.profile}"`,
      )
    }
  }
  if (!isRecord(caps)) errors.push('capabilities is missing')
  else {
    if (caps['realOrders'] !== false) {
      errors.push(
        `capabilities.realOrders is ${JSON.stringify(caps['realOrders'])}; a standard build MUST report false`,
      )
    }
    // 31 §5.5: the standard variant has no `live` subcommand.
    errors.push(...subcommandViolations(caps['subcommands']))
  }
  let id = ''
  if (!isRecord(strategy)) errors.push('strategy is missing')
  else if (typeof strategy['id'] !== 'string' || !STRATEGY_ID_RE.test(strategy['id'])) {
    errors.push(
      `strategy.id ${JSON.stringify(strategy['id'])} does not match ${STRATEGY_ID_RE.source}`,
    )
  } else id = strategy['id']
  if (errors.length > 0 || !isRecord(binary) || !isRecord(caps)) return { ok: false, errors }
  return {
    ok: true,
    summary: {
      strategyId: id,
      protocolVersion: NATIVE_PROTOCOL_VERSION,
      binary,
      capabilities: caps,
    },
  }
}

/** Check the `selftest` result of 20 §5.3 (31 §4.4 step 5): exit 0 and `ok = true`. */
export function checkSelftest(doc: unknown, exitCode: number | null): string[] {
  const errors: string[] = []
  if (exitCode !== 0)
    errors.push(`selftest exited with ${exitCode === null ? 'a signal' : exitCode}`)
  if (!isRecord(doc)) {
    errors.push('selftest output is not a JSON object')
    return errors
  }
  if (doc['type'] !== 'selftest')
    errors.push(`type is ${JSON.stringify(doc['type'])}, expected "selftest"`)
  if (doc['ok'] !== true) {
    const failed = Array.isArray(doc['checks'])
      ? doc['checks']
          .filter((c) => isRecord(c) && c['ok'] !== true)
          .map((c) => (isRecord(c) ? String(c['name']) : '?'))
      : []
    errors.push(
      `selftest reported ok=${JSON.stringify(doc['ok'])}${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`,
    )
  }
  return errors
}

/**
 * Parse the single JSON document a one-shot subcommand prints on stdout
 * (20 G1). Anything else on stdout is an error.
 */
export function parseSingleJsonDocument(stdout: string, what: string): unknown {
  const text = stdout.trim()
  if (text === '') throw new Error(`${what} printed nothing on stdout`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${what} stdout is not exactly one JSON document: ${text.slice(0, 300)}`)
  }
}
