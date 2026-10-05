import * as parquet from '@dsnp/parquetjs'

import type { CapturedEvent, RecorderSource } from '../types.js'

const text = { type: 'UTF8' as const, compression: 'GZIP' as const }
const integer = { type: 'INT64' as const, compression: 'GZIP' as const }
export const capturedEventSchema = new parquet.ParquetSchema({
  schema_version: { type: 'INT32', compression: 'GZIP' },
  capture_id: text,
  session_id: text,
  sequence: integer,
  event_id: text,
  received_at_ms: integer,
  monotonic_ns: integer,
  source: text,
  connection_id: text,
  event_type: text,
  source_time_ms: { ...integer, optional: true },
  // Replay scans these verbatim strings; min/max copies in page headers,
  // column indexes and the footer only duplicate potentially large payloads.
  raw_json: { ...text, statistics: false },
  details_json: { ...text, optional: true, statistics: false },
})

export function eventToRow(event: CapturedEvent): Record<string, unknown> {
  return {
    schema_version: event.schemaVersion,
    capture_id: event.captureId,
    session_id: event.sessionId,
    sequence: BigInt(event.sequence),
    event_id: event.eventId,
    received_at_ms: BigInt(event.receivedAtMs),
    monotonic_ns: BigInt(event.monotonicNs),
    source: event.source,
    connection_id: event.connectionId,
    event_type: event.eventType,
    ...(event.sourceTimeMs === null ? {} : { source_time_ms: BigInt(event.sourceTimeMs) }),
    raw_json: event.rawJson,
    ...(event.detailsJson === null ? {} : { details_json: event.detailsJson }),
  }
}

export async function* readCapturedEvents(file: string): AsyncGenerator<CapturedEvent> {
  const reader = await parquet.ParquetReader.openFile(file)
  try {
    const cursor = reader.getCursor()
    for (let value = await cursor.next(); value; value = await cursor.next()) {
      const row = value as Record<string, unknown>
      if (Number(row.schema_version) !== 3) throw new Error('Unsupported recorder schema')
      yield {
        schemaVersion: 3,
        captureId: String(row.capture_id),
        sessionId: String(row.session_id),
        sequence: String(row.sequence),
        eventId: String(row.event_id),
        receivedAtMs: Number(row.received_at_ms),
        monotonicNs: String(row.monotonic_ns),
        source: String(row.source) as RecorderSource,
        connectionId: String(row.connection_id),
        eventType: String(row.event_type),
        sourceTimeMs: row.source_time_ms == null ? null : Number(row.source_time_ms),
        rawJson: String(row.raw_json),
        detailsJson: row.details_json == null ? null : String(row.details_json),
      }
    }
  } finally {
    await reader.close()
  }
}
