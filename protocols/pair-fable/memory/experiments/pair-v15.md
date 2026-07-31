# pair-v15 — continuous two-sided inventory accumulation controller

Status: **APPROVED WITH AMENDMENTS (human ruling inbox
`2026-07-31T13:44:57.732Z-93482fcb`) — implementing (E-030, session 17).**
Original mandate: ruling inbox `2026-07-31T13:16:53.539Z-90d94c56`
(strategic redirect): a controller that operates through most of the
15-minute window, repeatedly buying both UP and DOWN, maximizing matched
inventory min(Q_UP, Q_DOWN), keeping combined pair VWAP below $0.98
(seeking materially lower), keeping imbalance small, using later price
movement to complete/improve earlier inventory, and controlling capital
and losses in trending markets. 500–1,000 matched shares/market is an
aspiration, not a requirement. E-029 stays parked.

Ruling 93482fcb amendments (binding):
1. NO separate Phase-0 simulator (`invscan.ts` is dropped) — implement
   the real controller through the shared strategy/backtest path; stages:
   smoke → ~100–200 diagnostic markets → pinned-800 screen → FULL only
   after a promising 800 result. Small stages are correctness evidence,
   never profitability evidence.
2. Maker AND taker allowed, no maker-share target; verdicts fee-, latency-
   and fill-semantics-inclusive; upward latency sweep before promotion.
3. Capital grid at least {100, 500, 1000, 2000} $/market (replaces the
   proposed {50,100,200,500}); order size scales with capital and depth;
   report absolute profit, per-$100, matched shares, tail loss per level.
4. Above-$1 completion is ALLOWED (not OFF by rule): controlled variants
   that reduce dangerous imbalance / projected worst-case loss; never
   unlimited loss chasing.
5. $0.98 is a TARGET, not a per-action invariant: temporary pair VWAP
   above $0.98 (even above $1) is allowed when later accumulation can
   repay it; the controller bounds that recovery debt; exact math and
   bounds are the lab's choice, from evidence.
6. Throughput: submit whole pre-registered grids up front; stay
   hypothesis-driven; smoke/diagnostic to kill broken ideas cheaply.
7. Mechanism backlog explored autonomously; return `wait` only for
   genuine scope/safety/external-data decisions.

§1–§5 below are the approved design (kept verbatim for the record).
**§8 is the frozen v15.0 implementation spec and E-030 pre-registration**
— where §8 and §2 differ, §8 governs the code. §6's plan and §7's
questions are superseded (answers folded into §8).

## 1. Relationship to previous work (ruling point 1)

### 1.1 The controller is the RULES strategy description at its stated scale

RULES §Strategy description literally specifies this controller: "500 UP
shares at avg price 0.32 + 500 DOWN shares at avg price 0.64 = avg pair
price 0.96 … accumulates in small increments, alternating sides, so the
imbalance and the risk stay small at all times." Every prior family
implemented the *accumulation loop* of that description but none
implemented its *scale or its inventory objective*: the v-family holds at
most ~1–2 increments (10–20 shares) of standing inventory, plays a market
with on average 3.9–5.4 trades [runs 872/885], invests ~$15 of a $50 cap
per played market [run 914], and treats imbalance as a binary mode switch
(balanced ⇒ start; imbalanced ⇒ repair-only) rather than a controlled
state variable. The redirect is therefore a return to the original spec
at its intended operating point, not a new strategy class.

### 1.2 Family-by-family: what each implements, what it lacks, no exact equivalence

| Family | Mechanism | Shares with controller | What it LACKS vs the controller (⇒ no exact equivalence) | Carried findings that BIND the design |
| --- | --- | --- | --- | --- |
| v0/v1/v2 (E-001..E-011, E-023) | one resting order at a time, 10-share increments, joint VWAP gate (projected avgUp+avgDown ≤ maxPairCost), repair-at-cap, 3-min cutoff | the joint gate IS a pair-VWAP constraint; join-only entries; end cutoff | one-rest ⇒ duty cycle ≪ 100% and one side always unquoted; inventory capped at ~1 increment; binary balanced/imbalanced switch; repair displaces accumulation; cap $50 | gate level is a volume knob, per-dollar loss −8/$100 gate-invariant (E-011); repair persistence EV-neutral (E-009); loss = unpaired residue, 344/345 adverse (anatomy 872) |
| v4 (E-014) | both-sides ToB start quoting while balanced; cancels both and reverts to v1 repair on ANY imbalance | continuous two-sided presence (while balanced) | inventory still ~1 increment; both-sides presence *stops* the moment it matters (on imbalance); no VWAP slack usage; no band | q co-inflates with S at ToB (0.98: S ×1.41, q ×1.50); double-fill races give g_sh +50% — cheaper pairing is real; −0.06/share per-start adverse selection of trade-through fills (bounds UNPAIRED shares only, per ruling 8758567d) |
| v9 (E-019/E-021) | absolute per-side entry ceiling X, one-rest | per-side price bound as a trending defense component | ceiling was the ENTIRE entry policy, not a guard on a continuous controller | every ceiling X ∈ 0.08–0.45 negative as a standalone policy; doom rate > break-even at every X |
| v10 (E-020/E-020b) | opportunistic taker completion (C ≤ 0.95 profit-lock; C = 0.99 doom salvage) as a module on v1 | "use later price movement to complete" — the exact ruling lever | trigger surface was ~zero BY CONSTRUCTION: v1's one-rest repair completes at gate cap before the ask ever falls to 0.95 (trigger-dead is a scaffolding artifact, not a market fact); inventory too small for the trigger to matter | doom-certainty salvage saves only ≈1¢/share; ≤1¢ locked margins are eaten by taker fees; one-FOK-in-flight guard mandatory (E-020 burst bug) |
| v12 (E-026) | multi-round SAME-side accumulation, triggered by price falling δ below own VWAP | multi-round accumulation; VWAP-aware repricing of the completion cap | one-sided, drop-triggered ⇒ trigger self-selects adverse drift; on one-rest base (displaces repair) | every avg-down dollar lost −0.18..−0.27, δ- and imb-invariant ⇒ the controller's lag-side aggression must key on INVENTORY state, never on "price fell below my average" |
| v3/v11/v13 (E-012/E-022/E-027) | doom prediction from start state / liquidity structure / time-of-window | (signal spaces, no mechanism) | — | doom is unpredictable in all three measured signal spaces ⇒ the controller must SURVIVE trends by construction (bands, caps, reserves), not predict them; directional tilt cannot lean on these signals |
| v14 (E-028/E-028b) | unconditional book calibration | (measurement, no mechanism) | — | longshots (≤0.55) overpriced 3–4¢/share ⇒ unmatched cheap-side inventory has negative value beyond adverse selection; favorite ≥0.90 min 0–9 is the only measured point-positive region (unresolved at n=800) ⇒ candidate tilt signal for §5 |
| HF probes (E-013/E-024/E-025) | fill capacity measurement | — | — | ToB maker capture at 140 ms, both sides, 10-share unit: worst-queue ≈944 sh/mkt (sim), trade-confirmed ≈610 sh/mkt / ~97 fills (live-calibrated); total ToB maker print flow ≈2,187 sh/mkt ⇒ the 500–1,000 MATCHED aspiration (1,000–2,000 shares bought) exceeds 10-share-unit capture and requires larger per-fill size (displayed ToB sizes 300–450 sh exist, E-028b) and/or taker completions |

