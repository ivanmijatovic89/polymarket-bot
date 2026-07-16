-- Covering index for the per-wallet stats aggregation (refreshWalletStats):
--   SELECT wallet, COUNT(*), COUNT(DISTINCT market_id), MIN(ts_ms), MAX(ts_ms)
--   FROM polymarket_trades GROUP BY wallet
--
-- The COUNT(DISTINCT market_id) previously forced a full-table scan (~128s on
-- 6M rows). With (wallet, market_id, ts_ms) the whole aggregation is index-only
-- (EXPLAIN → "Using index"), dropping it to ~3s. That refresh runs once at the
-- start of sync-activity, so this keeps a recurring sync fast.

CREATE INDEX `idx_polymarket_trades_wallet_market_ts` ON `polymarket_trades` (`wallet`,`market_id`,`ts_ms`);
