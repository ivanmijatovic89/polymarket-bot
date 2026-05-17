/**
 * Paired-orderbook converter.
 *
 * Reads Telonex book_snapshot_full parquets for both Up and Down assets,
 * heap-merges by timestamp, pairs ticks with the same `timestamp_us` (or
 * carries forward the last-known side when only one side has a tick at
 * that timestamp), and writes a single `orderbook_pair` parquet using the
 * pairedOrderbookParquetSchema.
 *
 * Previously lived at src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts
 * as a CLI; the dispatcher in src/telonex/convert.ts is now the only entry
 * point.
 */
import { pairedOrderbookParquetSchema } from '../../parquet/io/eventSchema.js'
import {
  cmpTick,
  encodeLevels,
  loadTicksFromFile,
  openOutputWriter,
  type ParsedTick,
} from './parsing.js'
import type { ConverterFn } from './types.js'

type PairFrame = {
  tsUs: bigint
  localTsUs: bigint
  marketId: string
  slug: string | null
  up: ParsedTick
  down: ParsedTick
}

type PairedOrderbookRow = {
  ingest_seq: bigint
  ts_local_ms: bigint
  ts_exchange_ms?: bigint
  event_type: 'orderbook_pair'
  market: string
  slug?: string
  up_asset_id: string
  down_asset_id: string
  up_bids: string
  up_asks: string
  down_bids: string
  down_asks: string
}

function buildPairedFrames(ticks: ParsedTick[]): PairFrame[] {
  const out: PairFrame[] = []
  let i = 0
  let lastUp: ParsedTick | undefined
  let lastDown: ParsedTick | undefined

  while (i < ticks.length) {
    const tsUs = ticks[i]!.tsUs
    const group: ParsedTick[] = []
    while (i < ticks.length && ticks[i]!.tsUs === tsUs) {
      group.push(ticks[i]!)
      i += 1
    }
    group.sort(cmpTick)
    const up = group.filter((x) => x.side === 'up')
    const down = group.filter((x) => x.side === 'down')
    const n = Math.max(up.length, down.length)

    for (let k = 0; k < n; k += 1) {
      const upTick = up[k] ?? lastUp
      const downTick = down[k] ?? lastDown
      if (up[k]) lastUp = up[k]
      if (down[k]) lastDown = down[k]
      if (!upTick || !downTick) continue

      const localTsUs =
        upTick.localTsUs > downTick.localTsUs ? upTick.localTsUs : downTick.localTsUs
      out.push({
        tsUs,
        localTsUs,
        marketId: upTick.marketId,
        slug: upTick.slug ?? downTick.slug,
        up: upTick,
        down: downTick,
      })
    }
  }
  return out
}

export const convertPaired: ConverterFn = async (inputs, outputPath) => {
  if (inputs.length === 0) {
    throw new Error('[telonex:convert:paired] no input files')
  }
  const allTicks: ParsedTick[] = []
  let ticksDropped = 0
  for (const input of inputs) {
    const { ticks, stats } = await loadTicksFromFile(input.filePath, input.side)
    allTicks.push(...ticks)
    ticksDropped += stats.dropped
  }
  if (allTicks.length === 0) {
    throw new Error('[telonex:convert:paired] no valid rows parsed from inputs')
  }
  allTicks.sort(cmpTick)

  const frames = buildPairedFrames(allTicks)
  if (frames.length === 0) {
    throw new Error('[telonex:convert:paired] no paired frames produced')
  }

  const writer = await openOutputWriter(pairedOrderbookParquetSchema, outputPath)
  let rowsWritten = 0
  try {
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i]!
      const row: PairedOrderbookRow = {
        ingest_seq: BigInt(i + 1),
        ts_local_ms: f.localTsUs / 1000n,
        ts_exchange_ms: f.tsUs / 1000n,
        event_type: 'orderbook_pair',
        market: f.marketId,
        ...(f.slug ? { slug: f.slug } : {}),
        up_asset_id: f.up.assetId,
        down_asset_id: f.down.assetId,
        up_bids: encodeLevels(f.up.bids),
        up_asks: encodeLevels(f.up.asks),
        down_bids: encodeLevels(f.down.bids),
        down_asks: encodeLevels(f.down.asks),
      }
      await writer.appendRow(row)
      rowsWritten += 1
    }
  } finally {
    await writer.close()
  }

  return {
    rowsWritten,
    filesRead: inputs.length,
    ticksParsed: allTicks.length,
    ticksDropped,
  }
}
