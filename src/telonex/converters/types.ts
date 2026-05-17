/**
 * Shared interface for Telonex converter functions.
 *
 * The dispatcher (src/telonex/convert.ts) knows which asset_id is Up vs Down
 * from the telonex_markets row, downloads the raw parquets from R2, and
 * passes them in here with the side explicitly set. Converters do not infer
 * side from filenames (the raw Telonex filename only carries asset_id).
 */
export type Side = 'up' | 'down'

export type ConverterInput = {
  filePath: string
  side: Side
}

export type ConverterStats = {
  rowsWritten: number
  filesRead: number
  ticksParsed: number
  ticksDropped: number
}

export type ConverterFn = (inputs: ConverterInput[], outputPath: string) => Promise<ConverterStats>
