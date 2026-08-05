CREATE TABLE `strategy_artifacts` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `strategy_id` varchar(255) NOT NULL,
  `entrypoint` varchar(500) NOT NULL,
  `source_repo` varchar(500) NOT NULL,
  `source_commit` varchar(40) NOT NULL,
  `source_dirty` boolean NOT NULL DEFAULT false,
  `engine_commit` varchar(40) NOT NULL,
  `format_version` int NOT NULL,
  `built_with` json,
  `r2_url` varchar(500) NOT NULL,
  `size_bytes` bigint NOT NULL,
  `etag` varchar(64),
  `built_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `strategy_artifacts_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_strategy_artifacts_sha256` UNIQUE(`sha256`)
);
--> statement-breakpoint
CREATE INDEX `idx_strategy_artifacts_strategy` ON `strategy_artifacts` (`strategy_id`);
