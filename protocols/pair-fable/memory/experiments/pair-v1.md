# Family: pair-v1 (entry discipline + repair + end cutoff)

Strategy file: `protocols/pair-fable/strategies/pair.v1.ts` (id
`pair-fable-v1`). Derived from pair-v0; same 6 params (M5-bounded), three
STRUCTURAL changes targeting v0's loss anatomy (pair-v0.md §Loss anatomy).

**design-ts (M2 rule)**: the commit that adds pair.v1.ts AND this file with
the frozen configs below is the param-freeze commit for BOTH pre-registered
configs. Recorded in LEDGER when runs land. Any config change after this
commit ⇒ new design-ts.

## Design deltas vs v0 (structural, not tunable)

1. **Start discipline**: new increments (balanced book) only JOIN bestBid,
   and only when the pair gate holds at that price — i.e. the pair is
   completable at top-of-book. v0's deep below-bid first legs (its main
   adverse-selection source: worst-queue fills them preferentially when the
   market moves against them) no longer exist. Consequence: v1 skips
   markets/moments where bestBid(UP)+bestBid(DOWN) > maxPairCost.
2. **Repair aggression**: the completion leg is priced at its full gate cap
   (may improve ABOVE bestBid, still strictly below bestAsk ⇒ maker, $0
   fees). v0 joined bestBid on the completion leg too, leaving residue
   unrepaired when the book never came back.
3. **End-of-window cutoff**: no new pair starts in the last 3 min of the 15m
   window (design constant 180s, not a param — must earn a slot per guard
   2); repair allowed to the end. Window end parsed from the slug epoch —
   identical live/replay.

## Pre-registered hypothesis + grid (guard 1, BEFORE launch)

**Hypothesis**: v0's −2.24/mkt is dominated by unpaired residue (p10 = −100
per $100; markets losing the entire one-sided investment). Cutting the three
residue sources should cut lost markets and raise ev materially; the cost is
fewer played markets (start gate skips uncompletable books) and slightly
worse pair prices on repair legs. Prediction (falsifiable): v1 ev > v0 ev by
more than the 0.05 noise threshold on the same screen universe, driven by a
lower lost-market fraction, NOT by lower volume alone — check profitPer100
moves the same direction as ev (E-004's failure mode: ev up, per-dollar
down = "trade less, lose less", not a cure).

Grid (all screen `--latest --limit 800` @ 140/20ms):

| config | params | rationale |
| --- | --- | --- |
| v1-a | defaults (maxPairCost 0.98) | isolate the structural deltas vs v0 defaults |
| v1-b | maxPairCost=0.95 | E-004 direction (2.5× reward/pair) × structural fixes; the start gate makes 0.95 far more selective |

Baseline: fresh v0 screen run at defaults on the SAME universe (`--latest
--limit 800`, 140/20ms) — prior v0 runs used the 300-OLDEST universe, not
comparable without heavy intersection loss; a fresh baseline is one cheap
run and stays reusable ≤7 days (evaluator.md §Universes).

Evaluation: compare.ts / evaluate.ts S1 per evaluator.md — ADVANCE needs
Δev > max(2×0.05, 0.05) vs the v0 baseline or ev > 0. Family noise floor:
inherit pair-v0's measured 0.0008 (same passive-GTD-maker mechanism, so the
0.05 conservative default governs anyway; re-measure only if v1 goes
taker-heavy, which its taker share will show).

## Runs

design-ts (both configs) = freeze commit `6a1ecde` @ 2026-07-31T01:44:42+02:00
(= 2026-07-30T23:44:42Z). Smoke: run 871 (5 mkts, 0 failures).

All 2026-07-31, `--latest --limit 800` @ 140/20ms, identical 800-market
universe (2026-07-14 → 07-22, common=800/800/800 — launched minutes apart):

