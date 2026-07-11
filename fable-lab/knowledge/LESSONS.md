# LESSONS — transferable knowledge

Rules: one lesson per entry, mechanism-level (never parameter-level), each
citing the experiment ids (and run/batch uids) that ground it. A lesson
without an experiment citation is an opinion and gets deleted. Update an
existing lesson rather than adding a near-duplicate; delete lessons that
later evidence overturns (note the overturn in the entry that replaces them).

_No experiments have run yet. This file starts empty by design — the charter
forbids importing the old system's research conclusions._

## Engine lessons (from the Phase 0 study, not from runs)

- **E1 — The books are the only market signal.** No price-to-beat, no trade
  stream, no external prices exist in telonex-delta replay; strategies
  condition on order-book state and the episode clock alone
  (engine/CAPABILITIES.md §1). Ideas requiring the strike are dead on
  arrival unless reformulated in market-implied terms.
- **E2 — Maker PnL is the simulator's soft spot.** Full-remaining-size fills
  on touch-through, no market impact (CAPABILITIES §4). Taker-only
  strategies sit on the pessimistic side of the sim's biases and therefore
  produce the most trustworthy backtest evidence.
- **E3 — Fee shape favors extreme prices.** Taker fee = bps·min(p,1−p)·size,
  so trading near p=0.5 pays ~4-9× more fee per share than near p=0.95
  (CAPABILITIES §4). Mechanisms at extreme prices clear a lower cost bar.
- **E4 — Never emit `merge_positions` in a backtest strategy.** Merging
  mid-episode erases both legs without booking the $1/pair credit; only
  pairs still held at episode end are valued (CAPABILITIES §4). Buy-both /
  split-based ideas must hold pairs to settlement or sell legs explicitly.
- **E5 — Gate on `fill` events, not order status.** Resting maker fills
  emit no `ws_order_update` in the simulator, and MINED never appears;
  status-gated logic silently misses maker fills (CAPABILITIES §4).
- **E6 — Recorded books can be self-crossed; top-of-book "arbs" are often
  artifacts.** In telonex-delta replay a single asset's book can show
  bestBid > bestAsk (observed: UP bid 0.40 vs UP ask 0.37,
  btc-updown-15m-1764461700, EXP-000-debug replay 2026-07-09) — impossible
  on a live CLOB, an artifact of delta streams with no trade-removal events
  (WS gaps leave stale levels; CAPABILITIES §2, §5). Consequences: (a)
  apparent UP+DOWN dutch books at top-of-book are frequently just one
  self-crossed mirrored book; (b) any strategy keying on "too good" quotes
  must guard against self-crossed books or it harvests phantom fills the
  simulator happily grants; (c) composition diagnostics should check entry
  quotes against the same-book opposite side. Grounding: EXP-002 smoke
  (EXP-002-smoke, pnl −84.88 across 10 markets via one-legged fills into
  crossed states) + the debug replay above.
- **E7 — Ambient `.env` changes run semantics; pin the execution model per
  run.** The repo's `.env` sets `BACKTEST_LATENCY_DELAY=140`, silently
  applied to every backtest (found when FOK batch legs executed 140ms after
  submission in the EXP-002 smoke — one-legged "riskless" pairs).
  `tools/submit.ts` now pins `BACKTEST_LATENCY_DELAY`/`JITTER` explicitly
  for every stage (DECISIONS D8). Any future env-sensitive knob (e.g.
  `BACKTEST_TAKER_FEE_BPS`) must be pinned the same way before it becomes
  evidence-relevant.

- **E8 — Background evidence runs die with the session; launch them
  detached.** Two EXP-001 probe launches were killed by session-level
  SIGTERM (the harness terminates the session's process group when a
  session ends): the first persisted nothing (voided, E7), the second
  persisted 379/500 markets because per-market rows are written
  incrementally and the run row was finalized `completed` on SIGTERM.
  Consequences: (a) any run that must outlive the session is launched with
  `setsid nohup ... < /dev/null > log 2>&1 &` so it escapes the process
  group (DECISIONS D10); (b) before declaring a killed run VOID, check the
  DB — partial persistence is the norm, not the exception, and an
  exogenously truncated random sample is still a random sample (D9).

- **E9 — The UP/DOWN pair is internally consistent at top-of-book beyond
  fees (mechanism `sum-mispricing` is dead as a taker edge).** EXP-002
  probe (run 308): across 500 random exploration-window markets, uncrossed
  bestAsk(UP)+bestAsk(DOWN) < 1 − 156bps·min(p,1−p)·2 − 0.002 fired ZERO
  times (95% upper bound ≈ 0.6% of markets, at ~0.002/share when it would
  fire — economically nil). Complement quoting is tight; apparent dutch
  books in recordings are crossed-book replay artifacts (E6). Do not
  re-register this class without a genuinely different angle (depth beyond
  top-of-book, changed fee regime).
  _Structural strengthening (U43r, CAL-001 mid-run, outcome-free; rescoped
  U43t per AUDIT-2026-07-10-CAL-001-AMENDMENTS finding 1):_ in the
  delta-typed recorded dataset, at TOP-OF-BOOK, the two books mirror
  exactly: 16,352/16,353 paired (market, offset) samples over 2,646
  markets satisfy `bid_DOWN = 1 − ask_UP` and `ask_DOWN = 1 − bid_UP`
  (batchUid CAL-001-discovery-v3; verifier recompute). Consistent with
  the venue maintaining one order set viewed from both sides (a prior,
  not measured from here — the local converter carries both sides
  independently, deltaTyped.ts:199-204, but the upstream feed is
  unverified). Top-of-book pair-arbitrage re-skins are dead in this
  dataset at ~1/16,000 deviation frequency; the original depth-beyond-
  top-of-book angle remains unmeasured and stays the reserved
  re-registration path.

