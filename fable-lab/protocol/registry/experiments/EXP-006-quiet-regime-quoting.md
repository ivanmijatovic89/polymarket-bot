# EXP-006 — quiet-regime two-sided quoting

<!-- SPEC — frozen after the first non-smoke run exists. Fill every field.
     "Runs" and "Verdicts" below are append-only forever. -->

## Spec

- **Registered:** 2026-07-10 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 4 "Quiet-regime two-sided quoting"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `spread-capture`
- **Direction note (DECISIONS D14):** first maker-side experiment, registered
  after E9–E14 established that every taker mechanism tested is priced fairly
  and the 156 bps taker fee makes taker strategies strictly negative. The
  maker fee in the model is ZERO (CAPABILITIES §4) — the cost structure that
  killed EXP-001..005 does not apply here; the open question is whether
  adverse selection alone consumes the passive discount.
- **Hypothesis (who loses and why):** Impatient or forced takers cross the
  spread during quiet mid-episode stretches — hedgers adjusting, holders
  exiting early, retail chasing small moves — and pay the spread to whoever
  rests inside it. A passive bidder posted δ below fair on BOTH sides
  simultaneously (BUY UP and BUY DOWN — buying DOWN is the no-short way to
  sell UP) is compensated for supplying that liquidity: a completed pair
  costs (fillUP + fillDOWN) ≈ 1 − 2δ and settles at exactly $1, and
  one-sided inventory is acquired at a discount to the fair price at quote
  time. Under the simulator's worst-queue model a fill happens ONLY when the
  book trades strictly through the level, so every simulated fill is
  maximally adversely selected; the hypothesis is that in QUIET regimes
  (low trailing mid-range) such punch-throughs are noise that reverts rather
  than information that trends, so discount + pair-completion capture exceed
  the adverse-selection loss. If quiet-regime punch-throughs are instead
  informative (the move continues), fills are toxic and the mechanism is
  contradicted.
- **Falsifiable prediction:** Conditional on quoting only in quiet windows
  (trailing 60s UP-mid range ≤ quietRangeMax, both books uncrossed —
  LESSONS E6, episode clock inside [minElapsedSec, 900−stopBeforeEndSec]),
  played markets have gross EV/market > 0 — and since the model's maker fee
  is zero, gross = net, so the standard q/t readout IS the prediction check.
  If EV(played) < 0, adverse selection under worst-queue exceeds the
  discount plus pair capture and the mechanism (as backtestable) is
  contradicted. **Design-failure clause:** worst-queue cannot observe
  at-touch fills, so fills may be structurally rare; if fewer than ~3% of
  markets get any fill, the probe is a design failure (the simulator cannot
  see the mechanism), NOT evidence against it — outcome is iterate/park with
  the measured punch-through frequency recorded as the transferable number.
  **Model-conditional kill (D14):** a kill here closes the backtestable
  (punch-through) version of the mechanism only; at-touch liquidity
  provision live remains unmeasured by construction.
- **Strategy:** `fable-lab/strategies/spread-capture/EXP-006.ts`, id `fable-exp-006`
- **Primary parameter cell:** `--param offset=0.01 --param quietWindowSec=60 --param quietRangeMax=0.08 --param requoteDelta=0.01 --param minElapsedSec=60 --param stopBeforeEndSec=120 --param shares=10 --param maxInventory=50 --param minPrice=0.05 --param maxPrice=0.95`
- **Robustness neighborhood:** offset ∈ {0.01, 0.02} × quietRangeMax ∈
  {0.04, 0.08, 0.12}, minus the primary; other params fixed; judged on
  sign-smoothness only.
- **Registration amendment (2026-07-10, PRE-FREEZE — no non-smoke run
  exists):** the originally registered cell (offset=0.02,
  quietRangeMax=0.02) was structurally fill-less: the diag-quiet fixture
  (EXP-000-debug) measured quiet-at-0.02 in only 0–3% of in-window ticks,
  clustered at pinned near-decided mids (mean quiet-tick mid 0.97 / 0.02)
  where the price bounds block quoting — and because the strategy requotes
  on ≥1c drift, a worst-queue fill needs a SINGLE-TICK gap through the bid,
  which at ~50 events/sec never reaches 2c in a ≤2c-range regime. Fill
  feasibility was then measured with the real engine on 30 random
  exploration markets per cell (batchUid EXP-000-debug), reading ONLY
  maker-fill counts, never PnL: (offset 0.02, qr 0.02) → 0 markets filled
  of 10 (smoke); (0.02, 0.04) → 0/30; (0.01, 0.04) → 1/30; (0.01, 0.08) →
  6/30 markets, 7 maker fills. The primary cell is amended to the feasible
  (0.01, 0.08). Because no PnL was read, this is fill-rate design, not
  outcome mining; lineage_cells stays 1.
