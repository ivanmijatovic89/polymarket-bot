import { defaultBinancePairForSymbol, pairFromFeedSymbol } from './paths.js'

export type BinanceCliFlagSpec =
  | { kind: 'boolean'; set: () => void }
  | { kind: 'value'; set: (value: string) => void }

/**
 * Shared argv loop for the `src/binance` CLIs: handles `--pair BTCUSDT` /
 * `--symbol btc` (the two spellings every CLI accepts, resolved through the
 * canonical helpers in `paths.ts`) plus each script's own flags. Every error —
 * missing value, unknown arg, invalid flag value (a `value` setter may throw),
 * missing `--pair`/`--symbol` — prints the message and the usage text, then
 * exits 2, so all five CLIs fail identically by construction.
 */
export function parseBinanceCliArgs(args: {
  argv: string[]
  usage: string
  flags?: Record<string, BinanceCliFlagSpec>
}): { pair: string } {
  const fail = (msg: string): never => {
    console.error(msg)
    console.error(args.usage)
    process.exit(2)
  }
  let pair = ''
  const argv = args.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) return fail(`missing value for ${a}`)
      return v
    }
    try {
      if (a === '--pair') pair = pairFromFeedSymbol(next())
      else if (a === '--symbol') pair = defaultBinancePairForSymbol(next())
      else {
        const spec = args.flags?.[a]
        if (!spec) fail(`unknown arg: ${a}`)
        else if (spec.kind === 'boolean') spec.set()
        else spec.set(next())
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }
  if (!pair) fail('missing --pair (or --symbol)')
  return { pair }
}

/** Common `--concurrency N` handler: clamps to ≥ 1, falls back on non-numeric input. */
export function concurrencyFlag(fallback: number, set: (n: number) => void): BinanceCliFlagSpec {
  return { kind: 'value', set: (v) => set(Math.max(1, Number(v) || fallback)) }
}
