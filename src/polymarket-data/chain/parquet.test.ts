import assert from 'node:assert/strict'
import test from 'node:test'
import { manifestBackedReceiptBatches } from './parquet.js'

test('compaction ignores receipt Parquet files without a committed manifest', () => {
  const complete = '111111111111111111111111'
  const orphanParquet = '222222222222222222222222'
  const orphanManifest = '333333333333333333333333'

  assert.deepEqual(
    manifestBackedReceiptBatches([
      `${orphanParquet}.parquet`,
      `${complete}.json`,
      `${orphanManifest}.json`,
      `${complete}.parquet`,
      'unrelated.tmp',
    ]),
    [`${complete}.parquet`],
  )
})
