import { decodeEventLog, type Hex } from 'viem'
import { CTF_EVENTS, EXCHANGE_EVENTS } from './contracts.js'
import type { RpcLog } from './types.js'

const EVENTS = [...Object.values(EXCHANGE_EVENTS), ...Object.values(CTF_EVENTS)]

export type DecodedChainEvent = {
  eventName: string
  args: Record<string, unknown>
  blockNumber: bigint
  transactionHash: Hex
  transactionIndex: number
  logIndex: number
  contract: Hex
}

export function decodeKnownEvent(log: RpcLog): DecodedChainEvent | null {
  for (const event of EVENTS) {
    try {
      if (log.topics.length === 0) return null
      const decoded = decodeEventLog({
        abi: [event],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      })
      return {
        eventName: decoded.eventName,
        args: decoded.args as Record<string, unknown>,
        blockNumber: BigInt(log.blockNumber),
        transactionHash: log.transactionHash,
        transactionIndex: Number(BigInt(log.transactionIndex)),
        logIndex: Number(BigInt(log.logIndex)),
        contract: log.address,
      }
    } catch {
      // Try the next ABI. A topic pre-index makes this loop tiny in practice.
    }
  }
  return null
}
