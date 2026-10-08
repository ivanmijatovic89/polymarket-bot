import type { ReadFrom } from '../../db/telonexMarkets.js'
import { inheritedStartingCapital, resolveStartingCapital } from '../helpers/capitalArgs.js'
import { intArg, one, paramArgs, type ParsedArgv } from '../../backtest/parity/cliArgs.js'
import {
  DEFAULT_DATA_ROOT,
  paramsFromRun,
  type ParityStrategySelection,
} from '../../backtest/parity/marketJob.js'
import type { RunSingleMarketLatency } from '../../backtest/runSingleMarket.js'

/** Flags shared by ts-trace and run-parity. */
export const JOB_VALUE_FLAGS = [
  'strategy',
  'strategy-artifact',
  'param',
  'params-from-run',
  'latency-delay-ms',
  'latency-jitter-ms',
  'starting-capital',
  'read-from',
  'data-root',
] as const

export type JobOptions = {
  selection: ParityStrategySelection
  latency: RunSingleMarketLatency
  startingCapital: number
  readFrom: ReadFrom
  dataRoot: string
}

/**
 * Strategy + params + engine settings. `--params-from-run <id>` seeds params
 * (and, absent --strategy/--strategy-artifact, the strategy) from a recorded
 * run; explicit `--param` pairs override. Latency defaults to 0/0 (explicit,
 * env-independent: parity runs must be reproducible).
 */
export async function jobOptionsFromArgv(p: ParsedArgv): Promise<JobOptions> {
  let strategyId = one(p, 'strategy')
  let artifactSha256 = one(p, 'strategy-artifact')?.toLowerCase()
  let rawParams: Record<string, unknown> = {}
  let runCapital: number | undefined
  const runId = one(p, 'params-from-run')
  if (runId !== undefined) {
    const run = await paramsFromRun(Number(runId))
    rawParams = { ...run.params }
    if (!strategyId && !artifactSha256) {
      if (run.artifactSha256) artifactSha256 = run.artifactSha256
      else strategyId = run.strategy
    }
    try {
      runCapital = inheritedStartingCapital(run.cmd)
    } catch {
      runCapital = undefined // older run without a recorded allowance → env/default
    }
    console.error(
      `[parity] params from run ${runId}${runCapital !== undefined ? ` (starting capital ${runCapital})` : ''}: ${JSON.stringify(run.params)}`,
    )
  }
  rawParams = { ...rawParams, ...paramArgs(p) }
  if (strategyId && artifactSha256)
    throw new Error('--strategy and --strategy-artifact are mutually exclusive')
  if (!strategyId && !artifactSha256)
    throw new Error(
      'missing --strategy <id>, --strategy-artifact <sha256> or --params-from-run <id>',
    )
  const readFrom = (one(p, 'read-from') ?? 'local') as ReadFrom
  if (readFrom !== 'local' && readFrom !== 'r2')
    throw new Error('--read-from must be local or r2 (parity jobs need a direct dataset path)')
  const capitalRaw = one(p, 'starting-capital')
  return {
    selection: {
      ...(strategyId ? { strategyId } : {}),
      ...(artifactSha256 ? { artifactSha256 } : {}),
      rawParams,
    },
    latency: {
      delayMs: intArg(p, 'latency-delay-ms', 0),
      jitterMs: intArg(p, 'latency-jitter-ms', 0),
    },
    startingCapital:
      capitalRaw === undefined && runCapital !== undefined
        ? runCapital
        : resolveStartingCapital(
            capitalRaw !== undefined ? ['--starting-capital', capitalRaw] : [],
          ),
    readFrom,
    dataRoot: one(p, 'data-root') ?? DEFAULT_DATA_ROOT,
  }
}
