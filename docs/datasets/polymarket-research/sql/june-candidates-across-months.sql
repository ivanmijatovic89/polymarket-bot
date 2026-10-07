-- Choose June candidates once; preserve later losses and absent trading.
WITH ranked AS (
    SELECT *, row_number() OVER (
        PARTITION BY month ORDER BY profit_usdc DESC NULLS LAST, wallet
    ) AS position
    FROM wallet_months
), candidates AS (
    SELECT wallet, position AS june_position
    FROM ranked WHERE month = '2026-06' AND position <= 20 AND profit_usdc IS NOT NULL
), months(month) AS (
    VALUES ('2026-06'), ('2026-07'), ('2026-08'), ('2026-09')
)
SELECT c.wallet, c.june_position, m.month, r.profit_usdc, r.market_count, r.trade_count
FROM candidates c CROSS JOIN months m
LEFT JOIN ranked r ON r.wallet = c.wallet AND r.month = m.month
ORDER BY c.june_position, m.month;
