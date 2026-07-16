import { encodeEventTopics, type Hex } from 'viem'
import { EXCHANGE_EVENTS, POLYMARKET_CONTRACTS } from './contracts.js'
import { decodeKnownEvent } from './decode.js'
import { assertIdenticalLogSequences } from './integrity.js'
import type { ChainRpcClient } from './rpc.js'
import type { RpcLog, RpcMetrics } from './types.js'

export type TokenMarket = {
  marketId: number
  conditionId: Hex
  tokenId: string
  outcomeIndex: number
}

export type MatchedTransaction = TokenMarket & {
  transactionHash: Hex
  blockNumber: bigint
  blockHash: Hex
  transactionIndex: number
  ordersMatchedLogIndex: number
}

export type DiscoveryChunk = {
  fromBlock: bigint
  toBlock: bigint
  allLogs: number
  targetLogs: number
  digest: string
  transactions: MatchedTransaction[]
}

export type DiscoveryProgress = {
  completedBlocks: bigint
  totalBlocks: bigint
  chunks: number
  allLogs: number
  targetTransactions: number
  primary: RpcMetrics
  secondary: RpcMetrics
}

type DiscoverOptions = {
  fromBlock: bigint
  toBlock: bigint
  tokens: readonly TokenMarket[]
  primaryStep?: bigint
  secondaryStep?: bigint
  verificationChunk?: bigint
  concurrency?: number
  onChunk?: (chunk: DiscoveryChunk, progress: DiscoveryProgress) => Promise<void> | void
}

const EXCHANGE_ADDRESSES = POLYMARKET_CONTRACTS.filter((contract) =>
  contract.name.includes('exchange'),
).map((contract) => contract.address.toLowerCase() as Hex)

const ORDERS_MATCHED_TOPIC = encodeEventTopics({
  abi: [EXCHANGE_EVENTS.ordersMatched],
  eventName: 'OrdersMatched',
})[0]!

function ranges(fromBlock: bigint, toBlock: bigint, step: bigint): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = []
  for (let from = fromBlock; from <= toBlock; from += step) {
    out.push([from, from + step - 1n > toBlock ? toBlock : from + step - 1n])
  }
  return out
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      output[index] = await fn(values[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return output
}

async function fetchRange(
  rpc: ChainRpcClient,
  fromBlock: bigint,
  toBlock: bigint,
  step: bigint,
  concurrency: number,
): Promise<RpcLog[]> {
  const parts = await mapLimit(ranges(fromBlock, toBlock, step), concurrency, ([from, to]) =>
    rpc.logs({
      fromBlock: from,
      toBlock: to,
      addresses: EXCHANGE_ADDRESSES,
      topic0: [ORDERS_MATCHED_TOPIC],
    }),
  )
  return parts.flat()
}

function targetTransactions(
  logs: RpcLog[],
  tokenIndex: ReadonlyMap<string, TokenMarket>,
): MatchedTransaction[] {
  const out: MatchedTransaction[] = []
  const identities = new Set<string>()
  for (const log of logs) {
    const decoded = decodeKnownEvent(log)
    if (!decoded || decoded.eventName !== 'OrdersMatched') {
      throw new Error(`OrdersMatched topic decoded as ${decoded?.eventName ?? 'unknown'}`)
    }
    const tokenId = String(decoded.args.tokenId)
    const market = tokenIndex.get(tokenId)
    if (!market) continue
    const identity = `${log.transactionHash.toLowerCase()}:${log.logIndex.toLowerCase()}`
    if (identities.has(identity)) throw new Error(`duplicate OrdersMatched log ${identity}`)
    identities.add(identity)
    out.push({
      ...market,
      transactionHash: log.transactionHash.toLowerCase() as Hex,
      blockNumber: BigInt(log.blockNumber),
      blockHash: log.blockHash.toLowerCase() as Hex,
      transactionIndex: Number(BigInt(log.transactionIndex)),
      ordersMatchedLogIndex: Number(BigInt(log.logIndex)),
    })
  }
  return out
}

export async function discoverMatchedTransactions(
  primary: ChainRpcClient,
  secondary: ChainRpcClient,
  options: DiscoverOptions,
): Promise<DiscoveryChunk[]> {
  if (options.toBlock < options.fromBlock) throw new Error('toBlock must be >= fromBlock')
  const primaryStep = options.primaryStep ?? 10n
  const secondaryStep = options.secondaryStep ?? 100n
  const verificationChunk = options.verificationChunk ?? 1_000n
  const concurrency = options.concurrency ?? 4
  if (primaryStep < 1n || secondaryStep < 1n || verificationChunk < 1n) {
    throw new Error('RPC block steps must be positive')
  }
  const tokenIndex = new Map(options.tokens.map((token) => [token.tokenId, token]))
  if (tokenIndex.size !== options.tokens.length)
    throw new Error('duplicate token ID in market scope')

  const chunks: DiscoveryChunk[] = []
  let allLogs = 0
  let targetCount = 0
  const totalBlocks = options.toBlock - options.fromBlock + 1n
  for (const [fromBlock, toBlock] of ranges(
    options.fromBlock,
    options.toBlock,
    verificationChunk,
  )) {
    const [a, b] = await Promise.all([
      fetchRange(primary, fromBlock, toBlock, primaryStep, concurrency),
      fetchRange(secondary, fromBlock, toBlock, secondaryStep, concurrency),
    ])
    const label = `blocks ${fromBlock}-${toBlock}`
    const digest = assertIdenticalLogSequences(a, b, label)
    const transactions = targetTransactions(a, tokenIndex)
    const chunk = {
      fromBlock,
      toBlock,
      allLogs: a.length,
      targetLogs: transactions.length,
      digest,
      transactions,
    }
    chunks.push(chunk)
    allLogs += a.length
    targetCount += transactions.length
    await options.onChunk?.(chunk, {
      completedBlocks: toBlock - options.fromBlock + 1n,
      totalBlocks,
      chunks: chunks.length,
      allLogs,
      targetTransactions: targetCount,
      primary: primary.metrics,
      secondary: secondary.metrics,
    })
  }
  return chunks
}
