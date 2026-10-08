CREATE TABLE `recorder_v4_catalog_syncs` (
	`id` varchar(64) NOT NULL,
	`bucket` varchar(63) NOT NULL,
	`archive_prefix` varchar(200) NOT NULL,
	`initialized_at_ms` bigint,
	`last_completed_at_ms` bigint,
	`status` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recorder_v4_catalog_syncs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recorder_v4_recordings` (
	`id` varchar(64) NOT NULL,
	`bucket` varchar(63) NOT NULL,
	`archive_prefix` varchar(200) NOT NULL,
	`manifest_key` text NOT NULL,
	`manifest_sha256` varchar(64) NOT NULL,
	`manifest` json NOT NULL,
	`recording_id` varchar(200) NOT NULL,
	`slug` varchar(200) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`timeframe` varchar(16) NOT NULL,
	`start_ms` bigint NOT NULL,
	`end_ms` bigint NOT NULL,
	`events_key` text NOT NULL,
	`events_sha256` varchar(64) NOT NULL,
	`events_bytes` bigint NOT NULL,
	`events_rows` bigint NOT NULL,
	`complete` boolean NOT NULL,
	`missing_initial_book` boolean NOT NULL,
	`polymarket_complete` boolean NOT NULL,
	`binance_agg_trade_complete` boolean NOT NULL,
	`binance_book_ticker_complete` boolean NOT NULL,
	`chainlink_spot_complete` boolean NOT NULL,
	`chainlink_twap_complete` boolean NOT NULL,
	`website_ptb_complete` boolean NOT NULL,
	`website_ptb_observed` boolean NOT NULL,
	`opening_twap_available` boolean NOT NULL,
	`reference_evidence` json NOT NULL,
	`latest_resolution` json,
	`outcome` varchar(4),
	`resolution_observed_at_ms` bigint,
	`resolution_keys_sha256` varchar(64) NOT NULL,
	`verified_at_ms` bigint NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recorder_v4_recordings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_recorder_v4_scope_start` ON `recorder_v4_recordings` (`bucket`,`archive_prefix`,`start_ms`);--> statement-breakpoint
CREATE INDEX `idx_recorder_v4_scope_tf_start` ON `recorder_v4_recordings` (`bucket`,`archive_prefix`,`timeframe`,`start_ms`);--> statement-breakpoint
CREATE INDEX `idx_recorder_v4_slug` ON `recorder_v4_recordings` (`slug`);