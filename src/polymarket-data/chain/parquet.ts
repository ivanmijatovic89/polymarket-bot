import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBDecimalValue, DuckDBInstance, type DuckDBAppender } from '@duckdb/node-api'
import type { ScopeLocator } from './checkpoints.js'
import { chainScopeDir } from './checkpoints.js'
import type { VerifiedReceipt } from './receipts.js'
import type { ChainScopeMarket } from './scope.js'
import { storageRoot } from '../storage/paths.js'

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function receiptBatchId(receipts: readonly VerifiedReceipt[]): string {
  const hash = createHash('sha256')
  for (const receipt of receipts) hash.update(receipt.transactionHash.toLowerCase()).update('\n')
  return hash.digest('hex').slice(0, 24)
}

function appendTrade(appender: DuckDBAppender, receipt: VerifiedReceipt, index: number): void {
  const row = receipt.trades[index]!
  appender.appendInteger(row.marketId)
  appender.appendVarchar(row.conditionId)
  appender.appendVarchar(row.wallet)
  appender.appendVarchar(row.taker)
  appender.appendVarchar(row.side)
  appender.appendInteger(row.outcomeIndex)
  appender.appendVarchar(row.asset)
  appender.appendVarchar(row.orderHash)
  appender.appendVarchar(row.sizeAtomic.toString())
  appender.appendDecimal(new DuckDBDecimalValue(row.sizeAtomic, 38, 6))
  appender.appendVarchar(row.usdcAtomic.toString())
  appender.appendDecimal(new DuckDBDecimalValue(row.usdcAtomic, 38, 6))
  appender.appendDecimal(new DuckDBDecimalValue(row.priceMillionths, 18, 6))
  appender.appendVarchar(row.feeAtomic.toString())
  appender.appendDecimal(new DuckDBDecimalValue(row.feeAtomic, 38, 6))
  appender.appendBoolean(row.isTaker)
  appender.appendBigInt(row.blockNumber)
  appender.appendVarchar(receipt.blockHash)
  appender.appendBigInt(receipt.blockTimestampSec * 1_000n)
  appender.appendVarchar(row.transactionHash)
  appender.appendInteger(row.transactionIndex)
  appender.appendInteger(row.logIndex)
  appender.endRow()
}

