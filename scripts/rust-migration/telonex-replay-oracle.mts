import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import { replayTelonexPairedParquetForMarket } from '../../src/parquet/replay/replayTelonexPairedParquetForMarket.js'
import { replayTelonexDeltaParquetForMarket } from '../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

type Mode = 'paired' | 'delta'
type DataType = 'UTF8' | 'JSON' | 'INT64' | 'DOUBLE' | 'BYTE_ARRAY'
type Case = { name: string; mode: Mode; filePath: string; stopAfter?: number; failAfter?: number }
type Row = Record<string, unknown>
const directory = resolve(process.argv[2]!)
await mkdir(directory, { recursive: true })
const cases: Case[] = []
let index = 0
async function one(
  name: string,
  mode: Mode,
  rows: Row[],
  options: Partial<Case> = {},
  types: Record<string, DataType> = {},
) {
  const fields: ConstructorParameters<typeof parquet.ParquetSchema>[0] = {}
  const scalars =
    mode === 'paired'
      ? ['up_asset_id', 'down_asset_id', 'up_bids', 'up_asks', 'down_bids', 'down_asks']
      : ['asset0_id', 'asset1_id', 'asset_index']
  for (const name of [
    'ingest_seq',
    'ts_exchange_ms',
    'ts_local_ms',
    'event_type',
    'market',
    ...scalars,
  ])
    fields[name] = {
      type:
        types[name] ??
        (name.startsWith('ts_') || name === 'ingest_seq'
          ? 'INT64'
          : name === 'asset_index'
            ? 'JSON'
            : 'UTF8'),
      optional: true,
      compression: 'GZIP',
      statistics: false,
    }
  if (mode === 'delta')
    for (const name of [
      'bid_prices',
      'bid_sizes',
      'ask_prices',
      'ask_sizes',
      'change_asset_indexes',
      'change_side_codes',
      'change_prices',
      'change_sizes',
    ])
      fields[name] = {
        type: types[name] ?? 'JSON',
        optional: true,
        repeated: true,
        compression: 'GZIP',
        statistics: false,
      }
  const filePath = resolve(directory, `telonex-${index++}.parquet`)
  const writer = await parquet.ParquetWriter.openFile(new parquet.ParquetSchema(fields), filePath, {
    rowGroupSize: 2,
  })
  try {
    for (const row of rows) await writer.appendRow(row)
  } finally {
    await writer.close()
  }
  cases.push({ name, mode, filePath, ...options })
}
const paired = (updates: Row = {}): Row => ({
  event_type: 'orderbook_pair',
  ingest_seq: 1n,
  ts_exchange_ms: 100n,
  ts_local_ms: 120n,
  market: 'm',
  up_asset_id: 'up',
  down_asset_id: 'down',
  up_bids: '0.4@2',
  up_asks: '0.6@3',
  down_bids: '0.3@4',
  down_asks: '0.7@5',
  ...updates,
})
const book = (updates: Row = {}): Row => ({
  event_type: 'book',
  ingest_seq: 1n,
  ts_exchange_ms: 100n,
  ts_local_ms: 120n,
  market: 'm',
  asset0_id: 'up',
  asset1_id: 'down',
  asset_index: 0,
  bid_prices: ['0.4'],
  bid_sizes: ['2'],
  ask_prices: ['0.6'],
  ask_sizes: ['3'],
  ...updates,
})
const delta = (updates: Row = {}): Row => ({
  event_type: 'price_change',
  ingest_seq: 2n,
  ts_exchange_ms: 101n,
  ts_local_ms: 121n,
  market: 'm',
  asset0_id: 'up',
  asset1_id: 'down',
  change_asset_indexes: [0, 1],
  change_side_codes: [0, 1],
  change_prices: ['0.4', '0.7'],
  change_sizes: ['7', '8'],
  ...updates,
})
await one('paired-atomic', 'paired', [
  paired(),
  paired({ ingest_seq: 0n, ts_exchange_ms: 99n, up_bids: '0.5@1', down_bids: '0.2@3' }),
])
await one('paired-parse-delimiters', 'paired', [
  paired({ up_bids: ';bad;@1;1@;0.4@2;;0.5@3;', up_asks: '0.7@4' }),
])
await one('paired-second-at-error', 'paired', [
  paired(),
  paired({ down_bids: '0.3@4@5' }),
  paired(),
])
await one('paired-empty-side', 'paired', [paired({ up_bids: '', down_asks: undefined })])
await one('paired-preserve-whitespace', 'paired', [
  paired({ market: ' m ', up_asset_id: ' up ', down_asset_id: ' down ', up_bids: ' 0.4 @ 2 ' }),
])
await one('paired-sequence-wide', 'paired', [
  paired({ ingest_seq: 9223372036854775807n, ts_local_ms: 9007199254740993n }),
  paired({ ingest_seq: -9223372036854775808n, ts_local_ms: -1n }),
])
await one('paired-same-asset', 'paired', [paired({ down_asset_id: 'up' })])
await one('paired-market-change', 'paired', [
  paired(),
  paired({ market: 'other', ts_exchange_ms: 200n }),
])
for (const [name, patch] of [
  ['wrong-type', { event_type: 'book' }],
  ['blank-market', { market: '\uFEFF\u00A0' }],
  ['missing-market', { market: undefined }],
  ['negative-time', { ts_exchange_ms: -1n }],
  ['missing-time', { ts_exchange_ms: undefined }],
  ['blank-up', { up_asset_id: ' ' }],
  ['missing-down', { down_asset_id: undefined }],
] as const)
  await one(`paired-${name}`, 'paired', [paired(patch), paired()])
