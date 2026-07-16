import type { Address, Hex } from 'viem'
import type { DecodedChainEvent } from './decode.js'

const SCALE = 1_000_000n

export type ExactChainTrade = {
  orderHash: Hex
  wallet: Address
  taker: Address
  side: 'BUY' | 'SELL'
  asset: string
  sizeAtomic: bigint
  usdcAtomic: bigint
  feeAtomic: bigint
  priceMillionths: bigint
  isTaker: boolean
  blockNumber: bigint
  transactionHash: Hex
  transactionIndex: number
  logIndex: number
}

function requiredBigInt(args: Record<string, unknown>, key: string): bigint {
  const value = args[key]
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  throw new Error(`OrderFilled.${key} is not an exact integer`)
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`OrderFilled.${key} is not string`)
  return value
}

export function fixed6(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  return `${negative ? '-' : ''}${absolute / SCALE}.${(absolute % SCALE)
    .toString()
    .padStart(6, '0')}`
}

export function normalizeOrderFilled(
  event: DecodedChainEvent,
  takerOrderHashes: ReadonlySet<string>,
): ExactChainTrade {
  if (event.eventName !== 'OrderFilled')
    throw new Error(`expected OrderFilled, got ${event.eventName}`)
  const sideValue = requiredBigInt(event.args, 'side')
  if (sideValue !== 0n && sideValue !== 1n) throw new Error(`unknown OrderFilled side ${sideValue}`)
  const side = sideValue === 0n ? 'BUY' : 'SELL'
  const makerAmount = requiredBigInt(event.args, 'makerAmountFilled')
  const takerAmount = requiredBigInt(event.args, 'takerAmountFilled')
  const sizeAtomic = side === 'BUY' ? takerAmount : makerAmount
  const usdcAtomic = side === 'BUY' ? makerAmount : takerAmount
  if (sizeAtomic <= 0n || usdcAtomic < 0n) throw new Error('invalid non-positive fill amounts')
  const orderHash = requiredString(event.args, 'orderHash') as Hex
  return {
    orderHash,
    wallet: requiredString(event.args, 'maker').toLowerCase() as Address,
    taker: requiredString(event.args, 'taker').toLowerCase() as Address,
    side,
    asset: requiredBigInt(event.args, 'tokenId').toString(),
    sizeAtomic,
    usdcAtomic,
    feeAtomic: requiredBigInt(event.args, 'fee'),
    priceMillionths: (usdcAtomic * SCALE + sizeAtomic / 2n) / sizeAtomic,
    isTaker: takerOrderHashes.has(orderHash.toLowerCase()),
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
  }
}

export function normalizeTransaction(events: DecodedChainEvent[]): ExactChainTrade[] {
  const takerOrderHashes = new Set(
    events
      .filter((event) => event.eventName === 'OrdersMatched')
      .map((event) => requiredString(event.args, 'takerOrderHash').toLowerCase()),
  )
  return events
    .filter((event) => event.eventName === 'OrderFilled')
    .map((event) => normalizeOrderFilled(event, takerOrderHashes))
    .sort((a, b) => a.logIndex - b.logIndex)
}

export function apiComparableKey(row: {
  wallet: string
  side: string
  asset: string
  size: string
  price: string
  usdcSize: string
  isTaker: boolean
}): string {
  return [
    row.wallet.toLowerCase(),
    row.side,
    row.asset,
    row.size,
    row.price,
    row.usdcSize,
    row.isTaker ? '1' : '0',
  ].join('|')
}

export function chainComparableKey(row: ExactChainTrade): string {
  return apiComparableKey({
    wallet: row.wallet,
    side: row.side,
    asset: row.asset,
    size: fixed6(row.sizeAtomic),
    price: fixed6(row.priceMillionths),
    usdcSize: fixed6(row.usdcAtomic),
    isTaker: row.isTaker,
  })
}
