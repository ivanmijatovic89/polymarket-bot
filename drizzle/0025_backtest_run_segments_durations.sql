-- Add per-segment backtest compute-cost columns to `backtest_run_segments`.
--
-- `duration_total_ms` = sum of per-market compute time (ms) over the markets in
-- the segment (total CPU time, not wall-clock — markets run in parallel across
-- workers). `duration_avg_ms` = mean over markets that recorded a duration.
--
-- Both nullable: rows written before these columns existed stay NULL until
-- backfilled with `npm run backfill:segment-durations` (targeted UPDATE that
-- leaves every other stat column untouched). New runs + `--extend` populate
-- them automatically via computeBatchStats.

ALTER TABLE `backtest_run_segments` ADD COLUMN `duration_total_ms` bigint;
--> statement-breakpoint
ALTER TABLE `backtest_run_segments` ADD COLUMN `duration_avg_ms` decimal(14,2);
