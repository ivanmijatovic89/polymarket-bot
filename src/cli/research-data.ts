import { parseArgs } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { coverageReport, leaderboard, querySql, walletReport } from '../research-data/query.js'
import { rebuildDataset } from '../research-data/rebuild.js'
import { verifyDataset } from '../research-data/verify.js'
import { benchmarkDataset } from '../research-data/benchmark.js'
import { syncDataset } from '../research-data/sync.js'

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0]
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      root: { type: 'string' },
      market: { type: 'string', default: 'btc:15m' },
      from: { type: 'string' },
      to: { type: 'string' },
      concurrency: { type: 'string', default: '12' },
      rps: { type: 'string', default: '32' },
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

Commands: sync, rebuild, verify, benchmark, coverage, leaderboard, wallet, sql
--root PATH           Permanent data directory (or POLYMARKET_RESEARCH_DATA_DIR)
--market btc:15m       Only supported market family
--from YYYY-MM-DD      UTC market-window start, inclusive
--to YYYY-MM-DD        UTC market-window start, exclusive (default: today)
--concurrency 12        Concurrent work queues
--rps 32              Shared request budget (1–60/second; endpoint caps also apply)
--refresh             Recheck published days, including late redemption/corrections
--keep-raw            Keep compressed API checkpoint pages after publication
--min-free-gib 5       Minimum remaining disk space
--project-days 122     Days to extrapolate from measured fresh sync reports
--wallet 0x...         Wallet report address
--limit 100           Leaderboard or activity row limit
--sql QUERY           SQL over markets, trades, activities, positions,
                      wallet_markets, wallet_months, coverage
--sql-file PATH       Read SQL from a file

Queries read local Parquet only. Incomplete wallet results are excluded from
strict rankings and counted in the coverage summary. No trading credentials needed.`)
    return
  }
  const rootValue = values.root ?? process.env.POLYMARKET_RESEARCH_DATA_DIR
  if (!rootValue)
    throw new Error(
      'Set --root or POLYMARKET_RESEARCH_DATA_DIR to a permanent directory outside disposable worktrees',
    )
  const root = path.resolve(rootValue)
  if (values.market !== 'btc:15m') throw new Error('Only --market btc:15m is supported')
  const integer = (raw: string, name: string, min: number, max: number) => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`--${name} must be an integer between ${min} and ${max}`)
    return n
  }
  const to = values.to ?? new Date().toISOString().slice(0, 10)
  const from = values.from
  if (command !== 'sql' && !from) throw new Error('--from is required')
  let output: unknown
  switch (command) {
    case 'sync':
      output = await syncDataset({
        root,
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
      output = await leaderboard(root, from!, to, integer(values.limit, 'limit', 1, 10000))
      break
    case 'wallet':
      if (!values.wallet) throw new Error('--wallet is required')
      output = await walletReport(
        root,
        values.wallet,
        from!,
        to,
        integer(values.limit, 'limit', 1, 10000),
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
