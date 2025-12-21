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

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
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
  const metadataOnly = hasFlag(process.argv.slice(3), '--metadata-only')

  const st = await stat(filePath)
  console.log(`[verify-parquet] file=${filePath}`)
  console.log(`[verify-parquet] size_bytes=${st.size}`)

  let reader: parquet.ParquetReader | undefined
  try {
    // Note: @dsnp/parquetjs follows parquetjs APIs.
    reader = await parquet.ParquetReader.openFile(filePath)

    const schema = (reader as unknown as { schema?: unknown }).schema
    if (schema) console.log('[verify-parquet] schema=', schema)

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
