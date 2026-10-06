import { DuckDBInstance } from '@duckdb/node-api'
import { randomUUID } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { sqlQuote } from '../../utils/duckdb.js'
import type { CapturedEvent } from '../types.js'
import { compactColumns, compactRow, COMPACT_FORMAT } from './compactCodec.js'
import { MAX_LINE_BYTES } from './journalReader.js'

/** Called in the credential-free finalizer, never on the feed ingestion thread. */
export async function writeCapturedEvents(
  file: string,
  events: AsyncIterable<CapturedEvent> | Iterable<CapturedEvent>,
  options: { marketSlug?: string; rowGroupSize?: number } = {},
): Promise<{ rows: number; firstSequence: string | null; lastSequence: string | null }> {
  const id = randomUUID()
  const intermediate = path.join(path.dirname(file), `compact-${id}.jsonl.tmp`)
  const spill = path.join(path.dirname(file), `compact-${id}.duckdb.tmp`)
  let rows = 0
  let firstSequence: string | null = null
  let lastSequence: string | null = null
  const requestedSize = options.rowGroupSize ?? 8192
  if (!Number.isSafeInteger(requestedSize) || requestedSize < 1 || requestedSize > 8192)
    throw new Error('Invalid recorder row group size')
  const rowGroupSize = Math.max(2048, requestedSize)
  let db: DuckDBInstance | undefined
  try {
    // Open before consuming the generator: a synchronous validation failure must
    // not race a delayed stream open and recreate the file after cleanup.
    const intermediateHandle = await open(intermediate, 'wx', 0o600)
    try {
      await pipeline(
        (async function* () {
          for await (const event of events) {
            const row = compactRow(event)
            if (lastSequence !== null && BigInt(event.sequence) <= BigInt(lastSequence))
              throw new Error('Journal event ordering is invalid')
            const encoded = JSON.stringify(row) + '\n'
            if (Buffer.byteLength(encoded) > MAX_LINE_BYTES)
              throw new Error('Compact row exceeds size limit')
            yield encoded
            firstSequence ??= event.sequence
            lastSequence = event.sequence
            rows++
          }
        })(),
        intermediateHandle.createWriteStream(),
      )
    } finally {
      await intermediateHandle.close()
    }
    db = await DuckDBInstance.create(':memory:', {
      threads: '1',
      memory_limit: '256MB',
      temp_directory: spill,
      max_temp_directory_size: '1GB',
      preserve_insertion_order: 'true',
      enable_external_access: 'true',
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
    })
    const connection = await db.connect()
    try {
      const columns = Object.entries(compactColumns)
        .map(([name, type]) => `${sqlQuote(name)}: ${sqlQuote(type)}`)
        .join(',')
      const query = rows
        ? `SELECT * FROM read_json(${sqlQuote(intermediate)}, format='newline_delimited', columns={${columns}}, maximum_object_size=${MAX_LINE_BYTES})`
        : `SELECT ${Object.entries(compactColumns)
            .map(([name, type]) => `NULL::${type} AS "${name}"`)
            .join(',')} WHERE false`
      await connection.run(`COPY (${query}) TO ${sqlQuote(file)} (
        FORMAT PARQUET, PARQUET_VERSION V2, COMPRESSION ZSTD, COMPRESSION_LEVEL 9,
        ROW_GROUP_SIZE ${rowGroupSize}, WRITE_BLOOM_FILTER false,
        KV_METADATA {recorder_schema_version: '4', recorder_format: '${COMPACT_FORMAT}', market_slug: ${sqlQuote(options.marketSlug ?? '')}}
      )`)
    } finally {
      connection.closeSync()
    }
    return { rows, firstSequence, lastSequence }
  } finally {
    db?.closeSync()
    await rm(intermediate, { force: true })
    await rm(spill, { recursive: true, force: true })
  }
}
