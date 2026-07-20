-- Gamma `events[].eventMetadata` columns on `telonex_markets`.
--
-- `price_to_beat` = the Chainlink open/strike price of the market window
--   (Gamma has it for markets from ~2026-02-19; NULL before — no backfill
--   upstream). `final_price` = the Chainlink settle price (~2026-03-21+).
-- `gamma_metadata_synced_at` records that a Gamma fetch was ATTEMPTED for the
--   row: a synced row with NULL prices means Gamma genuinely has no data, so
--   the backfill CLI (`telonex:backfill-markets-pricetobeat-and-final-price`)
--   never re-fetches it. Epoch boundaries: docs/datasets/data-coverage.md.
--
-- Nullable on purpose: telonex sync never touches these columns; only the
-- backfill CLI writes them.

ALTER TABLE `telonex_markets` ADD COLUMN `price_to_beat` double;--> statement-breakpoint
ALTER TABLE `telonex_markets` ADD COLUMN `final_price` double;--> statement-breakpoint
ALTER TABLE `telonex_markets` ADD COLUMN `gamma_metadata_synced_at` timestamp;
