function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

export type BacktestArgs = {
  filePaths: string[]
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  symbol?: string
  limit?: number
  random?: boolean
  latest?: boolean
}

export function parseArgs(argv: string[]): BacktestArgs {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false
  let symbol: string | undefined
  let limit: number | undefined
  let random = false
  let latest = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue

    switch (arg) {
      case '--mode': {
        const val = argv[i + 1]
        if (val !== 'orderbook') {
          throw new Error(
            `[backtest] unsupported --mode ${String(val)} (raw mode removed; omit --mode or use --mode orderbook)`,
          )
        }
        i += 1
        break
      }

      case '--order':
        order = parseOrderValue(argv[i + 1])
        i += 1
        break

      case '--time-driven':
      case '--realtime':
        timeDriven = true
        break

      case '--symbol':
        symbol = argv[i + 1]
        i += 1
        break

      case '--limit': {
        const raw = argv[i + 1]
        const n = raw ? Number(raw) : NaN
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          throw new Error(`[backtest] --limit must be a positive integer, got: ${String(raw)}`)
        }
        limit = n
        i += 1
        break
      }

      case '--random':
        random = true
        latest = false // random takes precedence over latest
        break

      case '--latest':
        latest = true
        random = false // latest takes precedence over random
        break

      case '--strategy':
      case '--param':
        i += 1
        break

      default:
        if (arg.startsWith('--strategy=') || arg.startsWith('--param=') || arg.startsWith('-')) {
          break
        }
        filePaths.push(arg)
    }
  }

  if (random && limit === undefined) {
    throw new Error('[backtest] --random requires --limit N (how many random parquet files to sample)')
  }

  if (latest && limit === undefined) {
    throw new Error('[backtest] --latest requires --limit N (how many latest markets to fetch)')
  }

  return {
    filePaths,
    order,
    timeDriven,
    ...(symbol ? { symbol } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(random ? { random } : {}),
    ...(latest ? { latest } : {}),
  }
}
