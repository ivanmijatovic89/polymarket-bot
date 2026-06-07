-- Concurrency guard for `--extend <runId>`.
--
-- Set in the same statement that updates batch_uid / cmd at the start of an
-- extension flow; cleared in the same DB transaction as the merge UPDATE.
-- While non-NULL, a second concurrent `--extend` on the same run is rejected
-- with a clear error message.
--
-- Nullable + no default — fresh rows have it NULL by definition.

ALTER TABLE `backtest_runs`
  ADD COLUMN `extending_at` timestamp NULL;
