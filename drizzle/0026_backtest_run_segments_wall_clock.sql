-- Add wall-clock duration to `backtest_run_segments`.
--
-- `duration_wall_clock_ms` = real elapsed span of the segment's markets
-- (max finished − min started). For the `all` segment this is the run's true
-- wall-clock, matching the detail page's Execution "Wall-clock" figure. It
-- includes idle gaps for `--extend` runs (markets processed in disjoint
-- windows), so it can exceed `duration_total_ms` (summed CPU time).
--
-- Nullable: existing rows stay NULL until backfilled with
-- `npm run backfill:segment-durations` (which now also fills this column;
-- re-run it after this migration). New runs + `--extend` populate it
-- automatically via computeBatchStats.

ALTER TABLE `backtest_run_segments` ADD COLUMN `duration_wall_clock_ms` bigint;
