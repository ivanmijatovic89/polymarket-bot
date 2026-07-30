ALTER TABLE `runtime_runs`
  MODIFY COLUMN `effort` enum('low','medium','high','xhigh','max','ultra','ultracode') NOT NULL;--> statement-breakpoint
ALTER TABLE `runtime_sessions`
  MODIFY COLUMN `effort` enum('low','medium','high','xhigh','max','ultra','ultracode') NOT NULL;
