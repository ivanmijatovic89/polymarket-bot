CREATE TABLE `pmxt_slug_cache` (
	`slug` varchar(100) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`condition_id` varchar(66) NOT NULL,
	`token_ids` json NOT NULL,
	`window_start` datetime NOT NULL,
	`resolved_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pmxt_slug_cache_slug` PRIMARY KEY(`slug`)
);
--> statement-breakpoint
CREATE INDEX `idx_pmxt_slug_cache_symbol_window` ON `pmxt_slug_cache` (`symbol`, `window_start`);
--> statement-breakpoint
ALTER TABLE `pmxt_dataset_catalogue` MODIFY COLUMN `status` enum('pending','downloading','converting','done','master_done','failed') NOT NULL DEFAULT 'pending';
