-- Index for the Gamma eventMetadata backfill queries
-- (`telonex:sync-pricetobeat-and-final-price`): the claim + preflight-count
-- predicates filter on `gamma_metadata_synced_at IS NULL` and range/order on
-- `market_start_ms`; no existing index leads with either column, so both
-- queries full-scanned the table (including forever after the backfill
-- drained, on every cron run).

CREATE INDEX `idx_telonex_markets_gamma_synced_start` ON `telonex_markets` (`gamma_metadata_synced_at`,`market_start_ms`);
