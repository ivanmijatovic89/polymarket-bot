import { z } from 'zod'
import {
  ExperimentId,
  ExperimentKind,
  ExperimentStatus,
  FamilyStatus,
  Slug,
  Verdict,
} from './statuses.js'

/** A single sweepable param value. */
const ParamValue = z.union([z.string(), z.number(), z.boolean()])

/**
 * One pass of a coordinate search: sweeps exactly ONE param while the others
 * stay at defaults / previous winners. Pass state is DERIVED from fields —
 * there is no status enum:
 *   submissionUids empty          → not submitted
 *   submissionUids set, best null → awaiting judgment
 *   best set                      → judged
 */
export const Pass = z.object({
  /** the one param this pass sweeps */
  param: z.string().min(1),
  /** values tested in this pass */
  values: z.array(ParamValue).min(1),
  /** grouping label: `<family>--<exp>--pN-<param>` (rules/NAMING.md) */
  batchUid: z.string().min(1),
  /** exact run handles, identical in Redis and backtest_runs.submission_uid */
  submissionUids: z.array(z.string().min(1)).default([]),
  /** winning value — judgment, not blind argmax; null until judged */
  best: ParamValue.nullable().default(null),
  /** one-line pass note, e.g. "flat — param doesn't matter" */
  note: z.string().nullable().default(null),
})
export type Pass = z.infer<typeof Pass>

/**
 * Optional refinement mini-grid around the found optimum, run before the
 * final verdict (batchUid suffix `--refine`). Unlike a pass it may vary
 * several params at once, in a small grid. Null unless one was needed.
 */
export const Refine = z.object({
  /** values per param, e.g. { enterThreshold: [0.45, 0.5, 0.55] } */
  params: z.record(z.string(), z.array(ParamValue).min(1)),
  /** grouping label: `<family>--<exp>--refine` */
  batchUid: z.string().min(1),
  submissionUids: z.array(z.string().min(1)).default([]),
  /** winning cell — null until judged */
  best: z.record(z.string(), ParamValue).nullable().default(null),
  note: z.string().nullable().default(null),
})
export type Refine = z.infer<typeof Refine>

/** Coordinate-search spec for a `param-search` experiment. */
export const Search = z.object({
  mode: z.literal('coordinate'),
  /** starting values for all params; justified in FAMILY.md */
  defaults: z.record(z.string(), ParamValue),
  /** ordered by expected impact; Researcher appends passes as it goes */
  passes: z.array(Pass),
  /** optional refinement grid before the final verdict */
  refine: Refine.nullable().default(null),
})
export type Search = z.infer<typeof Search>

/** What data the experiment has been run over. Grows with stage extensions. */
export const Coverage = z.object({
  /** market selection profile, e.g. "latest" */
  selection: z.string().min(1),
  /** total markets covered so far */
  markets: z.number().int().nonnegative(),
  fromMs: z.number().int().nullable().default(null),
  toMs: z.number().int().nullable().default(null),
})
export type Coverage = z.infer<typeof Coverage>

/**
 * Judgment metrics. Vocabulary: verdicts are judged on `netEvPerMarket`
 * (= evPerMarketTotal, net of fees). Gross is diagnostic only.
 */
export const OutcomeMetrics = z.object({
  netEvPerMarket: z.number(),
  grossEvPerMarket: z.number().nullable().default(null),
  markets: z.number().int().nonnegative(),
  trades: z.number().int().nonnegative().nullable().default(null),
})
export type OutcomeMetrics = z.infer<typeof OutcomeMetrics>

/**
 * One gate decision, appended by the Researcher at the moment it is made
 * (STAGE-GATES.md "Gate decisions"), with the measured numbers in `note`.
 * The climb state of a running experiment is read from this log, never
 * guessed from coverage. Kills are family-level actions and do not appear
 * here.
 */
export const GateDecision = z.object({
  /** the STAGE-GATES.md stage whose gate was judged */
  stage: z.number().int().positive(),
  decision: z.enum(['go', 'recycle']),
  at: z.string().datetime(),
  /** short factual note, e.g. "netEv +0.04 at 1000 mkts" */
  note: z.string().nullable().default(null),
})
export type GateDecision = z.infer<typeof GateDecision>

