/**
 * Shim-side echo assertions (21 §12) and the effective ModelConfig of a
 * candidate (21 §1.1, §8 C4). Pure functions over generated contract types,
 * for the worker shim and the producer.
 */
import { modelConfigSha256 } from './canonicalJson.js'
import type {
  EngineJob,
  EngineResult,
  ErrorClass,
  ExecutionConfig,
  ModelConfig,
} from './generated.js'

/**
 * Error classes a group-level error may have when it is raised before the job
 * is read, so the result carries no echo (21 §10; pmb-contract
 * `ErrorClass::may_precede_job_read`).
 */
const PRE_READ_CLASSES: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  'invalid_input',
  'runtime',
  'engine_fault',
])

/** A classified contract failure (20 §4: class and cause). */
export interface ContractFailure {
  class: 'invalid_output'
  cause: 'echo_mismatch'
  message: string
}

/**
 * The effective ModelConfig of a candidate: the run's ModelConfig with
 * `execution` replaced by the candidate's when that is non-null (21 §1.1).
 */
export function effectiveModelConfig(
  run: ModelConfig,
  execution: ExecutionConfig | null,
): ModelConfig {
  return execution === null ? run : { ...run, execution }
}

/** `modelConfigSha256` of every candidate's effective ModelConfig, in order. */
export function candidateModelConfigSha256(job: EngineJob): string[] {
  return job.run.candidates.map((c) =>
    modelConfigSha256(effectiveModelConfig(job.run.modelConfig, c.execution)),
  )
}

/**
 * The 21 §12 assertions before mapping a result: echo profile, seed,
 * rulesTableVersion, snapshotParserVersion and modelConfigSha256 equal the
 * request; each candidate's modelConfigSha256 equals its effective
 * ModelConfig's; engineVersion equals the value recorded at submission;
 * market.slug equals the job's; candidate keys and indices match the request
 * in order. Returns null when everything matches, else `invalid_output:
 * echo_mismatch` (one market, all candidates; 21 §19).
 *
 * A group-level error result emitted before the job was read carries no echo
 * (21 §10); it is reported by its own error, so it is not a mismatch here.
 * Only the classes that can be raised before the job is read may omit it
 * (`ErrorClass::may_precede_job_read` in pmb-contract).
 */
export function checkEcho(
  job: EngineJob,
  result: EngineResult,
  expected: { engineVersion: string },
): ContractFailure | null {
  const mismatch = (what: string, got: unknown, want: unknown): ContractFailure => ({
    class: 'invalid_output',
    cause: 'echo_mismatch',
    message: `${what}: engine echoed ${JSON.stringify(got)}, request has ${JSON.stringify(want)}`,
  })
  if (result.echo === null || result.market === null) {
    const cls = result.error?.class
    return result.status === 'error' &&
      cls !== undefined &&
      PRE_READ_CLASSES.has(cls) &&
      result.candidates.length === 0
      ? null
      : mismatch('echo', null, 'present (only a pre-read group error omits it)')
  }
  const mc = job.run.modelConfig
  const echo = result.echo
  const pairs: Array<[string, unknown, unknown]> = [
    ['echo.profile', echo.profile, mc.profile],
    ['echo.seed', echo.seed, mc.seed],
    ['echo.rulesTableVersion', echo.rulesTableVersion, mc.rules.rulesTableVersion],
    [
      'echo.snapshotParserVersion',
      echo.snapshotParserVersion,
      job.market.rules.snapshotParserVersion,
    ],
    ['echo.modelConfigSha256', echo.modelConfigSha256, modelConfigSha256(mc)],
    ['echo.engineVersion', echo.engineVersion, expected.engineVersion],
    ['echo.strategyId', echo.strategyId, job.run.strategyId],
    ['echo.jobSchemaVersion', echo.jobSchemaVersion, job.jobSchemaVersion],
    ['market.slug', result.market.slug, job.market.slug],
  ]
  for (const [what, got, want] of pairs) {
    if (got !== want) return mismatch(what, got, want)
  }
  // A group-level error may carry no candidate results (21 §10, §14); its
  // own error is the outcome then.
  if (result.status === 'error' && result.candidates.length === 0) return null
  const shas = candidateModelConfigSha256(job)
  const requested = job.run.candidates
  if (result.candidates.length !== requested.length) {
    return mismatch('candidates.length', result.candidates.length, requested.length)
  }
  for (const [i, c] of result.candidates.entries()) {
    const want = requested[i]!
    if (c.key !== want.key) return mismatch(`candidates[${i}].key`, c.key, want.key)
    if (c.index !== want.index) return mismatch(`candidates[${i}].index`, c.index, want.index)
    if (c.modelConfigSha256 !== shas[i]) {
      return mismatch(`candidates[${i}].modelConfigSha256`, c.modelConfigSha256, shas[i])
    }
  }
  return null
}
