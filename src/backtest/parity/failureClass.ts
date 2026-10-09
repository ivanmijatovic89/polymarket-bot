import type { ErrorClass, ErrorInfo } from '../../native/contract/generated.js'
import type { MarketVerdict } from './matchers.js'

/**
 * Failure classes of the two sides of a parity market (60 CL-7): both
 * engines failing a market with the same error class is `identical`; a
 * different outcome is a divergence, classified like any other.
 *
 * The TS oracle has no error classes: it throws plain `Error`s. The harness
 * maps the failure text of the TS loaders to the class and cause that
 * 14 §10 assigns to the same condition (the table's "Evidence" column names
 * the TS lines). Anything else is unclassified (`null`), which never equals
 * a Rust class.
 */
export type FailureClass = { class: ErrorClass; cause: string }

/** 14 §10 conditions with their TS evidence; first match wins. */
const TS_FAILURE_TABLE: ReadonlyArray<{ re: RegExp; class: ErrorClass; cause: string }> = [
  // binanceAggTradesSource.ts:61-68
  {
    re: /missing Binance aggTrades day file\(s\)/,
    class: 'data_missing',
    cause: 'day_file_missing',
  },
  // binanceAggTradesSource.ts:108-119
  {
    re: /Binance aggTrades day file\(s\) .* contain no trades/,
    class: 'data_defect',
    cause: 'corrupt',
  },
  // chainlinkCryptoPricesSource.ts:69-76
  { re: /before crypto_prices coverage/, class: 'data_defect', cause: 'pre_coverage' },
  // chainlinkCryptoPricesSource.ts:86-104
  {
    re: /(missing Telonex crypto_prices day file\(s\)|crypto_prices day file\(s\) .* not available yet)/,
    class: 'data_missing',
    cause: 'day_file_missing',
  },
  // chainlinkCryptoPricesSource.ts:145-170
  {
    re: /(NULL\/invalid server_timestamp_us in crypto_prices|crypto_prices day file\(s\) .* contain no rounds)/,
    class: 'data_defect',
    cause: 'corrupt',
  },
  // chainlinkCryptoPricesSource.ts:238-247
  { re: /MISSING chainlink data .* hole/, class: 'data_defect', cause: 'upstream_hole' },
  // wireBacktestExternalFeeds.ts:188-193
  { re: /market window is underivable/, class: 'invalid_input', cause: 'window' },
  // wireBacktestExternalFeeds.ts:203-210, 252-256
  { re: /no symbol and none is derivable from the slug/, class: 'invalid_input', cause: 'symbol' },
  // wireBacktestExternalFeeds.ts:176-181
  {
    re: /require --input-mode recorder-v4; historical feed mode cannot supply them/,
    class: 'invalid_input',
    cause: 'unsupported_feed',
  },
]

/**
 * The 14 §10 class of a TS oracle failure, from its error text (the child's
 * log tail), or null when the text matches no known condition.
 */
// D-PENDING: 60 CL-7 compares "error classes" but the TS oracle has none; chose a message table built from 14 §10's evidence column, with unknown TS errors unclassified (never equal to a Rust class).
export function classifyTsFailure(text: string): FailureClass | null {
  for (const row of TS_FAILURE_TABLE)
    if (row.re.test(text)) return { class: row.class, cause: row.cause }
  return null
}

/** The failure class of a Rust run: the shim's `NativeError`, or the result's error (21 §10). */
export function rustFailureClass(info: ErrorInfo | null | undefined): FailureClass | null {
  return info ? { class: info.class, cause: info.cause } : null
}

function label(f: FailureClass | null): string {
  return f ? `${f.class}: ${f.cause}` : 'unclassified error'
}

/**
 * 60 CL-7 verdict of a market where at least one side failed. `ts`/`rust`
 * are `ok` for a successful run, else the failure class (null when the
 * failure could not be classified).
 */
export function failureVerdict(
  ts: 'ok' | { failure: FailureClass | null },
  rust: 'ok' | { failure: FailureClass | null },
): MarketVerdict {
  if (ts === 'ok' && rust === 'ok') throw new Error('failureVerdict: neither side failed')
  if (ts === 'ok')
    return {
      verdict: 'unclassified',
      reason: `rust_failed (${label((rust as { failure: FailureClass | null }).failure)}), TS ok`,
    }
  if (rust === 'ok')
    return { verdict: 'unclassified', reason: `ts_failed (${label(ts.failure)}), Rust ok` }
  if (ts.failure !== null && rust.failure !== null && ts.failure.class === rust.failure.class)
    return { verdict: 'identical' }
  return {
    verdict: 'unclassified',
    reason: `both failed with different classes: TS ${label(ts.failure)}, Rust ${label(rust.failure)}`,
  }
}
