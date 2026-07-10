-- Round 3 probe: memorylessness 2x2 on NON-banned conditioning variables
-- (gap-map pointer 4). Instrument = memo 002's mover-at-matched-ask design,
-- conditioning variable swapped. Run from glitch-hunt/: duckdb < census/round3_probe.sql

CREATE TEMP VIEW base AS
SELECT slug, epoch, month, t_sec, up_bid, up_ask, down_bid, down_ask,
       (up_bid+up_ask)/2 up_mid, (result_id=0) AS up_won,
       up_ask_d3, down_ask_d3
FROM 'replication/holdout_checkpoints.parquet'
UNION ALL
SELECT slug, epoch, month, t_sec, up_best_bid, up_best_ask, down_best_bid,
       down_best_ask, up_mid, up_won, NULL, NULL
FROM 'census/checkpoints.parquet' WHERE t_sec IN (0,15,30,60);

CREATE TEMP VIEW prev AS
SELECT epoch+900 AS next_epoch, (result_id=0) AS prev_up_won
FROM read_csv_auto('census/outcomes_all.csv');

-- episode-level frame: t=0 and t=15 both two-sided (same filter as memo 002)
CREATE TEMP VIEW w AS
SELECT b0.slug, b0.month, b0.epoch,
       p.prev_up_won,
       b0.up_mid  AS up_mid0,  b15.up_mid AS up_mid15,
       b0.up_ask  AS up_ask0,  b0.down_ask AS down_ask0,
       b0.up_bid  AS up_bid0,  b0.down_bid AS down_bid0,
       b15.up_ask AS up_ask15, b15.down_ask AS down_ask15,
       b0.up_ask_d3 AS up_d3_0, b0.down_ask_d3 AS down_d3_0,
       b0.up_won,
       CASE WHEN b0.up_mid<0.5 THEN b0.up_ask ELSE b0.down_ask END AS dog_ask0,
       (b0.up_ask - b0.up_bid) AS up_spread0
FROM base b0
JOIN base b15 USING (slug)
LEFT JOIN prev p ON b0.epoch = p.next_epoch
WHERE b0.t_sec=0 AND b15.t_sec=15
  AND b0.up_bid IS NOT NULL AND b0.up_ask IS NOT NULL
  AND b0.down_bid IS NOT NULL AND b0.down_ask IS NOT NULL
  AND b15.up_bid IS NOT NULL AND b15.up_ask IS NOT NULL
  AND b15.down_bid IS NOT NULL AND b15.down_ask IS NOT NULL;

-- mover rows: side whose mid rose t=0 -> t=15, bought at its t=15 ask, matched band 0.56-0.66
CREATE TEMP VIEW mover AS
SELECT *,
  CASE WHEN up_mid15 > up_mid0 THEN 'up' ELSE 'down' END AS mover_side,
  CASE WHEN up_mid15 > up_mid0 THEN up_ask15 ELSE down_ask15 END AS mover_ask,
  CASE WHEN up_mid15 > up_mid0 THEN up_won ELSE NOT up_won END AS mover_won,
  CASE WHEN up_mid15 > up_mid0 THEN prev_up_won ELSE NOT prev_up_won END AS mover_was_prev_winner
FROM w
WHERE up_mid15 <> up_mid0 AND prev_up_won IS NOT NULL;

-- ===== TEST 1 (PRIMARY, pre-declared): prior-window settlement side =====
SELECT 'T1 mover 0.56-0.66 by prev' AS test, mover_was_prev_winner,
  COUNT(*) n, ROUND(AVG(mover_ask),4) avg_ask,
  ROUND(AVG(mover_won::INT),4) p_win,
  ROUND(AVG(mover_won::INT - mover_ask)*100,2) edge_c,
  ROUND(AVG(mover_won::INT - mover_ask)/SQRT(AVG(mover_won::INT)*(1-AVG(mover_won::INT))/COUNT(*)),2) z
FROM mover WHERE mover_ask BETWEEN 0.56 AND 0.66
GROUP BY 2 ORDER BY 2;

-- T1 plain (non-mover) version: every token at t=15 ask 0.50-0.66, split by prev agreement
SELECT 'T1 plain t15 token 0.50-0.66' AS test, tok_is_prev_winner,
  COUNT(*) n, ROUND(AVG(ask),4) avg_ask, ROUND(AVG(won::INT),4) p_win,
  ROUND(AVG(won::INT - ask)*100,2) edge_c,
  ROUND(AVG(won::INT - ask)/SQRT(AVG(won::INT)*(1-AVG(won::INT))/COUNT(*)),2) z
FROM (
  SELECT up_ask15 ask, up_won won, prev_up_won AS tok_is_prev_winner FROM w WHERE prev_up_won IS NOT NULL
  UNION ALL
  SELECT down_ask15, NOT up_won, NOT prev_up_won FROM w WHERE prev_up_won IS NOT NULL
) WHERE ask BETWEEN 0.50 AND 0.66
GROUP BY 2 ORDER BY 2;

-- ===== TEST 2: t=0 up-book spread width (quartile split), mover design =====
SELECT 'T2 mover by t0 spread quartile' AS test,
  NTILE(4) OVER () AS dummy_never_used -- placeholder removed below
FROM (SELECT 1) LIMIT 0;

WITH q AS (SELECT quantile_cont(up_spread0, [0.25, 0.5, 0.75]) qs FROM w)
SELECT 'T2 mover 0.56-0.66 by t0 spread' AS test,
  CASE WHEN m.up_spread0 <= qs[1] THEN 'q1_tight'
       WHEN m.up_spread0 <= qs[2] THEN 'q2'
       WHEN m.up_spread0 <= qs[3] THEN 'q3'
       ELSE 'q4_wide' END AS spread_q,
  COUNT(*) n, ROUND(AVG(mover_ask),4) avg_ask, ROUND(AVG(mover_won::INT),4) p_win,
  ROUND(AVG(mover_won::INT - mover_ask)*100,2) edge_c,
  ROUND(AVG(mover_won::INT - mover_ask)/SQRT(AVG(mover_won::INT)*(1-AVG(mover_won::INT))/COUNT(*)),2) z
FROM mover m, q WHERE mover_ask BETWEEN 0.56 AND 0.66
GROUP BY 2 ORDER BY 2;

-- ===== TEST 3: t=0 cross-asset top-3 ask-depth imbalance (holdout only), mover design =====
-- ask-thin side = side with less top-3 ask depth at t=0 (less resistance to being bought)
SELECT 'T3 mover 0.56-0.66 by t0 ask-depth' AS test,
  CASE WHEN (mover_side='up'   AND up_d3_0   < down_d3_0)
        OR  (mover_side='down' AND down_d3_0 < up_d3_0)
       THEN 'mover_was_ask_thin' ELSE 'mover_was_ask_thick' END AS depth_state,
  COUNT(*) n, ROUND(AVG(mover_ask),4) avg_ask, ROUND(AVG(mover_won::INT),4) p_win,
  ROUND(AVG(mover_won::INT - mover_ask)*100,2) edge_c,
  ROUND(AVG(mover_won::INT - mover_ask)/SQRT(AVG(mover_won::INT)*(1-AVG(mover_won::INT))/COUNT(*)),2) z
FROM mover WHERE mover_ask BETWEEN 0.56 AND 0.66 AND up_d3_0 IS NOT NULL AND down_d3_0 IS NOT NULL
GROUP BY 2 ORDER BY 2;