export async function writeReceiptBatchParquet(
  scope: ScopeLocator,
  receipts: readonly VerifiedReceipt[],
): Promise<{ parquet: string; manifest: string }> {
  if (receipts.length === 0) throw new Error('cannot write an empty receipt batch')
  const dir = path.join(chainScopeDir(scope), 'receipt-batches')
  await mkdir(dir, { recursive: true })
  const id = receiptBatchId(receipts)
  const target = path.join(dir, `${id}.parquet`)
  const manifest = path.join(dir, `${id}.json`)
  const tmp = `${target}.${randomUUID()}.tmp`
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    await connection.run(`CREATE TABLE rows_ (
      market_id INTEGER, condition_id VARCHAR, wallet VARCHAR, counterparty VARCHAR,
      side VARCHAR, outcome_index TINYINT, asset VARCHAR, order_hash VARCHAR,
      size_atomic VARCHAR, size DECIMAL(38,6), usdc_atomic VARCHAR,
      usdc_size DECIMAL(38,6), price DECIMAL(18,6), fee_atomic VARCHAR,
      fee DECIMAL(38,6), is_taker BOOLEAN, block_number BIGINT, block_hash VARCHAR,
      ts_ms BIGINT, transaction_hash VARCHAR, transaction_index INTEGER, log_index INTEGER
    )`)
    const appender = await connection.createAppender('rows_')
    try {
      for (const receipt of receipts) {
        for (let i = 0; i < receipt.trades.length; i++) appendTrade(appender, receipt, i)
      }
      appender.flushSync()
    } finally {
      appender.closeSync()
    }
    await rm(tmp, { force: true })
    await connection.run(
      `COPY (SELECT * FROM rows_ ORDER BY block_number, transaction_index, log_index) ` +
        `TO ${quote(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000)`,
    )
    await rename(tmp, target)
    const manifestTmp = `${manifest}.tmp`
    await writeFile(
      manifestTmp,
      `${JSON.stringify({
        version: 1,
        transactions: receipts.map((receipt) => ({
          transactionHash: receipt.transactionHash,
          receiptLogDigest: receipt.receiptLogDigest,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          trades: receipt.trades.length,
        })),
      })}\n`,
    )
    await rename(manifestTmp, manifest)
    return { parquet: target, manifest }
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

export async function completedReceiptTransactions(scope: ScopeLocator): Promise<Set<string>> {
  const dir = path.join(chainScopeDir(scope), 'receipt-batches')
  let files: string[]
  try {
    files = (await readdir(dir)).filter((file) => /^[0-9a-f]{24}\.json$/.test(file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
  const completed = new Set<string>()
  for (const file of files) {
    const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as {
      version: number
      transactions: Array<{ transactionHash: string }>
    }
    if (parsed.version !== 1) throw new Error(`${file}: unsupported receipt manifest version`)
    const parquet = path.join(dir, file.replace(/\.json$/, '.parquet'))
    try {
      await access(parquet)
    } catch {
      throw new Error(`${file}: receipt manifest has no Parquet batch`)
    }
    for (const transaction of parsed.transactions) {
      completed.add(transaction.transactionHash.toLowerCase())
    }
  }
  return completed
}

export function candidateTradesDir(scope: ScopeLocator): string {
  return path.join(
    storageRoot(),
    'chain',
    'candidates',
    'trades',
    `symbol=${scope.symbol}`,
    `timeframe=${scope.timeframe}`,
    `date=${scope.date}`,
  )
}

export function publishedTradesDir(scope: ScopeLocator): string {
  return path.join(
    storageRoot(),
    'chain',
    'facts',
    'trades',
    `symbol=${scope.symbol}`,
    `timeframe=${scope.timeframe}`,
    `date=${scope.date}`,
  )
}

export function candidateMarketPath(scope: ScopeLocator, slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`invalid market slug ${slug}`)
  return path.join(candidateTradesDir(scope), `${slug}.parquet`)
}

async function receiptBatchFiles(scope: ScopeLocator): Promise<string[]> {
  const dir = path.join(chainScopeDir(scope), 'receipt-batches')
  try {
    return (await readdir(dir))
      .filter((file) => /^[0-9a-f]{24}\.parquet$/.test(file))
      .map((file) => path.join(dir, file))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function buildMarketCandidates(
  scope: ScopeLocator,
  markets: readonly ChainScopeMarket[],
): Promise<string[]> {
  const batches = await receiptBatchFiles(scope)
  if (batches.length === 0) throw new Error('no verified receipt Parquet batches to compact')
  const filesSql = `[${batches.map(quote).join(',')}]`
  const dir = candidateTradesDir(scope)
  await mkdir(dir, { recursive: true })
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  const output: string[] = []
  try {
    for (const market of markets) {
      const target = candidateMarketPath(scope, market.slug)
      const tmp = `${target}.${randomUUID()}.tmp`
      await rm(tmp, { force: true })
      await connection.run(
        `COPY (
           SELECT * FROM read_parquet(${filesSql}, union_by_name=true)
           WHERE market_id = ${market.id}
           ORDER BY block_number, transaction_index, log_index
         ) TO ${quote(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000)`,
      )
      await rename(tmp, target)
      output.push(target)
    }
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
  return output
}

export async function publishMarketCandidates(scope: ScopeLocator): Promise<string> {
  const source = candidateTradesDir(scope)
  const target = publishedTradesDir(scope)
  try {
    await access(target)
    return target
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(target), { recursive: true })
  await rename(source, target)
  return target
}
