-- Replace `backtest_runs.chunked_batch_stats` JSON column with a normalized
-- `backtest_run_segments` table holding one row per (run, segment_kind,
-- segment_key). Segment kinds: all / last_n / daily / weekly / monthly.
-- See src/backtest/stats/backtestSegments.ts for the computation.
--
-- Also denormalizes market_start_ms onto backtest_run_markets so the segment
-- builder doesn't have to re-parse slugs or join telonex_markets at compute
-- time. Indexed (run_id, market_start_ms) for chronological scans.
--
-- Pre-deploy: tables truncated by the operator; no backfill needed.

ALTER TABLE `backtest_runs` DROP COLUMN `chunked_batch_stats`;
--> statement-breakpoint
ALTER TABLE `backtest_run_markets`
  ADD COLUMN `market_start_ms` bigint NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_markets_run_market_start_ms`
  ON `backtest_run_markets` (`run_id`, `market_start_ms`);
--> statement-breakpoint
CREATE TABLE `backtest_run_segments` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `run_id` bigint NOT NULL,
  `segment_kind` enum('all','last_n','daily','weekly','monthly') NOT NULL,
  `segment_key` varchar(32) NOT NULL,
  `segment_ord` bigint NOT NULL,
  `from_ms` bigint NOT NULL,
  `to_ms` bigint NOT NULL,
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
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `backtest_run_segments_id` PRIMARY KEY (`id`),
  CONSTRAINT `uniq_backtest_run_segments_run_kind_key` UNIQUE (`run_id`, `segment_kind`, `segment_key`)
);
--> statement-breakpoint
ALTER TABLE `backtest_run_segments`
  ADD CONSTRAINT `backtest_run_segments_run_id_backtest_runs_id_fk`
  FOREIGN KEY (`run_id`) REFERENCES `backtest_runs` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_segments_kind_key`
  ON `backtest_run_segments` (`segment_kind`, `segment_key`);
--> statement-breakpoint
CREATE INDEX `idx_backtest_run_segments_run_kind_ord`
  ON `backtest_run_segments` (`run_id`, `segment_kind`, `segment_ord`);
