import * as parquet from '@dsnp/parquetjs'
import { stat } from 'node:fs/promises'

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) return 0
  const raw = argv[idx + 1]
  if (!raw) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 0
  return n
}

function parsePrint(argv: string[]): number {
  const idx = argv.indexOf('--print')
  if (idx === -1) return 0
  const raw = argv[idx + 1]
  if (!raw) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 0
  return n
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
}

function codecName(codec: unknown): string {
  // CompressionCodec enum from parquet-format:
  // 0 UNCOMPRESSED, 1 SNAPPY, 2 GZIP, 3 LZO, 4 BROTLI, 5 LZ4, 6 ZSTD, 7 LZ4_RAW
  const n = typeof codec === 'number' ? codec : typeof codec === 'string' ? Number(codec) : NaN
  if (!Number.isFinite(n)) return String(codec)
  switch (n) {
    case 0:
      return 'UNCOMPRESSED'
    case 1:
      return 'SNAPPY'
    case 2:
      return 'GZIP'
    case 3:
      return 'LZO'
    case 4:
      return 'BROTLI'
    case 5:
      return 'LZ4'
    case 6:
      return 'ZSTD'
    case 7:
      return 'LZ4_RAW'
    default:
      return String(n)
  }
}

async function main(): Promise<void> {
  const filePath = process.argv[2]
  if (!filePath || filePath.startsWith('-')) {
    console.error(
      'Usage: node --loader ts-node/esm src/scripts/verify-parquet.ts <file.parquet> [--limit N] [--metadata-only]',
    )
    process.exit(2)
  }

  const limit = parseLimit(process.argv.slice(3))
  const printN = parsePrint(process.argv.slice(3))
  const metadataOnly =
    hasFlag(process.argv.slice(3), '--metadata-only') ||
    hasFlag(process.argv.slice(3), '--meta-only')

  const st = await stat(filePath)
  console.log(`[verify-parquet] file=${filePath}`)
  console.log(`[verify-parquet] size_bytes=${st.size}`)

  let reader: parquet.ParquetReader | undefined
  try {
    // Note: @dsnp/parquetjs follows parquetjs APIs.
    reader = await parquet.ParquetReader.openFile(filePath)

    const schema = (reader as unknown as { schema?: unknown }).schema
    if (schema) console.log('[verify-parquet] schema=', schema)

    // Parquet compression is stored in row-group/column metadata (not reliably reflected in schema dumps).
    const md = (reader as unknown as { metadata?: unknown }).metadata as
      | {
          row_groups?: Array<{
            columns?: Array<{
              meta_data?: {
                path_in_schema?: string[]
                codec?: unknown
              }
            }>
          }>
        }
      | undefined

    if (md?.row_groups?.length) {
      const codecsByColumn = new Map<string, Set<string>>()
      for (const rg of md.row_groups) {
        for (const col of rg.columns ?? []) {
          const path = col.meta_data?.path_in_schema?.join('.') ?? '(unknown)'
          const codec = codecName(col.meta_data?.codec ?? '(unknown)')
          const set = codecsByColumn.get(path) ?? new Set<string>()
          set.add(codec)
          codecsByColumn.set(path, set)
        }
      }

      const summary = Object.fromEntries(
        [...codecsByColumn.entries()].map(([path, codecs]) => [path, [...codecs].sort()]),
      )
      console.log('[verify-parquet] codecs_by_column=', summary)
    }

    if (metadataOnly) {
      console.log('[verify-parquet] metadata-only: ok')
      return
    }

    const cursor = reader.getCursor()
    let count = 0
    // Iterate rows to ensure the file is fully readable (footer + pages).
    while (true) {
      const row = await cursor.next()
      if (!row) break
      count += 1

      if (printN > 0 && count <= printN) {
        let parsed: unknown = undefined
        try {
          parsed = JSON.parse((row as { raw_json?: unknown }).raw_json as string)
        } catch {
          // ignore
        }

        const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
        console.log('[verify-parquet] row=', {
          n: count,
          ingest_seq: (row as { ingest_seq?: unknown }).ingest_seq,
          ts_local_ms: (row as { ts_local_ms?: unknown }).ts_local_ms,
          ts_exchange_ms: (row as { ts_exchange_ms?: unknown }).ts_exchange_ms,
          event_type: (row as { event_type?: unknown }).event_type,
          json_market: rec?.market,
          json_asset_id: rec?.asset_id,
          json_timestamp: rec?.timestamp,
        })
      }

      if (limit > 0 && count >= limit) break
    }

    console.log(`[verify-parquet] rows_read=${count}${limit > 0 ? ` (limit=${limit})` : ''}`)
    console.log('[verify-parquet] ok')
  } finally {
    await reader?.close().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('[verify-parquet] failed', err)
  process.exit(1)
})
