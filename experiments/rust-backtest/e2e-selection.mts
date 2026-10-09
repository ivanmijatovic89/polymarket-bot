/** Freeze the current production selection; original prepared feeds are verification-only. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const [settingsPath] = process.argv.slice(2)
assert(settingsPath)
const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
const original = JSON.parse(await readFile(settings.manifestPath, 'utf8'))
const load = (name: string) => import(pathToFileURL(path.join(settings.snapshotRoot, name)).href)
const { resolveStrategyFromCliArgs } = await load('src/cli/helpers/strategyArgs.ts')
const argv = ['--strategy-artifact', original.artifactSha256]
for (const [key, value] of Object.entries(original.params)) argv.push('--param', `${key}=${value}`)
const built = await resolveStrategyFromCliArgs({ argv, script: 'backtest' })
assert.deepEqual(built.params, original.params)
const { externalFeedsRequest } = await load('src/strategy/plugins/ExternalFeedsRequestPlugin.ts')
const { selectEligibleTelonexMarkets } = await load('src/db/telonexMarkets.ts')
const selection = await selectEligibleTelonexMarkets({
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'local-or-download-from-r2-to-local',
  requiredFeeds: externalFeedsRequest(built),
  fromMs: original.markets[0].startMs,
  limit: original.markets.length,
})
assert.equal(selection.markets.length, 1000)
await writeFile(
  path.join(settings.directory, 'selection-preflight.json'),
  JSON.stringify(selection),
)
const { loadBinanceAggTradesSeries } = await load('src/backtest/feeds/binanceAggTradesSource.ts')
const { loadChainlinkCryptoPricesSeries } = await load(
  'src/backtest/feeds/chainlinkCryptoPricesSource.ts',
)
const { openParquetReaderWithEpermFallback } = await load('src/cli/helpers/openParquetReader.ts')
const { aggTradesDayPath, utcDatesCovering } = await load('src/binance/paths.ts')
const { cryptoPricesDayPath, CRYPTO_PRICES_COVERAGE_FROM_MS } = await load(
  'src/telonex/cryptoPrices/paths.ts',
)
const old = new Map(original.markets.map((m: { slug: string }) => [m.slug, m]))
const added: string[] = []
const marketRows = []
const verification = path.join(settings.directory, 'verification-feeds')
await mkdir(verification)
const fileHash = async (file: string) => {
  const h = createHash('sha256')
  for await (const bytes of createReadStream(file)) h.update(bytes)
  return h.digest('hex')
}
const { binanceLookbackMs, chainlinkLookbackMs, chainlinkMaxGapMs } = original.rawInputSettings
const unique = new Map<string, string>()
for (const row of selection.markets) {
  const startMs = row.marketStartMs,
    endMs = startMs + 900000
  const filePath = path.join(
    settings.productionRoot,
    'data/events/telonex/delta-typed/btc/15m',
    row.slug + '.parquet',
  )
  await realpath(filePath)
  let m: any = old.get(row.slug)
  if (!m) {
    added.push(row.slug)
    const reader = await openParquetReaderWithEpermFallback(filePath)
    let marketId: string
    try {
      const first = await reader.getCursor().next()
      assert(first)
      marketId = String(first.market)
    } finally {
      await reader.close()
    }
    const bin = await loadBinanceAggTradesSeries({
      pair: 'BTCUSDT',
      startMs,
      endMs,
      lookbackMs: binanceLookbackMs,
    })
    const cl = await loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs,
      endMs,
      lookbackMs: chainlinkLookbackMs,
    })
    const feedBytes = JSON.stringify({
      binance: Array.from({ length: bin.length }, (_, i) => [bin.tsMs[i], bin.value[i]]),
      chainlink: Array.from({ length: cl.length }, (_, i) => [
        cl.tsMs[i],
        cl.visibleAtMs[i],
        cl.value[i],
      ]),
    })
    const feeds = path.join(verification, row.slug + '.feeds.json')
    await writeFile(feeds, feedBytes)
    m = {
      slug: row.slug,
      filePath,
      feeds,
      startMs,
      endMs,
      marketId,
      upId: row.assetId0,
      downId: row.assetId1,
      outcome: row.resultId === '0' ? 'UP' : 'DOWN',
      priceToBeat: row.priceToBeat,
      gammaSyncedAtMs: row.gammaMetadataSyncedAt.getTime(),
      marketSha256: await fileHash(filePath),
      feedSha256: createHash('sha256').update(feedBytes).digest('hex'),
      bytes: (await stat(filePath)).size,
    }
    console.log(`Prepared additional current-selection market ${added.length}: ${row.slug}`)
  }
  assert.equal(m.upId, row.assetId0)
  assert.equal(m.downId, row.assetId1)
  assert.equal(m.outcome, row.resultId === '0' ? 'UP' : 'DOWN')
  assert.equal(m.priceToBeat, row.priceToBeat)
  m = { ...m, gammaSyncedAtMs: row.gammaMetadataSyncedAt.getTime() }
  const binance = utcDatesCovering(startMs - binanceLookbackMs, endMs).map((day: string) =>
    aggTradesDayPath('BTCUSDT', day),
  )
  const chainlink = utcDatesCovering(
    Math.max(startMs - chainlinkLookbackMs, CRYPTO_PRICES_COVERAGE_FROM_MS),
    endMs,
  ).map((day: string) => cryptoPricesDayPath('btcusd', day))
  for (const file of binance) unique.set(file, 'binance')
  for (const file of chainlink) unique.set(file, 'chainlink')
  marketRows.push({
    ...m,
    rawFeeds: { binance, chainlink, binanceLookbackMs, chainlinkLookbackMs, chainlinkMaxGapMs },
  })
}
const rawInputFiles = []
for (const [file, kind] of unique)
  rawInputFiles.push({
    path: file,
    kind,
    sha256: await fileHash(file),
    bytes: (await stat(file)).size,
  })
const manifest = {
  ...original,
  markets: marketRows,
  rawInputFiles,
  selection: {
    source: 'Current production selectEligibleTelonexMarkets',
    fromMs: original.markets[0].startMs,
    count: 1000,
    summary: selection.summary,
    overlapWithPriorBenchmark: 1000 - added.length,
    additionalMarkets: added,
  },
  excluded: undefined,
}
await writeFile(
  path.join(settings.directory, 'current-manifest.json'),
  JSON.stringify(manifest, null, 2),
)
const { closeDb } = await load('src/db/index.ts')
await closeDb()
console.log(
  JSON.stringify({
    currentMarkets: 1000,
    overlap: 1000 - added.length,
    added: added.length,
    lastSlug: marketRows.at(-1).slug,
    rawFiles: rawInputFiles.length,
  }),
)
