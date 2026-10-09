import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './cell.js'

/**
 * Oracle pin and oracle tree (native/spec/60-verification.md §2.2 OR-1–OR-3)
 * and the environment audit of OR-7.
 */

export const PARITY_DIR = path.join(REPO_ROOT, 'native', 'parity')
export const ENGINE_PATHS_FILE = path.join(PARITY_DIR, 'engine-paths.txt')
export const ORACLE_ALLOWLIST_FILE = path.join(PARITY_DIR, 'oracle-allowlist.txt')
export const ORACLE_ENV_ALLOWLIST_FILE = path.join(PARITY_DIR, 'oracle-env-allowlist.txt')

export type EnginePaths = { engine: string[]; inputFormat: string[] }

function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
}

/** Parse `engine-paths.txt` (OR-2): `[engine]` and `[input-format]` sections. */
export function parseEnginePaths(text: string): EnginePaths {
  const out: EnginePaths = { engine: [], inputFormat: [] }
  let section: keyof EnginePaths | null = null
  for (const line of contentLines(text)) {
    if (line === '[engine]') section = 'engine'
    else if (line === '[input-format]') section = 'inputFormat'
    else if (line.startsWith('[')) throw new Error(`engine-paths: unknown section ${line}`)
    else if (!section) throw new Error(`engine-paths: path ${line} outside a section`)
    else out[section].push(line)
  }
  if (out.engine.length === 0) throw new Error('engine-paths: empty [engine] section')
  return out
}

export function readEnginePaths(file = ENGINE_PATHS_FILE): EnginePaths {
  return parseEnginePaths(readFileSync(file, 'utf8'))
}

/** Parse `oracle-allowlist.txt` (OR-3): one file per line, a trailing `/` allows a directory. */
export function parseOracleAllowlist(text: string): string[] {
  return contentLines(text)
}

export function isAllowlisted(file: string, allowlist: readonly string[]): boolean {
  return allowlist.some((a) => (a.endsWith('/') ? file.startsWith(a) : file === a))
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

/**
 * OR-1: the oracle pin is the `origin/main` commit last merged into the
 * implementation branch, i.e. `git merge-base HEAD origin/main`, unless given.
 */
export function resolvePin(explicit?: string): string {
  return git(['rev-parse', '--verify', explicit ?? git(['merge-base', 'HEAD', 'origin/main'])])
}

export type OracleTreeCheck = {
  pin: string
  head: string
  /** Engine-path files changed between the pin and HEAD. */
  changed: string[]
  /** Changed files not in the allowlist. */
  disallowed: string[]
  workingTreeClean: boolean
  /** OR-3: only allowlisted engine-path changes and a clean working tree. */
  oracleTreeClean: boolean
}

/** OR-3 check: `git diff --name-only <pin> HEAD -- <engine paths>` ⊆ allowlist, and a clean tree. */
export function checkOracleTree(
  pin: string,
  paths: EnginePaths,
  allowlist: readonly string[],
): OracleTreeCheck {
  const head = git(['rev-parse', 'HEAD'])
  const all = [...paths.engine, ...paths.inputFormat]
  const changed = git(['diff', '--name-only', pin, 'HEAD', '--', ...all])
    .split('\n')
    .filter(Boolean)
  const disallowed = changed.filter((f) => !isAllowlisted(f, allowlist))
  const workingTreeClean = git(['status', '--porcelain']) === ''
  return {
    pin,
    head,
    changed,
    disallowed,
    workingTreeClean,
    oracleTreeClean: disallowed.length === 0 && workingTreeClean,
  }
}

/** OR-12 cache-key component: git tree (or blob) hash of each engine path at a commit. */
export function engineTreeHashes(commit: string, paths: EnginePaths): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of [...paths.engine, ...paths.inputFormat])
    out[p] = git(['rev-parse', `${commit}:${p}`])
  return out
}

// ---------------------------------------------------------------------------
// OR-7 environment audit

export type EnvRead = { file: string; line: number; name: string | null; text: string }

const ENV_PATTERNS: RegExp[] = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
  // env helper calls with a literal name, e.g. envInt('BACKTEST_...', 0)
  /\benv(?:Int|Num|Number|Bool|Boolean|String|Str|Flag|Ms)?\(\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g,
]
const DYNAMIC_ENV = /process\.env\[\s*(?!['"`])/g

/** Every env read in a source text: literal names, and dynamic `process.env[expr]` (name null). */
export function scanEnvReads(file: string, text: string): EnvRead[] {
  const out: EnvRead[] = []
  const lines = text.split('\n')
  lines.forEach((lineText, i) => {
    const trimmed = lineText.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return
    for (const re of ENV_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(lineText)) !== null)
        out.push({ file, line: i + 1, name: m[1]!, text: trimmed })
    }
    DYNAMIC_ENV.lastIndex = 0
    if (DYNAMIC_ENV.test(lineText)) out.push({ file, line: i + 1, name: null, text: trimmed })
  })
  return out
}

export type EnvAllowlist = { vars: Map<string, string>; dynamic: Map<string, string> }

export function parseEnvAllowlist(text: string): EnvAllowlist {
  const vars = new Map<string, string>()
  const dynamic = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const reason = line.includes('#') ? line.slice(line.indexOf('#') + 1).trim() : ''
    const [kind, value] = line.replace(/#.*$/, '').trim().split(/\s+/)
    if (!value || !reason)
      throw new Error(`oracle env allowlist: "${line}" needs a value and a # reason`)
    if (kind === 'var') vars.set(value, reason)
    else if (kind === 'dynamic') dynamic.set(value, reason)
    else throw new Error(`oracle env allowlist: unknown kind ${String(kind)}`)
  }
  return { vars, dynamic }
}

export type EnvAuditResult = {
  reads: EnvRead[]
  knobs: string[]
  violations: EnvRead[]
}

/** OR-7: every env read is an OR-7 knob or allowlisted as result-neutral; dynamic reads only in allowlisted helpers. */
export function auditEnvReads(
  reads: readonly EnvRead[],
  knobs: readonly string[],
  allow: EnvAllowlist,
): EnvAuditResult {
  const knobSet = new Set(knobs)
  const violations = reads.filter((r) =>
    r.name === null ? !allow.dynamic.has(r.file) : !knobSet.has(r.name) && !allow.vars.has(r.name),
  )
  return { reads: [...reads], knobs: [...knobs], violations }
}

/** All non-test `.ts` files under the given repo-relative paths. */
export function listSourceFiles(paths: readonly string[]): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    const abs = path.join(REPO_ROOT, rel)
    if (!existsSync(abs)) return
    const st = statSync(abs)
    if (st.isFile()) {
      if (rel.endsWith('.ts') && !rel.endsWith('.test.ts')) out.push(rel)
      return
    }
    for (const name of readdirSync(abs).sort()) walk(path.posix.join(rel, name))
  }
  for (const p of paths) walk(p)
  return out
}
