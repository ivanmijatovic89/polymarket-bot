import { config } from 'dotenv'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, stat, access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBinanceAggTradesSeries } from '../../src/backtest/feeds/binanceAggTradesSource.js'
import { loadChainlinkCryptoPricesSeries } from '../../src/backtest/feeds/chainlinkCryptoPricesSource.js'
import { ensureArtifactLoaded } from '../../src/strategy/artifacts/loader.js'

const here = path.dirname(fileURLToPath(import.meta.url))
if (!process.argv[2])
  throw new Error(
    'Usage: prepare.mts DATA_CHECKOUT [run-id] [sample-count] [sample-plan] [--from-date YYYY-MM-DD] [--output-dir directory]',
  )
const root = path.resolve(process.argv[2])
const runId = Number(process.argv[3] ?? 9657)
const count = Number(process.argv[4] ?? 24)
const extra = process.argv.slice(5)
const planPath = extra[0] && !extra[0].startsWith('--') ? extra.shift() : undefined
const options = new Map<string, string>()
for (let i = 0; i < extra.length; i += 2) {
  const key = extra[i]!
  const value = extra[i + 1]
  if (
    !['--from-date', '--output-dir'].includes(key) ||
    !value ||
    value.startsWith('--') ||
    options.has(key)
  )
    throw new Error(`Invalid preparation option: ${key}`)
  options.set(key, value)
}
const fromDate = options.get('--from-date')
const fromMs = fromDate ? Date.parse(`${fromDate}T00:00:00Z`) : undefined
if (
  fromDate &&
  (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
    !Number.isFinite(fromMs) ||
    new Date(fromMs!).toISOString().slice(0, 10) !== fromDate)
)
  throw new Error('Expected a valid UTC date in YYYY-MM-DD format')
if (planPath && fromDate) throw new Error('Choose a saved sample plan or --from-date')
const plan = planPath
  ? (JSON.parse(await readFile(planPath, 'utf8')) as {
      runId: number
      artifactSha256: string
      settings: Record<string, number>
      params: Record<string, unknown>
      slugs: string[]
    })
  : undefined
if (plan && plan.runId !== runId) throw new Error('Sample plan run ID mismatch')
if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(count) || count < 1)
  throw new Error('Invalid run ID or sample count')
