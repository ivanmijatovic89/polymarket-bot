ALTER TABLE `runtime_runs` ADD `machine_id` varchar(32) NOT NULL DEFAULT '8955f8d87c59';
--> statement-breakpoint
ALTER TABLE `runtime_runs` ALTER `machine_id` DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE `runtime_runs` ADD `sandbox_settings_path` varchar(1024);
--> statement-breakpoint
CREATE INDEX `idx_runtime_runs_machine_status` ON `runtime_runs` (`machine_id`,`status`);
