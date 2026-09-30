import '../config/env.js'
import { runFeedCoverageCheck } from '../cli/helpers/feedCoverageCheck.js'

runFeedCoverageCheck('binance', process.argv.slice(2)).catch((error: unknown) => {
  console.error('[binance:coverage]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
