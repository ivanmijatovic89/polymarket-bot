# Gabagool Lab — DECISIONS

Design forks, with the rejected option and why. Append-only.

---

## D-000 (2026-07-17): Phase 0 via parallel digests, not serial reading

**Chosen:** fan out subagents to digest the four inherited corpora (KB,
fable-lab, strategy-research-protocol, repo-root docs) into a single
INHERITANCE.md; I personally verify only the engine footguns in code
(they are load-bearing for simulator trust) and read the KB's
STRATEGY-BRIEF/STATE myself (they shape the design directly).

**Rejected:** reading everything myself serially — burns most of a session
on ingestion before any lab exists; fable-lab's failure mode was spending
tokens on meta-work instead of experiments. Verification effort must be
proportional to decision stakes: engine semantics get first-hand
verification, narrative history gets digests.

## D-001 (2026-07-17): Axis / candidate / probe experiment types

**Chosen:** three experiment types — AXIS (measures a response curve,
cannot "fail", success = resolution), CANDIDATE (faces the full gate
vector + holdout), PROBE (plumbing checks, never evidence).

**Rejected:** SRP's single type where every run faces a go/kill gate on
one number. That design punished measurement: a parity-tolerance sweep
"fails" if its best cell is negative even though the curve itself is
the deliverable. The operator called the old gates too crude for this
concept; separating information-gathering from championship is the fix.

## D-002 (2026-07-17): Era windows — search Apr–May, holdout Jun 1–14

**Chosen:** verdicts only on 2026-04-01→06-14 (current fee shape);
June 1–14 as the one-shot holdout; Mar 6–Apr 1 as labeled transition
readout; pre-fee data never in verdicts.

**Rejected:** (a) full-history evaluation over ~9,000 markets (SRP
style) — pools three incompatible fee regimes, exactly the "single net
EV hides everything" failure the charter names; (b) holding out a
random market subset instead of the newest slice — random holdouts test
memorization, not regime transfer; the June slice is the only data from
the CURRENT (taker-rebate) meta, so transfer-to-June is the closest
available proxy for transfer-to-live. Cost accepted: the holdout is
small (~1,270 markets) and one-shot — that is what makes it credible.

## D-003 (2026-07-17): Corrected-fee doctrine (one exception to "measured, never modeled")

**Chosen:** keep SRP's measured-costs rule with ONE exception: taker
fills are re-priced per-fill at the on-chain-verified current curve
0.07·p(1−p), reconstructed from intent_meta and validated against the
sim's own fees_paid column per run (quarantine on mismatch).

