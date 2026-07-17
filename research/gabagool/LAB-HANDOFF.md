# LAB-HANDOFF — gabagool knowledge shift → strategy-research-protocol

Written 2026-07-17 at saturation (see SATURATION.md). This file gives
the lab 3 family seeds for `strategy-research-protocol/scripts/
propose-family.sh "<seed>"`, plus the operating notes that make sim
results readable. Everything cites the knowledge base in this folder;
read STRATEGY-BRIEF.md first, PRIORS.md for any specific claim.

## Read-this-first operating notes (apply to every seed)

1. **Fees + rebates are exactly modelable — do it or the sign is
   wrong.** Current era (June+ replay): taker fee 0.07·p(1−p)/share on
   crossing fills, maker $0; maker rebate = 0.20 × Σ 0.07·p(1−p)·size
   over own maker fills, per market, $0 if < $1/market/day (A22 —
   pool share cancels; one-line post-hoc stats). Report trading and
   rebate as SEPARATE lines (H3: they are different businesses).
2. **The sim's maker fill model is a lower bound.** worst_queue admits
   44–49% of the archetype's real fills — the adverse subset (D2).
   Sim-negative absolute EV is expected, NOT a kill by itself; kill
   criteria and dispositions are written per-hypothesis in
   HYPOTHESES.md. Relative rankings on identical maker fills
   (completion policy, time-weighting) ARE trustworthy (H6 test path).
3. **Replay window**: Telonex coverage ends 2026-06-14 (G9). Use
   Jun 1–14 2026 (1,286 btc-15m markets on local disk) — era-consistent
   with the current fee/rebate regime.
4. **Scope confirmation**: btc-15m is the RIGHT book (H5 resolved:
   fee-inclusive positive for audited wallets while 5m is a subsidy
   game); the old P18 "15m ≈ 0 edge" prior is superseded (T1 closed).
