-- Glitch Foundry census: canonical tables from checkpoint batches + outcomes.
-- Run: cd /Users/mijat/Sites/polymarket-bot/strategy-research-protocol/glitch-hunt/census
--      nice -n 19 duckdb -init /dev/null -c ".read build_tables.sql"
SET threads TO 2;
SET memory_limit='3GB';

-- ---------- assemble checkpoint dataset ----------
CREATE OR REPLACE TEMP VIEW manifest AS
SELECT slug, epoch, month, result_id
FROM read_csv('sample_manifest.csv', header=true,
  columns={'slug':'VARCHAR','epoch':'BIGINT','month':'VARCHAR','result_id':'VARCHAR'});

CREATE OR REPLACE TEMP VIEW cp_raw AS
SELECT * FROM read_csv('checkpoints/batch-*.csv', header=true, union_by_name=true,
  columns={'slug':'VARCHAR','epoch':'BIGINT','t_sec':'INTEGER','up_best_bid':'DOUBLE',
           'up_best_ask':'DOUBLE','up_mid':'DOUBLE','spread':'DOUBLE',
           'top3_bid_depth':'DOUBLE','top3_ask_depth':'DOUBLE','down_best_bid':'DOUBLE',
           'down_best_ask':'DOUBLE','last_event_age_ms':'BIGINT'});

COPY (
  SELECT c.*, m.month, (m.result_id = '0') AS up_won,
         CASE WHEN c.up_mid IS NULL THEN NULL
              ELSE LEAST(CAST(floor(c.up_mid * 50) AS INTEGER) * 2, 98) END AS band_c
  FROM cp_raw c JOIN manifest m USING (slug)
) TO 'checkpoints.parquet' (FORMAT PARQUET);

CREATE OR REPLACE TEMP VIEW cp AS SELECT * FROM 'checkpoints.parquet';

-- ---------- calibration: P(UP wins | 2c up_mid band, t_sec), ALL + per month ----------
COPY (
  WITH base AS (SELECT * FROM cp WHERE band_c IS NOT NULL AND t_sec % 15 = 0)
  SELECT month, t_sec, band_c, count(*) AS n,
         sum(CASE WHEN up_won THEN 1 ELSE 0 END) AS n_up_wins,
         round(avg(CASE WHEN up_won THEN 1.0 ELSE 0.0 END), 4) AS p_up,
         round(avg(up_mid), 4) AS avg_mid
  FROM (SELECT 'ALL' AS month, t_sec, band_c, up_won, up_mid FROM base
        UNION ALL
        SELECT month, t_sec, band_c, up_won, up_mid FROM base)
  GROUP BY month, t_sec, band_c
  ORDER BY month, t_sec, band_c
) TO 'calibration.csv' (HEADER);

-- ---------- friction: spread/depth per (band, t_sec), ALL + per month ----------
COPY (
  WITH base AS (SELECT * FROM cp WHERE band_c IS NOT NULL AND t_sec % 15 = 0)
  SELECT month, t_sec, band_c, count(*) AS n,
         round(median(spread), 4) AS med_spread,
         round(quantile_cont(spread, 0.9), 4) AS p90_spread,
         round(median(top3_bid_depth), 1) AS med_top3_bid,
         round(quantile_cont(top3_bid_depth, 0.9), 1) AS p90_top3_bid,
         round(median(top3_ask_depth), 1) AS med_top3_ask,
         round(quantile_cont(top3_ask_depth, 0.9), 1) AS p90_top3_ask
  FROM (SELECT 'ALL' AS month, * EXCLUDE (month) FROM base
        UNION ALL
        SELECT * FROM base)
  GROUP BY month, t_sec, band_c
  ORDER BY month, t_sec, band_c
) TO 'friction.csv' (HEADER);

-- ---------- endgame calibration: t in {840..900 step 5} + {897,899} ----------
COPY (
  WITH base AS (SELECT * FROM cp WHERE band_c IS NOT NULL AND t_sec >= 840)
  SELECT month, t_sec, band_c, count(*) AS n,
         sum(CASE WHEN up_won THEN 1 ELSE 0 END) AS n_up_wins,
         round(avg(CASE WHEN up_won THEN 1.0 ELSE 0.0 END), 4) AS p_up,
         round(median(spread), 4) AS med_spread
  FROM (SELECT 'ALL' AS month, t_sec, band_c, up_won, spread FROM base
        UNION ALL
        SELECT month, t_sec, band_c, up_won, spread FROM base)
  GROUP BY month, t_sec, band_c
  ORDER BY month, t_sec, band_c
) TO 'endgame.csv' (HEADER);

