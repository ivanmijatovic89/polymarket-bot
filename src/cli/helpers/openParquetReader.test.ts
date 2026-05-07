import test from 'node:test'
import assert from 'node:assert/strict'
import { openParquetReaderWithEpermFallback } from './openParquetReader.js'

type ReaderLike = { close: () => Promise<void> }

function mkReader(): ReaderLike {
  return { close: async () => undefined }
}

test('openParquetReaderWithEpermFallback returns openFile reader when openFile succeeds', async () => {
  const reader = mkReader()
  let openBufferCalls = 0
  let readFileCalls = 0

  const out = await openParquetReaderWithEpermFallback('/tmp/a.parquet', {
    openFile: async () => reader as never,
    openBuffer: async () => {
      openBufferCalls += 1
      return mkReader() as never
    },
    readFile: async () => {
      readFileCalls += 1
      return Buffer.from('x')
    },
    log: () => undefined,
  })

  assert.equal(out, reader)
  assert.equal(openBufferCalls, 0)
  assert.equal(readFileCalls, 0)
})

test('openParquetReaderWithEpermFallback falls back to openBuffer on EPERM', async () => {
  const filePath = '/tmp/network.parquet'
  const fileBuffer = Buffer.from('parquet')
  const reader = mkReader()
  const logs: string[] = []
  let readFileCalls = 0

  const out = await openParquetReaderWithEpermFallback(filePath, {
    openFile: async () => {
      const err = new Error('operation not permitted') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    },
    openBuffer: async (buf) => {
      assert.equal(buf, fileBuffer)
      return reader as never
    },
    readFile: async (p) => {
      readFileCalls += 1
      assert.equal(p, filePath)
      return fileBuffer
    },
    log: (line) => logs.push(line),
  })

  assert.equal(out, reader)
  assert.equal(readFileCalls, 1)
  assert.equal(logs.length, 1)
  assert.match(logs[0] ?? '', /\[backtest\] parquet fallback=openBuffer reason=EPERM file=/)
})

test('openParquetReaderWithEpermFallback rethrows non-EPERM errors', async () => {
  const err = new Error('not found') as NodeJS.ErrnoException
  err.code = 'ENOENT'

  await assert.rejects(
    () =>
      openParquetReaderWithEpermFallback('/tmp/missing.parquet', {
        openFile: async () => {
          throw err
        },
        openBuffer: async () => mkReader() as never,
        readFile: async () => Buffer.from('x'),
        log: () => undefined,
      }),
    (caught) => {
      assert.equal(caught, err)
      return true
    },
  )
})
