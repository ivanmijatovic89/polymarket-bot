/**
 * queue.ts — BullMQ queue status for the lab.
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/queue.ts            # job counts per queue
 *   npx tsx gabagool-lab/tools/queue.ts --sample   # + a few waiting job names
 *
 * Read-only. Uses the repo's own queue module (shared Redis connection),
 * so it works wherever the producer/worker work.
 */
import '../../src/config/env.js' // dotenv side-effect load (queue.ts reads process.env directly)
import {
  getMarketQueue,
  getAggregateQueue,
  closeRedisConnection,
} from '../../src/backtest/queue.ts'

const sample = process.argv.includes('--sample')

const mq = getMarketQueue()
const aq = getAggregateQueue()

const mc = await mq.getJobCounts()
const ac = await aq.getJobCounts()
console.log('markets  :', JSON.stringify(mc))
console.log('aggregate:', JSON.stringify(ac))

if (sample) {
  const waiting = await mq.getJobs(['waiting', 'prioritized'], 0, 9)
  for (const j of waiting) {
    console.log(
      'waiting:',
      j.name,
      JSON.stringify({
        slug: (j.data as any)?.slug,
        batchUid: (j.data as any)?.batchUid ?? (j.data as any)?.submissionUid,
        sha: ((j.data as any)?.commitSha ?? '').slice(0, 8),
      }),
    )
  }
  const active = await mq.getJobs(['active'], 0, 9)
  for (const j of active) {
    console.log('active  :', j.name, JSON.stringify({ slug: (j.data as any)?.slug }))
  }
}

await mq.close()
await aq.close()
await closeRedisConnection()