- **E10 — Fast jumps are priced fairly at the post-jump ask; mid-range
  taker fees make "trade the jump" strictly negative.** EXP-003 probe (run
  309, N=500, 368 entered): win rate of the jump direction bought at the
  post-jump ask equals the ask to 4 decimals (0.5679 vs 0.5679, gross
  EV/share +0.00005) — the book reprices within the entry latency of a
  taker; there is neither momentum (stale ladder) nor reversal
  (overreaction) edge at this trigger. 156 bps mid-range taker fees turn
  the zero-gross trade into −1.47/market net. Transfer: (a) any mechanism
  whose gross edge is < ~1.5c/share at mid-range prices cannot clear taker
  fees; (b) this LOWERS the prior for IDEAS #6 (first-minute overreaction)
  but does not kill it — different clock regime, and the Judge noted the
  prediction was not contradicted, so no overreaction fuel either.

- **E11 — Persistent top-of-book depth imbalance does NOT predict the
  window outcome (`flow-momentum` dead at this signal).** EXP-004 probe
  (run 311, N=500, 85 entered): direction with ≥0.6 UP-book imbalance
  sustained ≥5s won 28.2% vs mean entry ask 31.9% — gross EV/share −0.037
  BEFORE fees; the signal is marginally anti-predictive (resting depth is
  not flow; whoever needs size posts where it will be eaten). Transfer:
  book-shape signals must beat the ask, not chance — the ask already
  contains the book's information.

- **E12 — First-minute deviations from 0.5 are fairly-to-informatively
  priced; fading them has no gross edge (`time-structure` open-regime
  fade dead).** EXP-005 probe (run 312, N=500, 156 entered): cheap side of
  a ≥0.15 first-minute deviation won 34.6% vs mean ask 35.8% — gross
  EV/share −0.012 pre-fee. Together with E10 (mid-episode jumps fairly
  priced) and E11 (book shape carries no extra information), the picture
  is consistent: this market's directional pricing is efficient at taker
  horizons across the episode clock. The one measured inefficiency remains
  the expiry-tail certainty discount (EXP-001, structural redeem-friction
  sellers). Idea generation should target structural counterparties
  (forced/friction flows), not price-pattern signals.

- **E13 — The final persist is one transaction; a single out-of-range
  segment value voids the whole run.** Run 315 lost 2000 replayed markets
  to a DECIMAL(14,6) overflow in one daily segment's quality_system
  (near-identical pnls → q=avg/std ~1e9). High-certainty cells (minAsk ≥
  0.95, wins clustered at +3..+5) are the natural trigger. Guard: wrapper
  clamps quality columns at the driver boundary (D12). General rule: any
  run whose pnl distribution can degenerate (tight ask bands, tiny samples
  per day) risks engine-side persistence artifacts — check the persist
  SUCCEEDED (row in runs.ts) before treating a "finished" log as a result.
  _[Update U59, 2026-07-11: the operator's main-merge (f1cf90b) closed this
  class engine-side — computeQuality now nulls degenerate ratios before the
  driver, covering the fleet path the D12 clamp never reached (D12
  amendment; knowledge/MERGE-AUDIT-2026-07-11-f1cf90b.md). The general rule
  stands.]_

- **E14 — The expiry tail is ALSO efficiently priced; EXP-001's probe
  "advance" was sampling noise, and the probe design has a measurable
  blind spot for skewed payoffs.** Main run (301 extended, N=13,977,
  11,121 entered): win rate 0.9316 vs mean entry ask 0.9323 — every ask
  bucket sits on the diagonal; EV/market −0.19, t=−1.15; the 156 bps taker
  fee is pure loss. The probe (N=379 prefix, same run) had shown +1.94,
  t=+3.08. Diagnosis: with a +3c-win/−90c-loss payoff, the estimator's
  information lives in the LOSS COUNT — the probe saw only 7 losses, so
  its t was built on ~7 effective observations, not 231. Transfer rule for
  the protocol: for strategies with win-rate > ~0.9 or < ~0.1, judge probe
  precision by the count of minority-outcome events (want ≥ ~30), not by
  t alone. Together with E9-E12: every taker mechanism tested (tails,
  jumps, book shape, open, dutch books) is priced fairly; net of 156 bps
  fees the venue offers NO taker edge in this universe. Remaining
  unexplored territory is the maker side (posting liquidity, capturing
  spread + adverse-selection premium), which the simulator models
  conservatively (worst-queue) but optimistically on size — live-paper
  validation is mandatory there by construction.

- **E15 — Worst-queue maker fills need SINGLE-TICK gaps through the level;
  quiet regimes at tight thresholds barely exist and pin at the tails.**
  From EXP-006's smoke (run 328) + diag-quiet + fill-feasibility
  diagnostics (EXP-000-debug runs 331-333, 335): (a) a strategy that
  requotes on ≥1c drift is only fillable by a single-tick move bigger than
  its offset — at ~50 events/sec tick density multi-tick drifts get chased,
  so fill frequency is governed by instantaneous gap frequency, not by
  volatility; (b) trailing-60s UP-mid range ≤ 0.02 occurs in only 0-3% of
  in-window ticks and clusters at pinned near-decided mids (mean quiet-tick
  mid ≈ 0.97/0.02), so "quiet + mid-range price" gates compound to almost
  nothing; (c) measured market fill rates for a δ-below-fair two-sided
  quoter: (δ=0.02, range≤0.04) 0/30 markets, (0.01, 0.04) 1/30,
  (0.01, 0.08) 6/30 markets. Transfer: maker experiment design must budget
  fills from single-tick gap statistics, not volatility; and O(n²) per-tick
  window scans are a real cost at this tick density (5s/market vs 1.4s —
  use monotonic-deque windows).

