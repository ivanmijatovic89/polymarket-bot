CREATE TABLE `telonex_markets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`exchange` varchar(20) NOT NULL,
	`market_id` varchar(66) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`event_id` varchar(100),
	`event_slug` varchar(100),
	`event_title` varchar(255),
	`question` text,
	`description` text,
	`category` varchar(100),
	`tags` json,
	`outcome_0` varchar(20),
	`outcome_1` varchar(20),
	`asset_id_0` varchar(80),
	`asset_id_1` varchar(80),
	`telonex_status` varchar(20),
	`result_id` varchar(10),
	`settled_at_us` bigint,
	`prepared_at_us` bigint,
	`start_date_us` bigint,
	`end_date_us` bigint,
	`created_at_us` bigint,
	`resolution_source` varchar(255),
	`rules_url` varchar(255),
	`trades_from` date,
	`trades_to` date,
	`quotes_from` date,
	`quotes_to` date,
	`book_snapshot_5_from` date,
	`book_snapshot_5_to` date,
	`book_snapshot_25_from` date,
	`book_snapshot_25_to` date,
	`book_snapshot_full_from` date,
	`book_snapshot_full_to` date,
	`onchain_fills_from` date,
	`onchain_fills_to` date,
	`upload_status` enum('pending','processing','done','partial','failed') NOT NULL DEFAULT 'pending',
	`files_uploaded` int NOT NULL DEFAULT 0,
	`last_error` text,
	`synced_at` timestamp NOT NULL DEFAULT (now()),
	`processed_at` timestamp,
	CONSTRAINT `telonex_markets_id` PRIMARY KEY(`id`),
	CONSTRAINT `telonex_markets_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `idx_telonex_markets_upload_status` ON `telonex_markets` (`upload_status`);
--> statement-breakpoint
CREATE TABLE `telonex_market_files` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`slug` varchar(100) NOT NULL,
	`channel` varchar(40) NOT NULL,
	`date` date NOT NULL,
	`asset_id` varchar(80) NOT NULL,
	`r2_key` varchar(255) NOT NULL,
	`r2_etag` varchar(64),
	`size_bytes` bigint,
	`status` enum('uploaded','no_file','failed') NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`started_at` timestamp,
	`uploaded_at` timestamp,
	CONSTRAINT `telonex_market_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_telonex_market_files` UNIQUE(`slug`,`channel`,`date`,`asset_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_telonex_market_files_slug` ON `telonex_market_files` (`slug`);
--> statement-breakpoint
CREATE TABLE `telonex_market_conversions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`market_id` bigint NOT NULL,
	`converter` varchar(40) NOT NULL,
	`status` enum('pending','in_progress','done','failed') NOT NULL DEFAULT 'pending',
	`r2_url` varchar(255),
	`local_path` varchar(255),
	`size_bytes` bigint,
	`etag` varchar(64),
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`started_at` timestamp,
	`completed_at` timestamp,
	CONSTRAINT `telonex_market_conversions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_telonex_market_conversions` UNIQUE(`market_id`,`converter`)
);
--> statement-breakpoint
CREATE INDEX `idx_telonex_market_conversions_market` ON `telonex_market_conversions` (`market_id`);
