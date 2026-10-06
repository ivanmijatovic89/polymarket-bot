import { readFile, writeFile } from 'node:fs/promises'
import { computeBatchStats } from '../../src/backtest/stats/batchStats.js'
import { computeBacktestSegments } from '../../src/backtest/stats/backtestSegments.js'
const [inputPath, outputPath] = process.argv.slice(2)
const input = JSON.parse(await readFile(inputPath!, 'utf8'))
await writeFile(
  outputPath!,
  JSON.stringify({
    batch: computeBatchStats(input.markets, input.initialCapital).toRunColumns(),
    segments: computeBacktestSegments(input.markets, input.initialCapital),
  }),
)
