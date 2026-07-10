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
  117/500 markets played, 62 decisive, 186 maker fills (makerShare=1);
  EV/market −0.18 (t=−1.52, kill bar met), EV per PLAYED market ≈ −0.79;
  win rate on decisive markets 0.453; positiveDayFrac 0.236 over 144 days
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
