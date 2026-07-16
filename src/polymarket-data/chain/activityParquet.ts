import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBDecimalValue, DuckDBInstance, type DuckDBAppender } from '@duckdb/node-api'
import { storageRoot } from '../storage/paths.js'
import type { ActivityDiscoveryChunk, TimedChainActivity } from './activityDiscovery.js'
import { chainScopeDir, type ScopeLocator } from './checkpoints.js'

type ActivityManifest = {
  version: 1
  fromBlock: string
  toBlock: string
  toBlockHash: string
  allLogs: number
  targetRows: number
  digest: string
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function chunksDir(scope: ScopeLocator): string {
  return path.join(chainScopeDir(scope), 'activity-chunks')
}

function appendNullableVarchar(appender: DuckDBAppender, value: string | null): void {
  if (value === null) appender.appendNull()
  else appender.appendVarchar(value)
}

function appendNullableInteger(appender: DuckDBAppender, value: number | null): void {
  if (value === null) appender.appendNull()
  else appender.appendInteger(value)
}

function appendNullableBigInt(appender: DuckDBAppender, value: bigint | null): void {
  if (value === null) appender.appendNull()
  else appender.appendBigInt(value)
}

function appendNullableAmount(appender: DuckDBAppender, value: bigint | null): void {
  if (value === null) appender.appendNull()
  else appender.appendDecimal(new DuckDBDecimalValue(value, 38, 6))
}

function appendRow(appender: DuckDBAppender, row: TimedChainActivity): void {
  appender.appendVarchar(row.type)
  appendNullableInteger(appender, row.marketId)
  appendNullableVarchar(appender, row.conditionId)
  appendNullableVarchar(appender, row.tokenId)
  appendNullableInteger(appender, row.outcomeIndex)
  appender.appendVarchar(row.wallet)
  appendNullableVarchar(appender, row.counterparty)
  appendNullableVarchar(appender, row.operator)
  appendNullableVarchar(appender, row.amountAtomic?.toString() ?? null)
  appendNullableAmount(appender, row.amountAtomic)
  appendNullableVarchar(appender, row.payoutAtomic?.toString() ?? null)
  appendNullableAmount(appender, row.payoutAtomic)
  appendNullableBigInt(appender, row.indexSet)
  appender.appendBigInt(row.blockNumber)
  appender.appendBigInt(row.tsMs)
  appender.appendVarchar(row.transactionHash)
  appender.appendInteger(row.transactionIndex)
  appender.appendInteger(row.logIndex)
  appender.appendVarchar(row.contract)
  appender.endRow()
}

export async function writeActivityChunk(
  scope: ScopeLocator,
  chunk: ActivityDiscoveryChunk,
  toBlockHash: string,
): Promise<string> {
  const dir = chunksDir(scope)
  await mkdir(dir, { recursive: true })
  const stem = `${chunk.fromBlock}-${chunk.toBlock}`
  const target = path.join(dir, `${stem}.parquet`)
  const tmp = `${target}.${randomUUID()}.tmp`
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    await connection.run(`CREATE TABLE rows_ (
      type VARCHAR, market_id INTEGER, condition_id VARCHAR, token_id VARCHAR,
      outcome_index TINYINT, wallet VARCHAR, counterparty VARCHAR, operator VARCHAR,
      amount_atomic VARCHAR, amount DECIMAL(38,6), payout_atomic VARCHAR,
      payout DECIMAL(38,6), index_set BIGINT, block_number BIGINT, ts_ms BIGINT,
      transaction_hash VARCHAR, transaction_index INTEGER, log_index INTEGER, contract VARCHAR
    )`)
    const appender = await connection.createAppender('rows_')
    try {
      for (const row of chunk.rows) appendRow(appender, row)
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
    const manifest: ActivityManifest = {
      version: 1,
      fromBlock: chunk.fromBlock.toString(),
      toBlock: chunk.toBlock.toString(),
      toBlockHash,
      allLogs: chunk.allLogs,
      targetRows: chunk.targetRows,
      digest: chunk.digest,
    }
    const manifestPath = path.join(dir, `${stem}.json`)
    const manifestTmp = `${manifestPath}.tmp`
    await writeFile(manifestTmp, `${JSON.stringify(manifest)}\n`)
    await rename(manifestTmp, manifestPath)
    return target
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

export async function readActivityCheckpoints(
  scope: ScopeLocator,
  expectedFrom: bigint,
): Promise<ActivityManifest[]> {
  const dir = chunksDir(scope)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((file) => /^\d+-\d+\.json$/.test(file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const manifests: ActivityManifest[] = []
  for (const file of files) {
    const manifest = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as ActivityManifest
    if (manifest.version !== 1) throw new Error(`${file}: unsupported activity manifest`)
    await access(path.join(dir, file.replace(/\.json$/, '.parquet')))
    manifests.push(manifest)
  }
  manifests.sort((a, b) => Number(BigInt(a.fromBlock) - BigInt(b.fromBlock)))
  let next = expectedFrom
  for (const manifest of manifests) {
    if (BigInt(manifest.fromBlock) !== next) {
      throw new Error(`activity checkpoint starts at ${manifest.fromBlock}, expected ${next}`)
    }
    next = BigInt(manifest.toBlock) + 1n
  }
  return manifests
}

export function publishedActivityDir(scope: ScopeLocator): string {
  return path.join(
    storageRoot(),
    'chain',
    'facts',
    'activity',
    `symbol=${scope.symbol}`,
    `timeframe=${scope.timeframe}`,
    `date=${scope.date}`,
  )
}

export async function publishActivity(scope: ScopeLocator): Promise<string> {
  const source = chunksDir(scope)
  const target = publishedActivityDir(scope)
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
