-- Composite index to support the telonex download claim's candidate read.
--
-- The claim selects the next claimable markets with
--   WHERE upload_status IN ('pending','partial') ... ORDER BY market_start_ms
-- The pre-existing single-column `idx_telonex_markets_upload_status` cannot
-- satisfy the ORDER BY, so the query fell back to a full table scan + filesort.
-- Combined with the former `FOR UPDATE SKIP LOCKED` claim that locked every
-- scanned row, one fan-out worker would lock the whole pending queue and peers
-- got empty claims and quit early. This composite lets the engine walk
-- claimable rows in market_start_ms order without a filesort.

CREATE INDEX `idx_telonex_markets_upload_status_start`
  ON `telonex_markets` (`upload_status`, `market_start_ms`);
