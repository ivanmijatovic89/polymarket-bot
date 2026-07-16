#!/usr/bin/env tsx
import '../config/env.js'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DuckDBInstance, type DuckDBAppender } from '@duckdb/node-api'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/index.js'
import {
  catalogPath,
  listChainActivityFiles,
  listChainTradeFiles,
  listFactFiles,
} from './storage/paths.js'

const LABEL = '[polymarket-data:catalog]'

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function appendNullableString(appender: DuckDBAppender, value: unknown): void {
  if (value === null || value === undefined) appender.appendNull()
  else appender.appendVarchar(String(value))
}

function appendNullableBigInt(appender: DuckDBAppender, value: unknown): void {
  if (value === null || value === undefined) appender.appendNull()
  else appender.appendBigInt(BigInt(String(value)))
}

function appendNullableDouble(appender: DuckDBAppender, value: unknown): void {
  if (value === null || value === undefined) appender.appendNull()
  else appender.appendDouble(Number(value))
}

async function factViewSql(
  name: string,
  kind: 'trades' | 'positions' | 'activity',
  emptySql: string,
): Promise<string> {
  const files = await listFactFiles(kind)
  if (files.length === 0) return `CREATE VIEW ${name} AS ${emptySql}`
  const hive = kind === 'activity' ? '' : ', hive_partitioning = true'
  return (
    `CREATE VIEW ${name} AS SELECT * FROM read_parquet(` +
    `[${files.map(quote).join(',')}], union_by_name = true${hive})`
  )
}

async function chainTradeViewSql(): Promise<string> {
  const files = await listChainTradeFiles()
  if (files.length === 0) {
    return `CREATE VIEW polymarket_chain_trades AS
      SELECT NULL::INTEGER market_id, NULL::VARCHAR condition_id, NULL::VARCHAR wallet,
        NULL::VARCHAR counterparty, NULL::VARCHAR side, NULL::TINYINT outcome_index,
        NULL::VARCHAR asset, NULL::VARCHAR order_hash, NULL::VARCHAR size_atomic,
        NULL::DECIMAL(38,6) size, NULL::VARCHAR usdc_atomic,
        NULL::DECIMAL(38,6) usdc_size, NULL::DECIMAL(18,6) price,
        NULL::VARCHAR fee_atomic, NULL::DECIMAL(38,6) fee, NULL::BOOLEAN is_taker,
        NULL::BIGINT block_number, NULL::VARCHAR block_hash, NULL::BIGINT ts_ms,
        NULL::VARCHAR transaction_hash, NULL::INTEGER transaction_index,
        NULL::INTEGER log_index, NULL::VARCHAR symbol, NULL::VARCHAR timeframe,
        NULL::DATE date WHERE false`
  }
  return (
    `CREATE VIEW polymarket_chain_trades AS SELECT * FROM read_parquet(` +
    `[${files.map(quote).join(',')}], union_by_name = true, hive_partitioning = true)`
  )
}

async function chainActivityViewSql(): Promise<string> {
  const files = await listChainActivityFiles()
  if (files.length === 0) {
    return `CREATE VIEW polymarket_chain_activity AS
      SELECT NULL::VARCHAR type, NULL::INTEGER market_id, NULL::VARCHAR condition_id,
        NULL::VARCHAR token_id, NULL::TINYINT outcome_index, NULL::VARCHAR wallet,
        NULL::VARCHAR counterparty, NULL::VARCHAR operator, NULL::VARCHAR amount_atomic,
        NULL::DECIMAL(38,6) amount, NULL::VARCHAR payout_atomic,
        NULL::DECIMAL(38,6) payout, NULL::BIGINT index_set, NULL::BIGINT block_number,
        NULL::BIGINT ts_ms, NULL::VARCHAR transaction_hash,
        NULL::INTEGER transaction_index, NULL::INTEGER log_index, NULL::VARCHAR contract,
        NULL::VARCHAR symbol, NULL::VARCHAR timeframe, NULL::DATE date WHERE false`
  }
  return (
    `CREATE VIEW polymarket_chain_activity AS SELECT * FROM read_parquet(` +
    `[${files.map(quote).join(',')}], union_by_name = true, hive_partitioning = true)`
  )
}

