import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import Int64 from 'node-int64'
import parquetThrift, {
  FileMetaData,
  PageHeader,
  DictionaryPageHeader,
  DataPageHeaderV2,
  LogicalType,
  DecimalType,
  JsonType,
  StringType,
} from '@dsnp/parquetjs/dist/gen-nodejs/parquet_types.js'
import { decodeThrift, serializeThrift } from '@dsnp/parquetjs/dist/lib/util.js'
import type { FileMetaDataExt } from '@dsnp/parquetjs/dist/lib/declare.js'
import { getParquetTypeDataObject } from '@dsnp/parquetjs/dist/lib/types.js'
import { rawMarketEventParquetSchema } from '../../src/parquet/io/eventSchema.js'
import { MinHeap } from '../../src/utils/minHeap.js'
import { toBigInt } from '../../src/utils/toBigInt.js'

type Row = {
  ingest_seq?: unknown
  ts_local_ms?: unknown
  ts_exchange_ms?: unknown
  raw_json?: unknown
  event_type?: unknown
}
type Case = { name: string; filePaths: string[]; order: string }
const { PageType, Encoding } = parquetThrift
const dir = resolve(process.argv[2]!)
await mkdir(dir, { recursive: true })
const paths: Record<string, string> = {}
async function file(
  name: string,
  schema: parquet.ParquetSchema,
  rows: Record<string, unknown>[],
  options: parquet.WriterOptions = {},
) {
  const path = resolve(dir, `${name}.parquet`)
  const writer = await parquet.ParquetWriter.openFile(schema, path, { rowGroupSize: 2, ...options })
  try {
    for (const row of rows) await writer.appendRow(row)
  } finally {
    await writer.close()
  }
  paths[name] = path
}
const raw = (id: string) =>
  JSON.stringify({
    event_type: 'book',
    market: 'm',
    asset_id: id,
    bids: [],
    asks: [],
    timestamp: '10',
  })
await file('a', rawMarketEventParquetSchema, [
  {
    ingest_seq: 10n,
    ts_local_ms: 3n,
    ts_exchange_ms: 30n,
    event_type: 'book',
    raw_json: raw('a0'),
  },
  { ingest_seq: 1n, ts_local_ms: 2n, event_type: 'book', raw_json: raw('a1') },
  {
    ingest_seq: 9223372036854775807n,
    ts_local_ms: 9007199254740993n,
    ts_exchange_ms: 1n,
    event_type: 'book',
    raw_json: raw('a2'),
  },
])
await file('b', rawMarketEventParquetSchema, [
  {
    ingest_seq: 10n,
    ts_local_ms: 3n,
    ts_exchange_ms: 20n,
    event_type: 'book',
    raw_json: raw('b0'),
  },
  {
    ingest_seq: 11n,
    ts_local_ms: -4n,
    ts_exchange_ms: 40n,
    event_type: 'price_change',
    raw_json: raw('b1'),
  },
  {
    ingest_seq: 9223372036854775806n,
    ts_local_ms: 0n,
    event_type: 'tick_size_change',
    raw_json: raw('b2'),
  },
])
await file('empty', rawMarketEventParquetSchema, [])
const keySchema = (type: 'UTF8' | 'DOUBLE' | 'JSON') =>
  new parquet.ParquetSchema({
    ingest_seq: { type, optional: true, compression: 'GZIP' },
    ts_local_ms: { type, optional: true, compression: 'GZIP' },
    ts_exchange_ms: { type, optional: true, compression: 'GZIP' },
    raw_json: { type: 'UTF8', compression: 'GZIP' },
    event_type: { type: 'UTF8', compression: 'GZIP' },
  })
