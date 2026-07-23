-- Record which research protocol and model launched each backtest.
-- Both columns are nullable so existing/manual runs remain valid; launchers
-- populate them for new protocol-owned runs.

ALTER TABLE `backtest_runs`
  ADD COLUMN `protocol` varchar(100) NULL AFTER `comment`,
  ADD COLUMN `model` varchar(255) NULL AFTER `protocol`;
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_protocol_model_created_at`
  ON `backtest_runs` (`protocol`, `model`, `created_at`);
