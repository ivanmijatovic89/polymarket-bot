/**
 * dedupe-flows.ts — remove accidentally duplicated backtest flows.
 *
 * Finds aggregate-queue parents (waiting-children state) that share a
 * batchUid, keeps the OLDEST submission per batchUid, and removes the
 * newer duplicates (their waiting market-children first, then the
 * parent). Active children cannot be removed mid-run; the tool waits
 * for them to drain before removing the parent.
 *
 * Born s3 u15: launch-e003.sh was accidentally invoked twice (second
 * time via a stray --record flag experiment), double-submitting 10
 * flows (~29k duplicate market jobs).
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/dedupe-flows.ts --prefix glab--E003 --dry-run
 *   npx tsx gabagool-lab/tools/dedupe-flows.ts --prefix glab--E003
 */
import '../../src/config/env.js'
import {
  getMarketQueue,
  getAggregateQueue,
  closeRedisConnection,
} from '../../src/backtest/queue.ts'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const prefixIdx = argv.indexOf('--prefix')
const prefix = prefixIdx >= 0 ? argv[prefixIdx + 1] : undefined
if (!prefix) {
  console.error('usage: dedupe-flows.ts --prefix <batchUid-prefix> [--dry-run]')
  process.exit(1)
}

const aq = getAggregateQueue()
const mq = getMarketQueue()

const parents = await aq.getJobs(['waiting-children', 'waiting', 'delayed'])
const mine = parents.filter((j) => String((j.data as any)?.batchUid ?? '').startsWith(prefix))

const byBatch = new Map<string, typeof mine>()
for (const j of mine) {
  const uid = String((j.data as any).batchUid)
  if (!byBatch.has(uid)) byBatch.set(uid, [])
  byBatch.get(uid)!.push(j)
}

let removedParents = 0
let removedChildren = 0
for (const [batchUid, jobs] of byBatch) {
  if (jobs.length < 2) continue
  const sorted = [...jobs].sort((a, b) => a.timestamp - b.timestamp)
  const keep = sorted[0]!
  for (const dup of sorted.slice(1)) {
    const subUid = String((dup.data as any).submissionUid)
    console.log(
      `${dryRun ? '[dry] ' : ''}batch ${batchUid}: keep ${String(
        (keep.data as any).submissionUid,
      ).slice(-12)} (t=${keep.timestamp}), remove ${subUid.slice(-12)} (t=${dup.timestamp})`,
    )
    if (dryRun) continue
    // Parent FIRST, cascading to children. Children-first is a trap:
    // once the last unprocessed child is gone the parent leaves
    // waiting-children and any aggregate worker locks it immediately
    // (bitten s3 u15 — h2-p400 dup aggregated a partial flow).
    // remove() throws if the parent or a child is locked; report and
    // continue with the rest.
    try {
      await dup.remove({ removeChildren: true })
      removedParents++
      console.log(`  removed parent ${subUid.slice(-12)} (+children)`)
    } catch (err) {
      console.log(`  FAILED on ${subUid.slice(-12)}: ${(err as Error).message}`)
    }
  }
}

const mc = await mq.getJobCounts()
const ac = await aq.getJobCounts()
console.log(`\nremoved parents: ${removedParents}${dryRun ? ' (dry-run: 0 executed)' : ''}`)
console.log('markets  :', JSON.stringify(mc))
console.log('aggregate:', JSON.stringify(ac))

await mq.close()
await aq.close()
await closeRedisConnection()
void removedChildren
