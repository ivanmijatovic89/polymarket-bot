#!/usr/bin/env tsx
import '../../config/env.js'
import { ChainRpcClient } from './rpc.js'
import { scanVerifiedExchangeRange } from './scanner.js'

function bigintArg(name: string): bigint | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : BigInt(process.argv[i + 1] ?? '')
}

async function main(): Promise<void> {
  const fromBlock = bigintArg('--from-block')
  const toBlock = bigintArg('--to-block')
  if (fromBlock === undefined || toBlock === undefined) {
    throw new Error('usage: chain scan probe --from-block N --to-block N')
  }
  const url = process.env.POLYGON_RPC_URL
  if (!url) throw new Error('POLYGON_RPC_URL is required')
  const rpc = new ChainRpcClient({ url, timeoutMs: 120_000 })
  const result = await scanVerifiedExchangeRange(rpc, fromBlock, toBlock)
  console.log(
    JSON.stringify(
      {
        fromBlock: result.fromBlock.toString(),
        toBlock: result.toBlock.toString(),
        blocks: result.headers.length,
        candidateBlocks: result.candidateBlocks,
        verifiedReceiptBlocks: result.verifiedReceiptBlocks,
        exchangeLogs: result.logs.length,
        rpc: rpc.metrics,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(`[polymarket-data:chain:scan-probe] ${(error as Error).message}`)
  process.exit(1)
})
