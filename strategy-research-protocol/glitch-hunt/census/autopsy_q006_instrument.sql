-- Q-006 reversal autopsy, instrument arm (ATLAS gap item 2, round 7).
-- Compares the two extractor code paths ON THE SAME 2,000 census episodes:
--   extension path: extract_midwindow.cjs -> census/midwindow_census/ (this round)
--   full-replay path: extract.cjs -> census/checkpoints.parquet (census v1)
-- Overlapping grid points: t in {300,450,600,690} (all multiples of 15,
-- so all four exist on the census 15s grid).
-- Run from strategy-research-protocol/glitch-hunt/ :
--   nice -n 19 duckdb < census/autopsy_q006_instrument.sql
SET threads TO 2;
SET memory_limit='3GB';

-- 1. Canonical parquet for the census mid-window extraction
--    (same construction as build_midwindow_tables.sql step 1).
CREATE TEMP TABLE mwc AS
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
FROM read_csv_auto('census/midwindow_census/checkpoints/batch-*.csv', header=true, union_by_name=true);

COPY (SELECT * FROM mwc) TO 'census/census_midwindow_checkpoints.parquet' (FORMAT PARQUET);

-- 2. Row-level join against the full-replay census checkpoints.
CREATE TEMP TABLE cmp AS
SELECT
  e.slug, e.month, e.t_sec, e.up_state, e.down_state, e.age_ms AS ext_age_ms,
  e.up_bid  AS e_up_bid,  c.up_best_bid   AS c_up_bid,
  e.up_ask  AS e_up_ask,  c.up_best_ask   AS c_up_ask,
  e.down_bid AS e_dn_bid, c.down_best_bid AS c_dn_bid,
  e.down_ask AS e_dn_ask, c.down_best_ask AS c_dn_ask,
  e.up_top3_bid AS e_t3b, c.top3_bid_depth AS c_t3b,
  e.up_top3_ask AS e_t3a, c.top3_ask_depth AS c_t3a,
  e.age_ms AS e_age, c.last_event_age_ms AS c_age
FROM mwc e
JOIN 'census/checkpoints.parquet' c ON c.slug = e.slug AND c.t_sec = e.t_sec;

SELECT 'join_coverage' AS what, count(*) AS joined_rows,
       (SELECT count(*) FROM mwc) AS ext_rows FROM cmp;

-- Field-level match rates (tolerance 1e-6 on prices/depths, exact on age;
-- NULL vs NULL counts as match via IS NOT DISTINCT FROM semantics).
CREATE TEMP MACRO eqf(a, b) AS (a IS NOT DISTINCT FROM b) OR (a IS NOT NULL AND b IS NOT NULL AND abs(a - b) < 1e-6);

COPY (
  SELECT * FROM (
    SELECT 'up_bid'   AS field, count(*) AS n, sum(CASE WHEN eqf(e_up_bid, c_up_bid) THEN 0 ELSE 1 END) AS n_mismatch FROM cmp
    UNION ALL SELECT 'up_ask',   count(*), sum(CASE WHEN eqf(e_up_ask, c_up_ask) THEN 0 ELSE 1 END) FROM cmp
    UNION ALL SELECT 'down_bid', count(*), sum(CASE WHEN eqf(e_dn_bid, c_dn_bid) THEN 0 ELSE 1 END) FROM cmp
    UNION ALL SELECT 'down_ask', count(*), sum(CASE WHEN eqf(e_dn_ask, c_dn_ask) THEN 0 ELSE 1 END) FROM cmp
    UNION ALL SELECT 'up_top3_bid', count(*), sum(CASE WHEN eqf(e_t3b, c_t3b) THEN 0 ELSE 1 END) FROM cmp
    UNION ALL SELECT 'up_top3_ask', count(*), sum(CASE WHEN eqf(e_t3a, c_t3a) THEN 0 ELSE 1 END) FROM cmp
    UNION ALL SELECT 'age_ms',   count(*), sum(CASE WHEN e_age IS NOT DISTINCT FROM c_age THEN 0 ELSE 1 END) FROM cmp
  ) ORDER BY field
) TO 'census/autopsy_q006_field_match.csv' (HEADER);
SELECT * FROM 'census/autopsy_q006_field_match.csv';

-- Any-field-mismatch rows, dumped in full for characterization.
COPY (
  SELECT * FROM cmp
  WHERE NOT (eqf(e_up_bid, c_up_bid) AND eqf(e_up_ask, c_up_ask)
         AND eqf(e_dn_bid, c_dn_bid) AND eqf(e_dn_ask, c_dn_ask)
         AND eqf(e_t3b, c_t3b) AND eqf(e_t3a, c_t3a)
         AND e_age IS NOT DISTINCT FROM c_age)
) TO 'census/autopsy_q006_discrepancies.csv' (HEADER);

SELECT 'rows_all_fields_match' AS what,
       count(*) FILTER (WHERE eqf(e_up_bid, c_up_bid) AND eqf(e_up_ask, c_up_ask)
         AND eqf(e_dn_bid, c_dn_bid) AND eqf(e_dn_ask, c_dn_ask)
         AND eqf(e_t3b, c_t3b) AND eqf(e_t3a, c_t3a)
         AND e_age IS NOT DISTINCT FROM c_age) AS n_match,
       count(*) AS n_total FROM cmp;

