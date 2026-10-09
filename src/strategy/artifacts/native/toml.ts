/**
 * Minimal TOML scanning for Cargo manifests and lockfiles.
 *
 * The repository has no TOML parser dependency, and the package rules of
 * 31 §2.2 only need structure (which tables and dotted keys exist, and a few
 * scalar values). Semantic questions (dependencies, targets, features,
 * metadata) are answered by `cargo metadata` instead; this scanner covers
 * what cargo metadata does not expose (`[profile]`, `[patch]`, `[replace]`,
 * `[lints]`). Anything it cannot read is reported, never guessed (00 R14).
 *
 * Pure module.
 */

import { findTomlCommentStart } from './policy.js'

export type TomlEntry = {
  /** Full dotted key path, table prefix included (e.g. `lints.rust.unsafe_code`). */
  path: string
  /** Raw value text (trimmed; multi-line arrays and inline tables are joined). */
  value: string
}

export type TomlItem =
  | { kind: 'table'; path: string; arrayOfTables: boolean }
  | ({ kind: 'entry' } & TomlEntry)

export type TomlScan = {
  /** Every table header path, in order (`[a.b]` and `[[a.b]]` alike). */
  tables: string[]
  entries: TomlEntry[]
  /** Headers and entries interleaved in document order. */
  items: TomlItem[]
}

/** Split a dotted key (`a."b.c".d`) into its parts, removing quotes. */
export function splitDottedKey(key: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < key.length; i++) {
    const c = key[i]!
    if (quote) {
      if (c === quote) quote = null
      else cur += c
    } else if (c === '"' || c === "'") quote = c
    else if (c === '.') {
      parts.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (quote) throw new Error(`unterminated quote in TOML key: ${key}`)
  parts.push(cur.trim())
  if (parts.some((p) => p === '')) throw new Error(`empty segment in TOML key: ${key}`)
  return parts
}

/** Net bracket depth change of a value fragment, ignoring brackets inside strings. */
function bracketDelta(s: string): number {
  let depth = 0
  let quote: '"' | "'" | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote === '"') {
      if (c === '\\') i++
      else if (c === '"') quote = null
    } else if (quote === "'") {
      if (c === "'") quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
  }
  return depth
}

/**
 * Scan a TOML document into table headers and key paths. Multi-line basic
 * or literal strings (`"""`, `'''`) are rejected: Cargo manifests of strategy
 * packages have no reason to use them, and skipping them safely would need a
 * full parser.
 */
export function scanToml(text: string): TomlScan {
  const tables: string[] = []
  const entries: TomlEntry[] = []
  const items: TomlItem[] = []
  const pushEntry = (e: TomlEntry): void => {
    entries.push(e)
    items.push({ kind: 'entry', ...e })
  }
  let table = ''
  let pending: { path: string; value: string; depth: number } | null = null
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!
    if (raw.includes('"""') || raw.includes("'''")) {
      throw new Error(`line ${n + 1}: multi-line strings are not supported in strategy manifests`)
    }
    const cut = findTomlCommentStart(raw)
    const line = (cut === -1 ? raw : raw.slice(0, cut)).trim()
    if (pending) {
      pending.value += ` ${line}`
      pending.depth += bracketDelta(line)
      if (pending.depth <= 0) {
        pushEntry({ path: pending.path, value: pending.value.trim() })
        pending = null
      }
      continue
    }
    if (line === '') continue
    const header = /^\[\[?\s*(.+?)\s*\]?\]$/.exec(line)
    if (header && line.startsWith('[')) {
      table = splitDottedKey(header[1]!).join('.')
      tables.push(table)
      items.push({ kind: 'table', path: table, arrayOfTables: line.startsWith('[[') })
      continue
    }
    const eq = indexOfTopLevelEquals(line)
    if (eq === -1) throw new Error(`line ${n + 1}: cannot read TOML line: ${raw}`)
    const key = splitDottedKey(line.slice(0, eq)).join('.')
    const value = line.slice(eq + 1).trim()
    const path = table === '' ? key : `${table}.${key}`
    const depth = bracketDelta(value)
    if (depth > 0) pending = { path, value, depth }
    else pushEntry({ path, value })
  }
  if (pending) throw new Error(`unterminated value for ${pending.path}`)
  return { tables, entries, items }
}

function indexOfTopLevelEquals(line: string): number {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '=') return i
  }
  return -1
}

/** Every path a scan defines: table headers and full key paths. */
export function definedPaths(scan: TomlScan): string[] {
  return [...scan.tables, ...scan.entries.map((e) => e.path)]
}

/** Value of a basic or literal TOML string (`"x"` or `'x'`), else null. */
export function tomlStringValue(value: string): string | null {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value)
  if (!m) return null
  return m[1]!.replace(/\\(.)/g, '$1')
}

export type LockPackage = {
  name: string
  version: string
  /** Absent for path packages. */
  source: string | null
  checksum: string | null
}

/**
 * Parse the `[[package]]` entries of a Cargo.lock (31 §3 item 3). Cargo
 * writes lockfiles in a fixed shape; an entry without name or version is an
 * error.
 */
export function parseCargoLock(text: string): LockPackage[] {
  const out: LockPackage[] = []
  let cur: Partial<LockPackage> | null = null
  const flush = (): void => {
    if (!cur) return
    if (!cur.name || !cur.version) throw new Error('Cargo.lock [[package]] without name or version')
    out.push({
      name: cur.name,
      version: cur.version,
      source: cur.source ?? null,
      checksum: cur.checksum ?? null,
    })
    cur = null
  }
  for (const item of scanToml(text).items) {
    if (item.kind === 'table') {
      flush()
      if (item.path === 'package' && item.arrayOfTables) cur = {}
      continue
    }
    if (!cur) continue
    const field = item.path.slice('package.'.length)
    const s = tomlStringValue(item.value)
    if (s === null) continue
    if (field === 'name') cur.name = s
    else if (field === 'version') cur.version = s
    else if (field === 'source') cur.source = s
    else if (field === 'checksum') cur.checksum = s
  }
  flush()
  return out
}

/**
 * Lock-subset rule (31 §3 item 3): every package of the strategy lock that
 * has a source (registry or git) MUST appear in the engine lock with the same
 * name, version, source and checksum. Path packages (no source) are the
 * strategy package itself, pmb-sdk and the engine crates. Returns violations.
 */
export function lockSubsetViolations(pkgLock: LockPackage[], engineLock: LockPackage[]): string[] {
  const key = (p: LockPackage): string => `${p.name}\u0000${p.version}\u0000${p.source ?? ''}`
  const engine = new Map<string, LockPackage>()
  for (const p of engineLock) engine.set(key(p), p)
  const out: string[] = []
  for (const p of pkgLock) {
    if (p.source === null) continue
    const e = engine.get(key(p))
    if (!e) {
      out.push(`${p.name} ${p.version} (${p.source}) is not in native/Cargo.lock`)
    } else if ((e.checksum ?? null) !== (p.checksum ?? null)) {
      out.push(
        `${p.name} ${p.version}: checksum ${p.checksum ?? '<none>'} differs from native/Cargo.lock (${e.checksum ?? '<none>'})`,
      )
    }
  }
  return out
}
