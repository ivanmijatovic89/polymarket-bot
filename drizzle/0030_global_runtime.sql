CREATE TABLE `runtime_runs` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `name` varchar(255) NOT NULL,
  `provider` enum('claude','codex') NOT NULL,
  `model` varchar(255) NOT NULL,
  `effort` enum('low','medium','high','xhigh','max','ultra') NOT NULL,
  `access_mode` enum('workspace-write','full-access') NOT NULL DEFAULT 'workspace-write',
  `auth_home` varchar(1024),
  `workspace_path` varchar(1024) NOT NULL,
  `mission_path` varchar(1024) NOT NULL,
  `max_sessions` int NOT NULL,
  `delay_seconds` int NOT NULL DEFAULT 20,
  `status_file` varchar(1024) NOT NULL,
  `journal_file` varchar(1024) NOT NULL,
  `inbox_file` varchar(1024) NOT NULL,
  `read_only_files` json NOT NULL,
  `status` enum('idle','running','pause_requested','paused','waiting','rate_limited','completed','stopped','error') NOT NULL DEFAULT 'idle',
  `current_session` int NOT NULL DEFAULT 0,
  `process_id` int,
  `heartbeat_at` timestamp,
  `last_activity_at` timestamp,
  `next_start_at` timestamp,
  `started_at` timestamp,
  `ended_at` timestamp,
  `last_error` text,
  `last_result_summary` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `runtime_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_status` ON `runtime_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_updated_at` ON `runtime_runs` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `runtime_sessions` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `run_id` bigint NOT NULL,
  `session_number` int NOT NULL,
  `provider` enum('claude','codex') NOT NULL,
  `model` varchar(255) NOT NULL,
  `effort` enum('low','medium','high','xhigh','max','ultra') NOT NULL,
  `status` enum('running','completed','waiting','rate_limited','stopped','failed','invalid_result') NOT NULL DEFAULT 'running',
  `process_id` int,
  `action` enum('continue','complete','wait'),
  `summary` text,
  `error` text,
  `exit_code` int,
  `exit_signal` varchar(32),
  `input_tokens` bigint,
  `cached_input_tokens` bigint,
  `output_tokens` bigint,
  `reasoning_output_tokens` bigint,
  `raw_log_path` varchar(1024) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT (now()),
  `heartbeat_at` timestamp,
  `last_activity_at` timestamp,
  `finished_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `runtime_sessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `runtime_sessions_run_id_runtime_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runtime_runs`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `uniq_runtime_sessions_run_session` UNIQUE(`run_id`,`session_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_sessions_run_started` ON `runtime_sessions` (`run_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_runtime_sessions_status` ON `runtime_sessions` (`status`);
