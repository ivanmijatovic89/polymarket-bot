/**
 * Delta converter — emits a live-style raw_market_event parquet of `book`
 * snapshots interleaved with `price_change` deltas, modelled on the format
 * the live recorder produces. Both Up and Down ticks at the same exchange
 * timestamp are combined into a single price_change.
 *
 * Previously lived at src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts
 * as a CLI; the dispatcher in src/telonex/convert.ts is now the only entry
 * point.
 */
import { rawMarketEventParquetSchema } from '../../parquet/io/eventSchema.js'
import {
  cmpTick,
  openOutputWriter,
  streamSortedTickGroupsFromInputs,
  type ParsedTick,
} from './parsing.js'
import type { ConverterFn, ConverterStats } from './types.js'

const DEFAULT_BOOK_INTERVAL = 500

type LevelEntry = { size: number; priceStr: string }
type AssetState = {
  bids: Map<number, LevelEntry>
  asks: Map<number, LevelEntry>
  ticksSinceBook: number
}

type PriceChangeEntry = {
  asset_id: string
  price: string
  size: string
  side: 'BUY' | 'SELL'
  hash: string
  best_bid: string
  best_ask: string
}

function appendItems<T>(dest: T[], src: T[]): void {
  for (const item of src) dest.push(item)
}

function buildBookJson(tick: ParsedTick): string {
  return JSON.stringify({
    event_type: 'book',
    asset_id: tick.assetId,
    market: tick.marketId,
    timestamp: String(tick.tsUs / 1000n),
    hash: '',
    bids: tick.bids,
    asks: tick.asks,
  })
}

