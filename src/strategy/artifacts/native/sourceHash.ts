/**
 * Source hash (31 §5.2) and engine source set (31 §5.3) of native strategy
 * artifacts: dep-info parsing, file classification, canonical JSON.
 *
 * Pure module: callers read files and run git; this module only decides.
 */

import { createHash } from 'node:crypto'
import path from 'node:path'

/** sha256 hex of a string or bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Canonical JSON (31 §5.2): object keys sorted by UTF-16 code unit order
 * (identical to byte order for the ASCII keys used here), no whitespace.
 * Only plain JSON values are accepted; anything else is an error.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = obj[k]
      if (v === undefined) throw new Error(`canonicalJson: undefined value at key ${k}`)
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`)
    }
    return `{${parts.join(',')}}`
  }
  throw new Error(`canonicalJson: unsupported value of type ${typeof value}`)
}

/** Byte-order comparison of two strings (code unit order; paths here are ASCII). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Parse a Makefile-style dep-info file as written by cargo next to the output
 * (`target/<triple>/<profile>/<bin>.d`): `<target>: <dep> <dep> ...`, spaces
 * inside paths escaped as `\ `, optional `\` line continuations.
 */
export function parseDepInfo(text: string): { target: string; deps: string[] } {
  const joined = text.replace(/\\\r?\n/g, ' ')
  const firstLine = joined.split(/\r?\n/).find((l) => l.trim() !== '')
  if (!firstLine) throw new Error('empty dep-info file')
  const tokens: string[] = []
  let cur = ''
  for (let i = 0; i < firstLine.length; i++) {
    const c = firstLine[i]!
    if (c === '\\' && i + 1 < firstLine.length && firstLine[i + 1] === ' ') {
      cur += ' '
      i++
    } else if (c === ' ' || c === '\t') {
      if (cur !== '') tokens.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur !== '') tokens.push(cur)
  const head = tokens.shift()
  if (!head || !head.endsWith(':'))
    throw new Error(`malformed dep-info: ${firstLine.slice(0, 200)}`)
  return { target: head.slice(0, -1), deps: tokens }
}

export type SourceRole = 'engine' | 'strategy'

/** One `files` entry of the source hash: `[role, relativePath, sha256]` (31 §5.2). */
export type SourceFileEntry = [SourceRole, string, string]

export type DepInfoRoots = {
  /** Engine checkout root (repository root holding `native/`), realpath. */
  engineRoot: string
  /** Strategy package root, realpath. */
  packageRoot: string
  /** Roots whose files are excluded from `files` because a lock or toolchain pins them. */
  excludedRoots: string[]
}

function isUnder(file: string, root: string): boolean {
  const rel = path.relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Classify dep-info entries (31 §5.2): files under the package root are
 * `strategy` (checked first: an in-repo package lies inside the engine root),
 * files under the engine root are `engine`, files under the registry cache or
 * the toolchain are excluded, anything else is an error the caller reports.
 */
export function classifyDepInfo(
  deps: string[],
  roots: DepInfoRoots,
): { files: Array<[SourceRole, string, string]>; outside: string[] } {
  const files: Array<[SourceRole, string, string]> = []
  const outside: string[] = []
  for (const dep of deps) {
    if (!path.isAbsolute(dep)) {
      outside.push(dep)
      continue
    }
    const abs = path.normalize(dep)
    if (isUnder(abs, roots.packageRoot)) {
      files.push(['strategy', toPosix(path.relative(roots.packageRoot, abs)), abs])
    } else if (isUnder(abs, roots.engineRoot)) {
      files.push(['engine', toPosix(path.relative(roots.engineRoot, abs)), abs])
    } else if (roots.excludedRoots.some((r) => isUnder(abs, r))) {
      continue
    } else outside.push(dep)
  }
  return { files, outside }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/** The source-hash input object of 31 §5.2. */
export type SourceHashInput = {
  v: 1
  target: string
  profile: string
  /** Full `rustc -vV` output. */
  rustc: string
  deploymentTarget: string
  /** sha256 of the unrendered native/build/artifact-build.toml. */
  buildConfig: string
  /** sha256 of the package Cargo.lock. */
  lock: string
  files: SourceFileEntry[]
}

/** Sort and dedupe `files` entries by (role, path); conflicting hashes are an error. */
export function normalizeFileEntries(entries: SourceFileEntry[]): SourceFileEntry[] {
  const byKey = new Map<string, SourceFileEntry>()
  for (const e of entries) {
    const k = `${e[0]}\u0000${e[1]}`
    const prev = byKey.get(k)
    if (prev && prev[2] !== e[2]) throw new Error(`conflicting hashes for ${e[0]}:${e[1]}`)
    byKey.set(k, e)
  }
  return [...byKey.values()].sort(
    (a, b) => compareStrings(a[0], b[0]) || compareStrings(a[1], b[1]),
  )
}

/** source_hash = sha256 of the canonical JSON of the input (31 §5.2). */
export function computeSourceHash(input: SourceHashInput): string {
  return sha256Hex(canonicalJson({ ...input, files: normalizeFileEntries(input.files) }))
}

/**
 * Engine source set membership (31 §5.3): files under `native/crates/`
 * except `<crate>/tests/**`, `<crate>/benches/**` and `*.md`, plus
 * `native/Cargo.toml`, `native/Cargo.lock`, `native/rust-toolchain.toml`
 * and `native/build/**`. Paths are repository-relative with `/`.
 */
export function isEngineSourcePath(rel: string): boolean {
  if (
    rel === 'native/Cargo.toml' ||
    rel === 'native/Cargo.lock' ||
    rel === 'native/rust-toolchain.toml'
  ) {
    return true
  }
  if (rel.startsWith('native/build/')) return true
  if (!rel.startsWith('native/crates/')) return false
  if (rel.toLowerCase().endsWith('.md')) return false
  const parts = rel.split('/')
  // native/crates/<crate>/<dir>/...
  const dir = parts[3]
  if (parts.length > 4 && (dir === 'tests' || dir === 'benches')) return false
  return true
}

/** Git pathspecs of the engine source set, for `git log` and `git status` (31 §5.3). */
export const ENGINE_SOURCE_PATHSPECS = [
  'native/crates',
  'native/Cargo.toml',
  'native/Cargo.lock',
  'native/rust-toolchain.toml',
  'native/build',
  ':(glob,exclude)native/crates/*/tests/**',
  ':(glob,exclude)native/crates/*/benches/**',
  ':(glob,exclude)native/crates/**/*.md',
  ':(glob,exclude)native/crates/**/*.MD',
] as const

/**
 * PMB_ENGINE_SOURCE_HASH (31 §5.3): sha256 over the sorted
 * `[relativePath, sha256]` list.
 * D-PENDING: 31 §5.3 does not fix the serialization of that list; chose the
 * canonical JSON array of `[path, sha256]` pairs sorted by path, as in §5.2.
 */
export function computeEngineSourceHash(entries: Array<[string, string]>): string {
  const sorted = [...entries].sort((a, b) => compareStrings(a[0], b[0]))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]![0] === sorted[i - 1]![0])
      throw new Error(`duplicate engine source path ${sorted[i]![0]}`)
  }
  return sha256Hex(canonicalJson(sorted))
}
