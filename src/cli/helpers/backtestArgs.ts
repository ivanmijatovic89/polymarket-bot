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

// `local-or-download-from-r2-to-local`: read the converted parquet from its canonical local path if
// present, otherwise download it from R2 to that path (download-if-missing) and
// read locally. For the DB eligibility query it behaves like `r2` (gates on
// r2_url); the per-market local fetch happens in the worker.
const READ_FROM_VALUES = ['local', 'r2', 'local-or-download-from-r2-to-local'] as const
type ReadFrom = (typeof READ_FROM_VALUES)[number]

function parseReadFrom(raw: string | undefined): ReadFrom {
  if (raw === 'local' || raw === 'r2' || raw === 'local-or-download-from-r2-to-local') return raw
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
  /** Research system that launched the run (for example, strategy-research-protocol). */
  protocol?: string
  /** Model id or alias requested by the launcher (for example, claude-fable-5). */
  model?: string
  /**
   * Explicit simulated latency (ms). Overrides BACKTEST_LATENCY_DELAY. Unlike
   * the env var, a flag lands in the recorded `cmd`, making the run's latency
   * auditable.
   */
  latencyDelayMs?: number
  /** Explicit latency jitter (ms). Overrides BACKTEST_LATENCY_JITTER; auditable via `cmd`. */
  latencyJitterMs?: number
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
   * Extension target — when set, this invocation extends an existing telonex
   * run rather than creating a new one. Strategy / params / symbol /
   * timeframe / input-mode / read-from are inherited from the parent run;
   * the rest of the selection flags (--limit, --latest, --random, --from-ms,
   * --to-ms) apply to the *missing* slug set rather than the full eligible
   * universe.
   */
  extend?: number
  /**
   * Optional inclusive lower bound on `market_start_ms`. Works with or
   * without --extend.
   */
  fromMs?: number
  /**
   * Optional inclusive upper bound on `market_start_ms`. Works with or
   * without --extend.
   */
  toMs?: number
}

function parsePositiveInt(raw: string | undefined, flag: string): number {
  const n = raw !== undefined ? Number(raw) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`[backtest] ${flag} must be a positive integer, got: ${String(raw)}`)
  }
  return n
}

function parseNonNegativeMs(raw: string | undefined, flag: string): number {
  const n = raw !== undefined ? Number(raw) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(
      `[backtest] ${flag} must be a non-negative integer (milliseconds), got: ${String(raw)}`,
    )
  }
  return n
}

