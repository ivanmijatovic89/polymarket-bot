---
title: ADR Polymarket-Data Completeness Contract
description: Architecture decision record for what "complete" means in the polymarket-data pipeline — the Gamma invariant, the share tolerance, the row-vs-taker dimensions, and the no-volume policy.
---

# ADR: Polymarket-Data Completeness Contract

## Status

Accepted.

## Context

The `polymarket-data` pipeline mirrors Polymarket's public trade/activity data into MySQL. Its central promise is that a market marked `trades_status = 'done'` holds **every** fill — because downstream analysis (top-trader rankings, bot reverse-engineering, per-market volume) is only trustworthy if "done" means done.

That promise is hard to keep because the source APIs are lossy and quirky:

- `/trades` caps `offset` at 3000, so a busy market's fills exceed what one query can page (the deep-backfill stage reconstructs those from per-wallet `/activity`).
- The taker-only `/trades` query has the same cap, independent of the full query.
- Gamma sometimes reports no `volumeNum` for a market.
- `/activity` cannot page a cluster of rows that all share one second once it exceeds the offset cap.

Several review rounds each found a different way the pipeline could silently file an incomplete market as `done`. This ADR fixes the contract in one place so those decisions are not re-litigated or regressed.

The load-bearing fact: **Gamma's `volumeNum` equals the traded share count with each match counted once — i.e. `SUM(polymarket_trades.size) / 2`.** This is an identity (verified at 0.000% drift across thousands of markets), which makes it a *proof* of completeness rather than a heuristic: hold every fill and the two sides match; miss a fill and the left side drops below.

## Decision

### 1. `done` requires proven completeness

`trades_status = 'done'` is written **only** when `complete === true`. The completeness signal is three-valued and is the single source of truth for the status decision (`partial` iff `complete !== true`):

- **`true`** — the Gamma invariant holds within tolerance, OR the market is empty (no Gamma volume and no rows: trivially complete).
- **`false`** — the invariant fails: fills are provably missing → `partial`.
- **`null`** — unverifiable: Gamma reports no volume but rows exist, so there is nothing to check against → `partial` with a diagnostic. Never `done`.

Applies identically in `sync-trades` and `deep-backfill` (shared `tradeCompleteness()`), and `verify` enforces it: a `done` market that fails the invariant is an INTEGRITY VIOLATION (non-zero exit), while a `partial` one is expected work.

### 2. The tolerance is ABSOLUTE shares, not a relative percentage

The invariant is exact, so the only slack needed is the rounding from summing thousands of `decimal(18,6)` sizes. That rounding is measured at ~2e-6 shares/row (max ~0.009 shares), while real shortfalls start at ~7 shares — a clean gap.

A **relative** tolerance is wrong: 0.1% of a 1M-share market is 1,000 shares, which hid real shortfalls (6 deep-backfilled markets were `done` while 6.8–60 shares short, all under 0.071%). The tolerance is therefore absolute and row-scaled:

```
completenessToleranceShares(rows) = max(0.05, rows * 5e-6)
```

`5e-6/row` is ~2.5× the observed rounding; the `0.05` floor covers tiny markets. `verify` compares absolute shares (`ABS(SUM(size)/2 - volume_gamma)`), not a percentage.

### 3. Row completeness and maker/taker-label completeness are INDEPENDENT

Two different data-quality dimensions, never collapsed into one flag:

- **Row completeness** (the invariant) → drives `partial`. Only this can make a market not-`done`.
- **Maker/taker-label completeness** — a capped *taker* query leaves some rows that should be `is_taker = true` stored as `false`. Every row is still present (the invariant still holds), so this does **not** make the market `partial`; it is a `done` market carrying a persistent `maker/taker flags incomplete` diagnostic that is never silently cleared.

`all.capped` (full query) and `taker.capped` (taker query) are separate booleans; the full-query cap only refines the *wording* of the incomplete-rows diagnostic.

### 4. No-Gamma-volume policy

- no volume + **0 rows** → `done` (verified empty).
- no volume + **rows exist** → `partial`, `unverifiable: Gamma reports no volume but trades exist`. `verify` also flags a `done` market in this state as inconsistent.

### 5. Unreachable data fails loudly, never silently

Where the API genuinely cannot expose all the data, the pipeline surfaces it rather than pretending:

- A same-second `/activity` cluster larger than the offset cap throws a clear error (it would otherwise loop forever).
- `verify --resample` cross-checks stored data against a fresh live pull, and a stored-below-live positions count (missing participants) fails the audit — the only signal that catches a participant absent from both stored positions and the capped stored trades.

## Consequences

- A market can never be silently `done` while incomplete; the worst case is an honest `partial` with a diagnostic.
- A rare market whose fills are genuinely unreachable (extreme same-second cluster) stays `partial` or fails loudly — an accepted source-data limitation, not a pipeline bug.
- The status decision, tolerance, and diagnostics live in one shared helper (`tradeCompleteness` / `completenessToleranceShares` in `tradeRows.ts`), so the trades and deep-backfill stages cannot drift apart.

## Validation

The pure decision logic (`tradeCompleteness`, `completenessToleranceShares`, `resampleVerdict`, the `/activity` loop guard) is unit-tested; `verify` proves the contract against the live database and the API on every run.
