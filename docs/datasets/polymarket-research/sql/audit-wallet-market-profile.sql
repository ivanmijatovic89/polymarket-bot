-- Edit these three values. The date range selects market starts, not cash dates.
-- This report retains unresolved rows and labels coverage; it is not a ranking.
WITH params AS (
    SELECT '0x0000000000000000000000000000000000000000' AS wallet,
        DATE '2026-06-01' AS from_date, DATE '2026-10-01' AS to_date
), scope AS (
    SELECT p.wallet, p.from_date, p.to_date,
        count(*) FILTER (WHERE c.found) AS found_windows,
        96 * date_diff('day', p.from_date, p.to_date) AS expected_windows
    FROM params p LEFT JOIN coverage c
        ON c.market_start >= epoch(p.from_date) AND c.market_start < epoch(p.to_date)
    GROUP BY p.wallet, p.from_date, p.to_date
), outcome_executions AS (
    SELECT t.condition_id, t.token_id, count(*) AS trade_rows,
        count(*) FILTER (WHERE t.is_taker) AS taker_rows,
        count(*) FILTER (WHERE NOT t.is_taker) AS maker_rows,
        count(*) FILTER (WHERE t.is_taker IS NULL) AS unknown_role_rows,
        min(t.timestamp - m.market_start) AS first_trade_offset_seconds,
        max(t.timestamp - m.market_start) AS last_trade_offset_seconds,
        sum(t.size) FILTER (WHERE t.side = 'BUY') AS shares_bought,
        sum(t.size) FILTER (WHERE t.side = 'SELL') AS shares_sold,
        sum(t.size * t.price) FILTER (WHERE t.side = 'BUY') /
            nullif(sum(t.size) FILTER (WHERE t.side = 'BUY'), 0) AS buy_vwap,
        sum(t.size * t.price) FILTER (WHERE t.side = 'SELL') /
            nullif(sum(t.size) FILTER (WHERE t.side = 'SELL'), 0) AS sell_vwap
    FROM trades t JOIN markets m USING (condition_id) CROSS JOIN params p
    WHERE t.proxy_wallet = lower(p.wallet)
        AND m.market_start >= epoch(p.from_date) AND m.market_start < epoch(p.to_date)
    GROUP BY t.condition_id, t.token_id
), executions AS (
    SELECT condition_id,
        sum(taker_rows) AS taker_rows, sum(maker_rows) AS maker_rows,
        sum(unknown_role_rows) AS unknown_role_rows,
        min(first_trade_offset_seconds) AS first_trade_offset_seconds,
        max(last_trade_offset_seconds) AS last_trade_offset_seconds,
        list(struct_pack(
            token_id := token_id, trade_rows := trade_rows,
            shares_bought := shares_bought, shares_sold := shares_sold,
            buy_vwap := buy_vwap, sell_vwap := sell_vwap
        ) ORDER BY token_id) AS outcome_execution_summary
    FROM outcome_executions GROUP BY condition_id
)
SELECT w.wallet, w.slug, w.condition_id, w.market_start,
    s.found_windows, s.expected_windows,
    s.found_windows = s.expected_windows AS cohort_complete,
    w.quality, w.issues, w.notes, w.trade_count, w.activity_count,
    w.economic_pnl_usdc, w.cash_pnl_usdc, w.unredeemed_value_usdc, w.rewards_usdc,
    w.api_position_pnl_usdc, w.api_pnl_difference_usdc, w.api_pnl_status,
    e.taker_rows, e.maker_rows, e.unknown_role_rows,
    e.first_trade_offset_seconds, e.last_trade_offset_seconds,
    m.token_ids, m.outcomes, e.outcome_execution_summary
FROM wallet_markets w CROSS JOIN scope s
JOIN markets m ON m.condition_id = w.condition_id
LEFT JOIN executions e ON e.condition_id = w.condition_id
WHERE w.wallet = lower(s.wallet)
    AND w.market_start >= epoch(s.from_date) AND w.market_start < epoch(s.to_date)
ORDER BY w.market_start;
