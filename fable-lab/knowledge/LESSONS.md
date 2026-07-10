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
  strategies AND the 126-cell grid; (b) fixed-time top-of-book state
  alone carries no taker-exploitable signal on this venue; anything left
  must live in CONDITIONAL structure (path/flow features within the
  window) or outside the taker channel — and E16–E19 close the maker
  channel in-model; (c) the discovery/probe split design cost nothing:
  the probe reserve (5,460 markets) was never spent because no candidate
  emerged — reserving confirmation data before looking remains free
  insurance against multiplicity.
