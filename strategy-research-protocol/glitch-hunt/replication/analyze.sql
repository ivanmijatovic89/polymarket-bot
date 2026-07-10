-- REPLICATOR analysis — ANOMALY 001 holdout (independent extraction).
-- Run from strategy-research-protocol/glitch-hunt/replication/ with duckdb.
SET threads=2; SET memory_limit='2GB';

CREATE TEMP TABLE cp AS SELECT * FROM read_csv_auto('data/cp-batch-*.csv', union_by_name=true);

-- one row per episode: t0 state + dog side fixed at t0, later asks for same side
CREATE TEMP TABLE ep AS
WITH t0 AS (
  SELECT slug, epoch, month, result_id,
         up_bid, up_ask, down_bid, down_ask,
         (up_bid + up_ask)/2.0 AS up_mid, age_ms,
         up_ask_d1, up_ask_d3, down_ask_d1, down_ask_d3
  FROM cp WHERE t_sec = 0 AND up_bid IS NOT NULL AND up_ask IS NOT NULL
),
dog AS (
  SELECT *, CASE WHEN up_mid < 0.5 THEN 'UP' WHEN up_mid > 0.5 THEN 'DOWN' END AS dog_side
  FROM t0 WHERE up_mid <> 0.5
)
SELECT d.slug, d.epoch, d.month, d.result_id, d.dog_side, d.age_ms,
       CASE WHEN d.dog_side='UP' THEN d.up_ask ELSE d.down_ask END AS ask_t0,
       CASE WHEN d.dog_side='UP' THEN d.up_ask_d1 ELSE d.down_ask_d1 END AS d1_t0,
       CASE WHEN d.dog_side='UP' THEN d.up_ask_d3 ELSE d.down_ask_d3 END AS d3_t0,
       (CASE WHEN d.dog_side='UP' THEN '0' ELSE '1' END = d.result_id) AS dog_won,
       CASE WHEN d.dog_side='UP' THEN x15.ua ELSE x15.da END AS ask_t15,
       CASE WHEN d.dog_side='UP' THEN x30.ua ELSE x30.da END AS ask_t30,
       CASE WHEN d.dog_side='UP' THEN x45.ua ELSE x45.da END AS ask_t45,
       CASE WHEN d.dog_side='UP' THEN x60.ua ELSE x60.da END AS ask_t60
FROM dog d
LEFT JOIN (SELECT slug AS s, up_ask AS ua, down_ask AS da FROM cp WHERE t_sec=15) x15 ON x15.s=d.slug
LEFT JOIN (SELECT slug AS s, up_ask AS ua, down_ask AS da FROM cp WHERE t_sec=30) x30 ON x30.s=d.slug
LEFT JOIN (SELECT slug AS s, up_ask AS ua, down_ask AS da FROM cp WHERE t_sec=45) x45 ON x45.s=d.slug
LEFT JOIN (SELECT slug AS s, up_ask AS ua, down_ask AS da FROM cp WHERE t_sec=60) x60 ON x60.s=d.slug;

-- ============ SANITY CHECKS ============
SELECT 'sanity: episodes with t0 book' AS what, count(*) FROM ep;
SELECT 'sanity: P(UP wins) overall' AS what, avg((result_id='0')::INT) FROM (SELECT DISTINCT slug, result_id FROM cp);
SELECT 'sanity: mirror |up_bid+down_ask-1|>0.011' AS what,
       count(*) FILTER (abs(up_bid+down_ask-1) > 0.011) AS viol, count(*) AS n
FROM cp WHERE up_bid IS NOT NULL AND down_ask IS NOT NULL;

-- ============ (a) TREATED CELL t=0, pooled + per month ============
SELECT 'POOLED' AS month, count(*) AS n, round(avg(ask_t0),4) AS avg_ask,
       round(avg(dog_won::INT),4) AS p_win,
       round(avg(dog_won::INT) - avg(ask_t0),4) AS edge,
       round((avg(dog_won::INT) - avg(ask_t0)) / sqrt(0.25/count(*)), 2) AS z
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46
UNION ALL
SELECT month, count(*), round(avg(ask_t0),4), round(avg(dog_won::INT),4),
       round(avg(dog_won::INT) - avg(ask_t0),4),
       round((avg(dog_won::INT) - avg(ask_t0)) / sqrt(0.25/count(*)), 2)
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46 GROUP BY month ORDER BY month;

