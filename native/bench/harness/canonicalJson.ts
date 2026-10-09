// Deterministic-section hashing of `EngineResult` documents (21 §10,
// 16 §13.7).
//
// The deterministic section is the result without `diagnostics`. It is
// hashed from the bytes the binary printed: the parser below keeps every
// number and string lexeme verbatim (no round trip through JS numbers, so
// money tokens are compared exactly, 21 §18) and serializes compactly with
// keys sorted, like the M1 proof's `jq -cS 'del(.diagnostics)'`.

import { createHash } from 'node:crypto'

export type JsonNode =
  | { t: 'obj'; entries: Array<{ key: string; rawKey: string; value: JsonNode }> }
  | { t: 'arr'; items: JsonNode[] }
  | { t: 'lit'; raw: string }

export class JsonSyntaxError extends Error {
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'JsonSyntaxError'
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

/** Parses strict JSON (RFC 8259) keeping lexemes. Duplicate keys are errors. */
export function parseJsonPreserving(text: string): JsonNode {
  let i = 0
  const ws = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++
      else break
    }
  }
  const str = (): string => {
    const start = i
    i++ // opening quote
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c === 0x22) {
        i++
        return text.slice(start, i)
      }
      if (c < 0x20) throw new JsonSyntaxError('control character in string', i)
      if (c === 0x5c) {
        const e = text[i + 1]
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            throw new JsonSyntaxError('bad \\u escape', i)
          }
          i += 6
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2
        } else {
          throw new JsonSyntaxError('bad escape', i)
        }
      } else {
        i++
      }
    }
    throw new JsonSyntaxError('unterminated string', start)
  }
  const value = (depth: number): JsonNode => {
    if (depth > 512) throw new JsonSyntaxError('nesting too deep', i)
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const entries: Array<{ key: string; rawKey: string; value: JsonNode }> = []
      const keys = new Set<string>()
      ws()
      if (text[i] === '}') {
        i++
        return { t: 'obj', entries }
      }
      for (;;) {
        ws()
        if (text[i] !== '"') throw new JsonSyntaxError('expected a key', i)
        const rawKey = str()
        const key = JSON.parse(rawKey) as string
        if (keys.has(key)) throw new JsonSyntaxError(`duplicate key ${rawKey}`, i)
        keys.add(key)
        ws()
        if (text[i] !== ':') throw new JsonSyntaxError('expected ":"', i)
        i++
        entries.push({ key, rawKey, value: value(depth + 1) })
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return { t: 'obj', entries }
        }
        throw new JsonSyntaxError('expected "," or "}"', i)
      }
    }
    if (c === '[') {
      i++
      const items: JsonNode[] = []
      ws()
      if (text[i] === ']') {
        i++
        return { t: 'arr', items }
      }
      for (;;) {
        items.push(value(depth + 1))
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return { t: 'arr', items }
        }
        throw new JsonSyntaxError('expected "," or "]"', i)
      }
    }
    if (c === '"') return { t: 'lit', raw: str() }
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) {
        i += word.length
        return { t: 'lit', raw: word }
      }
    }
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    if (m) {
      i += m[0].length
      return { t: 'lit', raw: m[0] }
    }
    throw new JsonSyntaxError('unexpected character', i)
  }
  const root = value(0)
  ws()
  if (i !== text.length) throw new JsonSyntaxError('trailing data', i)
  return root
}

/** Compact serialization with object keys sorted by code unit order. */
export function canonicalize(node: JsonNode): string {
  switch (node.t) {
    case 'lit':
      return node.raw
    case 'arr':
      return `[${node.items.map(canonicalize).join(',')}]`
    case 'obj': {
      const sorted = [...node.entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      return `{${sorted.map((e) => `${e.rawKey}:${canonicalize(e.value)}`).join(',')}}`
    }
  }
}

function withoutKeys(node: JsonNode, keys: readonly string[]): JsonNode {
  if (node.t !== 'obj') return node
  return { t: 'obj', entries: node.entries.filter((e) => !keys.includes(e.key)) }
}

function child(node: JsonNode, key: string): JsonNode | undefined {
  return node.t === 'obj' ? node.entries.find((e) => e.key === key)?.value : undefined
}

/**
 * Fields that name the binary build rather than the computation. They are
 * dropped from the cross-binary comparison only (an A/B of two builds of
 * the same code must agree on everything else); `resultDigest` hashes them,
 * so it goes too.
 * D-PENDING: 16 §13.7 compares "deterministic result sections" across all
 * Rust rows of a report, but 21 §10 puts `echo.engineVersion` and
 * `echo.engineCommit` inside that section, so two builds can never agree
 * byte for byte. Same-binary repetitions are compared on the full section.
 */
export const BUILD_IDENTITY_ECHO_KEYS = ['engineVersion', 'engineCommit'] as const

export interface ResultSections {
  /** Canonical text of the deterministic section (all but `diagnostics`). */
  deterministic: string
  /** The deterministic section without build identity (cross-binary A/B). */
  crossBinary: string
  /** The parsed result, for reading status and diagnostics. */
  root: JsonNode
}

/** Splits one `EngineResult` document into its comparable sections. */
export function resultSections(stdout: string): ResultSections {
  const root = parseJsonPreserving(stdout)
  if (root.t !== 'obj') throw new JsonSyntaxError('EngineResult must be a JSON object', 0)
  if (!root.entries.some((e) => e.key === 'diagnostics')) {
    throw new JsonSyntaxError('EngineResult has no "diagnostics" member', 0)
  }
  const det = withoutKeys(root, ['diagnostics'])
  const cross: JsonNode =
    det.t === 'obj'
      ? {
          t: 'obj',
          entries: det.entries
            .filter((e) => e.key !== 'resultDigest')
            .map((e) =>
              e.key === 'echo'
                ? { ...e, value: withoutKeys(e.value, BUILD_IDENTITY_ECHO_KEYS) }
                : e,
            ),
        }
      : det
  return { deterministic: canonicalize(det), crossBinary: canonicalize(cross), root }
}

/** Decoded value of a top-level string/number literal path, for reporting. */
export function readLiteral(root: JsonNode, ...path: string[]): unknown {
  let node: JsonNode | undefined = root
  for (const k of path) node = node === undefined ? undefined : child(node, k)
  if (node === undefined || node.t !== 'lit') return undefined
  return JSON.parse(node.raw) as unknown
}

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Digest of a whole run: per-result hashes sorted by `(idx, candidate)`
 * (16 §13.7), one `idx\tcandidate\tsha256` line each.
 */
export function setDigest(
  entries: ReadonlyArray<{ idx: number; candidate: number; sha256: string }>,
): string {
  const lines = [...entries]
    .sort((a, b) => a.idx - b.idx || a.candidate - b.candidate)
    .map((e) => `${e.idx}\t${e.candidate}\t${e.sha256}\n`)
  return sha256Hex(lines.join(''))
}