export async function buildCatalog(): Promise<string> {
  const target = catalogPath()
  const tmp = `${target}.tmp`
  await mkdir(path.dirname(target), { recursive: true })
  await rm(tmp, { force: true })
  await rm(`${tmp}.wal`, { force: true })

  const db = getDb()
  const marketResult = await db.execute(sql`SELECT * FROM polymarket_markets ORDER BY id`)
  const walletResult = await db.execute(sql`SELECT * FROM polymarket_wallets ORDER BY wallet`)
  const markets = (marketResult as unknown as Array<Array<Record<string, unknown>>>)[0] ?? []
  const wallets = (walletResult as unknown as Array<Array<Record<string, unknown>>>)[0] ?? []

  const instance = await DuckDBInstance.create(tmp)
  const connection = await instance.connect()
  try {
    await connection.run(`CREATE TABLE polymarket_markets (
      id INTEGER, condition_id VARCHAR, slug VARCHAR, event_id VARCHAR, series_id VARCHAR,
      symbol VARCHAR, timeframe VARCHAR, market_start_ms BIGINT, market_end_ms BIGINT,
      question VARCHAR, outcomes VARCHAR, resolved_outcome VARCHAR, closed BOOLEAN,
      volume_gamma DOUBLE, liquidity_gamma DOUBLE, asset_id_0 VARCHAR, asset_id_1 VARCHAR,
      raw_json VARCHAR, trades_status VARCHAR, trades_source VARCHAR, trade_rows INTEGER,
      trade_wallets INTEGER, volume_traded DOUBLE, trades_error VARCHAR,
      positions_status VARCHAR, position_rows INTEGER, positions_error VARCHAR,
      synced_at VARCHAR, updated_at VARCHAR
    )`)
    const ma = await connection.createAppender('polymarket_markets')
    try {
      for (const r of markets) {
        ma.appendInteger(Number(r.id))
        ma.appendVarchar(String(r.condition_id))
        ma.appendVarchar(String(r.slug))
        appendNullableString(ma, r.event_id)
        ma.appendVarchar(String(r.series_id))
        ma.appendVarchar(String(r.symbol))
        ma.appendVarchar(String(r.timeframe))
        ma.appendBigInt(BigInt(String(r.market_start_ms)))
        ma.appendBigInt(BigInt(String(r.market_end_ms)))
        appendNullableString(ma, r.question)
        appendNullableString(ma, r.outcomes === null ? null : JSON.stringify(r.outcomes))
        appendNullableString(ma, r.resolved_outcome)
        ma.appendBoolean(Boolean(r.closed))
        appendNullableDouble(ma, r.volume_gamma)
        appendNullableDouble(ma, r.liquidity_gamma)
        appendNullableString(ma, r.asset_id_0)
        appendNullableString(ma, r.asset_id_1)
        appendNullableString(ma, r.raw_json === null ? null : JSON.stringify(r.raw_json))
        ma.appendVarchar(String(r.trades_status))
        appendNullableString(ma, r.trades_source)
        if (r.trade_rows === null) ma.appendNull()
        else ma.appendInteger(Number(r.trade_rows))
        if (r.trade_wallets === null) ma.appendNull()
        else ma.appendInteger(Number(r.trade_wallets))
        appendNullableDouble(ma, r.volume_traded)
        appendNullableString(ma, r.trades_error)
        ma.appendVarchar(String(r.positions_status))
        if (r.position_rows === null) ma.appendNull()
        else ma.appendInteger(Number(r.position_rows))
        appendNullableString(ma, r.positions_error)
        appendNullableString(ma, r.synced_at)
        appendNullableString(ma, r.updated_at)
        ma.endRow()
      }
    } finally {
      ma.closeSync()
    }

    await connection.run(`CREATE TABLE polymarket_wallets (
      wallet VARCHAR, name VARCHAR, pseudonym VARCHAR, trade_count INTEGER,
      markets_count INTEGER, first_trade_ms BIGINT, last_trade_ms BIGINT,
      activity_status VARCHAR, activity_cursor_ts BIGINT, activity_error VARCHAR
    )`)
    const wa = await connection.createAppender('polymarket_wallets')
    try {
      for (const r of wallets) {
        wa.appendVarchar(String(r.wallet))
        appendNullableString(wa, r.name)
        appendNullableString(wa, r.pseudonym)
        wa.appendInteger(Number(r.trade_count ?? 0))
        wa.appendInteger(Number(r.markets_count ?? 0))
        appendNullableBigInt(wa, r.first_trade_ms)
        appendNullableBigInt(wa, r.last_trade_ms)
        wa.appendVarchar(String(r.activity_status))
        appendNullableBigInt(wa, r.activity_cursor_ts)
        appendNullableString(wa, r.activity_error)
        wa.endRow()
      }
    } finally {
      wa.closeSync()
    }

    await connection.run(
      await factViewSql(
        'polymarket_trades',
        'trades',
        `SELECT NULL::INTEGER market_id, NULL::VARCHAR wallet, NULL::VARCHAR side,
          NULL::INTEGER outcome_index, NULL::VARCHAR asset, NULL::DECIMAL(18,6) size,
          NULL::DECIMAL(18,6) price, NULL::DECIMAL(18,6) usdc_size, NULL::BOOLEAN is_taker,
          NULL::BIGINT ts_ms, NULL::VARCHAR tx_hash, NULL::VARCHAR symbol,
          NULL::VARCHAR timeframe, NULL::VARCHAR month WHERE false`,
      ),
    )
    await connection.run(await chainTradeViewSql())
    await connection.run(await chainActivityViewSql())
    await connection.run(
      await factViewSql(
        'polymarket_market_positions',
        'positions',
        `SELECT NULL::INTEGER market_id, NULL::VARCHAR wallet, NULL::VARCHAR asset,
          NULL::INTEGER outcome_index, NULL::DECIMAL(18,6) final_size,
          NULL::DECIMAL(18,6) avg_price, NULL::DECIMAL(18,6) total_bought,
          NULL::DECIMAL(18,6) realized_pnl, NULL::DECIMAL(18,6) cash_pnl,
          NULL::VARCHAR symbol, NULL::VARCHAR timeframe, NULL::VARCHAR month WHERE false`,
      ),
    )
    await connection.run(
      await factViewSql(
        'polymarket_activity',
        'activity',
        `SELECT NULL::VARCHAR wallet, NULL::VARCHAR AS "type", NULL::INTEGER market_id,
          NULL::VARCHAR condition_id, NULL::DECIMAL(18,6) size,
          NULL::DECIMAL(18,6) usdc_size, NULL::INTEGER outcome_index, NULL::BIGINT ts_ms,
          NULL::VARCHAR tx_hash, NULL::VARCHAR dedup_key WHERE false`,
      ),
    )
    await connection.run('CHECKPOINT')
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
  await rename(tmp, target)
  console.log(`${LABEL} built ${target} (markets=${markets.length}, wallets=${wallets.length})`)
  return target
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const target = await buildCatalog()
  if (args.length === 0) return
  const query = args.join(' ')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('duckdb', ['-readonly', target, '-c', query], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`duckdb exited ${code}`)),
    )
  })
}

main()
  .then(async () => closeDb())
  .catch(async (error) => {
    console.error(`${LABEL} ${(error as Error).message}`)
    await closeDb().catch(() => {})
    process.exit(1)
  })
