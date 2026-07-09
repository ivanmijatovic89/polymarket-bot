# EXP-001 — expiry certainty discount

## Spec

- **Registered:** 2026-07-09 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 1 "Expiry certainty discount"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `tail-overpricing`
- **Hypothesis (who loses and why):** Holders of the near-certain winning side
  sell out at 0.90-0.99 in the final minutes to avoid redeem friction (gas,
  capital lockup, workflow), and late hedgers must cross the spread. Their
  urgency is structural, so the near-certain side trades below its true
  probability of winning. If false, the realized win rate of the >= 0.9-ask
  side bought late will not exceed its price.
- **Falsifiable prediction:** Among entered markets in the probe, the realized
  win rate exceeds the mean entry ask (win rate > mean(entryAsk) from
  intent_meta), and gross EV per entered market is positive before fees. If
  win rate <= mean entry price, the mechanism is contradicted regardless of
  net PnL. Secondary diagnostic: the entry should fire in a substantial
  fraction of markets (a >= 0.9 ask in the last 3 minutes is common); a tiny
  entered-count makes the probe unable to kill and must be treated as a
  design failure, not evidence.
- **Strategy:** `fable-lab/strategies/tail-overpricing/EXP-001.ts`, id `fable-exp-001`
- **Primary parameter cell:** `--param entryAfterSec=720 --param minAsk=0.9
  --param maxAsk=0.99 --param shares=100`
- **Robustness neighborhood:** entryAfterSec ∈ {600, 720, 840} × minAsk ∈
  {0.85, 0.9, 0.95}, other params fixed (shares is scale-invariant in q;
  maxAsk fixed at 0.99). Judged on sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** Taker-only FOK entries at
  visible depth, no maker fills, no split/merge — the edge, if measured,
  sits on the PESSIMISTIC side of the simulator (156 bps taker fee charged,
  worst-queue irrelevant, no market impact assumed but size is clamped to
  quoted depth). One optimistic dependency is intrinsic to the mechanism:
  settlement credits the full $1 with zero redeem cost/timing, i.e. the
  simulator pays us exactly the friction the counterparty is paying to
  avoid. A confirmed verdict therefore still requires live paper validation
  with real redeem costs measured.
- **Windows (computed by tools/universe.ts at registration):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
  - main advance: t ≥ 2 on primary cell (lineage_cells=1, p-bar 0.023) +
    battery pass + bias classification not simulator-favored
  - holdout confirm: t ≥ 2 on holdout alone
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0

## Runs (append-only)

- 2026-07-09 — VOID (no DB row): first probe launch executed under ambient
  `.env` `BACKTEST_LATENCY_DELAY=140` (discovered mid-run via EXP-002 smoke
  diagnostics; DECISIONS D8, LESSONS E7). Killed at ~365/500 before the
  sequential run persisted anything. No results were read. Relaunched with
  pinned `BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0`.

## Verdicts (append-only)
