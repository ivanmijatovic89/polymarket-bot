import '../config/env.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Queue, Worker, DelayedError, type Job } from 'bullmq'
import * as IORedisModule from 'ioredis'
import type { Redis, RedisOptions } from 'ioredis'
import { haltWorkerForSelfUpdate } from './commitGate.js'

// ioredis ships its default export under .default for ESM consumers under tsx
// (same indirection as src/backtest/queue.ts).
const RedisCtor: new (options: RedisOptions) => Redis =
  (IORedisModule as unknown as { default: new (o: RedisOptions) => Redis }).default ??
  (IORedisModule as unknown as new (o: RedisOptions) => Redis)

/**
 * Reproduction + fix verification for the self-update ORPHAN bug.
 *
 * Mechanism under test (mirrors src/cli/backtestWorkerChild.ts):
 *  - A concurrency-1 Worker processes jobs one at a time.
 *  - A "gate" job (built on newer code) is released via moveToDelayed + a thrown
 *    DelayedError, and in the catch block the worker triggers a self-update.
 *  - BUG: the current self-update just schedules process.exit() and leaves the
 *    Worker running, so it immediately fetches the NEXT runnable job and then
 *    gets killed mid-flight -> that job is orphaned (stuck active).
 *  - FIX: on self-update the worker must stop fetching new jobs BEFORE exiting.
 *
 * Isolation: unique queue name + Redis DB 15 so it never touches the live
 * backtest-markets/backtest-aggregate queues on DB 0. Fully obliterated at end.
 */

