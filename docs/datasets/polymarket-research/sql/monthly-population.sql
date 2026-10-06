-- Observed research population, without diagnostic exclusions.
SELECT month, count(*) AS wallets, sum(market_count) AS wallet_markets,
    sum(trade_count) AS participant_trade_rows
FROM wallet_months
WHERE month BETWEEN '2026-06' AND '2026-09'
GROUP BY month ORDER BY month;
