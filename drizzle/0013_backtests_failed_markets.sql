-- PR2: distributed BullMQ batches surface their failed children here.
-- NULL means: legacy (pre-BullMQ) run, no failure tracking available.
-- [] means: successful BullMQ run with no failures.
-- non-empty means: some markets exhausted retries; their {jobId, idx, slug, reason} land here.
ALTER TABLE `backtests` ADD COLUMN `failed_markets` JSON;
