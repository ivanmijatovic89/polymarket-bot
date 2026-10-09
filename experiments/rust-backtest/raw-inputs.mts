import { config } from 'dotenv'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { aggTradesDayPath, utcDatesCovering } from '../../src/binance/paths.js'
import {
  cryptoPricesDayPath,
  CRYPTO_PRICES_COVERAGE_FROM_MS,
} from '../../src/telonex/cryptoPrices/paths.js'
import { loadManifest } from './common.mjs'

const [referencePath, outputPath, dataRoot] = process.argv.slice(2)
if (!referencePath || !outputPath || !dataRoot)
  throw new Error('Usage: raw-inputs.mts reference-manifest output-manifest DATA_CHECKOUT')
const root = path.resolve(dataRoot)
config({ path: path.join(root, '.env') })
process.env.BINANCE_DATA_BASE_DIR = path.join(root, 'data/binance')
process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = path.join(root, 'data/telonex/crypto_prices')
const manifest = await loadManifest(referencePath)
const binanceLookbackMs = Number(process.env.BACKTEST_BINANCE_FEED_LOOKBACK_MS ?? 300000)
const chainlinkLookbackMs = Number(process.env.BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS ?? 300000)
const rawGap = process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS?.trim()
const parsedGap = rawGap ? Number(rawGap) : NaN
const chainlinkMaxGapMs = Number.isFinite(parsedGap) && parsedGap >= 0 ? parsedGap : 300000
if (
  ![binanceLookbackMs, chainlinkLookbackMs, chainlinkMaxGapMs].every(
    (n) => Number.isSafeInteger(n) && n >= 0,
  )
)
  throw new Error('Expected nonnegative integer feed settings')
const uniqueFiles = new Map<string, 'binance' | 'chainlink'>()
const markets = manifest.markets.map((market) => {
  const binance = utcDatesCovering(market.startMs - binanceLookbackMs, market.endMs).map((date) =>
    aggTradesDayPath('BTCUSDT', date),
  )
  const chainlink = utcDatesCovering(
    Math.max(market.startMs - chainlinkLookbackMs, CRYPTO_PRICES_COVERAGE_FROM_MS),
    market.endMs,
  ).map((date) => cryptoPricesDayPath('btcusd', date))
  for (const file of binance) uniqueFiles.set(file, 'binance')
  for (const file of chainlink) uniqueFiles.set(file, 'chainlink')
  return {
    ...market,
    rawFeeds: { binance, chainlink, binanceLookbackMs, chainlinkLookbackMs, chainlinkMaxGapMs },
  }
})
const rawInputFiles = []
for (const [file, kind] of uniqueFiles) {
  const hash = createHash('sha256')
  for await (const block of createReadStream(file)) hash.update(block)
  rawInputFiles.push({
    path: file,
    kind,
    sha256: hash.digest('hex'),
    bytes: (await stat(file)).size,
  })
}
await writeFile(
  outputPath,
  JSON.stringify(
    {
      ...manifest,
      preparation:
        'Original daily Parquet feeds loaded and prepared independently by each engine inside the timed run; prepared JSON retained only for untimed correctness verification.',
      rawInputMode: 'raw-parquet',
      referenceManifestPath: path.resolve(referencePath),
      referenceManifestSha256: createHash('sha256')
        .update(await readFile(referencePath))
        .digest('hex'),
      rawInputSettings: { binanceLookbackMs, chainlinkLookbackMs, chainlinkMaxGapMs },
      rawInputFiles,
      markets,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  JSON.stringify({
    markets: markets.length,
    dayFiles: rawInputFiles.length,
    rawFeedBytes: rawInputFiles.reduce((sum, file) => sum + file.bytes, 0),
    settings: { binanceLookbackMs, chainlinkLookbackMs, chainlinkMaxGapMs },
  }),
)
