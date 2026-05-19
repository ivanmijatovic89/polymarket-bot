#!/usr/bin/env tsx
/**
 * Verify Telonex converters by replaying their output exactly as backtest does.
 *
 * For a single slug this command:
 * - reads Up/Down asset mapping from telonex_markets,
 * - downloads the raw Telonex parquets listed in telonex_market_files,
 * - runs the requested converter(s) into temp parquet files,
 * - replays those temp files through the same replay paths used by backtest,
 * - compares the full reconstructed orderbook on every emitted strategy tick.
 */

import '../config/env.js'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../market/orderbook/index.js'
import { closeDb, getDb, telonexMarketFiles, telonexMarkets } from '../db/index.js'
import { getDefaultBucket, getObjectToFile } from '../r2/client.js'
import { convertPaired } from './converters/paired.js'
import { createDeltaConverter } from './converters/delta.js'
import { createDeltaTypedConverter } from './converters/deltaTyped.js'
import { cmpTick, streamSortedTickGroupsFromInputs, type ParsedTick } from './converters/parsing.js'
import type { ConverterInput } from './converters/types.js'
import { replayTelonexDeltaParquetForMarket } from '../parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { replayTelonexPairedParquetForMarket } from '../parquet/replay/replayTelonexPairedParquetForMarket.js'
import { replayOrderBookForMarket } from '../parquet/replay/replayOrderBookForMarket.js'

type ConverterName = 'paired' | 'delta' | 'delta-typed'
type ConverterChoice = ConverterName | 'both'
type Side = 'up' | 'down'

type Args = {
  slug: string | null
  converter: ConverterChoice
  bookInterval: number
  keepTemp: boolean
}

type Level = { price: string; size: string }

type RawTick = ParsedTick

type AssetBook = {
  market: string
  assetId: string
  timestamp: number
  bids: Level[]
  asks: Level[]
}

type ExpectedSnapshot = {
  tickNo: number
  reason: string
  market: string
  timestamp: number
  byAssetId: Record<string, AssetBook>
}

type MarketMapping = {
  slug: string
  upAssetId: string
  downAssetId: string
}

type RawFileRow = {
  assetId: string
  r2Key: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    slug: null,
    converter: 'both',
    bookInterval: 500,
    keepTemp: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--slug') out.slug = argv[++i] ?? null
    else if (a === '--converter') {
      const v = argv[++i]
      if (v !== 'paired' && v !== 'delta' && v !== 'delta-typed' && v !== 'both') {
        throw new Error(
          `[telonex:verify] --converter must be paired|delta|delta-typed|both, got ${v}`,
        )
      }
      out.converter = v
    } else if (a === '--book-interval') {
      out.bookInterval = Math.max(1, Number(argv[++i] ?? '500') || 500)
    } else if (a === '--keep-temp') out.keepTemp = true
    else throw new Error(`[telonex:verify] unknown arg: ${a}`)
  }
  if (!out.slug || out.slug.trim() === '') throw new Error('[telonex:verify] --slug is required')
  return out
}

function cloneBook(book: AssetBook): AssetBook {
  return {
    market: book.market,
    assetId: book.assetId,
    timestamp: book.timestamp,
    bids: book.bids.map((x) => ({ ...x })),
    asks: book.asks.map((x) => ({ ...x })),
  }
}

function snapshotFromState(args: {
  tickNo: number
  reason: string
  market: string
  timestamp: number
  state: Map<string, AssetBook>
}): ExpectedSnapshot {
  return {
    tickNo: args.tickNo,
    reason: args.reason,
    market: args.market,
    timestamp: args.timestamp,
    byAssetId: Object.fromEntries(
      [...args.state.entries()].map(([assetId, book]) => [assetId, cloneBook(book)]),
    ),
  }
}

function bookFromTick(tick: RawTick, timestamp = Number(tick.tsUs / 1000n)): AssetBook {
  return {
    market: tick.marketId,
    assetId: tick.assetId,
    timestamp,
    bids: tick.bids,
    asks: tick.asks,
  }
}

function levelsEqual(a: Level, b: { price: number; size: number }): boolean {
  return Number(a.price) === b.price && Number(a.size) === b.size
}

function formatLevel(level: Level | { price: number; size: number } | undefined): string {
  if (!level) return '<missing>'
  return `price=${level.price} size=${level.size} numeric=(${Number(level.price)}, ${Number(level.size)})`
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function formatAssetIds(assetIds: string[]): string {
  return `[${assetIds.join(',')}]`
}

class VerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationError'
  }
}