/** Written in full, at judgment time, when the experiment becomes `evaluated`. */
export const Outcome = z.object({
  /** did it meet its pre-declared successCriteria */
  verdict: Verdict,
  /** full winning param set (defaults + pass winners), null for single runs */
  bestParams: z.record(z.string(), ParamValue).nullable().default(null),
  metrics: OutcomeMetrics,
  /** one factual sentence with numbers, no narrative */
  reason: z.string().min(1),
  /** highest STAGE-GATES.md stage whose gate was passed (0 = none) */
  stageReached: z.number().int().nonnegative(),
  /** STAGE-GATES.md version used for judgment */
  gatesVersion: z.number().int().positive(),
})
export type Outcome = z.infer<typeof Outcome>

/**
 * One experiment = one pre-declared hypothesis with a pre-declared bar.
 * `hypothesis` and `successCriteria` are frozen once the experiment is
 * `running` (MEMORY.md).
 */
export const Experiment = z.object({
  /** local id, e.g. "000-baseline" or "002-persistence-filter" */
  id: ExperimentId,
  kind: ExperimentKind,
  /** which .ts this experiment runs, e.g. "000-baseline.ts" */
  code: z.string().regex(/\.ts$/, 'code must reference a .ts file'),
  /** experiment this branches from; null only for the baseline */
  basedOn: ExperimentId.nullable().default(null),
  /** one-sentence idea being tested — written BEFORE running, frozen once running */
  hypothesis: z.string().min(1),
  /** plain-sentence bar — written BEFORE running, frozen once running; the verdict quotes it */
  successCriteria: z.string().min(1),
  /** fixed params for a single run (exactly one of params/search is set) */
  params: z.record(z.string(), ParamValue).nullable().default(null),
  /** coordinate-search spec (exactly one of params/search is set) */
  search: Search.nullable().default(null),
  /**
   * grouping label for single-run (`params`) experiments; search experiments
   * carry batchUids per pass instead and keep this null
   */
  batchUid: z.string().nullable().default(null),
  /** run handles for single-run experiments (per pass in search mode) */
  submissionUids: z.array(z.string().min(1)).default([]),
  /** run id of the comparison anchor, passed as --baselineId */
  baselineId: z.string().nullable().default(null),
  /** null until first submission */
  coverage: Coverage.nullable().default(null),
  status: ExperimentStatus,
  /** gate decisions in climb order, appended at each gate judgment */
  gateLog: z.array(GateDecision).default([]),
  submittedAt: z.string().datetime().nullable().default(null),
  decidedAt: z.string().datetime().nullable().default(null),
  /** required when status is `aborted` */
  abortReason: z.string().nullable().default(null),
  /** null until `evaluated` */
  outcome: Outcome.nullable().default(null),
})
export type Experiment = z.infer<typeof Experiment>

