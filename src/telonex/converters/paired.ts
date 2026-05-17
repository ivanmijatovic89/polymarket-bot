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
  openOutputWriter,
  streamSortedTickGroupsFromInputs,
  type ParsedTick,
} from './parsing.js'
import type { ConverterFn, ConverterStats } from './types.js'

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

function frameToRow(frame: PairFrame, seq: number): PairedOrderbookRow {
  return {
    ingest_seq: BigInt(seq),
    ts_local_ms: frame.localTsUs / 1000n,
    ts_exchange_ms: frame.tsUs / 1000n,
    event_type: 'orderbook_pair',
    market: frame.marketId,
    ...(frame.slug ? { slug: frame.slug } : {}),
    up_asset_id: frame.up.assetId,
    down_asset_id: frame.down.assetId,
    up_bids: encodeLevels(frame.up.bids),
    up_asks: encodeLevels(frame.up.asks),
    down_bids: encodeLevels(frame.down.bids),
    down_asks: encodeLevels(frame.down.asks),
  }
}

async function writePairedFrames(
  ticks: ParsedTick[],
  writer: Awaited<ReturnType<typeof openOutputWriter>>,
): Promise<number> {
  let i = 0
  let lastUp: ParsedTick | undefined
  let lastDown: ParsedTick | undefined
  let rowsWritten = 0

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
      rowsWritten += 1
      await writer.appendRow(
        frameToRow(
          {
            tsUs,
            localTsUs,
            marketId: upTick.marketId,
            slug: upTick.slug ?? downTick.slug,
            up: upTick,
            down: downTick,
          },
          rowsWritten,
        ),
      )
    }
  }
  return rowsWritten
}

async function writePairedGroups(
  inputs: Parameters<typeof streamSortedTickGroupsFromInputs>[0],
  writer: Awaited<ReturnType<typeof openOutputWriter>>,
): Promise<{ rowsWritten: number; ticksParsed: number; ticksDropped: number; filesRead: number }> {
  let lastUp: ParsedTick | undefined
  let lastDown: ParsedTick | undefined
  let rowsWritten = 0
  const stats = await streamSortedTickGroupsFromInputs(inputs, async (group) => {
    group.sort(cmpTick)
    const up = group.filter((x) => x.side === 'up')
    const down = group.filter((x) => x.side === 'down')
    const n = Math.max(up.length, down.length)
    const tsUs = group[0]!.tsUs

    for (let k = 0; k < n; k += 1) {
      const upTick = up[k] ?? lastUp
      const downTick = down[k] ?? lastDown
      if (up[k]) lastUp = up[k]
      if (down[k]) lastDown = down[k]
      if (!upTick || !downTick) continue

      const localTsUs =
        upTick.localTsUs > downTick.localTsUs ? upTick.localTsUs : downTick.localTsUs
      rowsWritten += 1
      await writer.appendRow(
        frameToRow(
          {
            tsUs,
            localTsUs,
            marketId: upTick.marketId,
            slug: upTick.slug ?? downTick.slug,
            up: upTick,
            down: downTick,
          },
          rowsWritten,
        ),
      )
    }
  })
  return {
    rowsWritten,
    ticksParsed: stats.loaded,
    ticksDropped: stats.dropped,
    filesRead: stats.filesRead,
  }
}

export async function convertPairedTicks(args: {
  ticks: ParsedTick[]
  outputPath: string
  filesRead: number
  ticksDropped: number
  alreadySorted?: boolean
}): Promise<ConverterStats> {
  if (args.ticks.length === 0) {
    throw new Error('[telonex:convert:paired] no valid rows parsed from inputs')
  }
  if (!args.alreadySorted) args.ticks.sort(cmpTick)

  const writer = await openOutputWriter(pairedOrderbookParquetSchema, args.outputPath)
  let rowsWritten: number
  try {
    rowsWritten = await writePairedFrames(args.ticks, writer)
  } finally {
    await writer.close()
  }
  if (rowsWritten === 0) {
    throw new Error('[telonex:convert:paired] no paired frames produced')
  }

  return {
    rowsWritten,
    filesRead: args.filesRead,
    ticksParsed: args.ticks.length,
    ticksDropped: args.ticksDropped,
  }
}

export const convertPaired: ConverterFn = async (inputs, outputPath) => {
  if (inputs.length === 0) {
    throw new Error('[telonex:convert:paired] no input files')
  }
  const writer = await openOutputWriter(pairedOrderbookParquetSchema, outputPath)
  let stats: Awaited<ReturnType<typeof writePairedGroups>>
  try {
    stats = await writePairedGroups(inputs, writer)
  } finally {
    await writer.close()
  }
  if (stats.ticksParsed === 0) {
    throw new Error('[telonex:convert:paired] no valid rows parsed from inputs')
  }
  if (stats.rowsWritten === 0) {
    throw new Error('[telonex:convert:paired] no paired frames produced')
  }
  return {
    rowsWritten: stats.rowsWritten,
    filesRead: stats.filesRead,
    ticksParsed: stats.ticksParsed,
    ticksDropped: stats.ticksDropped,
  }
}
