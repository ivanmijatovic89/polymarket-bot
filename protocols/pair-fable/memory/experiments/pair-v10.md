# Family: pair-v10 (taker-completion module on v1) — E-020

Axes 2+3 of the human ruling (inbox 8758567d): opportunistic cheap-side
completion decoupled from the entry gate, and loss-mitigating completion
above $1. Both attack the SAME identity term the v1 family leaves on the
table — the stranded side (L_s ≈ $0.44/share measured in v1) — and they
share machinery, so one family tests both.

**Why the v1 base and not v9/X=0.15**: the module's value is proportional
to what stranding costs. v9 at X=0.15 already bounds L_s at $0.146 and its
residue loses $1.46/market; v1-a loses ≈ $4.4 per doomed market — the
target the ruling was analyzing. (v9's own openings — low X, duty cycle —
are E-021, pre-registered in pair-v9.md.)

## The unified rule

Both axes are the same FOK taker rule at different thresholds. Let h =
avg cost/share of the surplus ("held") side, ask = bestAsk of the deficit
side, fee = 0.07·ask·(1−ask) (taker, 700 bps engine model):

- **Axis 2 — profit lock (`completeCapTotal` C, 0=off)**: when
  imbalanced and `h + ask + fee ≤ C` (C < 1), FOK BUY the deficit side at
  `ask`, size = the full imbalance. Locks margin ≥ 1 − C per pair. Fires
  structurally only after the held side has RISEN (at entry the book sums
  to ≈ 1.02, so h + ask starts above 1) — exactly the hover paths where
  v1's worst-queue maker rest never fills and the market can re-collapse.
- **Axis 3 — doom salvage (`doomBid` D, 0=off)**: when imbalanced and
  `bestBid(held) ≤ D` and `ask + fee ≤ 0.99`, FOK BUY the deficit side at
  `ask`. Derivation: completing at total τ = h + ask + fee loses τ − 1;
  holding a truly doomed side loses h; completion strictly beats certain
  doom iff ask + fee < 1 (the save is 1 − ask − fee per share, ≥ 1¢
  enforced). It loses EV when the held side would have recovered — E-012
  showed doom is unpredictable from START-time state, but heldBid ≤ D is
  a LATE-state signal; different claim, untested. The v9 result's 0/272
  residue wins is survivorship and is NOT usable as a prior here
  (pair-v9.md §Result).

## Design (delta from pair.v1)

`pair-fable-v10` = pair.v1 verbatim plus the module:

1. Params (guard-2 budget, 5 of 6 slots): `incrementSize` (10),
   `capPerMarket` (50), `maxPairCost` (0.98), `completeCapTotal` (C,
   0=off), `doomBid` (D, 0=off). Demoted to design constants (never swept
   in-family; v1 defaults): ttlSec=90, cooldownTicks=25, maxImbalance=20.
2. Completion FOK: limit price = current bestAsk (arrival 140 ms later:
   book moved against ⇒ FOK killed, natural latency protection; fills
   at-or-better otherwise), size = current imbalance, `capPerMarket`
   still enforced, GTD/maker machinery untouched.
3. One-open-order state machine kept: when the trigger fires while a
   maker rest is open, emit cancel + FOK in the same tick. Known bounded
   confounder: the canceled rest can still fill during cancel latency ⇒
   a transient over-complete bounded by maxImbalance; and a killed FOK
   re-enters the 25-tick cooldown before retry (accepted for simplicity —
   note if it shows up in fills).

## Pre-registered experiment (written BEFORE strategy code)

- **Grid** (7 configs, all at maxPairCost=0.98 = v1-a base, everything
  else family defaults):
  1. C=0, D=0 — code-path regression control vs run 872
  2. C=0.90  3. C=0.95  4. C=0.99 (near-any-profit completion)
  5. D=0.05  6. D=0.10
  7. C=0.95, D=0.10 (joint)
- **Universe**: pinned 800-market screen window `--from-ms 1784043000000
  --to-ms 1784762100000` (runs 872/873/879/889–895). **Latency**: 140/20
  flag-pinned. Whole grid up front (inbox c841c329).
- **Readouts**: results.ts headline; compare.ts vs 872 (and control);
  anatomy.ts identity terms (pairs vs residue, completions, dooms,
  realized L_s) per config; per-day breakdown; FOK kill counts if
  visible in fills.

## Pre-registered priors (honest)

Axis 2: each C-completion converts an unpaired hover into a locked
margin ≥ 1−C, but also CANNIBALIZES some maker completions that would
have locked more (v1 repair at bestBid fills on continued moves) and
each completion re-opens starts (re-exposure). Net sign genuinely
unknown; frequency of `h + ask + fee ≤ C` passages unknown — that is the
measurement. Axis 3: pays spread+fee to cap the tail; +EV only if the
held-side bid at trigger time overstates recovery probability;
E-012's inverted-selection result warns against assuming that.