/** Statuses that count as "active" for the one-active-experiment invariant. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['queued', 'running'])

/** FAMILY.json — the structured facts for one family (state + numbers). */
export const FamilyIndex = z
  .object({
    schemaVersion: z.literal(2),
    artifactType: z.literal('strategy-family-index'),
    family: Slug,
    status: FamilyStatus,
    coreIdea: z.string().min(1),
    /** normalized synonyms — dedup hints for future proposals */
    duplicateKeys: z.array(z.string()).default([]),
    /** when killed: the concrete condition under which to revisit */
    retryOnlyIf: z.string().nullable().default(null),
    /** current champion experiment id, or null */
    champion: ExperimentId.nullable(),
    /** one sentence written at kill/validated — surfaces in INDEX.json */
    verdictSummary: z.string().nullable().default(null),
    tags: z.array(z.string()),
    experiments: z.array(Experiment),
  })
  .superRefine((fam, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })

    const ids = new Set<string>()
    for (const exp of fam.experiments) {
      if (ids.has(exp.id)) issue(['experiments'], `Duplicate experiment id: ${exp.id}`)
      ids.add(exp.id)
    }

    const baseline = fam.experiments.find((e) => e.id === '000-baseline')
    if (!baseline) {
      issue(['experiments'], 'Missing required baseline experiment: 000-baseline')
    } else {
      if (baseline.code !== '000-baseline.ts')
        issue(['experiments'], '000-baseline must use code "000-baseline.ts"')
      if (baseline.basedOn !== null) issue(['experiments'], '000-baseline must have basedOn: null')
    }

    const active = fam.experiments.filter((e) => ACTIVE_STATUSES.has(e.status))
    if (active.length > 1) {
      issue(
        ['experiments'],
        `At most one experiment may be queued/running; found: ${active.map((e) => e.id).join(', ')}`,
      )
    }

    for (const exp of fam.experiments) {
      const at = (msg: string) => issue(['experiments'], `${exp.id}: ${msg}`)

      if ((exp.params === null) === (exp.search === null))
        at('exactly one of params/search must be set')
      if (exp.kind === 'param-search' && exp.search === null)
        at('param-search experiments must use search')
      if (exp.basedOn !== null && !ids.has(exp.basedOn))
        at(`basedOn references unknown experiment ${exp.basedOn}`)

      if (exp.status === 'evaluated') {
        if (exp.outcome === null) at('evaluated requires outcome')
        if (exp.decidedAt === null) at('evaluated requires decidedAt')
      } else if (exp.outcome !== null) {
        at('outcome may only exist on evaluated experiments')
      }

      if ((exp.status === 'running' || exp.status === 'evaluated') && exp.submittedAt === null)
        at(`${exp.status} requires submittedAt`)
      if ((exp.status === 'running' || exp.status === 'evaluated') && exp.coverage === null)
        at(`${exp.status} requires coverage`)
      if (exp.search !== null && exp.batchUid !== null)
        at('search experiments carry batchUids per pass; experiment batchUid must be null')
      if (
        exp.params !== null &&
        (exp.status === 'running' || exp.status === 'evaluated') &&
        (exp.batchUid === null || exp.submissionUids.length === 0)
      )
        at(`single-run ${exp.status} requires batchUid and submissionUids`)
      if (exp.status === 'aborted' && exp.abortReason === null) at('aborted requires abortReason')

      let prevStage = 0
      for (const gate of exp.gateLog) {
        if (gate.stage !== prevStage + 1 && gate.decision === 'go')
          at(`gateLog stage ${gate.stage} skips a stage (previous go: ${prevStage})`)
        if (gate.decision === 'go') prevStage = gate.stage
      }

      if (exp.outcome !== null) {
        if (exp.outcome.verdict === 'success' && exp.outcome.stageReached < 1)
          at('verdict success requires stageReached >= 1')
        const maxGo = exp.gateLog.reduce(
          (m, g) => (g.decision === 'go' ? Math.max(m, g.stage) : m),
          0,
        )
        if (exp.outcome.stageReached !== maxGo)
          at(
            `outcome.stageReached ${exp.outcome.stageReached} != highest gateLog go stage ${maxGo}`,
          )
      }
    }

    if (fam.champion !== null) {
      const champ = fam.experiments.find((e) => e.id === fam.champion)
      if (!champ) {
        issue(['champion'], `Champion does not match an experiment id: ${fam.champion}`)
      } else if (champ.status !== 'evaluated' || champ.outcome?.verdict !== 'success') {
        issue(['champion'], 'Champion must be an evaluated experiment with verdict "success"')
      }
    }

    if ((fam.status === 'validated' || fam.status === 'live') && fam.champion === null)
      issue(['champion'], `Family status "${fam.status}" requires a champion`)
    if (fam.status === 'killed' && fam.retryOnlyIf === null)
      issue(['retryOnlyIf'], 'Killed family requires a concrete retryOnlyIf')
    if ((fam.status === 'killed' || fam.status === 'validated') && fam.verdictSummary === null)
      issue(['verdictSummary'], `Family status "${fam.status}" requires verdictSummary`)
  })
export type FamilyIndex = z.infer<typeof FamilyIndex>