| run | config | pnl | ev/mkt | p/100 | won/lost/flat | trades m/t | taker% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 874 | v0 baseline (defaults) | −1686.90 | −2.1086 | −9.18 | 125/533/142 | 3885/60 | 1.5% |
| 872 | v1-a (defaults 0.98) | −1201.55 | −1.5019 | −8.05 | 365/340/95 | 2682/415 | 13.4% |
| 873 | v1-b (0.95) | −853.54 | −1.0669 | −9.17 | 301/315/184 | 1699/318 | 15.8% |

## Findings (screen, 2026-07-31 — S1 verdicts)

- **v1-a vs v0 (872 vs 874): Δev +0.6067, Δp/100 +1.1348 — BOTH units
  improve.** This is a real mechanism gain, not E-004's "trade less, lose
  less" (the pre-registered falsifiability check passes). Win rate 21%→51.7%
  (pnl_avg_win +0.57, avg_lose −4.14 vs v0's much worse skew). S1 call:
  Δev ≫ 0.05 ⇒ ADVANCE-direction, but ev is still < 0 ⇒ family verdict
  ITERATE (an S2 FULL on a known-negative variant buys little — iterate the
  design first). [runs 872/874 | 2026-07-31]
- **v1-b vs v0 (873 vs 874): Δev +1.0417 but Δp/100 +0.0102 (flat)** —
  invested drops $9.1k (−61%): roughly half the ev gain is volume reduction
  (E-004's failure mode), the other half real (v1-a isolates the structural
  part). Best headline ev of the family so far: −1.0669. ITERATE.
  [runs 873/874 | 2026-07-31]
- **Taker share exploded: 1.5% (v0) → 13.4/15.8% (v1)**. The repair-at-cap
  legs quote near the ask, and book drift across the 140ms latency converts
  them to taker (mechanism confirmed at small scale by E-003). pnl is net of
  those fees, so the +0.61 gain already absorbs them — but this is exactly
  the "quietly crossing when late" pattern S3 kills (m6 gate), and it will
  worsen with latency. v2 priority: repair pricing that improves the level
  WITHOUT hugging the ask (e.g. min(gateCap, bestBid+1 tick), or cap repair
  price at bestAsk − 2·GRID). [runs 872/873 | 2026-07-31]
- Same-family correlation 872~873 r=0.912, vs v0: 0.9486/0.8164 — same bet,
  as expected; no portfolio value inside the family. [2026-07-31]
- Next-step candidates (pre-register before launching): (a) v2 repair
  pricing variants per above; (b) loss anatomy on 872's 340 lost markets —
  meta `m:'S'|'R'` now distinguishes start vs repair fills, so residue
  source is measurable per market; (c) only after ev approaches 0: FULL +
  sweep (S3 will be the binding gate given the taker trend).

## Anatomy (tools/anatomy.ts on 872/873/874, 2026-07-31 — session 2)

pnl decomposes exactly (recon err ≤ 0.01/row, 0 bad rows) into paired
(min(up,down) shares, margin 1 − avgUp − avgDown) + residue (|up−down|,
pays only if the surplus side wins):

| run | pairsPnl | residuePnl | residue mkts won/lost | fills S/R (repair rate) | fees |
| --- | --- | --- | --- | --- | --- |
| 872 v1-a | +382.46 | −1515.78 | 1/344 | 1714/1374 (80.2%) | 68.30 |
| 873 v1-b | +497.27 | −1301.11 | 1/319 | 1164/844 (72.5%) | 49.71 |
| 874 v0 | +844.59 | −2524.68 | 5/609 | n/a (no `m` key) | — |

- **The entire loss is residue, and residue is ~always adverse: 344/345
  lose** (the unrepaired side is by construction the side price ran away
  from; held to settlement it recovers ~0 — 1 win of $7 vs $1523 lost).
  Residue qty median = p90 = 10: exactly ONE doomed increment per market.
  [runs 872/873 | 2026-07-31]
- **Per played market (872): pairs +$0.54, doom −$2.15** (49% of played
  markets end doomed × $4.43). Break-even repair rate ≈ 94%; actual 80.2%.
  Completed pair margin $0.28/increment (2.8c/pair — entries fill below the
  0.98 gate). 873: margin $0.59, repair rate 72.5%, doom rate 52% — margin
  effect wins on ev but completion drops with the tighter gate.
  [runs 872/873 | 2026-07-31]
- **Doom hazard is FLAT across start minutes** (~0.16–0.27 per start every
  minute in 872; no late-window spike — the 3-min cutoff removed it, and no
  minute-0 excess either: minute 0 dominates dooms only because 555/1714
  starts happen there). A start-delay variant is NOT supported — killed
  before launch. [run 872 | 2026-07-31]
- **Taker fees are a minor pnl item**: $68.30 of −$1201.55 (872). The 13.4%
  taker share matters for S3/live-parity, not for pnl. Attribution bound:
  only 15/415 takers occur in all-S markets ⇒ repair legs are the dominant
  taker source (mixed markets undecidable from stored rows but carry ~all
  the rest). [run 872 | 2026-07-31]
- **v1's repair leg stops chasing at the START gate** (pair.v1.ts uses
  cfg.maxPairCost for both modes), yet completion stays profitable to pair
  cost <1.00 — the gate blocks still-profitable repairs. Plus each failed
  repair cycle leaves the imbalance unquoted for TTL+cooldown. → pair-v2
  family (repair persistence), see pair-v2.md. [code + runs 872/873 |
  2026-07-31]