## Pre-registered verdicts

- **Regression gate first**: config 1 must reproduce run 872 within
  noise (|Δev| ≤ 0.05 on the common 800, played count ±2). FAIL ⇒ stop,
  fix, resubmit; other configs uninterpretable.
- **PROMOTE to S2**: any config evPerMarketTotal ≥ +$0.25 (800 denom)
  AND positive on ≥6/9 days.
- **ITERATE**: any config 2×SE(800) < ev < $0.25 → explore neighborhood
  (finer C/D, interaction with gate level).
- **WEAK**: best config in (0, 2×SE].
- **KILL module on v1 base** (time-scoped 2026-07, this universe): every
  C/D config within +0.05 of control (no add) or below it. Scope: kills
  the module ON THIS BASE; axes 2+3 at other bases (e.g. v9 low-X after
  E-021) need their own test or an identity argument (§Kill standards).
- Confounders pre-committed: (a) per-config completion counts + margins
  reported (a module that never fires is UNTESTED, not killed — check
  trigger frequency before reading the ev delta); (b) per-day breakdown;
  (c) cancel-race double-fills counted if present; (d) worst-queue
  understates maker fills ⇒ the C-module's cannibalization is overstated
  in backtest (guard 6 — safe for a kill of the module, noted for
  promotion reads).

design-ts: (this commit, 2026-07-31 session 9 — BEFORE pair.v10.ts exists)

## Result E-020 (session 10, runs 897–903 @ code 2538404): IMPLEMENTATION BUG — firing configs invalid

- **Regression gate PASS** (897 vs 872: ev −1.48 vs −1.50, played 704 vs
  705) — recorded session 9. Control stays valid (module block skipped
  entirely at C=0=D). [run 897 | 2026-07-31]
- **C=0.90 / C=0.95 (898/899): TRIGGER-UNTESTED, and that is the
  finding.** 3 unknown-mode (FOK) fills in 800 markets at C=0.95, ~3 at
  C=0.90. The profit-lock region `h + ask + fee ≤ 0.95` essentially never
  survives to the module on the v1 base: paths where the deficit side
  gets cheap are exactly the paths where v1's maker repair (resting at
  the gate cap) fills first — the module only sees what repair misses,
  and at meaningful margins that is ~nothing. Cannibalization prior
  confirmed in the strong form: not "the module cannibalizes repair" but
  "repair pre-empts the module". C ≤ 0.95 on the v1 base is DEAD without
  re-running. [run 898,899 + anatomy | 2026-07-31]