-- ---------- jumps: raw + aggregated drift by magnitude/time-remaining ----------
CREATE OR REPLACE TEMP VIEW jumps_raw AS
SELECT j.*, m.month, (m.result_id = '0') AS up_won
FROM read_csv('jumps/batch-*.csv', header=true, union_by_name=true,
  columns={'slug':'VARCHAR','epoch':'BIGINT','t_sec':'DOUBLE','jump_size':'DOUBLE',
           'mid_at_jump':'DOUBLE','drift_30s':'DOUBLE','drift_60s':'DOUBLE','drift_120s':'DOUBLE'}) j
JOIN manifest m USING (slug);

COPY (SELECT * FROM jumps_raw) TO 'jumps_raw.parquet' (FORMAT PARQUET);

COPY (
  SELECT
    CASE WHEN t_sec < 300 THEN '000-300' WHEN t_sec < 600 THEN '300-600'
         WHEN t_sec < 780 THEN '600-780' ELSE '780-900' END AS t_bucket,
    CASE WHEN jump_size >= 0 THEN 'up' ELSE 'down' END AS jump_dir,
    CASE WHEN abs(jump_size) < 0.05 THEN '3-5c'
         WHEN abs(jump_size) < 0.10 THEN '5-10c' ELSE '10c+' END AS jump_mag,
    count(*) AS n,
    count(drift_30s) AS n_d30, round(median(drift_30s), 4) AS med_d30,
    round(quantile_cont(drift_30s, 0.1), 4) AS p10_d30, round(quantile_cont(drift_30s, 0.9), 4) AS p90_d30,
    count(drift_60s) AS n_d60, round(median(drift_60s), 4) AS med_d60,
    round(quantile_cont(drift_60s, 0.1), 4) AS p10_d60, round(quantile_cont(drift_60s, 0.9), 4) AS p90_d60,
    count(drift_120s) AS n_d120, round(median(drift_120s), 4) AS med_d120,
    round(quantile_cont(drift_120s, 0.1), 4) AS p10_d120, round(quantile_cont(drift_120s, 0.9), 4) AS p90_d120
  FROM jumps_raw
  GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
) TO 'jumps.csv' (HEADER);

-- ---------- windowroll: per-episode first mid/spread and t=30 mid vs outcome ----------
COPY (
  SELECT c0.slug, c0.month, c0.epoch, c0.up_mid AS mid_t0, c0.spread AS spread_t0,
         c30.up_mid AS mid_t30, c0.up_won
  FROM (SELECT * FROM cp WHERE t_sec = 0) c0
  JOIN (SELECT * FROM cp WHERE t_sec = 30) c30 USING (slug)
  ORDER BY c0.epoch
) TO 'windowroll.csv' (HEADER);

-- ---------- sanity checks ----------
SELECT 'rows_checkpoints' AS metric, count(*) AS value FROM cp
UNION ALL SELECT 'episodes', count(DISTINCT slug) FROM cp
UNION ALL SELECT 'rows_jumps', count(*) FROM jumps_raw
UNION ALL SELECT 'mirror_violation_gt_1c',
  count(*) FILTER (abs(up_best_bid + down_best_ask - 1) > 0.011) FROM cp
  WHERE up_best_bid IS NOT NULL AND down_best_ask IS NOT NULL
UNION ALL SELECT 'null_mid_checkpoints', count(*) FROM cp WHERE up_mid IS NULL;

-- result_id mapping validation: near-certain books at t=899 must match outcome
SELECT 'map_check_t899_mid_gt_95' AS chk, count(*) AS n,
       round(avg(CASE WHEN up_won THEN 1.0 ELSE 0.0 END), 4) AS p_up
FROM cp WHERE t_sec = 899 AND up_mid > 0.95
UNION ALL
SELECT 'map_check_t899_mid_lt_05', count(*),
       round(avg(CASE WHEN up_won THEN 1.0 ELSE 0.0 END), 4)
FROM cp WHERE t_sec = 899 AND up_mid < 0.05;
