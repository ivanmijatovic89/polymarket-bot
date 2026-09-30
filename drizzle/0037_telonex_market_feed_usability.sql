-- Each producer checker owns one nullable result for the market's own feed.
-- NULL = not checked; 1 = usable; 0 = unusable under the fixed 10-second gap rule.
-- Explicit INSTANT prevents a fallback to copying the market catalog.
ALTER TABLE `telonex_markets`
  ADD COLUMN `binance_usable` boolean,
  ADD COLUMN `chainlink_usable` boolean,
  ALGORITHM=INSTANT;