- **Simulator-bias exposure (CAPABILITIES §4):** Maker-fill dominated BY
  CONSTRUCTION, so per DECISIONS D6/D14 this experiment is
  **`simulator-favored` on the size axis from the start**: worst-queue fills
  are always the FULL remaining size regardless of traded volume. Mitigation:
  shares=10 (tiny vs typical book depth), maxInventory=50/side (max ~$95 at
  risk per market, far inside maxLossStop 500). Pessimistic side: no fill at
  touch — every fill requires the ask to cross strictly below the bid, i.e.
  maximal adverse selection; zero maker fee matches Polymarket's actual
  maker fee. Contamination risk: self-crossed recorded books (E6) can grant
  phantom fills into stale crossed states; the strategy cancels quotes on
  crossed ticks but CANNOT prevent a same-tick phantom fill — composition
  diagnostics at judging must consider whether PnL is dominated by
  implausible fills. Pre-commitment: even a full advance chain cannot
  confirm on backtest evidence alone; the required next step of any advance
  is live paper validation (D6 escalation).
- **Windows (computed by tools/universe.ts at registration, re-verified
  2026-07-10: 18,635 eligible, exploration 13,976 / holdout 4,659):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted (subject to
    the design-failure clause above); skewed-payoff precision rule (D13)
    applies if win rate lands outside [0.1, 0.9] — verdict must state the
    minority-outcome count
  - main advance: t ≥ 2 on primary cell (lineage_cells=1, p-bar 0.023) +
    battery pass + explicit `simulator-favored` escalation per D14 (this
    experiment can never claim a clean classification)
  - holdout confirm: t ≥ 2 on holdout alone; even then the verdict is
    "confirmed-in-model", next step live paper
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0 (latency delays
  our requotes/cancels → stale quotes get picked off; expect the curve to
  slope DOWN, and record it)

## Runs (append-only)

<!-- one block per run, pasted verbatim from tools/results.ts -->

- 2026-07-10 — smoke (EXP-006-smoke, run 328, 10 markets): green plumbing
  (509k events replayed, 0 failures), 0 fills — led to the pre-freeze
  amendment above; never evidence.
- 2026-07-10 — fill-feasibility diagnostics (EXP-000-debug, 30 random
  exploration markets per cell, fill counts only, PnL never read): see the
  amendment block in the spec.
- 2026-07-10 — run 334 (batchUid EXP-006-probe) VOID: first probe launch
  killed by the Scientist at 70/500 markets to replace the strategy's
  O(n²) rolling-range scan (~5s/market, would make main-stage ~19h+) with
  an O(1) monotonic-deque window. No statistics of run 334 were ever read.
  Semantic identity of the rewrite verified mechanically: the (0.01, 0.08)
  cell rerun on run 332's exact 30 slugs (run 335, EXP-000-debug) matched
  332 per-market on pnl / maker / taker / cost / up_shares / down_shares /
  skip_reason 30/30 each; throughput 1.56s/market (was ~5). Probe relaunched
  on the committed rewrite — the EXP-006-probe batchUid has runs 334 (void)
  and the relaunch; decisive readouts address the relaunch BY RUN ID.

- 2026-07-10 — probe (run 336, the relaunch; decisive per the run-ID note
  above), verbatim from tools/results.ts:

