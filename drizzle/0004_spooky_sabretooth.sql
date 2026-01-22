ALTER TABLE `backtests` MODIFY COLUMN `batch_uid` varchar(255);--> statement-breakpoint
ALTER TABLE `backtests` ADD `latest` boolean DEFAULT false NOT NULL;