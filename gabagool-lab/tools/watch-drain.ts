/**
 * watch-drain.ts — block until the lab's backtest queues are fully
 * drained (market jobs done AND aggregate parents persisted), the
 * worker dies, or a timeout passes. Exit codes / last line:
 *   0 "DRAINED"      — both queues empty; runs should be persisted
 *   2 "WORKER-DEAD"  — no markets-queue worker process found
 *   3 "TIMEOUT"      — deadline hit (arg1 seconds, default 4h)
 *   4 "AGG-FAILURES" — aggregate failed-count rose above baseline (arg2)
 *
 * Usage: npx tsx gabagool-lab/tools/watch-drain.ts [timeoutSec] [aggFailedBaseline]
 */
import '../../src/config/env.js'
import { execSync } from 'node:child_process'
import {
  getMarketQueue,
  getAggregateQueue,
  closeRedisConnection,
} from '../../src/backtest/queue.ts'

const timeoutSec = Number(process.argv[2] ?? 14_400)
const aggFailedBaseline = Number(process.argv[3] ?? 3)
const deadline = Date.now() + timeoutSec * 1000

const mq = getMarketQueue()
const aq = getAggregateQueue()

async function finish(msg: string, code: number): Promise<never> {
  console.log(msg)
  await mq.close().catch(() => {})
  await aq.close().catch(() => {})
  await closeRedisConnection().catch(() => {})
  process.exit(code)
}

function workerAlive(): boolean {
  try {
    execSync('pgrep -f "backtestWorker.ts --queues markets"', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

for (;;) {
  if (Date.now() > deadline) await finish('TIMEOUT', 3)
  if (!workerAlive()) await finish('WORKER-DEAD', 2)
  const mc = await mq.getJobCounts()
  const ac = await aq.getJobCounts()
  const mPending =
    (mc.waiting ?? 0) + (mc.active ?? 0) + (mc.prioritized ?? 0) + (mc.delayed ?? 0)
  const aPending =
    (ac['waiting-children'] ?? 0) + (ac.waiting ?? 0) + (ac.active ?? 0) + (ac.delayed ?? 0)
  const aFailed = ac.failed ?? 0
  console.log(
    `${new Date().toISOString()} markets pending=${mPending} aggregate pending=${aPending} failed=${aFailed}`,
  )
  if (aFailed > aggFailedBaseline) await finish('AGG-FAILURES', 4)
  if (mPending === 0 && aPending === 0) await finish('DRAINED', 0)
  await new Promise((r) => setTimeout(r, 60_000))
}
