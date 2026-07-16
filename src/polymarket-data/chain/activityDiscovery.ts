import { encodeEventTopics, type Hex } from 'viem'
import { normalizeActivityEvent, type ActivityMarket, type ExactChainActivity } from './activity.js'
import { CTF_EVENTS, NEG_RISK_EVENTS, POLYMARKET_CONTRACTS } from './contracts.js'
import { decodeKnownEvent } from './decode.js'
import type { TokenMarket } from './discovery.js'
import { assertIdenticalLogSequences } from './integrity.js'
import type { ChainRpcClient } from './rpc.js'
import type { RpcLog, RpcMetrics } from './types.js'

export type ActivityLogQuery = {
  label: string
  addresses: Hex[]
  topics: Array<Hex | Hex[] | null>
}

export type TimedChainActivity = ExactChainActivity & { tsMs: bigint }

export type ActivityDiscoveryChunk = {
  fromBlock: bigint
  toBlock: bigint
  allLogs: number
  targetRows: number
  digest: string
  rows: TimedChainActivity[]
}

export type ActivityDiscoveryProgress = {
  completedBlocks: bigint
  totalBlocks: bigint
  chunks: number
  allLogs: number
  targetRows: number
  primary: RpcMetrics
  secondary: RpcMetrics
}

type Options = {
  fromBlock: bigint
  toBlock: bigint
  markets: readonly ActivityMarket[]
  tokens: readonly TokenMarket[]
  includeStandard: boolean
  includeNegativeRisk: boolean
  primaryStep?: bigint
  secondaryStep?: bigint
  verificationChunk?: bigint
  concurrency?: number
  retainResults?: boolean
  onChunk?: (
    chunk: ActivityDiscoveryChunk,
    progress: ActivityDiscoveryProgress,
  ) => Promise<void> | void
}

const CTF_SPLIT_TOPIC = encodeEventTopics({
  abi: [CTF_EVENTS.positionSplit],
  eventName: 'PositionSplit',
})[0]!
const CTF_MERGE_TOPIC = encodeEventTopics({
  abi: [CTF_EVENTS.positionsMerge],
  eventName: 'PositionsMerge',
})[0]!
const CTF_REDEEM_TOPIC = encodeEventTopics({
  abi: [CTF_EVENTS.payoutRedemption],
  eventName: 'PayoutRedemption',
})[0]!
const NEG_RISK_SPLIT_TOPIC = encodeEventTopics({
  abi: [NEG_RISK_EVENTS.positionSplit],
  eventName: 'PositionSplit',
})[0]!
const NEG_RISK_MERGE_TOPIC = encodeEventTopics({
  abi: [NEG_RISK_EVENTS.positionsMerge],
  eventName: 'PositionsMerge',
})[0]!
const NEG_RISK_REDEEM_TOPIC = encodeEventTopics({
  abi: [NEG_RISK_EVENTS.payoutRedemption],
  eventName: 'PayoutRedemption',
})[0]!

export function activityLogQueries(input: {
  conditionIds: readonly Hex[]
  includeStandard: boolean
  includeNegativeRisk: boolean
}): ActivityLogQuery[] {
  if (input.conditionIds.length === 0) throw new Error('activity scope has no condition IDs')
  const ctf = POLYMARKET_CONTRACTS.find((contract) => contract.name === 'ctf')!.address
  const adapter = POLYMARKET_CONTRACTS.find(
    (contract) => contract.name === 'neg_risk_adapter',
  )!.address
  const queries: ActivityLogQuery[] = []
  if (input.includeStandard) {
    queries.push({
      label: 'ctf-split-merge',
      addresses: [ctf],
      topics: [[CTF_SPLIT_TOPIC, CTF_MERGE_TOPIC], null, null, [...input.conditionIds]],
    })
    queries.push({
      label: 'ctf-redemption',
      addresses: [ctf],
      topics: [[CTF_REDEEM_TOPIC]],
    })
  }
  if (input.includeNegativeRisk) {
    queries.push({
      label: 'neg-risk-split-merge',
      addresses: [adapter],
      topics: [[NEG_RISK_SPLIT_TOPIC, NEG_RISK_MERGE_TOPIC], null, [...input.conditionIds]],
    })
    queries.push({
      label: 'neg-risk-redemption',
      addresses: [adapter],
      topics: [NEG_RISK_REDEEM_TOPIC, null, [...input.conditionIds]],
    })
  }
  return queries
}

