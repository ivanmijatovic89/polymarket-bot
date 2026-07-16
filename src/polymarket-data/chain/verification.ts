import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import type { ScopeLocator } from './checkpoints.js'
import { chainScopeDir } from './checkpoints.js'
import { candidateMarketPath } from './parquet.js'
import type { ChainScopeMarket } from './scope.js'
import { marketFactPath } from '../storage/paths.js'
import { completenessToleranceShares } from '../tradeRows.js'

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

export type MarketChainVerification = {
  marketId: number
  slug: string
  chainRows: number
  apiRows: number | null
  missingFromApi: number | null
  missingFromChain: number | null
  chainWallets: number
  apiWallets: number | null
  chainSharesVolume: number
  gammaSharesVolume: number | null
  gammaDriftShares: number | null
  gammaToleranceShares: number
  duplicateLogIdentities: number
  exactApiMatch: boolean
  gammaMatch: boolean
  passed: boolean
}

export type ChainVerificationReport = {
  version: 1
  generatedAt: string
  markets: number
  passedMarkets: number
  failedMarkets: number
  passed: boolean
  results: MarketChainVerification[]
}

const COMPARABLE_CHAIN = `
  SELECT lower(wallet) wallet, side, outcome_index, asset,
         size::VARCHAR size, price::VARCHAR price, usdc_size::VARCHAR usdc_size,
         is_taker, lower(transaction_hash) tx_hash
  FROM read_parquet(CHAIN_FILE)
`

const COMPARABLE_API = `
  SELECT lower(wallet) wallet, side, outcome_index, asset,
         size::VARCHAR size, price::VARCHAR price, usdc_size::VARCHAR usdc_size,
         is_taker, lower(tx_hash) tx_hash
  FROM read_parquet(API_FILE)
`

export async function verifyChainCandidates(
  scope: ScopeLocator,
  markets: readonly ChainScopeMarket[],
): Promise<{ report: ChainVerificationReport; path: string }> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  const results: MarketChainVerification[] = []
  try {
    for (const market of markets) {
      const chainFile = candidateMarketPath(scope, market.slug)
      if (!(await exists(chainFile)))
        throw new Error(`${market.slug}: candidate Parquet is missing`)
      const apiFile = marketFactPath('trades', market)
      const hasApi = await exists(apiFile)
      const aggregates = await connection.runAndReadAll(
        `SELECT count(*)::INTEGER chain_rows,
                count(DISTINCT lower(wallet))::INTEGER chain_wallets,
                coalesce((sum(size) / 2)::DOUBLE, 0) chain_shares_volume,
                (count(*) - count(DISTINCT block_hash || ':' || transaction_hash || ':' || log_index))::INTEGER duplicates
         FROM read_parquet(${quote(chainFile)})`,
      )
      const aggregate = aggregates.getRowObjectsJS()[0]!
      let apiRows: number | null = null
      let apiWallets: number | null = null
      let missingFromApi: number | null = null
      let missingFromChain: number | null = null
      if (hasApi) {
        const chainComparable = COMPARABLE_CHAIN.replace('CHAIN_FILE', quote(chainFile))
        const apiComparable = COMPARABLE_API.replace('API_FILE', quote(apiFile))
        const comparison = await connection.runAndReadAll(
          `WITH chain AS (${chainComparable}), api AS (${apiComparable})
           SELECT
             (SELECT count(*)::INTEGER FROM api) api_rows,
             (SELECT count(DISTINCT wallet)::INTEGER FROM api) api_wallets,
             (SELECT count(*)::INTEGER FROM (SELECT * FROM chain EXCEPT ALL SELECT * FROM api)) missing_from_api,
             (SELECT count(*)::INTEGER FROM (SELECT * FROM api EXCEPT ALL SELECT * FROM chain)) missing_from_chain`,
        )
        const row = comparison.getRowObjectsJS()[0]!
        apiRows = Number(row.api_rows)
        apiWallets = Number(row.api_wallets)
        missingFromApi = Number(row.missing_from_api)
        missingFromChain = Number(row.missing_from_chain)
      }
      const chainRows = Number(aggregate.chain_rows)
      const chainSharesVolume = Number(aggregate.chain_shares_volume)
      const gammaSharesVolume = market.volumeGamma === null ? null : Number(market.volumeGamma)
      const gammaDriftShares =
        gammaSharesVolume === null ? null : Math.abs(chainSharesVolume - gammaSharesVolume)
      const gammaToleranceShares = completenessToleranceShares(chainRows)
      const exactApiMatch =
        apiRows !== null && missingFromApi === 0 && missingFromChain === 0 && apiRows === chainRows
      const gammaMatch = gammaDriftShares !== null && gammaDriftShares <= gammaToleranceShares
      const duplicateLogIdentities = Number(aggregate.duplicates)
      results.push({
        marketId: market.id,
        slug: market.slug,
        chainRows,
        apiRows,
        missingFromApi,
        missingFromChain,
        chainWallets: Number(aggregate.chain_wallets),
        apiWallets,
        chainSharesVolume,
        gammaSharesVolume,
        gammaDriftShares,
        gammaToleranceShares,
        duplicateLogIdentities,
        exactApiMatch,
        gammaMatch,
        passed: exactApiMatch && gammaMatch && duplicateLogIdentities === 0,
      })
    }
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
  const passedMarkets = results.filter((result) => result.passed).length
  const report: ChainVerificationReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    markets: results.length,
    passedMarkets,
    failedMarkets: results.length - passedMarkets,
    passed: passedMarkets === results.length,
    results,
  }
  const reportPath = path.join(chainScopeDir(scope), 'verification.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return { report, path: reportPath }
}