const strings = [
  '184467440737095516170000',
  '\ufeff+10\ufeff',
  '0x20000000000001f',
  '-0x1',
  '0b101',
  '0o17',
  '',
  '  ',
  '-12',
  '+12',
  '1e3',
  '1_000',
  '\u0085' + '3',
  '2.0',
]
await file(
  'strings',
  keySchema('UTF8'),
  strings.map((value, i) => ({
    ingest_seq: value,
    ts_local_ms: value,
    raw_json: raw(`s${i}`),
    event_type: 'book',
  })),
)
await file(
  'numbers',
  keySchema('DOUBLE'),
  [-0, 1.75, -1.75, Number.MIN_VALUE, 1e100, NaN, Infinity, -Infinity].map((value, i) => ({
    ingest_seq: value,
    ts_local_ms: value,
    ts_exchange_ms: value,
    raw_json: raw(`n${i}`),
    event_type: 'book',
  })),
)
const jsonSchema = keySchema('JSON')
const jsonValues = [
  1.75,
  '12',
  9007199254740993,
  true,
  false,
  null,
  [],
  {},
  '0x10',
  -0,
  '\ufeff+22\ufeff',
]
await file(
  'json',
  jsonSchema,
  jsonValues.map((value, i) => ({
    ingest_seq: value,
    ts_local_ms: value,
    ts_exchange_ms: value,
    raw_json: raw(`j${i}`),
    event_type: 'book',
  })),
)
const jsonRawSchema = new parquet.ParquetSchema({
  ingest_seq: { type: 'INT64' },
  ts_local_ms: { type: 'INT64' },
  raw_json: { type: 'JSON', optional: true },
  event_type: { type: 'JSON', optional: true },
})
await file(
  'jsonRaw',
  jsonRawSchema,
  [1, '[]', '\ud800', '\udfff', '\ud83d\ude00', null, true, {}, []].map((value, i) => ({
    ingest_seq: BigInt(i),
    ts_local_ms: 1n,
    raw_json: value,
    event_type: value,
  })),
)
// Corrupt logical JSON in a later row group while preserving a valid
// Parquet container. Only the fixture writer conversion is overridden;
// the actual reader/fromPrimitive JSON parser remains unchanged.
const jsonWriterType = getParquetTypeDataObject('JSON')
const originalJsonEncoder = jsonWriterType.toPrimitive
try {
  jsonWriterType.toPrimitive = (value: unknown) => Buffer.from(String(value))
  const malformedRows = ['1', '2', '{broken', '4'].map((value, i) => ({
    ingest_seq: value,
    ts_local_ms: value,
    raw_json: raw(`bad${i}`),
    event_type: 'book',
  }))
  await file('earlyInvalidJsonStats', jsonSchema, malformedRows)
  const noStats = new parquet.ParquetSchema({
    ingest_seq: { type: 'JSON', statistics: false },
    ts_local_ms: { type: 'JSON', statistics: false },
    raw_json: { type: 'UTF8' },
    event_type: { type: 'UTF8' },
  })
  await file('lateInvalidJson', noStats, malformedRows)
  await file(
    'lateInvalidJsonLastRow',
    noStats,
    ['1', '2', '3', '{broken'].map((value, i) => ({
      ingest_seq: value,
      ts_local_ms: value,
      raw_json: raw(`badLast${i}`),
      event_type: 'book',
    })),
  )
} finally {
  jsonWriterType.toPrimitive = originalJsonEncoder
}
// Retain all raw footer fields: normalization must not erase deprecated
// statistics or turn absent zero-length bounds into invalid JSON.
await file(
  'statsOriginal',
  new parquet.ParquetSchema({
    ingest_seq: { type: 'JSON' },
    ts_local_ms: { type: 'INT64' },
    raw_json: { type: 'UTF8' },
    event_type: { type: 'UTF8' },
  }),
  [1, 2].map((value) => ({
    ingest_seq: value,
    ts_local_ms: 1n,
    raw_json: '[]',
    event_type: 'book',
  })),
)
const originalStatsFile = await readFile(paths.statsOriginal!)
const footerOffset =
  originalStatsFile.length - 8 - originalStatsFile.readUInt32LE(originalStatsFile.length - 8)
