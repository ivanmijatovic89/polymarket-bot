-- All observed wallets. Complete-month profit uses the documented market cohort.
SELECT month, wallet, profit_usdc, market_count, trade_count
FROM wallet_months
WHERE month BETWEEN '2026-06' AND '2026-09'
QUALIFY row_number() OVER (
    PARTITION BY month ORDER BY profit_usdc DESC NULLS LAST, wallet
) <= 20
ORDER BY month, profit_usdc DESC NULLS LAST, wallet;