**No-equivalence statement (per the ruling's standard):** no prior family
maintained (a) standing inventory beyond ~2 increments, (b) continuous
two-sided quoting THROUGH imbalanced states, (c) an imbalance BAND with
graded asymmetric pricing instead of a binary mode switch, (d) cumulative
VWAP slack — early cheap fills funding later completions — as the price
limit, or (e) capital reservation guaranteeing completability. Every
family kill above is therefore evidence about a different policy, none is
dismissal grounds, and each is carried as a *design constraint* instead.

### 1.3 What is genuinely new, and the honest prior

Three new levers: **(i) intertemporal cross-subsidy** — with material
inventory, the constraint "cumulative V_U + V_D ≤ P*" admits completions
the v-family's per-increment gate refused (at 10 shares standing, the
marginal and cumulative constraint sets are nearly identical; at 300
shares they are not); **(ii) duty cycle ≈ 100% on both sides** with
graded (not binary) imbalance response; **(iii) scale** — cap and size at
the level the RULES example describes.

Honest prior, stated before any measurement: the constituent mechanisms
were each measured negative *at increment scale* (both-sides quoting
E-014, completion policy E-020b, extra same-side exposure E-026), every
maker fill in the sim remains a trade-through (locally falling) fill, and
longshot overpricing taxes the cheap side. The controller's bet is
specifically that matched-margin harvest × scale × cross-subsidy can
outrun band-bounded residue loss — i.e. that the market's oscillation
supplies enough two-sided ToB flow below the VWAP ceiling within a
window. That is a measurable geometry question, answerable from data on
disk BEFORE strategy code (§6 Phase 0), which is where measurement should
start.

## 2. Accounting and control mathematics (ruling point 2)

### 2.1 State (per market, per tick)

- Q_U, Q_D ≥ 0 shares held; C_U, C_D dollars spent, **fee-inclusive**
  (RULES rubric 4: maker $0, taker 0.07·p·(1−p) per share).
- VWAPs V_s = C_s/Q_s (undefined→0 while Q_s = 0); **pair VWAP
  P = V_U + V_D**; matched M = min(Q_U, Q_D); imbalance I = Q_U − Q_D.
- Lead side = more shares; lag side = fewer. Buys only, no sells (RULES
  rubric 1); exits are settlement/merge-once (rubric 3/5; backtests value
  at settlement, no merge intents — RULES §Backtesting).
- Settlement pnl (exact): `pnl = M·$1 + |I|·1{lead side wins} − C_U −
  C_D` (fees already inside C). Reported identity split: matched margin
  `M·(1−P_M)` vs residue, where P_M is the matched-cost VWAP; the ruling's
  headline metric is the simple P = V_U + V_D.

### 2.2 Tunable parameters (guard 2: ≤ 6) and design constants

