import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { argv, exit } from 'node:process'

type CliArgs = {
  folder?: string
  filter?: string
  help: boolean
}

type FilterOp = '>' | '<' | '>=' | '<=' | '==' | '!='
type Filter = {
  field: string
  op: FilterOp
  value: number
}

type TradeFeatureRow = Record<string, unknown> & {
  pnl?: number
}

const REQUIRED_FILES = [
  'ALL_trades_features.json',
  'SEARCH_trades_features.json',
  'TEST_trades_features.json',
]

function parseCliArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { help: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
    } else if (arg === '--filter' && args[i + 1]) {
      const next = args[++i]
      if (next) parsed.filter = next
    } else if (!parsed.folder) {
      if (arg) parsed.folder = arg
    } else if (!parsed.filter) {
      if (arg) parsed.filter = arg
    }
  }

  return parsed
}

function printHelp(): void {
  console.log(`
Usage: npx tsx src/cli/research/research-gate-on-backtests.ts <folder> [filter]

Description:
  Sums "pnl" for ALL/SEARCH/TEST_trade_features.json in a folder.
  Optionally applies filter(s) and re-sums "pnl".

Filter format:
  field>number
  field< number
  field>=number
  field<=number
  field==number
  field!=number
  Vise filtera se spaja sa &: netChange_45s>0.05&highLowRange_20s<20

Important (shell quoting):
  Use quotes if you have > or < so the shell doesn't treat it as redirection.

Examples:
  npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240
  npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 "netChange_45s>0.05"
  npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 "netChange_45s>0.05&highLowRange_20s<20"
  npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 --filter "netChange_45s>0.05&highLowRange_20s<20"
`)
}

function parseFilters(filterRaw?: string): Filter[] {
  if (!filterRaw) return []

  const parts = filterRaw.split('&').map((part) => part.trim()).filter(Boolean)
  const ops: FilterOp[] = ['>=', '<=', '!=', '==', '>', '<']
  const filters: Filter[] = []

  for (const part of parts) {
    let matched = false
    for (const op of ops) {
      const idx = part.indexOf(op)
      if (idx <= 0) continue
      const field = part.slice(0, idx).trim()
      const rawValue = part.slice(idx + op.length).trim()
      const value = Number.parseFloat(rawValue)
      if (!field || !Number.isFinite(value)) {
        throw new Error(`[research-gate] Invalid filter: "${part}"`)
      }
      filters.push({ field, op, value })
      matched = true
      break
    }
    if (!matched && part.includes('=')) {
      const idx = part.indexOf('=')
      const field = part.slice(0, idx).trim()
      const rawValue = part.slice(idx + 1).trim()
      const value = Number.parseFloat(rawValue)
      if (!field || !Number.isFinite(value)) {
        throw new Error(`[research-gate] Invalid filter: "${part}"`)
      }
      filters.push({ field, op: '==', value })
      matched = true
    }
    if (!matched) {
      throw new Error(
        `[research-gate] Invalid filter: "${part}". If you use > or <, wrap the filter in quotes.`
      )
    }
  }

  return filters
}

function matchesFilters(row: TradeFeatureRow, filters: Filter[]): boolean {
  if (filters.length === 0) return true

  for (const filter of filters) {
    const raw = row[filter.field]
    const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
    if (!Number.isFinite(value)) return false

    switch (filter.op) {
      case '>':
        if (!(value > filter.value)) return false
        break
      case '<':
        if (!(value < filter.value)) return false
        break
      case '>=':
        if (!(value >= filter.value)) return false
        break
      case '<=':
        if (!(value <= filter.value)) return false
        break
      case '==':
        if (!(value === filter.value)) return false
        break
      case '!=':
        if (!(value !== filter.value)) return false
        break
    }
  }

  return true
}

async function ensureFilesExist(folder: string): Promise<string[]> {
  const missing: string[] = []
  for (const filename of REQUIRED_FILES) {
    const fullPath = path.join(folder, filename)
    try {
      await access(fullPath)
    } catch {
      missing.push(filename)
    }
  }
  return missing
}

async function readJsonArray(filePath: string): Promise<TradeFeatureRow[]> {
  const raw = await readFile(filePath, { encoding: 'utf8' })
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error(`[research-gate] Expected a JSON array in: ${filePath}`)
  }
  return parsed as TradeFeatureRow[]
}

function sumPnl(rows: TradeFeatureRow[]): number {
  let total = 0
  for (const row of rows) {
    const pnl = row.pnl
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      total += pnl
    }
  }
  return total
}

async function run(): Promise<void> {
  const args = parseCliArgs(argv.slice(2))

  if (args.help || !args.folder) {
    printHelp()
    if (!args.folder) exit(1)
    return
  }

  const folder = path.resolve(process.cwd(), args.folder)
  const filters = parseFilters(args.filter)
  const missing = await ensureFilesExist(folder)

  if (missing.length > 0) {
    console.error(
      `[research-gate] Missing files in folder ${folder}: ${missing.join(', ')}`
    )
    exit(1)
  }

  const results = []

  for (const filename of REQUIRED_FILES) {
    const filePath = path.join(folder, filename)
    const rows = await readJsonArray(filePath)
    const filteredRows = rows.filter((row) => matchesFilters(row, filters))
    const totalPnl = sumPnl(rows)
    const filteredPnl = sumPnl(filteredRows)

    results.push({
      file: filename,
      'count (no gate)': rows.length,
      'pnl (no gate)': Number(totalPnl.toFixed(2)),
      'count (gate skipped)': filteredRows.length,
      'pnl (gate skipped)': Number(filteredPnl.toFixed(2)),
      'count (with gate)': rows.length - filteredRows.length,
      'pnl (with gate)': Number((totalPnl - filteredPnl).toFixed(2)),
    })
  }

  console.table(results)
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  exit(1)
})