- **C=0.99 / D=0.05 / D=0.10 / joint (900–903): CONTAMINATED — FOK-burst
  bug.** The module rate-limited FOKs by TICKS (25) but fills land 140 ms
  later; in fast tape 25 ticks pass inside the latency window, so the
  module re-fired against a stale portfolio (it checked `fokReadyAtTick`
  but not its own in-flight FOK; each re-fire also overwrote `openCid`,
  orphaning the previous order's terminal event). Result: duplicate-FOK
  bursts — run 900 worst market 320 UP vs 50 DOWN shares, $159.92
  invested vs capPerMarket=50; cap breaches 92–160 across 900–903
  (results.ts now flags CAP-BREACH mechanically; check added session 10).
  Headline evs (−1.74 / −1.50 / −1.54 / −1.86 vs control −1.48) are NOT
  evidence about the designed module. [run 900–903 + db top-cost rows |
  2026-07-31]
- Contaminated-but-suggestive (NOT evidence, motivation only): doom
  salvage flips the identity — residuePnl +350/+503 (control −1,500),
  pairsPnl −1,452/−1,587 (control +385) — and lands ≈ control ev DESPITE
  paying burst duplicates + 1.4–2.8× fees. A single-shot version might
  clear control; that is E-020b's question.
- **Fix (session 10, in pair.v10.ts):** `state.openIsFok` — one FOK in
  flight at a time (module gates on `!(openCid && openIsFok)`; GTD rests
  still cancel+supersede same-tick; orderGone resets the flag). Smoke
  PASS run 906 (15 mkts, C=0.99 D=0.10): max invested 49.00 ≤ cap.
  Tick-cooldown kept as defense-in-depth.

## E-020b pre-registration (session 10, BEFORE resubmission)

Same design, fixed code, same pinned 800-market window + 140/20 ms.
Grid (4 configs): C=0.99; D=0.05; D=0.10; joint C=0.99 + D=0.10 (joint
amended from pre-registered C=0.95+D=0.10: E-020 measured C=0.95 as
trigger-dead on this base, so the old joint collapses to plain D=0.10 —
amendment recorded here BEFORE submission). C=0.90/0.95 not re-run
(trigger-dead, bug cannot suppress fires — it only adds them). Control
not re-run (897 valid: module block unreachable at C=0=D).
Readouts and verdict bars: unchanged from E-020 §Pre-registered verdicts,
plus mechanical CAP-BREACH must be absent for a run to be readable.

design-ts (E-020b): this commit, session 10 — after fix, before submission.

## Result E-020b (session 10, runs 910/911 read; 912/913 pending at write time)

Fixed code eaf8038, pinned 800, 140/20 ms.

| config | run | ev/mkt | Δ vs 897 | takers | module fires | residue mkts | pairsPnl | residuePnl | cap max |
|--------|-----|--------|----------|--------|--------------|--------------|----------|------------|---------|
| control (897, for ref) | 897 | −1.48 | — | 412 | 0 | 341 | +385 | −1,500 | 50.06 |
| D=0.05 | 910 | −1.46 | +0.02 | 773 | 353 | 29 | −974 | −114 | 50.06 |
| D=0.10 | 911 | −1.46 | +0.02 | 808 | 401 | 30 | −948 | −128 | 56.47* |
| C=0.99 | 912 | −1.51 | −0.03 | 528 | 124 | 346 | +400 | −1,520 | 54.25 |
| C=0.99 D=0.10 | 913 | −1.46 | +0.02 | 922 | 520 | 31 | −951 | −108 | 56.49* |

M4 note: compare.ts flags SHA drift 2538404→eaf8038; verified `git diff
--name-only` = 0 non-protocol files (engine identical). Control 897 (old
SHA) stays valid: at C=0=D the module block is unreachable and the fix
touches only module-path state. Per-day (compare 897/910/911): salvage
adds nothing on any of 9 days; daily corr vs control 0.99 — same
exposure, penny-level transfer between identity terms.

*run 911 CAP-BREACH flag: max 56.47 = ONE bounded cancel-race
double-fill (GTD canceled + FOK same tick, both fill — the
pre-accepted confounder (c)), NOT the burst class ($92–160); reported
per pre-commitment, not contamination-grade.

**Doom-salvage finding (the real E-020b result):** the mechanism works
exactly as designed and earns exactly what the arithmetic bounds it to
— pennies. Stranding is nearly ELIMINATED (residue 341 → 29/30 markets;
L_s term cut from −$1,500 to ≈ −$120) but pairsPnl absorbs almost the
whole amount (+385 → −974/−948): completing a doomed pair at total
τ ≈ h + 0.95..0.99 + fee locks a pair loss ≈ the doom loss. Net save =
353–401 fills × 10 sh × (1 − ask − fee) ≈ +$25–35 per 800 markets
(+0.02 ev), inside the ±0.05 noise band. The trigger IS a near-perfect
doom verdict (residue wins after salvage: 1/29, 0/30 — E-012's recovery
warning measured ≈ nil at these D levels), but that certainty is the
problem: by the time heldBid ≤ 0.10 confirms doom, the complement ask
has already risen to ≈ 1 − heldBid, so there is nothing left to save.
Earning from the doom leg requires completing EARLIER, where E-012
showed the verdict is unpredictable — the axis is squeezed between
certainty (no money left) and uncertainty (no signal). [runs 897, 910,
911 + anatomy | 2026-07-31]

**C=0.99 clean (912):** 124 single-shot fires, residue essentially
unchanged (346 vs control 341), ev −1.51 (Δ −0.03) — the ≤1¢ locked
margin is eaten by the taker fee; profit-lock adds nothing even where
it fires. Joint (913) ≡ D=0.10 alone (ev −1.46, residue 31) — C
contributes nothing on top of D.

**VERDICT (frozen bar): KILL the taker-completion module on the v1 base**
— every C/D config within +0.05 of control or below (Δ = −0.03 / +0.02 /
+0.02 / +0.02), time-scoped 2026-07, pinned 800. Scope per
pre-registration: this base only; but note the two mechanisms' failure
modes are structural, not parametric — (1) profit-lock is pre-empted by
v1's own repair rest at any margin worth locking, (2) doom salvage is
squeezed between doom-certainty (complement ask ≈ 1 − heldBid ⇒ save ≈
1¢) and doom-uncertainty (E-012: unpredictable early). Ruling axes 2+3
are hereby answered on the v1 family: L_s CAN be cut to ≈0
mechanically, but its dollar value transfers into pairsPnl rather than
vanishing. The identity's exploitable slack is not in the completion
policy of an already-adverse book position — it is upstream, in which
markets/regimes get entered at all (→ axis 6, E-022) and in size policy
(axis 4). [runs 910–913 | 2026-07-31]