config({ path: path.join(root, '.env') })
process.env.BINANCE_DATA_BASE_DIR = path.join(root, 'data/binance')
process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = path.join(root, 'data/telonex/crypto_prices')
const { loadDatabaseConfigFromEnv } = await import('../../src/db/config.js')
const c = await mysql.createConnection({ ...loadDatabaseConfigFromEnv(), connectTimeout: 5000 })
const fixtures = path.resolve(options.get('--output-dir') ?? path.join(here, 'fixtures'))
await mkdir(fixtures, { recursive: true })
try {
  const [runs] = await c.execute<RowDataPacket[]>(
    'SELECT id, strategy, params, cmd, input_mode, strategy_artifact_sha256, strategy_artifact_meta, created_at FROM backtest_runs WHERE id=?',
    [runId],
  )
  const run = runs[0]!
  if (run.strategy !== 'overnight-opus55-lagsnipe.v15' || run.input_mode !== 'telonex-delta')
    throw new Error('This prototype supports only the frozen v15 strategy on telonex-delta')
  const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
  const meta = json(run.strategy_artifact_meta)
  const sha = run.strategy_artifact_sha256 as string
  const artifact = await readFile(path.join(root, 'data/strategy-artifacts', `${sha}.mjs`))
  if (createHash('sha256').update(artifact).digest('hex') !== sha)
    throw new Error('Artifact hash mismatch')
  const artifactDir = path.resolve(here, '../../data/strategy-artifacts')
  await mkdir(artifactDir, { recursive: true })
  await writeFile(path.join(artifactDir, `${sha}.mjs`), artifact)
  const def = await ensureArtifactLoaded({ sha256: sha, r2Url: meta.r2Url })
  const params = def.schema.parse(json(run.params))
  const cmd = run.cmd as string
  const flag = (name: string) => {
    const all = [...cmd.matchAll(new RegExp(`--${name}\\s+([0-9.]+)`, 'g'))]
    if (!all.length) throw new Error(`Missing explicit --${name}`)
    return Number(all.at(-1)![1])
  }
  const settings = {
    startingCapital: flag('starting-capital'),
    delayMs: flag('latency-delay-ms'),
    jitterMs: flag('latency-jitter-ms'),
    binanceLatencyMs: Number(process.env.BACKTEST_BINANCE_FEED_LATENCY_MS ?? 110),
    chainlinkLatencyMs: Number(process.env.BACKTEST_RTDS_CHAINLINK_LATENCY_MS ?? 320),
    priceToBeatLatencyMs: Number(process.env.BACKTEST_PRICE_TO_BEAT_LATENCY_MS ?? 2700),
    seed: 123456789,
  }
  const [rows] = await c.execute<RowDataPacket[]>(
    'SELECT slug,idx,trade_count,pnl,duration_ms,events_processed FROM backtest_run_markets WHERE run_id=? ORDER BY idx',
    [runId],
  )
  const selected = new Map<string, RowDataPacket>()
  const add = (r: RowDataPacket) => selected.set(r.slug, r)
  const n = Math.max(1, Math.floor(count / 4))
  ;[...rows]
    .sort((a, b) => b.trade_count - a.trade_count || a.idx - b.idx)
    .slice(0, n)
    .forEach(add)
  ;[...rows]
    .sort((a, b) => b.duration_ms - a.duration_ms || a.idx - b.idx)
    .slice(0, n)
    .forEach(add)
  rows
    .filter((r) => r.trade_count === 0)
    .slice(0, n)
    .forEach(add)
  for (let i = 0; i < count && selected.size < count; i++)
    add(rows[Math.floor((i * (rows.length - 1)) / Math.max(1, count - 1))]!)
  for (const row of rows) {
    if (selected.size >= count) break
    add(row)
  }
  if (plan) {
    if (plan.artifactSha256 !== sha || JSON.stringify(plan.params) !== JSON.stringify(params))
      throw new Error('Sample plan strategy or params mismatch')
    for (const [key, value] of Object.entries(plan.settings))
      if (settings[key as keyof typeof settings] !== value)
        throw new Error(`Sample plan setting differs: ${key}`)
    selected.clear()
    for (const slug of plan.slugs) {
      const row = rows.find((r) => r.slug === slug)
      if (!row) throw new Error(`Sample slug missing from source run: ${slug}`)
      add(row)
    }
  }
  const catalogMetadata = new Map<string, RowDataPacket>()
  if (fromMs !== undefined) {
    const directory = path.join(root, 'data/events/telonex/delta-typed/btc/15m')
    const local = new Set(
      (await readdir(directory))
        .filter((name) => /^btc-updown-15m-\d+\.parquet$/.test(name))
        .map((name) => name.slice(0, -8)),
    )
    const [catalogRows] = await c.execute<RowDataPacket[]>(
      "SELECT slug,market_id,asset_id_0,asset_id_1,result_id,telonex_status,price_to_beat,gamma_metadata_synced_at FROM telonex_markets WHERE slug LIKE 'btc-updown-15m-%' AND slug>=? AND telonex_status='resolved' AND result_id IN ('0','1') AND price_to_beat IS NOT NULL ORDER BY slug",
      [`btc-updown-15m-${Math.floor(fromMs / 1000)}`],
    )
    selected.clear()
    for (const row of catalogRows) {
      if (!local.has(row.slug as string)) continue
      add(row)
      catalogMetadata.set(row.slug as string, row)
    }
    if (selected.size < count)
      throw new Error(`Only ${selected.size}/${count} usable local markets from ${fromDate}`)
    console.log(
      `Found ${selected.size} candidate resolved local markets from ${fromDate} UTC; strategy settings remain pinned to run ${runId}`,
    )
  }
  const excluded: { slug: string; reason: string }[] = []
  const markets = []
  for (const r of selected.values()) {
    if (fromDate && markets.length === count) break
    const slug = r.slug as string
    const filePath = path.join(root, 'data/events/telonex/delta-typed/btc/15m', `${slug}.parquet`)
    await access(filePath)
    let m = catalogMetadata.get(slug)
    if (!m) {
      const [catalog] = await c.execute<RowDataPacket[]>(
        'SELECT market_id,asset_id_0,asset_id_1,result_id,telonex_status,price_to_beat,gamma_metadata_synced_at FROM telonex_markets WHERE slug=?',
        [slug],
      )
      m = catalog[0]
    }
    if (!m) throw new Error(`Missing market metadata: ${slug}`)
    if (
      m.telonex_status !== 'resolved' ||
      !['0', '1'].includes(m.result_id) ||
      m.price_to_beat == null
    )
      throw new Error(`Unusable metadata: ${slug}`)
    const startMs = Number(slug.split('-').at(-1)) * 1000
    const endMs = startMs + 900000
    const lookbackMs = Number(process.env.BACKTEST_BINANCE_FEED_LOOKBACK_MS ?? 300000)
    let cl: Awaited<ReturnType<typeof loadChainlinkCryptoPricesSeries>>
    try {
      cl = await loadChainlinkCryptoPricesSeries({
        assetId: 'btcusd',
        startMs,
        endMs,
        lookbackMs: Number(process.env.BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS ?? 300000),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (!fromDate || !reason.startsWith('[backtest:feeds] MISSING chainlink data')) throw error
      excluded.push({ slug, reason })
      console.warn(`Excluded upstream Chainlink outage: ${slug}`)
      continue
    }
    const bin = await loadBinanceAggTradesSeries({ pair: 'BTCUSDT', startMs, endMs, lookbackMs })
    const feedData = {
      binance: Array.from({ length: bin.length }, (_, i) => [bin.tsMs[i], bin.value[i]]),
      chainlink: Array.from({ length: cl.length }, (_, i) => [
        cl.tsMs[i],
        cl.visibleAtMs[i],
        cl.value[i],
      ]),
    }
    const feeds = path.join(fixtures, `${slug}.feeds.json`)
    const feedBytes = JSON.stringify(feedData)
    await writeFile(feeds, feedBytes)
    const info = await stat(filePath)
    markets.push({
      slug,
      filePath,
      feeds,
      startMs,
      endMs,
      marketId: m.market_id,
      upId: m.asset_id_0,
      downId: m.asset_id_1,
      outcome: m.result_id === '0' ? 'UP' : 'DOWN',
      priceToBeat: m.price_to_beat,
      gammaSyncedAtMs: new Date(m.gamma_metadata_synced_at).getTime(),
      marketSha256: createHash('sha256')
        .update(await readFile(filePath))
        .digest('hex'),
      feedSha256: createHash('sha256').update(feedBytes).digest('hex'),
      bytes: info.size,
      savedTradeCount: r.trade_count,
      savedPnl: r.pnl,
      savedEvents: r.events_processed,
    })
    console.log(
      `Prepared ${markets.length}/${fromDate ? count : selected.size}: ${slug}, binance=${bin.length}, chainlink=${cl.length}`,
    )
  }
  if (markets.length !== count)
    throw new Error(`Prepared ${markets.length}/${count} markets; insufficient usable inputs`)
  await writeFile(
    path.join(fixtures, 'manifest.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        runId,
        sourceCommand: cmd,
        strategy: run.strategy,
        artifactSha256: sha,
        artifactMeta: meta,
        settings,
        params,
        excluded,
        selection: fromDate
          ? {
              fromDateUtc: fromDate,
              order: 'chronological',
              count,
              source: 'resolved local catalog markets',
            }
          : { source: 'saved source-run markets' },
        preparation:
          'External feed series extracted by production loaders, shared by both timed implementations. Raw daily-feed loading is measured separately in the production TypeScript baseline.',
        markets,
      },
      null,
      2,
    ),
  )
  console.log(`Saved manifest with ${markets.length} markets; no database or queue writes`)
} finally {
  await c.end()
}
