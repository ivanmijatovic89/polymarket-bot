import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { createResearchDatabase } from './database.js'

test('concurrent spilling databases retain independent data when another instance closes', async () => {
  const first = await createResearchDatabase()
  const second = await createResearchDatabase()
  try {
    assert.notEqual(first.tempDirectory, second.tempDirectory)
    await Promise.all(
      [first, second].map(async ({ connection }, index) => {
        await connection.run("SET memory_limit='16MB'; SET threads=1")
        await connection.run(`CREATE TABLE payload AS SELECT i + ${index} AS i,
        repeat(md5(i::VARCHAR), 8) AS value FROM range(200000) r(i)`)
        const spilled = (
          await connection.runAndReadAll(
            'SELECT coalesce(sum(size),0)::DOUBLE AS bytes FROM duckdb_temporary_files()',
          )
        ).getRowObjectsJson()
        assert.ok(Number(spilled[0]!.bytes) > 0, 'the regression must exercise real disk spilling')
      }),
    )
    first.close()
    assert.equal(existsSync(first.tempDirectory), false)
    assert.equal(existsSync(second.tempDirectory), true)
    const result = (
      await second.connection.runAndReadAll(
        'SELECT count(*)::INTEGER AS rows, sum(i)::DOUBLE AS total, sum(length(value))::DOUBLE AS bytes FROM payload',
      )
    ).getRowObjectsJson()
    assert.deepEqual(result, [{ rows: 200000, total: 20000100000, bytes: 51200000 }])
  } finally {
    first.close()
    second.close()
  }
  assert.equal(existsSync(second.tempDirectory), false)
})
