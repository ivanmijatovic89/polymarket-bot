-- Replace per-process `worker_name` with stable per-machine `machine_id`.
-- The previous identifier embedded the OS pid and was overridable via a CLI
-- flag, which fragmented the dataset across runs. `machine_id` is now derived
-- from the hardware UUID via `node-machine-id` and is stable across reboots,
-- network changes, and parallel processes on the same box.
--
-- Tables are truncated by the operator before this migration runs — no
-- backfill mapping is provided.

ALTER TABLE `backtest_run_markets`
  DROP COLUMN `worker_name`;
--> statement-breakpoint

ALTER TABLE `backtest_run_markets`
  ADD COLUMN `machine_id` varchar(32);
--> statement-breakpoint

CREATE INDEX `idx_backtest_run_markets_machine_id`
  ON `backtest_run_markets` (`machine_id`);
