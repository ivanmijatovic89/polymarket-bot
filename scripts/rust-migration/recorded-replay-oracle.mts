import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import { replayOrderBookForMarket } from '../../src/parquet/replay/replayOrderBookForMarket.js'

type Row = {
  ingest_seq?: bigint
  ts_local_ms?: bigint
  ts_exchange_ms?: bigint
  event_type?: string
  raw_json?: unknown
}
type Case = {
  name: string
  filePaths: string[]
  order: 'recorded' | 'exchange_time'
  stopAfter?: number
  failAfter?: number
}
const directory = resolve(process.argv[2]!)
await mkdir(directory, { recursive: true })
const schema = (type: 'UTF8' | 'JSON' | 'INT64' | 'BYTE_ARRAY' = 'UTF8') =>
  new parquet.ParquetSchema({
    ingest_seq: { type: 'INT64', optional: true },
    ts_local_ms: { type: 'INT64', optional: true },
    ts_exchange_ms: { type: 'INT64', optional: true },
    event_type: { type: 'UTF8', optional: true },
    raw_json: { type, optional: true, compression: 'GZIP' },
  })
let fileIndex = 0
async function file(rows: Row[], type: 'UTF8' | 'JSON' | 'INT64' | 'BYTE_ARRAY' = 'UTF8') {
  const path = resolve(directory, `recorded-${fileIndex++}.parquet`)
  const writer = await parquet.ParquetWriter.openFile(schema(type), path, { rowGroupSize: 2 })
  try {
    for (const row of rows) await writer.appendRow(row)
  } finally {
    await writer.close()
  }
  return path
}
function book(market: unknown = 'm', timestamp = 1) {
  return {
    event_type: 'book',
    market,
    asset_id: 'up',
    timestamp: String(timestamp),
    bids: [],
    asks: [],
  }
}
const raw = (market: unknown = 'm', timestamp = 1) => JSON.stringify(book(market, timestamp))
const cases: Case[] = []
async function one(
  name: string,
  rows: Row[],
  type: 'UTF8' | 'JSON' | 'INT64' | 'BYTE_ARRAY' = 'UTF8',
  options: Partial<Case> = {},
) {
  cases.push({ name, filePaths: [await file(rows, type)], order: 'recorded', ...options })
}
await one('selected_roundtrip', [
  {
    ingest_seq: 1n,
    ts_local_ms: 9007199254740993n,
    raw_json: raw().replace('"bids":[]', '"extra":1e400,"negativeZero":-0,"bids":[]'),
  },
])
await one('multi_frame_source', [
  {
    ingest_seq: 9223372036854775807n,
    ts_local_ms: 42n,
    raw_json: JSON.stringify([
      book('m', 1),
      {
        event_type: 'last_trade_price',
        market: 'm',
        asset_id: 'up',
        timestamp: '2',
        price: '0.5',
        size: '3',
        side: 'BUY',
      },
      book('other', 3),
      book('m', 4),
    ]),
  },
])
await one('fast_skip_and_empty_type', [
  { event_type: 'disconnect', raw_json: raw('skip') },
  { event_type: '', raw_json: raw('m') },
  { raw_json: raw('other') },
])
await one('invalid_frames', [
  { raw_json: '{broken' },
  { raw_json: '[null,7,{"event_type":"disconnect"}]' },
  { raw_json: raw() },
])
await one('boolean_market', [
  { raw_json: raw(false) },
  { raw_json: raw(false, 2) },
  { raw_json: raw(0, 3) },
])
await one('numeric_market', [
  { raw_json: raw(1) },
  { raw_json: raw('1', 2) },
  { raw_json: raw(1, 3) },
])
await one('object_market_identity', [{ raw_json: raw({ x: 1 }) }, { raw_json: raw({ x: 1 }, 2) }])
await one('nullish_market_error_prefix', [{ raw_json: raw(null) }, { raw_json: raw('m', 2) }])
await one('missing_market', [
  { raw_json: JSON.stringify({ ...book(), market: undefined }) },
  { raw_json: raw('m', 2) },
])
await one('array_market_identity', [{ raw_json: raw([]) }, { raw_json: raw([], 2) }])
await one('logical_json_row', [{ raw_json: book() }], 'JSON')
await one('logical_json_string', [{ raw_json: raw().replace('"m"', '"\\ud800"') }], 'JSON')
await one(
  'logical_json_literal_lone_unit',
  [{ raw_json: raw().replace('"m"', '"' + String.fromCharCode(0xd800) + '"') }],
  'JSON',
)
await one('bigint_serialization_before_skip', [{ event_type: 'disconnect', raw_json: 7n }], 'INT64')
await one('buffer_raw_json', [{ raw_json: Buffer.from(raw()) }], 'BYTE_ARRAY')
await one('empty_raw_and_nonpositive_clocks', [
  { ts_local_ms: -4n, raw_json: raw() },
  { ts_local_ms: 0n, raw_json: raw('m', 2) },
  { ts_local_ms: 5n, raw_json: raw('m', 3) },
])
await one('stop_before_pop', [{ raw_json: raw() }], 'UTF8', { stopAfter: 0 })
await one(
  'stop_after_callback_frame',
  [{ raw_json: JSON.stringify([book(), book('m', 2)]) }, { raw_json: raw('m', 3) }],
  'UTF8',
  { stopAfter: 1 },
)
await one(
  'callback_error_prefix',
  [{ raw_json: JSON.stringify([book(), book('m', 2)]) }, { raw_json: raw('m', 3) }],
  'UTF8',
  { failAfter: 1 },
)
const a = await file([
  { ingest_seq: 10n, ts_local_ms: 3n, ts_exchange_ms: 30n, raw_json: raw('m', 10) },
  { ingest_seq: 1n, ts_local_ms: 2n, raw_json: raw('m', 11) },
])
const b = await file([
  { ingest_seq: 10n, ts_local_ms: 3n, ts_exchange_ms: 20n, raw_json: raw('m', 20) },
  { ingest_seq: 11n, ts_local_ms: 4n, raw_json: raw('m', 21) },
])
cases.push(
  { name: 'recorded_heap', filePaths: [a, b], order: 'recorded' },
  { name: 'exchange_secondary_heap', filePaths: [a, b], order: 'exchange_time' },
)
cases.push({ name: 'empty_paths', filePaths: [], order: 'recorded' })
const marketValues = [
  false,
  true,
  0,
  -0,
  1,
  -1,
  '',
  'm',
  null,
  undefined,
  {},
  [],
  { x: 1 },
  '\ud800',
  '😀',
]
for (let i = 0; i < marketValues.length; i++) {
  const market = marketValues[i]
  await one(`review-same-market-${i}`, [
    { raw_json: JSON.stringify([book(market), book(market, 2)]) },
    { raw_json: raw(market, 3) },
  ])
  await one(`review-next-market-${i}`, [{ raw_json: raw(market) }, { raw_json: raw('next', 2) }])
}
for (const units of [
  [0xd800],
  [0xdc00],
  [0xd800, 0xdc00],
  [0xd800, 0xd800],
  [0x22, 0x5c, 0xd800],
  [0x5c, 0xd800],
  [0x5c, 0x5c, 0xd800],
  [0x61, 0xd800, 0x62],
  [0x2028, 0xdfff],
]) {
  const text = JSON.stringify({ ...book(), extra: 'PLACEHOLDER' }).replace(
    'PLACEHOLDER',
    String.fromCharCode(...units),
  )
  await one(`review-literal-units-${units.join('-')}`, [{ raw_json: text }], 'JSON')
}
await one('review-null-first-in-frame', [
  { raw_json: JSON.stringify([book(null), book('m', 2)]) },
  { raw_json: raw('m', 3) },
])
await one('review-overflow-market', [
  { raw_json: raw().replace('"m"', '1e400') },
  { raw_json: raw().replace('"m"', '1e400') },
])
await one('review-signedzero-market', [
  { raw_json: raw().replace('"m"', '-0') },
  { raw_json: raw().replace('"m"', '0') },
])

