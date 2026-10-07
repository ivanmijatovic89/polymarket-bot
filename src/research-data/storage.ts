import type { DuckDBConnection } from '@duckdb/node-api'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { sqlQuote } from '../utils/duckdb.js'
import { readJson, writeJson } from './files.js'
import { createResearchDatabase } from './database.js'
import { claimReader } from './retention.js'
import { datasetFamily } from './family.js'

export const SCHEMAS = {
  markets: {
    slug: 'VARCHAR',
    condition_id: 'VARCHAR',
    event_id: 'VARCHAR',
    symbol: 'VARCHAR',
    timeframe: 'VARCHAR',
    market_start: 'BIGINT',
    market_end: 'BIGINT',
    token_ids: 'VARCHAR[]',
    outcomes: 'VARCHAR[]',
    payouts: 'VARCHAR[]',
    resolved: 'BOOLEAN',
    raw_json: 'VARCHAR',
    resolution_json: 'VARCHAR',
    source_warnings: 'VARCHAR[]',
  },
  trades: {
    row_index: 'BIGINT',
    proxy_wallet: 'VARCHAR',
    condition_id: 'VARCHAR',
    token_id: 'VARCHAR',
    transaction_hash: 'VARCHAR',
    timestamp: 'BIGINT',
    side: 'VARCHAR',
    size: 'DECIMAL(38,6)',
    price: 'DECIMAL(38,18)',
    is_taker: 'BOOLEAN',
    raw_json: 'VARCHAR',
  },
  activities: {
    row_index: 'BIGINT',
    proxy_wallet: 'VARCHAR',
    condition_id: 'VARCHAR',
    token_id: 'VARCHAR',
    transaction_hash: 'VARCHAR',
    timestamp: 'BIGINT',
    side: 'VARCHAR',
    size: 'DECIMAL(38,6)',
    price: 'DECIMAL(38,18)',
    type: 'VARCHAR',
    usdc_size: 'DECIMAL(38,6)',
    raw_json: 'VARCHAR',
  },
  positions: {
    proxy_wallet: 'VARCHAR',
    condition_id: 'VARCHAR',
    token_id: 'VARCHAR',
    current_size: 'DECIMAL(38,6)',
    realized_pnl: 'DECIMAL(38,6)',
    unrealized_pnl: 'DECIMAL(38,6)',
    total_pnl: 'DECIMAL(38,6)',
    entry_fees_usdc: 'DECIMAL(38,6)',
    raw_json: 'VARCHAR',
  },
  wallet_markets: {
    wallet: 'VARCHAR',
    condition_id: 'VARCHAR',
    slug: 'VARCHAR',
    market_start: 'BIGINT',
    trade_count: 'BIGINT',
    activity_count: 'BIGINT',
    buy_usdc: 'DECIMAL(38,6)',
    sell_usdc: 'DECIMAL(38,6)',
    split_usdc: 'DECIMAL(38,6)',
    merge_usdc: 'DECIMAL(38,6)',
    redeem_usdc: 'DECIMAL(38,6)',
    cash_pnl_usdc: 'DECIMAL(38,6)',
    unredeemed_value_usdc: 'DECIMAL(38,6)',
    economic_pnl_usdc: 'DECIMAL(38,6)',
    rewards_usdc: 'DECIMAL(38,6)',
    pnl_with_rewards_usdc: 'DECIMAL(38,6)',
    api_position_pnl_usdc: 'DECIMAL(38,6)',
    api_pnl_difference_usdc: 'DECIMAL(38,6)',
    modeled_api_pnl_usdc: 'DECIMAL(38,6)',
    api_pnl_status: 'VARCHAR',
    quality: 'VARCHAR',
    issues: 'VARCHAR[]',
    notes: 'VARCHAR[]',
  },
  coverage: {
    slug: 'VARCHAR',
    condition_id: 'VARCHAR',
    market_start: 'BIGINT',
    found: 'BOOLEAN',
    trade_count: 'BIGINT',
    wallet_count: 'BIGINT',
    complete_wallets: 'BIGINT',
    unresolved_wallets: 'BIGINT',
    pending_wallets: 'BIGINT',
  },
} as const
export type TableName = keyof typeof SCHEMAS
export const TABLES = Object.keys(SCHEMAS) as TableName[]

export interface DaySnapshot {
  date: string
  directory: string
  as_of: string
  generation: string
  missing_markets: string[]
  complete_wallet_markets: number
  unresolved_wallet_markets: number
  pending_wallet_markets: number
  parquet_bytes: number
  report: string
  source_warnings?: {
    slug: string
    condition_id: string
    code: string
    difference_shares: string
  }[]
}
export interface DatasetIndex {
  version: 1
  days: Record<string, DaySnapshot>
}

export async function loadIndex(root: string): Promise<DatasetIndex> {
  const index = (await readJson<DatasetIndex>(path.join(root, 'index.json'))) ?? {
    version: 1,
    days: {},
  }
  if (index.version !== 1) throw new Error('Unsupported research dataset version')
  return index
}

export async function publish(root: string, snapshot: DaySnapshot): Promise<void> {
  const index = await loadIndex(root)
  index.days[snapshot.date] = snapshot
  await writeJson(path.join(root, 'index.json'), index)
}