function parseNonNegativeBigIntMs(raw: string | undefined, flag: string): number {
  const n = raw !== undefined ? Number(raw) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(
      `[backtest] ${flag} must be a non-negative integer (epoch ms), got: ${String(raw)}`,
    )
  }
  return n
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
  let protocol: string | undefined
  let model: string | undefined
  let latencyDelayMs: number | undefined
  let latencyJitterMs: number | undefined
  let sequential = false
  let detach = false
  let extend: number | undefined
  let fromMs: number | undefined
  let toMs: number | undefined

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

      case '--protocol':
        if (typeof argv[i + 1] !== 'string' || argv[i + 1]!.trim().length === 0) {
          throw new Error('[backtest] missing value for --protocol')
        }
        protocol = argv[i + 1]!.trim()
        i += 1
        break

      case '--model':
        if (typeof argv[i + 1] !== 'string' || argv[i + 1]!.trim().length === 0) {
          throw new Error('[backtest] missing value for --model')
        }
        model = argv[i + 1]!.trim()
        i += 1
        break

      case '--latency-delay-ms':
        latencyDelayMs = parseNonNegativeMs(argv[i + 1], '--latency-delay-ms')
        i += 1
        break

      case '--latency-jitter-ms':
        latencyJitterMs = parseNonNegativeMs(argv[i + 1], '--latency-jitter-ms')
        i += 1
        break

      case '--sequential':
        sequential = true
        break

      case '--detach':
        detach = true
        break

      case '--extend':
        extend = parsePositiveInt(argv[i + 1], '--extend')
        i += 1
        break

      case '--from-ms':
        fromMs = parseNonNegativeBigIntMs(argv[i + 1], '--from-ms')
        i += 1
        break

      case '--to-ms':
        toMs = parseNonNegativeBigIntMs(argv[i + 1], '--to-ms')
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
        if (arg.startsWith('--protocol=')) {
          protocol = arg.slice('--protocol='.length).trim()
          if (protocol.length === 0) throw new Error('[backtest] missing value for --protocol')
          break
        }
        if (arg.startsWith('--model=')) {
          model = arg.slice('--model='.length).trim()
          if (model.length === 0) throw new Error('[backtest] missing value for --model')
          break
        }
        if (arg.startsWith('--latency-delay-ms=')) {
          latencyDelayMs = parseNonNegativeMs(
            arg.slice('--latency-delay-ms='.length),
            '--latency-delay-ms',
          )
          break
        }
        if (arg.startsWith('--latency-jitter-ms=')) {
          latencyJitterMs = parseNonNegativeMs(
            arg.slice('--latency-jitter-ms='.length),
            '--latency-jitter-ms',
          )
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
        if (arg.startsWith('--extend=')) {
          extend = parsePositiveInt(arg.slice('--extend='.length), '--extend')
          break
        }
        if (arg.startsWith('--from-ms=')) {
          fromMs = parseNonNegativeBigIntMs(arg.slice('--from-ms='.length), '--from-ms')
          break
        }
        if (arg.startsWith('--to-ms=')) {
          toMs = parseNonNegativeBigIntMs(arg.slice('--to-ms='.length), '--to-ms')
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

  if (extend !== undefined) {
    // Strategy / params / symbol / timeframe / input-mode / read-from are
    // inherited from the parent run. Any user-supplied value would either
    // contradict the inheritance or rebuild the eligibility universe in a
    // way that breaks extension semantics. Fail loudly so the user knows
    // exactly which flag to drop.
    const conflicting: string[] = []
    if (symbol) conflicting.push('--symbol')
    if (timeframeExplicit) conflicting.push('--timeframe')
    // Check flag presence in argv, not the parsed value: the default
    // inputMode is 'recorded', so a user who explicitly passes
    // `--input-mode recorded` against a telonex parent would silently slip
    // through a value-based check and then get overridden to the parent's
    // mode at planExtension time with no warning.
    const inputModeFlagPresent = argv.some(
      (t) => t === '--input-mode' || (typeof t === 'string' && t.startsWith('--input-mode=')),
    )
    if (inputModeFlagPresent) conflicting.push('--input-mode')
    if (readFrom !== undefined) conflicting.push('--read-from')
    if (slugs.length > 0) conflicting.push('--slug')
    if (dirs.length > 0) conflicting.push('--dir')
    if (filePaths.length > 0) conflicting.push('<positional file path>')
    if (batchUid !== undefined) conflicting.push('--batchUid')
    if (baselineId !== undefined) conflicting.push('--baselineId')
    if (protocol !== undefined) conflicting.push('--protocol')
    if (model !== undefined) conflicting.push('--model')
    // Extension jobs must replay with the same simulated latency as the
    // parent run (whose cmd records it); an explicit override would silently
    // mix latencies inside one run.
    if (latencyDelayMs !== undefined) conflicting.push('--latency-delay-ms')
    if (latencyJitterMs !== undefined) conflicting.push('--latency-jitter-ms')
    // --comment is a launch-time label for the original run. An extension
    // doesn't get its own comment because we intentionally don't write
    // per-extend audit metadata (cmd, comment) to backtest_runs — the
    // original launch's comment stays.
    if (comment !== undefined) conflicting.push('--comment')
    // --strategy / --param aren't surfaced in BacktestArgs but appear in
    // argv; check raw tokens.
    for (const token of argv) {
      if (token === '--strategy' || token?.startsWith('--strategy=')) {
        conflicting.push('--strategy')
        break
      }
    }
    for (const token of argv) {
      if (token === '--param' || token?.startsWith('--param=')) {
        conflicting.push('--param')
        break
      }
    }
    if (conflicting.length > 0) {
      const unique = [...new Set(conflicting)]
      throw new Error(
        `[backtest] --extend ${extend} cannot be combined with: ${unique.join(', ')}. ` +
          `These are inherited from the parent run.`,
      )
    }
  }

  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    throw new Error(
      `[backtest] --from-ms (${fromMs}) must be less than or equal to --to-ms (${toMs})`,
    )
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
    ...(protocol !== undefined ? { protocol } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(latencyDelayMs !== undefined ? { latencyDelayMs } : {}),
    ...(latencyJitterMs !== undefined ? { latencyJitterMs } : {}),
    ...(sequential ? { sequential } : {}),
    ...(detach ? { detach } : {}),
    ...(extend !== undefined ? { extend } : {}),
    ...(fromMs !== undefined ? { fromMs } : {}),
    ...(toMs !== undefined ? { toMs } : {}),
  }
}

/**
 * Recover explicit latency flags from a recorded launch command. Extensions
 * use this to replay with the parent run's simulated latency (P-001): the
 * flags are the only durable record — env vars never reach `cmd`. Returns
 * only the flags that are actually present; absent flags stay undefined so
 * the caller can warn and fall back.
 */
export function parseLatencyFlagsFromCmd(cmd: string | null | undefined): {
  delayMs?: number
  jitterMs?: number
} {
  if (!cmd) return {}
  const read = (flag: string): number | undefined => {
    const match = new RegExp(`${flag}[=\\s]+"?(\\d+)"?(?:\\s|$)`, 'u').exec(cmd)
    if (!match) return undefined
    const value = Number(match[1])
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }
  const delayMs = read('--latency-delay-ms')
  const jitterMs = read('--latency-jitter-ms')
  return {
    ...(delayMs !== undefined ? { delayMs } : {}),
    ...(jitterMs !== undefined ? { jitterMs } : {}),
  }
}

export const BACKTEST_PROTOCOL_MAX_LENGTH = 100
export const BACKTEST_MODEL_MAX_LENGTH = 255

function provenanceValue(
  cliValue: string | undefined,
  envValue: string | undefined,
  label: 'protocol' | 'model',
  maxLength: number,
): string | null {
  const value = (cliValue ?? envValue)?.trim()
  if (!value) return null
  if (value.length > maxLength) {
    throw new Error(`[backtest] ${label} must be at most ${maxLength} characters`)
  }
  return value
}

/**
 * Resolve immutable launch provenance. Explicit CLI flags win over the
 * environment inherited from an autonomous protocol launcher.
 */
export function resolveBacktestProvenance(
  args: Pick<BacktestArgs, 'protocol' | 'model'>,
  env: NodeJS.ProcessEnv = process.env,
): { protocol: string | null; model: string | null } {
  return {
    protocol: provenanceValue(
      args.protocol,
      env.BACKTEST_PROTOCOL,
      'protocol',
      BACKTEST_PROTOCOL_MAX_LENGTH,
    ),
    model: provenanceValue(args.model, env.BACKTEST_MODEL, 'model', BACKTEST_MODEL_MAX_LENGTH),
  }
}