function ranges(from: bigint, to: bigint, step: bigint): Array<[bigint, bigint]> {
  const output: Array<[bigint, bigint]> = []
  for (let cursor = from; cursor <= to; cursor += step) {
    output.push([cursor, cursor + step - 1n > to ? to : cursor + step - 1n])
  }
  return output
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

function compareLogs(a: RpcLog, b: RpcLog): number {
  const block = BigInt(a.blockNumber) - BigInt(b.blockNumber)
  if (block !== 0n) return block < 0n ? -1 : 1
  const transaction = BigInt(a.transactionIndex) - BigInt(b.transactionIndex)
  if (transaction !== 0n) return transaction < 0n ? -1 : 1
  return Number(BigInt(a.logIndex) - BigInt(b.logIndex))
}

async function fetchQueries(
  rpc: ChainRpcClient,
  queries: readonly ActivityLogQuery[],
  fromBlock: bigint,
  toBlock: bigint,
  step: bigint,
  concurrency: number,
): Promise<RpcLog[]> {
  const tasks = queries.flatMap((query) =>
    ranges(fromBlock, toBlock, step).map(([from, to]) => ({ query, from, to })),
  )
  const parts = await mapLimit(tasks, concurrency, ({ query, from, to }) =>
    rpc.logs({
      fromBlock: from,
      toBlock: to,
      addresses: query.addresses,
      topics: query.topics,
    }),
  )
  const logs = parts.flat().sort(compareLogs)
  for (let i = 1; i < logs.length; i++) {
    const previous = logs[i - 1]!
    const current = logs[i]!
    if (
      previous.transactionHash.toLowerCase() === current.transactionHash.toLowerCase() &&
      previous.logIndex.toLowerCase() === current.logIndex.toLowerCase()
    ) {
      throw new Error(`activity queries overlap at ${current.transactionHash}:${current.logIndex}`)
    }
  }
  return logs
}

async function timestamps(
  primary: ChainRpcClient,
  secondary: ChainRpcClient,
  blocks: readonly bigint[],
): Promise<Map<bigint, bigint>> {
  const output = new Map<bigint, bigint>()
  // dRPC accepts at most 10 JSON-RPC calls per batch. Earlier sparse chunks
  // stayed below that limit; dense market activity can span many blocks.
  for (const batch of ranges(0n, BigInt(blocks.length - 1), 10n)) {
    const numbers = blocks.slice(Number(batch[0]), Number(batch[1] + 1n))
    const [a, b] = await Promise.all([primary.blocks([...numbers]), secondary.blocks([...numbers])])
    for (let i = 0; i < numbers.length; i++) {
      const left = a[i]
      const right = b[i]
      const number = numbers[i]!
      if (
        !left ||
        !right ||
        left.hash.toLowerCase() !== right.hash.toLowerCase() ||
        left.timestamp.toLowerCase() !== right.timestamp.toLowerCase()
      ) {
        throw new Error(`activity block ${number}: providers disagree on header`)
      }
      output.set(number, BigInt(left.timestamp) * 1_000n)
    }
  }
  return output
}

export async function discoverActivity(
  primary: ChainRpcClient,
  secondary: ChainRpcClient,
  options: Options,
): Promise<ActivityDiscoveryChunk[]> {
  if (options.toBlock < options.fromBlock) throw new Error('toBlock must be >= fromBlock')
  const conditionIndex = new Map(options.markets.map((market) => [market.conditionId, market]))
  const tokenIndex = new Map(options.tokens.map((token) => [token.tokenId, token]))
  const queries = activityLogQueries({
    conditionIds: [...conditionIndex.keys()],
    includeStandard: options.includeStandard,
    includeNegativeRisk: options.includeNegativeRisk,
  })
  const primaryStep = options.primaryStep ?? 10n
  const secondaryStep = options.secondaryStep ?? 100n
  const verificationChunk = options.verificationChunk ?? 1_000n
  const concurrency = options.concurrency ?? 1
  const totalBlocks = options.toBlock - options.fromBlock + 1n
  const chunks: ActivityDiscoveryChunk[] = []
  let allLogs = 0
  let targetRows = 0
  for (const [fromBlock, toBlock] of ranges(
    options.fromBlock,
    options.toBlock,
    verificationChunk,
  )) {
    const [a, b] = await Promise.all([
      fetchQueries(primary, queries, fromBlock, toBlock, primaryStep, concurrency),
      fetchQueries(secondary, queries, fromBlock, toBlock, secondaryStep, concurrency),
    ])
    const digest = assertIdenticalLogSequences(a, b, `activity blocks ${fromBlock}-${toBlock}`)
    const normalized = a.flatMap((log) => {
      const event = decodeKnownEvent(log)
      if (!event) throw new Error(`unknown activity event ${log.transactionHash}:${log.logIndex}`)
      return normalizeActivityEvent(event, conditionIndex, tokenIndex)
    })
    const blockNumbers = [...new Set(normalized.map((row) => row.blockNumber))].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    )
    const blockTimestamps = await timestamps(primary, secondary, blockNumbers)
    const rows = normalized.map((row) => {
      const tsMs = blockTimestamps.get(row.blockNumber)
      if (tsMs === undefined)
        throw new Error(`activity block ${row.blockNumber}: timestamp missing`)
      return { ...row, tsMs }
    })
    const chunk = {
      fromBlock,
      toBlock,
      allLogs: a.length,
      targetRows: rows.length,
      digest,
      rows,
    }
    if (options.retainResults !== false) chunks.push(chunk)
    allLogs += a.length
    targetRows += rows.length
    await options.onChunk?.(chunk, {
      completedBlocks: toBlock - options.fromBlock + 1n,
      totalBlocks,
      chunks: Number((toBlock - options.fromBlock) / verificationChunk + 1n),
      allLogs,
      targetRows,
      primary: primary.metrics,
      secondary: secondary.metrics,
    })
  }
  return chunks
}