function computeDelta(tick: ParsedTick, state: AssetState): PriceChangeEntry[] {
  const changes: PriceChangeEntry[] = []
  for (const lvl of tick.bids) {
    const p = Number(lvl.price)
    const s = Number(lvl.size)
    if (state.bids.get(p)?.size !== s) {
      changes.push({
        asset_id: tick.assetId,
        price: lvl.price,
        size: lvl.size,
        side: 'BUY',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }
  const newBidPrices = new Set(tick.bids.map((l) => Number(l.price)))
  for (const [price, entry] of state.bids) {
    if (!newBidPrices.has(price)) {
      changes.push({
        asset_id: tick.assetId,
        price: entry.priceStr,
        size: '0',
        side: 'BUY',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }
  for (const lvl of tick.asks) {
    const p = Number(lvl.price)
    const s = Number(lvl.size)
    if (state.asks.get(p)?.size !== s) {
      changes.push({
        asset_id: tick.assetId,
        price: lvl.price,
        size: lvl.size,
        side: 'SELL',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }
  const newAskPrices = new Set(tick.asks.map((l) => Number(l.price)))
  for (const [price, entry] of state.asks) {
    if (!newAskPrices.has(price)) {
      changes.push({
        asset_id: tick.assetId,
        price: entry.priceStr,
        size: '0',
        side: 'SELL',
        hash: '',
        best_bid: '',
        best_ask: '',
      })
    }
  }
  return changes
}

function updateAssetState(state: AssetState, tick: ParsedTick): void {
  state.bids = new Map(
    tick.bids.map((l) => [Number(l.price), { size: Number(l.size), priceStr: l.price }]),
  )
  state.asks = new Map(
    tick.asks.map((l) => [Number(l.price), { size: Number(l.size), priceStr: l.price }]),
  )
}

type BuildStats = {
  rowsWritten: number
  bookCount: number
  deltaCount: number
  emptyDeltaCount: number
}

async function writeOutputRows(
  ticks: ParsedTick[],
  bookInterval: number,
  writer: Awaited<ReturnType<typeof openOutputWriter>>,
): Promise<BuildStats> {
  const stateByAsset = new Map<string, AssetState>()
  let seq = 1n
  let rowsWritten = 0
  let bookCount = 0
  let deltaCount = 0
  let emptyDeltaCount = 0
  let i = 0

  while (i < ticks.length) {
    const tsUs = ticks[i]!.tsUs
    const upTicks: ParsedTick[] = []
    const downTicks: ParsedTick[] = []
    while (i < ticks.length && ticks[i]!.tsUs === tsUs) {
      const t = ticks[i]!
      if (t.side === 'up') upTicks.push(t)
      else downTicks.push(t)
      i += 1
    }

    const n = Math.max(upTicks.length, downTicks.length)
    const marketId = (upTicks[0] ?? downTicks[0])!.marketId

    for (let k = 0; k < n; k += 1) {
      const pair = [upTicks[k], downTicks[k]].filter(Boolean) as ParsedTick[]
      const combinedChanges: PriceChangeEntry[] = []
      let maxLocalTsUs = 0n

      for (const tick of pair) {
        if (tick.localTsUs > maxLocalTsUs) maxLocalTsUs = tick.localTsUs
        let state = stateByAsset.get(tick.assetId)

        if (!state || state.ticksSinceBook >= bookInterval) {
          await writer.appendRow({
            ingest_seq: seq++,
            ts_local_ms: tick.localTsUs / 1000n,
            ts_exchange_ms: tsUs / 1000n,
            event_type: 'book',
            raw_json: buildBookJson(tick),
          })
          rowsWritten += 1
          bookCount += 1
          if (!state) {
            state = { bids: new Map(), asks: new Map(), ticksSinceBook: 0 }
            stateByAsset.set(tick.assetId, state)
          }
          updateAssetState(state, tick)
          state.ticksSinceBook = 1
        } else {
          const changes = computeDelta(tick, state)
          updateAssetState(state, tick)
          state.ticksSinceBook += 1
          if (changes.length === 0) emptyDeltaCount += 1
          else appendItems(combinedChanges, changes)
        }
      }

      if (combinedChanges.length > 0) {
        await writer.appendRow({
          ingest_seq: seq++,
          ts_local_ms: maxLocalTsUs / 1000n,
          ts_exchange_ms: tsUs / 1000n,
          event_type: 'price_change',
          raw_json: JSON.stringify({
            event_type: 'price_change',
            market: marketId,
            timestamp: String(tsUs / 1000n),
            price_changes: combinedChanges,
          }),
        })
        rowsWritten += 1
        deltaCount += 1
      }
    }
  }
  return { rowsWritten, bookCount, deltaCount, emptyDeltaCount }
}

async function writeOutputGroups(
  inputs: Parameters<typeof streamSortedTickGroupsFromInputs>[0],
  bookInterval: number,
  writer: Awaited<ReturnType<typeof openOutputWriter>>,
): Promise<BuildStats & { filesRead: number; ticksParsed: number; ticksDropped: number }> {
  const stateByAsset = new Map<string, AssetState>()
  let seq = 1n
  let rowsWritten = 0
  let bookCount = 0
  let deltaCount = 0
  let emptyDeltaCount = 0

  const streamStats = await streamSortedTickGroupsFromInputs(inputs, async (group) => {
    group.sort(cmpTick)
    const tsUs = group[0]!.tsUs
    const upTicks = group.filter((x) => x.side === 'up')
    const downTicks = group.filter((x) => x.side === 'down')
    const n = Math.max(upTicks.length, downTicks.length)
    const marketId = (upTicks[0] ?? downTicks[0])!.marketId

    for (let k = 0; k < n; k += 1) {
      const pair = [upTicks[k], downTicks[k]].filter(Boolean) as ParsedTick[]
      const combinedChanges: PriceChangeEntry[] = []
      let maxLocalTsUs = 0n

      for (const tick of pair) {
        if (tick.localTsUs > maxLocalTsUs) maxLocalTsUs = tick.localTsUs
        let state = stateByAsset.get(tick.assetId)

        if (!state || state.ticksSinceBook >= bookInterval) {
          await writer.appendRow({
            ingest_seq: seq++,
            ts_local_ms: tick.localTsUs / 1000n,
            ts_exchange_ms: tsUs / 1000n,
            event_type: 'book',
            raw_json: buildBookJson(tick),
          })
          rowsWritten += 1
          bookCount += 1
          if (!state) {
            state = { bids: new Map(), asks: new Map(), ticksSinceBook: 0 }
            stateByAsset.set(tick.assetId, state)
          }
          updateAssetState(state, tick)
          state.ticksSinceBook = 1
        } else {
          const changes = computeDelta(tick, state)
          updateAssetState(state, tick)
          state.ticksSinceBook += 1
          if (changes.length === 0) emptyDeltaCount += 1
          else appendItems(combinedChanges, changes)
        }
      }

      if (combinedChanges.length > 0) {
        await writer.appendRow({
          ingest_seq: seq++,
          ts_local_ms: maxLocalTsUs / 1000n,
          ts_exchange_ms: tsUs / 1000n,
          event_type: 'price_change',
          raw_json: JSON.stringify({
            event_type: 'price_change',
            market: marketId,
            timestamp: String(tsUs / 1000n),
            price_changes: combinedChanges,
          }),
        })
        rowsWritten += 1
        deltaCount += 1
      }
    }
  })

  return {
    rowsWritten,
    bookCount,
    deltaCount,
    emptyDeltaCount,
    filesRead: streamStats.filesRead,
    ticksParsed: streamStats.loaded,
    ticksDropped: streamStats.dropped,
  }
}

export type DeltaConverterOptions = {
  bookInterval?: number
}

export async function convertDeltaTicks(args: {
  ticks: ParsedTick[]
  outputPath: string
  filesRead: number
  ticksDropped: number
  bookInterval?: number
  alreadySorted?: boolean
}): Promise<ConverterStats> {
  const bookInterval = args.bookInterval ?? DEFAULT_BOOK_INTERVAL
  if (args.ticks.length === 0) {
    throw new Error('[telonex:convert:delta] no valid rows parsed from inputs')
  }
  if (!args.alreadySorted) args.ticks.sort(cmpTick)

  const writer = await openOutputWriter(rawMarketEventParquetSchema, args.outputPath)
  let stats: BuildStats
  try {
    stats = await writeOutputRows(args.ticks, bookInterval, writer)
  } finally {
    await writer.close()
  }
  if (stats.rowsWritten === 0) {
    throw new Error('[telonex:convert:delta] no output rows produced')
  }

  return {
    rowsWritten: stats.rowsWritten,
    filesRead: args.filesRead,
    ticksParsed: args.ticks.length,
    ticksDropped: args.ticksDropped,
  }
}

export function createDeltaConverter(opts: DeltaConverterOptions = {}): ConverterFn {
  const bookInterval = opts.bookInterval ?? DEFAULT_BOOK_INTERVAL
  return async (inputs, outputPath): Promise<ConverterStats> => {
    if (inputs.length === 0) throw new Error('[telonex:convert:delta] no input files')
    const writer = await openOutputWriter(rawMarketEventParquetSchema, outputPath)
    let stats: Awaited<ReturnType<typeof writeOutputGroups>>
    try {
      stats = await writeOutputGroups(inputs, bookInterval, writer)
    } finally {
      await writer.close()
    }
    if (stats.ticksParsed === 0) {
      throw new Error('[telonex:convert:delta] no valid rows parsed from inputs')
    }
    if (stats.rowsWritten === 0) {
      throw new Error('[telonex:convert:delta] no output rows produced')
    }
    return {
      rowsWritten: stats.rowsWritten,
      filesRead: stats.filesRead,
      ticksParsed: stats.ticksParsed,
      ticksDropped: stats.ticksDropped,
    }
  }
}

export const convertDelta: ConverterFn = createDeltaConverter()
