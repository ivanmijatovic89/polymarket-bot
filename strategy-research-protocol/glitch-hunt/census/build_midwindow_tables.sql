-- Mid-window holdout tables (Foundry round 6 interleave).
-- Same construction as build_endgame_tables.sql, over the t in
-- {300,450,600,690} mid-window extraction (extract_midwindow.cjs).
-- Run from strategy-research-protocol/glitch-hunt/ :
--   nice -n 19 duckdb < census/build_midwindow_tables.sql
SET threads TO 2;
SET memory_limit='3GB';

-- 1. Canonical parquet: all mid-window checkpoints with derived columns.
--    One-sided/empty books are KEPT (bid/ask recorded independently).
CREATE TEMP TABLE mw AS
SELECT
  slug, epoch, month, result_id, t_sec,
  up_bid, up_bid_sz, up_ask, up_ask_sz, up_top3_bid, up_top3_ask,
  down_bid, down_bid_sz, down_ask, down_ask_sz, down_top3_bid, down_top3_ask,
  age_ms, replay_start_off_s,
  (result_id = 0) AS up_won,
  CASE
    WHEN up_bid IS NOT NULL AND up_ask IS NOT NULL THEN 'two_sided'
    WHEN up_bid IS NOT NULL THEN 'bid_only'
    WHEN up_ask IS NOT NULL THEN 'ask_only'
    ELSE 'empty' END AS up_state,
  CASE
    WHEN down_bid IS NOT NULL AND down_ask IS NOT NULL THEN 'two_sided'
    WHEN down_bid IS NOT NULL THEN 'bid_only'
    WHEN down_ask IS NOT NULL THEN 'ask_only'
    ELSE 'empty' END AS down_state,
  CASE WHEN up_bid IS NOT NULL AND up_ask IS NOT NULL
       THEN least(cast(floor((up_bid+up_ask)/2*50) AS INT)*2, 98) END AS band_c,
  CASE WHEN up_bid IS NOT NULL AND up_ask IS NOT NULL THEN up_ask - up_bid END AS spread
FROM read_csv_auto('census/midwindow/checkpoints/batch-*.csv', header=true, union_by_name=true);

COPY (SELECT * FROM mw) TO 'census/midwindow_checkpoints.parquet' (FORMAT PARQUET);

-- 2. Taxonomy: book-state counts by t, per month and ALL (up book; down mirrors).
COPY (
  WITH base AS (
    SELECT month, t_sec, up_state, up_won FROM mw
    UNION ALL
    SELECT 'ALL', t_sec, up_state, up_won FROM mw
  )
  SELECT month, t_sec, up_state, count(*) AS n,
         sum(CASE WHEN up_won THEN 1 ELSE 0 END) AS n_up_wins,
         round(avg(CASE WHEN up_won THEN 1.0 ELSE 0 END), 4) AS p_up
  FROM base GROUP BY 1,2,3 ORDER BY 1,2,3
) TO 'census/midwindow_taxonomy.csv' (HEADER);

-- 3. Two-sided mid calibration.
COPY (
  WITH base AS (
    SELECT month, t_sec, band_c, up_won, spread FROM mw WHERE band_c IS NOT NULL
    UNION ALL
    SELECT 'ALL', t_sec, band_c, up_won, spread FROM mw WHERE band_c IS NOT NULL
  )
  SELECT month, t_sec, band_c, count(*) AS n,
         sum(CASE WHEN up_won THEN 1 ELSE 0 END) AS n_up_wins,
         round(avg(CASE WHEN up_won THEN 1.0 ELSE 0 END), 4) AS p_up,
         round(median(spread), 4) AS med_spread
  FROM base GROUP BY 1,2,3 ORDER BY 1,2,3
) TO 'census/midwindow_calibration_mid.csv' (HEADER);

