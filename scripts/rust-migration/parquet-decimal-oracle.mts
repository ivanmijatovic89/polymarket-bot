// Independent installed-codec oracle; no saved strategy bundle execution.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Fixture = {
  name: string
  dictionary?: boolean
  schema_undefined?: boolean
  physical: string
  precision: number
  scale: number
  length: number
  bytes: string
  count: number
  offset: number
  size: number | null
}
type Cursor = { buffer: Buffer; offset: number; size?: number }
type ColumnOptions = {
  originalType: string
  precision: number
  scale: number
  typeLength: number | null
}
type Options = ColumnOptions | { column: ColumnOptions }
type Codec = {
  decodeValues: (type: string, cursor: Cursor, count: number, opts: Options) => unknown[]
}
if (!process.version.startsWith('v20.')) throw new Error('Pinned decoder oracle requires Node20')
const codecPath = fileURLToPath(
  new URL('../../node_modules/@dsnp/parquetjs/dist/lib/codec/plain.js', import.meta.url),
)
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(codecPath)).digest('hex')
const before = hash()
if (before !== 'cdcedb1b1e641a2041161fac300129c1c8fcf399449d749735ad7e7b810f22cd') {
  throw new Error('Installed reference PLAIN codec differs from reviewed @dsnp/parquetjs 1.8.7')
}
const codec = (await import(pathToFileURL(codecPath).href)) as Codec
const typesPath = fileURLToPath(
  new URL('../../node_modules/@dsnp/parquetjs/dist/lib/types.js', import.meta.url),
)
const types = (await import(pathToFileURL(typesPath).href)) as {
  getParquetTypeDataObject: (
    type: string,
    options: { precision: number; typeLength?: number | null },
  ) => { primitiveType: string; originalType: string; typeLength?: number | null }
}
const cases = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as Fixture[]
function encode(value: unknown) {
  if (Buffer.isBuffer(value)) return { kind: 'Buffer', hex: value.toString('hex') }
  if (typeof value !== 'number') throw new Error('Unexpected DECIMAL result type')
  const bits = Buffer.alloc(8)
  bits.writeDoubleBE(value)
  return { kind: 'Number', bits: bits.toString('hex') }
}
const output = cases.map((fixture) => {
  const cursor: Cursor = {
    buffer: Buffer.from(fixture.bytes, 'hex'),
    offset: fixture.offset,
    ...(fixture.size === null ? {} : { size: fixture.size }),
  }
  // The reference INT64 function writes a diagnostic before rethrowing. Preserve
  // the error and cursor without mixing that diagnostic into fixture JSON.
  const originalLog = console.log
  console.log = () => {}
  try {
    // Actual decodeSchema always includes typeLength; generated Thrift uses null
    // for a missing field. Only explicitly labelled manual-schema cases omit it.
    const rawLength = fixture.length > 0 ? fixture.length : null
    const inferred = types.getParquetTypeDataObject('DECIMAL', {
      precision: fixture.precision,
      ...(fixture.schema_undefined ? {} : { typeLength: rawLength }),
    })
    const options = {
      originalType: 'DECIMAL',
      precision: fixture.precision,
      scale: fixture.scale,
      typeLength: rawLength,
    }
    const reconstructed = fixture.dictionary || fixture.schema_undefined
    const values = codec.decodeValues(
      reconstructed ? inferred.primitiveType : fixture.physical,
      cursor,
      fixture.count,
      reconstructed ? { column: options } : options,
    )
    return { name: fixture.name, offset: cursor.offset, values: values.map(encode) }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { name: fixture.name, offset: cursor.offset, error: error.name }
  } finally {
    console.log = originalLog
  }
})
if (hash() !== before) throw new Error('Installed decoder source drift')
console.log(JSON.stringify(output))
