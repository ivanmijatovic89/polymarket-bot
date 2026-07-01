-- Persist the forked market worker child id that processed each market.
--
-- `machine_id` already identifies the physical machine, so the unique worker
-- identity for a row is (`machine_id`, `worker_child_id`). NULL covers legacy
-- rows, sequential runs, and any path where the child id is unavailable.

ALTER TABLE `backtest_run_markets` ADD COLUMN `worker_child_id` int;
