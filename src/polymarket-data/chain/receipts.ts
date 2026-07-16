import type { Hex } from 'viem'
import { decodeKnownEvent, type DecodedChainEvent } from './decode.js'
import type { MatchedTransaction, TokenMarket } from './discovery.js'
import { assertIdenticalLogSequences } from './integrity.js'
import { normalizeTransaction, type ExactChainTrade } from './normalize.js'
import type { ChainRpcClient } from './rpc.js'
import type { RpcMetrics, RpcReceipt } from './types.js'

export type MarketChainTrade = ExactChainTrade & {
  marketId: number
  conditionId: Hex
  outcomeIndex: number
}

export type VerifiedReceipt = {
  transactionHash: Hex
  blockNumber: bigint
  blockHash: Hex
  blockTimestampSec: bigint
  receiptLogDigest: string
  knownEvents: DecodedChainEvent[]
  trades: MarketChainTrade[]
}

export type ReceiptProgress = {
  completed: number
  total: number
  trades: number
  primary: RpcMetrics
  secondary: RpcMetrics
}

type VerifyOptions = {
  tokens: readonly TokenMarket[]
  batchSize?: number
  concurrency?: number
  delayBetweenBatchesMs?: number
  retainResults?: boolean
  onBatch?: (receipts: VerifiedReceipt[], progress: ReceiptProgress) => Promise<void> | void
}

function txIdentity(receipt: RpcReceipt): string {
  return [
    receipt.transactionHash,
    receipt.blockNumber,
    receipt.blockHash,
    receipt.transactionIndex,
    receipt.status ?? receipt.root ?? '',
  ]
    .join('|')
    .toLowerCase()
}

export function verifyReceiptPair(
  primary: RpcReceipt,
  secondary: RpcReceipt,
  expected: readonly MatchedTransaction[],
  tokenIndex: ReadonlyMap<string, TokenMarket>,
): VerifiedReceipt {
  const txHash = expected[0]?.transactionHash
  if (!txHash) throw new Error('receipt has no discovery reference')
  if (txIdentity(primary) !== txIdentity(secondary)) {
    throw new Error(`${txHash}: RPC providers disagree on receipt identity`)
  }
  if (primary.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new Error(`${txHash}: provider returned a different receipt`)
  }
  if (primary.status !== undefined && BigInt(primary.status) !== 1n) {
    throw new Error(`${txHash}: selected transaction did not succeed`)
  }
  const expectedBlock = expected[0]!.blockNumber
  const expectedHash = expected[0]!.blockHash.toLowerCase()
  if (
    BigInt(primary.blockNumber) !== expectedBlock ||
    primary.blockHash.toLowerCase() !== expectedHash
  ) {
    throw new Error(`${txHash}: receipt moved from its discovered canonical block`)
  }
  if (
    expected.some(
      (ref) => ref.blockNumber !== expectedBlock || ref.blockHash.toLowerCase() !== expectedHash,
    )
  ) {
    throw new Error(`${txHash}: discovery references disagree on canonical block`)
  }

  const receiptLogDigest = assertIdenticalLogSequences(
    primary.logs,
    secondary.logs,
    `transaction ${txHash}`,
  )
  const knownEvents = primary.logs.map(decodeKnownEvent).filter((event) => event !== null)
  const matchedLogIndexes = new Set(
    knownEvents
      .filter(
        (event) =>
          event.eventName === 'OrdersMatched' && tokenIndex.has(String(event.args.tokenId)),
      )
      .map((event) => event.logIndex),
  )
  const expectedLogIndexes = new Set(expected.map((ref) => ref.ordersMatchedLogIndex))
  if (
    matchedLogIndexes.size !== expectedLogIndexes.size ||
    [...matchedLogIndexes].some((index) => !expectedLogIndexes.has(index))
  ) {
    throw new Error(`${txHash}: receipt OrdersMatched events do not match discovery`)
  }

  const trades: MarketChainTrade[] = []
  for (const trade of normalizeTransaction(knownEvents)) {
    const market = tokenIndex.get(trade.asset)
    if (!market) continue
    trades.push({ ...trade, ...market })
  }
  if (trades.length === 0) throw new Error(`${txHash}: matching receipt contains no target fills`)
  return {
    transactionHash: txHash,
    blockNumber: expectedBlock,
    blockHash: expected[0]!.blockHash,
    blockTimestampSec: 0n,
    receiptLogDigest,
    knownEvents,
    trades,
  }
}

