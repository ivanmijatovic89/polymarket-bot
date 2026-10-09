/**
 * One native market job end to end on the TS side, process-per-job (`run`,
 * 20 §5.4): build the `EngineJob` (21 §5, §9) or short-circuit (21 §13),
 * run the binary, validate the result (21 §19), stamp the execution
 * metadata (21 §12) and map it to the `RunSingleMarketOutput` the rest of the
 * app consumes (21 §11). This is the path `--sequential` takes in M3a and
 * the per-job core of the worker shim (40 §5); `serve` replaces only the
 * process step from M5a.
 */
import type { RunSingleMarketOutput } from '../backtest/runSingleMarket.js'
import {
  buildEngineJob,
  type BuildEngineJobOptions,
  type DataRoots,
  type NativeMarketJobData,
} from './buildEngineJob.js'
import { NativeError } from './errors.js'
import { shortCircuitOutput, toRunSingleMarketOutput } from './result.js'
import { runNativeJob, type RunNativeJobOptions } from './runner.js'

/** Native shim slots are displayed as worker child ids `100 + slot` (21 §12, 40 §7.1). */
export const NATIVE_CHILD_ID_BASE = 100

/** Host identity stamped by TS, never sent to the binary (21 §12, P3). */
export interface HostStamps {
  /** `getMachineId()` of the host. */
  machineId: string
  /** The lowest free shim admission index at dispatch. */
  slot: number
  /** The shim's `WORKER_LAUNCH_SHA`. */
  commitSha: string
}

export interface ExecuteNativeMarketOptions {
  /** Verified native binary (`ensureNativeArtifact`). */
  binPath: string
  dataRoots: DataRoots
  /** `engineVersion` recorded at submission (21 §12 echo assertion). */
  engineVersion: string
  host: HostStamps
  build?: BuildEngineJobOptions
  run?: Omit<RunNativeJobOptions, 'engineVersion'>
  /** Shim wall clock (tests); default `Date.now`. */
  now?: () => number
}

/**
 * Runs one single-candidate native market job and returns its
 * `RunSingleMarketOutput`. Failures throw `NativeError` with the 20 §4
 * class and cause; the caller applies the 20 §4.3 retry policy
 * (`retryActionFor`). Group jobs need `run-group`/`serve` (M4/M5a).
 */
export async function executeNativeMarketJob(
  job: NativeMarketJobData,
  opts: ExecuteNativeMarketOptions,
): Promise<RunSingleMarketOutput> {
  if (!Number.isSafeInteger(opts.host.slot) || opts.host.slot < 0) {
    throw new NativeError(
      'invalid_input',
      'args',
      `native shim: bad slot ${opts.host.slot} (a non-negative integer, 21 §12)`,
    )
  }
  if (job.candidates !== undefined && job.candidates.length !== 1) {
    throw new NativeError(
      'invalid_input',
      'params',
      `${job.candidates.length} candidates need run-group or serve (20 §5.5, M4); run takes one`,
    )
  }
  const now = opts.now ?? Date.now
  const t0 = now()
  const built = await buildEngineJob(job, opts.dataRoots, opts.build)
  if (built.kind === 'short_circuit') return shortCircuitOutput(built, job.idx, now() - t0)
  try {
    const out = await runNativeJob(opts.binPath, built.job, {
      ...opts.run,
      engineVersion: opts.engineVersion,
    })
    return toRunSingleMarketOutput(out.result, {
      idx: job.idx,
      stamps: {
        machineId: opts.host.machineId,
        workerChildId: NATIVE_CHILD_ID_BASE + opts.host.slot,
        startedAtMs: out.startedAtMs,
        finishedAtMs: out.finishedAtMs,
        commitSha: opts.host.commitSha,
      },
    })
  } finally {
    await built.cleanup()
  }
}
