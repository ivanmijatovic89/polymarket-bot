-- Move computed run-level backtest stats out of `backtest_runs`.
--
-- `backtest_runs` now keeps run metadata/lifecycle/audit fields plus
-- `capital_initial` as run configuration. Computed stats are read from the
-- `backtest_run_segments` row where segment_kind='all' and segment_key='all'.
--
-- Pre-deploy check:
-- SELECT r.id
-- FROM backtest_runs r
-- LEFT JOIN backtest_run_segments s
--   ON s.run_id = r.id
--  AND s.segment_kind = 'all'
--  AND s.segment_key = 'all'
-- WHERE s.id IS NULL
--   AND r.markets_persisted > 0;

ALTER TABLE `backtest_runs` DROP INDEX `idx_backtest_runs_pnl_total`;
--> statement-breakpoint
ALTER TABLE `backtest_runs`
  DROP COLUMN `capital_final`,
  DROP COLUMN `pnl_total`,
  DROP COLUMN `total_fees_paid`,
  DROP COLUMN `quality_system`,
  DROP COLUMN `quality_trade`,
  DROP COLUMN `ev_per_market_played`,
  DROP COLUMN `ev_per_market_total`,
  DROP COLUMN `markets_total`,
  DROP COLUMN `markets_skipped`,
  DROP COLUMN `markets_no_in_window_activity`,
  DROP COLUMN `markets_flat_with_trades`,
  DROP COLUMN `markets_played`,
  DROP COLUMN `markets_won`,
  DROP COLUMN `markets_lost`,
  DROP COLUMN `win_rate`,
  DROP COLUMN `win_rate_pct`,
  DROP COLUMN `trades_total`,
  DROP COLUMN `trades_maker`,
  DROP COLUMN `trades_taker`,
  DROP COLUMN `pnl_avg_win`,
  DROP COLUMN `pnl_avg_lose`,
  DROP COLUMN `pnl_max_win`,
  DROP COLUMN `pnl_max_lose`,
  DROP COLUMN `streak_max_win`,
  DROP COLUMN `streak_max_lose`,
  DROP COLUMN `streak_max_win_pnl`,
  DROP COLUMN `streak_max_lose_pnl`,
  DROP COLUMN `streak_max_skipped`;
