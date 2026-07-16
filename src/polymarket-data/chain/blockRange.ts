import type { ChainRpcClient } from './rpc.js'

/** First canonical block whose timestamp is >= targetSec. */
export async function firstBlockAtOrAfter(
  rpc: ChainRpcClient,
  targetSec: bigint,
  highHint?: bigint,
): Promise<bigint> {
  let low = 0n
  let high = highHint ?? (await rpc.blockNumber())
  const highBlock = await rpc.block(high)
  if (BigInt(highBlock.timestamp) < targetSec)
    throw new Error('target timestamp is after high block')
  while (low < high) {
    const mid = (low + high) / 2n
    const block = await rpc.block(mid)
    if (BigInt(block.timestamp) < targetSec) low = mid + 1n
    else high = mid
  }
  return low
}
