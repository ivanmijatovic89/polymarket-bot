-- Widen `backtest_runs.read_from` from varchar(16) to varchar(40).
--
-- The new telonex backtest mode `--read-from local-or-download-from-r2-to-local`
-- stores that 34-char value; it does not fit the previous varchar(16).

ALTER TABLE `backtest_runs` MODIFY COLUMN `read_from` varchar(40);