-- ============ (b) ENTRY AT LATER CHECKPOINTS (treated cell fixed at t0) ============
WITH tr AS (SELECT * FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46)
SELECT t, n, round(avg_ask,4) AS avg_ask, round(p_win,4) AS p_win,
       round(p_win - avg_ask, 4) AS gross_edge,
       round(p_win - avg_ask*1.0156, 4) AS net_edge_156bps,
       round((p_win - avg_ask) / sqrt(0.25/n), 2) AS z_gross,
       round((p_win - avg_ask*1.0156) / sqrt(0.25/n), 2) AS z_net
FROM (
  SELECT 0 AS t, count(*) n, avg(ask_t0) avg_ask, avg(dog_won::INT) p_win FROM tr WHERE ask_t0 IS NOT NULL
  UNION ALL SELECT 15, count(*), avg(ask_t15), avg(dog_won::INT) FROM tr WHERE ask_t15 IS NOT NULL
  UNION ALL SELECT 30, count(*), avg(ask_t30), avg(dog_won::INT) FROM tr WHERE ask_t30 IS NOT NULL
  UNION ALL SELECT 45, count(*), avg(ask_t45), avg(dog_won::INT) FROM tr WHERE ask_t45 IS NOT NULL
  UNION ALL SELECT 60, count(*), avg(ask_t60), avg(dog_won::INT) FROM tr WHERE ask_t60 IS NOT NULL
) ORDER BY t;

-- per-month net edge at t=15 (time stability of the load-bearing number)
SELECT month, count(*) n, round(avg(ask_t15),4) avg_ask15,
       round(avg(dog_won::INT),4) p_win,
       round(avg(dog_won::INT) - avg(ask_t15)*1.0156, 4) AS net_edge_t15
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46 AND ask_t15 IS NOT NULL
GROUP BY month ORDER BY month;

-- ============ (c) PLACEBO BANDS at t=0 ============
SELECT CASE WHEN ask_t0 <= 0.46 THEN 'treated <=0.46'
            WHEN ask_t0 <= 0.48 THEN 'placebo 0.46-0.48'
            ELSE 'placebo 0.48-0.50' END AS band,
       count(*) n, round(avg(ask_t0),4) avg_ask, round(avg(dog_won::INT),4) p_win,
       round(avg(dog_won::INT) - avg(ask_t0),4) AS edge,
       round((avg(dog_won::INT) - avg(ask_t0)) / sqrt(0.25/count(*)), 2) AS z
FROM ep WHERE ask_t0 >= 0.20 AND ask_t0 < 0.50
GROUP BY 1 ORDER BY 1;

-- ============ (d) SIDE SPLIT (treated cell) ============
SELECT dog_side, count(*) n, round(avg(ask_t0),4) avg_ask,
       round(avg(dog_won::INT),4) p_win,
       round(avg(dog_won::INT) - avg(ask_t0),4) AS edge,
       round((avg(dog_won::INT) - avg(ask_t0)) / sqrt(0.25/count(*)), 2) AS z
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46 GROUP BY dog_side;

-- side split at t=15 entry (net)
SELECT dog_side, count(*) n,
       round(avg(dog_won::INT) - avg(ask_t15)*1.0156, 4) AS net_edge_t15
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46 AND ask_t15 IS NOT NULL GROUP BY dog_side;

-- ============ depth at the touch (treated cell) ============
SELECT count(*) n, round(median(d1_t0),0) med_top1_shares, round(median(d3_t0),0) med_top3_shares,
       round(quantile_cont(d3_t0, 0.25),0) p25_top3, round(quantile_cont(d3_t0, 0.10),0) p10_top3
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46;

-- ============ freshness (treated cell) ============
SELECT round(median(age_ms),0) med_age_ms, round(quantile_cont(age_ms,0.9),0) p90_age_ms
FROM ep WHERE ask_t0 BETWEEN 0.20 AND 0.46;
