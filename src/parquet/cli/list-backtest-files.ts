import fs from 'node:fs/promises'
import path from 'node:path'

type Args = {
  symbol: string
  root: string
  limit?: number
}

function parseArgs(argv: string[]): Args | null {
  let symbol: string | undefined
  let root = 'data/events'
  let limit: number | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--symbol' || a === '-s') {
      symbol = argv[i + 1]
      i += 1
      continue
    }

    if (a === '--root') {
      root = argv[i + 1] ?? root
      i += 1
      continue
    }

    if (a === '--limit' || a === '-l') {
      const raw = argv[i + 1]
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
      limit = n
      i += 1
      continue
    }

    if (a === '--help' || a === '-h') return null

    // Positional: first positional is symbol.
    if (!a.startsWith('-') && !symbol) {
      symbol = a
      continue
    }
  }

  if (!symbol) return null
  return { symbol, root, ...(typeof limit === 'number' ? { limit } : {}) }
}

function epochFromFilename(fileName: string): number | null {
  // Example: btc-updown-15m-1766523600.parquet
  const m = fileName.match(/(\d+)\.parquet$/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return n
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error(
      'Usage:\n' +
        '  tsx src/parquet/cli/list-backtest-files.ts --symbol <btc|eth|sol|...> [--root data/events] [--limit N]\n' +
        'Examples:\n' +
        '  tsx src/parquet/cli/list-backtest-files.ts --symbol btc\n' +
        '  tsx src/parquet/cli/list-backtest-files.ts --symbol btc --limit 10\n' +
        '  npm run -s list:backtest-files -- --symbol btc',
    )
    process.exit(2)
  }

  const symbol = parsed.symbol.toLowerCase()
  const rootRel = parsed.root
  const limit = parsed.limit
  const dirAbs = path.resolve(process.cwd(), rootRel, symbol)

  let entries: Array<{ name: string; isFile: boolean }>
  try {
    const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
    entries = dirents.map((d) => ({ name: d.name, isFile: d.isFile() }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[list-backtest-files] failed to read "${dirAbs}": ${msg}`)
    process.exit(2)
  }

  const files = entries.filter((e) => e.isFile && e.name.endsWith('.parquet')).map((e) => e.name)

  if (files.length === 0) {
    console.error(`[list-backtest-files] no .parquet files found in "${dirAbs}"`)
    process.exit(2)
  }

  files.sort((a, b) => {
    const ea = epochFromFilename(a)
    const eb = epochFromFilename(b)
    if (ea !== null && eb !== null && ea !== eb) return ea - eb
    return a.localeCompare(b)
  })

  const limitedFiles = typeof limit === 'number' ? files.slice(0, limit) : files

  // Print in the exact format expected by `npm run backtest -- <file1> <file2> ...`
  // Prefer forward slashes to keep it copy/paste friendly.
  const rootPosix = rootRel.split(path.sep).join(path.posix.sep)
  const out = limitedFiles.map((f) => path.posix.join(rootPosix, symbol, f)).join(' ')
  process.stdout.write(`${out}\n`)
}

await main()