async function getMarketMapping(slug: string): Promise<MarketMapping> {
  const row = (
    await getDb()
      .select({
        slug: telonexMarkets.slug,
        outcome0: telonexMarkets.outcome0,
        outcome1: telonexMarkets.outcome1,
        assetId0: telonexMarkets.assetId0,
        assetId1: telonexMarkets.assetId1,
      })
      .from(telonexMarkets)
      .where(eq(telonexMarkets.slug, slug))
      .limit(1)
  )[0]
  if (!row) throw new Error(`[telonex:verify] no telonex_markets row for slug=${slug}`)

  const pairs = [
    { outcome: row.outcome0, assetId: row.assetId0 },
    { outcome: row.outcome1, assetId: row.assetId1 },
  ]
  const up = pairs.find((x) => x.outcome?.toLowerCase() === 'up')?.assetId ?? null
  const down = pairs.find((x) => x.outcome?.toLowerCase() === 'down')?.assetId ?? null
  if (!up || !down) {
    throw new Error(
      `[telonex:verify] cannot derive Up/Down asset ids for slug=${slug} outcome0=${row.outcome0} outcome1=${row.outcome1}`,
    )
  }
  return { slug: row.slug, upAssetId: up, downAssetId: down }
}

async function getRawFileRows(slug: string): Promise<RawFileRow[]> {
  const rows = await getDb()
    .select({ assetId: telonexMarketFiles.assetId, r2Key: telonexMarketFiles.r2Key })
    .from(telonexMarketFiles)
    .where(and(eq(telonexMarketFiles.slug, slug), eq(telonexMarketFiles.status, 'uploaded')))
  rows.sort((a, b) =>
    a.assetId !== b.assetId ? a.assetId.localeCompare(b.assetId) : a.r2Key.localeCompare(b.r2Key),
  )
  if (rows.length === 0) throw new Error(`[telonex:verify] no uploaded raw files for slug=${slug}`)
  return rows
}

async function downloadRawFiles(args: {
  bucket: string
  rawRows: RawFileRow[]
  mapping: MarketMapping
  tmpDir: string
}): Promise<ConverterInput[]> {
  const rawDir = path.join(args.tmpDir, 'raw')
  await fs.mkdir(rawDir, { recursive: true })
  const inputs: ConverterInput[] = []
  for (const row of args.rawRows) {
    const side: Side =
      row.assetId === args.mapping.upAssetId
        ? 'up'
        : row.assetId === args.mapping.downAssetId
          ? 'down'
          : (() => {
              throw new Error(
                `[telonex:verify] raw file asset ${row.assetId} is not Up or Down for ${args.mapping.slug}`,
              )
            })()
    const localPath = path.join(rawDir, path.basename(row.r2Key))
    await getObjectToFile(args.bucket, row.r2Key, localPath)
    inputs.push({ filePath: localPath, side })
  }
  inputs.sort((a, b) =>
    a.side !== b.side ? (a.side === 'up' ? -1 : 1) : a.filePath.localeCompare(b.filePath),
  )
  return inputs
}

type DeltaAssetState = {
  bids: Map<number, number>
  asks: Map<number, number>
  ticksSinceBook: number
}

function hasChanges(tick: RawTick, state: DeltaAssetState): boolean {
  const checkSide = (levels: Level[], prev: Map<number, number>): boolean => {
    const seen = new Set<number>()
    for (const lvl of levels) {
      const price = Number(lvl.price)
      seen.add(price)
      if (prev.get(price) !== Number(lvl.size)) return true
    }
    for (const price of prev.keys()) {
      if (!seen.has(price)) return true
    }
    return false
  }
  return checkSide(tick.bids, state.bids) || checkSide(tick.asks, state.asks)
}

function updateDeltaState(state: DeltaAssetState, tick: RawTick): void {
  state.bids = new Map(tick.bids.map((x) => [Number(x.price), Number(x.size)]))
  state.asks = new Map(tick.asks.map((x) => [Number(x.price), Number(x.size)]))
}

type ExpectedSnapshotProvider = {
  next: () => Promise<ExpectedSnapshot | null>
}

