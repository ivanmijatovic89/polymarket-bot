CREATE TABLE `backtests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`strategy` varchar(255) NOT NULL,
	`params` json NOT NULL,
	`symbol` varchar(10),
	`limit` int,
	`batch_stats` json NOT NULL,
	`market_stats` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backtests_id` PRIMARY KEY(`id`)
);
