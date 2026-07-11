# DATASET-GROWTH — ingestion status, costs, and the operator hand-off

_Session 52, unit U64 (2026-07-11). Decision: DECISIONS.md D38._

## Why this exists

Since U43 every session's wake-up check 1 has phrased dataset growth as "if
the operator ran the Telonex sync" — an **assumed** operator-side
classification that was never tested (the exact defect class D18 exposed for
`touch_or_better`). This unit tested it. Result: the classification was
HALF wrong — the catalog sync is safely lab-runnable and is now self-serve;
the download/convert steps remain operator-gated by cost, not capability.

## What was measured (2026-07-11)

All commands cited; DB queries were read-only except the one sync below.

| Fact | Value | Source |
|---|---|---|
| Vendor catalog: resolved btc-15m markets with `book_snapshot_full` | **24,712** | `npm run telonex:sync -- --dry-run` (read-only; 1,031.7 MB catalog, matched count) |
| Local catalog rows (btc-15m) pre-sync | **22,142** (2025-10-11T00:00Z → 2026-06-14T09:30Z) | `telonex_markets` count (MIN/MAX `market_start_ms`) |
| Delta-typed conversions for those rows | **22,142/22,142 `done`** — the local catalog is fully ingested | join on `telonex_market_conversions` (`status='done'`) |
| Below the eligibility floor (2025-11-30, env `TELONEX_DATASET_ELIGIBLE_FROM`) | **3,507** markets, all converted — ingested but excluded by the floor | same join, `market_start_ms <` floor; 22,142 − 18,635 eligible |
| Sync gap (vendor − local) | **2,570 markets** = exactly the post-2026-06-14 window | 24,712 − 22,142 |
| Raw data cost per market (btc-15m, `book_snapshot_full`) | **9.75 MB/market** (3.39 files avg; existing 22,142 markets = 215.89 GB in R2) | `telonex_market_files` aggregates |
| Converted delta-typed cost per market | **1.53 MB/market** | `telonex_market_conversions` aggregates |

## What the lab did (D38): catalog sync only

`npm run telonex:sync` (default pattern `btc-updown-15m-%`, the lab's exact
scope) executed 2026-07-11:

- inserted **exactly 2,570** rows, skipped all 22,142 existing (`INSERT
  IGNORE` idempotency confirmed live);
- new rows span **2026-06-14T09:45:00Z → 2026-07-11T04:15:00Z**, contiguous
  with the previous max (next 15m slot), all `upload_status='pending'`.
  One interior 15m slot is absent (2026-06-17T20:15Z — the inclusive grid
  holds 2,571 slots for 2,570 rows; presumably unresolved/missing at the
  vendor; found by the U64b verifier);
- **eligible universe unchanged** — `tools/universe.ts` re-run: 18,635, same
  first/last markets. Eligibility joins `done` conversions, so a catalog sync
  cannot fake dataset growth, touch any frozen scan universe, or move the
  holdout boundary.

Safety argument for why sync is lab-runnable (verified in source,
`src/telonex/sync-markets.ts`): single write path is `INSERT IGNORE` into
`telonex_markets`; finalized-only filter (`status='resolved' AND result_id <>
''`) makes rows immutable-by-design; `--dry-run` verified to write nothing;
no R2 access; new rows only mark markets claimable for a FUTURE
`download-raw-files` run — nothing auto-triggers (fleet workers run backtests
only).

`tools/universe.ts` now prints a `CATALOG AWAITING INGESTION` line (currently
2,570) so wake-up check 1 sees ingestion lag without any extra command. The
line reflects the LOCAL catalog; vendor-side freshness needs the read-only
dry-run probe.

## What the lab will NOT do without operator sign-off (D38)

`npm run telonex:download` + `npm run telonex:convert` for the 2,570 pending
markets. Capability exists on this machine (TELONEX_API_KEY + R2 write creds
are in `.env`), but:

- ~**25 GB** of vendor download (2,570 × 9.75 MB) against the operator's
  Telonex API key — metering/contract terms unknown to the lab;
  (disclosed asymmetry, U64b: the sync itself also spends the metered key —
  ~1 GB catalog fetch per run, dry or real. The D38 split survives at
  1 GB vs 25 GB, but sync re-runs are therefore deliberate, not gratuitous:
  only when the awaiting-max is well behind today AND a decision depends
  on current numbers);
- ~25 GB written to the operator's R2 bucket (+ ~3.9 GB converted);
- the operator actively operates this pipeline (fanout scripts, last sync
  2026-06-14) — concurrent lab runs would share the claim queue safely by
  design, but the spend decision is theirs.

## Operator: to ingest the pending window

```bash
npm run telonex:download            # picks up the 2,570 pending btc-15m rows
npm run telonex:convert             # delta-typed conversion (or the fanout scripts)
```

Then the lab's `tools/universe.ts` will show the eligible universe grown and
wake-up check 1 takes over (venue-drift refresh procedure).

## Payoff schedule (why ingest)

- **Immediately at +2,570 eligible markets**: the venue-drift refresh horizon
  (~1 month past 2026-06-14) is met — the lab runs the VENUE-DRIFT refresh on
  2026-06/07; a D27-confirmed band fire reopens the mechanism-linked
  EDGE-SPACE §4 clause.
- **At ~+9,500 new markets past the holdout boundary window** (≈ 3.3 months
  at ~96/day; ~7,000 more after this window, ≈ late September 2026
  (~Sept 21: 6,970 / 96 per day ≈ 73 days from 2026-07-11) if synced
  and ingested continuously): IDEAS #10 (the E22 reversal-mirror candidate,
  +2.38c at z=+2.40) reaches its pre-registered ~15,000-market unlock
  (~55% power at a true +2c; see the U45-amended IDEAS #10 entry for the
  binding se convention).
- Side fact for the operator: 3,507 fully-ingested markets sit below the
  2025-11-30 eligibility floor (back to 2025-10-11T00:00Z). Moving
  `TELONEX_DATASET_ELIGIBLE_FROM` would add them at zero ingestion cost —
  but Telonex documents possible gaps before 2026-01-19, and the lab's
  frozen universes/scans all cite the current floor, so this is the
  operator's call and no lab artifact assumes it.
