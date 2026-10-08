import type { Job } from 'bullmq'
import type { MarketJobData } from '../jobTypes.js'
import { makeMarketProcessor } from '../marketProcessor.js'
import { runSingleMarket, type RunSingleMarketOutput } from '../runSingleMarket.js'
import { ParityTraceRecorder, writeTrace } from './trace.js'

/**
 * Run one `MarketJobData` exactly as a backtest worker does — through the
 * worker's own `makeMarketProcessor` (commit gate, artifact load, input
 * mapping) — with the parity trace observer attached to `runSingleMarket`.
 */
export async function runJobWithTrace(
  job: MarketJobData,
  opts: { quiet?: boolean } = {},
): Promise<{ output: RunSingleMarketOutput; recorder: ParityTraceRecorder }> {
  const tokens = job.marketResolution?.tokenMap
  const recorder = new ParityTraceRecorder({
    UP: tokens?.['UP'] ?? '',
    DOWN: tokens?.['DOWN'] ?? '',
  })
  const processor = makeMarketProcessor({
    machineId: 'parity-ts-trace',
    runMarket: (input) => runSingleMarket({ ...input, observer: recorder.observer }),
  })
  const fakeJob = {
    id: `parity-${job.slug ?? job.idx}`,
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

export async function runJobToTraceFile(
  job: MarketJobData,
  traceFile: string,
  opts: { quiet?: boolean } = {},
): Promise<RunSingleMarketOutput> {
  const { output, recorder } = await runJobWithTrace(job, opts)
  writeTrace(traceFile, recorder.records)
  return output
}