5. **Competition reality** (not simulatable, G8): fragmented rebate
   pool (~$7.3k/day on btc-15m, biggest earner holds ~3–4%), a
   −$542k/30d failed challenger, and a taker-fee-tier moat (new
   entrants pay ~2× an incumbent's effective taker fee). Any
   sim-positive result inherits these as live risks, plus program risk
   (the venue demonstrably re-tunes fees/rebates and pays
   discretionary amounts — A21).

## Seed 1 — `pair-accumulator` (H1 + H6; rank 1)

    propose-family.sh "pair-accumulator: two-sided BUY-only ladder maker
    on btc-15m with delta-parity sizing and an explicit taker-completion
    policy. Decision driver: parity tolerance x completion policy. See
    research/gabagool/LAB-HANDOFF.md seed 1."

- **Mechanism**: rest small BUY clips on both legs around mid; size
  each new bid to close leg imbalance; complete the lagging leg by
  crossing ONLY when pair cost + fee stays under a hard cap. Existence
  proof running today: b27bc932 (pair cost p50 0.993, parity 1.6%, no
  merges, 50% taker completion — A24).
- **Baseline sweep** (priors: A17/A20/A24, BRIEF §4/§5):
  clip $1–10; ladder = touch + rungs at −2c…−13c below touch;
  band ≈ [0.11, 0.85]; parity tolerance {0.1%, 2%, 10%, 20%, 40%};
  completion policy {maker-only, taker-cap pair≤0.99, taker-cap
  pair≤0.97, taker-free}; time-weighting {uniform, minutes 8–13 heavy};
  minute-14 cutoff always on; never quote open-heavy (E24/A20).
- **Metrics** (METRICS.md): pair cost, pair completion, fee-inclusive
  margin, exact rebate line, fills/market, unpaired exposure $, PnL
  tails, minority-outcome count ≥ 30 before judging.
- **Kill**: fee-inclusive pair margin + exact rebate < 0 across the
  whole sweep (now decidable in sim, A22). Sub-kill signal to report
  either way: does completion-policy ranking reproduce H6's ~2% margin
  spread?
- **SRP lineage**: spread-capture roadmap #6 (bid-side mirror) is this
  family; spread-capture died WITHOUT parity control (P42) — parity is
  the decision driver, not a detail.

## Seed 2 — `cheap-side-accumulator` (H2; rank 2)

    propose-family.sh "cheap-side-accumulator: deep discount BUY ladders
    on the 0.02-0.15 side of btc-15m, loose parity, hold to redemption.
    Decision driver: entry band x hold. See
    research/gabagool/LAB-HANDOFF.md seed 2."

- **Mechanism**: harvest panic-dumps of dying longshots and sweeps into
  deep bids (b55f's live profile: 47% win, right-tail payoff, never
  merges — verified +2.31% fee-inclusive with taker completion).
- **Baseline sweep**: entry band 0.02–0.15 (b55f p25 0.09); clip
  ladder $1–200; hold-to-resolution always; optional endgame guard from
  the flip table (A20: trailing side is ~1–5c overpriced — deep
  discounts are mandatory, touch-chasing the cheap side is the trap).
- **Kill** (H2): sim EV < 0 across the Jun window at every band cell
  under the CURRENT fee curve, maker fills only. Judge on market-level
  EV with minority count ≥ 30 (fable E14) — tail shape is the result.
- **SRP lineage**: endgame-panic-bid measured the last-seconds slice ≈
  breakeven (P43); this family differs by operating the whole window.

## Seed 3 — `fair-value-gated-maker` (H4; rank 3, BLOCKED)

    propose-family.sh "fair-value-gated-maker: pair-accumulator quoting
    filtered by Binance-anchored fair value; suppress the rich side.
    Decision driver: suppression threshold. See
    research/gabagool/LAB-HANDOFF.md seed 3."

- **Blocked on**: operator merging the `binance-aggtrades-r2-sync`
  branch (feed is implemented + verified there, 110ms latency baked
  in). Do not start before that merge.
- **Mechanism**: quote like seed 1 but pull the side fair value calls
  rich (|p_book − p_fair| threshold 1–5c); targets the P42 first-fill
  adverse-selection channel. Strike proxy = window-open spot; NOTE the
  oracle basis caveat (A18): resolution reads Chainlink, not Binance —
  keep the anchor for mid-window filtering, distrust it in the final
  seconds.
- **Scope flag for the proposal**: SRP SCOPE.md currently forbids
  external feeds; the ban's rationale (non-replayable) is obsolete for
  this feed (replayable-deterministic). The proposal must surface this
  explicitly — scope change is the operator's call.

## Not proposed (and why)

- Rebate-volume farming (b27bc932's actual business): income is ~97%
  venue discretion (A21/A24) and requires tier position + scale a lab
  family cannot express; H3's role is to make you read sim results as
  two lines, not to be built.
- Own-the-open: Game F is negative for this cohort (A17) and opening
  touch quoting is adversely selected from the first seconds (E24).
- Instantaneous dutch book / zero-fee replication / post-first-fill
  unwind cleverness: discarded with evidence in HYPOTHESES.md.

## Pointers

- Build spec: STRATEGY-BRIEF.md. Testable set: HYPOTHESES.md. Metric
  definitions: METRICS.md. Venue numbers: VENUE-MECHANICS.md. Sim
  blind spots: ENGINE-GAPS.md (G1–G9). Wallet evidence: wallets/ +
  measurements/. Claim provenance: PRIORS.md (P1–P51, A1–A24).

## Phase-2 addendum (session 7) — rebate lines per seed (W5, A28)

Exact per-policy subsidy math in
measurements/rebate-economics-per-policy.md. What changes for the
seeds:

- All seeds: report the rebate line SEPARATELY from trading margin,
  and as a LOWER BOUND (worst_queue admits ~44–49% of touch fills, so
  sim rebate ≈ half of live for touch-heavy cells).
- The $1/day/market payout threshold makes rebates a STEP function:
  cells below ~$143 (balanced) / ~$75 (cheap-side) maker notional per
  market earn $0 — do not average the rebate across sweep cells.
- Seed 1: maker-only cells are subsidy-viable standalone at +0.7% of
  maker notional; taker-completion cells pay 3.0–3.5% on the taker
  leg at mid-band — separate economics regimes, judge separately.
- Seed 2 gains the most: cheap-side maker fills earn ~1.3% of
  notional (double balanced) on top of the only measured positive
  fee-inclusive margin (+2.31%T). Paper total ≈ +2.7–2.9%T.
- Farmer-posture variants (pair cost >$1, live on taker-rebate
  tiers): confirmed non-viable cold-start; do not seed.

## Phase-2 addendum (session 7) — the deep-pair cell (A30)

New atlas find 0x04b6d7e9 (wallets/04b6d7e9.md): the only known
trading-profitable parity wallet at scale today runs a variant BETWEEN
seed 1 and seed 2 — parity-ladder discipline with deep-discount
economics (maker share 0.88–1.00, pairRate 0.78, pair cost
0.964–0.976, clips ~$5, BTC-only, no merges). Seed-1 sweeps MUST
include a deep-pair cell: pair-cost target ≤0.98 (not just ≤0.995),
maker-only/patient completion, parity tolerance loose enough to
tolerate ~20% unpaired inventory. H6's "completion aggressiveness"
axis is not monotone — the live winners sit at BOTH ends (b55f
taker-aggressive at +2.31%T, 0x04b6d7e9 maker-patient at +0.30%T on
16× the turnover), and the breakeven wallet (b27bc932) sits in the
middle. That U-shape is itself a testable prediction for the sweep.

## Phase-2 addendum (session 7) — cold-start rules (A32)

The lab's bot is a cold-start (taker tier 3%). Measured consequence
(measurements/cold-start-economics.md): maker-pure and deep-pair cells
are TIER-IMMUNE (two live cold-start wins as existence proofs);
taker-completion cells must be simulated at tier-0 (3% refund), NOT at
incumbent tiers — using b55f-tier economics for a new bot overstates
taker-leg EV by up to ~1.7% of taker notional. Report maker-only and
taker-completion cells as separate economic regimes.

## Phase-2 addendum (session 7) — paper-EV ranking (W6, full table in measurements/paper-ev-seeds.md)

Updated seed ranking from measured priors: (1) seed 1 with the
DEEP-PAIR cell as primary target (net +0.9–1.4%T expected, tier-immune,
two live existence proofs); (2) seed 2 cheap-side (+2.0–3.0%T expected
but tail-shaped — minority-outcome verdict required); (3) plain-parity
0.99+ cells as baseline ring around the deep-pair cell; (4)
taker-completion cells at tier-0 as comparison-only (expected ≈ 0, they
measure the H6 completion premium); (5) seed 3 stays blocked. Sim
reading rules (D2 2× fill lower bound, rebate step, tier-0 fee lines,
subsidy-share reporting) are in the note — apply them before killing
any cell.

## Phase-2 addendum (session 8) — mechanism priors A34–A48

Session 8 turned the deep-pair cell from a target into a SPEC. What
changed for the lab, in build order:

1. **The (offset × requote-interval) axis is JOINT with two optima
   (A37/A38, replicated 4 months × 4 sessions)**: fast requoting
   wins AT the touch (133 fills/mkt p50 vs 58 at 15s), and HURTS at
   −2c and deeper (patient standing rungs win there). Sweep the two
   corners — fast+shallow (the 0x04b6d7e9 recipe) and slow+deep
   (b55f) — not a full grid; the middle is dominated. The
   $143/market rebate step is reachable MAKER-ONLY at touch/−1c in
   ≥75% of markets in every month/session stratum.
2. **The shallow-fast cell gets an entry gate (A44/A45)**: prefer
   quoting when |30s mid drift| ≈ 0; HARD veto fills within ~10s of
   a fall (held 3/3 day-samples); never instant-requote upward
   under a rally (that manufactures the breakeven wallet's
   local-top fills). Directional 30s+ momentum signals flip sign by
   day — sweep, never fix. Post-fill mid drift @60s per fill class
   is the cell diagnostic (A39): it separates winner from breakeven
   before PnL converges.
3. **Session is a first-class dimension (A35/A36/A46)**: the
   grinder recipe is gross-negative 12–19Z (2/2 samples) and
   positive off-hours; the strongest living wallet trades ONLY
   12–19Z weekdays with the shallow-fast recipe. Evaluate every
   cell per session bucket; a v1 that switches recipe (or idles) by
   clock matches both living winners.
4. **Leg-risk numbers are now measured (A34/A47/A48)**: leave the
   FAVORITE-side leg unpaired (cheap-side excess pays the flip
   lottery; favorite-lean earns the base rate); ≥0.99 legs ride to
   redemption (0/393 flips); pairing clock is ~1 min (2/3 of pair
   volume ≤60s) — legs unpaired >5 min are structural excess to
   manage, not await; timeouts belong in 60–300s.
5. **Expectations (A43)**: the per-operator ceiling compressed 5×
   in 8 months; realistic v1 ceiling is $1–3k/day. Winners exit at
   full speed when margins compress (n=8); the downside profile is
   compression, not blow-up (no class casualty exists, A26).
6. **Data trap (G10)**: January Telonex books are ~27% empty stubs
   on the sampled day — filter markets by event count before any
   January backtest or the sim silently under-fills.
