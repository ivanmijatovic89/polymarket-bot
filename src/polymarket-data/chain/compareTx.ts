#!/usr/bin/env tsx
import '../../config/env.js'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import type { Hex } from 'viem'
import { POLYMARKET_DATA_STORAGE_DIR } from '../../config/polymarketData.js'
import { decodeKnownEvent } from './decode.js'
import { apiComparableKey, chainComparableKey, normalizeTransaction } from './normalize.js'
import { ChainRpcClient } from './rpc.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function countMultiset(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function multisetDiff(left: Map<string, number>, right: Map<string, number>): string[] {
  const out: string[] = []
  for (const [key, count] of left) {
    const missing = count - (right.get(key) ?? 0)
    for (let i = 0; i < missing; i++) out.push(key)
  }
  return out
}

async function apiRows(txHash: Hex): Promise<Array<Record<string, unknown>>> {
  const glob = path.join(
    POLYMARKET_DATA_STORAGE_DIR,
    'staging/trades/symbol=*/timeframe=*/month=*/*.parquet',
  )
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const result = await connection.runAndReadAll(
      `SELECT lower(wallet) wallet, side, asset,
              size::VARCHAR size, price::VARCHAR price, usdc_size::VARCHAR usdc_size,
              is_taker, ts_ms, market_id
       FROM read_parquet(${sqlString(glob)}, union_by_name=true, hive_partitioning=true)
       WHERE lower(tx_hash) = ${sqlString(txHash.toLowerCase())}
       ORDER BY market_id, wallet, side, asset, size, price`,
    )
    return result.getRowObjectsJS()
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

async function main(): Promise<void> {
  const txHash = arg('--tx') as Hex | undefined
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('usage: polymarket-data:chain:compare-tx -- --tx <transaction-hash>')
  }
  const url = process.env.POLYGON_RPC_URL
  if (!url) throw new Error('POLYGON_RPC_URL is required')
  const rpc = new ChainRpcClient({ url, timeoutMs: 120_000 })
  const receipt = await rpc.receipt(txHash)
  const events = receipt.logs.map(decodeKnownEvent).filter((event) => event !== null)
  const chainRows = normalizeTransaction(events)
  const storedRows = await apiRows(txHash)
  const chainKeys = countMultiset(chainRows.map(chainComparableKey))
  const apiKeys = countMultiset(
    storedRows.map((row) =>
      apiComparableKey({
        wallet: String(row.wallet),
        side: String(row.side),
        asset: String(row.asset),
        size: String(row.size),
        price: String(row.price),
        usdcSize: String(row.usdc_size),
        isTaker: Boolean(row.is_taker),
      }),
    ),
  )
  const missingFromApi = multisetDiff(chainKeys, apiKeys)
  const missingFromChain = multisetDiff(apiKeys, chainKeys)
  const report = {
    transactionHash: txHash,
    chainRows: chainRows.length,
    apiRows: storedRows.length,
    exactRows: chainRows.length - missingFromApi.length,
    missingFromApi: missingFromApi.length,
    missingFromChain: missingFromChain.length,
    chainSamplesMissingFromApi: missingFromApi.slice(0, 3),
    apiSamplesMissingFromChain: missingFromChain.slice(0, 3),
    rpc: rpc.metrics,
  }
  console.log(JSON.stringify(report, null, 2))
  if (missingFromApi.length > 0 || missingFromChain.length > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(`[polymarket-data:chain:compare-tx] ${(error as Error).message}`)
  process.exit(1)
})
