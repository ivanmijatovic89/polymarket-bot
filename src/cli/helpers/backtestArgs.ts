function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

const INPUT_MODES = ['recorded', 'telonex-paired-parquet', 'telonex-delta-parquet'] as const

type InputMode = (typeof INPUT_MODES)[number]

function parseInputMode(raw: string | undefined): InputMode {
  if (raw === 'recorded' || raw === 'telonex-paired-parquet' || raw === 'telonex-delta-parquet') {
    return raw
  }
  throw new Error(
    `[backtest] --input-mode must be one of: ${INPUT_MODES.join(', ')} (got: ${String(raw)})`,
  )
}

export type BacktestArgs = {
  filePaths: string[]
  dirs?: string[]
  // recorded:
  //   Replays source WS events and runs strategy on each meaningful event tick.
  // telonex-paired-parquet:
  //   Replays paired up/down snapshots and runs strategy once per paired frame.
  //   Merge step may carry forward the missing side from the last known snapshot.
  // telonex-delta-parquet:
  //   Replays typed book/price_change rows and runs strategy on each row.
  inputMode: InputMode
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  slugs?: string[]
  symbol?: string
  limit?: number
  random?: boolean
  latest?: boolean
  comment?: string
  batchUid?: string
  baselineId?: string
}

export function parseArgs(argv: string[]): BacktestArgs {
  const filePaths: string[] = []
  const dirs: string[] = []
  const slugs: string[] = []
  let inputMode: InputMode = 'recorded'
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let orderExplicit = false
  let timeDriven = false
  let symbol: string | undefined
  let limit: number | undefined
  let random = false
  let latest = false
  let comment: string | undefined
  let batchUid: string | undefined
  let baselineId: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue

    switch (arg) {
      case '--mode': {
        // Legacy/compat: ignore `--mode orderbook` if passed.
        // Raw mode was removed; this flag should not affect behavior.
        i += 1
        break
      }

      case '--order':
        order = parseOrderValue(argv[i + 1])
        orderExplicit = true
        i += 1
        break
      case '--input-mode': {
        inputMode = parseInputMode(argv[i + 1])
        i += 1
        break
      }
      case '--time-driven':
      case '--realtime':
        timeDriven = true
        break

      case '--symbol':
        symbol = argv[i + 1]
        i += 1
        break

      case '--slug': {
        const raw = argv[i + 1]
        if (typeof raw !== 'string') {
          throw new Error('[backtest] missing value for --slug')
        }
        const parts = raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        if (parts.length === 0) {
          throw new Error('[backtest] --slug must be a non-empty string')
        }
        slugs.push(...parts)
        i += 1
        break
      }
      case '--dir': {
        const raw = argv[i + 1]
        if (typeof raw !== 'string' || raw.trim().length === 0) {
          throw new Error('[backtest] missing value for --dir')
        }
        dirs.push(raw.trim())
        i += 1
        break
      }

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

      case '--comment':
        if (typeof argv[i + 1] !== 'string') {
          throw new Error('[backtest] missing value for --comment')
        }
        comment = argv[i + 1]
        i += 1
        break

      case '--batchUid':
        if (typeof argv[i + 1] !== 'string') {
          throw new Error('[backtest] missing value for --batchUid')
        }
        batchUid = argv[i + 1]
        i += 1
        break

      case '--baselineId':
        if (typeof argv[i + 1] !== 'string') {
          throw new Error('[backtest] missing value for --baselineId')
        }
        baselineId = argv[i + 1]
        i += 1
        break

      case '--strategy':
      case '--param':
        i += 1
        break

      default:
        if (arg.startsWith('--comment=')) {
          comment = arg.slice('--comment='.length)
          break
        }
        if (arg.startsWith('--batchUid=')) {
          batchUid = arg.slice('--batchUid='.length)
          break
        }
        if (arg.startsWith('--baselineId=')) {
          baselineId = arg.slice('--baselineId='.length)
          break
        }
        if (arg.startsWith('--slug=')) {
          const raw = arg.slice('--slug='.length)
          const parts = raw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
          if (parts.length === 0) {
            throw new Error('[backtest] --slug must be a non-empty string')
          }
          slugs.push(...parts)
          break
        }
        if (arg.startsWith('--dir=')) {
          const raw = arg.slice('--dir='.length).trim()
          if (raw.length === 0) {
            throw new Error('[backtest] missing value for --dir')
          }
          dirs.push(raw)
          break
        }
        if (arg.startsWith('--input-mode=')) {
          inputMode = parseInputMode(arg.slice('--input-mode='.length))
          break
        }
        if (arg.startsWith('--strategy=') || arg.startsWith('--param=') || arg.startsWith('-')) {
          break
        }
        filePaths.push(arg)
    }
  }

  if (random && limit === undefined) {
    throw new Error(
      '[backtest] --random requires --limit N (how many random parquet files to sample)',
    )
  }

  if (latest && limit === undefined) {
    throw new Error('[backtest] --latest requires --limit N (how many latest markets to fetch)')
  }

  if (slugs.length > 0 && symbol) {
    throw new Error('[backtest] --slug and --symbol are mutually exclusive')
  }

  if (dirs.length > 0 && symbol) {
    throw new Error('[backtest] --dir and --symbol are mutually exclusive')
  }

  if (dirs.length > 0 && slugs.length > 0) {
    throw new Error('[backtest] --dir and --slug are mutually exclusive')
  }
  if (
    inputMode !== 'recorded' &&
    (symbol ||
      slugs.length > 0 ||
      dirs.length > 0 ||
      limit !== undefined ||
      random ||
      latest ||
      orderExplicit ||
      timeDriven)
  ) {
    throw new Error(
      `[backtest] --input-mode=${inputMode} cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven`,
    )
  }
  if (inputMode !== 'recorded' && filePaths.length === 0) {
    throw new Error(`[backtest] --input-mode=${inputMode} requires at least one parquet file`)
  }

  return {
    filePaths,
    ...(dirs.length > 0 ? { dirs } : {}),
    inputMode,
    order,
    timeDriven,
    ...(slugs.length > 0 ? { slugs } : {}),
    ...(symbol ? { symbol } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(random ? { random } : {}),
    ...(latest ? { latest } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(batchUid !== undefined ? { batchUid } : {}),
    ...(baselineId !== undefined ? { baselineId } : {}),
  }
}
