import { isCompactPriceChange } from '../../market/priceChangeHashes.js'
import type { CapturedEvent, RecorderSource } from '../types.js'
import { payloadColumns, wireShapes, type WireShape } from './compactShapes.js'

export const COMPACT_FORMAT = 'recorder-v4-compact-1'
export const envelopeColumns = {
  schema_version: 'INTEGER',
  capture_id: 'VARCHAR',
  session_id: 'VARCHAR',
  sequence: 'BIGINT',
  received_at_ms: 'BIGINT',
  monotonic_ns: 'BIGINT',
  source: 'VARCHAR',
  connection_id: 'VARCHAR',
  event_type: 'VARCHAR',
  source_time_ms: 'BIGINT',
  details_json: 'VARCHAR',
  kind: 'VARCHAR',
  raw_fallback: 'VARCHAR',
} as const
export const compactColumns: Readonly<Record<string, string>> = {
  ...envelopeColumns,
  ...Object.fromEntries(
    Object.values(payloadColumns)
      .flat()
      .map((column) => [column.name, `${column.type}${column.list ? '[]' : ''}`]),
  ),
}
const sources = new Set<RecorderSource>([
  'polymarket',
  'binance',
  'chainlink',
  'price_to_beat',
  'market_metadata',
  'control',
  'bootstrap',
])
const maxInt64 = 9_223_372_036_854_775_807n

function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function matches(value: unknown, shape: WireShape): boolean {
  if (shape === 'integer')
    return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
  if (shape === 'string') return typeof value === 'string' && wellFormed(value)
  if (shape === 'boolean') return typeof value === 'boolean'
  if (Array.isArray(shape))
    return Array.isArray(value) && value.every((item) => matches(item, shape[0]!))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = Object.entries(shape)
  return (
    Object.keys(value).length === fields.length &&
    fields.every(
      ([key, field]) =>
        Object.hasOwn(value, key) && matches((value as Record<string, unknown>)[key], field),
    )
  )
}

function atPath(value: unknown, path: readonly string[]): unknown {
  if (!path.length) return value
  if (path[0] === '[]') return (value as unknown[]).map((item) => atPath(item, path.slice(1)))
  return atPath((value as Record<string, unknown>)[path[0]!], path.slice(1))
}

export function integerText(value: unknown, name: string): string {
  const text = typeof value === 'bigint' ? value.toString() : value
  if (typeof text !== 'string' || !/^(0|[1-9]\d*)$/.test(text) || BigInt(text) > maxInt64)
    throw new Error(`Invalid compact ${name}`)
  return text
}
export function safeInteger(value: unknown, name: string): number {
  const n = typeof value === 'bigint' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)
    throw new Error(`Invalid compact ${name}`)
  return n
}
export function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid compact ${name}`)
  return value
}
export function recorderSource(value: unknown): RecorderSource {
  if (!sources.has(value as RecorderSource)) throw new Error('Invalid compact source')
  return value as RecorderSource
}

/** JSONL is a bounded conversion intermediate only; the archive has typed Parquet columns. */
export function compactRow(event: CapturedEvent): Record<string, unknown> {
  if (event.schemaVersion !== 4) throw new Error('Unsupported recorder event schema')
  const sequence = integerText(event.sequence, 'sequence')
  if (event.eventId !== `${event.captureId}:${sequence}`)
    throw new Error('Cannot reconstruct a noncanonical event ID')
  const row: Record<string, unknown> = {
    schema_version: 4,
    capture_id: requiredString(event.captureId, 'capture ID'),
    session_id: requiredString(event.sessionId, 'session ID'),
    sequence,
    received_at_ms: safeInteger(event.receivedAtMs, 'receipt time'),
    monotonic_ns: integerText(event.monotonicNs, 'monotonic time'),
    source: recorderSource(event.source),
    connection_id: requiredString(event.connectionId, 'connection ID'),
    event_type: requiredString(event.eventType, 'event type'),
    source_time_ms:
      event.sourceTimeMs === null ? null : safeInteger(event.sourceTimeMs, 'source time'),
    details_json: event.detailsJson === null ? null : requiredString(event.detailsJson, 'details'),
    kind: null,
    raw_fallback: requiredString(event.rawJson, 'raw payload'),
  }
  let payload: unknown
  try {
    payload = JSON.parse(event.rawJson)
  } catch {
    return row
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return row
  const object = payload as Record<string, unknown>
  const kind =
    event.source === 'polymarket'
      ? object.event_type
      : event.source === 'binance'
        ? object.stream
        : null
  if (
    typeof kind !== 'string' ||
    !Object.hasOwn(wireShapes, kind) ||
    !matches(payload, wireShapes[kind]!)
  )
    return row
  if (kind === 'price_change' && !isCompactPriceChange(payload)) return row
  row.kind = kind
  row.raw_fallback = null
  for (const column of payloadColumns[kind]!) row[column.name] = atPath(payload, column.path)
  return row
}

export { decodeCompactPayload } from './compactPayloadDecoder.js'
export type { ColumnValues } from './compactPayloadDecoder.js'