for (const name of ['emptyJsonStats', 'invalidDeprecatedMinStats', 'invalidDeprecatedMaxStats']) {
  const metadata = new FileMetaData() as FileMetaDataExt
  decodeThrift(metadata, originalStatsFile.subarray(footerOffset, originalStatsFile.length - 8))
  const statistics = metadata.row_groups[0]!.columns[0]!.meta_data!.statistics!
  if (name === 'emptyJsonStats') {
    statistics.min = Buffer.alloc(0)
    statistics.max = Buffer.alloc(0)
    statistics.min_value = Buffer.alloc(0)
    statistics.max_value = Buffer.alloc(0)
  } else {
    statistics.min_value = Buffer.from('1')
    statistics.max_value = Buffer.from('2')
    if (name === 'invalidDeprecatedMinStats') statistics.min = Buffer.from('{broken')
    else statistics.max = Buffer.from('{broken')
  }
  const footer = serializeThrift(metadata)
  const tail = Buffer.alloc(8)
  tail.writeUInt32LE(footer.length)
  tail.write('PAR1', 4)
  paths[name] = resolve(dir, `${name}.parquet`)
  await writeFile(
    paths[name]!,
    Buffer.concat([originalStatsFile.subarray(0, footerOffset), footer, tail]),
  )
}
await file(
  'pageStatsOriginal',
  new parquet.ParquetSchema({
    ingest_seq: { type: 'JSON' },
    ts_local_ms: { type: 'INT64' },
    raw_json: { type: 'UTF8' },
    event_type: { type: 'UTF8' },
  }),
  [1, 2, 3, 4].map((value) => ({
    ingest_seq: value,
    ts_local_ms: 1n,
    raw_json: '[]',
    event_type: 'book',
  })),
)
const pageStatsBytes = await readFile(paths.pageStatsOriginal!)
const pageMetadata = new FileMetaData() as FileMetaDataExt
const pageFooterOffset =
  pageStatsBytes.length - 8 - pageStatsBytes.readUInt32LE(pageStatsBytes.length - 8)
