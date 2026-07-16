import { encodeEventTopics, type Hex } from 'viem'
import { bloomMayContainEvent } from './bloom.js'
import { EXCHANGE_EVENTS, POLYMARKET_CONTRACTS } from './contracts.js'
import { calculateReceiptsRoot } from './receiptProof.js'
import type { ChainRpcClient } from './rpc.js'
import type { RpcBlock, RpcLog } from './types.js'

export type VerifiedBlockRange = {
  fromBlock: bigint
  toBlock: bigint
  headers: RpcBlock[]
  candidateBlocks: number
  verifiedReceiptBlocks: number
  logs: RpcLog[]
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

export async function scanVerifiedExchangeRange(
  rpc: ChainRpcClient,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<VerifiedBlockRange> {
  if (toBlock < fromBlock) throw new Error('toBlock must be >= fromBlock')
  const length = toBlock - fromBlock + 1n
  if (length > 100_000n) throw new Error('one scanner chunk cannot exceed 100,000 blocks')
  const blockNumbers = Array.from({ length: Number(length) }, (_, i) => fromBlock + BigInt(i))
  const headers: RpcBlock[] = []
  for (const batch of chunks(blockNumbers, 100)) headers.push(...(await rpc.blocks(batch)))
  headers.sort((a, b) => Number(BigInt(a.number) - BigInt(b.number)))
  for (let i = 0; i < headers.length; i++) {
    const block = headers[i]!
    if (BigInt(block.number) !== fromBlock + BigInt(i))
      throw new Error(`missing block at offset ${i}`)
    if (i > 0 && block.parentHash.toLowerCase() !== headers[i - 1]!.hash.toLowerCase()) {
      throw new Error(`broken parent hash at block ${BigInt(block.number)}`)
    }
  }

  const addresses = POLYMARKET_CONTRACTS.filter((contract) =>
    contract.name.includes('exchange'),
  ).map((contract) => contract.address.toLowerCase() as Hex)
  const topic0s = Object.values(EXCHANGE_EVENTS).map(
    (event) => encodeEventTopics({ abi: [event], eventName: event.name })[0]!,
  )
  const candidates = headers.filter((block) =>
    bloomMayContainEvent(block.logsBloom, addresses, topic0s),
  )
  const logs: RpcLog[] = []
  for (const block of candidates) {
    const receipts = await rpc.blockReceipts(BigInt(block.number))
    const root = await calculateReceiptsRoot(receipts)
    if (root.toLowerCase() !== block.receiptsRoot.toLowerCase()) {
      throw new Error(`receipt-root mismatch at block ${BigInt(block.number)}`)
    }
    for (const receipt of receipts) {
      for (const log of receipt.logs) {
        if (
          addresses.includes(log.address.toLowerCase() as Hex) &&
          log.topics[0] &&
          topic0s.includes(log.topics[0].toLowerCase() as Hex)
        ) {
          logs.push(log)
        }
      }
    }
  }
  logs.sort((a, b) => {
    const block = BigInt(a.blockNumber) - BigInt(b.blockNumber)
    if (block !== 0n) return block < 0n ? -1 : 1
    const tx = BigInt(a.transactionIndex) - BigInt(b.transactionIndex)
    if (tx !== 0n) return tx < 0n ? -1 : 1
    return Number(BigInt(a.logIndex) - BigInt(b.logIndex))
  })
  return {
    fromBlock,
    toBlock,
    headers,
    candidateBlocks: candidates.length,
    verifiedReceiptBlocks: candidates.length,
    logs,
  }
}
