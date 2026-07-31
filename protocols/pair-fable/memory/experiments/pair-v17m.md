# pair-v17m — maker-only tilt acquisition (E-044)

Directional controller (mission priority 2). Registered session 28,
BEFORE any v17m code exists (design-ts = the commit adding this file;
M2). Motivated by the E-042 anatomy (pair-v17.md §7): the
spot-vs-strike leader signal is genuinely predictive — tilted residue
wins 88–90% of markets at bps 10–20 vs a 30% neutral base rate — but
the current acquisition machinery (doom-backstop and C-lock FOK fills
chasing the signed target at the ask) spends MORE than the residue
earns (g1: +163k residue vs g0, −161k extra pairs cost, +11k extra
fees). The lever is the cost of buying the tilt, not the signal.

## 1. Mechanism (falsifiable)

Hypothesis: acquiring the tilt exclusively through resting maker
quotes — never through taker FOKs — retains most of the residue's
predictive value while removing the taker/doom acquisition premium,
moving the tilt's NET absolute ev above neutral.

Registered counter-hypothesis (E-018 prior, the honest kill path):
worst-queue maker BUYs on the leader side fill predominantly when
price moves AGAINST the leader (adverse selection). If the fills the
maker tilt actually receives are concentrated in leader-flip markets,
residue win% collapses toward ~50% and the mechanism is dead — the
measured residue win% per cell is the decisive mechanism metric, not
just ev.

## 2. Exact delta over pair.v17.ts (one substitution + one schema drop)

pair.v17m.ts = pair.v17.ts with the FOK completion deficit changed:

- v17: `tiltDef = unitCost ≤ tiltUnitMax ? T[side] : 0`;
  `deficit = qty[o] − qty[side] + tiltDef` — the taker path both
  CHASES positive tilt (buys the leader at the ask toward T) and
  respects held tilt on the laggard.
- v17m: `tiltDef = min(T[side], 0)`; same deficit formula. The taker
  path NEVER buys the tilt component (no leader chasing — positive T
  contributes 0), but still RESPECTS held tilt (negative T on the
  laggard keeps C/D completion from pairing the tilt away), and doom
  salvage of a collapsing tilt still fires (on a leader flip T
  changes sign, the ex-laggard's tiltDef becomes 0, doom completes
  the full raw imbalance — loss mitigation preserved).
- `tiltUnitMax` is REMOVED from the schema (it only gated the
  positive tilt component of FOKs, which no longer exists; E-041
  CEIL-NULL closed its lever on the taker path).

Everything else — maker band guard on signed error (the ONLY tilt
acquisition path now: the leader side may maker-accumulate up to
T + Ib while the laggard stops at −T + Ib), graded lag pricing on the
target-relative deficit, VWAP ceiling + RAW reservation, grid,
cooldowns, TTL, doom, end-of-window, fill tags, feeds — byte-identical
to pair.v17.ts. Meta/cid tag `pf17m`.

**τ = 0 identity:** T ≡ 0 ⇒ tiltDef ≡ 0 in both files ⇒ v17m τ0 is
behavior-identical to v17 τ0 (= v15.4 neutral). No neutral control
cell needed; the code-identity argument substitutes.

## 3. Non-equivalence vs prior kills

- E-018 (deep-book maker δ-grid KILL) killed UNCONDITIONAL maker
  unpaired inventory. v17m's maker tilt is CONDITIONED on the feed
  leader (spot beyond strike by ≥ θ) — a state E-018 never
  conditioned on; the 88–90% residue win base rate measured in E-042
  is direct evidence the conditioned inventory is not the E-018
  population. The dose–response and win% read give the honest answer.
- E-026 (averaging-down KILL): trigger was own-inventory drift, not
  an external resolution-relevant signal; no equivalence.
- E-038/E-041: taker-acquired tilt is ~fair-priced net (TILT-EV-NULL
  at FULL); v17m changes the acquisition price, the exact term those
  experiments left as the binding cost.

## 4. E-044 grid (FROZEN before code)

Instrument, pin, latency, center = E-042 (pair-v17.md §5): FULL
universe to-ms 1785196800000, 140/20, B = 500, q100 I160 P*.96
doom.99 cool5 ttl90 persist0, τ = +160. Reuse B_full = 0.74.
References: g0 = 1008 (neutral), g1 = 1011 (taker tilt bps 10),
g3 = 1009 (taker tilt bps 40).

| # | spotLeadBps | batch label | vs (named) | question |
|---|---|---|---|---|
| m10 | 10 | pf-e044-m10 | g1, g0 | maker acquisition at the tight, most-predictive threshold (win% 88) |
| m40 | 40 | pf-e044-m40 | g3, g0 | maker acquisition at the ev-best threshold |

Stage: protocol:check + local `--sequential` smoke (5 mkts) + local
activation check (τ0 vs τ160 on identical markets must differ in
maker placement; τ160 D/C-fill counts must NOT exceed the τ0 run's —
the taker path may not chase tilt) BEFORE submission; then straight
to FULL (feed plumbing and worker fulfillment already proven for the
v17 family, runs 1001/1002/1006; params-only otherwise).

**Frozen metrics.** Per cell: ev (governs), p/100, invested, resid-mkt
count, residue win%, residue PnL, pairs PnL, D-fill count/$, S/R fill
counts, fees. Integrity: failures = the identical 96-slug outage set
only; pairwise common = 10,651 vs all E-042 cells.

**Frozen bars (B_full = 0.74).**

- **MAKERTILT-BETTER** iff ev(m10) − ev(g1) > 0.74 (and analogously
  m40 vs g3, reported per pair) ⇒ acquisition cost was the binding
  term; iterate (dose, persistence, size-of-tilt next).
- **TILT-EV-REAL (the program's first ev-positive tilt)** iff any m
  cell − ev(g0) > 0.74 ⇒ record as the directional program's first
  absolute-ev confirmation at FULL.
- **MAKERTILT-DEAD** iff both m cells are within ±0.74 of g0 AND
  residue win% ≤ 60% (adverse selection ate the signal — E-018 prior
  confirmed for feed-conditioned inventory) ⇒ maker-acquisition axis
  closed; tilt program continues only via E-043's dose result.
- **MAKERTILT-NULL** otherwise (e.g. win% holds ≥ 70% but ev flat —
  fills too few to matter; report maker-tilt fill counts and record
  as capacity-bound).

Decision mapping: BETTER/REAL ⇒ iterate maker-tilt levers at FULL
(τ dose, leadPersistTicks, laggard-side quoting asymmetry).
DEAD ⇒ directional acquisition axes (taker E-038/E-041, maker E-044)
both closed at ev; the tilt program's remaining open lever is E-043's
width curve, then priority reverts per pair-v17.md §7 mapping.
NULL ⇒ one bounded follow-up allowed only if fill counts show a
concrete starvation mechanism (e.g. band guard blocks leader quotes);
otherwise treat as DEAD.
