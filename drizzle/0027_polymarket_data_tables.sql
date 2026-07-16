-- polymarket-data sync pipeline — historical trades + activity for crypto
-- up/down markets, pulled from Polymarket's public APIs.
--
-- Five tables, fully independent of the telonex_* tables (own catalog, no
-- joins, no shared state):
--
--   polymarket_markets           catalog + per-market sync state (trades, positions)
--   polymarket_trades            one row per fill side (maker AND taker)
--   polymarket_market_positions  final per-wallet outcome per market
--   polymarket_wallets           discovered wallets + activity cursor
--   polymarket_activity          SPLIT / MERGE / REDEEM / … on our markets
--
-- See docs/datasets/polymarket-data/ for the design and the API limits that
-- shaped it.

CREATE TABLE `polymarket_markets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `condition_id` varchar(66) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `event_id` varchar(20),
  `series_id` varchar(20) NOT NULL,
  `symbol` varchar(10) NOT NULL,
  `timeframe` enum('5m','15m','1h','4h','1d') NOT NULL,
  `market_start_ms` bigint NOT NULL,
  `market_end_ms` bigint NOT NULL,
  `question` text,
  `outcomes` json,
  `resolved_outcome` varchar(10),
  `closed` boolean NOT NULL DEFAULT false,
  `volume_gamma` decimal(18,6),
  `liquidity_gamma` decimal(18,6),
  `asset_id_0` varchar(80),
  `asset_id_1` varchar(80),
  `raw_json` json,
  `trades_status` enum('pending','processing','done','partial','failed') NOT NULL DEFAULT 'pending',
  `trades_synced_at` timestamp,
  `trades_source` varchar(20),
  `trade_rows` int,
  `trade_wallets` int,
  `volume_traded` decimal(18,6),
  `trades_error` text,
  `positions_status` enum('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  `positions_synced_at` timestamp,
  `position_rows` int,
  `positions_error` text,
  `synced_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `polymarket_markets_id` PRIMARY KEY(`id`),
  CONSTRAINT `polymarket_markets_condition_id_unique` UNIQUE(`condition_id`),
  CONSTRAINT `polymarket_markets_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `idx_polymarket_markets_symbol_tf_start` ON `polymarket_markets` (`symbol`,`timeframe`,`market_start_ms`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_markets_trades_status_start` ON `polymarket_markets` (`trades_status`,`market_start_ms`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_markets_positions_status_start` ON `polymarket_markets` (`positions_status`,`market_start_ms`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_markets_start` ON `polymarket_markets` (`market_start_ms`);--> statement-breakpoint

CREATE TABLE `polymarket_trades` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `market_id` int NOT NULL,
  `wallet` varchar(42) NOT NULL,
  `side` enum('BUY','SELL') NOT NULL,
  `outcome_index` int,
  `asset` varchar(80) NOT NULL,
  `size` decimal(18,6) NOT NULL,
  `price` decimal(8,6) NOT NULL,
  `usdc_size` decimal(18,6) NOT NULL,
  `is_taker` boolean NOT NULL DEFAULT false,
  `ts_ms` bigint NOT NULL,
  `tx_hash` varchar(66) NOT NULL,
  CONSTRAINT `polymarket_trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `polymarket_trades` ADD CONSTRAINT `polymarket_trades_market_id_polymarket_markets_id_fk` FOREIGN KEY (`market_id`) REFERENCES `polymarket_markets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_polymarket_trades_market` ON `polymarket_trades` (`market_id`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_trades_wallet_ts` ON `polymarket_trades` (`wallet`,`ts_ms`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_trades_tx_hash` ON `polymarket_trades` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_trades_ts` ON `polymarket_trades` (`ts_ms`);--> statement-breakpoint

CREATE TABLE `polymarket_market_positions` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `market_id` int NOT NULL,
  `wallet` varchar(42) NOT NULL,
  `asset` varchar(80) NOT NULL,
  `outcome_index` int,
  `final_size` decimal(18,6),
  `avg_price` decimal(8,6),
  `total_bought` decimal(18,6),
  `realized_pnl` decimal(18,6),
  `cash_pnl` decimal(18,6),
  CONSTRAINT `polymarket_market_positions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_polymarket_market_positions` UNIQUE(`market_id`,`wallet`,`asset`)
);
--> statement-breakpoint
ALTER TABLE `polymarket_market_positions` ADD CONSTRAINT `polymarket_market_positions_market_id_polymarket_markets_id_fk` FOREIGN KEY (`market_id`) REFERENCES `polymarket_markets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_polymarket_market_positions_market` ON `polymarket_market_positions` (`market_id`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_market_positions_wallet` ON `polymarket_market_positions` (`wallet`);--> statement-breakpoint

CREATE TABLE `polymarket_wallets` (
  `wallet` varchar(42) NOT NULL,
  `name` varchar(100),
  `pseudonym` varchar(100),
  `trade_count` int NOT NULL DEFAULT 0,
  `markets_count` int NOT NULL DEFAULT 0,
  `first_trade_ms` bigint,
  `last_trade_ms` bigint,
  `activity_status` enum('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  `activity_cursor_ts` bigint,
  `activity_synced_at` timestamp,
  `activity_error` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `polymarket_wallets_wallet` PRIMARY KEY(`wallet`)
);
--> statement-breakpoint
CREATE INDEX `idx_polymarket_wallets_status_trade_count` ON `polymarket_wallets` (`activity_status`,`trade_count`);--> statement-breakpoint

CREATE TABLE `polymarket_activity` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `wallet` varchar(42) NOT NULL,
  `type` varchar(20) NOT NULL,
  `market_id` int,
  `condition_id` varchar(66) NOT NULL,
  `size` decimal(18,6),
  `usdc_size` decimal(18,6),
  `outcome_index` int,
  `ts_ms` bigint NOT NULL,
  `tx_hash` varchar(66),
  `dedup_key` varchar(40) NOT NULL,
  CONSTRAINT `polymarket_activity_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_polymarket_activity_dedup` UNIQUE(`dedup_key`)
);
--> statement-breakpoint
ALTER TABLE `polymarket_activity` ADD CONSTRAINT `polymarket_activity_market_id_polymarket_markets_id_fk` FOREIGN KEY (`market_id`) REFERENCES `polymarket_markets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_polymarket_activity_market_type` ON `polymarket_activity` (`market_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_polymarket_activity_wallet_ts` ON `polymarket_activity` (`wallet`,`ts_ms`);