- **E16 — Quiet-regime punch-throughs are informative, not noise: passive
  quoting δ below fair loses to adverse selection even at zero maker fee
  and with the size axis simulated in the strategy's favor.** EXP-006
  probe (run 336, N=500, primary cell offset=0.01/quietRangeMax=0.08):
  117/500 markets played, 115 decisive (53 wins / 62 losses; corrected
  U32 — the original "62 decisive" misread results.ts's wins/losses
  notation, see EXP-006 erratum), 186 maker fills (makerShare=1);
  EV/market −0.18 (t=−1.52, kill bar met), EV per PLAYED market ≈ −0.79;
  win rate on played markets 0.453 (0.461 on decisive);
  positiveDayFrac 0.236 over 144 days
  (broad negative, no single cliff). The hypothesis's own contradiction
  branch fired: a single-tick gap through a resting bid in a "quiet"
  window is a move that continues, not one that reverts — the 1c discount
  plus pair-completion capture is smaller than what the filler knows.
  Transfer: (a) under worst-queue, EVERY fill is by construction the most
  informed counterparty; any maker mechanism whose edge story is "noise
  reverts" must expect the simulator to select exactly the non-noise
  fills, so the backtestable version of such mechanisms tests "is a
  through-move informative?" — and in this universe it is; (b) with all
  fills maximally adverse and still only −0.79/played-market, the
  UNMEASURED at-touch economics live could differ in sign, but that is
  not knowable from this instrument (model-conditional kill, D14); (c)
  combined with E9-E14: taker side fairly priced net of fees, and the
  one maker design the simulator can see loses — remaining maker ideas
  must either change the fill trigger (e.g. quote INTO loud moves where
  reversion is the claim being paid for) or accept that only live paper
  can measure them.

- **E17 — Loud-regime punch-throughs are informative too: countertrend
  passive bids into ≥10c moves lose −1.27 per played market. With both
  regimes measured, the worst-queue-observable edge space in this
  universe is EXHAUSTED and uniformly negative.** EXP-007 probe (run 342,
  N=500, offset=0.01/jumpSize=0.10): 177/500 played, 342 maker fills
  (makerShare=1, zero taker), EV/market −0.45 (CI95 excludes 0, t=−2.03),
  EV/played ≈ −1.27, win rate 0.4011 — a bid 1c below post-move fair that
  gets punched through during a loud cascade is on the wrong side of the
  move's continuation, same as quiet (E16), and worse per fill. The
  "overshoot reverts" story fails at the only point the simulator can
  observe it: the cascade that reaches a resting bid keeps going.
  Transfer: (a) E16's finding is regime-independent — under worst-queue,
  a through-move is informative whether the tape is quiet or loud;
  "reversion pays the maker" has now been falsified at both extremes of
  the regime axis, so no remaining regime gate rescues punch-through
  maker designs; (b) the full observable map is now: taker side fairly
  priced net of 156 bps fees everywhere tested (tails E14, jumps E10,
  book shape E11, open E12, dutch books E9), maker punch-through side
  adversely selected in both regimes (E16, E17) at zero maker fee and
  with size simulated in the strategy's favor — every mechanism class in
  the starter set has a measured negative or fairly-priced verdict; (c)
  what remains structurally unmeasurable by this instrument: at-touch
  maker fills (queue position economics), which is where real maker PnL
  lives on most venues. Any further backtest in this scope must name a
  fill trigger that is NOT "the book moves through my level," or it is
  re-testing E16/E17.