function createQueuedExpectedProvider(
  run: (push: (snapshot: ExpectedSnapshot) => Promise<void>) => Promise<void>,
): ExpectedSnapshotProvider {
  const queue: ExpectedSnapshot[] = []
  const nextWaiters: Array<() => void> = []
  const spaceWaiters: Array<() => void> = []
  let done = false
  let error: unknown = null

  const wakeNext = (): void => nextWaiters.shift()?.()
  const wakeSpace = (): void => spaceWaiters.shift()?.()

  const push = async (snapshot: ExpectedSnapshot): Promise<void> => {
    while (queue.length >= 1) {
      await new Promise<void>((resolve) => spaceWaiters.push(resolve))
    }
    queue.push(snapshot)
    wakeNext()
  }

  void run(push)
    .catch((err) => {
      error = err
    })
    .finally(() => {
      done = true
      wakeNext()
    })

  return {
    next: async () => {
      while (queue.length === 0 && !done && !error) {
        await new Promise<void>((resolve) => nextWaiters.push(resolve))
      }
      if (error) throw error
      const snapshot = queue.shift()
      if (snapshot) {
        wakeSpace()
        return snapshot
      }
      return null
    },
  }
}

function createPairedExpectedProvider(inputs: ConverterInput[]): ExpectedSnapshotProvider {
  const state = new Map<string, AssetBook>()
  let lastUp: RawTick | null = null
  let lastDown: RawTick | null = null
  let tickNo = 0

  return createQueuedExpectedProvider(async (push) => {
    await streamSortedTickGroupsFromInputs(inputs, async (group) => {
      const tsUs = group[0]!.tsUs
      const eventTsMs = Number(tsUs / 1000n)
      const upTicks = group.filter((x) => x.side === 'up').sort(cmpTick)
      const downTicks = group.filter((x) => x.side === 'down').sort(cmpTick)
      const n = Math.max(upTicks.length, downTicks.length)
      for (let k = 0; k < n; k += 1) {
        const upTick = upTicks[k] ?? lastUp
        const downTick = downTicks[k] ?? lastDown
        if (upTicks[k]) lastUp = upTicks[k]!
        if (downTicks[k]) lastDown = downTicks[k]!
        if (!upTick || !downTick) continue

        state.set(upTick.assetId, bookFromTick(upTick, eventTsMs))
        state.set(downTick.assetId, bookFromTick(downTick, eventTsMs))
        tickNo += 1
        await push(
          snapshotFromState({
            tickNo,
            reason: `paired ts_us=${tsUs.toString()} group_index=${k}`,
            market: upTick.marketId,
            timestamp: eventTsMs,
            state,
          }),
        )
      }
    })
  })
}

function createDeltaExpectedProvider(
  inputs: ConverterInput[],
  bookInterval: number,
): ExpectedSnapshotProvider {
  const expectedBooks = new Map<string, AssetBook>()
  const deltaStateByAsset = new Map<string, DeltaAssetState>()
  let tickNo = 0

  return createQueuedExpectedProvider(async (push) => {
    await streamSortedTickGroupsFromInputs(inputs, async (group) => {
      const tsUs = group[0]!.tsUs
      const upTicks: RawTick[] = []
      const downTicks: RawTick[] = []
      for (const tick of group) {
        if (tick.side === 'up') upTicks.push(tick)
        else downTicks.push(tick)
      }

      const n = Math.max(upTicks.length, downTicks.length)
      const market = (upTicks[0] ?? downTicks[0])!.marketId
      const eventTsMs = Number(tsUs / 1000n)

      for (let k = 0; k < n; k += 1) {
        const pair = [upTicks[k], downTicks[k]].filter(Boolean) as RawTick[]
        let hasCombinedDelta = false

        for (const tick of pair) {
          let state = deltaStateByAsset.get(tick.assetId)
          if (!state || state.ticksSinceBook >= bookInterval) {
            expectedBooks.set(tick.assetId, bookFromTick(tick))
            state = state ?? { bids: new Map(), asks: new Map(), ticksSinceBook: 0 }
            deltaStateByAsset.set(tick.assetId, state)
            updateDeltaState(state, tick)
            state.ticksSinceBook = 1
            tickNo += 1
            await push(
              snapshotFromState({
                tickNo,
                reason: `delta book asset=${tick.assetId} ts_us=${tsUs.toString()} group_index=${k}`,
                market,
                timestamp: eventTsMs,
                state: expectedBooks,
              }),
            )
          } else {
            if (hasChanges(tick, state)) {
              hasCombinedDelta = true
              expectedBooks.set(tick.assetId, bookFromTick(tick))
            }
            updateDeltaState(state, tick)
            state.ticksSinceBook += 1
          }
        }

        if (hasCombinedDelta) {
          tickNo += 1
          await push(
            snapshotFromState({
              tickNo,
              reason: `delta price_change ts_us=${tsUs.toString()} group_index=${k}`,
              market,
              timestamp: eventTsMs,
              state: expectedBooks,
            }),
          )
        }
      }
    })
  })
}

