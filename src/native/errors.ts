/**
 * Native error classes on the TS side (20 §4): one closed class vocabulary
 * shared by exit codes, `EngineResult` errors, shim-side failures and
 * failure-row reasons. The class list itself is the generated `ErrorClass`
 * (21 §3); this module adds the exit-code table (20 §4), the cause pattern
 * (20 §4.1), the reason text (20 §4.2) and the BullMQ action (20 §4.3).
 */
import type { ErrorClass, ErrorDetail, ErrorInfo } from './contract/generated.js'

/** Exit code → class (20 §4). 101 is a panic that escaped every catch boundary. */
const EXIT_CODE_CLASS: ReadonlyMap<number, ErrorClass> = new Map<number, ErrorClass>([
  [1, 'runtime'],
  [2, 'invalid_input'],
  [3, 'data_missing'],
  [4, 'data_defect'],
  [5, 'timeout'],
  [6, 'invalid_output'],
  [7, 'strategy_fault'],
  [8, 'engine_fault'],
  [101, 'engine_fault'],
])

/** Class → the exit code a single-candidate `run` uses for it (20 §4, §5.4). */
const CLASS_EXIT_CODE: ReadonlyMap<ErrorClass, number> = new Map<ErrorClass, number>([
  ['runtime', 1],
  ['invalid_input', 2],
  ['data_missing', 3],
  ['data_defect', 4],
  ['timeout', 5],
  ['invalid_output', 6],
  ['strategy_fault', 7],
  ['engine_fault', 8],
])

/** The class of a non-zero exit code, or null for 0 and unknown codes (20 §4). */
export function classOfExitCode(code: number): ErrorClass | null {
  return EXIT_CODE_CLASS.get(code) ?? null
}

/** The exit codes `run` may use for a class (20 §4: engine_fault is 8 or 101). */
export function exitCodesOfClass(cls: ErrorClass): number[] {
  if (cls === 'engine_fault') return [8, 101]
  const code = CLASS_EXIT_CODE.get(cls)
  return code === undefined ? [] : [code]
}

/** `cause` pattern (20 §4.1, 21 §17). */
export const CAUSE_RE = /^[a-z][a-z0-9_]{0,47}$/

/** One line of at most 1,000 characters (20 §4, 21 §10). */
export function oneLine(message: string): string {
  const flat = message.replace(/\s*[\r\n]+\s*/g, ' | ').trim()
  return flat.length <= 1000 ? flat : `${flat.slice(0, 997)}...`
}

/**
 * A classified native failure raised on the TS side (shim, producer,
 * runner). `message` of the Error is the reason text of 20 §4.2.
 */
export class NativeError extends Error {
  readonly info: ErrorInfo

  constructor(cls: ErrorClass, cause: string, message: string, detail?: ErrorDetail) {
    if (!CAUSE_RE.test(cause)) throw new Error(`native: invalid error cause ${cause} (20 §4.1)`)
    const info: ErrorInfo = {
      class: cls,
      cause,
      message: oneLine(message),
      ...(detail === undefined ? {} : { detail }),
    }
    super(reasonText(info))
    this.name = 'NativeError'
    this.info = info
  }

  /** Wraps an `ErrorInfo` received from the binary. */
  static fromInfo(info: ErrorInfo): NativeError {
    return new NativeError(info.class, info.cause, info.message, info.detail)
  }
}

/** `<class>: <cause>: <message>`, stored in `backtest_run_failures.reason` (20 §4.2). */
export function reasonText(info: ErrorInfo): string {
  return `${info.class}: ${info.cause}: ${info.message}`
}

/** BullMQ action for a failed single-candidate job (20 §4.3). */
export type RetryAction =
  /** Throw: today's attempt ladder (3 attempts, exponential 5 s backoff). */
  | { action: 'retry'; budgetFactor: 1 | 2 }
  /** `UnrecoverableError`: deterministic classes never burn retries. */
  | { action: 'unrecoverable'; alert: boolean }
  /** `canceled` is not an outcome: the job is released (40 §8.4). */
  | { action: 'release' }

/**
 * The 20 §4.3 retry policy of a single-candidate job. `priorTimeouts` is the
 * number of earlier `timeout` failures of the same job: the first timeout is
 * retried with twice the budget, the second is unrecoverable.
 */
export function retryActionFor(cls: ErrorClass, priorTimeouts = 0): RetryAction {
  switch (cls) {
    case 'runtime':
    case 'data_missing':
      return { action: 'retry', budgetFactor: 1 }
    case 'timeout':
      return priorTimeouts === 0
        ? { action: 'retry', budgetFactor: 2 }
        : { action: 'unrecoverable', alert: false }
    case 'invalid_output':
    case 'engine_fault':
      return { action: 'unrecoverable', alert: true }
    case 'invalid_input':
    case 'data_defect':
    case 'strategy_fault':
    case 'killed':
      return { action: 'unrecoverable', alert: false }
    case 'canceled':
      return { action: 'release' }
  }
}
