-- Run alongside monthly-rankings.sql to quantify selection from wallet exclusions.
-- Counts describe observed data; incomplete months do not imply final populations.
-- Trade rows count participant occurrences, not unique matched executions.
WITH requested(month) AS (
    VALUES ('2026-06'), ('2026-07'), ('2026-08'), ('2026-09')
), calendar AS (
    SELECT month,
        96 * date_diff('day', CAST(month || '-01' AS DATE),
            CAST(month || '-01' AS DATE) + INTERVAL 1 MONTH) AS expected_windows
    FROM requested
), window_coverage AS (
    SELECT strftime(to_timestamp(market_start), '%Y-%m') AS month,
        count(*) FILTER (WHERE found) AS found_windows
    FROM coverage GROUP BY month
), population AS (
    SELECT month,
        count(*) AS observed_wallets,
        count(*) FILTER (WHERE incomplete_markets = 0) AS reconciled_wallets,
        count(*) FILTER (WHERE incomplete_markets > 0) AS excluded_wallets,
        sum(market_count) AS observed_wallet_markets,
        sum(incomplete_markets) AS unresolved_wallet_markets,
        sum(trade_count) AS observed_trade_rows,
        sum(trade_count) FILTER (WHERE incomplete_markets > 0) AS excluded_wallet_trade_rows
    FROM wallet_months GROUP BY month
), warnings AS (
    SELECT strftime(to_timestamp(market_start), '%Y-%m') AS month,
        count(*) FILTER (WHERE coalesce(len(source_warnings), 0) > 0) AS source_warning_markets
    FROM markets GROUP BY month
)
SELECT c.month, coalesce(v.found_windows, 0) AS found_windows, c.expected_windows,
    coalesce(v.found_windows, 0) = c.expected_windows AS cohort_complete,
    coalesce(p.observed_wallets, 0) AS observed_wallets,
    coalesce(p.reconciled_wallets, 0) AS reconciled_wallets,
    coalesce(p.excluded_wallets, 0) AS excluded_wallets,
    coalesce(p.observed_wallet_markets, 0) AS observed_wallet_markets,
    coalesce(p.unresolved_wallet_markets, 0) AS unresolved_wallet_markets,
    coalesce(p.observed_trade_rows, 0) AS observed_trade_rows,
    coalesce(p.excluded_wallet_trade_rows, 0) AS excluded_wallet_trade_rows,
    100.0 * coalesce(p.excluded_wallet_trade_rows, 0) /
        nullif(p.observed_trade_rows, 0) AS excluded_trade_rows_percent,
    coalesce(w.source_warning_markets, 0) AS source_warning_markets
FROM calendar c
LEFT JOIN window_coverage v USING (month)
LEFT JOIN population p USING (month)
LEFT JOIN warnings w USING (month)
ORDER BY c.month;
