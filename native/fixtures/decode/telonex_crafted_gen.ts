/**
 * Crafted telonex-delta fixtures and their golden (15 §10 I-V1; 60 §7.1
 * GF-1/GF-2, §7.2 "Telonex row decode, crafted skip rows").
 *
 * Writes small Parquet files with the real converter schema
 * (`typedDeltaMarketEventParquetSchema`, so they double as the version-1
 * fingerprint test against the TS schema definition) plus files with other
 * footers and schemas, to `native/fixtures/decode/crafted/`. Every I-16 skip
 * case, the I-17 asset-column rule, the 15 §8 anomaly cases and the
 * I-12/I-13/I-18 error cases have rows. Each file is then replayed by the
 * real `replayTelonexDeltaParquetForMarket`, and the raw events it hands to
 * `onSnapshot` (kind, asset id, level strings, exchange and local time) are
 * recorded; a TS error is recorded as such.
 *
 * `expect` holds what the spec requires of the Rust reader: the error
 * class/cause, or the 15 §8 counters for the file's crafted anomalies. It is
 * written by hand from the spec, not taken from TS (TS counts none of them).
 *
 * Output: `native/fixtures/decode/telonex_crafted_golden.json`, sorted keys,
 * prettier-formatted, header {contentPin, generator, generatorSha256}.
 *
 * Usage (repo root): npx tsx native/fixtures/decode/telonex_crafted_gen.ts [--check]
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import * as prettier from 'prettier'
import {
  rawMarketEventParquetSchema,
  typedDeltaMarketEventParquetSchema,
} from '../../../src/parquet/io/eventSchema.js'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const GENERATOR = 'native/fixtures/decode/telonex_crafted_gen.ts'
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const goldenPath = path.join(import.meta.dirname, 'telonex_crafted_golden.json')
const check = process.argv.includes('--check')
const craftedDir = check
  ? path.join(os.tmpdir(), `telonex-crafted-${process.pid}`)
  : path.join(import.meta.dirname, 'crafted')

const UP = '111111'
const DOWN = '222222'
const MKT = '0xC0FFEE'

type Row = Record<string, unknown>
let seq = 0n
/** A typed row with defaults (book of asset index 0, both asset ids). */
function row(o: Row): Row {
  seq += 1n
  return {
    ingest_seq: seq,
    ts_local_ms: 0n,
    ts_exchange_ms: 0n,
    event_type: 'book',
    market: MKT,
    asset0_id: UP,
    asset1_id: DOWN,
    asset_index: 0,
    bid_prices: [],
    bid_sizes: [],
    ask_prices: [],
    ask_sizes: [],
    change_asset_indexes: [],
    change_side_codes: [],
    change_prices: [],
    change_sizes: [],
    ...o,
  }
}
/** Removes keys (absent optional values are nulls in Parquet). */
function without(r: Row, ...keys: string[]): Row {
  const out = { ...r }
  for (const k of keys) delete out[k]
  return out
}
const pc = (ts: number, local: number, changes: [number, number, string, string][], o: Row = {}) =>
  row({
    event_type: 'price_change',
    ts_exchange_ms: BigInt(ts),
    ts_local_ms: BigInt(local),
    change_asset_indexes: changes.map((c) => c[0]),
    change_side_codes: changes.map((c) => c[1]),
    change_prices: changes.map((c) => c[2]),
    change_sizes: changes.map((c) => c[3]),
    ...o,
  })
const book = (
  ts: number,
  local: number,
  index: number,
  bids: string[][],
  asks: string[][],
  o: Row = {},
) =>
  row({
    ts_exchange_ms: BigInt(ts),
    ts_local_ms: BigInt(local),
    asset_index: index,
    bid_prices: bids.map((l) => l[0]),
    bid_sizes: bids.map((l) => l[1]),
    ask_prices: asks.map((l) => l[0]),
    ask_sizes: asks.map((l) => l[1]),
    ...o,
  })

type Expect = { error: { class: string; cause: string } } | { counters: Record<string, number> }
type Crafted = {
  name: string
  note: string
  schema?: parquet.ParquetSchema
  footer?: Record<string, string>
  rows: Row[]
  tokens?: [string, string]
  expect: Expect
}

const ok = (counters: Record<string, number>): Expect => ({ counters })
const err = (cls: string, cause: string): Expect => ({ error: { class: cls, cause } })

