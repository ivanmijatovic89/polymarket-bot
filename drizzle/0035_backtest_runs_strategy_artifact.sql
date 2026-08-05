ALTER TABLE `backtest_runs` ADD `strategy_artifact_sha256` varchar(64);
--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `strategy_artifact_meta` json;
