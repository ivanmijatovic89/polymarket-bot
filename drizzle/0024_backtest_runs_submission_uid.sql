-- `batch_uid` becomes a non-unique group label; new `submission_uid` takes
-- over the unique per-submission identity.
--
-- `batch_uid` was doing two jobs at once: (a) unique correlation id for the
-- BullMQ flow of one submission, and (b) the human-facing name of a run.
-- That forced `--extend` to rewrite it with `-extN` suffixes and made it
-- impossible to group related runs (e.g. all cells of one param sweep) under
-- one label.
--
-- Split the roles:
--   - `submission_uid` (NEW, unique): internal auto-UUID, keys the BullMQ
--     flow job ids. Fresh on every submission, including extensions.
--   - `batch_uid` (kept, now non-unique + indexed): free-form group label.
--     Defaults to the submission uid when the CLI is run without --batchUid.
--
-- Backfill: existing rows get submission_uid = batch_uid (unique today by
-- the old constraint, so this satisfies the new unique constraint).

ALTER TABLE `backtest_runs` ADD COLUMN `submission_uid` varchar(255) NULL;
--> statement-breakpoint
UPDATE `backtest_runs` SET `submission_uid` = `batch_uid` WHERE `submission_uid` IS NULL;
--> statement-breakpoint
ALTER TABLE `backtest_runs` MODIFY COLUMN `submission_uid` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD CONSTRAINT `uniq_backtest_runs_submission_uid` UNIQUE(`submission_uid`);
--> statement-breakpoint
ALTER TABLE `backtest_runs` DROP INDEX `uniq_backtest_runs_batch_uid`;
--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD INDEX `idx_backtest_runs_batch_uid` (`batch_uid`);
