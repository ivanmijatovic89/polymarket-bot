import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DuckDBDecimalValue, DuckDBInstance, type DuckDBAppender } from '@duckdb/node-api'
import type { ApiPosition } from '../dataApi.js'
import type { KeptRow } from '../activityRows.js'
import type { TradeRow } from '../tradeRows.js'
import {
  listFactFiles,
  marketFactPath,
  walletActivityPath,
  type MarketFactLocator,
} from './paths.js'

const DECIMAL_WIDTH = 18
const DECIMAL_SCALE = 6

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function appendNullableInteger(appender: DuckDBAppender, value: number | null | undefined): void {
  if (value === null || value === undefined) appender.appendNull()
  else appender.appendInteger(value)
}

function appendNullableDecimal(appender: DuckDBAppender, value: number | null | undefined): void {
  if (value === null || value === undefined || !Number.isFinite(value)) appender.appendNull()
  else appender.appendDecimal(DuckDBDecimalValue.fromDouble(value, DECIMAL_WIDTH, DECIMAL_SCALE))
}

function appendDecimal(appender: DuckDBAppender, value: number): void {
  appender.appendDecimal(DuckDBDecimalValue.fromDouble(value, DECIMAL_WIDTH, DECIMAL_SCALE))
}

async function createParquet(
  targetPath: string,
  createSql: string,
  appendRows: (appender: DuckDBAppender) => void,
  selectSql = 'SELECT * FROM rows_',
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    await connection.run(createSql)
    const appender = await connection.createAppender('rows_')
    try {
      appendRows(appender)
      appender.flushSync()
    } finally {
      appender.closeSync()
    }
    await rm(tmpPath, { force: true })
    await connection.run(
      `COPY (${selectSql}) TO ${sqlString(tmpPath)} ` +
        `(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 250000)`,
    )
    await rename(tmpPath, targetPath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

export async function writeMarketTrades(
  market: MarketFactLocator,
  rows: TradeRow[],
): Promise<string> {
  const target = marketFactPath('trades', market)
  await createParquet(
    target,
    `CREATE TABLE rows_ (
      market_id INTEGER, wallet VARCHAR, side VARCHAR, outcome_index INTEGER,
      asset VARCHAR, size DECIMAL(18,6), price DECIMAL(18,6), usdc_size DECIMAL(18,6),
      is_taker BOOLEAN, ts_ms BIGINT, tx_hash VARCHAR
    )`,
    (appender) => {
      for (const row of rows) {
        appender.appendInteger(market.id)
        appender.appendVarchar(row.wallet.toLowerCase())
        appender.appendVarchar(row.side)
        appendNullableInteger(appender, row.outcomeIndex)
        appender.appendVarchar(row.asset)
        appendDecimal(appender, row.size)
        appendDecimal(appender, row.price)
        appendDecimal(appender, row.usdcSize)
        appender.appendBoolean(row.isTaker)
        appender.appendBigInt(BigInt(row.tsMs))
        appender.appendVarchar(row.txHash)
        appender.endRow()
      }
    },
    'SELECT * FROM rows_ ORDER BY ts_ms, tx_hash, wallet',
  )
  return target
}

export async function writeMarketPositions(
  market: MarketFactLocator,
  rows: ApiPosition[],
): Promise<string> {
  const target = marketFactPath('positions', market)
  await createParquet(
    target,
    `CREATE TABLE rows_ (
      market_id INTEGER, wallet VARCHAR, asset VARCHAR, outcome_index INTEGER,
      final_size DECIMAL(18,6), avg_price DECIMAL(18,6), total_bought DECIMAL(18,6),
      realized_pnl DECIMAL(18,6), cash_pnl DECIMAL(18,6)
    )`,
    (appender) => {
      for (const row of rows) {
        appender.appendInteger(market.id)
        appender.appendVarchar(row.proxyWallet.toLowerCase())
        appender.appendVarchar(row.asset)
        appendNullableInteger(appender, row.outcomeIndex)
        appendNullableDecimal(appender, row.size)
        appendNullableDecimal(appender, row.avgPrice)
        appendNullableDecimal(appender, row.totalBought)
        appendNullableDecimal(appender, row.realizedPnl)
        appendNullableDecimal(appender, row.cashPnl)
        appender.endRow()
      }
    },
    'SELECT * FROM rows_ ORDER BY wallet, asset',
  )
  return target
}

export async function writeWalletActivity(wallet: string, rows: KeptRow[]): Promise<string> {
  const target = walletActivityPath(wallet)
  const exists = await BunFileExists(target)
  const oldRows = exists
    ? `SELECT * FROM read_parquet(${sqlString(target)}) UNION ALL BY NAME SELECT * FROM rows_`
    : 'SELECT * FROM rows_'
  await createParquet(
    target,
    `CREATE TABLE rows_ (
      wallet VARCHAR, type VARCHAR, market_id INTEGER, condition_id VARCHAR,
      size DECIMAL(18,6), usdc_size DECIMAL(18,6), outcome_index INTEGER,
      ts_ms BIGINT, tx_hash VARCHAR, dedup_key VARCHAR
    )`,
    (appender) => {
      for (const kept of rows) {
        const row = kept.row
        appender.appendVarchar(wallet.toLowerCase())
        appender.appendVarchar(row.type)
        appendNullableInteger(appender, kept.marketId)
        appender.appendVarchar(row.conditionId)
        appendNullableDecimal(appender, row.size)
        appendNullableDecimal(appender, row.usdcSize)
        appendNullableInteger(appender, row.outcomeIndex)
        appender.appendBigInt(BigInt(row.timestamp * 1000))
        if (row.transactionHash) appender.appendVarchar(row.transactionHash)
        else appender.appendNull()
        appender.appendVarchar(kept.key)
        appender.endRow()
      }
    },
    `SELECT * EXCLUDE (rn) FROM (
       SELECT *, row_number() OVER (PARTITION BY dedup_key ORDER BY ts_ms DESC) AS rn
       FROM (${oldRows})
     ) WHERE rn = 1 ORDER BY ts_ms, dedup_key`,
  )
  return target
}

async function BunFileExists(filePath: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function marketParticipants(market: MarketFactLocator): Promise<string[]> {
  const files = [marketFactPath('positions', market), marketFactPath('trades', market)]
  const existing: string[] = []
  for (const file of files) if (await BunFileExists(file)) existing.push(file)
  if (existing.length === 0) return []
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const unions = existing.map((file) => `SELECT wallet FROM read_parquet(${sqlString(file)})`)
    const result = await connection.runAndReadAll(
      `SELECT DISTINCT lower(wallet) AS wallet FROM (${unions.join(' UNION ALL ')}) ORDER BY wallet`,
    )
    return result.getRowObjectsJS().map((row) => String(row.wallet))
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

/** Participants from the load-bearing positions snapshot only. */
export async function marketPositionParticipants(market: MarketFactLocator): Promise<string[]> {
  const file = marketFactPath('positions', market)
  if (!(await BunFileExists(file))) return []
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const result = await connection.runAndReadAll(
      `SELECT DISTINCT lower(wallet) AS wallet FROM read_parquet(${sqlString(file)}) ORDER BY wallet`,
    )
    return result.getRowObjectsJS().map((row) => String(row.wallet))
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

export type TradeAggregate = {
  marketId: number
  rows: number
  wallets: number
  sharesVolume: number
}

export async function tradeAggregates(): Promise<Map<number, TradeAggregate>> {
  const files = await listFactFiles('trades')
  if (files.length === 0) return new Map()
  const fileList = `[${files.map(sqlString).join(',')}]`
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const result = await connection.runAndReadAll(
      `SELECT market_id, count(*)::INTEGER AS rows_,
              count(DISTINCT wallet)::INTEGER AS wallets,
              coalesce(sum(size), 0)::DOUBLE / 2 AS shares_volume
       FROM read_parquet(${fileList}, union_by_name = true)
       GROUP BY market_id`,
    )
    return new Map(
      result.getRowObjectsJS().map((row) => [
        Number(row.market_id),
        {
          marketId: Number(row.market_id),
          rows: Number(row.rows_),
          wallets: Number(row.wallets),
          sharesVolume: Number(row.shares_volume),
        },
      ]),
    )
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

export async function marketVerification(market: MarketFactLocator): Promise<{
  tradeRows: number
  tradeWallets: number
  sharesVolume: number
  positions: Array<{ wallet: string; asset: string }>
  orphanWallets: number
}> {
  const tradeFile = marketFactPath('trades', market)
  const positionFile = marketFactPath('positions', market)
  const hasTrades = await BunFileExists(tradeFile)
  const hasPositions = await BunFileExists(positionFile)
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const positions = hasPositions
      ? (
          await connection.runAndReadAll(
            `SELECT lower(wallet) AS wallet, asset FROM read_parquet(${sqlString(positionFile)})`,
          )
        ).getRowObjectsJS()
      : []
    if (!hasTrades) {
      return {
        tradeRows: 0,
        tradeWallets: 0,
        sharesVolume: 0,
        positions: positions.map((row) => ({
          wallet: String(row.wallet),
          asset: String(row.asset),
        })),
        orphanWallets: 0,
      }
    }
    const summary = await connection.runAndReadAll(
      `SELECT count(*)::INTEGER AS rows_, count(DISTINCT wallet)::INTEGER AS wallets,
              coalesce(sum(size), 0)::DOUBLE / 2 AS shares_volume
       FROM read_parquet(${sqlString(tradeFile)})`,
    )
    const row = summary.getRowObjectsJS()[0] ?? {}
    let orphanWallets = 0
    if (hasPositions) {
      const orphan = await connection.runAndReadAll(
        `SELECT count(*)::INTEGER AS n FROM (
           SELECT DISTINCT lower(wallet) AS wallet FROM read_parquet(${sqlString(tradeFile)})
           EXCEPT
           SELECT DISTINCT lower(wallet) AS wallet FROM read_parquet(${sqlString(positionFile)})
         )`,
      )
      orphanWallets = Number(orphan.getRowObjectsJS()[0]?.n ?? 0)
    } else {
      orphanWallets = Number(row.wallets ?? 0)
    }
    return {
      tradeRows: Number(row.rows_ ?? 0),
      tradeWallets: Number(row.wallets ?? 0),
      sharesVolume: Number(row.shares_volume ?? 0),
      positions: positions.map((p) => ({ wallet: String(p.wallet), asset: String(p.asset) })),
      orphanWallets,
    }
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

export type WalletTradeAggregate = {
  wallet: string
  rows: number
  size: number
  usdcSize: number
}

export async function marketWalletAggregates(
  market: MarketFactLocator,
  limit: number,
): Promise<WalletTradeAggregate[]> {
  const tradeFile = marketFactPath('trades', market)
  if (!(await BunFileExists(tradeFile)) || limit <= 0) return []
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const result = await connection.runAndReadAll(
      `SELECT lower(wallet) AS wallet, count(*)::INTEGER AS rows_,
              sum(size)::DOUBLE AS size_, sum(usdc_size)::DOUBLE AS usdc_size_
       FROM read_parquet(${sqlString(tradeFile)})
       GROUP BY lower(wallet)
       ORDER BY usdc_size_ DESC, wallet
       LIMIT ${Math.trunc(limit)}`,
    )
    return result.getRowObjectsJS().map((row) => ({
      wallet: String(row.wallet),
      rows: Number(row.rows_),
      size: Number(row.size_),
      usdcSize: Number(row.usdc_size_),
    }))
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}
