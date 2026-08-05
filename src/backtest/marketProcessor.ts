import { DelayedError, UnrecoverableError, type Job } from 'bullmq'
import { ArtifactShapeError, ensureArtifactLoaded } from '../strategy/artifacts/loader.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import { runSingleMarket } from './runSingleMarket.js'
import type { MarketJobData, MarketJobResult } from './jobTypes.js'
import { WORKER_LAUNCH_SHA, STALE_JOB_RELEASE_DELAY_MS, canRunJobCommit } from './commitGate.js'

/**
 * BullMQ processor for the market queue.
 *
 * Before replaying, the worker checks whether it already has the code the job
 * was built on. If the job needs newer code, the worker releases the job back
 * to the queue (no attempt consumed) and asks its supervisor to pull + restart,
 * rather than running with a stale strategy registry.
 */
export function makeMarketProcessor(args: { machineId: string; workerChildId?: number | null }) {
  return async function marketProcessor(
    job: Job<MarketJobData>,
    token?: string,
  ): Promise<MarketJobResult> {
    const data = job.data

    if (!canRunJobCommit(data.commitSha)) {
      // The job was built on code newer than we loaded. Release it WITHOUT
      // consuming an attempt (moveToDelayed keeps it out of the "active" set so
      // it never counts as stalled when we exit), then ask the supervisor to
      // self-update. The run-worker.sh wrapper pulls the newer commit and
      // relaunches; afterwards this job's commit is in our history → it runs.
      await job.moveToDelayed(Date.now() + STALE_JOB_RELEASE_DELAY_MS, token)
      console.log(
        `[worker] deferring job ${job.id} and requesting update: ` +
          `loaded ${WORKER_LAUNCH_SHA.slice(0, 8)}, job needs ${data.commitSha.slice(0, 8)}`,
      )
      throw new DelayedError()
    }

    // External artifact strategy (issue #211): hash-verified load, cached on
    // disk per machine and memoized per process — no per-market overhead
    // after warm-up. Failures throw (BullMQ retry semantics apply); there is
    // deliberately no fallback to the registry.
    let artifactDefinition: StrategyDefinition<unknown> | undefined
    if (data.strategyArtifact) {
      try {
        artifactDefinition = await ensureArtifactLoaded(data.strategyArtifact)
      } catch (err) {
        // Structural failures are deterministic — retrying re-downloads and
        // re-fails identically; skip the retry ladder. Download and integrity
        // failures stay retryable (transient network / corrupt cache heals).
        if (err instanceof ArtifactShapeError) throw new UnrecoverableError(err.message)
        throw err
      }
      if (artifactDefinition.id !== data.strategyId) {
        throw new UnrecoverableError(
          `[worker] artifact ${data.strategyArtifact.sha256.slice(0, 12)} exports strategy id ` +
            `${JSON.stringify(artifactDefinition.id)} but the job expects ${JSON.stringify(data.strategyId)}`,
        )
      }
    }

    return runSingleMarket({
      idx: data.idx,
      filePath: data.filePath,
      ...(data.r2Fallback ? { r2Fallback: data.r2Fallback } : {}),
      slug: data.slug,
      marketMeta: data.marketMeta,
      marketResolution: data.marketResolution,
      strategyId: data.strategyId,
      strategyParams: data.strategyParams,
      ...(artifactDefinition ? { strategyDefinition: artifactDefinition } : {}),
      inputMode: data.inputMode,
      order: data.order,
      timeDriven: data.timeDriven,
      latency: data.latency,
      strategyWindow: data.strategyWindow,
      ...(data.gammaPriceToBeat !== undefined ? { gammaPriceToBeat: data.gammaPriceToBeat } : {}),
      machineId: args.machineId,
      workerChildId: args.workerChildId ?? null,
      commitSha: WORKER_LAUNCH_SHA,
    })
  }
}
