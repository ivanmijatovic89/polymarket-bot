ALTER TABLE `backtest_runs` ADD COLUMN `recorder_v4_selection` json, ALGORITHM=INSTANT;
--> statement-breakpoint
ALTER TABLE `backtest_run_markets` ADD COLUMN `recorder_v4_capture` json, ALGORITHM=INSTANT;