decodeThrift(pageMetadata, pageStatsBytes.subarray(pageFooterOffset, pageStatsBytes.length - 8))
for (const name of [
  'earlyInvalidPageJsonStats',
  'lateInvalidPageJsonStats',
  'deprecatedInvalidPageJsonStats',
]) {
  const groupIndex = name === 'lateInvalidPageJsonStats' ? 1 : 0
  const offset = Number(
    pageMetadata.row_groups[groupIndex]!.columns[0]!.meta_data!.data_page_offset,
  )
  const header = new PageHeader()
  const headerSize = decodeThrift(header, pageStatsBytes.subarray(offset))
  const statistics = (header.data_page_header ?? header.data_page_header_v2)!.statistics!
  if (name === 'deprecatedInvalidPageJsonStats') statistics.min = Buffer.from('x')
  else
    for (const key of ['min', 'max', 'min_value', 'max_value'] as const) {
      if (statistics[key]?.length) statistics[key] = Buffer.from('x')
    }
  const serialized = serializeThrift(header)
  if (serialized.length !== headerSize) throw new Error('Page mutation must retain offsets')
  const mutated = Buffer.from(pageStatsBytes)
  serialized.copy(mutated, offset)
  paths[name] = resolve(dir, `${name}.parquet`)
  await writeFile(paths[name]!, mutated)
}
const decimalCases: string[] = []
for (const precision of [4, 12, 18]) {
  for (const compression of ['UNCOMPRESSED', 'GZIP', 'SNAPPY'] as const) {
    for (const useDataPageV2 of [false, true]) {
      const name = `decimal-${precision}-${compression}-${useDataPageV2 ? 'v2' : 'v1'}`
      const schema = new parquet.ParquetSchema({
        ingest_seq: {
          type: 'DECIMAL',
          precision,
          scale: 2,
          optional: true,
          compression,
          statistics: false,
        },
        ts_local_ms: {
          type: 'DECIMAL',
          precision,
          scale: 2,
          optional: true,
          compression,
          statistics: false,
        },
        ts_exchange_ms: {
          type: 'DECIMAL',
          precision,
          scale: 2,
          optional: true,
          compression,
          statistics: false,
        },
        raw_json: { type: 'UTF8' },
        event_type: { type: 'UTF8' },
      })
      await file(
        name,
        schema,
        [12, -12, 123, null, 0, -0.01, 90071992547409].map((value, i) => ({
          ingest_seq: value,
          ts_local_ms: value,
          ts_exchange_ms: value,
          raw_json: raw(`${name}:${i}`),
          event_type: 'book',
        })),
        { rowGroupSize: 4, pageSize: 3, useDataPageV2, pageIndex: false },
      )
      decimalCases.push(name)
    }
  }
}
for (const fixed of [false, true]) {
  const name = `decimal-buffer-${fixed ? 'fixed' : 'byte'}`
  const schema = new parquet.ParquetSchema({
    ingest_seq: {
      type: 'DECIMAL',
      precision: 20,
      scale: 2,
      ...(fixed ? { typeLength: 9 } : {}),
      statistics: false,
    },
    ts_local_ms: { type: 'INT64' },
    raw_json: { type: 'UTF8' },
    event_type: { type: 'UTF8' },
  })
  await file(
    name,
    schema,
    [1, 2, 3].map((value) => ({
      ingest_seq: Buffer.alloc(9, value),
      ts_local_ms: 1n,
      raw_json: '[]',
      event_type: 'book',
    })),
    { pageIndex: false },
  )
  decimalCases.push(name)
}
// Replace a real writer-produced column chunk with physical dictionary/data
// pages, retaining the original container/schema and updating every offset.
// Dictionary decoding uses reconstructed logical schema; data pages use the
// original physical type. BYTE_ARRAY precision4 deliberately distinguishes it.
for (const kind of [
  'int64',
  'int64-late',
  'byte',
  'fixed',
  'fixed-missing',
  'fixed-crosspage',
  'fixed-mixed',
] as const) {
  const byteArray = kind === 'byte'
  const fixedArray = kind.startsWith('fixed')
  for (const precision of [4, 12]) {
    const name = `decimal-dictionary-${kind}-${precision}`
    const schema = new parquet.ParquetSchema({
      ingest_seq: {
        type: 'DECIMAL',
        precision: byteArray ? 20 : precision,
        ...(fixedArray ? { typeLength: 9 } : {}),
        scale: 2,
        statistics: false,
      },
      ts_local_ms: { type: 'INT64' },
      raw_json: { type: 'UTF8' },
      event_type: { type: 'UTF8' },
    })
    const values = [1200, -1200, 12300]
    await file(
      name,
      schema,
      (kind === 'int64-late' ? [0, 2, 1, 0, 0, 2, 1, 0] : [0, 2, 1, 0]).map((index) => ({
        ingest_seq: fixedArray
          ? Buffer.alloc(9, index)
          : byteArray
            ? Buffer.from([0, 0, 0, 1])
            : values[index]! / 100,
        ts_local_ms: 1n,
        raw_json: '[]',
        event_type: 'book',
      })),
      { rowGroupSize: 4, useDataPageV2: true, pageIndex: false },
    )
    const bytes = await readFile(paths[name]!)
    const footerOffset = bytes.length - 8 - bytes.readUInt32LE(bytes.length - 8)
    const metadata = new FileMetaData() as FileMetaDataExt
    decodeThrift(metadata, bytes.subarray(footerOffset, bytes.length - 8))
    if (byteArray)
      metadata.schema.find((field) => field.name === 'ingest_seq')!.precision = precision
    const group = metadata.row_groups[kind === 'int64-late' ? 1 : 0]!
    const column = group.columns[0]!.meta_data!
    const start = Number(column.data_page_offset),
      oldLength = Number(column.total_compressed_size)
    const dict = Buffer.concat(
      values.map((value) => {
        const raw = Buffer.alloc(fixedArray ? 9 : 8)
        if (fixedArray) raw.fill(Math.abs(value) % 256)
        else if (byteArray) {
          raw.writeUInt32LE(4)
          raw.writeInt32LE(value, 4)
        } else raw.writeBigInt64LE(BigInt(value))
        return raw
      }),
    )
    const dictHeader = serializeThrift(
      new PageHeader({
        type: PageType.DICTIONARY_PAGE,
        uncompressed_page_size: dict.length,
        compressed_page_size: dict.length,
        dictionary_page_header: new DictionaryPageHeader({
          num_values: 3,
          encoding: Encoding.PLAIN,
        }),
      }),
    )
    // Index3 is outside the three-entry dictionary. The reference compacts
    // that undefined value before materialization; preserve the admitted rows.
    const dataPage = (values: Buffer, count: number, encoding: number) => {
      const header = serializeThrift(
        new PageHeader({
          type: PageType.DATA_PAGE_V2,
          uncompressed_page_size: values.length,
          compressed_page_size: values.length,
          data_page_header_v2: new DataPageHeaderV2({
            num_values: count,
            num_nulls: 0,
            num_rows: count,
            encoding,
            definition_levels_byte_length: 0,
            repetition_levels_byte_length: 0,
            is_compressed: false,
          }),
        }),
      )
      return Buffer.concat([header, values])
    }
    const pages =
      kind === 'fixed-crosspage'
        ? [
            dataPage(Buffer.from([2, 3, 3, 0]), 2, Encoding.RLE_DICTIONARY),
            dataPage(Buffer.from([2, 3, 1, 0]), 2, Encoding.RLE_DICTIONARY),
          ]
        : kind === 'fixed-mixed'
          ? [
              dataPage(Buffer.from([2, 3, 8, 0]), 2, Encoding.RLE_DICTIONARY),
              dataPage(
                Buffer.concat([Buffer.alloc(9, 0x77), Buffer.alloc(9, 0x88)]),
                2,
                Encoding.PLAIN,
              ),
            ]
          : [
              dataPage(
                Buffer.from([2, 3, kind === 'fixed-missing' ? 0x13 : 0x18, 0]),
                4,
                Encoding.RLE_DICTIONARY,
              ),
            ]
    const replacement = Buffer.concat([dictHeader, dict, ...pages])
    const delta = replacement.length - oldLength
    column.dictionary_page_offset = new Int64(start)
    column.data_page_offset = new Int64(start + dictHeader.length + dict.length)
    column.total_compressed_size = new Int64(replacement.length)
    column.total_uncompressed_size = new Int64(replacement.length)
    column.encodings = [Encoding.PLAIN, Encoding.RLE_DICTIONARY]
    group.total_byte_size = new Int64(Number(group.total_byte_size) + delta)
    for (const other of group.columns.slice(1)) {
      const data = other.meta_data!
      data.data_page_offset = new Int64(Number(data.data_page_offset) + delta)
      if (data.dictionary_page_offset)
        data.dictionary_page_offset = new Int64(Number(data.dictionary_page_offset) + delta)
      if (other.file_offset) other.file_offset = new Int64(Number(other.file_offset) + delta)
    }
    const footer = serializeThrift(metadata),
      tail = Buffer.alloc(8)
    tail.writeUInt32LE(footer.length)
    tail.write('PAR1', 4)
    await writeFile(
      paths[name]!,
      Buffer.concat([
        bytes.subarray(0, start),
        replacement,
        bytes.subarray(start + oldLength, footerOffset),
        footer,
        tail,
      ]),
    )
    decimalCases.push(name)
  }
}
// The pinned reader ignores logicalType without converted_type. Native
// descriptors synthesize a converted type, so retain raw footer provenance.
for (const kind of ['decimal', 'json', 'ignored-incompatible'] as const) {
  const name = `logical-only-${kind}`
  const source = paths[kind !== 'json' ? 'decimal-12-UNCOMPRESSED-v1' : 'json']!
  const bytes = await readFile(source)
  const footerOffset = bytes.length - 8 - bytes.readUInt32LE(bytes.length - 8)
  const metadata = new FileMetaData() as FileMetaDataExt
  decodeThrift(metadata, bytes.subarray(footerOffset, bytes.length - 8))
  for (const field of metadata.schema) {
    if (
      field.converted_type !==
      (kind !== 'json' ? parquetThrift.ConvertedType.DECIMAL : parquetThrift.ConvertedType.JSON)
    )
      continue
    field.converted_type = null as unknown as typeof field.converted_type
    field.logicalType =
      kind === 'ignored-incompatible'
        ? new LogicalType({ STRING: new StringType() })
        : kind === 'decimal'
          ? new LogicalType({
              DECIMAL: new DecimalType({ scale: field.scale!, precision: field.precision! }),
            })
          : new LogicalType({ JSON: new JsonType() })
  }
  const footer = serializeThrift(metadata),
    tail = Buffer.alloc(8)
  tail.writeUInt32LE(footer.length)
  tail.write('PAR1', 4)
  const path = resolve(dir, `${name}.parquet`)
  await writeFile(path, Buffer.concat([bytes.subarray(0, footerOffset), footer, tail]))
  paths[name] = path
  decimalCases.push(name)
}
for (const kind of ['header', 'version'] as const) {
  const name = `invalid-${kind}`
  const bytes = await readFile(paths.a!)
  const footerOffset = bytes.length - 8 - bytes.readUInt32LE(bytes.length - 8)
  const metadata = new FileMetaData() as FileMetaDataExt
  decodeThrift(metadata, bytes.subarray(footerOffset, bytes.length - 8))
  if (kind === 'header') bytes.write('FAIL', 0)
  else metadata.version = 99
  const footer = serializeThrift(metadata),
    tail = Buffer.alloc(8)
  tail.writeUInt32LE(footer.length)
  tail.write('PAR1', 4)
  const path = resolve(dir, `${name}.parquet`)
  await writeFile(path, Buffer.concat([bytes.subarray(0, footerOffset), footer, tail]))
  paths[name] = path
  decimalCases.push(name)
}
for (const [precision, scale] of [
  [20, 2],
  [20, 19],
  [24, 23],
  [309, 308],
  [310, 309],
  [2147483647, 2147483647],
]) {
  const name = `decimal-raw-${precision}-${scale}`
  const bytes = await readFile(paths['decimal-12-UNCOMPRESSED-v1']!)
  const footerOffset = bytes.length - 8 - bytes.readUInt32LE(bytes.length - 8)
  const metadata = new FileMetaData() as FileMetaDataExt
  decodeThrift(metadata, bytes.subarray(footerOffset, bytes.length - 8))
  for (const field of metadata.schema)
    if (field.converted_type === parquetThrift.ConvertedType.DECIMAL) {
      field.precision = precision!
      field.scale = scale!
    }
  const footer = serializeThrift(metadata),
    tail = Buffer.alloc(8)
  tail.writeUInt32LE(footer.length)
  tail.write('PAR1', 4)
  const path = resolve(dir, `${name}.parquet`)
  await writeFile(path, Buffer.concat([bytes.subarray(0, footerOffset), footer, tail]))
  paths[name] = path
  decimalCases.push(name)
}
for (const kind of ['precision', 'scale', 'scale-over-precision']) {
  const name = `decimal-invalid-${kind}`
  const bytes = await readFile(paths['decimal-12-UNCOMPRESSED-v1']!)
  const footerOffset = bytes.length - 8 - bytes.readUInt32LE(bytes.length - 8)
  const metadata = new FileMetaData() as FileMetaDataExt
  decodeThrift(metadata, bytes.subarray(footerOffset, bytes.length - 8))
  const field = metadata.schema.find((value) => value.name === 'ingest_seq')!
  if (kind === 'precision') field.precision = null as unknown as number
  else if (kind === 'scale') field.scale = null as unknown as number
  else field.scale = 13
  const footer = serializeThrift(metadata),
    tail = Buffer.alloc(8)
  tail.writeUInt32LE(footer.length)
  tail.write('PAR1', 4)
  const path = resolve(dir, `${name}.parquet`)
  await writeFile(path, Buffer.concat([bytes.subarray(0, footerOffset), footer, tail]))
  paths[name] = path
  decimalCases.push(name)
}
const cases: Case[] = []
for (const name of decimalCases) {
  cases.push({ name, filePaths: [paths[name]!], order: 'recorded' })
}
for (const order of ['recorded', 'exchange_time']) {
  for (const names of [
    ['a', 'b', 'empty'],
    ['b', 'a'],
    ['empty'],
    ['strings'],
    ['numbers'],
    ['json'],
    ['jsonRaw'],
  ]) {
    cases.push({
      name: `${order}:${names.join(',')}`,
      filePaths: names.map((name) => paths[name]!),
      order,
    })
  }
}
cases.push({
  name: 'missingFile',
  filePaths: [paths.a!, resolve(dir, 'missing.parquet')],
  order: 'recorded',
})
cases.push({ name: 'noFiles', filePaths: [], order: 'recorded' })
cases.push({
  name: 'earlyInvalidJsonStats',
  filePaths: [paths.earlyInvalidJsonStats!],
  order: 'recorded',
})
for (const name of [
  'lateInvalidJson',
  'lateInvalidJsonLastRow',
  'emptyJsonStats',
  'invalidDeprecatedMinStats',
  'invalidDeprecatedMaxStats',
])
  cases.push({ name, filePaths: [paths[name]!], order: 'recorded' })