const results = []
for (const scenario of cases) {
  const ticks: unknown[] = []
  let failed = false
  try {
    await replayOrderBookForMarket({
      filePaths: scenario.filePaths,
      order: scenario.order,
      shouldStop: () => scenario.stopAfter !== undefined && ticks.length >= scenario.stopAfter,
      onSnapshot: async (snapshot, event) => {
        ticks.push(
          JSON.parse(
            JSON.stringify(
              {
                snapshot,
                msg: event.msg,
                source: event.source,
                rawUtf16: Array.from({ length: event.rawJson.length }, (_, index) =>
                  event.rawJson.charCodeAt(index),
                ),
              },
              (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value),
            ),
          ),
        )
        await Promise.resolve()
        if (scenario.failAfter !== undefined && ticks.length >= scenario.failAfter)
          throw new Error('scripted callback failure')
      },
    })
  } catch {
    failed = true
  }
  results.push({ name: scenario.name, ticks, failed })
}
await writeFile(resolve(directory, 'recorded-cases.json'), JSON.stringify(cases))
await writeFile(resolve(directory, 'recorded-reference.json'), JSON.stringify(results))
console.log(
  JSON.stringify({
    cases: cases.length,
    ticks: results.reduce((sum, item) => sum + item.ticks.length, 0),
  }),
)