**Rejected:** (a) trusting sim fees — they are era-wrong in shape AND
rate (2–4× undercharge; the sim would systematically favor exactly the
mid-band taker completions that are most expensive live, corrupting the
H6 ranking, the lab's highest-leverage question); (b) patching the
engine — outside write scope, and the sim's internal accounting should
stay comparable with every other run in the DB.

## D-004 (2026-07-17): Hard gates + transparent SCORE, not a single scalar champion rule

**Chosen:** championship = pass all hard gates (stability, tails,
latency, pairing, sample) THEN rank by SCORE = EL × f_stab × f_lat ×
f_tail. Gates are the protection; SCORE only orders gate-passers.

**Rejected:** a single composite score selecting champions directly — a
scalar can trade a fat left tail for mean EV, which is precisely the
failure mode of this concept (pennies vs steamroller). Also rejected:
gates-only with no ordering — L2 needs a leaderboard.

## D-005 (2026-07-17): Tail/capital thresholds calibrated from the L1 baseline, then frozen

**Chosen:** TAIL_K and the capital-efficiency floor are set from the L1
baseline's measured distribution (a reference, exempt from those gates),
frozen before the first candidate experiment (EVALUATION §7).

**Rejected:** inventing thresholds now — I have zero pair-strategy
distributions on this book; a made-up CVaR multiple would be either
vacuous or accidentally lethal. Deferring with a pre-committed procedure
is honest; deferring without one would be a loophole.

## D-006 (2026-07-17): Registry/id naming

**Chosen:** experiment ids `E###-<slug>`; strategy files
`src/strategies/gabagool-lab/<E###-slug>.ts`; registry ids
`glab.<E###-slug>`; batchUids `glab--<E###-slug>--<suffix>`
(`--smoke`, `--pN-<param>`, `--refine`, `--rN`, `--lat<ms>`, `--h1/--h2`
for disjoint halves, `--holdout`). SRP's mechanical-derivation rule kept.

**Rejected:** SRP's `<family>.<NNN>-<name>` — no family layer exists
here; and freeform names — the suffix grammar is what makes runs
greppable and the latency pin auditable from the batchUid alone.

## D-007 (2026-07-17): TAIL_K = 41, capital floor = 0.92% EL per $100 avg outlay (EVALUATION v1.1)

**Chosen:** discharge the §7 pre-declared amendment with floor
F = $0.50/market on the pre-registered coupling (JOURNAL s2-u8, form
fixed before fullwin numbers existed): TAIL_K = |CVaR5_baseline(140)| /
F = 20.648/0.50 → **41** (rounded strict); capital floor = F /
avgOutlay_baseline(140) = 0.50/54.62 → **0.92% per $100** (rounded
strict). Both from run 678 (lat140 realism anchor, 5,856 markets).
New hard gate G11 carries the capital floor; G7's TAIL_K placeholder
resolves to 41.

**Rationale for F = $0.50 (bottom of the pre-registered $0.5–1.0
band):**
1. *Existence-proof anchored, not invented.* The only known
   trading-profitable parity wallet at scale (A30, 0x04b6d7e9) earns
   ≈ +0.30% of turnover trading + ≈0.5% rebates ≈ 0.8–0.9% all-in.
   For this BUY-and-hold family turnover ≈ settlement outlay, so at
   baseline sizing ($54.62/market) the best observed live economics ≈
   $0.45–0.52/market. F = $0.50 sets the bar exactly at "as good as
   the best live evidence"; F = $1.00 would demand 2× anything ever
   observed and pre-kill the region the KB proves exists.
2. *Blow-up protection is layered.* At K = 41 a boundary candidate's
   worst-5% markets consume ≈ 2× its net total (0.05 × 41) — permissive
   alone, but G7 keeps PF ≥ 1.3, G5 caps single-week share, G4 demands
   t ≥ 2; TAIL_K's distinct job is concentrated-catastrophe shapes
   that PF misses. A baseline-shaped candidate (CVaR5/outlay −0.378)
   must earn ≥ $0.50/market to pass — the measured baseline (−4.39) is
   nowhere close; better-tailed designs need proportionally less EL.
3. *Capital floor from the same arithmetic* (0.92%/window on deployed
   capital ≈ best live all-in margin) guards the charter's
   capital-efficiency requirement with an empirical anchor. It binds
   independently of tail shape: tiny-tail variants must still clear
   0.92% per $100 outlay to be worth capital.

**Rejected:** (a) F = $1.00 — stricter-looking but evidence-free: it
rejects the A30/A33 deep-pair region that three independent wallets
print in; (b) direct TAIL_K from the baseline's own CVaR5/EL —
degenerate (baseline EL < 0, pre-registered as invalid); (c) deferring
until a positive-EL variant exists — that would let the first
candidate's own shape pick its gate (the exact loophole §7's
freeze-before-first-candidate rule exists to close).

## D-008 (2026-07-17): Scope of E004's frozen "maker-only" consequence

**Chosen:** E004's advance-rule failure exports exactly what the
frozen sentence says — completion earns **no default**: candidate
confirmation runs are maker-only unless a candidate's own FROZEN spec
includes a completion policy. A future candidate MAY include
completion=free in its frozen spec, because the axis produced
direction-stable, distinct evidence for it (sign agreement across two
disjoint halves — the same standard EPISTEMOLOGY §3.3 applies to
screening; adjacency DISTINCT in both halves; mechanism decomposed and
coherent). Any such spec must cite §E004's "axis unstable at this
coverage" caveat and carries the burden at the full gate vector +
one-shot holdout like any candidate. E005 stays maker-only (axis
isolation, unchanged).

