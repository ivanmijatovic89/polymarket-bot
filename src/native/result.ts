/**
 * The shim side of an `EngineResult` (21 §10-§14, §19): validate it against
 * the generated schema and the 21 §12 echo assertions, then map each
 * candidate to the `RunSingleMarketOutput` the rest of the app consumes
 * unchanged (21 P1), with the TS-stamped execution metadata (21 §12).
 */
import type { RunSingleMarketOutput } from '../backtest/runSingleMarket.js'
import type { RecorderV4Capture } from '../recorder-v4/replay/provenance.js'
import { checkEcho } from './contract/echo.js'
import type { EngineJob, EngineResult, ErrorInfo } from './contract/generated.js'
import {
  candidateDurationMs,
  toRunSingleMarketOutput as mapCandidateOutput,
  type ExecutionStamps,
} from './contract/mapping.js'
import { createContractValidators, type ContractValidators } from './contract/validate.js'
import { NativeError } from './errors.js'
import type { BuiltEngineJob } from './buildEngineJob.js'

let validators: ContractValidators | null = null
function contractValidators(): ContractValidators {
  validators ??= createContractValidators()
  return validators
}

/**
 * 21 §19 "TS shim": Ajv against the output schema (with the `decimalScale`
 * keyword of 21 §18 N6), then the 21 §12 echo assertions. A failure is
 * `invalid_output: schema` / `invalid_output: echo_mismatch` for the whole
 * market (all candidates), never the run.
 */
export function validateEngineResult(
  job: EngineJob,
  raw: unknown,
  expected: { engineVersion: string },
): EngineResult {
  const v = contractValidators()
  if (!v.engineResult(raw)) {
    const e = v.lastErrors()[0]
    throw new NativeError(
      'invalid_output',
      'schema',
      `EngineResult fails the schema: ${e ? `${e.instancePath || '/'} ${e.message ?? e.keyword}` : 'invalid'}`,
    )
  }
  const mismatch = checkEcho(job, raw, expected)
  if (mismatch !== null) throw new NativeError(mismatch.class, mismatch.cause, mismatch.message)
  return raw
}

/** Shim context for the mapping (21 §11, §12). */
export interface MappingContext {
  /** `MarketJobData.idx`; never sent to the binary. */
  idx: number
  /** Host and timing stamps; `durationMs` is the job's span (21 §12). */
  stamps: Omit<ExecutionStamps, 'durationMs'>
  /** Token weight of a group job's admission (40 §7.1, 41 §7.4); default 1. */
  weight?: number
  /** Stamped from the V4 manifest (21 §12); absent before M7. */
  recorderV4Capture?: RecorderV4Capture
}

/** One candidate's outcome of a validated result (21 §10, §14). */
export type CandidateOutcome =
  | { key: string; index: number; ok: true; output: RunSingleMarketOutput }
  | { key: string; index: number; ok: false; error: ErrorInfo }

/**
 * Maps a validated result per candidate (21 §11-§14). A group-level error
 * fails the market for every candidate and is thrown. A candidate error is
 * that candidate's failure row (21 §14), except
 * `strategy_fault: result_too_large`, which fails the job (41 §6.2).
 * `durationMs` is the whole span for one candidate and
 * `floor(w × span / k)` for a group (21 §12).
 */
export function mapEngineResult(result: EngineResult, ctx: MappingContext): CandidateOutcome[] {
  if (result.status === 'error') {
    if (result.error === null) {
      throw new NativeError(
        'invalid_output',
        'schema',
        'error result without an error object (21 §10)',
      )
    }
    throw NativeError.fromInfo(result.error)
  }
  const k = result.candidates.length
  const durationMs = candidateDurationMs(
    ctx.stamps.startedAtMs,
    ctx.stamps.finishedAtMs,
    k > 1 || ctx.weight !== undefined ? { weight: ctx.weight ?? 1, candidates: k } : undefined,
  )
  const stamps: ExecutionStamps = { ...ctx.stamps, durationMs }
  return result.candidates.map((c): CandidateOutcome => {
    if (c.status === 'error' || c.output === undefined) {
      const error: ErrorInfo = c.error ?? {
        class: 'invalid_output',
        cause: 'schema',
        message: `candidate ${c.key} has neither output nor error (21 §10)`,
      }
      if (error.class === 'strategy_fault' && error.cause === 'result_too_large') {
        throw NativeError.fromInfo(error)
      }
      return { key: c.key, index: c.index, ok: false, error }
    }
    return {
      key: c.key,
      index: c.index,
      ok: true,
      output: mapCandidateOutput(c.output, ctx.idx, stamps, ctx.recorderV4Capture),
    }
  })
}

/**
 * The single-candidate mapping (21 §11): the candidate's
 * `RunSingleMarketOutput`, or its error thrown as a `NativeError` that fails
 * the BullMQ job with the 20 §4.3 policy (21 §14).
 */
export function toRunSingleMarketOutput(
  result: EngineResult,
  ctx: MappingContext,
): RunSingleMarketOutput {
  const outcomes = mapEngineResult(result, ctx)
  if (outcomes.length !== 1) {
    throw new NativeError(
      'invalid_output',
      'echo_mismatch',
      `single-candidate job returned ${outcomes.length} candidates`,
    )
  }
  const only = outcomes[0]!
  if (!only.ok) throw NativeError.fromInfo(only.error)
  return only.output
}

/**
 * The `RunSingleMarketOutput` of a TS short-circuit (21 §13): no spawn,
 * `marketStats: null`, `eventsProcessed: 0`, and the skip reason.
 */
export function shortCircuitOutput(
  built: Extract<BuiltEngineJob, { kind: 'short_circuit' }>,
  idx: number,
  durationMs: number,
): RunSingleMarketOutput {
  return {
    idx,
    slug: built.slug,
    marketStats: null,
    eventsProcessed: 0,
    eventsByType: {},
    durationMs,
    skipReason: built.skipReason,
  }
}
