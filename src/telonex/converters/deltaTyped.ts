/**
 * Typed delta converter.
 *
 * Emits the same live-style strategy cadence as the raw-json delta converter:
 * periodic full `book` snapshots and interleaved combined `price_change`
 * events. The output stores one parquet row per strategy-visible event, with
 * flat typed repeated primitive columns instead of raw_json or delimited strings.
 */
import { typedDeltaMarketEventParquetSchema } from '../../parquet/io/eventSchema.js'
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
  assetId: string
  price: string
  size: string
  side: 'BUY' | 'SELL'
}

type WriterState = {
  eventSeq: bigint
  rowsWritten: number
  assetIds: string[]
  assetIndexById: Map<string, number>
}

function getAssetIndex(state: WriterState, assetId: string): number {
  const existing = state.assetIndexById.get(assetId)
  if (existing !== undefined) return existing
  const next = state.assetIds.length
  if (next > 1) {
    throw new Error(`[telonex:convert:delta-typed] expected at most 2 assets, got ${next + 1}`)
  }
  state.assetIds.push(assetId)
  state.assetIndexById.set(assetId, next)
  return next
}

function commonAssetColumns(state: WriterState): { asset0_id?: string; asset1_id?: string } {
  return {
    ...(state.assetIds[0] ? { asset0_id: state.assetIds[0] } : {}),
    ...(state.assetIds[1] ? { asset1_id: state.assetIds[1] } : {}),
  }
}

function sideCode(side: 'BUY' | 'SELL'): number {
  return side === 'BUY' ? 0 : 1
}

function appendItems<T>(dest: T[], src: T[]): void {
  for (const item of src) dest.push(item)
}