**Rejected:** (a) treating the rule failure as banning completion
from candidate specs entirely — that discards measured information
the epistemology's own two-halves rule endorses, and the failure was
localized to the statistically tied middle of the ranking (LS-8), not
to the winner; (b) declaring cfree the completion default anyway
("the rule obviously misfired") — post-hoc rule editing after seeing
the data is the exact failure mode frozen rules exist to prevent; if
the rule is wrong, the fix applies to future freezes (LS-8), not
retroactively.

## D-009 (2026-07-17): E008 gate signal form — level (strike distance), not drift (momentum)

**Chosen:** the E008 adverse-side gate uses the LEVEL form: side S
is adverse when signed (spot − strike)/strike exceeds +θ against it
(strike = window-open spot, H4 proxy). Rationale: (a) the measured
E006 mechanism sentence — stale bids fill on the side price is
LEAVING — is about where price sits relative to the window open,
which the level form captures directly; (b) stateless (no lookback
buffer) → smaller code change on the frozen-doctrine shared file,
cleaner decomp attribution, trivially deterministic; (c) H4 was
scoped exactly this way (u48) and the binary's terminal value IS a
level condition on strike, so the signal is the payoff-relevant
one; (d) A36's session evidence and A34's excess-leg choice are
both consistent with position-relative-to-open, not short-horizon
momentum, driving the informed lean.

**Rejected:** (a) drift form (spot moved ≥ θ bps against S over
lookback L) — adds a second free parameter (L), buffer state, and
a tick-cadence dependence that muddies latency comparisons; kept as
a refinement IF the level gate shows signal; (b) probability-model
form (z-score with realized vol → model p, quote only below
p − margin) — the honest version needs a vol estimator that is
itself a research object; premature before the raw signal is shown
to carry value; (c) gate-plus-cancel (also cancel standing rungs on
adverse flip) — second cancellation channel, confounds the decomp;
v1 blocks placement only, stated in the draft.

## D-010 (2026-07-18): Chassis after E008 — frozen rule followed (g00), concept identity recorded, g05 preserved as the two-sided reference

**Context:** E008's frozen advance rule says "the winning arm beats
ref DISTINCTLY in at least one half → the gate joins the chassis".
The winning arm is g00 (θ=0, sign-only): h1 −0.0362 / h2 −0.2681 vs
ref −2.2884/−2.0229, DISTINCT in both halves, Δrem check passed. But
at θ=0 the book is one-sided at almost every tick (bind 99.9%,
pairRate 4–5%, imb p50=p90=1.0): the cell is a spot-favorite maker
holding to redemption, not a two-sided pair accumulator. The charter
concept is the pair accumulator.

**Chosen:** follow the frozen rule — the working chassis for
subsequent axes is rc+c960 + fvGateMode=level + fvGateBps=0 (g00).
Rules frozen before data exist are the lab's defense against
narrative re-selection AFTER seeing results; overriding one because
the winner "feels off-concept" is exactly the failure mode freezing
exists to prevent. The identity shift is recorded as a MEASURED
FINDING, not suppressed: the gabagool pairing payoff at this book
is priced at a loss (pair$−cost$ ≈ −4.1/mkt at ref, S≈0.915), and
the concept's actual value concentrates in the winner-remainder.
g05 (θ=5 bps) is named on the LEADERBOARD as the best
pairing-preserving cell (pairRate 0.46/0.48, EL −1.46/−1.51, both
halves DISTINCT vs ref) — any future axis that needs two-sided
inventory (completion, merge policies, parity levers) runs on g05,
stated per-experiment.