function redisTestConnection(): RedisOptions {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const u = new URL(raw)
  const opts: RedisOptions = {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: 15, // dedicated test DB — keeps us off the production queues on DB 0
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
  if (u.password) opts.password = decodeURIComponent(u.password)
  if (u.username) opts.username = decodeURIComponent(u.username)
  return opts
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Did `p` settle before `ms` elapsed? */
async function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([p.then(() => true), sleep(ms).then(() => false)])
}

/**
 * Run one scenario. `onSelfUpdate` is the seam:
 *  - buggy path: () => {}                (worker keeps fetching)
 *  - fixed path: (w) => { void w.pause() } (worker stops fetching)
 *
 * Returns whether the runnable job Y was grabbed (its processor started).
 */
async function runScenario(onSelfUpdate: (w: Worker) => void): Promise<boolean> {
  // Own the ioredis instance so we can quit() it — passing a plain options
  // object makes BullMQ create connections that linger (auto-reconnect) after
  // close(), keeping the process alive and hanging `node --test`.
  const connection = new RedisCtor(redisTestConnection())
  const queueName = `selfupdate-orphan-test-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
  const queue = new Queue(queueName, { connection })
  const yStarted = deferred()

  const worker = new Worker(
    queueName,
    async (job: Job, token?: string): Promise<string> => {
      try {
        if (job.data.kind === 'gate') {
          // Mirror marketProcessor: release without consuming an attempt.
          await job.moveToDelayed(Date.now() + 60_000, token)
          throw new DelayedError()
        }
        // Runnable job Y — if we get here, the worker grabbed it during the
        // self-update window. In production the process would now be killed
        // mid-flight, orphaning this job.
        yStarted.resolve()
        await sleep(300)
        return 'ok'
      } catch (err) {
        if (err instanceof DelayedError || (err as Error).name === 'DelayedError') {
          onSelfUpdate(worker)
        }
        throw err
      }
    },
    {
      connection,
      concurrency: 1,
      lockDuration: 30_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  )

  await worker.waitUntilReady()
  await queue.waitUntilReady()

  // Enqueue the gate job first, then the runnable job Y right behind it.
  await queue.add('gate', { kind: 'gate' })
  await queue.add('runnable', { kind: 'runnable' })

  // Was Y grabbed within a generous window?
  const grabbed = await settledWithin(yStarted.promise, 2500)

  await worker.close()
  await queue.obliterate({ force: true })
  await queue.close()
  await connection.quit() // close the instance we own so the process can exit

  return grabbed
}

test(
  'REPRO: current self-update leaves the worker fetching -> next job is orphaned',
  {
    timeout: 30_000,
  },
  async () => {
    // Buggy behavior: self-update does nothing to stop the worker.
    const grabbed = await runScenario(() => {
      /* no-op: this is exactly what setTimeout(process.exit) does today */
    })
    assert.equal(
      grabbed,
      true,
      'BUG CONFIRMED expectation: the worker grabs the runnable job during the ' +
        'self-update window (in prod it is then killed -> orphaned/stuck active)',
    )
  },
)

test(
  'FIX: stopping the worker on self-update prevents grabbing the next job',
  {
    timeout: 30_000,
  },
  async () => {
    // Exercise the REAL shipped helper, not a re-implementation.
    const grabbed = await runScenario((w) => {
      haltWorkerForSelfUpdate(w)
    })
    assert.equal(
      grabbed,
      false,
      'FIX expectation: after self-update the worker must NOT grab another job',
    )
  },
)

/**
 * The aggregate worker's self-update goes through drainAndExit, which does
 * `await stopHeartbeat()` (backtestWorker.ts:257) BEFORE `w.close()` (:263).
 * That async gap is a real-but-tiny orphan window that only bites ~1% of the
 * time in production. We make it DETERMINISTIC here by modeling the gap as an
 * explicit `await`, so the race reproduces every run.
 */
const asyncDrainGapMs = 50

test(
  'REPRO (aggregate ordering): stopping the worker only AFTER an async gap orphans the next job',
  {
    timeout: 30_000,
  },
  async () => {
    const grabbed = await runScenario((w) => {
      // Models: requestSelfUpdate -> drainAndExit -> await stopHeartbeat() THEN close().
      void (async () => {
        await sleep(asyncDrainGapMs)
        // the "stop" happens only after the await → too late. Swallow the
        // late-pause rejection that can occur once cleanup starts closing the conn.
        await w.pause().catch(() => {})
      })()
    })
    assert.equal(
      grabbed,
      true,
      'BUG expectation: during the pre-close async gap the aggregate worker grabs ' +
        'the next job (orphaned when the process then exits)',
    )
  },
)

test(
  'FIX (aggregate ordering): halting synchronously BEFORE the async drain closes the gap',
  {
    timeout: 30_000,
  },
  async () => {
    const grabbed = await runScenario((w) => {
      // Models the fix: haltWorkerForSelfUpdate(w) at the TOP of requestSelfUpdate,
      // before any await, then the async drain proceeds.
      haltWorkerForSelfUpdate(w)
      void (async () => {
        await sleep(asyncDrainGapMs) // async drain still runs, but fetch is already stopped
      })()
    })
    assert.equal(
      grabbed,
      false,
      'FIX expectation: a synchronous halt before the async drain leaves no window',
    )
  },
)

/**
 * Regression guard for the review finding. In production the supervisor pauses a
 * worker and then closes it moments later (requestSelfUpdate -> drainAndExit ->
 * w.close()), which rejects the pending pause() with "Connection is closed".
 * These worker processes install NO unhandledRejection handler, so a bare
 * `void w.pause()` would crash the process with exit code 1 instead of the
 * self-update code 75, defeating the self-update.
 *
 * We test the helper's CONTRACT deterministically (no BullMQ/Redis timing): a
 * pause() that rejects must not escape as an unhandled rejection. With a bare
 * `void w.pause()` this test captures the leak; with `.catch()` it stays clean.
 */
test('haltWorkerForSelfUpdate swallows a rejecting pause() (no unhandled rejection)', async () => {
  const captured: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    captured.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    const rejectingWorker: Pick<Worker, 'pause'> = {
      pause: async () => {
        throw new Error('Connection is closed')
      },
    }
    haltWorkerForSelfUpdate(rejectingWorker)
    await sleep(50) // let a would-be unhandled rejection surface on a later tick
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }

  assert.deepEqual(
    captured,
    [],
    `haltWorkerForSelfUpdate leaked an unhandled rejection: ${captured
      .map((r) => (r instanceof Error ? r.message : String(r)))
      .join('; ')}`,
  )
})