async function runLimited<T>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      await fn(values[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
}

export async function verifyDiscoveredReceipts(
  primary: ChainRpcClient,
  secondary: ChainRpcClient,
  discovery: readonly MatchedTransaction[],
  options: VerifyOptions,
): Promise<VerifiedReceipt[]> {
  const byTx = new Map<string, MatchedTransaction[]>()
  for (const ref of discovery) {
    const key = ref.transactionHash.toLowerCase()
    const values = byTx.get(key) ?? []
    values.push(ref)
    byTx.set(key, values)
  }
  // Map insertion order is canonical discovery order (block/transaction/log).
  // Keeping it groups nearby receipts and minimizes independent archive/header reads.
  const txHashes = [...byTx.keys()] as Hex[]
  const tokenIndex = new Map(options.tokens.map((token) => [token.tokenId, token]))
  if (tokenIndex.size !== options.tokens.length)
    throw new Error('duplicate token ID in market scope')
  const batchSize = options.batchSize ?? 10
  const concurrency = options.concurrency ?? 2
  const batches: Hex[][] = []
  for (let i = 0; i < txHashes.length; i += batchSize) {
    batches.push(txHashes.slice(i, i + batchSize))
  }

  const output: VerifiedReceipt[][] =
    options.retainResults === false ? [] : new Array(batches.length)
  let completed = 0
  let trades = 0
  await runLimited(batches, concurrency, async (hashes) => {
    const batchIndex = options.retainResults === false ? -1 : batches.indexOf(hashes)
    const [a, b] = await Promise.all([primary.receipts(hashes), secondary.receipts(hashes)])
    if (a.length !== hashes.length || b.length !== hashes.length) {
      throw new Error(`receipt batch returned ${a.length}/${b.length}, expected ${hashes.length}`)
    }
    const verified = hashes.map((hash, index) => {
      const primaryReceipt = a[index]
      const secondaryReceipt = b[index]
      if (!primaryReceipt || !secondaryReceipt)
        throw new Error(`${hash}: missing transaction receipt`)
      return verifyReceiptPair(primaryReceipt, secondaryReceipt, byTx.get(hash) ?? [], tokenIndex)
    })
    const blockNumbers = [...new Set(verified.map((receipt) => receipt.blockNumber))]
    const [primaryBlocks, secondaryBlocks] = await Promise.all([
      primary.blocks(blockNumbers),
      secondary.blocks(blockNumbers),
    ])
    const timestamps = new Map<bigint, bigint>()
    for (let i = 0; i < blockNumbers.length; i++) {
      const number = blockNumbers[i]!
      const aBlock = primaryBlocks[i]
      const bBlock = secondaryBlocks[i]
      if (!aBlock || !bBlock) throw new Error(`block ${number}: missing block header`)
      if (
        aBlock.number.toLowerCase() !== bBlock.number.toLowerCase() ||
        aBlock.hash.toLowerCase() !== bBlock.hash.toLowerCase() ||
        aBlock.timestamp.toLowerCase() !== bBlock.timestamp.toLowerCase()
      ) {
        throw new Error(`block ${number}: RPC providers disagree on canonical header`)
      }
      timestamps.set(number, BigInt(aBlock.timestamp))
    }
    for (const receipt of verified) {
      const timestamp = timestamps.get(receipt.blockNumber)
      if (timestamp === undefined) throw new Error(`block ${receipt.blockNumber}: no timestamp`)
      receipt.blockTimestampSec = timestamp
    }
    if (batchIndex >= 0) output[batchIndex] = verified
    completed += hashes.length
    trades += verified.reduce((sum, receipt) => sum + receipt.trades.length, 0)
    await options.onBatch?.(verified, {
      completed,
      total: txHashes.length,
      trades,
      primary: primary.metrics,
      secondary: secondary.metrics,
    })
    if (options.delayBetweenBatchesMs && options.delayBetweenBatchesMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayBetweenBatchesMs))
    }
  })
  return output.flat()
}
