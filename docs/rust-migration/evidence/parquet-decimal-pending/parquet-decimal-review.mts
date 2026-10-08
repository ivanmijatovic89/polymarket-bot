import fs from 'node:fs/promises'
import * as parquet from '@dsnp/parquetjs'
import { toBigInt } from '../../../../src/utils/toBigInt.js'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const folder = resolve(process.argv[2]!)
await mkdir(folder, { recursive: true })
const cases = []
for (const precision of [4, 12]) {
  const schema = new parquet.ParquetSchema({
    ingest_seq: { type: 'DECIMAL', precision, scale: 2 },
    ts_local_ms: { type: 'DECIMAL', precision, scale: 2 },
    raw_json: { type: 'UTF8' },
    event_type: { type: 'UTF8' },
  })
  const path = resolve(folder, 'parquet-decimal-' + precision + '.parquet'),
    w = await parquet.ParquetWriter.openFile(schema, path)
  for (const value of [12, -12, 123])
    await w.appendRow({ ingest_seq: value, ts_local_ms: value, raw_json: '[]', event_type: 'book' })
  await w.close()
  const r = await parquet.ParquetReader.openFile(path),
    c = r.getCursor(),
    rows = []
  try {
    for (;;) {
      const row = await c.next()
      if (!row) break
      rows.push({
        type: typeof row.ingest_seq,
        value: String(row.ingest_seq),
        key: toBigInt(row.ingest_seq, 0n).toString(),
      })
    }
  } finally {
    await r.close()
  }
  console.log(JSON.stringify({ precision, rows }))
  cases.push({ name: 'decimal-' + precision, filePaths: [path], order: 'recorded' })
}
await fs.writeFile(resolve(folder, 'input.json'), JSON.stringify({ cases }))
