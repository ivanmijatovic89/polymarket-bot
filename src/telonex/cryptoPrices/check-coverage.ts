import '../../config/env.js'
import { runFeedCoverageCheck } from '../../cli/helpers/feedCoverageCheck.js'

runFeedCoverageCheck('chainlink', process.argv.slice(2)).catch((error: unknown) => {
  console.error('[chainlink:coverage]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
