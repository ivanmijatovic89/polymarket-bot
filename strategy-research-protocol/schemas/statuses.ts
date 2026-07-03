import { z } from 'zod'

/**
 * Family lifecycle. One owner per transition:
 *
 *   proposed    — set by ProposeFamily when the folder is created
 *   researching — set by the Researcher on the first submission
 *   validated   — set by the Evaluator when a champion passes the final
 *                 stage gate (research CONTINUES: challengers keep coming)
 *   killed      — set by the Researcher per STAGE-GATES.md stopping rules;
 *                 requires a concrete `retryOnlyIf`
 *   live        — set by the USER only; trading real money
 *
 * `validated` is not terminal for research; `killed` is terminal until the
 * retry condition is met. There is deliberately no "backtested"-style status
 * anywhere: whether runs are finished is operational state owned by the DB
 * and queried via checkBatch, never stored in files.
 */
export const FamilyStatus = z.enum(['proposed', 'researching', 'validated', 'killed', 'live'])
export type FamilyStatus = z.infer<typeof FamilyStatus>

/**
 * Experiment lifecycle. Each status is written by the actor at the moment it
 * acts — no status describes something that happened elsewhere:
 *
 *   queued    — Researcher: spec AND code complete, ready to submit
 *   running   — Researcher: submitted; batchUid + submissionUids recorded
 *   evaluated — Evaluator: outcome fully written
 *   aborted   — Researcher: permanently failed / superseded, with reason
 */
export const ExperimentStatus = z.enum(['queued', 'running', 'evaluated', 'aborted'])
export type ExperimentStatus = z.infer<typeof ExperimentStatus>

/**
 * Verdict on an evaluated experiment, set by the Evaluator inside `outcome`.
 * Answers exactly one question: did the experiment meet its pre-declared
 * `successCriteria`? Promotion is NOT a verdict — the Evaluator moves the
 * family `champion` pointer as a consequence of `success`.
 */
export const Verdict = z.enum(['success', 'fail', 'inconclusive'])
export type Verdict = z.infer<typeof Verdict>

/** Whether an experiment is a knob search on existing code or needs new code. */
export const ExperimentKind = z.enum(['param-search', 'variation'])
export type ExperimentKind = z.infer<typeof ExperimentKind>

/** Lowercase-kebab slug, e.g. "book-imbalance". */
export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)

/** Local experiment id, e.g. "000-baseline" or "002-persistence-filter". */
export const ExperimentId = z.string().regex(/^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*$/)
export type ExperimentId = z.infer<typeof ExperimentId>
