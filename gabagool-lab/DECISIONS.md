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
