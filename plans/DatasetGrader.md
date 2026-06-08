# Feature Plan — Telonex Market Data-Quality Scanner (Dataset Grader)

> Status: **planning** — schema columns and grader rules still need final agreement
> (see [Open items](#open-items--still-to-finalize)).
> Scope (v1): `btc-updown-15m`, `book_snapshot_full` channel only.

## 1. Goal

Around 19k Telonex `btc-updown-15m` markets have been downloaded. Many of them have
incomplete or corrupt raw data. Running a backtest on a bad market produces a
**wrong result** — the single thing this feature exists to prevent.

This feature delivers a way to **mark every market as `usable` or `unusable`**,
persisted in the database, so the backtest can filter bad markets out before it
selects which markets to run.

Two pieces:

- **Scanner** — reads each market's raw Telonex data, measures quality metrics,
  stores them. Expensive (downloads from R2), resumable.
- **Grader** — turns stored metrics into a `usable`/`unusable` verdict using a
  flat checklist of rules. Cheap, instant, re-runnable.

Wiring the verdict into backtest market selection is **out of scope** — a
separate follow-up task.

## 2. Design decisions (settled)

These were resolved during planning and are not up for re-discussion:

- **One new table**, one row per market. No `tier` column.
- **Two commands**: `scan-quality` (measure) and `grade-quality` (verdict).
- **Measure first.** The scanner stores raw metrics with `verdict = NULL`.
  Thresholds are chosen _after_ inspecting the real metric distribution, then
  the grader is run. No threshold guessing up front.
- **Binary verdict** — `usable` / `unusable`. No three-tier grade.
- **Grader = a flat checklist of named one-line rules.** If any rule fires the
  market is `unusable`. No weighted scoring formula — that would be unreadable
  later. `verdict_reason` records exactly which rule(s) fired.
- **Worst-of-both** — a market is `unusable` if _either_ the Up or Down side
  fails. The two raw files are merge-sorted into one market timeline; metrics
  are per-market, not per-side (except the raw row counts, kept as an
  asymmetry check).
- **Eligible markets**: `telonex_markets.upload_status = 'done'` only.
  `pending` / `processing` / `partial` / `failed` markets are skipped — they
  get a quality row only once they reach `done`.
- **Run model**: resumable worker, same pattern as `download-raw-files.ts` and
  `convert.ts` — claim rows with `FOR UPDATE SKIP LOCKED`, `--concurrency`,
  graceful shutdown, restart resumes.
- **Window**: `[startDateUs, startDateUs + 900_000_000)` microseconds, using
  `telonex_markets.start_date_us`. (15 minutes.)
- **Source dataset**: the **raw** Telonex parquets (one analysis is valid for
  every converter), not the converted output.

## 3. Why these metrics — the reasoning

A backtest replays the orderbook and a strategy trades against it across the
full 15 minutes. It produces a wrong result in these ways:

| Failure mode                    | Why it ruins a backtest                                                                  | Signal that detects it  |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| A side is dead/thin             | Paired/delta reconstruction needs both books                                             | `up_rows`, `down_rows`  |
| Part of the window is blank     | Strategy trades a minute against no data                                                 | per-minute event counts |
| One long mid-window stall       | Book frozen → backtest thinks price held still                                           | `max_gap_ms`            |
| Choppy feed (many medium gaps)  | Stale prices between every update                                                        | `gaps_over_5s`          |
| Frozen book                     | Telonex emits _unchanged_ rows, so a dead feed has no gap — rows keep arriving identical | `max_stale_ms`          |
| Up+Down not summing to ~1.0     | Stale/wrong data on one side → backtest invents fake arbitrage profit                    | `sum_dev_*`             |
| Books too thin to even validate | No two-sided book → no tradeable price                                                   | `sum_dev_samples`       |

The **sum-to-one** check is the most important one for binary markets: Up and
Down are complementary (`price(Up) + price(Down) ≈ 1.00`). It catches _wrong_
data (not just _absent_ data), and — usefully — it does **not** false-positive
on the legitimate end-game (near window end Up→0.99 / Down→0.01 still sum to
~1.0). That is why no per-minute integrity arrays or degenerate-book rules are
needed: the sum-to-one check makes them redundant.

The **frozen-book** detection rests on real code evidence: the delta converter's
`hasChanges` check (`src/telonex/verify-conversion.ts`) filters out no-change
rows, which proves Telonex emits consecutive identical snapshots. So a frozen
feed will _not_ show up as a `max_gap_ms` — `max_stale_ms` is needed.

> Note: whether `choppy` and `frozen` markets actually exist in this dataset is
> **not yet verified**. The measure-first calibration run (Step 4) confirms it.
> If those failure modes don't appear, rules 4 and 5 are dropped.

## 4. Implementation

### Step 1 — Drizzle schema + migration

Add `telonexMarketQuality` to `src/db/schema.ts`. One row per market.

| Column            | Type                                          | Notes                                                |
| ----------------- | --------------------------------------------- | ---------------------------------------------------- |
| `id`              | bigint PK autoinc                             |                                                      |
| `market_id`       | bigint, **unique**                            | → `telonex_markets.id`                               |
| `slug`            | varchar(100)                                  | convenience                                          |
| `status`          | enum(`pending`,`in_progress`,`done`,`failed`) | worker state                                         |
| `verdict`         | enum(`usable`,`unusable`) **nullable**        | written by grader only                               |
| `verdict_reason`  | varchar(255) nullable                         | comma-list of fired rules                            |
| `up_rows`         | int                                           | Up-side raw rows in window                           |
| `down_rows`       | int                                           | Down-side raw rows in window                         |
| `events`          | int                                           | distinct timestamps in window                        |
| `first_event_ms`  | bigint nullable                               | diagnostic                                           |
| `last_event_ms`   | bigint nullable                               | diagnostic                                           |
| `minute_counts`   | json (`number[]`, 15)                         | events per 1-minute bucket                           |
| `blank_minutes`   | int                                           | derived from `minute_counts`                         |
| `max_gap_ms`      | int                                           | largest gap between consecutive events               |
| `gaps_over_5s`    | int                                           | choppiness signal                                    |
| `max_stale_ms`    | int                                           | longest span the merged book did not change          |
| `sum_dev_max`     | int                                           | max abs(Up_mid + Down_mid − 1.0), in ten-thousandths |
| `sum_dev_samples` | int                                           | events where both sides had a two-sided book         |
| `attempts`        | int default 0                                 |                                                      |
| `last_error`      | text nullable                                 |                                                      |
| `scanned_at`      | timestamp nullable                            |                                                      |
| `graded_at`       | timestamp nullable                            |                                                      |

Indexes: unique on `market_id`, plain index on `status`.

Run `npm run db:generate` → review SQL in `drizzle/` → `npm run db:migrate`.

> The exact column list is **not final** — see [Open items](#open-items--still-to-finalize).

### Step 2 — Scanner: `src/telonex/data-quality/scan-quality.ts`

`npm run telonex:scan-quality` — resumable worker, same shape as
`download-raw-files.ts` / `convert.ts`.

1. **Claim** a market: `SELECT ... FROM telonex_markets m WHERE
m.upload_status='done' AND NOT EXISTS (a done quality row for m.id)
FOR UPDATE SKIP LOCKED LIMIT 1`. Upsert its quality row to
   `status='in_progress'`, `attempts = attempts + 1`.
2. **Missing-side short-circuit**: read `telonex_market_files` for the slug
   (`status='uploaded'`). If a side has zero uploaded files → write
   `up_rows`/`down_rows` with the missing side `= 0`, timeline metrics `NULL`,
   `status='done'`. No download. (The grader's `dead_side` rule handles it.)
3. **Both sides present**: download both raw parquets from R2 to a temp dir
   (`getObjectToFile`, `getDefaultBucket` from `src/r2/client.ts`), merge-sort
   rows by `timestamp_us` (DuckDB, same approach as
   `src/telonex/converters/parsing.ts`), filter to the 900s window, and in a
   single pass compute every metric: row counts, distinct events, minute
   buckets, gaps, `max_stale_ms` (consecutive-snapshot diff), `sum_dev_*` (at
   each event compute `mid(Up) + mid(Down)`, track max deviation and the
   sample count).
4. Write all metrics, `status='done'`, `scanned_at=NOW()`, `verdict=NULL`.
   Delete temp files.
5. On error → `status='failed'`, `last_error=...`.

**CLI flags**: `--concurrency` (default 4), `--limit`, `--slug <slug>` (force a
single market), `--rescan` (re-do all, ignoring existing `done` rows).

**Graceful shutdown**: single `AbortController`, on SIGINT/SIGTERM abort
in-flight HTTP, revert `in_progress` quality rows → `pending`, close DB,
`process.exit(0)`. Second signal → `process.exit(1)`.

### Step 3 — Grader: `src/telonex/data-quality/grade-quality.ts`

`npm run telonex:grade-quality` — cheap, reads/writes `telonex_market_quality`
only, no R2, instant, re-runnable on every threshold change.

- Threshold constants live in **one file**:
  `src/telonex/data-quality/quality-thresholds.ts`.
  That is the only file edited after calibration.
- Grading is a pure function `(metricsRow, thresholds) → { verdict, reason }`,
  a flat checklist:

```
unusable IF any of:
  1. dead_side       up_rows < MIN_ROWS  OR  down_rows < MIN_ROWS
  2. blank_coverage  blank_minutes > MAX_BLANK
  3. long_gap        max_gap_ms > MAX_GAP
  4. choppy          gaps_over_5s > MAX_CHOPPY
  5. frozen          max_stale_ms > MAX_STALE
  6. sum_off         sum_dev_max > MAX_SUM_DEV
  7. unverifiable    sum_dev_samples < MIN_SAMPLES
else usable
```

Any rule fires → `verdict='unusable'`, `verdict_reason` = comma-list of fired
rule names. None fire → `verdict='usable'`. Always set `graded_at=NOW()`.

**CLI flags**: `--slug`, `--limit`, and `--stats` (print the metric
distribution across all scanned rows — used for calibration, see Step 4).

> The rule set is **not final** — see [Open items](#open-items--still-to-finalize).

### Step 4 — Calibration (manual, one-off)

Between building the grader and trusting it:

1. Run the scanner over all `done` markets.
2. Run `grade-quality --stats` (or SQL) to see the real distribution of every
   metric.
3. Pick the 7 threshold numbers from that distribution and write them into
   `src/telonex/data-quality/quality-thresholds.ts`.
4. Confirm `choppy` / `frozen` failure modes actually exist — drop rules 4/5 if
   they don't.
5. Run `grade-quality`.

### Step 5 — Docs & wiring

- **`package.json`**: add scripts `telonex:scan-quality` and
  `telonex:grade-quality`.
- **(a) Update the design doc**: keep
  `docs/datasets/telonex/sync-design.md` current and update its internal links
  / any references to it elsewhere afterwards.
- **(b) Update existing telonex docs pages**: refresh
  `docs/datasets/telonex/` pages (`overview.md`, `diagnostics.md`, etc.)
  to mention the new quality scanner where relevant, and add the new pages to
  the VitePress sidebar in `docs/.vitepress`.
- **(c) New feature doc**: create one new file under
  `docs/datasets/telonex/` (e.g. `data-quality.md`) explaining this whole
  feature — the table, the scanner, the grader, the calibration workflow, and
  how to read a `verdict` / `verdict_reason`.
- CI (`quality.yml`) must pass: Prettier + Typecheck + ESLint + WebUI + Docs
  build.

## 5. Build order

1. **Schema + migration** (Step 1) — small, verify with `db:studio`.
2. **Scanner** (Step 2) — test with `--slug` on one market, then `--limit 5`,
   then a full run.
3. **Grader** (Step 3) — built against scanned data.
4. **Calibrate** (Step 4).
5. **Docs** (Step 5).

## 6. File summary

| Path                                             | Action                           |
| ------------------------------------------------ | -------------------------------- |
| `src/db/schema.ts`                               | add `telonexMarketQuality` table |
| `drizzle/`                                       | generated migration SQL          |
| `src/telonex/data-quality/scan-quality.ts`       | new — scanner worker             |
| `src/telonex/data-quality/grade-quality.ts`      | new — grader                     |
| `src/telonex/data-quality/quality-thresholds.ts` | new — threshold constants        |
| `package.json`                                   | add 2 scripts                    |
| `docs/datasets/telonex/sync-design.md`           | update existing design doc       |
| `docs/datasets/telonex/data-quality.md`          | new — feature doc                |
| `docs/datasets/telonex/*`                        | update existing pages + sidebar  |

## Open items — still to finalize

These need a decision before Step 1 / Step 3 are implemented:

### A. Schema columns

The metric list above is the working draft. Still to agree:

- Is `events` (total distinct timestamps in the 15-min window) the right
  top-level count, alongside `up_rows` / `down_rows`?
- `minute_counts` already stores events per minute (15 buckets) — confirm this
  is the desired per-minute granularity, or whether more buckets / a different
  resolution is wanted.
- Any additional columns worth capturing now to avoid a re-scan later.

### B. Grader rules

The 7-rule checklist above is the working draft. Still to agree:

- Final rule set — keep all 7, or trim `choppy` / `frozen` pending calibration.
- Whether to add an 8th `thin_book` depth rule (requires the scanner to also
  measure book depth — **not** in the current metric list, so adding it later
  means a re-scan). Currently **deferred**.
- Exact semantics of each rule (e.g. `dead_side` floor, how `blank_coverage`
  treats leading vs trailing blank minutes).
