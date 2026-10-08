import fs from 'node:fs'
import { computePositionMetrics } from '../../src/trading/positionMetrics.js'
import { computeOrderbookMetrics } from '../../src/trading/orderbookMetrics.js'

type Book = { depth: string; bids: string[]; asks: string[] }
type Row = {
  upId?: string | null
  downId?: string | null
  positions: Record<string, { qty: string; costBasis: string }>
  upBook: Book
  downBook: Book
}
function number(bits: string): number {
  return Buffer.from(bits, 'hex').readDoubleBE()
}
function encode(value: unknown): unknown {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { kind: 'nan' }
    const buffer = Buffer.alloc(8)
    buffer.writeDoubleBE(value)
    return { kind: 'number', bits: buffer.toString('hex') }
  }
  if (Array.isArray(value)) return value.map(encode)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
  return value
}
function book(row: Book) {
  return {
    depthLevels: number(row.depth),
    bidsDepthByLevel: row.bids.map(number),
    asksDepthByLevel: row.asks.map(number),
  } as Parameters<typeof computeOrderbookMetrics>[0]['upBook']
}
const rows = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as Row[]
const result = rows.map((row) => {
  const positionsByAssetId = Object.fromEntries(
    Object.entries(row.positions).map(([key, position]) => [
      key,
      { qty: number(position.qty), costBasis: number(position.costBasis) },
    ]),
  )
  const position = computePositionMetrics({
    portfolio: { positionsByAssetId } as Parameters<typeof computePositionMetrics>[0]['portfolio'],
    upAssetId: row.upId as string | undefined,
    downAssetId: row.downId as string | undefined,
  })
  const metrics = computeOrderbookMetrics({
    upBook: book(row.upBook),
    downBook: book(row.downBook),
  })
  return {
    position: encode(position ?? null),
    book: { ...(encode(metrics) as object), depthLevels: metrics.depthLevels },
  }
})
process.stdout.write(JSON.stringify(result))
