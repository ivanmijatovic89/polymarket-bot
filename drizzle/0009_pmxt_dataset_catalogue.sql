CREATE TABLE `pmxt_dataset_catalogue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`version` varchar(4) NOT NULL,
	`filename` varchar(100) NOT NULL,
	`url` varchar(255) NOT NULL,
	`hour_ts` datetime NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`status` enum('pending','downloading','converting','done','failed') NOT NULL DEFAULT 'pending',
	`out_dir` varchar(255),
	`slugs` json,
	`windows_written` int,
	`source_size_mb` decimal(10,2),
	`error` text,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pmxt_dataset_catalogue_id` PRIMARY KEY(`id`),
	CONSTRAINT `pmxt_dataset_catalogue_filename_unique` UNIQUE(`filename`)
);
