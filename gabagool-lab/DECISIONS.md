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
