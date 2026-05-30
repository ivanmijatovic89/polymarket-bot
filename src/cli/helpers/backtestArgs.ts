function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

const INPUT_MODES = ['recorded', 'telonex-delta', 'telonex-paired'] as const

type InputMode = (typeof INPUT_MODES)[number]

function parseInputMode(raw: string | undefined): InputMode {
  if (raw === 'recorded' || raw === 'telonex-delta' || raw === 'telonex-paired') {
    return raw
  }
  throw new Error(
    `[backtest] --input-mode must be one of: ${INPUT_MODES.join(', ')} (got: ${String(raw)})`,
  )
}

const READ_FROM_VALUES = ['local', 'r2'] as const
type ReadFrom = (typeof READ_FROM_VALUES)[number]

function parseReadFrom(raw: string | undefined): ReadFrom {
  if (raw === 'local' || raw === 'r2') return raw
  throw new Error(
    `[backtest] --read-from must be one of: ${READ_FROM_VALUES.join(', ')} (got: ${String(raw)})`,
  )
}

export type BacktestArgs = {
  filePaths: string[]
  dirs?: string[]
  // recorded:
  //   Replays source WS events and runs strategy on each meaningful event tick.
  //   Reads from the `markets` table.
  // telonex-paired:
  //   Replays paired up/down snapshots and runs strategy once per paired frame.
  //   Reads from `telonex_markets` ⋈ `telonex_market_conversions` (converter='paired').
  // telonex-delta:
  //   Replays typed book/price_change rows and runs strategy on each row.
  //   Reads from `telonex_markets` ⋈ `telonex_market_conversions` (converter='delta-typed').
  inputMode: InputMode
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  slugs?: string[]
  symbol?: string
  timeframe: string
  readFrom?: ReadFrom
  limit?: number
  random?: boolean
  latest?: boolean
  comment?: string
  batchUid?: string
  baselineId?: string
  /**
   * Run the batch in-process (single thread), bypassing BullMQ / Redis / workers.
   * Useful for quick local smoke tests and bit-identical verification.
   * Default: false (use BullMQ FlowProducer + workers).
   */
  sequential?: boolean
  /**
   * Enqueue the flow and return immediately, printing the batchUid.
   * The aggregator worker will finalize the batch and write to MySQL.
   * Only meaningful when not running --sequential.
   */
  detach?: boolean
  /**
   * If a flow with this batchUid already exists in Redis (e.g. a previous
   * run with the same --batchUid finished and left its parent job behind),
   * remove the old parent + children before enqueueing a new flow. Without
   * this flag the producer errors out so a "rerun" doesn't silently return
   * the cached result from the first run.
   */
  forceRerun?: boolean
}

export function parseArgs(argv: string[]): BacktestArgs {
  const filePaths: string[] = []
  const dirs: string[] = []
  const slugs: string[] = []
  let inputMode: InputMode = 'recorded'
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false
  let symbol: string | undefined
  let timeframe = '15m'
  let timeframeExplicit = false
  let readFrom: ReadFrom | undefined
  let limit: number | undefined
  let random = false
  let latest = false
  let comment: string | undefined
  let batchUid: string | undefined
  let baselineId: string | undefined
  let sequential = false
  let detach = false
  let forceRerun = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue

    switch (arg) {
      case '--mode': {
        // Legacy/compat: ignore `--mode orderbook` if passed.
        i += 1
        break
      }

      case '--order':
        order = parseOrderValue(argv[i + 1])
        i += 1
        break
      case '--input-mode': {
        inputMode = parseInputMode(argv[i + 1])
        i += 1
        break
      }
      case '--read-from': {
        readFrom = parseReadFrom(argv[i + 1])
        i += 1
        break
      }
      case '--timeframe': {
        const raw = argv[i + 1]
        if (typeof raw !== 'string' || raw.trim().length === 0) {
          throw new Error('[backtest] missing value for --timeframe')
        }
        timeframe = raw.trim()
        timeframeExplicit = true
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
        latest = false
        break

      case '--latest':
        latest = true
        random = false
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

      case '--sequential':
        sequential = true
        break

      case '--detach':
        detach = true
        break

      case '--force-rerun':
        forceRerun = true
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
        if (arg.startsWith('--read-from=')) {
          readFrom = parseReadFrom(arg.slice('--read-from='.length))
          break
        }
        if (arg.startsWith('--timeframe=')) {
          const raw = arg.slice('--timeframe='.length).trim()
          if (raw.length === 0) {
            throw new Error('[backtest] missing value for --timeframe')
          }
          timeframe = raw
          timeframeExplicit = true
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

  const isTelonex = inputMode !== 'recorded'

  if (isTelonex && readFrom === undefined) {
    throw new Error(`[backtest] --input-mode=${inputMode} requires --read-from (local|r2)`)
  }
  if (!isTelonex && readFrom !== undefined) {
    throw new Error(
      `[backtest] --read-from is only valid with --input-mode=telonex-delta|telonex-paired`,
    )
  }

  if (timeframeExplicit && !symbol) {
    throw new Error('[backtest] --timeframe is only valid together with --symbol')
  }

  return {
    filePaths,
    ...(dirs.length > 0 ? { dirs } : {}),
    inputMode,
    order,
    timeDriven,
    ...(slugs.length > 0 ? { slugs } : {}),
    ...(symbol ? { symbol } : {}),
    timeframe,
    ...(readFrom ? { readFrom } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(random ? { random } : {}),
    ...(latest ? { latest } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(batchUid !== undefined ? { batchUid } : {}),
    ...(baselineId !== undefined ? { baselineId } : {}),
    ...(sequential ? { sequential } : {}),
    ...(detach ? { detach } : {}),
    ...(forceRerun ? { forceRerun } : {}),
  }
}
