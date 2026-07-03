-- Concurrency guard for `--extend <runId>`.
--
-- Set when an extension flow is enqueued; cleared in the same DB transaction
-- as the merge UPDATE. The parent batch_uid label is not changed by extends.
-- While non-NULL, a second concurrent `--extend` on the same run is rejected
-- with a clear error message.
--
-- Nullable + no default — fresh rows have it NULL by definition.

ALTER TABLE `backtest_runs`
  ADD COLUMN `extending_at` timestamp NULL;