export async function writeParquet(
  connection: DuckDBConnection,
  table: TableName,
  rows: unknown[],
  directory: string,
  onDiskSample?: (bytes: number) => void | Promise<void>,
): Promise<number> {
  await mkdir(directory, { recursive: true })
  const input = path.join(directory, `${table}.jsonl.tmp`)
  const output = path.join(directory, `${table}.parquet`)
  const stream = createWriteStream(input)
  try {
    const finished = once(stream, 'finish')
    for (const row of rows) {
      if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain')
    }
    stream.end()
    await finished
    const fields = Object.entries(SCHEMAS[table])
    const columns = fields.map(([name, type]) => `${sqlQuote(name)}: ${sqlQuote(type)}`).join(', ')
    const select = rows.length
      ? `SELECT * FROM read_json(${sqlQuote(input)}, format='newline_delimited', columns={${columns}})`
      : `SELECT ${fields.map(([name, type]) => `NULL::${type} AS "${name}"`).join(', ')} WHERE false`
    // A retry may replace an unpublished partial generation. Published
    // generations are immutable and never passed to this writer again.
    await rm(output, { force: true })
    await connection.run(
      `COPY (${select}) TO ${sqlQuote(output)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    )
    const bytes = (await stat(output)).size
    await onDiskSample?.(bytes + (await stat(input)).size)
    return bytes
  } finally {
    stream.destroy()
    await rm(input, { force: true })
  }
}

export async function openDataset(
  root: string,
): Promise<{ connection: DuckDBConnection; index: DatasetIndex; close: () => void }> {
  const releaseReader = await claimReader(root)
  let closeDatabase = () => {}
  const close = () => {
    try {
      closeDatabase()
    } finally {
      releaseReader()
    }
  }
  try {
    const index = await loadIndex(root)
    const family = await datasetFamily(root)
    const database = await createResearchDatabase()
    const { connection } = database
    closeDatabase = database.close
    await connection.run("SET TimeZone = 'UTC'")
    for (const table of TABLES) {
      const files = Object.values(index.days).map((day) =>
        path.join(root, day.directory, `${table}.parquet`),
      )
      const select = files.length
        ? `SELECT * FROM read_parquet([${files.map(sqlQuote).join(', ')}], union_by_name=true)`
        : `SELECT ${Object.entries(SCHEMAS[table])
            .map(([name, type]) => `NULL::${type} AS "${name}"`)
            .join(', ')} WHERE false`
      await connection.run(`CREATE VIEW ${table} AS ${select}`)
      if (table === 'markets' && files.length) {
        const columns = (await connection.runAndReadAll('DESCRIBE markets')).getRowObjectsJson()
        if (!columns.some((row) => row.column_name === 'source_warnings'))
          await connection.run(
            `CREATE OR REPLACE VIEW markets AS SELECT *, []::VARCHAR[] AS source_warnings FROM (${select})`,
          )
      }
    }
    await connection.run(`CREATE VIEW wallet_months_audit AS WITH month_coverage AS (
    SELECT strftime(to_timestamp(market_start), '%Y-%m') AS month,
      count(*) FILTER (WHERE found) AS found_windows,
      ${family.windowsPerDay} * date_diff('day', date_trunc('month', min(to_timestamp(market_start))),
        date_trunc('month', min(to_timestamp(market_start))) + INTERVAL 1 MONTH) AS expected_windows
    FROM coverage GROUP BY month)
    SELECT wallet, strftime(to_timestamp(market_start), '%Y-%m') AS month,
      count(*) AS market_count, sum(trade_count) AS trade_count,
      count(*) FILTER (WHERE quality <> 'complete') AS incomplete_markets,
      bool_and(c.found_windows = c.expected_windows) AS cohort_complete,
      CASE WHEN bool_and(c.found_windows = c.expected_windows) AND count(*) FILTER (WHERE quality <> 'complete') = 0 THEN sum(economic_pnl_usdc) END AS economic_pnl_usdc,
      sum(cash_pnl_usdc) AS observed_cash_pnl_usdc, sum(rewards_usdc) AS observed_rewards_usdc
    FROM wallet_markets w JOIN month_coverage c ON strftime(to_timestamp(w.market_start), '%Y-%m') = c.month
    GROUP BY wallet, strftime(to_timestamp(market_start), '%Y-%m')`)
    await connection.run(`CREATE VIEW wallet_months AS
      SELECT w.wallet, strftime(to_timestamp(w.market_start), '%Y-%m') AS month,
        count(*) AS market_count, sum(w.trade_count) AS trade_count,
        CASE WHEN bool_and(c.cohort_complete) AND count(*) FILTER (WHERE w.economic_pnl_usdc IS NULL) = 0
          THEN sum(w.economic_pnl_usdc) END AS profit_usdc
      FROM wallet_markets w JOIN wallet_months_audit c
        ON w.wallet = c.wallet AND strftime(to_timestamp(w.market_start), '%Y-%m') = c.month
      GROUP BY w.wallet, strftime(to_timestamp(w.market_start), '%Y-%m')`)
    return {
      connection,
      index,
      close,
    }
  } catch (error) {
    close()
    throw error
  }
}
