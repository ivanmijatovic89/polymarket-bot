import type { Job } from 'bullmq'
import type { MarketJobData } from '../jobTypes.js'
import { makeMarketProcessor } from '../marketProcessor.js'
import { runSingleMarket, type RunSingleMarketOutput } from '../runSingleMarket.js'
import { TraceSummaryAcc, type TraceSummary } from './diff.js'
import {
  ParityTraceRecorder,
  TS_ENGINE_VERSION,
  TraceFileWriter,
  type TraceEmit,
  type TraceLevel,
} from './trace.js'

/**
 * Run one `MarketJobData` exactly as a backtest worker does — through the
 * worker's own `makeMarketProcessor` (commit gate, artifact load, input
 * mapping) — with the parity trace observer attached to `runSingleMarket`
 * (60 OR-4, H-1: the trace `final.stats` is the worker path's output).
 */
export async function runJobWithTrace(
  job: MarketJobData,
  opts: { level: TraceLevel; profile: 'ts-compat'; quiet?: boolean; emit?: TraceEmit },
): Promise<{ output: RunSingleMarketOutput; recorder: ParityTraceRecorder }> {
  if (!job.slug) throw new Error(`parity job ${job.idx} has no slug`)
  const recorder = new ParityTraceRecorder(
    {
      engineVersion: TS_ENGINE_VERSION,
      profile: opts.profile,
      slug: job.slug,
      candidateKey: job.submissionUid,
      level: opts.level,
    },
    job.marketResolution,
    opts.emit,
  )
  const processor = makeMarketProcessor({
    machineId: 'parity-ts-trace',
    runMarket: (input) => runSingleMarket({ ...input, observer: recorder.observer }),
  })
  const fakeJob = {
    id: `parity-${job.slug}`,
    data: job,
    moveToDelayed: async () => {
      throw new Error(
        `job commit ${job.commitSha.slice(0, 8)} is not in this checkout's history — rebuild the job here`,
      )
    },
  } as unknown as Job<MarketJobData>

  const log = console.log
  if (opts.quiet) console.log = () => {}
  try {
    const output = await processor(fakeJob)
    recorder.finish(output)
    return { output, recorder }
  } finally {
    console.log = log
  }
}

/** Run a job and stream its trace to `traceFile` (atomic; nothing is written on failure). */
export async function runJobToTraceFile(
  job: MarketJobData,
  traceFile: string,
  opts: { level: TraceLevel; profile: 'ts-compat'; quiet?: boolean },
): Promise<{ output: RunSingleMarketOutput; summary: TraceSummary }> {
  const writer = new TraceFileWriter(traceFile)
  const summary = new TraceSummaryAcc()
  try {
    const { output } = await runJobWithTrace(job, {
      ...opts,
      emit: (r) => {
        summary.add(r)
        writer.write(r)
      },
    })
    writer.close()
    return { output, summary: summary.s }
  } catch (err) {
    writer.abort()
    throw err
  }
}
