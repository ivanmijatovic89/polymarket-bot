import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DuckDBInstance } from '@duckdb/node-api'
import { asyncBufferFromFile, parquetMetadataAsync } from 'hyparquet'
import { MarketEngine } from '../../market/MarketEngine.js'
import type { CapturedEvent } from '../types.js'
import { compactRow } from './compactCodec.js'
import { writeCapturedEvents } from './compactWriter.js'
import { readCapturedEvents, readOpeningReferenceEvents } from './parquet.js'
import { sqlQuote } from '../../utils/duckdb.js'

const change = {
  market: 'm',
  price_changes: [
    {
      asset_id: 'a',
      price: '0.12345678901234567890',
      size: '1.000',
      side: 'BUY',
      hash: 'a'.repeat(40),
      best_bid: '0.12',
      best_ask: '0.13',
    },
  ],
  timestamp: '1700000000000',
  event_type: 'price_change',
}
const book = {
  market: 'm',
  asset_id: 'a',
  bids: [{ price: '0.01', size: '2.000' }],
  asks: [],
  hash: 'keep-book-hash',
  timestamp: '1700000000000',
  event_type: 'book',
}
const ticker = {
  stream: 'btcusdt@bookTicker',
  data: { u: 9007199254740991, s: 'BTCUSDT', b: '1.000', B: '2.000', a: '3.000', A: '4.000' },
}
const trade = {
  stream: 'btcusdt@aggTrade',
  data: {
    e: 'aggTrade',
    E: 1700000000000,
    s: 'BTCUSDT',
    a: 123,
    p: '1.000',
    q: '2.000',
    f: 234,
    l: 567,
    T: 1700000000001,
    m: false,
    M: true,
  },
}
function event(
  index: number,
  raw: unknown,
  source: CapturedEvent['source'] = 'polymarket',
): CapturedEvent {
  const sequence = (9007199254740993n + BigInt(index) * 1000000000000n).toString()
  return {
    schemaVersion: 4,
    captureId: 'capture',
    sessionId: index % 2 ? 'second' : 'first',
    sequence,
    eventId: `capture:${sequence}`,
    receivedAtMs: 1700000000000 - index,
    monotonicNs: index % 2 ? '0' : '9223372036854775807',
    source,
    connectionId: 'connection',
    eventType: 'message',
    sourceTimeMs: index % 2 ? null : 1700000000000,
    rawJson: typeof raw === 'string' ? raw : JSON.stringify(raw),
    detailsJson: null,
  }
}
async function directory(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'recorder-v4-compact-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const rows: T[] = []
  for await (const event of events) rows.push(event)
  return rows
}

test('all known payload shapes preserve values, unknown shapes preserve exact raw bytes, only change hashes are omitted', async (t) => {
  const dir = await directory(t),
    file = path.join(dir, 'arbitrary-name.parquet')
  const rows = [
    event(0, change),
    event(1, book),
    event(2, ticker, 'binance'),
    event(3, trade, 'binance'),
    event(4, {
      market: 'm',
      asset_id: 'a',
      best_bid: '0.1',
      best_ask: '0.2',
      spread: '0.1',
      timestamp: '1700000000000',
      event_type: 'best_bid_ask',
    }),
    event(5, {
      market: 'm',
      asset_id: 'a',
      price: '0.1',
      size: '1.00',
      fee_rate_bps: '100',
      side: 'BUY',
      timestamp: '1700000000000',
      event_type: 'last_trade_price',
      transaction_hash: 'must-retain',
    }),
    event(6, ' { "new_field": true, "hash": "keep" } '),
    event(7, { ...change, unknown: true }),
    event(8, { ...change, price_changes: [{ ...change.price_changes[0], hash: 'UPPERCASE' }] }),
    event(9, { ...ticker, data: { ...ticker.data, u: 9007199254740992 } }, 'binance'),
    event(10, { ...change, price_changes: [] }),
    event(11, { openPrice: 123.456 }, 'price_to_beat'),
    event(
      12,
      { channel: 'price.crypto', payload: { full_accuracy_value: '123.4567890123456789' } },
      'chainlink',
    ),
  ]
  await writeCapturedEvents(file, rows)
  const restored = await collect(readCapturedEvents(file))
  assert.equal(restored.length, rows.length)
  for (let i = 0; i < rows.length; i++) {
    const actual = restored[i]!,
      original = rows[i]!
    assert.deepEqual({ ...actual, rawJson: '' }, { ...original, rawJson: '' })
    const expected = JSON.parse(original.rawJson)
    if (i === 0) expected.price_changes[0].hash = ''
    assert.deepEqual(JSON.parse(actual.rawJson), expected)
    if ([6, 7, 8, 9, 11, 12].includes(i)) {
      assert.equal(actual.rawJson, original.rawJson)
      assert.equal(actual.decodedPayload, undefined)
    } else assert.ok(actual.decodedPayload)
  }
  const metadata = await parquetMetadataAsync(await asyncBufferFromFile(file))
  assert.ok(
    !metadata.schema.some(
      (column) =>
        column.name === 'event_id' || column.name === 'pc_hash' || column.name === 'raw_json',
    ),
  )
  assert.deepEqual(
    (await collect(readOpeningReferenceEvents(file))).map((row) => row.eventId),
    rows.slice(11).map((row) => row.eventId),
  )
  assert.deepEqual(await readdir(dir), ['arbitrary-name.parquet'])
})

