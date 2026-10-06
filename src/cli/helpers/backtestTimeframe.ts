import type { BacktestArgs } from './backtestArgs.js'

/** Persist the duration of selected recordings, without applying the legacy CLI default. */
export function resolveBacktestTimeframe(args: {
  inputMode: BacktestArgs['inputMode']
  timeframe: string | null
  captureTimeframes: Iterable<'5m' | '15m'>
}): string | null {
  if (args.inputMode !== 'recorder-v4') return args.timeframe
  const timeframes = new Set(args.captureTimeframes)
  return timeframes.size === 1 ? [...timeframes][0]! : null
}
