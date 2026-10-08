import fs from 'node:fs'
import { round2, round8 } from '../../src/trading/utils/rounding.js'
import { computePolymarketTakerFee } from '../../src/trading/fees.js'
import { buyCommitment, fillCashDelta, validateStartingCapital } from '../../src/trading/capital.js'

type Row = {
  value: string
  price: string
  size: string
  rate?: string | null
  postOnly?: boolean | null
  buy: boolean
  taker: boolean
}
function num(bits: string): number {
  return Buffer.from(bits, 'hex').readDoubleBE()
}
function encoded(value: number) {
  if (Number.isNaN(value)) return { kind: 'nan' }
  const buffer = Buffer.alloc(8)
  buffer.writeDoubleBE(value)
  return { kind: 'number', bits: buffer.toString('hex') }
}
const rows = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as Row[]
const results = rows.map((row) => {
  const value = num(row.value),
    price = num(row.price),
    size = num(row.size),
    rate = row.rate === undefined ? undefined : row.rate === null ? null : num(row.rate)
  let capital: unknown
  try {
    capital = { valid: true, value: encoded(validateStartingCapital(value)) }
  } catch (error) {
    capital = { valid: false, error: (error as Error).message }
  }
  return {
    round: encoded(Math.round(value)),
    round8: encoded(round8(value)),
    round2: encoded(round2(value)),
    fee: encoded(computePolymarketTakerFee({ feeRateBps: rate as number, price, size })),
    commitment: encoded(buyCommitment(price, size, row.postOnly as boolean | undefined)),
    cashDelta: encoded(
      fillCashDelta({
        id: 'fixture',
        tsMs: 0,
        assetId: 'asset',
        side: row.buy ? 'BUY' : 'SELL',
        price,
        size,
        liquidity: row.taker ? 'TAKER' : 'MAKER',
        feeRateBps: rate as number | undefined,
      }),
    ),
    numberString: String(value),
    capital,
  }
})
process.stdout.write(JSON.stringify(results))