function skipRows(): Row[] {
  seq = 0n
  const rows = [
    book(
      1000,
      1050,
      0,
      [
        ['0.40', '10'],
        ['0.39', '5'],
      ],
      [['0.60', '7']],
      { asset1_id: undefined },
    ),
    book(1001, 1051, 0, [['0.40', '1']], [], { market: '' }), // blank market
    book(1001, 1051, 0, [['abc', '1']], [], { market: '   ' }), // blank market; bad decimal never parsed
    without(book(0, 1052, 0, [['0.40', '1']], []), 'ts_exchange_ms'), // null exchange ts
    book(-5, 1053, 0, [['0.40', '1']], []), // negative exchange ts
    row({ event_type: 'last_trade_price', ts_exchange_ms: 1002n, ts_local_ms: 1054n }),
    row({ event_type: 'tick_size_change', ts_exchange_ms: 1002n, ts_local_ms: 1054n }),
    row({ event_type: 'BOOK', ts_exchange_ms: 1002n, ts_local_ms: 1054n }),
    without(book(1003, 1055, 0, [['0.40', '1']], []), 'asset_index'), // null asset index: TS reads Number(null) = 0, a book of asset0 (kept)
    book(1003, 1055, 2, [['0.40', '1']], []), // index 2
    book(1003, 1055, -1, [['0.40', '1']], []), // index -1
    book(1003, 1055, 1, [['0.40', '1']], [], { asset1_id: undefined }), // index 1, no asset1
    book(1003, 1055, 1, [['0.40', '1']], [], { asset1_id: '   ' }), // index 1, blank asset1
    pc(1004, 1056, []), // no changes
    pc(1004, 1056, [[0, 2, '0.41', '1']]), // only a bad side code
    pc(1004, 1056, [[5, 0, '0.41', '1']]), // only a bad asset index
    pc(1004, 1056, [[1, 0, '0.41', '1']], { asset1_id: undefined }), // asset1 absent
    pc(1005, 1057, [
      [0, 0, '0.41', '3'],
      [0, 7, 'abc', '1'], // dropped before its decimals are parsed
      [3, 1, '0.5', '1'],
      [1, 1, '0.58', '2'],
    ]),
    row({
      event_type: 'price_change',
      ts_exchange_ms: 1006n,
      ts_local_ms: 1058n,
      change_asset_indexes: [0, 1, 0],
      change_side_codes: [1, 0],
      change_prices: ['0.61', '0.38', '0.5'],
      change_sizes: ['1', '2', '3', '4'],
    }), // ragged lists: min length 2
    book(
      1007,
      1059,
      1,
      [
        ['0.38', '4'],
        ['0.37', '5'],
        ['0.36', '6'],
      ],
      [['0.62', '1']],
      {
        bid_sizes: ['4', '5'],
        ask_sizes: ['1', '9'],
      },
    ), // ragged book sides
    book(
      0,
      0,
      1,
      [
        ['0.30', '0'],
        ['0.29', '-1'],
      ],
      [['0.70', '2']],
    ), // ts 0 kept; local 0 = none
    pc(1100, -7, [[0, 0, '0.42', '1']]), // negative local = none; exchange back from 1007? no: 0 -> 1100
    pc(1200, 1150, [[0, 0, '0.43', '1']]), // local behind exchange
    pc(1190, 1300, [[1, 1, '0.57', '1']]), // exchange steps back
    pc(1300, 1250, [[1, 1, '0.56', '1']]), // local steps back and behind exchange
    pc(1301, 1310, [[0, 1, '0.59', '1']], { ingest_seq: 25n }), // ingest_seq repeats
    pc(1302, 1311, [[0, 1, '0.59', '2']]),
    pc(1302, 1311, [[0, 1, '0.59', '2']]), // duplicate of the previous row
    pc(1303, 1312, [
      [0, 0, '0.1234565', '1.0000001'], // 7 dp: inexact, rounded half away from zero
      [1, 0, '5e-1', '1.5E1'], // exponents
      [1, 1, '0.000000499', '2'], // rounds to 0 micros
    ]),
    book(
      1304,
      1313,
      0,
      [
        ['0.45', '0'],
        ['0.44', '-3'],
        ['0.43', '1e0'],
      ],
      [
        ['1', '1'],
        ['0', '1'],
      ],
    ),
  ]
  return rows
}

function smallRows(): Row[] {
  seq = 0n
  return [
    book(10, 11, 0, [['0.4', '1']], [['0.6', '1']], { asset1_id: undefined }),
    book(12, 13, 1, [['0.3', '2']], [['0.7', '2']]),
    pc(14, 15, [
      [0, 0, '0.41', '1'],
      [1, 1, '0.69', '0'],
    ]),
  ]
}

