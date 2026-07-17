# EPISTEMOLOGY — how this lab knows things

Version 1, frozen 2026-07-17 (session 1). Changes to this file require a
DECISIONS.md entry with the old rule quoted and the reason it failed.
EVALUATION.md holds the numeric scoring rule; this file holds the
process. INHERITANCE.md holds the facts both build on.

## 0. The mission's epistemic problem, named

The simulator sees only the adverse ~half of real maker fills (D2), does
not model the subsidy that pays today's winners (rebates — computable
post-hoc), and undercharges the taker completions the winning meta uses
(fee shape — correctable post-hoc). Naive sim EV is therefore neither
necessary nor sufficient for "this pays live." The lab's answers must be
built from the parts of the sim that ARE trustworthy, stated with their
assumptions attached. The deliverable is never "backtest says X"; it is
"under stated fill/fee/rebate assumptions A, the measured numbers are X,
and the live-transfer risk is exactly R."

## 1. What the sim is trusted for (doctrine)

**Trust absolutely** (engine arithmetic, verified in code):
- Pair payoff scoring (min-pair $1 credit + winner redeem).
- Maker fills are fee-free (matches venue in every era).
- Deterministic replay at jitter=0 → exact reproducibility.
- Structural kills: if a variant cannot pay even under sim assumptions
  that FAVOR it, the sim's word is final.

**Trust with stated correction**:
- Taker fees: re-priced per-fill at the era-correct curve 0.07·p(1−p)
  (reconstruction from intent_meta, validated against the sim's own
  fees_paid; see EVALUATION §3).
- Rebate line: A22 exact estimator, $1/market/day threshold applied at
  sim scale, reported separately from the trading line, always.

**Trust only relatively**: rankings across variants that share the
maker-fill stream (completion policies, endgame rules, sizing shape) —
the pessimistic maker model cancels out of the comparison.

**Never trust**: absolute maker fill counts as live predictions (adverse
subset only); size/capacity scaling (all-or-nothing fills); capital
velocity (merges inexpressible, G5); queue economics; wallet-vs-wallet
equilibrium effects (G8).

## 2. Experiment types (a deliberate departure from SRP)

The old protocol forced every run through a go/kill gate on one number.
This lab distinguishes:

- **AXIS experiments** — measure a response curve along one design axis
  (e.g. parity tolerance 0.1%→40%; ladder depth; completion cap; time
  weighting). Output = the curve + a lesson. An axis experiment cannot
  "fail"; it can only be well- or ill-posed. Its success criteria are
  about resolution ("distinguish the arms at ≥ X precision"), not sign.
- **CANDIDATE experiments** — a fully-specified variant seeking champion
  status. These face the full EVALUATION gate vector and the holdout.
- **PROBE experiments** — cheap feasibility checks (does this mechanism
  fill at all? does the plumbing work?). Never evidence, never quoted.

The campaign alternates: axes to learn the terrain, candidates to bank
validated variants. Most tokens go to axes early, candidates late.

## 3. Experiment lifecycle

1. **PROPOSE** — append a spec to LEDGER.md (template in that file):
   id `E###-<slug>` (sequential, never reused), type (axis | candidate |
   probe), mechanism sentence (WHO PAYS and why this variant collects),
   knobs + ranges with prior citations, coverage plan (explicit
   `--from-ms/--to-ms`), execution profile (latency arms, sizing),
   frozen success criteria (axis: resolution target; candidate: the
   EVALUATION vector), kill/stop conditions, batchUid plan.
2. **FREEZE** — the spec fields `hypothesis`, `successCriteria`,
   `coverage`, `execution profile` are frozen when the first evidence
   run is submitted (the commit containing the submission uid is the
   timestamp). Smokes may precede the freeze; they never count.
3. **RUN** — only via `tools/submit.ts`, which refuses a dirty tree,
   pins `BACKTEST_LATENCY_DELAY`/`_JITTER` explicitly, derives the
   batchUid, and prints the submission uid for the ledger. Runs are
   recorded in the ledger entry as they are submitted.
4. **JUDGE** — only from `tools/results.ts` output (the full metric
   vector + gate table). The verdict quotes the frozen criteria and the
   measured numbers. For any selection among >3 arms, the two-disjoint-
   halves rule applies (§5). Judgments are appended to the ledger entry;
   past judgments are never edited.
5. **DISTILL** — one `Lesson:` line per judged experiment (mandatory),
   promoted to LESSONS.md when transferable beyond the experiment.

State machine per experiment: `proposed → frozen → running → judged`
(+ `aborted` with reason). One candidate experiment in flight at a time;
axis experiments may run in parallel up to machine courtesy limits.

## 4. Proposal policy (generation, dedup, priority, kill)