test('0, 1 and multiple row groups retain lease jumps, INT64 precision, session resets and backward receipt clocks', async (t) => {
  const dir = await directory(t)
  for (const count of [0, 1, 9007]) {
    const rows = Array.from({ length: count }, (_, i) =>
      event(i, i % 2 ? change : ticker, i % 2 ? 'polymarket' : 'binance'),
    )
    const file = path.join(dir, `${count}.parquet`)
    await writeCapturedEvents(file, rows, { rowGroupSize: 2048 })
    const actual = await collect(readCapturedEvents(file))
    assert.deepEqual(
      actual.map((x) => [x.sequence, x.eventId, x.monotonicNs, x.receivedAtMs, x.sessionId]),
      rows.map((x) => [x.sequence, x.eventId, x.monotonicNs, x.receivedAtMs, x.sessionId]),
    )
  }
})

test('writer rejects identities that cannot be reconstructed and never sorts invalid journals', async (t) => {
  const dir = await directory(t)
  assert.throws(() => compactRow({ ...event(0, change), eventId: 'unexpected' }), /noncanonical/)
  assert.throws(
    () => compactRow({ ...event(0, change), sequence: '09007199254740993' }),
    /sequence/,
  )
  for (let attempt = 0; attempt < 20; attempt++) {
    await assert.rejects(
      writeCapturedEvents(path.join(dir, 'bad.parquet'), [event(1, change), event(0, change)]),
      /ordering/,
    )
    assert.deepEqual(await readdir(dir), [])
  }
  await assert.rejects(
    writeCapturedEvents(path.join(dir, 'bad.parquet'), [
      { ...event(0, change), eventId: 'invalid' },
    ]),
    /noncanonical/,
  )
  assert.deepEqual(await readdir(dir), [])
})

test('reader rejects old metadata and mismatched typed lists instead of manufacturing a replay', async (t) => {
  const dir = await directory(t),
    file = path.join(dir, 'original.parquet')
  await writeCapturedEvents(file, [event(0, change)])
  const db = await DuckDBInstance.create(':memory:'),
    c = await db.connect()
  try {
    for (const [name, query, metadata, error] of [
      ['old', 'SELECT *', "recorder_schema_version: '3'", /Unsupported recorder archive/],
      [
        'broken',
        'SELECT * REPLACE ([]::VARCHAR[] AS pc_price)',
        "recorder_schema_version: '4', recorder_format: 'recorder-v4-compact-1'",
        /parallel lists/,
      ],
    ] as const) {
      const out = path.join(dir, `${name}.parquet`)
      await c.run(
        `COPY (${query} FROM read_parquet(${sqlQuote(file)})) TO ${sqlQuote(out)} (FORMAT PARQUET, KV_METADATA {${metadata}})`,
      )
      await assert.rejects(collect(readCapturedEvents(out)), error)
    }
  } finally {
    c.closeSync()
    db.closeSync()
  }
})

test('live raw frames and V4 typed payloads expose identical messages and books to strategies', async (t) => {
  const dir = await directory(t),
    file = path.join(dir, 'parity.parquet')
  const rows = [event(0, book), event(1, change), event(2, { ...change, unknown: true })]
  await writeCapturedEvents(file, rows)
  const expected: unknown[] = [],
    actual: unknown[] = []
  const live = new MarketEngine({
    onTick: (tick) => {
      expected.push({ msg: tick.msg, snapshot: tick.snapshot })
    },
  })
  const replay = new MarketEngine({
    onTick: (tick) => {
      actual.push({ msg: tick.msg, snapshot: tick.snapshot })
    },
  })
  for (const row of rows)
    await live.handleRaw({ rawJson: row.rawJson, source: { kind: 'live', attempt: 1 } })
  for await (const row of readCapturedEvents(file))
    await replay.handleRaw({ rawJson: row.rawJson, source: { kind: 'live', attempt: 1 } })
  assert.deepEqual(actual, expected)
  assert.equal((actual[0] as { msg: { hash: string } }).msg.hash, 'keep-book-hash')
})

test('unpaired Unicode and unsafe payload integers stay in byte-exact fallback', async (t) => {
  const dir = await directory(t),
    file = path.join(dir, 'unicode.parquet')
  const rows = ['\ud800', '\udfff', 'valid\ud83d\ude00'].map((s, i) =>
    event(i, { ...ticker, data: { ...ticker.data, s } }, 'binance'),
  )
  await writeCapturedEvents(file, rows)
  const actual = await collect(readCapturedEvents(file))
  assert.equal(actual[0]!.rawJson, rows[0]!.rawJson)
  assert.equal(actual[1]!.rawJson, rows[1]!.rawJson)
  assert.equal(actual[0]!.decodedPayload, undefined)
  assert.equal(actual[1]!.decodedPayload, undefined)
  assert.ok(actual[2]!.decodedPayload)
})