- Movers 872 vs 874 (compare.ts, 2026-07-31): v1's four worst deltas are
  v0 markets at ≈+$10 (v0's deep bids occasionally catch a full WINNING
  residue — a lottery v1's join-only starts give up); its gains are many
  −$5..−7 v0 residue losses cut to ≈+$0.5. Consistent with the anatomy:
  v1 trades tail-lottery wins for systematic residue-loss reduction.
  [runs 872/874 | 2026-07-31]

## Gate-curve extension (pre-registered 2026-07-31, session 2 — v1-c/v1-d)

**Hypothesis**: ev(gate) has an interior optimum between 0.98 (v1-a,
−1.50) and something below 0.95 (v1-b, −1.07): pair margin rises ~linearly
as the gate tightens while completion rate and volume fall. Two more points
bracket the curve. The E-004 check applies: a variant whose ev gain comes
with invested collapse and flat/worse p/100 is volume reduction, not cure.

| config | params | note |
| --- | --- | --- |
| v1-c | maxPairCost=0.96 | between a and b |
| v1-d | maxPairCost=0.93 | below b — expect worse if 0.95 is near-optimal |

Screens `--latest --limit 800` @ 140/20ms vs baseline 874 (intersection).
design-ts for both = the commit adding this section (M2 param-variant rule)
= `0f0f423` @ 2026-07-31T00:06:47Z.

### Gate-curve results (runs 878/879, 2026-07-31 — hypothesis REFUTED)

Full curve on the identical 800-market universe (all @ 140/20ms):

| gate | run | ev/mkt | p/100 | invested | played | doom rate |
| --- | --- | --- | --- | --- | --- | --- |
| 0.98 | 872 | −1.5019 | −8.05 | 14927 | 706 | 49% |
| 0.96 | 878 | −1.2265 | −8.28 | 11851 | 686 | 51% |
| 0.95 | 873 | −1.0669 | −9.17 | 9304 | 618 | 52% |
| 0.93 | 879 | −0.5537 | −8.38 | 5283 | 416 | 48% |

- **No interior optimum: ev is monotone in the gate while p/100 is flat at
  −8.0..−9.2 per $100 in EVERY config.** The whole curve is E-004's "trade
  less, lose less": invested falls 14.9k→5.3k while the per-dollar loss
  rate stays constant. Doom rate is gate-invariant (~50%). Tightening the
  gate converges to ev 0 by not trading — it is NOT a path to profit.
  [runs 872/873/878/879 | 2026-07-31]
- 879 (0.93) posts the family's best headline ev (−0.55) purely via volume
  (played 416/800, 384 flat). Not promoted; recorded as the curve endpoint.
- **Axis verdict: pair-v1 mechanism tuning is exhausted** — entries (v1),
  repair (v2, see pair-v2.md KILL), gate level (this curve) all leave the
  per-dollar loss unchanged. Next axis: START SELECTION on market state
  (contested vs decided windows via spot/priceToBeat feeds — pair-v3
  direction). Stopping-rule note (guard 4): family is at 6 configs
  (a,b,c,d + v2-a,b) without a real per-dollar improvement.
- **2026-07-31 session-3 update**: the start-selection axis was killed at
  Phase 0 (pair-v3.md — spot/ptb state carries zero doom signal). The next
  axis is the §Cadence model below.

## Cadence model (session 3, 2026-07-31) — the family's exact P&L algebra

pair.v1.ts is one-resting-order-at-a-time, and while imbalanced it only
quotes repair ⇒ residue is structurally EXACTLY one increment (matches
anatomy: residue qty median = p90 = 10 in every run). Per played market with
S start-fills and doom probability q (window ends imbalanced):

    pnl/played = inc × [ g_sh·(S − q) − avgE·q ]

where g_sh = pair margin per paired share and avgE = avg entry price of the
doomed increment. **inc multiplies but never flips the sign** — the
residue-quantum idea (smaller incrementSize) is dead by arithmetic, no runs
needed. The only levers: S (start cadence), g_sh (gate), q (unpredictable —
pair-v3.md). Break-even start rate S* = q·(1 + avgE/g_sh), from anatomy runs:

| gate | run | g_sh | avgE | q | S* (break-even) | S (actual) | gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.98 | 872 | 0.0279 | 0.439 | 0.489 | 8.18 | 2.42 | 3.4× |
| 0.95 | 873 | 0.0589 | 0.407 | 0.518 | 4.10 | 1.88 | 2.2× |
| 0.93 | 879 | 0.0799 | 0.404 | 0.476 | 2.88 | 1.64 | 1.8× |

(879: paired increments = R fills = 484 ⇒ g_sh = 386.47/4840; avgE =
799.77/198/10; q = 198/416.) The tighter the gate, the SMALLER the cadence
gap to profitability — the gate curve killed gate-tightening at FIXED
cadence, but gate × cadence is untested. Current cadence is TTL-bound:
cycle ≈ (fill wait or ttlSec 90s) + cooldownTicks 25.

## Cadence extension (pre-registered 2026-07-31 session 3 — v1-e/f/g)

**Hypothesis**: S is elastic in ttl/cooldown (unfilled orders requote at a
fresh bestBid sooner), and q is a per-market terminal event roughly
invariant to S (the strategy is already exposed most of the window, so more
starts do not proportionally raise the chance the window ends imbalanced).
If both hold, ev and p/100 improve together as S rises, and gate 0.93 needs
only S ≈ 2.9 to cross zero.

**Decisive discrimination**: if instead q rises ∝ S (per-start hazard
world, each start an independent ~20% coin), then pnl/played =
inc·S·[g_sh(1−p) − avgE·p] < 0 at EVERY gate and EVERY cadence
(0.98: 10S·(0.0279·0.8 − 0.439·0.2) = −0.65·S; 0.93: −0.13·S) — the whole
one-order-at-a-time pair mechanism is unprofitable regardless of tuning,
and the family moves to KILL/redesign. One cheap batch decides this.

Grid (screens `--latest --limit 800` @ 140/20ms; ttlSec=61 is the engine
minimum, cooldownTicks=5 near-minimum; all else defaults):

| config | params | prediction if q-terminal holds |
| --- | --- | --- |
| v1-e | ttlSec=61 cooldownTicks=5 (gate 0.98) | S 2.4→≥3.2, p/100 improves from −8.05, ev still <0 (S* 8.2 unreachable) |
| v1-f | ttlSec=61 cooldownTicks=5 maxPairCost=0.95 | S 1.9→≥2.6, ev −1.07→≥−0.6 |
| v1-g | ttlSec=61 cooldownTicks=5 maxPairCost=0.93 | S 1.6→≥2.2, ev −0.55→≥−0.25; if S ≥ 2.9 with q,g_sh held: ev ≥ 0 |

**Falsifiable kill/advance rules (BEFORE launch)**: ADVANCE the cadence axis
iff S rises ≥1.3× at some gate AND p/100 improves beyond noise with q rising
by less than half the relative rise of S. KILL the cadence axis if S barely
moves (<1.3× everywhere — cadence is fill-limited, not TTL-limited) or if
p/100 stays flat while S rises (per-start-hazard world confirmed) — in that
world the next step is mechanism redesign (both-sides start quoting /
requote-on-book-move as code, or family KILL per guard 4), not more params.
Watch taker% (S3 concern): faster requoting must not push taker share
materially above the ~13–16% of the parents.

Baselines: same-gate parents 872/873/879 via compare.ts intersection.
design-ts (M2 param-variant rule) = the commit adding this section
(`f938160` @ 2026-07-31T00:34:09Z). Smoke: run 880 (5 mkts, 0 failures).

### Cadence-extension results (runs 881/882/883, 2026-07-31 — KILL)

Identical 800-market universe as the parents (common=800/800 all pairs;
cross-run SHA warnings benign — every commit 6a1ecde→f938160 touches only
protocols/ files). All @ 140/20ms:

| config | run | ev/mkt | Δev vs parent | S/played (parent) | q (parent) |
| --- | --- | --- | --- | --- | --- |
| v1-e 0.98 ttl61/cd5 | 881 | −1.4920 | +0.0099 | 2.41 (2.42) | 0.484 (0.489) |
| v1-f 0.95 ttl61/cd5 | 882 | −1.0033 | +0.0635 | 1.87 (1.88) | 0.495 (0.518) |
| v1-g 0.93 ttl61/cd5 | 883 | −0.4601 | +0.0937 | 1.63 (1.64) | 0.436 (0.476) |

- **S is COMPLETELY inelastic to ttl/cooldown: 2.41/1.87/1.63 vs
  2.42/1.88/1.64** — a 32% shorter TTL and 5× shorter cooldown changed the
  start rate by <1%. The pre-registered KILL rule fires: cadence is
  FILL-LIMITED, not TTL-limited — fills happen when price trades through
  bestBid, and the frequency of those crossings is market-given. More
  requoting cannot raise S. [runs 881–883 vs 872/873/879 | 2026-07-31]
- The small positive Δev at tighter gates (+0.06/+0.09, at/under 2× noise)
  comes from slightly fewer dooms (883: q 0.436 vs 0.476, played 401 vs
  416) — shorter exposure per order, not more starts. Not a mechanism gain.
- **The q-terminal vs per-start-hazard discrimination DID NOT HAPPEN** (S
  never moved, so q-elasticity w.r.t. S is still unmeasured). It transfers
  to the pair-v4 test below.
- **Consequence**: within one-order-at-a-time quoting, S is capped at the
  one-sided crossing rate ⇒ S* is unreachable at every gate by parameter
  tuning. The one structural way to raise S without leaving top-of-book:
  quote BOTH sides simultaneously when balanced (v1 misses every crossing
  on its unquoted side; symmetric crossings ⇒ S up to ~2×, and a
  double-fill race = instant pair at bid-sum cost). At gate 0.93 that
  projects S ≈ 3.3 > S* ≈ 2.7 ⇒ positive ev IF q holds. → family pair-v4
  (both-sides start quoting), new code, own file. Guard-4 count: family at
  9 configs without a per-dollar cure; pair-v4 is a mechanism change, not
  an escalation of this grid.