function compareBook(args: {
  converter: ConverterName
  expectedTick: ExpectedSnapshot
  actual: OrderBookSnapshot | undefined
  expected: AssetBook
}): void {
  const { converter, expectedTick, actual, expected } = args
  const prefix = `[telonex:verify:${converter}] tick=${expectedTick.tickNo} ${expectedTick.reason} asset=${expected.assetId}`
  if (!actual) throw new VerificationError(`${prefix} missing actual asset book`)
  if (actual.market !== expected.market) {
    throw new VerificationError(
      `${prefix} market mismatch expected=${expected.market} actual=${actual.market}`,
    )
  }
  if (actual.assetId !== expected.assetId) {
    throw new VerificationError(
      `${prefix} asset mismatch expected=${expected.assetId} actual=${actual.assetId}`,
    )
  }
  if (actual.timestamp !== expected.timestamp) {
    throw new VerificationError(
      `${prefix} asset timestamp mismatch expected=${expected.timestamp} actual=${actual.timestamp}`,
    )
  }

  const compareSide = (side: 'bids' | 'asks') => {
    const e = expected[side]
    const a = actual[side]
    if (a.length !== e.length) {
      throw new VerificationError(
        `${prefix} ${side} length mismatch expected=${e.length} actual=${a.length}`,
      )
    }
    for (let i = 0; i < e.length; i += 1) {
      const expectedLevel = e[i]!
      const actualLevel = a[i]!
      if (!levelsEqual(expectedLevel, actualLevel)) {
        throw new VerificationError(
          `${prefix} ${side}[${i}] mismatch expected=${formatLevel(expectedLevel)} actual=${formatLevel(actualLevel)}`,
        )
      }
    }
  }

  compareSide('bids')
  compareSide('asks')
}

function compareSnapshot(args: {
  converter: ConverterName
  expected: ExpectedSnapshot
  actual: MarketOrderBooksSnapshot
}): void {
  const { converter, expected, actual } = args
  const prefix = `[telonex:verify:${converter}] tick=${expected.tickNo} ${expected.reason}`
  if (actual.market !== expected.market) {
    throw new VerificationError(
      `${prefix} market mismatch expected=${expected.market} actual=${actual.market}`,
    )
  }
  if (actual.timestamp !== expected.timestamp) {
    throw new VerificationError(
      `${prefix} strategy tick timestamp mismatch expected=${expected.timestamp} actual=${actual.timestamp}`,
    )
  }
  const expectedAssetIds = Object.keys(expected.byAssetId).sort()
  const actualAssetIds = Object.keys(actual.byAssetId).sort()
  if (!stringArraysEqual(expectedAssetIds, actualAssetIds)) {
    throw new VerificationError(
      `${prefix} asset set mismatch expected=${formatAssetIds(expectedAssetIds)} actual=${formatAssetIds(actualAssetIds)}`,
    )
  }
  for (const [assetId, book] of Object.entries(expected.byAssetId)) {
    compareBook({
      converter,
      expectedTick: expected,
      actual: actual.byAssetId[assetId],
      expected: book,
    })
  }
}

async function verifyPaired(args: { inputs: ConverterInput[]; outputPath: string }): Promise<void> {
  const stats = await convertPaired(args.inputs, args.outputPath)
  if (stats.ticksDropped > 0) {
    throw new VerificationError(
      `[telonex:verify:paired] converter dropped ${stats.ticksDropped} raw row(s); refusing to certify`,
    )
  }

  const expected = createPairedExpectedProvider(args.inputs)
  let actualTicks = 0
  await replayTelonexPairedParquetForMarket({
    filePath: args.outputPath,
    onSnapshot: async (snapshot) => {
      actualTicks += 1
      const expectedTick = await expected.next()
      if (!expectedTick) {
        throw new VerificationError(`[telonex:verify:paired] unexpected extra tick=${actualTicks}`)
      }
      compareSnapshot({ converter: 'paired', expected: expectedTick, actual: snapshot })
    },
  })
  const leftover = await expected.next()
  if (leftover) {
    throw new VerificationError(
      `[telonex:verify:paired] replay ended before all expected ticks were emitted actual=${actualTicks} next_expected_tick=${leftover.tickNo} reason=${leftover.reason}`,
    )
  }
  console.log(
    `[telonex:verify] paired OK raw_ticks=${stats.ticksParsed} dropped=${stats.ticksDropped} output_rows=${stats.rowsWritten} strategy_ticks=${actualTicks}`,
  )
}

