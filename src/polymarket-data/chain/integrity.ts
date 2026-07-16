import { createHash } from 'node:crypto'
import type { RpcLog } from './types.js'

/** Provider-independent, order-sensitive identity of one canonical EVM log. */
export function canonicalLogLine(log: RpcLog): string {
  return [
    log.blockNumber,
    log.blockHash,
    log.transactionIndex,
    log.transactionHash,
    log.logIndex,
    log.address,
    log.topics.join(','),
    log.data,
    String(log.removed),
  ]
    .join('|')
    .toLowerCase()
}

export function logSequenceDigest(logs: RpcLog[]): string {
  const hash = createHash('sha256')
  for (const log of logs) hash.update(canonicalLogLine(log)).update('\n')
  return hash.digest('hex')
}

export function assertIdenticalLogSequences(
  primary: RpcLog[],
  secondary: RpcLog[],
  label: string,
): string {
  if (primary.length !== secondary.length) {
    throw new Error(
      `${label}: RPC providers disagree on log count (${primary.length} != ${secondary.length})`,
    )
  }
  for (let i = 0; i < primary.length; i++) {
    const a = canonicalLogLine(primary[i]!)
    const b = canonicalLogLine(secondary[i]!)
    if (a !== b) throw new Error(`${label}: RPC providers disagree at ordered log ${i}`)
    if (primary[i]!.removed || secondary[i]!.removed) {
      throw new Error(`${label}: provider returned a removed log at ordered log ${i}`)
    }
  }
  return logSequenceDigest(primary)
}
