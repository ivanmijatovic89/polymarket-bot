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
