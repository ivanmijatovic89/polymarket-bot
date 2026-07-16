#!/usr/bin/env tsx
import '../../config/env.js'
import { decodeKnownEvent } from './decode.js'
import { calculateReceiptsRoot } from './receiptProof.js'
import { ChainRpcClient } from './rpc.js'
import type { Hex } from 'viem'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const txHash = arg('--tx') as Hex | undefined
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('usage: polymarket-data:chain:probe -- --tx <transaction-hash>')
  }
  const url = process.env.POLYGON_RPC_URL
  if (!url) throw new Error('POLYGON_RPC_URL is required')
  const rpc = new ChainRpcClient({ url, timeoutMs: 120_000 })
  const receipt = await rpc.receipt(txHash)
  const blockNumber = BigInt(receipt.blockNumber)
  const [block, receipts] = await Promise.all([
    rpc.block(blockNumber),
    rpc.blockReceipts(blockNumber),
  ])
  const calculatedRoot = await calculateReceiptsRoot(receipts)
  const events = receipt.logs.map(decodeKnownEvent).filter((event) => event !== null)
  const report = {
    chainId: 137,
    blockNumber: blockNumber.toString(),
    blockHash: block.hash,
    expectedReceiptsRoot: block.receiptsRoot,
    calculatedReceiptsRoot: calculatedRoot,
    receiptsRootMatches: calculatedRoot.toLowerCase() === block.receiptsRoot.toLowerCase(),
    blockReceipts: receipts.length,
    transactionLogs: receipt.logs.length,
    decodedKnownEvents: events.length,
    eventCounts: Object.fromEntries(
      [...new Set(events.map((event) => event.eventName))]
        .sort()
        .map((name) => [name, events.filter((event) => event.eventName === name).length]),
    ),
    rpc: rpc.metrics,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.receiptsRootMatches) process.exitCode = 2
}

main().catch((error) => {
  console.error(`[polymarket-data:chain:probe] ${(error as Error).message}`)
  process.exit(1)
})