- **E18 — inclusive `--to-ms` leaks exactly the boundary market into
  "exploration" sampling pools.** Found by the D18 fresh-context audit
  (knowledge/AUDIT-2026-07-10-D18-UNLOCK.md, finding 4.2). The engine's
  `--to-ms` filter is an INCLUSIVE upper bound (`lte`,
  src/db/telonexEligibility.ts), while the protocol defines exploration as
  `market_start_ms < holdoutBoundaryMs` — and the boundary equals the FIRST
  holdout market's start (universe.ts derives it from an actual market).
  So every probe launched with `--to-ms 1777237200000` (EXP-006, EXP-007,
  EXP-008, EXP-009) had the single market btc-updown-15m-1777237200 in its
  500-draw random pool (~3.5% chance of being drawn per probe).
  Statistically negligible and identical across all affected experiments,
  but a mechanical contradiction of "holdout untouched". Transfer: (a) all
  FUTURE sample rules must use `--to-ms <holdoutBoundaryMs − 1>` (for the
  current universe: 1777237199999); (b) judging any of the affected runs
  must check whether the boundary slug was drawn and disclose it; (c) when
  a window boundary is defined by a strict inequality, the tool flag that
  implements it must be checked for inclusivity — do not assume.
  _Amendment (U50, global holdout-lock audit,
  `knowledge/HOLDOUT-LOCK-AUDIT-2026-07-10.md`): the scope above was
  incomplete — the SAME inclusive flag on the EXP-001 lineage was
  DETERMINISTIC, not a pool chance: run 301's main extension replays the
  full window, so N=13,977 = 13,976 exploration markets + the boundary
  market, which entered with 1 taker fill (the lab's only outcome-bearing
  holdout contamination in the persisted backtest tables — the sweep's
  scope); runs 326/327 (latency battery) replayed it with
  zero fills. Verdict-immaterial by an outcome-free bound (shares=100 ⇒
  |PnL| ≤ 100 ⇒ EV shift ≤ 0.007 on a −0.19 readout); erratum on the
  EXP-001 file. The DB-level sweep also confirmed the 8 grid cells never
  drew the boundary market (previously just luck, now verified)._
  _Second amendment (U52): transfer rule (a) had been recorded here but
  `tools/submit.ts` — the stage-command builder — was never patched; all
  four exploration-bounded stages (probe/main/lat/grid) still emitted the
  inclusive `--to-ms <boundary>`, so any FUTURE probe would have re-leaked
  the boundary market into its pool. Fixed to `boundary − 1`; verified by
  printing all five stage commands against the frozen EXP-001 spec
  (probe/main/lat/grid → 1777237199999; holdout keeps its CORRECT
  inclusive `--from-ms 1777237200000 --to-ms <holdoutEndMs>`, since
  holdout = boundary ≤ start ≤ end per universe.ts; --from-ms verified
  inclusive/gte at telonexEligibility.ts by the U52 checker, so holdout
  keeps the boundary market as it must). The U52 fresh-context checker
  then found the SAME stale rule in two more carriers — the experiment
  template's pre-registered sample rule and LIFECYCLE §probe (both fixed
  to boundary − 1) — and that smoke was unbounded (safe only by the ASC
  default ordering; run 351's --random smoke is the leak precedent);
  smoke now also emits boundary − 1 when the spec has a boundary. A
  lesson without a mechanical carrier decays: rules that constrain
  future commands must be patched into EVERY carrier that produces or
  pre-registers those commands, in the same unit._

- **E19 — the at-touch maker bracket is closed: the optimistic fill bound
  loses MORE than worst-queue, in both regimes.** EXP-008 (run 357) and
  EXP-009 (run 358) re-ran the FROZEN EXP-006/EXP-007 primary cells under
  the engine's `touch_or_better` fill model (D18 instrument: always first
  in queue, full remaining size the instant the touch reaches the level,
  zero maker fee) at N=500 each. Quiet two-sided cell: EV/market −0.433
  (t=−1.41, EV(played) −0.552) vs parent worst-queue −0.18. Loud
  countertrend cell: EV/market −0.848 (t=−2.13, CI95 excludes 0,
  EV(played) −1.218) vs parent worst-queue −0.45. Both predictions
  CONTRADICTED, both pre-registered kill bars met. The measured brackets:
  quiet [−0.18, −0.433], loud [−0.45, −0.848] — negative at BOTH ends, so
  the real queue model's location inside the bracket is economically moot.
  Interpretation: at-touch flow that does NOT move through the level is
  still adversely selected on this venue at these cells — touch mode
  doubled played-market density and quadrupled raw fills (EXP-009: 348 vs
  177 played, 1.97×; 1482 vs 342 fills, 4.3×; wording corrected per the
  E19-chain audit finding 2) at essentially the same negative EV per
  played market, so more
  of the hypothesized "benign" flow just meant more toxic fills.
  Transfer: (a) the E17c caveat (at-touch economics structurally
  unmeasurable) is now RESOLVED NEGATIVELY in-model — the engine has no
  remaining fill model to try; maker registrations in this scope now
  require a cited venue regime change (VENUE-DRIFT bands) or an
  instrument the engine does not have (trade prints, live paper at
  touch), per EDGE-SPACE §4; (b) audit 4.1 was validated empirically:
  an "optimistic" fill bound is NOT a strategy-level upper bound —
  inventory caps plus full-size toxic fills made touch strictly worse
  than worst-queue in both cells; treat fill-model bounds as instrument
  ends, never as dominance proofs; (c) the pre-verdict integrity ritual
  (hook line, E18 boundary check, phantom-fill tripwire on top-5 |PnL|
  markets) cost minutes and caught nothing this time — but the tripwire
  design mattered: the known E6 crossed-book market DID land in EXP-009's
  best5, and the pre-registered "sign of pnlTotal" criterion resolved it
  mechanically instead of by judgment call.

