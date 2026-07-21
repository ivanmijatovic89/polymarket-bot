import { assetIdForSymbol, CRYPTO_PRICES_ASSET_IDS } from './paths.js'

export type { BinanceCliFlagSpec as CryptoPricesCliFlagSpec } from '../../binance/cliArgs.js'
export { concurrencyFlag } from '../../binance/cliArgs.js'
import type { BinanceCliFlagSpec } from '../../binance/cliArgs.js'

/**
 * Shared argv loop for the `src/telonex/cryptoPrices` CLIs: handles
 * `--asset btcusd` / `--symbol btc` (both resolved through `assetIdForSymbol`,
 * validated against the channel's known asset ids) plus each script's own
 * flags. Every error — missing value, unknown arg, invalid flag value, missing
 * `--asset`/`--symbol` — prints the message and the usage text, then exits 2,
 * so all the CLIs fail identically by construction (mirror of
 * `parseBinanceCliArgs`).
 */
export function parseCryptoPricesCliArgs(args: {
  argv: string[]
  usage: string
  flags?: Record<string, BinanceCliFlagSpec>
}): { assetId: string } {
  const fail = (msg: string): never => {
    console.error(msg)
    console.error(args.usage)
    process.exit(2)
  }
  let assetId = ''
  const argv = args.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) return fail(`missing value for ${a}`)
      return v
    }
    try {
      if (a === '--asset' || a === '--symbol') {
        assetId = assetIdForSymbol(next())
        if (!(CRYPTO_PRICES_ASSET_IDS as readonly string[]).includes(assetId)) {
          fail(
            `unknown crypto_prices asset: ${assetId} (known: ${CRYPTO_PRICES_ASSET_IDS.join(', ')})`,
          )
        }
      } else {
        const spec = args.flags?.[a]
        if (!spec) fail(`unknown arg: ${a}`)
        else if (spec.kind === 'boolean') spec.set()
        else spec.set(next())
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }
  if (!assetId) fail('missing --asset (or --symbol)')
  return { assetId }
}