for (const name of [
  'earlyInvalidPageJsonStats',
  'lateInvalidPageJsonStats',
  'deprecatedInvalidPageJsonStats',
])
  cases.push({ name, filePaths: [paths[name]!], order: 'recorded' })
const units = (value: string) =>
  Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))
const bits = (value: number) => {
  const b = Buffer.alloc(8)
  b.writeDoubleBE(value)
  return b.toString('hex')
}
const results = []
for (const test of cases) {
  const readers: parquet.ParquetReader[] = []
  const rows = []
  try {
    if (!test.filePaths.length) throw new Error('filePaths required')
    for (const path of test.filePaths) readers.push(await parquet.ParquetReader.openFile(path))
    const cursors = readers.map((reader) => reader.getCursor())
    const heap = new MinHeap()
    const counts = readers.map(() => 0)
    async function refill(i: number) {
      const row = (await cursors[i]!.next()) as Row | null
      if (!row) return
      const local = toBigInt(row.ts_local_ms, 0n)
      heap.push({
        fileIdx: i,
        row,
        keySeq: toBigInt(row.ingest_seq, 0n),
        keyTs: test.order === 'exchange_time' ? toBigInt(row.ts_exchange_ms, local) : local,
      })
    }
    for (let i = 0; i < cursors.length; i++) await refill(i)
    for (;;) {
      const item = heap.pop()
      if (!item) break
      const local = Number(toBigInt(item.row.ts_local_ms, 0n))
      rows.push({
        fileIndex: item.fileIdx,
        rowIndex: counts[item.fileIdx]!++,
        ingestSeq: item.keySeq.toString(),
        keyTs: item.keyTs.toString(),
        localTimeMsBits: local > 0 ? bits(local) : null,
        ingestNumberBits:
          typeof item.row.ingest_seq === 'number' ? bits(item.row.ingest_seq) : null,
        localNumberBits:
          typeof item.row.ts_local_ms === 'number' ? bits(item.row.ts_local_ms) : null,
        exchangeNumberBits:
          typeof item.row.ts_exchange_ms === 'number' ? bits(item.row.ts_exchange_ms) : null,
        ingestBufferHex: Buffer.isBuffer(item.row.ingest_seq)
          ? item.row.ingest_seq.toString('hex')
          : null,
        localBufferHex: Buffer.isBuffer(item.row.ts_local_ms)
          ? item.row.ts_local_ms.toString('hex')
          : null,
        exchangeBufferHex: Buffer.isBuffer(item.row.ts_exchange_ms)
          ? item.row.ts_exchange_ms.toString('hex')
          : null,
        rawJsonUtf16: typeof item.row.raw_json === 'string' ? units(item.row.raw_json) : null,
        eventTypeUtf16: typeof item.row.event_type === 'string' ? units(item.row.event_type) : null,
      })
      await refill(item.fileIdx)
    }
    results.push({ name: test.name, rows, error: false })
  } catch {
    results.push({ name: test.name, rows, error: true })
  } finally {
    await Promise.all(readers.map((reader) => reader.close()))
  }
}
const early = results.find((result) => result.name === 'earlyInvalidJsonStats')!
if (!early.error || early.rows.length !== 0)
  throw new Error('Invalid JSON statistics must fail before row admission')