-- 4. Takeable-side calibration: per token, rows where that token's ASK exists.
COPY (
  WITH tok AS (
    SELECT month, t_sec, 'up' AS token,
      CASE WHEN up_bid IS NOT NULL THEN 'two_sided' ELSE 'ask_only' END AS state,
      up_ask AS ask, up_ask_sz AS ask_sz, up_top3_ask AS top3_ask,
      (result_id = 0) AS won
    FROM mw WHERE up_ask IS NOT NULL
    UNION ALL
    SELECT month, t_sec, 'down',
      CASE WHEN down_bid IS NOT NULL THEN 'two_sided' ELSE 'ask_only' END,
      down_ask, down_ask_sz, down_top3_ask,
      (result_id = 1)
    FROM mw WHERE down_ask IS NOT NULL
  ), base AS (
    SELECT * FROM tok
    UNION ALL
    SELECT 'ALL', t_sec, token, state, ask, ask_sz, top3_ask, won FROM tok
  )
  SELECT month, t_sec, token, state,
         least(cast(floor(ask*50) AS INT)*2, 98) AS ask_band,
         count(*) AS n,
         sum(CASE WHEN won THEN 1 ELSE 0 END) AS n_wins,
         round(avg(CASE WHEN won THEN 1.0 ELSE 0 END), 4) AS p_win,
         round(avg(ask), 4) AS avg_ask,
         round(median(ask_sz), 1) AS med_ask_sz,
         round(median(top3_ask), 1) AS med_top3_ask
  FROM base GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5
) TO 'census/midwindow_calibration_takeable.csv' (HEADER);

-- 5. Bid-side calibration, same shape.
COPY (
  WITH tok AS (
    SELECT month, t_sec, 'up' AS token,
      CASE WHEN up_ask IS NOT NULL THEN 'two_sided' ELSE 'bid_only' END AS state,
      up_bid AS bid, up_bid_sz AS bid_sz, up_top3_bid AS top3_bid,
      (result_id = 0) AS won
    FROM mw WHERE up_bid IS NOT NULL
    UNION ALL
    SELECT month, t_sec, 'down',
      CASE WHEN down_ask IS NOT NULL THEN 'two_sided' ELSE 'bid_only' END,
      down_bid, down_bid_sz, down_top3_bid,
      (result_id = 1)
    FROM mw WHERE down_bid IS NOT NULL
  ), base AS (
    SELECT * FROM tok
    UNION ALL
    SELECT 'ALL', t_sec, token, state, bid, bid_sz, top3_bid, won FROM tok
  )
  SELECT month, t_sec, token, state,
         least(cast(floor(bid*50) AS INT)*2, 98) AS bid_band,
         count(*) AS n,
         sum(CASE WHEN won THEN 1 ELSE 0 END) AS n_wins,
         round(avg(CASE WHEN won THEN 1.0 ELSE 0 END), 4) AS p_win,
         round(avg(bid), 4) AS avg_bid,
         round(median(bid_sz), 1) AS med_bid_sz,
         round(median(top3_bid), 1) AS med_top3_bid
  FROM base GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5
) TO 'census/midwindow_calibration_bid.csv' (HEADER);

-- 6. Friction map extension: mid-window holdout cells, same shape as
--    census friction_map.csv (up book), source='midwindow_holdout'.
COPY (
  SELECT 'midwindow_holdout' AS source, t_sec, band_c, count(*) AS n,
    round(median(spread), 4) AS med_spread, round(quantile_cont(spread, 0.25), 4) AS p25_spread,
    round(median(up_top3_bid), 1) AS med_top3_bid, round(quantile_cont(up_top3_bid, 0.25), 1) AS p25_top3_bid,
    round(median(up_top3_ask), 1) AS med_top3_ask, round(quantile_cont(up_top3_ask, 0.25), 1) AS p25_top3_ask
  FROM mw WHERE band_c IS NOT NULL
  GROUP BY t_sec, band_c ORDER BY t_sec, band_c
) TO 'census/friction_map_midwindow.csv' (HEADER);

-- 7. Self-check rollup by month.
COPY (
  SELECT m.month,
         count(*) AS episodes,
         sum(s.snapshots_checked) AS checked,
         sum(s.mismatches) AS mismatches,
         round(100.0*sum(s.mismatches)/nullif(sum(s.snapshots_checked),0), 3) AS raw_pct,
         sum(s.stale_explained) AS stale_explained,
         round(100.0*(sum(s.mismatches)-sum(s.stale_explained))/nullif(sum(s.snapshots_checked),0), 3) AS hard_pct
  FROM read_csv_auto('census/midwindow/selfcheck.csv', header=true) s
  JOIN read_csv_auto('replication/data/holdout_manifest.csv', header=true) m USING (slug)
  WHERE s.snapshots_checked IS NOT NULL
  GROUP BY 1 ORDER BY 1
) TO 'census/midwindow_selfcheck_by_month.csv' (HEADER);