async function verifyDelta(args: {
  inputs: ConverterInput[]
  outputPath: string
  bookInterval: number
}): Promise<void> {
  const stats = await createDeltaConverter({ bookInterval: args.bookInterval })(
    args.inputs,
    args.outputPath,
  )
  if (stats.ticksDropped > 0) {
    throw new VerificationError(
      `[telonex:verify:delta] converter dropped ${stats.ticksDropped} raw row(s); refusing to certify`,
    )
  }

  const expected = createDeltaExpectedProvider(args.inputs, args.bookInterval)
  let actualTicks = 0
  await replayOrderBookForMarket({
    filePaths: [args.outputPath],
    onSnapshot: async (snapshot) => {
      actualTicks += 1
      const expectedTick = await expected.next()
      if (!expectedTick) {
        throw new VerificationError(`[telonex:verify:delta] unexpected extra tick=${actualTicks}`)
      }
      compareSnapshot({ converter: 'delta', expected: expectedTick, actual: snapshot })
    },
  })
  const leftover = await expected.next()
  if (leftover) {
    throw new VerificationError(
      `[telonex:verify:delta] replay ended before all expected ticks were emitted actual=${actualTicks} next_expected_tick=${leftover.tickNo} reason=${leftover.reason}`,
    )
  }
  console.log(
    `[telonex:verify] delta OK raw_ticks=${stats.ticksParsed} dropped=${stats.ticksDropped} output_rows=${stats.rowsWritten} strategy_ticks=${actualTicks} book_interval=${args.bookInterval}`,
  )
}

async function verifyDeltaTyped(args: {
  inputs: ConverterInput[]
  outputPath: string
  bookInterval: number
}): Promise<void> {
  const stats = await createDeltaTypedConverter({ bookInterval: args.bookInterval })(
    args.inputs,
    args.outputPath,
  )
  if (stats.ticksDropped > 0) {
    throw new VerificationError(
      `[telonex:verify:delta-typed] converter dropped ${stats.ticksDropped} raw row(s); refusing to certify`,
    )
  }

  const expected = createDeltaExpectedProvider(args.inputs, args.bookInterval)
  let actualTicks = 0
  await replayTelonexDeltaParquetForMarket({
    filePath: args.outputPath,
    onSnapshot: async (snapshot) => {
      actualTicks += 1
      const expectedTick = await expected.next()
      if (!expectedTick) {
        throw new VerificationError(
          `[telonex:verify:delta-typed] unexpected extra tick=${actualTicks}`,
        )
      }
      compareSnapshot({ converter: 'delta-typed', expected: expectedTick, actual: snapshot })
    },
  })
  const leftover = await expected.next()
  if (leftover) {
    throw new VerificationError(
      `[telonex:verify:delta-typed] replay ended before all expected ticks were emitted actual=${actualTicks} next_expected_tick=${leftover.tickNo} reason=${leftover.reason}`,
    )
  }
  console.log(
    `[telonex:verify] delta-typed OK raw_ticks=${stats.ticksParsed} dropped=${stats.ticksDropped} output_rows=${stats.rowsWritten} strategy_ticks=${actualTicks} book_interval=${args.bookInterval}`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const slug = args.slug!
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `telonex-verify-${slug}-`))
  const bucket = getDefaultBucket()
  console.log(
    `[telonex:verify] slug=${slug} converter=${args.converter} book_interval=${args.bookInterval} bucket=${bucket}`,
  )
  console.log(`[telonex:verify] tmp=${tmpDir}`)

  try {
    const mapping = await getMarketMapping(slug)
    console.log(`[telonex:verify] mapping up=${mapping.upAssetId} down=${mapping.downAssetId}`)
    const rawRows = await getRawFileRows(slug)
    const inputs = await downloadRawFiles({ bucket, rawRows, mapping, tmpDir })
    if (!inputs.some((x) => x.side === 'up') || !inputs.some((x) => x.side === 'down')) {
      throw new Error('[telonex:verify] both Up and Down raw rows are required')
    }

    if (args.converter === 'paired' || args.converter === 'both') {
      await verifyPaired({
        inputs,
        outputPath: path.join(tmpDir, 'paired.parquet'),
      })
    }
    if (args.converter === 'delta' || args.converter === 'both') {
      await verifyDelta({
        inputs,
        outputPath: path.join(tmpDir, 'delta.parquet'),
        bookInterval: args.bookInterval,
      })
    }
    if (args.converter === 'delta-typed' || args.converter === 'both') {
      await verifyDeltaTyped({
        inputs,
        outputPath: path.join(tmpDir, 'delta-typed.parquet'),
        bookInterval: args.bookInterval,
      })
    }
    console.log('[telonex:verify] OK')
  } finally {
    await closeDb().catch(() => undefined)
    if (args.keepTemp) {
      console.log(`[telonex:verify] kept temp directory: ${tmpDir}`)
    } else {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