await one('paired-invalid-level-prefix', 'paired', [
  paired(),
  paired({ up_bids: 'oops@1' }),
  paired(),
])
await one('paired-stop-before-read', 'paired', [paired({ up_bids: 'oops@1' })], { stopAfter: 0 })
await one('paired-stop-after-one', 'paired', [paired(), paired()], { stopAfter: 1 })
await one('paired-callback-failure', 'paired', [paired(), paired()], { failAfter: 1 })
await one('delta-both-assets', 'delta', [
  book(),
  book({ asset_index: 1 }),
  delta(),
  delta({ change_sizes: ['0', '0'] }),
])
await one('delta-shortest-arrays', 'delta', [
  book({ bid_prices: ['0.4', '0.3'], bid_sizes: ['2'], ask_sizes: [] }),
  delta({ change_side_codes: [0] }),
])
await one('delta-order-preserved', 'delta', [
  book(),
  delta({ ingest_seq: -1n }),
  book({ ingest_seq: 0n }),
])
await one('delta-primitive-values', 'delta', [
  book({ bid_prices: [0.4, '', false, null], bid_sizes: [2, 3, 4, 5] }),
  delta({
    change_asset_indexes: [false, true, null, '0x0'],
    change_side_codes: [false, true, null, '0b1'],
    change_prices: ['0.1', '0.2', '0.3', '0.4'],
    change_sizes: [1, 2, 3, 4],
  }),
])
await one('delta-array-coercion', 'delta', [
  book({ asset_index: [], bid_prices: [[0.4], []], bid_sizes: [[2], []] }),
  delta({
    change_asset_indexes: [[], [1]],
    change_side_codes: [[], [1]],
    change_prices: [[0.4], [0.7]],
    change_sizes: [[2], [3]],
  }),
])
await one('delta-object-error', 'delta', [
  book(),
  book({ bid_prices: [{ toString: 1 }], bid_sizes: ['2'] }),
])
await one('delta-object-invalid-level', 'delta', [
  book(),
  book({ bid_prices: [{}], bid_sizes: ['2'] }),
])
await one('delta-empty-string-zero', 'delta', [
  book({ bid_prices: [''], bid_sizes: ['2'] }),
  delta({
    change_asset_indexes: [''],
    change_side_codes: [''],
    change_prices: [''],
    change_sizes: ['3'],
  }),
])
await one('delta-number-string', 'delta', [
  book({ bid_prices: [1e-7, 0.4], bid_sizes: [1e21, 1e-7] }),
])
await one(
  'delta-wide-bigint',
  'delta',
  [book({ bid_prices: [1n], bid_sizes: [9007199254740993n] })],
  {},
  { bid_prices: 'INT64', bid_sizes: 'INT64' },
)
await one(
  'delta-buffer-values',
  'delta',
  [
    book({
      bid_prices: [Buffer.from('0.4'), Buffer.alloc(0)],
      bid_sizes: [Buffer.from('2'), Buffer.from('3')],
    }),
  ],
  {},
  { bid_prices: 'BYTE_ARRAY', bid_sizes: 'BYTE_ARRAY' },
)
await one(
  'delta-buffer-index',
  'delta',
  [book({ asset_index: Buffer.from('0') })],
  {},
  { asset_index: 'BYTE_ARRAY' },
)
await one(
  'delta-nonfinite-values',
  'delta',
  [book({ bid_prices: [Infinity, NaN, 0.4], bid_sizes: [2, 3, 4] })],
  {},
  { bid_prices: 'DOUBLE' },
)
await one('delta-floating-index', 'delta', [
  book({ asset_index: 0.1 }),
  book({ asset_index: '0' }),
  book({ asset_index: -0 }),
])
await one('delta-invalid-index-side', 'delta', [
  delta({ change_asset_indexes: [-1, 0.5, 2, 'inf'], change_side_codes: [0, 0, 1, 0] }),
  delta({ change_side_codes: [2, -1] }),
  book(),
])
await one('delta-no-changes', 'delta', [delta({ change_sizes: [] }), book()])
await one('delta-missing-asset-index', 'delta', [
  book({ asset_index: undefined }),
  book({ asset_index: null }),
])
await one('delta-missing-assets', 'delta', [
  book({ asset0_id: undefined }),
  delta({ asset1_id: ' ' }),
  book(),
])
await one('delta-invalid-time', 'delta', [
  book({ ts_exchange_ms: -1n }),
  book({ ts_exchange_ms: undefined }),
  book({ ts_exchange_ms: 0n }),
])
await one('delta-local-clocks', 'delta', [
  book({ ts_local_ms: 0n }),
  book({ ts_local_ms: -1n }),
  book({ ts_local_ms: 9007199254740993n }),
])
await one('delta-invalid-level-prefix', 'delta', [
  book(),
  delta({ change_prices: ['bad', '0.7'] }),
  book(),
])
await one('delta-stop-before-read', 'delta', [book({ bid_prices: ['bad'] })], { stopAfter: 0 })
await one('delta-stop-after-one', 'delta', [book(), delta()], { stopAfter: 1 })
await one('delta-callback-failure', 'delta', [book(), delta()], { failAfter: 1 })
// Additional adversarial cases designed by an independent runtime reviewer.
await one('review-delta-optional-index-mixed-group', 'delta', [
  book({ asset_index: undefined }),
  book({ asset_index: 0, ts_exchange_ms: 101n }),
])
await one(
  'review-delta-json-market-surrogates',
  'delta',
  [book({ market: 'a\ud800b' }), delta({ market: 'a\ud800b' })],
  {},
  { market: 'JSON' },
)
await one(
  'review-paired-json-market-surrogates',
  'paired',
  [
    paired({ market: 'a\ud800b', up_asset_id: 'u\udc00' }),
    paired({ market: 'a\ud800b', up_asset_id: 'u\udc00' }),
  ],
  {},
  { market: 'JSON', up_asset_id: 'JSON' },
)
await one('review-delta-full-js-numeric-index-spellings', 'delta', [
  book({ asset_index: '\uFEFF0x0\u00A0' }),
  book({ asset_index: '0o1' }),
  book({ asset_index: '+0' }),
  book({ asset_index: '-0' }),
  book({ asset_index: '1e0' }),
  book({ asset_index: '0x20000000000001f' }),
])
await one('review-delta-invalid-index-number-spellings', 'delta', [
  book({ asset_index: 'inf' }),
  book({ asset_index: 'Infinity' }),
  book({ asset_index: '1e' }),
  book({ asset_index: '++0' }),
  book({ asset_index: '0b2' }),
  book({ asset_index: '\u00850' }),
])
await one('review-delta-json-object-number-string-order', 'delta', [
  book({ asset_index: { valueOf: 0 }, bid_prices: [], bid_sizes: [] }),
  book({ asset_index: 0 }),
])
await one('review-delta-object-toString-shadow-index-throw', 'delta', [
  book(),
  book({ asset_index: { toString: 0 } }),
  book(),
])
await one('review-delta-noop-ticks-and-duplicate-levels', 'delta', [
  book({ bid_prices: ['-0', '0', '0.4', '0.4'], bid_sizes: ['1', '2', '3', '4'] }),
  book({ bid_prices: ['-0', '0', '0.4', '0.4'], bid_sizes: ['1', '2', '3', '4'] }),
  delta({
    change_prices: ['0.4', '0.4'],
    change_sizes: ['4', '4'],
    change_asset_indexes: [0, 0],
    change_side_codes: [0, 0],
  }),
])
await one('review-delta-invalid-price-still-coerces-size', 'delta', [
  book(),
  book({ bid_prices: [false], bid_sizes: [{ toString: 0 }] }),
  book(),
])
await one('review-delta-invalid-index-still-coerces-other-change-fields', 'delta', [
  book(),
  delta({
    change_asset_indexes: [2],
    change_side_codes: [0],
    change_prices: [{ toString: 0 }],
    change_sizes: ['1'],
  }),
  book(),
])
await one('review-paired-negativezero-duplicate-keys', 'paired', [
  paired({ up_bids: '-0@1;0@2;0.4@1;0.4@2' }),
  paired({ up_bids: '-0@1;0@2;0.4@1;0.4@2' }),
])
await one('review-paired-up-changed-down-error-atomic-prefix', 'paired', [
  paired(),
  paired({ up_bids: '0.5@99', down_bids: 'bad@3' }),
  paired(),
])
await one(
  'review-source-float-clocks-and-sequence',
  'paired',
  [
    paired({ ingest_seq: 1e20, ts_local_ms: 1e20, ts_exchange_ms: 1.9 }),
    paired({ ingest_seq: -1.9, ts_local_ms: -0, ts_exchange_ms: -0.9 }),
  ],
  {},
  { ingest_seq: 'DOUBLE', ts_local_ms: 'DOUBLE', ts_exchange_ms: 'DOUBLE' },
)
await one(
  'review-source-nonfinite-clock-fallback',
  'delta',
  [
    book({ ingest_seq: Infinity, ts_local_ms: Infinity, ts_exchange_ms: 1 }),
    book({ ingest_seq: NaN, ts_local_ms: NaN, ts_exchange_ms: 2 }),
  ],
  {},
  { ingest_seq: 'DOUBLE', ts_local_ms: 'DOUBLE', ts_exchange_ms: 'DOUBLE' },
)
await one(
  'review-source-huge-clock-bigint-number-overflow',
  'delta',
  [
    book({ ingest_seq: '0x20000000000001f', ts_local_ms: '1' + '0'.repeat(400) }),
    book({ ingest_seq: '-0x1', ts_local_ms: '-1' + '0'.repeat(400) }),
  ],
  {},
  { ingest_seq: 'UTF8', ts_local_ms: 'UTF8' },
)
await one('review-delta-empty-encoded-object-array-values', 'delta', [
  book({ bid_prices: [[], [null], [''], [0.4]], bid_sizes: [['2'], ['2'], ['2'], [2]] }),
])
await one(
  'review-delta-invalid-buffer-utf8-prefix',
  'delta',
  [
    book(),
    book({ bid_prices: [Buffer.from([0xf0, 0x80, 0x80, 0x80])], bid_sizes: [Buffer.from('2')] }),
  ],
  {},
  { bid_prices: 'BYTE_ARRAY', bid_sizes: 'BYTE_ARRAY' },
)
await one(
  'review-delta-source-json-coercion-fallback',
  'delta',
  [
    book({ ingest_seq: { toString: 0 }, ts_local_ms: ['2'], ts_exchange_ms: '2' }),
    book({ ingest_seq: true, ts_local_ms: true, ts_exchange_ms: 2.9 }),
  ],
  {},
  { ingest_seq: 'JSON', ts_local_ms: 'JSON', ts_exchange_ms: 'JSON' },
)

const results = []
for (const scenario of cases) {
  const ticks: unknown[] = []
  let failed = false
  try {
    const replay =
      scenario.mode === 'paired'
        ? replayTelonexPairedParquetForMarket
        : replayTelonexDeltaParquetForMarket
    await replay({
      filePath: scenario.filePath,
      shouldStop: () => scenario.stopAfter !== undefined && ticks.length >= scenario.stopAfter,
      onSnapshot: async (snapshot, event) => {
        ticks.push(
          JSON.parse(
            JSON.stringify(
              { snapshot, msg: event.msg, source: event.source, rawJson: event.rawJson },
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
await writeFile(resolve(directory, 'telonex-cases.json'), JSON.stringify(cases))
await writeFile(resolve(directory, 'telonex-reference.json'), JSON.stringify(results))
console.log(
  JSON.stringify({
    cases: cases.length,
    ticks: results.reduce((sum, item) => sum + item.ticks.length, 0),
  }),
)
