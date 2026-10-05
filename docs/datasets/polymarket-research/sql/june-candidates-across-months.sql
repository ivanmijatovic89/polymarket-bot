-- Select candidates using June alone, then retain their later-month outcomes.
-- Run monthly-rankings.sql first: no complete June means no candidates here.
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
), ranked AS (
    SELECT *, row_number() OVER (
        PARTITION BY month ORDER BY economic_pnl_usdc DESC, wallet
    ) AS position
    FROM wallet_months
    WHERE cohort_complete AND incomplete_markets = 0
), candidates AS (
    SELECT wallet, position AS june_position, economic_pnl_usdc AS june_pnl_usdc
    FROM ranked WHERE month = '2026-06' AND position <= 20
)
SELECT s.wallet, s.june_position, s.june_pnl_usdc, c.month,
    CASE
        WHEN coalesce(v.found_windows, 0) <> c.expected_windows THEN 'incomplete_month'
        WHEN w.wallet IS NULL THEN 'no_observed_trading'
        WHEN w.incomplete_markets > 0 THEN 'unresolved_wallet'
        ELSE 'complete_wallet'
    END AS result_status,
    r.position AS month_position, w.market_count, w.trade_count,
    w.incomplete_markets, w.economic_pnl_usdc
FROM candidates s CROSS JOIN calendar c
LEFT JOIN window_coverage v USING (month)
LEFT JOIN wallet_months w ON w.wallet = s.wallet AND w.month = c.month
LEFT JOIN ranked r ON r.wallet = s.wallet AND r.month = c.month
ORDER BY s.june_position, c.month;
