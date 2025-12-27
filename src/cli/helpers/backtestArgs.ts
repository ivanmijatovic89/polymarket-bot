function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

export type BacktestArgs = {
  filePaths: string[]
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
}

export function parseArgs(argv: string[]): BacktestArgs {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false

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

  return { filePaths, order, timeDriven }
}
