-- Replace the old monolithic backtests table with normalized run, market,
-- and failure tables. Existing backtest rows are intentionally not migrated;
-- truncate/drop is acceptable for this research table.

DROP TABLE IF EXISTS `backtests`;
--> statement-breakpoint

CREATE TABLE `backtest_runs` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `batch_uid` varchar(255) NOT NULL,
  `status` enum('completed','partial','failed') NOT NULL,
  `strategy` varchar(255) NOT NULL,
  `params` json NOT NULL,
  `symbol` varchar(10),
  `slugs` json,
  `limit` int,
  `random` boolean NOT NULL DEFAULT false,
  `latest` boolean NOT NULL DEFAULT false,
  `baseline_id` varchar(255),
  `cmd` longtext,
  `comment` text,
  `input_markets_total` int,
  `markets_persisted` int NOT NULL DEFAULT 0,
  `failures_count` int NOT NULL DEFAULT 0,
  `capital_initial` decimal(14,4) NOT NULL,
  `capital_final` decimal(14,4) NOT NULL,
  `pnl_total` decimal(14,4) NOT NULL,
  `total_fees_paid` decimal(14,4) NOT NULL,
  `quality_system` decimal(14,6),
  `quality_trade` decimal(14,6),
  `ev_per_market_played` decimal(14,4) NOT NULL,
  `ev_per_market_total` decimal(14,4) NOT NULL,
  `markets_total` int NOT NULL,
  `markets_skipped` int NOT NULL,
  `markets_no_in_window_activity` int NOT NULL,
  `markets_flat_with_trades` int NOT NULL,
  `markets_played` int NOT NULL,
  `markets_won` int NOT NULL,
  `markets_lost` int NOT NULL,
  `win_rate` decimal(10,6) NOT NULL,
  `win_rate_pct` decimal(10,4) NOT NULL,
  `trades_total` int NOT NULL,
  `trades_maker` int NOT NULL,
  `trades_taker` int NOT NULL,
  `pnl_avg_win` decimal(14,4) NOT NULL,
  `pnl_avg_lose` decimal(14,4) NOT NULL,
  `pnl_max_win` decimal(14,4) NOT NULL,
  `pnl_max_lose` decimal(14,4) NOT NULL,
  `streak_max_win` int NOT NULL,
  `streak_max_lose` int NOT NULL,
  `streak_max_win_pnl` decimal(14,4) NOT NULL,
  `streak_max_lose_pnl` decimal(14,4) NOT NULL,
  `streak_max_skipped` int NOT NULL,
  `chunked_batch_stats` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `backtest_runs_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_backtest_runs_batch_uid` UNIQUE(`batch_uid`)
);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_created_at` ON `backtest_runs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_strategy_created_at` ON `backtest_runs` (`strategy`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_pnl_total` ON `backtest_runs` (`pnl_total`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_symbol_created_at` ON `backtest_runs` (`symbol`, `created_at`);
--> statement-breakpoint

CREATE TABLE `backtest_run_markets` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `run_id` bigint NOT NULL,
  `idx` int NOT NULL,
  `market_id` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `final_outcome` enum('UP','DOWN') NOT NULL,
  `skip_reason` enum('no_in_window_activity'),
  `pnl` decimal(14,4) NOT NULL,
  `trade_count` int NOT NULL,
  `trade_as_maker` int NOT NULL,
  `trade_as_taker` int NOT NULL,
  `fees_paid` decimal(14,4) NOT NULL,
  `avg_entry_price_up` decimal(10,6),
  `avg_entry_price_down` decimal(10,6),
  `up_shares` decimal(18,6) NOT NULL,
  `down_shares` decimal(18,6) NOT NULL,
  `mergable_shares` decimal(18,6) NOT NULL,
  `cost` decimal(14,4) NOT NULL,
  `split_cost` decimal(14,4) NOT NULL,
  `intent_meta` json NOT NULL,
  `worker_name` varchar(255),
  `started_at_ms` bigint,
  `finished_at_ms` bigint,
  `duration_ms` int,
  `events_processed` int,
  `events_by_type` json,
  `commit_sha` varchar(64),
  CONSTRAINT `backtest_run_markets_id` PRIMARY KEY(`id`),
  CONSTRAINT `backtest_run_markets_run_id_backtest_runs_id_fk`
    FOREIGN KEY (`run_id`) REFERENCES `backtest_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_backtest_run_markets_run_idx` ON `backtest_run_markets` (`run_id`, `idx`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_markets_run_slug` ON `backtest_run_markets` (`run_id`, `slug`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_markets_run_pnl` ON `backtest_run_markets` (`run_id`, `pnl`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_markets_slug` ON `backtest_run_markets` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_markets_run_duration` ON `backtest_run_markets` (`run_id`, `duration_ms`);
--> statement-breakpoint

CREATE TABLE `backtest_run_failures` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `run_id` bigint NOT NULL,
  `job_id` varchar(255),
  `idx` int,
  `slug` varchar(255),
  `reason` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `backtest_run_failures_id` PRIMARY KEY(`id`),
  CONSTRAINT `backtest_run_failures_run_id_backtest_runs_id_fk`
    FOREIGN KEY (`run_id`) REFERENCES `backtest_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_failures_run_idx` ON `backtest_run_failures` (`run_id`, `idx`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_failures_run_slug` ON `backtest_run_failures` (`run_id`, `slug`);
