import { asyncBufferFromFile, parquetMetadataAsync, parquetRead } from 'hyparquet'
import type { FileMetaData, SchemaElement } from 'hyparquet'
import { decompress } from 'fzstd'

const compressors = { ZSTD: (input: Uint8Array) => decompress(input) }

import type { CapturedEvent } from '../types.js'
import {
  COMPACT_FORMAT,
  compactColumns,
  decodeCompactPayload,
  envelopeColumns,
  integerText,
  recorderSource,
  requiredString,
  safeInteger,
  type ColumnValues,
} from './compactCodec.js'

/** Inspect the on-disk contract, never a filename or user-selected compatibility mode. */
export function validateCompactMetadata(metadata: FileMetaData): void {
  const values = new Map(metadata.key_value_metadata?.map((item) => [item.key, item.value]))
  if (
    values.get('recorder_schema_version') !== '4' ||
    values.get('recorder_format') !== COMPACT_FORMAT
  )
    throw new Error('Unsupported recorder archive; expected V4 compact format')
  if (metadata.schema[0]?.num_children !== Object.keys(compactColumns).length)
    throw new Error('Invalid compact column count')
  let index = 1
  const next = (): SchemaElement => {
    const element = metadata.schema[index++]
    if (!element) throw new Error('Missing compact schema element')
    return element
  }
  for (const [name, sqlType] of Object.entries(compactColumns)) {
    let element = next()
    if (element.name !== name || element.repetition_type !== 'OPTIONAL')
      throw new Error(`Invalid compact column ${name}`)
    const list = sqlType.endsWith('[]')
    const type = list ? sqlType.slice(0, -2) : sqlType
    if (list) {
      if (element.converted_type !== 'LIST' || element.num_children !== 1)
        throw new Error(`Invalid compact list ${name}`)
      const repeated = next()
      if (
        repeated.name !== 'list' ||
        repeated.repetition_type !== 'REPEATED' ||
        repeated.num_children !== 1
      )
        throw new Error(`Invalid compact list structure ${name}`)
      element = next()
      if (element.name !== 'element' || element.repetition_type !== 'OPTIONAL')
        throw new Error(`Invalid compact list element ${name}`)
    }
    const physical =
      type === 'VARCHAR'
        ? 'BYTE_ARRAY'
        : type === 'BIGINT'
          ? 'INT64'
          : type === 'INTEGER'
            ? 'INT32'
            : 'BOOLEAN'
    if (element.type !== physical || (type === 'VARCHAR' && element.converted_type !== 'UTF8'))
      throw new Error(`Invalid compact physical type ${name}`)
  }
  if (index !== metadata.schema.length) throw new Error('Unexpected compact schema elements')
}

function capturedRow(
  columns: ColumnValues,
  row: number,
  referenceOnly: boolean,
): CapturedEvent | null {
  const value = (name: string) => columns[name]![row]
  if (value('schema_version') !== 4) throw new Error('Unsupported recorder event schema')
  const source = recorderSource(value('source'))
  if (
    referenceOnly &&
    source !== 'bootstrap' &&
    source !== 'chainlink' &&
    source !== 'price_to_beat'
  )
    return null
  const kind = value('kind')
  if (referenceOnly && kind !== null) throw new Error('Reference event must use raw fallback')
  if (
    kind !== null &&
    (typeof kind !== 'string' ||
      source !== (kind.startsWith('btcusdt@') ? 'binance' : 'polymarket') ||
      value('raw_fallback') !== null)
  )
    throw new Error('Invalid compact payload envelope')
  const sequence = integerText(value('sequence'), 'sequence')
  const captureId = requiredString(value('capture_id'), 'capture ID')
  const event: CapturedEvent = {
    schemaVersion: 4,
    captureId,
    sessionId: requiredString(value('session_id'), 'session ID'),
    sequence,
    eventId: `${captureId}:${sequence}`,
    receivedAtMs: safeInteger(value('received_at_ms'), 'receipt time'),
    monotonicNs: integerText(value('monotonic_ns'), 'monotonic time'),
    source,
    connectionId: requiredString(value('connection_id'), 'connection ID'),
    eventType: requiredString(value('event_type'), 'event type'),
    sourceTimeMs:
      value('source_time_ms') === null ? null : safeInteger(value('source_time_ms'), 'source time'),
    detailsJson:
      value('details_json') === null ? null : requiredString(value('details_json'), 'details'),
    rawJson: kind === null ? requiredString(value('raw_fallback'), 'raw fallback') : '',
  }
  if (typeof kind === 'string') {
    const decoded = decodeCompactPayload(kind, columns, row)
    // Replay consumes the typed object directly. Diagnostic JSON is materialized only on demand.
    Object.defineProperty(event, 'decodedPayload', { value: decoded })
    let json: string | undefined
    Object.defineProperty(event, 'rawJson', {
      enumerable: true,
      get: () => (json ??= JSON.stringify(decoded)),
    })
  }
  return event
}

async function* readEvents(
  filename: string,
  referenceOnly: boolean,
): AsyncGenerator<CapturedEvent> {
  // Every slice closes its own read stream; early iterator cancellation retains no file handle.
  const file = await asyncBufferFromFile(filename)
  const metadata = await parquetMetadataAsync(file)
  validateCompactMetadata(metadata)
  const names = Object.keys(referenceOnly ? envelopeColumns : compactColumns)
  let start = 0
  let lastSequence: bigint | null = null
  for (const group of metadata.row_groups) {
    const count = safeInteger(group.num_rows, 'row group count')
    if (count > 16384) throw new Error('Compact row group exceeds recorder limit')
    const end = start + count
    const columns: ColumnValues = {}
    const offsets = new Map<string, number>()
    await parquetRead({
      file,
      metadata,
      compressors,
      utf8: false,
      columns: names,
      rowStart: start,
      rowEnd: end,
      onChunk: ({ columnName, columnData, rowStart, rowEnd }) => {
        if (
          !names.includes(columnName) ||
          rowStart !== (offsets.get(columnName) ?? start) ||
          rowEnd > end ||
          rowEnd <= rowStart ||
          columnData.length !== rowEnd - rowStart
        )
          throw new Error('Unexpected compact column interval')
        offsets.set(columnName, rowEnd)
        if (rowStart === start && rowEnd === end) columns[columnName] = columnData
        else {
          const target = (columns[columnName] ??= new Array<unknown>(count)) as unknown[]
          for (let i = 0; i < columnData.length; i++) target[rowStart - start + i] = columnData[i]
        }
      },
    })
    if (count && names.some((name) => offsets.get(name) !== end))
      throw new Error('Incomplete compact column group')
    for (let row = 0; row < count; row++) {
      const sequence = columns.sequence![row]
      if (
        typeof sequence !== 'bigint' ||
        sequence < 0n ||
        (lastSequence !== null && sequence <= lastSequence)
      )
        throw new Error('Recorder events are not in strictly increasing receive order')
      lastSequence = sequence
      const event = capturedRow(columns, row, referenceOnly)
      if (event) yield event
    }
    start = end
  }
  if (BigInt(start) !== metadata.num_rows) throw new Error('Compact row count mismatch')
}

export function readCapturedEvents(filename: string): AsyncGenerator<CapturedEvent> {
  return readEvents(filename, false)
}

/** Opening-reference admission needs only these raw observations, not the market/depth columns. */
export function readOpeningReferenceEvents(filename: string): AsyncGenerator<CapturedEvent> {
  return readEvents(filename, true)
}
