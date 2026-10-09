/** Independent TypeScript oracle for pinned production batch/calendar statistics. */
import { readFileSync } from 'node:fs'
import { computeBatchStats } from '../../src/backtest/stats/batchStats.js'
import {
  computeBacktestSegments,
  type MarketWithStartMs,
} from '../../src/backtest/stats/backtestSegments.js'
const document = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  cases: { name: string; input: { markets: MarketWithStartMs[]; initialCapital: number } }[]
}
const results = document.cases.map(({ name, input }) => ({
  name,
  result: {
    batchStats: computeBatchStats(input.markets, input.initialCapital).toRunColumns(),
    segments: computeBacktestSegments(input.markets, input.initialCapital),
  },
}))
process.stdout.write(JSON.stringify(results))