for (const name of ['lateInvalidJson', 'lateInvalidJsonLastRow']) {
  const result = results.find((result) => result.name === name)!
  if (!result.error || result.rows.length !== 2)
    throw new Error(
      `Invalid row group must retain exactly two earlier rows: ${JSON.stringify(result)}`,
    )
}
for (const name of ['invalidDeprecatedMinStats', 'invalidDeprecatedMaxStats']) {
  const result = results.find((result) => result.name === name)!
  if (!result.error || result.rows.length !== 0)
    throw new Error(`Invalid deprecated statistics must fail before admission: ${name}`)
}
const emptyStats = results.find((result) => result.name === 'emptyJsonStats')!
if (emptyStats.error || emptyStats.rows.length !== 2)
  throw new Error('Empty JSON statistics must admit both valid rows')
for (const name of [
  'earlyInvalidPageJsonStats',
  'lateInvalidPageJsonStats',
  'deprecatedInvalidPageJsonStats',
]) {
  const result = results.find((result) => result.name === name)!
  const prefix = name === 'lateInvalidPageJsonStats' ? 2 : 0
  if (!result.error || result.rows.length !== prefix)
    throw new Error(`Page statistics must fail at lazy group admission: ${JSON.stringify(result)}`)
}
for (const precision of [4, 12]) {
  for (const kind of ['int64', 'byte', 'int64-late']) {
    const result = results.find(
      (value) => value.name === `decimal-dictionary-${kind}-${precision}`,
    )!
    if (!result.error || result.rows.length !== (kind === 'int64-late' ? 4 : 0))
      throw new Error(`Raw-footer dictionary null length must fail at its group: ${result.name}`)
  }
  for (const kind of ['fixed-missing', 'fixed-crosspage']) {
    const result = results.find(
      (value) => value.name === `decimal-dictionary-${kind}-${precision}`,
    )!
    if (
      result.error ||
      result.rows.length !== 4 ||
      result.rows[3]!.ingestBufferHex !== null ||
      result.rows[0]!.ingestBufferHex !== 'b0'.repeat(9)
    )
      throw new Error(`Dictionary undefined values must compact across pages: ${result.name}`)
  }
  const mixed = results.find(
    (value) => value.name === `decimal-dictionary-fixed-mixed-${precision}`,
  )!
  if (
    mixed.error ||
    mixed.rows[2]!.ingestBufferHex !== '77'.repeat(9) ||
    mixed.rows[3]!.ingestBufferHex !== '88'.repeat(9)
  )
    throw new Error('Mixed dictionary/plain values must retain their Buffer bytes')
}
for (const kind of ['header', 'version']) {
  const result = results.find((value) => value.name === `invalid-${kind}`)!
  if (!result.error || result.rows.length !== 0)
    throw new Error(`Invalid ${kind} must fail before admission`)
}
await writeFile(resolve(dir, 'input.json'), JSON.stringify({ cases }))
await writeFile(resolve(dir, 'oracle.json'), JSON.stringify({ results }))
console.log(
  JSON.stringify({
    cases: cases.length,
    rows: results.reduce((n, result) => n + result.rows.length, 0),
  }),
)