**Generation.** The seed queue is inherited (KB H1/H6/H2/H4 + BRIEF §4's
knob list). New proposals must cite either: a KB prior, a measured
result from this lab's ledger, or a change in the world (feed landed,
fee change, KB update). "It occurred to me" is not a source; write it
in JOURNAL as a hunch and find a citation before proposing.

**Deduplication.** Before proposing, grep LEDGER.md for the axis and
parameter region. Re-testing a measured-dead region requires naming the
NEW instrument/data/era that invalidates the old measurement (this rule
is what kept fable honest; its violation is what SRP families wasted
runs on).

**Prioritization** — expected information per token, ranked by:
1. Sim-decidability (H1 parity/ladder/timing axes and H6 completion
   ranking are fully decidable; anything needing queue realism is not).
2. Effect size in priors (H6's knob spans 2% of turnover — the largest
   measured lever; parity tolerance spans the archetype-vs-b55f gap).
3. Unlocks (the L1 baseline unlocks tail-threshold freezing and every
   later comparison; feed-dependent axes unlock only when feeds land).

**Kill rules.**
- Axis: closed when the curve is measured at the planned resolution, or
  when two refinement rounds fail to change the ranking (diminishing
  information).
- Candidate: killed by any hard gate at its stage (EVALUATION §5), with
  the failing numbers quoted; killable early by the axis curves that
  contain it (a candidate inside a measured-dead region needs no run).
- Concept-level structural kill (→ L3 ceiling proof): requires showing
  the NUMERIC ceiling — even with fee-free maker fills, era-correct
  taker fees, full rebate credit, and the D2 benign-half assumption
  granted at its measured maximum (fills scaled by 1/0.44), the economic
  line cannot clear zero across the eval window. Anything short of that
  is "not found", not "cannot pay" — say which one honestly.

## 5. Honesty mechanisms (structural, not aspirational)

1. **Frozen criteria** — in the ledger, committed before submission;
   git history is the tamper-proof timestamp.
2. **Search/holdout split** — search window Apr 1 → May 31 2026;
   holdout **Jun 1–14 2026, one-shot per champion lineage**, run only
   after the champion + params are frozen in the ledger. Holdout
   results are never used to re-select; a failed holdout kills the
   lineage's claim, full stop (E32: max-of-40 in-sample t=+3.25 became
   −0.98 fresh — that is the enemy). The Mar 6 → Apr 1 transition band
   is a labeled robustness readout, never a verdict input.
3. **Two-disjoint-halves screening** — any selection among >3 arms runs
   on two disjoint market samples; arms advancing must agree in sign on
   both halves (E31: 5 of 20 screens flipped between halves).
4. **Max-of-N labeling** — every selected number carries its selection
   width ("best of 12 cells"); selected numbers are expected to shrink
   on confirmation and are never quoted as unbiased.
5. **Pre-committed selection rules** — "champion = the arm passing all
   hard gates with the highest SCORE (EVALUATION §6), computed by
   results.ts" — decided by the tool's printed table, not by eye.
6. **Paste-the-numbers rule** — any "verified X" sentence in ledger or
   journal must contain the actual number/log line, not a summary of an
   intention (fable E28).
7. **Verification proportionality** — the toolchain is verified once,
   end-to-end, by the L0 smoke (scripted variant, hand-computed PnL,
   intent_meta round-trip). After that, re-verification happens only
   when a result is surprising, load-bearing, or the engine/data
   changed. Audit towers are banned. Meta-work is not a unit.
8. **Nothing-to-run rule** — if the queue is empty and gates block
   everything, write exactly that in JOURNAL + OPERATOR-FEED and end
   the session. Do not manufacture work.

## 6. Memory contract

- `STATE.md` — digest + queue (every commit).
- `JOURNAL.md` — append-only narration with timestamps.
- `DECISIONS.md` — design forks, rejected option included.
- `LEDGER.md` — the experiment registry: one entry per experiment
  (spec → runs → judgment → lesson), append-only judgments.
- `LEADERBOARD.md` — current candidate ranking + gate table, regenerated
  from results.ts output (L2+).
- `LESSONS.md` — transferable lessons only (starts when the first one
  exists).
- Resume: CHARTER → STATE → JOURNAL tail → LEDGER active entries.
  Target: productive within minutes.

## 7. Session shape

Think → pick ONE unit from STATE's queue → build/run → write → commit →
push → update STATE + OPERATOR-FEED. Prefer finishing one unit over
starting three. Long runs: submit detached, record uids, end the unit;
the next session (or a later unit) judges. Every session re-reads the
KB's STATE.md (it grows) and checks `git log docs/ src/` for feed
arrivals before proposing feed-dependent work.