function computeDelta(tick: ParsedTick, state: AssetState): PriceChangeEntry[] {
  const changes: PriceChangeEntry[] = []
  for (const lvl of tick.bids) {
    const p = Number(lvl.price)
    const s = Number(lvl.size)
    if (state.bids.get(p)?.size !== s) {
      changes.push({ assetId: tick.assetId, price: lvl.price, size: lvl.size, side: 'BUY' })
    }
  }
  const newBidPrices = new Set(tick.bids.map((l) => Number(l.price)))
  for (const [price, entry] of state.bids) {
    if (!newBidPrices.has(price)) {
      changes.push({ assetId: tick.assetId, price: entry.priceStr, size: '0', side: 'BUY' })
    }
  }
  for (const lvl of tick.asks) {
    const p = Number(lvl.price)
    const s = Number(lvl.size)
    if (state.asks.get(p)?.size !== s) {
      changes.push({ assetId: tick.assetId, price: lvl.price, size: lvl.size, side: 'SELL' })
    }
  }
  const newAskPrices = new Set(tick.asks.map((l) => Number(l.price)))
  for (const [price, entry] of state.asks) {
    if (!newAskPrices.has(price)) {
      changes.push({ assetId: tick.assetId, price: entry.priceStr, size: '0', side: 'SELL' })
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
  eventCount: number
  bookCount: number
  deltaCount: number
  emptyDeltaCount: number
}

async function appendBookEvent(args: {
  writer: Awaited<ReturnType<typeof openOutputWriter>>
  state: WriterState
  tick: ParsedTick
  tsUs: bigint
}): Promise<void> {
  const { writer, state, tick, tsUs } = args
  const eventSeq = state.eventSeq++
  const assetIndex = getAssetIndex(state, tick.assetId)
  const common = {
    ingest_seq: eventSeq,
    ts_local_ms: tick.localTsUs / 1000n,
    ts_exchange_ms: tsUs / 1000n,
    event_type: 'book',
    market: tick.marketId,
    asset_index: assetIndex,
    ...commonAssetColumns(state),
  }
  await writer.appendRow({
    ...common,
    bid_prices: tick.bids.map((lvl) => lvl.price),
    bid_sizes: tick.bids.map((lvl) => lvl.size),
    ask_prices: tick.asks.map((lvl) => lvl.price),
    ask_sizes: tick.asks.map((lvl) => lvl.size),
    change_asset_indexes: [],
    change_side_codes: [],
    change_prices: [],
    change_sizes: [],
  })
  state.rowsWritten += 1
}

async function appendPriceChangeEvent(args: {
  writer: Awaited<ReturnType<typeof openOutputWriter>>
  state: WriterState
  changes: PriceChangeEntry[]
  tsLocalUs: bigint
  tsUs: bigint
  marketId: string
}): Promise<void> {
  const { writer, state, changes, tsLocalUs, tsUs, marketId } = args
  const eventSeq = state.eventSeq++
  const changeAssetIndexes = changes.map((change) => getAssetIndex(state, change.assetId))
  await writer.appendRow({
    ingest_seq: eventSeq,
    ts_local_ms: tsLocalUs / 1000n,
    ts_exchange_ms: tsUs / 1000n,
    event_type: 'price_change',
    market: marketId,
    ...commonAssetColumns(state),
    bid_prices: [],
    bid_sizes: [],
    ask_prices: [],
    ask_sizes: [],
    change_asset_indexes: changeAssetIndexes,
    change_side_codes: changes.map((change) => sideCode(change.side)),
    change_prices: changes.map((change) => change.price),
    change_sizes: changes.map((change) => change.size),
  })
  state.rowsWritten += 1
}

async function writeOutputGroups(
  inputs: Parameters<typeof streamSortedTickGroupsFromInputs>[0],
  bookInterval: number,
  writer: Awaited<ReturnType<typeof openOutputWriter>>,
): Promise<BuildStats & { filesRead: number; ticksParsed: number; ticksDropped: number }> {
  const stateByAsset = new Map<string, AssetState>()
  const writerState: WriterState = {
    eventSeq: 1n,
    rowsWritten: 0,
    assetIds: [],
    assetIndexById: new Map(),
  }
  let eventCount = 0
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
          await appendBookEvent({ writer, state: writerState, tick, tsUs })
          eventCount += 1
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
        await appendPriceChangeEvent({
          writer,
          state: writerState,
          changes: combinedChanges,
          tsLocalUs: maxLocalTsUs,
          tsUs,
          marketId,
        })
        eventCount += 1
        deltaCount += 1
      }
    }
  })

  return {
    rowsWritten: writerState.rowsWritten,
    eventCount,
    bookCount,
    deltaCount,
    emptyDeltaCount,
    filesRead: streamStats.filesRead,
    ticksParsed: streamStats.loaded,
    ticksDropped: streamStats.dropped,
  }
}

export type DeltaTypedConverterOptions = {
  bookInterval?: number
}

export function createDeltaTypedConverter(opts: DeltaTypedConverterOptions = {}): ConverterFn {
  const bookInterval = opts.bookInterval ?? DEFAULT_BOOK_INTERVAL
  return async (inputs, outputPath): Promise<ConverterStats> => {
    if (inputs.length === 0) throw new Error('[telonex:convert:delta-typed] no input files')
    const writer = await openOutputWriter(typedDeltaMarketEventParquetSchema, outputPath)
    let stats: Awaited<ReturnType<typeof writeOutputGroups>>
    try {
      stats = await writeOutputGroups(inputs, bookInterval, writer)
    } finally {
      await writer.close()
    }
    if (stats.ticksParsed === 0) {
      throw new Error('[telonex:convert:delta-typed] no valid rows parsed from inputs')
    }
    if (stats.rowsWritten === 0) {
      throw new Error('[telonex:convert:delta-typed] no output rows produced')
    }
    return {
      rowsWritten: stats.rowsWritten,
      filesRead: stats.filesRead,
      ticksParsed: stats.ticksParsed,
      ticksDropped: stats.ticksDropped,
    }
  }
}

export const convertDeltaTyped: ConverterFn = createDeltaTypedConverter()