- **E20 — CAL-001: both taker half-planes are on-diagonal across the full
  offset × price grid, within stated power (2026-07-10, discovery window
  2025-11-30 → 2026-02-28, 8,516 markets, verdict null-confirmed by
  fresh-context Judge).** The pre-registered calibration-plane study
  (`knowledge/CALIBRATION.md`, frozen method + 14 pre-read amendments)
  sampled UP and DOWN top-of-book at 7 frozen offsets
  (30/150/300/450/600/750/850s) over 8,516 markets and evaluated the
  frozen 126-cell grid ONCE: zero CANDIDATE cells, zero NEG-FLAG cells
  at the Bonferroni bar z ≥ 3.565. Both validation gates passed
  (join-direction tail winRates 0.9854/0.9778; E14 positive controls
  z = −1.02/−0.59). Most extreme cells anywhere: z = −3.26 and −3.02,
  both NEGATIVE (buying costs money) — the plane's deviations point the
  fee-drag way, never the edge way. Where power was best (extreme-price
  tails, candidate bar ≈ 1.3c vs fee ~0.08c), both sides are clean at
  600/750/850s. Scope limits (binding): 750s/850s cells are conditional
  on a book event at-or-after the offset (coverage 0.8746/0.5993 of the
  8,133 sampled markets); mid-range cells resolve only |d| ≳ 3.8c (power
  statement, not efficiency proof — but E9–E14 already measured mid-range
  with targeted strategies); the two books are exact mirrors (52,386 of
  52,388 pairs; amendment #12), so buy-DOWN cells are the sell-UP-at-bid
  economics, not independent evidence. Transfer: (a) the E9–E14
  conclusion ("taker fairly priced everywhere tested") is upgraded from
  five point measurements to a systematic plane scan — a future taker
  registration must argue why its edge is invisible to BOTH the five
  strategies AND the 126-cell grid; (b) within CAL-001's stated power
  and coverage conditioning, fixed-time top-of-book state alone carries
  no taker-exploitable signal on this venue; anything left must live in
  CONDITIONAL structure (path/flow features within the window), below
  CAL-001's power (mid-range resolves only |d| ≳ 3.8c) but above the
  ~1.5c fee floor, or outside the taker channel — and E16–E19 close the
  maker channel in-model; (c) the discovery/probe split design cost nothing:
  the probe reserve (5,460 markets) was never spent because no candidate
  emerged — reserving confirmation data before looking remains free
  insurance against multiplicity.

- **E21 — CAL-002: single-segment move sign/size adds no taker-exploitable
  conditional signal; late big down-moves CONTINUE, and the continuation
  is worth less than spread + fee (2026-07-10, null-confirmed by
  fresh-context Judge).** The pre-registered conditional-plane study
  (`knowledge/CALIBRATION-2.md`, D24; zero new replay compute — derived
  from the CAL-001 discovery log with a BINDING reserve-confirmation rule
  for any candidate) evaluated k = 60 frozen cells (6 adjacent offset
  pairs × 5 tick-derived move buckets × both entry sides) once: zero
  CANDIDATE cells (max positive z = +1.75), one NEG-FLAG — UP (600-750,
  dn2), z = −3.72, n = 2,708, fully powered (cells condition on valid
  books at both pair offsets; pair coverage 0.766 at 600-750, 0.464 at
  750-850 — no claim is made for excluded quiet markets). The structure behind the
  flag is coherent across pairs from 300s on (UP dn2 z: −2.23, −3.00,
  −3.72, −2.90): after the UP mid falls ≥ 2c in a segment, the post-move
  UP ask is stale-high ≈ 1.5-2.4c gross (2-2.4c at the late pairs;
  published d 1.51/1.92/2.43/2.25c — corrected in-place per CAL-003
  amendment #3 / E22 propagation audit) — big late moves continue more
  than the book reprices, the conditional refinement of E16/E17's
  "through-moves are informative". But the tradable expression (buy DOWN
  at its ask — the SAME book samples, not independent evidence) nets at
  most +0.75c (z ≤ +1.75): the counterparty misprices by less than the
  cost of taking the trade. Transfer: (a) momentum/continuation ideas at
  segment horizons (~1.7-2.5 min segments) are now measured within
  stated power (dn2/up2 cells resolve ~2-2.7c; thin buckets only
  ~6-10c) — gross continuation is real and ~2c, net continuation is
  inside costs; a registration claiming this mechanism must argue a
  cheaper expression than taking the ask, for which no measured in-model
  expression survives (E16-E19; a new touch cell needs an E19-escape
  argument per EDGE-SPACE §4); (b) the
  move distribution is strongly bimodal (|move| ≥ 2c in ~90% of
  segment-samples) — "quiet vs loud segment" is nearly degenerate as a
  gate, which PLAUSIBLY explains EXP-006's near-fill-less quiet cells
  (a hypothesis, not established: CAL-002 measures endpoint moves
  100-150s apart, not EXP-006's intra-window regime gate, and an
  endpoint-flat segment can still move intra-segment);
  (c) thin-bucket nulls (dn1/flat/up1, n ≈ 130-330, resolve only
  ~6-10c) are power statements; (d) the reserve-confirmation design
  (needed because discovery reused a log with published marginals) cost
  nothing: no candidate, no reserve spend — pre-committing confirmation
  data remains free insurance.

- **E22 — CAL-003: two-segment path shape adds no taker-exploitable
  signal within stated power; persistence does NOT concentrate the E21
  continuation, the up-then-dn reversal shape concentrates it gross but
  the tradable mirror stays under the bar (2026-07-10, null-confirmed by
  fresh-context Judge).** The pre-registered two-segment path study
  (`knowledge/CALIBRATION-3.md`, D26; zero new replay compute — third
  read of the CAL-001 discovery log, with pre-read audit, a BINDING
  reserve-confirmation rule, and a new gate that mechanically reproduced
  CAL-002's published gate values 8/8) evaluated k = 40 frozen cells
  (5 consecutive-offset triples × 4 big-move shapes {dn-dn, dn-up,
  up-dn, up-up} × both entry sides; mid-involved shapes excluded as
  disclosed — that region remains formally open) once: zero CANDIDATE cells (bar z ≥ 3.26; max positive
  z = +2.40), one NEG-FLAG — UP (450-600-750, up-dn), z = −3.47,
  n = 981, fully powered (cells condition on valid books at all three
  offsets; triple coverage 0.766 at 450-600-750, 0.464 at 600-750-850 —
  no claim for excluded quiet markets). Findings: (a) the a-priori
  persistence hypothesis is dead on this data — buy-DOWN dn-dn at the
  late triples nets +0.39c/+0.59c (z ≤ +0.85), and conditional dn-dn
  gross d is at or below E21's unconditional dn2 figure: two consecutive
  big down-moves misprice NO MORE than one; (b) the reversal shape
  concentrates staleness gross — after up-then-dn, buying UP loses 4.39c
  gross (≈ 1.8× E21's unconditional −2.43c), the strongest gross
  staleness in the conditional scans (CAL-002/003 family) — but the
  tradable mirror (buy DOWN, SAME book samples, not independent
  evidence) nets +2.38c at z = +2.40, below the corrected bar (this
  cell's bar ≈ 4.1c gross; observed +3.01c): NOT citable, reserve
  correctly unspent, hypothesis-generating only; (c) power scoping (in
  place, binding): loaded cells resolve ≈ 2.3-4.8c gross, so nulls do
  not exclude path edges in the ~1.5-3c band, and the up-dn mirror at
  +2.4c net sits concretely inside that open sub-power window;
  (d) transfer: momentum/trend-following ideas built on one- OR
  two-segment sign paths at these horizons (~1.7-2.5 min segments,
  offsets 30-850s) are now measured within stated power — any future
  taker registration citing path structure must go beyond two-segment
  sign shape (e.g. finer paths, flow/derived features) or bring another
  instrument that clears ~1.5c in the sub-power window; (e) the
  gate-reproduction pattern (hard-coding the predecessor tool's
  published gate values as an abort condition) caught nothing this time
  but costs nothing and mechanically pins cross-tool derivation
  equivalence — keep it for any future same-log study.

- **E23 — CAL-004: spread state adds no taker-exploitable signal within
  stated power; the CAL-001 null is not hiding a tight-book-confined
  edge, and with this scan every single feature axis the discovery log
  expresses is measured (2026-07-11, null-confirmed by fresh-context
  Judge).** The pre-registered spread-state decomposition
  (`knowledge/CALIBRATION-4.md`, D34; zero new replay compute — fourth
  read of the CAL-001 discovery log, with pre-read audit whose 5
  findings were amended in before the read, a BINDING
  reserve-confirmation rule with a now-MECHANICAL proceed/park criterion
  computed from printed table quantities only, and six identity gates
  that reproduced the published CAL-001 read exactly at printed
  precision) evaluated k = 252
  frozen cells (the CAL-001 offset × ask-bucket × side grid × spread
  state T ≤ 0.0105 < W) once: zero CANDIDATE cells, zero NEG-FLAG cells
  (bar z ≥ 3.75; extremes: UP W (750s, [0.20,0.35)) z = −3.05 — the
  W-state concentration of CAL-001's own −3.02 marginal there,
  buyer-adverse staleness per E21/E22, not an edge (750s cells condition
  on a book event at-or-after the offset, coverage 0.8746 of sampled
  markets, plus the spread state at the sampled moment); max positive
  +2.29 on an n = 1 cell). Findings: (a) T cells (85,127 of 100,404 samples,
  pooled 84.8%; per-cell shares vary — any specific T-cell citation
  must quote its PRINTED tfr, down to ~0.51 at late offsets) track the
  CAL-001 marginals throughout — NOT an independent confirmation of
  E20 (~85% shared samples), but the decomposition arithmetic that E20
  could not settle is now measured: no tight-confined edge with a
  canceling wide-state complement exists at the resolvable level;
  (b) W cells are power statements almost everywhere (mid-range W
  resolves only |d| ≳ 6-10c) — the W conclusion is bounded to "no gross
  dislocation at the several-cent level", and the near-flag W deviation
  is buyer-adverse continuation, consistent with E21/E22; cross-side
  reflections share mirrored book samples and are ONE piece of evidence
  (CAL-001 amendments #12/#13 carry over); (c) SCOPE (Judge-corrected,
  per the CAL-004 erratum — do not over-tighten): this closes the last
  single feature AXIS the log can express (levels/E20, moves/E21,
  two-segment big-move sign paths/E22 with mid-involved shapes formally
  open, spread state/E23; cross-side sums degenerate by the mirror
  fact; sizes unrecorded). Joint/interaction conditionings of scanned
  axes (e.g. spread × prior-move) remain formally expressible with
  strictly less power per cell (incidence products) and the same
  binding reserve-confirmation burden under the U45 envelope — a future
  interaction scan needs its own pre-registered motivation, it is not
  auto-dead; (d) process transfer: the pre-read audit again converted a
  post-table discretionary branch (which candidates may spend the
  reserve) into a frozen formula (z ≥ 4.49 + mid-price W park, from
  printed z/meanAsk/d/se only) — every future scan should freeze its
  proceed/park arithmetic at registration, not at candidate time;
  (e) one-shot hygiene: piping a one-shot read through `head` SIGPIPE-
  kills the tool mid-print — run one-shots redirected to a file, glance
  at the file; the truncated first invocation was disclosed and the
  deterministic completion is the read of record.

- **E24 — BATCH-001: event-time entry meets the same adjusted price as
  fixed-time entry, and at-touch maker capture is adversely selected at
  every time-of-window tested — including the open (2026-07-11,
  7 screens, all killed; fresh-context checkers over both verdict
  groups).** The first SCREENING.md batch (D49): four fleet taker
  screens — first-passage continuation at 0.80 (q̂=−0.081, the crossing
  ask is already ≥ fair when price first arrives), first-passage fade
  (exactly fair, q̂=−0.002), depth-withdrawal momentum (q̂=−0.035),
  quote-pressure imbalance (q̂=−0.048) — and three at-touch maker
  screens under the D18 optimistic bound — late tail bid at fav ≥ 0.90
  (EV(played) −3.56/market: selling reversal insurance at stale
  prices), the E22-aimed reversal DOWN bid (EV(played) −4.52/market:
  the ~4.4c gross staleness does NOT survive instrument transfer to a
  touch bid; fills arrive preferentially when continuation runs through
  the bid), and opening two-sided touch quoting in the first 90s
  (t=−5.16, ~1.96 fills/played market yet winRate(played) 0.237 —
  there is NO pre-information grace window; adverse selection operates
  from the episode's first seconds). Transfer: (a) conditioning entry
  on the market's own price path (event-time) buys nothing the
  fixed-time scans didn't already price — E20's lesson extends to
  first-passage triggers (screen-grade, N=500 — not a null-confirmed
  plane scan); (b) measured gross taker-adverse staleness is
  not a maker invitation: the staleness and the adverse selection are
  the SAME phenomenon seen from two sides — whoever is resting gets run
  through, whoever takes pays the adjusted price; (c) batch economics
  worked as designed: 7 mechanism-distinct ideas, 2 fresh-context
  checkers, ~3 hours wall including two ~55-min local touch queues —
  the fleet part cost minutes; touch screens are the bottleneck (local
  sequential per D18).

- **E25 — SIGNAL-001: the recorded feature space holds ZERO
  buyer-favorable gross signal at fixed offsets, within stated power;
  all significant structure is buyer-adverse staleness on cheap sides
  late (2026-07-11, one-shot read; map-grade).** 16 features
  (depth-imbalance ladders, total depth, activity rates, realized vol,
  choppiness, range/position, opening state, crossed-count) × 5 offsets
  × both sides over all 8,127 emitting discovery markets: monotone
  screen 0/160 candidates (1 WARM: firstMid at o150, sub-bar
  drift-momentum ≤ ~1c), cell grid 4/2,309 candidates ALL negative-d
  (named zones Z1-Z3 in SIGNAL-MAP §3 — wide-range and
  wrong-end-of-range late cheap-side asks overprice recovery by
  ~3.5-5.3c gross), seasonality 0 candidates (no hour-of-day or day-of-week
  mispricing at the 4.4 bar). Pooled G2 asymmetry recorded: UP-side
  buys lose −1.16c gross on average (z=−5.2) while DOWN is flat — the
  mirror is spread-absorbed — not capturable at the ask (maker-side
  capture is measured separately: the BATCH-001 touch kills). Transfer: (a) idea
  generation on this dataset must now leave the
  book-state-at-fixed-time plane entirely (mechanism-level gaps:
  order-type structure, settlement/timing mechanics, cross-episode
  conditioning — SIGNAL-002 pending); (b) the diffuse warm-cell
  pattern (17 of 23 warm cells are LO-stratum negative-d; 3 warm cells
  point the buyer-favorable way, all sub-bar) says cheap
  longshots are systematically slightly overpriced everywhere late —
  consistent with E14/E21/E22 and the BATCH-001 tail-maker kill; the
  venue's one persistent regularity remains "the stale cheap side is a
  trap for both taker and maker".

- **E26 — BATCH-002: the distance continuum, fill-conditional pair
  sums, and a measured warm-cell dilution (2026-07-11; screen-grade,
  checker-verified).** All three mechanism-gap screens killed (runs
  462/464/465, checker report
  `knowledge/AUDIT-2026-07-11-BATCH-002-CHECKER.md`). (a) DEEP maker
  distance is adversely selected like near-fair distance: 10c-deep bids
  filled in only 22/500 markets and won 36% (needed ~47%+ at the fill
  prices; EV per played ≈ −4.55) — with E16/E17/E19 this closes the
  worst-queue punch-through story across the whole measured 1c-10c
  distance range; sweep size does not turn information into overshoot
  (model-conditional per D14). (b) FILL-CONDITIONAL transient ask sums
  are adverse, sharpening E9: conditional on a maker fill at p, the
  same-tick opposite ask a satisfies p + a + fee > 1 on average and
  decisively so (locking every pair loses −6.80/market, t=−3.17, CI95
  excludes 0) — the book does not lag itself after a sweep; the
  "neutral lock" pays the dislocation instead of collecting it. The
  hedge leg had no simulator favor (real recorded ask + real fee), so
  unlike pure maker kills this one is only HALF model-conditional.
  (c) First measured warm-cell dilution: SIGNAL-001's best
  buyer-favorable warm cell (DOWN o850 HI-range q4, d=+4.51c, z=+3.10,
  n=255) re-sampled at 4× with partial overlap came back +0.57c/share
  (t=+0.74, 774 played, minority 84 ≥ 30 — adequately powered) — an
  ~8× shrink on mostly the SAME window is winner's-curse arithmetic
  made visible, and it validates the map rule that warm cells are
  aiming aids, not evidence. Transfer: (i) maker punch-through ideas
  at ANY distance now need a non-worst-queue argument to register;
  (ii) "the book lags itself" ideas are dead as a class in recorded
  data — both standing (E9) and fill-conditional (this) sums are
  consistent; (iii) a scan cell's d is an upper bound under re-draw
  even in-sample: discount warm cells by several× when sizing screens
  (SCR-006's N=2000 sizing was adequate — played 774 even EXCEEDED
  the 100-300 incidence forecast, so power was not the binding issue;
  the shrink of d itself was).

- **E27 — SCR-007 was derivably dead BEFORE its run: screen premises
  must be checked against recorded-data INVARIANTS at freeze
  (2026-07-11; post-kill decomposition of run 465).** Per-market
  decomposition by hedge completeness (DB group-by, idea-generation
  mining of a judged kill): zero-hedged markets −3.31/market (198
  mkts — plain E16-class directional loss), partially hedged
  −12.56/market (179), fully locked −23.68/market (21 mkts, 44 pairs ≈
  −11.3 per locked pair) — hedge intensity made losses monotonically
  WORSE; the locks themselves were the poison, not the residue. The
  structural reason was already in the knowledge base: recorded DOWN
  books are EXACT same-tick UP mirrors (CAL-001 amendment #12; the
  IDEAS dead-family entry generalizes it). A same-tick hedge therefore
  buys the ALREADY-MOVED mirror ask — "the opposite ask lags the
  sweep" was impossible by construction in this dataset, and the lock
  mechanically freezes adverse-move + spread + fee into every pair.
  E26b stands (the measurement is real and its magnitude useful) but
  the run bought nothing derivation couldn't have. Transfer: (a) a
  screen premise that quantifies over BOTH books must be checked
  against the mirror invariant before freeze — any mechanism whose
  edge requires the two books to disagree, even transiently, is dead
  at derivation here; (b) SCREENING mini-specs now carry a mandatory
  `invariants:` line (D50) naming the recorded-data invariants the
  premise touches and why it survives them; (c) the current invariant
  list for (b): same-tick UP/DOWN mirror books (CAL-001 am. #12),
  self-crossed books exist (E6), boundary market leak fixed by
  --to-ms boundary−1 (E18), worst-queue fill = informative
  punch-through (E16/E17/E26a), results.ts zero-PnL wins/losses
  convention (BATCH-002 checker f.2).

- **E28 — a verification claim written without reading its artifact is
  worse than no claim: the D8 latency pin was silently dead on every
  manual local launch of sessions 61-62 (2026-07-11; session-63
  discovery, D51).** Runs 459/460/461 (BATCH-002 smokes), 466 (SCR-008
  smoke) and 467 (SCR-008 screen, 500-market evidence) all executed
  at the ambient `.env` DELAY=140 while their batch files said
  "latency pinned" — the sessions wrote the claim without grepping the
  log line that exists precisely to verify it (U41 built that line
  after the E7 incident; the trap fired again anyway). Run 467 is VOID
  (BATCH-003 erratum; pinned relaunch r2). Where the pin held: all
  FLEET submissions (empirically proven post-hoc — played markets of
  runs 465 and 450 re-run locally at 0/0 reproduce byte-identical
  rows, parity.ts 12/12 × 19 fields each; a 140ms run cannot fake 0ms
  rows since latency is behavior-changing — the unpinned SCR-008 smoke
  had 4 taker fills that vanish at 0ms) and the BATCH-001 local touch
  runs (0/0 in-log). Transfer: (a) D51 — the wrapper now REFUSES
  non-0/0 latency unless the batchUid says `lat`; the pin is
  mechanical for every local path, not procedural; (b) any "X verified
  in-log" sentence must be written by pasting the log line, not from
  intention — the batch checker should re-grep such claims; (c) the
  parity re-run technique (subsample judged run → re-run pinned →
  parity.ts) retro-verifies latency for any fleet run whose metadata
  is silent; it costs ~30s and settled in minutes what metadata could
  never prove; (d) diagnostic scratch: run 470 was a mislaunched
  parity check (wrong strategy id typed) — superseded by run 471,
  never read beyond row counts.

- **E29 — the G2 UP-ask premium is priced to the liquidity provider's
  break-even: real skew, zero rent (2026-07-11; SCR-008 kill, run
  472).** The ungated DOWN-side at-touch bid — the mirror-consistent
  harvest of the venue's strongest measured regularity (G2: UP-side
  taker buys lose −1.16c gross, z=−5.2, SIGNAL-001) — nets
  q̂=+0.0033, t=+0.07 over N=500 (EV +0.16/market on ±48-point
  swings, winRate 0.512, 479/500 played, maker-only, fees 0) at the
  D18 OPTIMISTIC touch bound. Kill by default outcome. What makes
  this kill different: every prior touch cell LOST 0.4-4.5/market
  (E19 quiet/loud, E24 tail/reversal/opening — all timed informed
  flow); the ungated DOWN-side cell is the first to break even. The
  two measurements are mutually consistent: unconditional touch
  adverse selection costs ≈ the G2 premium earns. Reading: the
  premium is not mispricing — it is the equilibrium compensation the
  marginal DOWN-side quoter demands for adverse selection; there is
  no rent above it, and any GATE that concentrates fills into
  informed flow does strictly worse (the E19/E24 cells are this cell
  plus a fill-worsening filter). Transfer: (a) a measured taker-side
  gross asymmetry is NOT harvestable maker-side if it equals the
  quoter's adverse-selection cost — future "harvest the skew" ideas
  must argue a fill population BETTER than unconditional, not just
  point at the skew; (b) with sell-side ≡ buy-side (mirror identity)
  and the ungated cell at break-even, the at-touch maker family is
  now closed at BOTH the gated (losing) and ungated (zero) ends
  under the optimistic bound — in-model maker registrations need a
  fill-model change (EDGE-SPACE §3.2 trades instrument) or a
  mechanism that improves the fill mix; (c) 21 of 21 ledgered ideas
  resolved: 20 dead, #10 parked. The venue prices its own
  regularities.