const files: Crafted[] = [
  {
    name: 'skip_rows',
    note: 'every I-16 skip case, ragged lists, clocks, ingest_seq, duplicates, inexact decimals; 5-row groups',
    rows: skipRows(),
    expect: ok({
      blankMarket: 2,
      noExchangeTs: 2,
      otherEventType: 3,
      unresolvedBookAsset: 4,
      emptyPriceChange: 4,
      droppedChanges: 5,
      inexactDecimal: 3,
      exchangeClockBackwards: 2,
      localClockBackwards: 1,
      localBehindExchange: 2,
      ingestSeqBackwards: 1,
      duplicateRows: 1,
      rowsRead: 30,
    }),
  },
  {
    name: 'asset_order',
    note: 'I-17: asset0 is the DOWN token; indexes refer to the row columns, not outcome order',
    rows: smallRows().map((r) => ({
      ...r,
      asset0_id: r.asset0_id === UP ? DOWN : r.asset0_id,
      asset1_id: r.asset1_id === DOWN ? UP : r.asset1_id,
    })),
    expect: ok({ rowsRead: 3 }),
  },
  {
    name: 'footer_v1',
    note: 'I-12: footer keys naming version 1 are accepted',
    footer: { pmb_format: 'telonex-delta-typed', pmb_format_version: '1', book_interval: '500' },
    rows: smallRows(),
    expect: ok({ rowsRead: 3 }),
  },
  {
    name: 'empty',
    note: 'v1 schema, no rows',
    rows: [],
    expect: ok({ rowsRead: 0 }),
  },
  {
    name: 'footer_v2',
    note: 'I-12/I-13: unknown version in the footer',
    footer: { pmb_format: 'telonex-delta-typed', pmb_format_version: '2' },
    rows: smallRows(),
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'footer_other_format',
    note: 'I-12: footer names another format',
    footer: { pmb_format: 'telonex-paired', pmb_format_version: '1' },
    rows: smallRows(),
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'footer_version_only',
    note: 'I-12: only one of the two footer keys (D-PENDING: refused)',
    footer: { pmb_format_version: '1' },
    rows: smallRows(),
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'schema_raw_events',
    note: 'I-12: the legacy raw-event schema is not v1',
    schema: rawMarketEventParquetSchema,
    rows: [
      { ingest_seq: 1n, ts_local_ms: 1n, ts_exchange_ms: 1n, event_type: 'book', raw_json: '{}' },
    ],
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'schema_int64_asset_index',
    note: 'I-11: a physical type differs',
    schema: new parquet.ParquetSchema({
      ...typedDeltaMarketEventParquetSchema.schema,
      asset_index: { type: 'INT64', optional: true, compression: 'GZIP' },
    }),
    rows: smallRows().map((r) => ({ ...r, asset_index: BigInt(r.asset_index as number) })),
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'schema_unannotated_event_type',
    note: 'I-11: a logical type differs (BYTE_ARRAY without UTF8)',
    schema: new parquet.ParquetSchema({
      ...typedDeltaMarketEventParquetSchema.schema,
      event_type: { type: 'BYTE_ARRAY', compression: 'GZIP' },
    }),
    rows: smallRows(),
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'schema_extra_column',
    note: 'I-11: a 17th column',
    schema: new parquet.ParquetSchema({
      ...typedDeltaMarketEventParquetSchema.schema,
      extra: { type: 'INT32', optional: true, compression: 'GZIP' },
    }),
    rows: smallRows(),
    expect: err('data_defect', 'format_version'),
  },
  {
    name: 'foreign_asset',
    note: 'I-18: an asset id that is not a job token (TS replays it: TS bug)',
    rows: smallRows().map((r) => ({
      ...r,
      asset1_id: r.asset1_id === DOWN ? '999999' : r.asset1_id,
    })),
    expect: err('data_defect', 'foreign_file'),
  },
  {
    name: 'foreign_asset_on_skipped_row',
    note: 'I-18: a foreign asset id on a row that I-16 skips (TS skips the row)',
    rows: [...smallRows(), without(row({ asset1_id: '999999' }), 'ts_exchange_ms')],
    expect: err('data_defect', 'foreign_file'),
  },
  {
    name: 'padded_asset',
    note: 'I-17/I-18: asset ids match exactly; a padded id is foreign (TS keys a separate book)',
    rows: smallRows().map((r) => ({ ...r, asset0_id: ` ${UP}` })),
    expect: err('data_defect', 'foreign_file'),
  },
  {
    name: 'market_changes',
    note: 'I-18: the market column changes inside the file (TS throws)',
    rows: [...smallRows(), pc(16, 17, [[0, 0, '0.4', '1']], { market: '0xBEEF' })],
    expect: err('data_defect', 'foreign_file'),
  },
  {
    name: 'bad_decimal',
    note: 'I-20: an unparsable decimal in a kept row is a decode failure',
    rows: [...smallRows(), pc(16, 17, [[0, 0, '0.4.1', '1']])],
    expect: err('runtime', 'decode_unverified'),
  },
]

