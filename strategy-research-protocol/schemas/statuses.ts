import { z } from 'zod'

/** Status of a whole family (idea-level). Same enum in INDEX and FAMILY.json. */
export const FamilyStatus = z.enum([
  'proposed', // idea written, not yet worked on
  'active', // has a promoted champion, in use
  'experimental', // experiments running, no champion yet
  'killed', // tried and abandoned (see retryOnlyIf)
  'blocked', // parked on an external blocker (see retryOnlyIf)
])
export type FamilyStatus = z.infer<typeof FamilyStatus>

/** Pipeline position of a single experiment. Flipped by the workers/orchestrator. */
export const ExperimentStatus = z.enum([
  'proposed', // in the queue, nothing run
  'implemented', // code written + registered (variation only)
  'running', // backtest job submitted to the distributed system
  'done', // job finished, results in backtest_runs
])
export type ExperimentStatus = z.infer<typeof ExperimentStatus>

/** Verdict on an experiment. Set by the Evaluator; routed on by the orchestrator. */
export const Decision = z.enum([
  'pending', // not yet evaluated
  'pass', // beat baseline
  'fail', // did not beat baseline
  'iterate', // inconclusive — pick next hypothesis
  'promote', // make this the champion
  'kill', // dead end for this experiment
])
export type Decision = z.infer<typeof Decision>

/** Whether an experiment is a knob sweep on existing code or needs new code. */
export const ExperimentKind = z.enum(['param-search', 'variation'])
export type ExperimentKind = z.infer<typeof ExperimentKind>

/**
 * Pointer to numeric truth in `backtest_runs`.
 * `batch` = many runs grouped (param search); `run` = a single run id.
 */
export const ResultRef = z.object({
  type: z.enum(['batch', 'run']),
  ref: z.string().min(1),
})
export type ResultRef = z.infer<typeof ResultRef>

/** Lowercase-kebab slug, e.g. "book-imbalance". */
export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