Tunables: `capPerMarket B` | `pairTarget P*` (schema max 0.98 — the
ruling's hard bound; default 0.96, sweep seeks lower) | `imbalanceBand
I_b` (shares) | `orderSize q` | `lockTarget P_lock` (opportunistic taker
completion threshold, < P*) | `tiltTarget I*` (§5; 0 = neutral).

Design constants (not tunable): maker-only resting orders priced on-grid
strictly below ask; requote only when the target price moves ≥ 1 tick
(churn guard); one taker order in flight at a time (E-020 lesson); no new
net exposure after T−180 s (carried from v1); cancel all resting at
T−60 s, taker completion permitted to T; above-$1 salvage OFF in v15.0
(E-020b: ≈1¢/share — revisit only on measured evidence); I_hard = 2·I_b.

### 2.3 Buying rules

Each tick, for each side s with opponent o:

1. **VWAP ceiling (the invariant that enforces P ≤ P\*)**: the max
   admissible price p̂_s solves projected P' ≤ P*, where
   `V_s' = (C_s + p·q)/(Q_s + q)` and the opponent term is projected
   **completability-conservatively**: any deficit the fill creates or
   extends is priced at the CURRENT taker cost of completing it
   (bestAsk_o + fee), not at a hoped-for maker price:
   `V_o' = (C_o + max(0, Q_s+q−Q_o)·(bestAsk_o + fee(bestAsk_o))) /
   max(Q_o, Q_s+q)`. Bootstrap (Q_U = Q_D = 0): identical to the
   v1 start gate — both sides' join prices must satisfy the gate.
2. **Lead side (buying increases |I − I*|)**: quote join-bestBid only,
   at min(bestBid_s, p̂_s), and ONLY while the post-fill imbalance stays
   inside the band: |I ± q − I*| ≤ I_b. Beyond the band the lead-side
   quote is withdrawn — the hard trending halt.
3. **Lag side (buying decreases |I − I*|)**: always quoted (until
   T−60 s). Price graded by normalized imbalance ι = |I − I*|/I_b:
   inside the band (ι ≤ 1) join bestBid; beyond it improve above bestBid
   toward min(p̂_s, bestAsk − 1 tick) proportionally to min(ι − 1, 1) —
   v1's repair-at-cap generalized to a continuum. Never keyed on price
   vs own VWAP (the E-026 constraint).
4. **Opportunistic taker completion ("later price movement" lever)**:
   whenever a deficit exists (|I − I*| ≥ q) and buying min(|I − I*|,
   displayed ask size) on the lag side at bestAsk + fee gives projected
   P' ≤ P_lock, send an FOK for that quantity (one in flight). This is
   v10's profit-lock with a real trigger surface: the controller holds a
   standing deficit whenever the lag side is expensive, so a reversion
   makes the lag side cheap exactly while the deficit is open.
5. **Capital reservation (trending capital control)**: a lead-side buy
   must satisfy `C_U + C_D + p·q + R' ≤ B`, with reserve
   `R' = |I' − I*|·(bestAsk_lag + fee)` — the budget to complete the
   projected deficit at current taker prices is always held back. Lag
   buys shrink R' and are admissible up to B.

### 2.4 Behavior near market end

T−180 s: rule 2 stops (no lead-side buys ⇒ no new net exposure); rules
3/4 continue (completion reduces risk). T−60 s: all resting orders
cancelled; only rule 4 continues to T. No above-$1 buys in v15.0.

### 2.5 Trending-market failure case (the loss bound)

In a one-way trend the falling (losing) side fills and becomes the lead;
the lag (winning) side's ask runs away so rules 3/4 are ceiling-blocked.
The controller's terminal state is then: matched M at P ≤ P*, plus an
unmatched strand bounded by construction: `|I| ≤ I_b + q` (band plus one
fill in flight). Worst-case market loss:
`loss ≤ (I_b + q)·p̄_strand − M·(1−P*)`, p̄_strand = VWAP of the stranded
shares (≤ the ceiling implied by rule 1). Example at I_b = 20, q = 10,
p̄_strand ≈ 0.5: worst case ≈ −$15 + $0.04·M. Break-even strand rate:
with mean matched M̄ and strand loss L̄ per strand-market,
`d* = M̄·(1−P*) / L̄` — e.g. M̄ = 100 matched at P* = 0.96 covers a
−$15 strand every fourth market. Whether the market's oscillation
delivers M̄ ≥ that at P ≤ P* is exactly the Phase-0 measurement (§6).
For calibration: the v1 family measured ~50% of played markets ending
stranded — but that is the terminal-imbalance distribution OF A POLICY
with no band, no continuous completion pressure, and one increment; the
controller's strand distribution is its own output and must be measured,
not assumed.

## 3. Success metrics (ruling point 3 — the frozen readout set)

Per run, over ALL universe markets (flat markets in the denominator,
mission A1):

1. Matched shares M: mean / median / p10 / p90.
2. Combined pair VWAP P at settle: mean over markets with M > 0;
   distribution.
3. % of markets (with M > 0) at P < 0.98 / < 0.95 / < 0.90.
4. Imbalance: final |I| and max |I| over the window (mean/p90).
5. Capital: invested per market (mean/max), max concurrent outlay vs B,
   per capPerMarket level (goal-2 units: invested/mkt, profit per $100).
6. P&L: evPerMarketTotal (mission unit) + profitPer100.
7. Worst losses: min market pnl, p5, sum of losing tail; strand-market
   count and mean strand loss (the L̄ and d of §2.5).
8. Integrity: CAP-BREACH (mandatory since E-020), recon badRows = 0,
   taker share (S3 watch), fills by mode.

Aspiration mapping (honest): 500–1,000 matched at P ≤ 0.98 grosses
$10–20/mkt but needs ~$480–960 invested (no mid-market merge recycling in
backtest per RULES) AND exceeds the measured 10-share-unit ToB capture
(E-025) — reachable, if at all, only via larger per-fill sizes into the
300–450-share displayed ToB depth and taker completions. Phase 0 measures
the actual capture-vs-size curve; goal 1's bar (ev ≥ +$2/mkt) does not
require the aspiration.

## 4. Neutral controller (ruling point 4)

The controller of §2 with I* = 0. This is the design to validate first:
its profitability question is pure market geometry (two-sided flow below
the ceiling) with zero directional signal risk. Proposed initial sweep
corner (to be frozen at pre-registration): P* ∈ {0.95, 0.96, 0.98},
I_b ∈ {10, 20, 40}, q ∈ {10, 25, 50}, P_lock = P* − 0.01, B per goal-2
grid extended to the scale the aspiration needs: {50, 100, 200, 500}
(mission A2 grid is 25/50/100/200 — extension needs human sign-off, §7).

## 5. Directional variant (ruling point 5)

The SAME controller with I* ≠ 0 set by a signal at window open (or
updated in-window); no new machinery — every rule in §2.3 already reads
I − I*. The lead/lag asymmetry, band, reserve, and end-of-window logic
apply unchanged around the shifted target; the deliberate tilt is held as
favorite-side inventory the market pays ≥ 0 for iff the signal region has
non-negative unconditional value.

Signal candidates, ranked by measurement status: (a) E-028's favorite
region (ask ≥ 0.90, minutes 0–9 — the only measured point-positive
region; unresolved at n = 800, E-029 would sharpen it); (b) spot vs
priceToBeat sign — prior weak: E-012 measured this space uninformative
for DOOM prediction (tilt-value is a different estimand, but there is no
positive evidence either); (c) none. Decision rule: the directional
variant is designed now (this section) but parameterized and tested only
AFTER the neutral controller's Phase-0/screen results exist, and its
tilt signal must first show ≥ 2 SE unconditional value in a calibration
readout (E-028-style), not just a plausible story.

## 6. Proposed experiment plan (SUPERSEDED by §8 per ruling 93482fcb — kept for the record)

- **E-030 (Phase 0, next session after approval): controller-geometry
  scan, no strategy code.** New read-only tool `tools/invscan.ts`
  (machinery from bookscan/calib: checkpoint + time-budget chunking,
  pinned latest-800 universe `--latest 800 --to-ms 1784762100000`).
  Replays the book and executes §2.3 offline under the sim's worst-queue
  standard (resting level fills when traded through; taker legs at
  arrival ask + fee, 140 ms). Readouts = §3 metrics 1–7 per config over
  the P*×I_b×q grid (§4), plus capture-vs-q against the E-025 T-ceiling.
  Frozen bars will be set at pre-registration; the proposed shape:
  ADVANCE to strategy code iff some config projects mean market pnl > 0
  on the pinned 800 with median M ≥ 50 and mean P ≤ 0.97; otherwise the
  scan IS the answer (a geometry deficit no controller tuning can fix —
  report to human before any further spend). Honesty note: the scan
  approximates OrderManager/latency mechanics; it is a cheap geometry
  measurement, not EV proof — strategy-code screens remain the evidence
  standard.
- **E-031 (Phase 1): strategy code** `strategies/pair.v15.ts`
  implementing §2 exactly; smoke + CAP-BREACH; screen grid (≤ 9 configs
  from Phase-0's surviving corner, whole grid submitted up front per
  inbox c841c329) on the pinned 800 @ 140/20 ms; anatomy.ts taught the
  new fill modes BEFORE reading decompositions (standing guard).
- **Phase 2**: capPerMarket sweep (goal 2 units), FULL universe run, S3
  upward latency sweep (taker-completion legs must survive it — they
  are reversion-triggered, not race-triggered, so the design intent is
  latency-benign; measured, not assumed), S4 OOS per evaluator pipeline.
  M1–M4 review-gate items before any champion/LIVE-CANDIDATE step.
- **E-029 (favorite-side FULL replication)**: parked per the ruling.
  Cheap local scan, still worth running later — it also gates §5's
  signal (a). Re-order at human discretion.

## 7. Open design questions (ANSWERED by ruling 93482fcb: 1 → no Phase-0
## simulator, real strategy path; 2 → taker-heavier OK, no maker target;
## 3 → grid replaced with {100,500,1000,2000}; 4 → above-$1 completion
## allowed as a tested lever; 5 → no human-dictated hard bound, choose
## from evidence. Kept for the record.)

1. **Sequencing**: Phase-0 geometry scan before strategy code (lab
   discipline, cheap, answers the load-bearing uncertainty first) — or
   straight to strategy code? Recommendation: Phase 0 first.
2. **Capacity vs aspiration**: reaching 500–1,000 matched requires
   larger per-fill sizes (q up to ~50–100 into 300–450-share displayed
   depth) and taker completions — i.e. materially more taker volume than
   the v-family's ~13–16%. Confirm taker-heavier operation is acceptable
   within the "not latency dependent" rubric (the completion trigger is
   reversion-based and should survive the upward sweep; S3 verifies).
3. **capPerMarket grid extension** to {50, 100, 200, 500} (A2 names
   25/50/100/200): approve the 500 level for this family?
4. **Above-$1 loss-mitigating completion** (ruling axis 3): OFF in
   v15.0 per E-020b's measured ≈1¢/share salvage — confirm, or require
   it as a tunable from the start.
5. **P* hard bound**: schema max 0.98 per the ruling ("below $0.98");
   the sweep probes 0.95–0.98. Confirm 0.98 as the hard schema bound.

## 8. v15.0 implementation spec + E-030 pre-registration (session 17 — FROZEN)

Frozen BEFORE `strategies/pair.v15.ts` exists (M2: this commit's
timestamp is the design-ts; the code commit follows it). Strategy id
`pair-fable-v15`.

### 8.1 Tunables (exactly 6 — guard 2)

| Param | Schema | Default | Meaning |
| --- | --- | --- | --- |
| `capPerMarket` B | pos ≤ 2000 | 500 | per-market capital cap, $ |
| `pairTarget` P* | 0.90–0.99 | 0.96 | target settled pair VWAP (maker ceiling reference) |
| `imbalanceBand` I_b | 1–200 | 40 | shares of tolerated unmatched inventory |
| `orderSize` q | pos ≤ 100 (M5), ≤ I_b (refine) | 25 | shares per maker rest |
| `lockTarget` P_lock | 0 or 0.5–0.99 | 0.95 | taker-completion trigger on projected pair VWAP; 0 = off |
| `salvageMax` | 0–0.995 | 0 | doom-salvage FOK: fires when ask+fee ≤ this (may push P above $1); 0 = off |

Design constants (not tunable): GRID 0.01; TTL_SEC 90; COOLDOWN_TICKS 5
(maker requote), FOK_COOLDOWN_TICKS 25 (E-020: ticks can outpace the
140 ms fill latency); one FOK in flight at a time (E-020); requote only
when the target moves ≥ 1 tick; lead-side/new-exposure stop at T−180 s;
cancel-all-resting at T−60 s (FOK rules run to T); DOOM_BID 0.20 (doom
proxy for salvage); no sells, no merge intents.

### 8.2 Notation

Q_s, C_s = shares / cost basis held on side s (portfolio costBasis; maker
fills are fee-free so this is fee-inclusive for maker volume; taker fee
terms are added explicitly at each decision point, matching v10's
convention and the sim's fee model 0.07·p·(1−p)). o = the other side.
bid_s, ask_s = best bid/ask; askSize_s = displayed size at ask_s.
fee(p) = 0.07·p·(1−p). Neutral controller: I* = 0 throughout (the
directional variant will subtract I* from every imbalance expression).

### 8.3 Maker quoting (both sides, every tick until T−60 s)

For each side s, target price:

1. **Band guard (trending halt + overshoot guard):** quote s only if
   `surplusAfter = Q_s + q − Q_o ≤ I_b`. From balanced this admits both
   sides (q ≤ I_b by schema); a side more than I_b ahead is never bought.
   From T−180 s, additionally require `surplusAfter ≤ 0` (only
   deficit-reducing buys — no new net exposure).
2. **Grading:** deficit d_s = max(0, Q_o − Q_s), ι = d_s / I_b.
   ι ≤ 1 ⇒ target = bid_s (join, $0 fee, worst-queue).
   ι > 1 ⇒ target = bid_s + min(ι − 1, 1)·((ask_s − GRID) − bid_s) —
   v1's repair-at-cap generalized to a continuum (never keyed on own
   VWAP, per the E-026 constraint).
3. **VWAP ceiling:** cap target at p̂_s, the max price keeping the
   completability-conservative projected pair VWAP ≤ P*:
   Q_s' = Q_s + q; D' = max(0, Q_s' − Q_o); D_band = min(D', I_b) priced
   at bid_o (a standing lag quote fills there on oscillation);
   D_exc = D' − D_band priced at ask_o + fee(ask_o);
   V_o_proj = (C_o + D_band·bid_o + D_exc·(ask_o + fee(ask_o))) / Q_s'
   (or C_o/Q_o when D' = 0);
   **p̂_s = ((P* − V_o_proj)·Q_s' − C_s) / q**.
   Bootstrap check: Q_U = Q_D = 0 ⇒ p̂ = P* − bid_o, i.e. joining
   requires bid_s + bid_o ≤ P* — exactly the v1/v4 start gate. The
   band-internal deficit priced at bid_o (not taker) is the deliberate
   optimism that lets the controller run; the band bounds its cost. This
   is also where ruling amendment 5 lands in v15.0: realized P may drift
   above P* (graded repair fills, salvage); the ceiling only disciplines
   projections at decision time, and the recovery-debt bound is the band
   itself (strand ≤ I_b + q at ceiling-admissible prices).
4. **Maker discipline:** price = floorToGrid(min(target, p̂_s)); if
   ≥ ask_s, price = ask_s − GRID; skip if < GRID.
5. **Capital + reservation:** skip unless
   `C_U + C_D + pending + price·q + R' ≤ B`, where pending = notional of
   live resting orders and R' = max(0, Q_s + q − Q_o)·(ask_o +
   fee(ask_o)) reserves completion of the projected deficit at current
   taker cost (R' = 0 for deficit-reducing buys).
6. **Requote:** if a resting order's price differs from today's target by
   ≥ 1 tick, or its side became unquotable, cancel (once, tracked), wait
   for terminal, requote after COOLDOWN_TICKS.

### 8.4 Taker rules (FOK, one in flight, to T)

- **C — pair lock (P_lock > 0):** when d_s > 0, x = min(d_s, askSize_s),
  a = ask_s: fire iff projected settled pair VWAP
  `(C_s + x·(a + fee(a)))/(Q_s + x) + C_o/Q_o ≤ P_lock` and capital
  admits. Cumulative-VWAP trigger (cross-subsidy lever) — deliberately
  NOT v10's per-pair h + ask + fee ≤ C.
- **V — doom salvage (salvageMax > 0):** when d_s > 0, bid_o ≤ DOOM_BID
  and ask_s + fee(ask_s) ≤ salvageMax: FOK x = min(d_s, askSize_s) at
  ask_s. May push P above $1 (ruling amendment 4): completing at
  a + fee < 1 beats holding a doomed lead to zero; bound = salvageMax.
- Any resting order on the FOK's side is cancelled in the same intent
  batch (v10 machinery).

### 8.5 Fill-mode tags (meta.m — anatomy must learn these before reading decompositions)

`S` maker fill placed with ι ≤ 1 (band accumulation) · `R` maker placed
with ι > 1 (graded repair) · `C` pair-lock FOK · `V` salvage FOK.

### 8.6 E-030 — staged validation of pair-fable-v15 (FROZEN)

All runs: telonex-delta, btc 15m, latency 140/20 pinned by flags,
provenance `--protocol pair-fable --model claude-fable-5`.

- **Stage A (smoke):** `tools/smoke.ts --strategy pair-fable-v15`
  (defaults), ≤ 20 mkts sequential. Bar: SMOKE PASS + no cap breach.
- **Stage B (diagnostic, NOT profitability evidence):** one fleet run,
  center config (defaults: B=500 P*=0.96 I_b=40 q=25 P_lock=0.95
  salvageMax=0), `--latest 200 --to-ms 1784762100000` (the newest 200 of
  the pinned 800). Bars (integrity/mechanism only): every market
  invested ≤ B + $1; recon badRows = 0; ≥ 30% of markets reach M > 0;
  fill modes S and C both occur; no FOK burst (no market with > 40
  taker fills). FAIL ⇒ fix code, re-smoke, rerun Stage B once; the
  Stage C grid stays frozen regardless.
- **Stage C (screen, pinned 800):** `--latest 800 --to-ms 1784762100000`,
  10 configs submitted up front (inbox c841c329), all at B=500, q=25,
  P_lock = P* − 0.01:
  P* ∈ {0.94, 0.96, 0.98} × I_b ∈ {20, 40, 80}, salvageMax = 0 (9), plus
  the center (P* 0.96, I_b 40) with salvageMax = 0.99 (the above-$1
  lever, amendment 4).
  Frozen readouts: §3 metrics 1–8; screen noise floor per evaluator.md.
  Verdict bars: **ADVANCE** iff some config has evPerMarketTotal > 0
  beyond the screen noise floor AND mean P (over M > 0 markets) ≤ 0.98
  ⇒ Stage D cap sweep {100, 500, 1000, 2000} on the best config
  (q scaled to cap: 10/25/50/100 — frozen at Stage D pre-registration
  with I_b scaling, informed by C's mechanism readouts) + FULL + S3/S4
  per evaluator pipeline. **ITERATE** iff all configs negative but the
  §3 mechanism readouts localize the loss in a §2.5-bounded term a
  design change targets (next mechanism from the backlog). **KILL the
  v15.0 FAMILY** (never the class — evaluator.md §Kill standards) iff
  all configs lose > $0.50/mkt with no localizable mechanism.
- Deviations from this plan require a written amendment in this file
  BEFORE the affected run is submitted.

**Amendment A1 (session 17, before the affected runs were submitted
successfully):** the three I_b = 20 grid configs are invalid as frozen —
the §8.1 schema refine `orderSize ≤ imbalanceBand` (a single fill must
not breach the band) rejects q = 25 at I_b = 20; the grid froze an
internally inconsistent corner and those three submissions were refused
by the schema (the other 7 went through). Fix, frozen here first: the
I_b = 20 column runs at `orderSize = 20` (band-tight corner stays
testable; its q differs from the other columns' 25 — noted for readout
comparability). No other change.

## 9. Result E-030 (session 17, 2026-07-31) — verdict ITERATE

Stages: **A** SMOKE PASS (run 921, 10 mkts, no cap breach). **B** PASS all
frozen bars (run 922, latest-200: investedMax 170.73 ≤ 501; recon badRows
0; matched-markets 80/200 = 40% ≥ 30%; modes S+C present; max taker
fills/mkt 16 ≤ 40). **C** screen grid, pinned 800 @ 140/20, runs 923–932
(all completed, 0 failures; per-run frozen metrics in the table below,
recon badRows 0 on every anatomized run).

| run | P* | I_b | q | slv | ev/mkt | p/$100 | M mean/med (mkts>0) | mean P | %<.98/.95/.90 | strands × meanL |
|---|---|---|---|---|---|---|---|---|---|---|
| 931 | 0.94 | 20 | 20 | 0 | **−1.83** | −6.55 | 43/40 (487) | 0.929 | 96/90/5 | 355 × −6.51 |
| 930 | 0.96 | 20 | 20 | 0 | −2.81 | −7.45 | 51/42 (543) | 0.947 | 94/63/1 | 432 × −6.66 |
| 932 | 0.98 | 20 | 20 | 0 | −4.03 | −7.12 | 73/60 (575) | 0.965 | 83/13/0 | 531 × −6.97 |
| 923 | 0.94 | 40 | 25 | 0 | −3.02 | −8.66 | 55/50 (465) | 0.931 | 94/86/4 | 404 × −8.35 |
| 925 | 0.96 | 40 | 25 | 0 | −3.83 | −7.34 | 72/56 (538) | 0.947 | 93/64/1 | 450 × −8.64 |
| 927 | 0.98 | 40 | 25 | 0 | −5.92 | −7.69 | 99/77 (575) | 0.964 | 86/12/0 | 551 × −9.68 |
| 924 | 0.94 | 80 | 25 | 0 | −3.06 | −8.02 | 60/50 (468) | 0.927 | 96/93/5 | 365 × −9.73 |
| 926 | 0.96 | 80 | 25 | 0 | −4.46 | −6.86 | 88/75 (549) | 0.945 | 95/68/2 | 447 × −10.51 |
| 928 | 0.98 | 80 | 25 | 0 | −7.80 | −7.24 | 139/116 (574) | 0.962 | 90/14/0 | 536 × −13.52 |
| 929 | 0.96 | 40 | 25 | .99 | −3.23 | **−5.73** | 61/50 (692) | 1.096 | 20/6/0 | **3** × −9.39 |

Findings (all from this session's tool results):

1. **The accumulation machine works as designed.** Matched inventory mean
   43–139 shares/matched-market (p90 up to 284), pair VWAP 0.93–0.96 with
   86–96% of matched markets < $0.98 — 5–10× the v-family's standing
   inventory, at ~100% two-sided duty cycle. No cap breaches, no FOK
   bursts, recon clean everywhere. The C-lock has a real trigger surface
   at scale (609–1,075 fills/run vs ~3 in E-020's v1-based module).
2. **Economics: the strand tax still wins.** Neutral decomposition (925):
   pairsPnl +2,072 vs residuePnl −4,777 across 527 strand-markets (98.5%
   adverse, ≈ −$8.6 each ≈ one 25-share increment at ~0.35). Same
   identity as the v-family, at 4× volume: per-$100 loss −6.9..−8.7 ≈
   the E-011 invariant. ev worsens monotonically in BOTH volume knobs
   (P*↑, I_b↑). Best neutral corner (931, −1.83) is still worse in ev/mkt
   than v1 (−1.50 @ 0.98, run 872) on the same universe.
3. **First measured per-dollar improvement in family history: the salvage
   lever.** 929 vs 925 (identical but salvageMax 0.99): Δev +0.60 (6× the
   0.10 noise bar), per-$100 −5.73 vs −7.34, strand-markets 450 → 3.
   Salvage converts strands into above-$1 pairs (V invested $13.5k,
   pairsPnl −2,158 but residue → +15): strand tax per affected market
   roughly halves (−$8.6 → ≈ −$4.8). It fires at DOOM_BID 0.20, i.e.
   buys the winner at ~0.9+; completion happens at total ~1.05–1.10.
4. **The untested continuum is the completion frontier.** v15.0 has a
   binary completion policy: C at ≤ P_lock (cheap, rare in doomed
   markets) and V at doom-certainty (expensive, ~always too late).
   Between them lies a graded ceiling X(t, ι) ∈ (P_lock, salvageMax)
   rising with time-elapsed and persistent imbalance — precisely the
   ruling's "recovery debt bounded by remaining time/imbalance/max-loss".
   Direction supported by 3: earlier completion at a cheaper winner ask
   should interpolate between −$8.6 and −$4.8 per strand.

**Verdict: ITERATE** (frozen §8.6: all configs negative, loss localized
in the §2.5 strand term, a design change targets it). Not ADVANCE (no
config > +0.10). Not family-KILL (mechanism localizable + a lever moved
it beyond noise). Next: **E-031 — graded completion frontier** (dynamic
recovery-debt ceiling replacing the C/V binary), design frozen BEFORE
code next session; include a duplicate-config pair to measure the family
noise floor (taker-heavy family — evaluator.md default 0.05 needs
verification).

Process notes: (a) Amendment A1 — frozen grid's I_b=20 corner was
schema-invalid (q ≤ I_b refine); re-frozen at q=20 before resubmission.
(b) Second resubmission attempt lost 3 configs to the KNOWN zsh
no-word-split trap (STATUS standing guard violated in a helper loop;
detach output hid the schema error). Guard reaffirmed: literal args
only in submission commands; verify queue depth after every detached
submit batch.

## 10. v15.1 — graded completion frontier (E-031, session 18 — FROZEN)

Frozen BEFORE the code change (M2: this commit's timestamp is the
design-ts; the `pair.v15.ts` edit follows it). Motivation = E-030
findings 3–4: the loss is the strand tax; the only per-dollar lever that
moved beyond noise is completion policy; v15.0's policy is a binary —
cheap pair-lock (C, rarely reachable in doomed markets) vs doom-certainty
salvage (V, fires at winner ask ≈ 0.9+, total ≈ 1.05–1.10). The untested
continuum between them is a graded recovery-debt ceiling — exactly ruling
93482fcb amendment 5's "define and limit temporary recovery debt using
remaining time, imbalance, and maximum-loss constraints".

### 10.1 Specification (only §8.4 taker rules change; §8.3 maker path untouched)

Tunable change (count stays 6): `salvageMax` is REPLACED by **`debtCap`**
— schema `0 ∪ [lockTarget, 1.15]`, default 0, refine `debtCap > 0 ⇒
lockTarget > 0`. Semantics differ from salvageMax: debtCap bounds the
projected CUMULATIVE settled pair VWAP of a completion (cross-subsidy
framing, same estimand as the C-trigger), not the per-share unit cost.

Single graded rule **G** replaces C and V. When a lag-side deficit
d ≥ 1 exists and displayed ask size > 0, with x = min(d, askSize),
a = ask, projected settled pair VWAP
`P' = (C_s + x·(a + fee(a)))/(Q_s + x) + C_o/Q_o`:

- **Recovery-debt ceiling:** `X(t̂, ι) = P_lock + (debtCap − P_lock) ·
  ρ(t̂) · min(ι, 1)`, with ι = d / I_b, t̂ = elapsed window fraction, and
  ramp `ρ(t̂) = clamp((t̂ − 0.25)/(0.80 − 0.25), 0, 1)` (design constants
  T0 = 0.25, T1 = 0.80 — full debt capacity exactly from the T−180 s
  lead-stop point; unparsable slug ⇒ t̂ unknown ⇒ ρ = 0, conservative).
- **Fire:** FOK x at a iff `P' ≤ X + 1e-9` and capital admits. One FOK
  in flight, FOK_COOLDOWN_TICKS, cancel same-side rest in the same batch
  — all v15.0 machinery unchanged.
- **DOOM_BID gate REMOVED:** time × imbalance grading replaces doom
  certainty. Intended effect: fire earlier at a cheaper winner ask
  (E-030.3 measured doom-gated completion at ≈ 0.9+; interpolating the
  strand tax between −$8.6 and −$4.8 per strand-market). The new risk —
  completing markets that would have recovered — is bounded by X and is
  what the frontier sweep measures.
- **Tags (anatomy unchanged):** `C` when P' ≤ P_lock (a v15.0 lock would
  fire), `V` when P_lock < P' ≤ X (a debt completion).
- `debtCap = 0` ⇒ X ≡ P_lock ⇒ trigger identical to v15.0 with
  salvageMax = 0 — run 925 stays the valid disabled baseline.

Cross-version note: comparisons vs 925/929/931 are cross-version
mechanism comparisons on the identical pinned universe + latency (M1
identity tooling still pending — review gate).

### 10.2 E-031 grid (FROZEN)

Stages: S0 smoke (defaults + one config with debtCap on; bar = SMOKE PASS,
no cap breach, G fires somewhere in the sample) → screen. No Stage-B
diagnostic (change is localized to the taker trigger; E-030 Stage B
already validated the controller shell). Screen: pinned 800
(`--latest 800 --to-ms 1784762100000`), 140/20, submitted as one batch up
front, each config its own command with literal args, queue depth
verified after submission:

| # | P* | I_b | q | P_lock | debtCap | purpose |
|---|---|---|---|---|---|---|
| 1 | 0.96 | 40 | 25 | 0.95 | 0.98 | mild debt (sub-$1 completions only) |
| 2 | 0.96 | 40 | 25 | 0.95 | 1.02 | frontier |
| 3 | 0.96 | 40 | 25 | 0.95 | 1.06 | frontier center |
| 4 | 0.96 | 40 | 25 | 0.95 | 1.06 | EXACT DUPLICATE of #3 — measures the v15-family noise floor (frozen estimand: noise_v15 = \|Δev(#3, #4)\|) |
| 5 | 0.96 | 40 | 25 | 0.95 | 1.10 | ≈ 929's realized completion range, ramp-graded |
| 6 | 0.94 | 20 | 20 | 0.93 | 1.06 | best-neutral-corner (931) transfer |

All B = 500. Schema check per cell: q ≤ I_b ✓, P_lock ∈ [0.5, 0.99] ✓,
debtCap ∈ [lockTarget, 1.15] ✓ (E-030 A1 lesson).

Frozen readouts: §3 metrics 1–8, anatomy pairs/residue decomposition,
per-mode (S/R/C/V) fills + invested, strand count × mean strand loss,
mean winner-ask paid on V fills (the interpolation check).

Frozen verdict bars (noise bar = max(2·noise_v15, 0.05), evaluator.md):
- **ADVANCE** iff some config has evPerMarketTotal > +noise-bar ⇒ Stage D
  cap sweep {100, 500, 1000, 2000} + FULL + S3/S4 per evaluator pipeline.
- **LEVER-CONFIRMED / ITERATE** iff the best graded config beats BOTH
  925 (−3.83) and 929 (−3.23) in ev/mkt beyond the noise bar AND beats
  929's per-$100 (−5.73) ⇒ the frontier is real; iterate on it (ramp
  shape, debtCap refinement, or combination with the next backlog lever).
- **LEVER-DEAD** iff no config beats 929's ev/mkt beyond the noise bar ⇒
  the graded-cumulative form is dead; record and move to the next backlog
  mechanism (lag-side maker aggression / larger q into depth).
- **Family KILL** standard unchanged from §8.6 (never the class).

Deviations require a written amendment here BEFORE the affected
submission.

### 10.3 Amendment — E-031b doom-backstop combination (v15.2; FROZEN
### before submission, written while E-031 runs #4–#6 were still in flight)

Registered after reading runs 935/936/937 (E-031 #1–#3) but BEFORE
submitting any E-031b run. Mechanism evidence so far: the graded ceiling
fires early and cheap (937: 1,713 V fills at price VWAP ≈ 0.52 vs E-030
doom salvage's ≈ 0.9+) and improves monotonically with debtCap (−3.67 →
−3.60 → −3.47 at 0.98/1.02/1.06), but leaves 424 strand-markets at −7.74
mean: in TRUE doom markets the cumulative pair VWAP exceeds any
reasonable debtCap, so the G-rule never completes them — while at doom
certainty completion at unit cost a + fee < 1 beats holding regardless
of cumulative VWAP (that is 929's whole edge: strands 450 → 3). The two
levers act on DISJOINT market sets ⇒ pre-registered hypothesis: they are
≈ additive. Prediction (recorded in advance): center combo ev ≈ −2.9 ±
noise (929's −3.23 + 937's increment over 925 of +0.36).

**v15.2 spec (delta over §10.1):**
- `lockTarget` is REMOVED as a tunable and becomes derived: P_lock =
  pairTarget − 0.01 (the value every E-030/E-031 config used; it never
  earned independent variation — guard 2 swap, keeping 6 tunables).
- New tunable `doomUnitMax` (0 = off; else [0.5, 0.995]): doom backstop
  restoring v15.0's V-rule as a backstop UNDER the graded rule — when
  lead bid ≤ DOOM_BID (0.20) and ask + fee ≤ doomUnitMax, FOK the
  deficit at ask regardless of cumulative pair VWAP.
- Fill-mode tags: backstop fires tag **`D`** (anatomy taught before
  reading); graded-rule tags C/V unchanged. With doomUnitMax = 0 the
  strategy is BEHAVIORALLY IDENTICAL to v15.1 at P_lock = P* − 0.01
  (all E-031 configs satisfy this).
- Tunables (6): capPerMarket, pairTarget, imbalanceBand, orderSize,
  debtCap, doomUnitMax.

**E-031b grid (2 configs, pinned 800, 140/20, B = 500, submitted only
after the E-031 batches drain — mid-queue pushes must not change running
jobs' code):**

| # | P* | I_b | q | debtCap | doomUnitMax | vs |
|---|---|---|---|---|---|---|
| 7 | 0.96 | 40 | 25 | 1.06 | 0.99 | 937 (isolates backstop), 929 (isolates graded) |
| 8 | 0.94 | 20 | 20 | 1.06 | 0.99 | 931/938-corner transfer |

Frozen bars for the combo: **COMPLEMENTARY-CONFIRMED** iff #7 beats BOTH
929 (−3.23) and 937 (−3.47) beyond the noise bar (max(2·noise_v15,
0.05), noise_v15 from the #3/#4 duplicate) — then the completion
frontier + backstop is the family's completion policy going forward.
Iff #7 beats 929 but not 937 beyond noise ⇒ backstop dominates, graded
adds nothing at 800-scale — prefer the simpler doom-only policy (guard
2 removes debtCap's slot). Iff #7 fails to beat 929 ⇒ record and fall
back to §10.2 verdicts on the pure grid.
