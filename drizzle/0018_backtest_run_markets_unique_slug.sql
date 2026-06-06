-- Replace the non-unique (run_id, slug) index with a UNIQUE constraint on
-- `backtest_run_markets`. Schema-level guarantee that no slug is inserted
-- twice for the same run.
--
-- Motivation: `--extend` aggregate is not exactly-once at the queue layer.
-- BullMQ's stalled-job recovery (independent of `attempts`) can re-run an
-- aggregate that already committed its merge transaction. Without this
-- constraint, the second run silently appends the same markets at fresh
-- `idx` values, corrupting `batch_stats` / `chunked_batch_stats`.
-- `applyExtensionToRun` also performs an in-transaction overlap check and
-- no-ops on full duplicate; this constraint is the schema backstop.
--
-- Pre-deploy check: `SELECT run_id, slug, COUNT(*) FROM backtest_run_markets
-- GROUP BY run_id, slug HAVING COUNT(*) > 1` returned zero rows (verified
-- 2026-06-06), so the constraint can be added without cleanup.

DROP INDEX `idx_backtest_run_markets_run_slug` ON `backtest_run_markets`;
--> statement-breakpoint
ALTER TABLE `backtest_run_markets`
  ADD CONSTRAINT `uq_backtest_run_markets_run_slug` UNIQUE (`run_id`, `slug`);
