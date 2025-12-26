function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

function parseSourceValue(raw: string | undefined): 'local' | 'azure' {
  if (raw === 'local' || raw === 'azure') return raw
  return 'local'
}

export type BacktestArgs = {
  filePaths: string[]
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  source: 'local' | 'azure'
  azureContainer: string
}

export function parseArgs(argv: string[]): BacktestArgs {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false
  let source: 'local' | 'azure' = 'local'
  let azureContainer = process.env.AZURE_STORAGE_CONTAINER ?? 'markets-parquet'

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

      case '--source':
        source = parseSourceValue(argv[i + 1])
        i += 1
        break

      case '--azure-container':
        azureContainer = argv[i + 1] ?? azureContainer
        i += 1
        break

      case '--strategy':
      case '--param':
        i += 1
        break

      default:
        if (arg.startsWith('--source=')) {
          source = parseSourceValue(arg.slice('--source='.length))
          break
        }
        if (arg.startsWith('--azure-container=')) {
          azureContainer = arg.slice('--azure-container='.length) || azureContainer
          break
        }
        if (
          arg.startsWith('--strategy=') ||
          arg.startsWith('--param=') ||
          arg.startsWith('-')
        ) {
          break
        }
        filePaths.push(arg)
    }
  }

  return { filePaths, order, timeDriven, source, azureContainer }
}