-- Discrepancy characterization: by month, t, state, age.
SELECT month, t_sec, count(*) AS n_bad FROM (
  SELECT * FROM cmp
  WHERE NOT (eqf(e_up_bid, c_up_bid) AND eqf(e_up_ask, c_up_ask)
         AND eqf(e_dn_bid, c_dn_bid) AND eqf(e_dn_ask, c_dn_ask)
         AND eqf(e_t3b, c_t3b) AND eqf(e_t3a, c_t3a)
         AND e_age IS NOT DISTINCT FROM c_age)
) GROUP BY 1, 2 ORDER BY 1, 2;

-- 3. THE static in-band cell, both code paths, same episodes.
--    Cell: t=300, token-level, two-sided (bid>0, ask<1, ask>bid),
--    ask in [0.82, 0.86). Same eligibility as replicate_006.sql.
-- 3a. Full-replay path (extract.cjs / checkpoints.parquet) — must
--     reproduce REPLICATION-006's +1.71c, n=156.
WITH cp AS (
  SELECT slug, month, up_won, up_best_bid, up_best_ask, down_best_bid, down_best_ask
  FROM 'census/checkpoints.parquet' WHERE t_sec = 300
), tok AS (
  SELECT slug, 'UP' AS token, up_best_bid AS bid, up_best_ask AS ask,
         CASE WHEN up_won THEN 1.0 ELSE 0.0 END AS won FROM cp
  UNION ALL
  SELECT slug, 'DOWN', down_best_bid, down_best_ask,
         CASE WHEN up_won THEN 0.0 ELSE 1.0 END FROM cp
)
SELECT 'static_t300_fullreplay' AS path, count(*) AS n,
       round(avg(won), 4) AS p_win, round(avg(ask), 4) AS avg_ask,
       round(avg(won - ask), 5) AS dev,
       round(avg(won - ask) / (stddev_samp(won - ask) / sqrt(count(*))), 3) AS z
FROM tok
WHERE bid IS NOT NULL AND ask IS NOT NULL AND bid > 0 AND ask < 1 AND ask > bid
  AND ask >= 0.82 AND ask < 0.86;

-- 3b. Extension path (extract_midwindow.cjs) — same cell, same episodes.
WITH tok AS (
  SELECT slug, 'UP' AS token, up_bid AS bid, up_ask AS ask,
         CASE WHEN up_won THEN 1.0 ELSE 0.0 END AS won
  FROM mwc WHERE t_sec = 300
  UNION ALL
  SELECT slug, 'DOWN', down_bid, down_ask,
         CASE WHEN up_won THEN 0.0 ELSE 1.0 END
  FROM mwc WHERE t_sec = 300
)
SELECT 'static_t300_extension' AS path, count(*) AS n,
       round(avg(won), 4) AS p_win, round(avg(ask), 4) AS avg_ask,
       round(avg(won - ask), 5) AS dev,
       round(avg(won - ask) / (stddev_samp(won - ask) / sqrt(count(*))), 3) AS z
FROM tok
WHERE bid IS NOT NULL AND ask IS NOT NULL AND bid > 0 AND ask < 1 AND ask > bid
  AND ask >= 0.82 AND ask < 0.86;

-- 3c. Entry-set identity: do the two paths select the SAME (slug, token)
--     entries for the static cell?
WITH f AS (
  SELECT slug, 'UP' AS token, up_best_ask AS ask FROM 'census/checkpoints.parquet'
  WHERE t_sec = 300 AND up_best_bid IS NOT NULL AND up_best_ask IS NOT NULL
    AND up_best_bid > 0 AND up_best_ask < 1 AND up_best_ask > up_best_bid
    AND up_best_ask >= 0.82 AND up_best_ask < 0.86
  UNION ALL
  SELECT slug, 'DOWN', down_best_ask FROM 'census/checkpoints.parquet'
  WHERE t_sec = 300 AND down_best_bid IS NOT NULL AND down_best_ask IS NOT NULL
    AND down_best_bid > 0 AND down_best_ask < 1 AND down_best_ask > down_best_bid
    AND down_best_ask >= 0.82 AND down_best_ask < 0.86
), e AS (
  SELECT slug, 'UP' AS token, up_ask AS ask FROM mwc
  WHERE t_sec = 300 AND up_bid IS NOT NULL AND up_ask IS NOT NULL
    AND up_bid > 0 AND up_ask < 1 AND up_ask > up_bid
    AND up_ask >= 0.82 AND up_ask < 0.86
  UNION ALL
  SELECT slug, 'DOWN', down_ask FROM mwc
  WHERE t_sec = 300 AND down_bid IS NOT NULL AND down_ask IS NOT NULL
    AND down_bid > 0 AND down_ask < 1 AND down_ask > down_bid
    AND down_ask >= 0.82 AND down_ask < 0.86
)
SELECT 'entry_set_identity' AS what,
       (SELECT count(*) FROM f) AS n_fullreplay,
       (SELECT count(*) FROM e) AS n_extension,
       (SELECT count(*) FROM f JOIN e USING (slug, token)) AS n_common;