**Rejected:** (a) adopt g05 as chassis for concept purity —
post-hoc rule override; also strictly worse EL, and the charter's
mission is "which ways pay", not "which ways look like the
archetype"; (b) declare the concept dead at θ=0 and close the
program — wrong: the θ curve itself is the concept's verdict-in-
progress, and the latency battery + fresh-half confirmation must
come first (a breakeven cell built on 2.6 fills/mkt could still be
fill-model artifact); (c) split the lab into two tracks now —
premature fan-out (fable-lab died of breadth); one chassis, one
queue.

## D-011 (2026-07-18): The payload-check FAIL is carried as a mechanism re-classification, not a kill

**Context:** the §E008 battery's frozen payload check (4) — Δrem ≥
−0.3 vs same-lat ungated at EVERY latency — failed on exactly one
boundary cell (lat0 h2: −0.3649), while at every realistic latency
(140/500/1000) the payload is large, positive, and monotone
INCREASING with latency (+3.20 → +5.80). The frozen text labels a
failure "the remainder capture is a latency artifact". The survival
rule (3) — the actual judgment — passed in all four required cells.

**Chosen:** record the FAIL verbatim (frozen is frozen; the rule
fired as written and the miss is quoted in the judgment), and carry
its measured meaning forward as a re-classification: g00's
winner-remainder capture is latency-CONDITIONAL — it exists because
latency-driven adverse flow exists, and it suppresses that flow. The
gate is a DEFENSIVE lever whose value grows with execution friction,
not a latency-independent alpha source. Consequences: (a) any future
claim built on the remainder payload must state this conditionality;
(b) the anti-E006 intent of the check (stale gating must not fake
the capture) is measured as satisfied — staleness at 1000 ms
strengthens, not fakes, the capture; (c) the lat0 boundary behavior
(gated book plays 13–16%, captures nothing) is the g00 identity
already recorded in D-010, seen from the other side.

**Rejected:** (a) declaring the whole E008 lever an artifact and
re-classing the axis — that clause was reserved (frozen rule 3) for
a survival-rule failure, which did not occur; conflating the payload
label with the survival verdict would kill a lever that beats its
reference DISTINCTLY at every stressed latency; (b) quietly
narrating the FAIL away as "just a boundary case" without a
DECISIONS entry — the whole point of freezing rule 4 was that its
misses must cost something visible; this entry is the cost, and the
next battery's payload rule should scope its floor to latencies
where the reference actually trades (fills/mkt above a stated
minimum), which is a design improvement to propose at the next
freeze, not retroactively.

## D-012 (2026-07-18): E010 momentum signal = own bestAsk, not mid

**Context:** the u84 design sketch (explicitly pre-freeze,
informational) proposed a per-side ring buffer of MIDs for the
own-book momentum veto. At proposal time (u87) the signal choice
had to be fixed before the freeze.

**Chosen:** the veto samples the own-side BEST ASK. Two reasons,
both about fidelity to what is actually measured: (a) the KB prior
this experiment operationalizes is literally a falling-ASK
signature (A44: "caught the falling ask" = the adverse fill subset,
the only 3/3-robust pre-fill discriminator) — using the ask tests
the prior as measured, not a derived proxy; (b) in the worst_queue
simulator a resting BUY fills only when bestAsk comes down through
the level — the ask IS the fill channel, so "ask has been falling"
is the direct precursor of the modeled adverse fill. Sampling
excludes crossed and one-sided books (anomalous states the strategy
never quotes into anyway).

**Rejected:** mid-based signal. The mid mixes in bid-side moves,
which are not the fill channel in this simulator and were not the
measured KB signature; a mid fall driven purely by bid retreat
would veto placement exactly when the ask (the thing that fills
you) has NOT moved — diluting the discriminator the experiment
exists to test. Cost of the choice: the ask is noisier to
quote-flicker (pull/re-add without trades); accepted, because the
5–20s as-of window already spans flicker and the sweep measures
the sensitivity directly.
