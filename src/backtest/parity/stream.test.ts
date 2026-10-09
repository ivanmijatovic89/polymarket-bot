import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { MAX_STORED_MISMATCHES, diffTraces } from './diff.js'
import { diffTraceFiles, scanTrace } from './stream.js'
import {
  TraceFileWriter,
  readTrace,
  serializeTrace,
  streamTrace,
  traceSha256,
  writeTrace,
  type TraceRecord,
} from './trace.js'

const header: TraceRecord = {
  t: 'header',
  format: 'pmb-parity-trace',
  version: 2,
  slug: 's',
  candidateKey: 'k',
  profile: 'ts-compat',
}
const fin: TraceRecord = {
  t: 'final',
  stats: null,
  skipReason: 'no_activity',
  eventsProcessed: 0,
  eventsByType: {},
  unrounded: null,
}
const ticks = (n: number, shift = 0): TraceRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    t: 'tick',
    seq: i,
    ts: 1000 + i + shift,
    cause: 'price_change',
  }))

describe('streamed traces (22 §3.1, §3.6)', () => {
  it('a multi-member gzip trace reads back identically through every reader', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-stream-'))
    const f = path.join(dir, 't.jsonl.gz')
    const recs = [header, ...ticks(500), fin]
    const w = new TraceFileWriter(f, 1000) // forces many gzip members
    for (const r of recs) w.write(r)
    w.close()
    assert.deepEqual(readTrace(f), recs)
    const streamed: TraceRecord[] = []
    for await (const { record } of streamTrace(f)) streamed.push(record)
    assert.deepEqual(streamed, recs)
    const sha = createHash('sha256').update(serializeTrace(recs)).digest('hex')
    assert.equal(await traceSha256(f), sha)
    assert.equal(await scanTrace(f), sha)
    assert.deepEqual(readdirSync(dir), ['t.jsonl.gz'])
  })

  it('an aborted writer leaves nothing behind (atomic, 22 §3.1)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-stream-'))
    const f = path.join(dir, 't.jsonl.gz')
    const w = new TraceFileWriter(f)
    w.write(header)
    w.abort()
    assert.equal(existsSync(f), false)
    assert.deepEqual(readdirSync(dir), [])
  })

  it('the file diff equals the in-memory diff and reports event kinds of A', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-stream-'))
    const a = [
      header,
      ...ticks(10),
      { t: 'event', seq: 9, kind: 'fill', ts: 1 } as TraceRecord,
      fin,
    ]
    const b = [
      header,
      ...ticks(10, 1),
      { t: 'event', seq: 9, kind: 'fill', ts: 1 } as TraceRecord,
      fin,
    ]
    writeTrace(path.join(dir, 'a.jsonl.gz'), a)
    writeTrace(path.join(dir, 'b.jsonl'), b)
    const { diff, eventKinds } = await diffTraceFiles(
      path.join(dir, 'a.jsonl.gz'),
      path.join(dir, 'b.jsonl'),
    )
    const mem = diffTraces(a, b)
    assert.equal(diff.failureTotal, 10)
    assert.equal(diff.failureTotal, mem.failureTotal)
    assert.deepEqual([...eventKinds], ['fill'])
  })

  it('stores at most MAX_STORED_MISMATCHES mismatches but counts all of them', () => {
    const n = MAX_STORED_MISMATCHES + 50
    const r = diffTraces([header, ...ticks(n), fin], [header, ...ticks(n, 1), fin])
    assert.equal(r.failureTotal, n)
    assert.equal(r.failures.length, MAX_STORED_MISMATCHES)
    assert.equal(r.equal, false)
  })
})
