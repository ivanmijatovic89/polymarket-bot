-- Telonex coverage + centralization (PR#1)
--
-- Adds:
--   telonex_markets: symbol, timeframe, market_start_ms (derived from slug,
--                    indexed) + composite indexes for eligibility queries.
--   backtest_runs:  timeframe, input_mode, converter, read_from (optional;
--                   populated for telonex-mode runs so coverage queries can
--                   identify which eligible universe a run targeted).
--
-- Rationale:
-- - slug suffix is ground truth for market window start; we materialise it
--   into market_start_ms so queries don't parse the slug at runtime.
-- - start_date_us is NOT the market start (verified: 100% of 19,223 rows
--   differ, avg ~22h earlier). Do NOT use it for ordering/filtering by
--   market time.
-- - The composite (symbol, timeframe, market_start_ms) index matches the
--   eligibility filter shape exactly; (timeframe, market_start_ms) helps
--   the all-symbols variant.
--
-- Backfill is safe because all existing rows match `<sym>-updown-<tf>-<epoch>`
-- (verified by scripts/check-slug-formats.ts before authoring this migration).

-- 1) Add nullable columns so we can backfill before applying NOT NULL.
ALTER TABLE `telonex_markets`
  ADD COLUMN `symbol` varchar(10),
  ADD COLUMN `timeframe` varchar(16),
  ADD COLUMN `market_start_ms` bigint;
--> statement-breakpoint

-- 2) Backfill from slug. Slug shape `<symbol>-updown-<timeframe>-<epochSec>`.
UPDATE `telonex_markets`
SET
  `symbol` = SUBSTRING_INDEX(`slug`, '-', 1),
  `timeframe` = SUBSTRING_INDEX(SUBSTRING_INDEX(`slug`, '-', 3), '-', -1),
  `market_start_ms` = CAST(SUBSTRING_INDEX(`slug`, '-', -1) AS UNSIGNED) * 1000;
--> statement-breakpoint

-- 3) Lock in NOT NULL. Will fail loudly if any row didn't backfill.
ALTER TABLE `telonex_markets`
  MODIFY `symbol` varchar(10) NOT NULL,
  MODIFY `timeframe` varchar(16) NOT NULL,
  MODIFY `market_start_ms` bigint NOT NULL;
--> statement-breakpoint

-- 4) Indexes for eligibility queries.
CREATE INDEX `idx_telonex_markets_symbol_tf_start`
  ON `telonex_markets` (`symbol`, `timeframe`, `market_start_ms`);
--> statement-breakpoint

CREATE INDEX `idx_telonex_markets_tf_start`
  ON `telonex_markets` (`timeframe`, `market_start_ms`);
--> statement-breakpoint

-- 5) backtest_runs: optional metadata so coverage queries can early-return
--    for non-telonex runs and pick the right eligible universe. All nullable
--    on purpose — legacy rows stay legacy; new rows populate at insert time.
ALTER TABLE `backtest_runs`
  ADD COLUMN `timeframe` varchar(16),
  ADD COLUMN `input_mode` varchar(32),
  ADD COLUMN `converter` varchar(32),
  ADD COLUMN `read_from` varchar(16);
