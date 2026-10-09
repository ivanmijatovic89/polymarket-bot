/**
 * Canonical JSON and the contract hashes (21 §6.1, §3), the TS half of a
 * cross-language contract: `pmb-contract` (Rust, `canonical.rs`) computes the
 * same bytes, and `native/contract/fixtures/hashes.json` pins both results
 * (21 §3 CI item 6, 60 §7.2 "modelConfigSha256 canonical JSON").
 *
 * Canonical JSON = keys sorted bytewise at every level, array order kept, no
 * whitespace. Numbers are safe integers only (no floats, no -0, §18 N1/N2).
 */
import { createHash } from 'node:crypto'

/** How strings are written (21 §6.1 vs the schema bundle of §3). */
export type CanonicalMode =
  /**
   * ModelConfig (21 §6.1): every string and key is printable ASCII without
   * `"` or `\`, so no escaping can differ between serializers.
   */
  | 'strict'
  /**
   * Schema bundle (`contractSha256`, 21 §3): strings are escaped exactly as
   * `JSON.stringify` and serde_json both do; keys must still be ASCII, because
   * JS sorts UTF-16 units and Rust sorts UTF-8 bytes, which agree on ASCII.
   */
  | 'escaped'

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(`not canonicalizable: ${message}`)
    this.name = 'CanonicalJsonError'
  }
}

const PLAIN_ASCII = /^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/
const ASCII = /^[\x00-\x7f]*$/

function writeString(s: string, mode: CanonicalMode, isKey: boolean): string {
  if (mode === 'strict') {
    if (!PLAIN_ASCII.test(s)) {
      throw new CanonicalJsonError(
        `${isKey ? 'key' : 'string'} ${JSON.stringify(s)} is not printable ASCII without quote or backslash`,
      )
    }
    return `"${s}"`
  }
  if (isKey && !ASCII.test(s)) {
    throw new CanonicalJsonError(`key ${JSON.stringify(s)} is not ASCII`)
  }
  return JSON.stringify(s)
}

function write(value: unknown, mode: CanonicalMode, out: string[]): void {
  if (value === null) {
    out.push('null')
  } else if (typeof value === 'boolean') {
    out.push(value ? 'true' : 'false')
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new CanonicalJsonError(
        `number ${String(value)} (only safe integers, no -0; 21 §6.1, §18 N1/N2)`,
      )
    }
    out.push(String(value))
  } else if (typeof value === 'string') {
    out.push(writeString(value, mode, false))
  } else if (Array.isArray(value)) {
    out.push('[')
    value.forEach((item, i) => {
      if (i > 0) out.push(',')
      write(item, mode, out)
    })
    out.push(']')
  } else if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>
    // Default sort compares UTF-16 code units, which is bytewise on ASCII keys
    // (non-ASCII keys are rejected by writeString).
    const keys = Object.keys(record).sort()
    out.push('{')
    keys.forEach((k, i) => {
      if (i > 0) out.push(',')
      out.push(writeString(k, mode, true), ':')
      write(record[k], mode, out)
    })
    out.push('}')
  } else {
    throw new CanonicalJsonError(`unsupported value of type ${typeof value}`)
  }
}

/** Canonical JSON text of a parsed JSON value (21 §6.1). */
export function canonicalJson(value: unknown, mode: CanonicalMode = 'strict'): string {
  const out: string[] = []
  write(value, mode, out)
  return out.join('')
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * `modelConfigSha256`: sha256 of the canonical UTF-8 bytes of a ModelConfig
 * (21 §6.1). The argument is the parsed JSON object, e.g. a run row's
 * `model_config` or the resolver's output.
 */
export function modelConfigSha256(modelConfig: unknown): string {
  return sha256Hex(canonicalJson(modelConfig, 'strict'))
}

/**
 * `contractSha256` (21 §3): sha256 over the schema bundle, files sorted by
 * name, each in canonical JSON, joined by `\n`.
 */
export function contractSha256(files: ReadonlyArray<{ name: string; schema: unknown }>): string {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return sha256Hex(sorted.map((f) => canonicalJson(f.schema, 'escaped')).join('\n'))
}
