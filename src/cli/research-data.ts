import { parseArgs } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import {
  coverageReport,
  leaderboard,
  strictLeaderboard,
  querySql,
  walletReport,
} from '../research-data/query.js'
import { rebuildDataset } from '../research-data/rebuild.js'
import { verifyDataset } from '../research-data/verify.js'
import { benchmarkDataset } from '../research-data/benchmark.js'
import { syncDataset, SyncBusyError } from '../research-data/sync.js'
import { readUpdateConfig, updateDataset } from '../research-data/update.js'
import { marketFamily } from '../research-data/family.js'
import { readJson } from '../research-data/files.js'

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0]
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      root: { type: 'string' },
      config: { type: 'string' },
      scheduled: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      audit: { type: 'boolean', default: false },
      'no-combine-wallets': { type: 'boolean', default: false },
      market: { type: 'string', default: 'btc:15m' },
      from: { type: 'string' },
      to: { type: 'string' },
      concurrency: { type: 'string', default: '16' },
      rps: { type: 'string', default: '60' },
      refresh: { type: 'boolean', default: false },
      'keep-raw': { type: 'boolean', default: false },
      'min-free-gib': { type: 'string', default: '5' },
      'project-days': { type: 'string', default: '122' },
      wallet: { type: 'string' },
      limit: { type: 'string', default: '100' },
      sql: { type: 'string' },
      'sql-file': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (!command || values.help) {
    console.log(`Polymarket research data (API v2, BTC 15-minute)

Commands: sync, update, status, rebuild, verify, benchmark, coverage, leaderboard, wallet, sql
--root PATH           Permanent data directory (or POLYMARKET_RESEARCH_DATA_DIR)
--market btc:15m       Only supported market family
--from YYYY-MM-DD      UTC market-window start, inclusive
--to YYYY-MM-DD        UTC market-window start, exclusive (default: today)
--concurrency 16      Concurrent work queues
--rps 60              Shared request budget (1–60/second; endpoint caps also apply)
--config PATH         Saved nightly-update configuration
--scheduled           Skip an already completed scheduled run
--strict              Explicit diagnostic-only reconciled leaderboard
--audit               Include diagnostics in a wallet report
--no-combine-wallets   Use independent daily wallet requests for comparison
--refresh             Recheck published days, including late redemption/corrections
--keep-raw            Keep compressed API checkpoint pages after publication
--min-free-gib 5       Minimum remaining disk space
--project-days 122     Days to extrapolate from measured fresh sync reports
--wallet 0x...         Wallet report address
--limit 100           Leaderboard or activity row limit
--sql QUERY           SQL over markets, trades, activities, positions,
                      wallet_markets, wallet_months, coverage
--sql-file PATH       Read SQL from a file

Update catches up missing days and refreshes the last seven complete UTC days.
Queries read local Parquet only; normal rankings include all observed wallets.
No trading credentials needed.`)
    return
  }
  const config = values.config ? await readUpdateConfig(path.resolve(values.config)) : undefined
  const rootValue = values.root ?? config?.root ?? process.env.POLYMARKET_RESEARCH_DATA_DIR
  if (!rootValue)
    throw new Error(
      'Set --root or POLYMARKET_RESEARCH_DATA_DIR to a permanent directory outside disposable worktrees',
    )
  const root = path.resolve(rootValue)
  const family = marketFamily(config?.market ?? values.market)
  const integer = (raw: string, name: string, min: number, max: number) => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`--${name} must be an integer between ${min} and ${max}`)
    return n
  }
  const to = values.to ?? new Date().toISOString().slice(0, 10)
  const from = values.from ?? config?.from
  if (command !== 'sql' && command !== 'status' && !from) throw new Error('--from is required')
  let output: unknown
  switch (command) {
    case 'status':
      output = (await readJson(path.join(root, 'update-state.json'))) ?? { status: 'not_run' }
      break
    case 'update':
      if (values.to)
        throw new Error('update always ends at today; use sync for an explicit --to range')
      try {
        output = await updateDataset({
          root,
          from: from!,
          market: family.id,
          concurrency: config?.concurrency ?? integer(values.concurrency, 'concurrency', 1, 24),
          requestsPerSecond: config?.requestsPerSecond ?? integer(values.rps, 'rps', 1, 60),
          minFreeGiB:
            config?.minFreeGiB ?? integer(values['min-free-gib'], 'min-free-gib', 1, 1000),
          scheduled: values.scheduled,
          combineWallets: !values['no-combine-wallets'],
        })
      } catch (error) {
        if (values.scheduled && error instanceof SyncBusyError)
          output = { status: 'already_running', message: error.message }
        else throw error
      }
      break
    case 'sync':
      output = await syncDataset({
        root,
        market: family.id,
        from: from!,
        to,
        concurrency: integer(values.concurrency, 'concurrency', 1, 24),
        requestsPerSecond: integer(values.rps, 'rps', 1, 60),
        minFreeGiB: integer(values['min-free-gib'], 'min-free-gib', 1, 1000),
        refresh: values.refresh,
        keepRaw: values['keep-raw'],
      })
      break
    case 'rebuild':
      output = await rebuildDataset(
        root,
        from!,
        to,
        integer(values['min-free-gib'], 'min-free-gib', 1, 1000),
      )
      break
    case 'verify': {
      const result = await verifyDataset(root, from!, to)
      output = result
      if (!result.valid) process.exitCode = 1
      break
    }
    case 'coverage':
      output = await coverageReport(root, from!, to)
      break
    case 'benchmark':
      output = await benchmarkDataset(
        root,
        from!,
        to,
        integer(values['project-days'], 'project-days', 1, 10000),
      )
      break
    case 'leaderboard':
      output = await (values.strict ? strictLeaderboard : leaderboard)(
        root,
        from!,
        to,
        integer(values.limit, 'limit', 1, 10000),
      )
      break
    case 'wallet':
      if (!values.wallet) throw new Error('--wallet is required')
      output = await walletReport(
        root,
        values.wallet,
        from!,
        to,
        integer(values.limit, 'limit', 1, 10000),
        values.audit,
      )
      break
    case 'sql': {
      const sql =
        values.sql ?? (values['sql-file'] ? await readFile(values['sql-file'], 'utf8') : null)
      if (!sql) throw new Error('--sql or --sql-file is required')
      output = await querySql(root, sql)
      break
    }
    default:
      throw new Error(`Unknown research command: ${command}`)
  }
  console.log(JSON.stringify(output, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`[research] ${String(error)}`)
    process.exitCode = 1
  })
}
