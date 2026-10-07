import { types } from 'node:util'

/** Versioned JSON-only protocol between retained TypeScript services and the Rust runtime. */
export const NATIVE_PROTOCOL_VERSION = 1 as const
export const NATIVE_ENGINE_NAME = 'polymarket-runtime' as const
export const MAX_NATIVE_REQUEST_BYTES = 64 * 1024 * 1024
/** Count containers within input/result: root object/array is depth one; primitives are zero. */
export const MAX_JSON_CONTAINER_DEPTH = 124

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type NativeRequest = {
  protocolVersion: typeof NATIVE_PROTOCOL_VERSION
  requestId: string
  operation: string
  input: JsonValue
}

export type NativeEngineIdentity = {
  name: typeof NATIVE_ENGINE_NAME
  version: string
  protocolVersion: typeof NATIVE_PROTOCOL_VERSION
}

export type NativeSuccessResponse = {
  protocolVersion: typeof NATIVE_PROTOCOL_VERSION
  requestId: string
  status: 'success'
  engine: NativeEngineIdentity
  result: JsonValue
}

export type NativeFailureResponse = {
  protocolVersion: typeof NATIVE_PROTOCOL_VERSION
  requestId: string | null
  status: 'failed'
  engine: NativeEngineIdentity
  error: { code: string; message: string; retryable: boolean }
}

export type NativeResponse = NativeSuccessResponse | NativeFailureResponse

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

/** serde_json strings require Unicode scalar values, so reject lone UTF-16 surrogates. */
function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

export function validProtocolIdentifier(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    validUnicode(value) &&
    !/^\p{White_Space}*$/u.test(value) &&
    Buffer.byteLength(value, 'utf8') <= maxBytes &&
    !/\p{Cc}/u.test(value)
  )
}

/** Reject values which JSON would silently omit, coerce or serialize as null. */
export function isJsonValue(value: unknown): value is JsonValue {
  type Height = { value: number }
  type Visit = {
    value: unknown
    depth: number
    parent?: Height
    leaving?: Height
  }
  const pending: Visit[] = [{ value, depth: 1 }]
  const active = new WeakSet<object>()
  const visited = new WeakMap<object, number>()
  while (pending.length > 0) {
    const entry = pending.pop()!
    const next = entry.value
    if (next === null || typeof next === 'boolean') continue
    if (typeof next === 'string') {
      if (!validUnicode(next)) return false
      continue
    }
    if (typeof next === 'number') {
      if (!Number.isFinite(next)) return false
      continue
    }
    if (typeof next !== 'object' || next === null || types.isProxy(next)) return false
    if (entry.leaving) {
      active.delete(next)
      visited.set(next, entry.leaving.value)
      if (entry.parent) entry.parent.value = Math.max(entry.parent.value, entry.leaving.value + 1)
      continue
    }
    if (entry.depth > MAX_JSON_CONTAINER_DEPTH || active.has(next)) return false
    const previousHeight = visited.get(next)
    if (previousHeight !== undefined) {
      if (entry.depth + previousHeight - 1 > MAX_JSON_CONTAINER_DEPTH) return false
      if (entry.parent) entry.parent.value = Math.max(entry.parent.value, previousHeight + 1)
      continue
    }
    const array = Array.isArray(next)
    const prototype: unknown = Object.getPrototypeOf(next)
    if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype))
      return false
    // JSON.stringify looks up inherited toJSON before enumerating properties.
    for (let owner: object | null = next; owner !== null; owner = Object.getPrototypeOf(owner)) {
      if (Object.getOwnPropertyDescriptor(owner, 'toJSON')) return false
    }
    if (Object.getOwnPropertySymbols(next).length > 0) return false
    const descriptors = Object.getOwnPropertyDescriptors(next)
    const height: Height = { value: 1 }
    active.add(next)
    pending.push({ ...entry, leaving: height })
    if (array) {
      // Arrays serialize only indexed elements; reject hidden or ignored custom properties.
      const length = next.length
      if (Object.keys(descriptors).length !== length + 1) return false
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)]
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
          return false
        pending.push({ value: descriptor.value, depth: entry.depth + 1, parent: height })
      }
    } else {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!validUnicode(key) || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
          return false
        }
        pending.push({ value: descriptor.value, depth: entry.depth + 1, parent: height })
      }
    }
  }
  return true
}

/** Parse only the transport envelope; individual operations validate their result schemas. */
export function parseNativeResponse(value: unknown): NativeResponse | null {
  if (!record(value) || value.protocolVersion !== NATIVE_PROTOCOL_VERSION) return null
  const engine = value.engine
  if (
    !record(engine) ||
    !onlyKeys(engine, ['name', 'version', 'protocolVersion']) ||
    engine.name !== NATIVE_ENGINE_NAME ||
    !validProtocolIdentifier(engine.version, 128) ||
    engine.protocolVersion !== NATIVE_PROTOCOL_VERSION
  ) {
    return null
  }
  if (value.status === 'success') {
    if (
      !onlyKeys(value, ['protocolVersion', 'requestId', 'status', 'engine', 'result']) ||
      !validProtocolIdentifier(value.requestId, 128) ||
      !Object.hasOwn(value, 'result') ||
      !isJsonValue(value.result)
    ) {
      return null
    }
    return value as NativeSuccessResponse
  }
  if (value.status === 'failed') {
    const error = value.error
    if (
      !onlyKeys(value, ['protocolVersion', 'requestId', 'status', 'engine', 'error']) ||
      !(value.requestId === null || validProtocolIdentifier(value.requestId, 128)) ||
      !record(error) ||
      !onlyKeys(error, ['code', 'message', 'retryable']) ||
      !validProtocolIdentifier(error.code, 128) ||
      typeof error.message !== 'string' ||
      !validUnicode(error.message) ||
      typeof error.retryable !== 'boolean'
    ) {
      return null
    }
    return value as NativeFailureResponse
  }
  return null
}
