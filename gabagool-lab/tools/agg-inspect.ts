/**
 * agg-inspect.ts — inspect aggregate-queue jobs (all states) with failure reasons.
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/agg-inspect.ts             # list jobs per state
 *   npx tsx gabagool-lab/tools/agg-inspect.ts --retry <jobId>   # retry one failed job
 *
 * Read-only unless --retry. Failed aggregate parents are NOT retried by
 * BullMQ automatically in all setups; a run whose parent failed will never
 * persist, so surfacing these fast matters.
 */
import '../../src/config/env.js'
import { getAggregateQueue, closeRedisConnection } from '../../src/backtest/queue.ts'

const retryIdx = process.argv.indexOf('--retry')
const retryId = retryIdx > -1 ? process.argv[retryIdx + 1] : null

const aq = getAggregateQueue()

if (retryId) {
  const job = await aq.getJob(retryId)
  if (!job) {
    console.error(`job ${retryId} not found`)
    process.exit(1)
  }
  await job.retry()
  console.log(`retried job ${retryId} (${job.name})`)
} else {
  for (const state of ['failed', 'waiting-children', 'waiting', 'active', 'delayed', 'completed'] as const) {
    const jobs = await aq.getJobs([state], 0, 30)
    for (const j of jobs) {
      const d = (j.data ?? {}) as Record<string, unknown>
      console.log(
        state,
        '|',
        j.id,
        '|',
        j.name,
        '|',
        JSON.stringify({
          batchUid: d.batchUid,
          submissionUid: d.submissionUid,
          sha: String(d.commitSha ?? '').slice(0, 8),
          attemptsMade: j.attemptsMade,
        }),
        j.failedReason ? `| failedReason: ${String(j.failedReason).slice(0, 300)}` : '',
      )
    }
  }
}

await aq.close()
await closeRedisConnection()