```
=== results: run 336  batch EXP-006-probe ===
strategy fable-exp-006  params {"offset":0.01,"shares":10,"maxPrice":0.95,"minPrice":0.05,"maxInventory":50,"requoteDelta":0.01,"minElapsedSec":60,"quietRangeMax":0.08,"quietWindowSec":60,"stopBeforeEndSec":120}
status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
N=500  played=117  skipped=383  failures=0
pnlTotal=-92.3  EV/market=-0.1846  CI95=[-0.4228, 0.0536]
std=2.7171  q=-0.0679  t=-1.5192
winRate(played)=0.453 (53/62)
fees=0  fee/grossWins=0  maker/taker=186/0 (makerShare=1)
days=144  positiveDayFrac=0.2361  best=2026-01-22:20.5  worst=2026-04-15:-15.4
worst5: btc-updown-15m-1769667300:-17.2  btc-updown-15m-1769599800:-16.2  btc-updown-15m-1776284100:-15.4  btc-updown-15m-1767013200:-14.1  btc-updown-15m-1769789700:-9.3
best5:  btc-updown-15m-1769104800:20.5  btc-updown-15m-1769780700:16.2  btc-updown-15m-1776672900:8.7  btc-updown-15m-1766455200:8.3  btc-updown-15m-1766279700:7
```

## Verdicts (append-only)

- 2026-07-10 — probe verdict (fresh-context Judge, verbatim):

  - stage: probe (Stage 1)
  - decision: kill
  - read: N=500 q=-0.0679 t=-1.5192 EV/market=-0.1846 CI95=[-0.4228, 0.0536]
  - prediction check: CONTRADICTED. The spec's prediction is that played
    markets have gross EV/market > 0 (gross = net, zero maker fee). Played
    markets: 117, pnlTotal = -92.3 → EV(played) ≈ -0.79 per played market,
    decisively negative. The design-failure clause does not rescue it: 62
    markets produced decisive PnL (winRate denominator 53/62) out of 500 =
    ~12.4%, well above the ~3% "structurally fill-less" threshold, so the
    simulator CAN see the mechanism and what it sees is adverse selection
    exceeding the discount plus pair capture.
  - battery: n/a at probe stage (battery is a Stage-2 requirement).
    Composition read for the bias classification only: maker/taker = 186/0,
    fees = 0, skip = 383/500, positiveDayFrac = 0.2361 over 144 days; losses
    are not concentrated in a single cliff (worst5 spread across Dec–Apr),
    so this is a broad negative, not one bad week.
  - simulator-bias classification: simulator-favored — by construction per
    the spec's own registration (worst-queue maker fills always grant full
    remaining size regardless of traded volume) and confirmed by
    composition: makerShare = 1, 186/0 maker/taker. Per D6/D14 this
    experiment could never classify clean. Note the direction of the bias
    sharpens the kill: the size axis is optimistic for the strategy, and it
    still lost.
  - lineage-adjusted bar: lineage_cells = 1, so the bars are unadjusted —
    kill at q̂ ≤ 0 with t ≤ −1. Met: q = -0.0679 ≤ 0 and t = -1.5192 ≤ -1.
  - required next step: append this verdict to EXP-006's Verdicts section
    and close the backtestable (punch-through) version of the mechanism per
    D14; record the fill composition (62/500 markets decisive, 186 maker
    fills, EV(played) ≈ -0.79) as the transferable number — at-touch
    liquidity provision live remains unmeasured by construction and would
    require a new experiment with a different measurement instrument, not
    an iteration of this one.
  - reasoning: Both independent kill triggers fire on the same readout. The
    spec's kill rule (q̂ ≤ 0 with t ≤ −1) is met with margin (t = -1.52),
    and the falsifiable prediction — positive gross EV on played markets in
    quiet regimes — is contradicted at EV(played) ≈ -0.79, an order of
    magnitude worse per played market than the all-markets figure because
    skipped-as-zero dilutes it. The one escape hatch the spec
    pre-registered, the design-failure clause, requires fill starvation
    below ~3% of markets; at ~12.4% decisive markets and 186 maker fills
    the instrument observed the mechanism adequately, and the observation
    is that worst-queue punch-throughs in quiet regimes are informative
    rather than mean-reverting noise — exactly the contradiction branch the
    hypothesis itself named. The skewed-payoff rule (D13) is not triggered
    (win rate 0.453 is well inside [0.1, 0.9]), so no minority-count caveat
    softens the read. That the loss occurs under a simulator biased in the
    strategy's favor on the size axis removes any temptation to iterate:
    the tie-goes-against-advancement rule is not even needed here, because
    there is no tie. Kill is model-conditional per D14 — it closes the
    punch-through-backtestable version only; live at-touch provision was
    never measurable in this design and stays an open, separately
    registrable question.

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->
