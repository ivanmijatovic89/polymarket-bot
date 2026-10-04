-- Local-only top 20 eligible wallets per calendar month, with coverage counts.
-- Incomplete months retain a summary row with no wallet/rank/profit.
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
    SELECT month, count(*) AS observed_wallets,
        count(*) FILTER (WHERE incomplete_markets > 0) AS unresolved_wallets
    FROM wallet_months GROUP BY month
), ranked AS (
    SELECT *, row_number() OVER (
        PARTITION BY month ORDER BY economic_pnl_usdc DESC, wallet
    ) AS position
    FROM wallet_months
    WHERE cohort_complete AND incomplete_markets = 0
)
SELECT c.month, coalesce(v.found_windows, 0) AS found_windows, c.expected_windows,
    coalesce(v.found_windows, 0) = c.expected_windows AS cohort_complete,
    coalesce(p.observed_wallets, 0) AS observed_wallets,
    coalesce(p.unresolved_wallets, 0) AS unresolved_wallets,
    r.position, r.wallet, r.market_count, r.trade_count, r.economic_pnl_usdc,
    r.observed_cash_pnl_usdc AS cash_pnl_usdc,
    r.economic_pnl_usdc - r.observed_cash_pnl_usdc AS unredeemed_value_usdc,
    r.observed_rewards_usdc AS rewards_usdc
FROM calendar c
LEFT JOIN window_coverage v USING (month)
LEFT JOIN population p USING (month)
LEFT JOIN ranked r ON r.month = c.month AND r.position <= 20
ORDER BY c.month, r.position;