async function write(f: Crafted, file: string): Promise<void> {
  const writer = await parquet.ParquetWriter.openFile(
    f.schema ?? typedDeltaMarketEventParquetSchema,
    file,
    { rowGroupSize: 5 },
  )
  for (const [k, v] of Object.entries(f.footer ?? {})) writer.setMetadata(k, v)
  for (const r of f.rows) {
    const clean = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))
    await writer.appendRow(clean)
  }
  await writer.close()
}

type Lv = { price: string; size: string }
async function replay(file: string) {
  const events: unknown[] = []
  try {
    await replayTelonexDeltaParquetForMarket({
      filePath: file,
      onSnapshot: (_snap, raw) => {
        const m = raw.msg
        const base = { local: raw.source.tsLocalMs ?? null, ts: Number(m.timestamp) }
        if (m.event_type === 'book') {
          const lv = (ls: Lv[]) => ls.map((l) => [l.price, l.size])
          events.push({
            ...base,
            asset: m.asset_id,
            asks: lv(m.asks),
            bids: lv(m.bids),
            kind: 'book',
          })
        } else if (m.event_type === 'price_change') {
          const changes = m.price_changes.map((c) => [c.asset_id, c.side, c.price, c.size])
          events.push({ ...base, changes, kind: 'price_change' })
        } else {
          throw new Error(`unexpected ${m.event_type}`)
        }
      },
    })
    return { events }
  } catch (e) {
    return { error: (e as Error).message, eventsBeforeError: events.length }
  }
}

mkdirSync(craftedDir, { recursive: true })
const out = []
for (const f of files) {
  const file = path.join(craftedDir, `${f.name}.parquet`)
  rmSync(file, { force: true })
  await write(f, file)
  const bytes = readFileSync(file)
  out.push({
    bytes: bytes.length,
    expect: f.expect,
    file: `crafted/${f.name}.parquet`,
    name: f.name,
    note: f.note,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tokens: f.tokens ?? [UP, DOWN],
    ts: await replay(file),
  })
}
if (check) rmSync(craftedDir, { recursive: true, force: true })

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    )
  }
  return v
}

const body = sortKeys({
  conditionId: MKT,
  files: out,
  spec: 'native-spec-g1 15 §4.1 I-11..I-13, §4.2 I-15..I-20, §8, §10 I-V1; 60 §7.2',
}) as Record<string, unknown>
const bodyText = JSON.stringify(body)
let previous: string | null = null
let contentPin = execSync('git merge-base HEAD origin/main', { cwd: repoRoot }).toString().trim()
if (existsSync(goldenPath)) {
  const { header, ...prev } = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<
    string,
    unknown
  >
  previous = JSON.stringify(sortKeys(prev))
  if (previous === bodyText) contentPin = (header as { contentPin: string }).contentPin
}
if (check) {
  if (previous !== bodyText) {
    console.error(`${path.relative(repoRoot, goldenPath)}: content differs from the TS oracle`)
    process.exit(1)
  }
  console.log(`${path.relative(repoRoot, goldenPath)}: up to date`)
} else {
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, GENERATOR)))
    .digest('hex')
  const doc = sortKeys({ ...body, header: { contentPin, generator: GENERATOR, generatorSha256 } })
  const options = (await prettier.resolveConfig(goldenPath)) ?? {}
  writeFileSync(
    goldenPath,
    await prettier.format(JSON.stringify(doc), { ...options, filepath: goldenPath }),
  )
  console.log(
    out
      .map(
        (f) =>
          `${f.file} ${f.bytes} B ${'error' in f.ts ? 'ts-error' : `${f.ts.events.length} events`}`,
      )
      .join('\n'),
  )
}
