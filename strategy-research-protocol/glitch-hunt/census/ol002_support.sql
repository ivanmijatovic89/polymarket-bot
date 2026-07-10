-- OL-002 support (round 6, gap item 3(ii)): Nov-2025..Jan-2026 stale-row
-- exposure inventory for atlas-cited cells. If OL-002 finds trade prints
-- inside the frozen intervals, every row counted here with n_stale_novjan > 0
-- is quarantine scope. Companion: ol002_liveness.csv (gap item 3(i)).
-- Usage: duckdb -c ".read ol002_support.sql" from glitch-hunt/census/
SET threads TO 2; SET memory_limit='3GB';

CREATE OR REPLACE TEMP VIEW eg AS
SELECT *,
  (month IN ('2025-11','2025-12','2026-01') AND age_ms > 60000) AS stale_nj
FROM 'endgame_checkpoints.parquet';

-- token-level view (both tokens), two-sided rows
CREATE OR REPLACE TEMP VIEW tok AS
SELECT month, t_sec, stale_nj, 'UP' AS token,
       up_ask AS ask, up_bid AS bid, CAST(up_won AS INT) AS win
FROM eg WHERE up_state = 'two_sided'
UNION ALL
SELECT month, t_sec, stale_nj, 'DOWN',
       down_ask, down_bid, 1 - CAST(up_won AS INT)
FROM eg WHERE down_state = 'two_sided';

COPY (

-- 1. E-001 certainty bands: two-sided fav ask >= 0.96, per t
SELECT 'E-001_fav_ask_ge96_two_sided' AS claim, t_sec,
       'ask>=0.96' AS cell,
       COUNT(*) AS n_rows_total,
       COUNT(*) FILTER (WHERE stale_nj) AS n_stale_novjan,
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2) AS stale_pct
FROM tok WHERE ask >= 0.96 GROUP BY t_sec

UNION ALL
-- 1b. E-001 band 96/98 sub-split
SELECT 'E-001_fav_band9698_subsplit', t_sec,
       'band=' || CAST(LEAST(CAST(floor(ask*50)*2 AS INT), 98) AS VARCHAR),
       COUNT(*), COUNT(*) FILTER (WHERE stale_nj),
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2)
FROM tok WHERE ask >= 0.96 GROUP BY t_sec, LEAST(CAST(floor(ask*50)*2 AS INT), 98)

UNION ALL
-- 1c. E-001 takeable-scan universe (all two-sided token rows), per t
SELECT 'E-001_takeable_scan_universe', t_sec, 'all_two_sided_token_rows',
       COUNT(*), COUNT(*) FILTER (WHERE stale_nj),
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2)
FROM tok GROUP BY t_sec

UNION ALL
-- 2. E-002 ch1: two-sided ask 4-20c, robust cell t>=885 and weak cell 780+840
SELECT 'E-002_ch1_longshot_4_20c', t_sec, 'ask in [0.04,0.20]',
       COUNT(*), COUNT(*) FILTER (WHERE stale_nj),
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2)
FROM tok WHERE ask >= 0.04 AND ask <= 0.20 GROUP BY t_sec

UNION ALL
-- 3. OL-001: two-sided fav bid bands 90-98 at t=897/899
SELECT 'OL-001_fav_bid_9098', t_sec, 'bid band 90-98',
       COUNT(*), COUNT(*) FILTER (WHERE stale_nj),
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2)
FROM tok
WHERE t_sec IN (897, 899) AND bid >= 0.90 AND bid < 1.0
GROUP BY t_sec

UNION ALL
-- 4. Endgame taxonomy shares: per (t, up_state)
SELECT 'endgame_taxonomy', t_sec, 'up_state=' || up_state,
       COUNT(*), COUNT(*) FILTER (WHERE stale_nj),
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2)
FROM eg GROUP BY t_sec, up_state

UNION ALL
-- 5. friction_map_endgame cells (two-sided, up-book band): cells w/ stale rows
SELECT 'friction_map_endgame_cell', t_sec,
       'band_c=' || CAST(band_c AS VARCHAR),
       COUNT(*), COUNT(*) FILTER (WHERE stale_nj),
       round(100.0 * COUNT(*) FILTER (WHERE stale_nj) / COUNT(*), 2)
FROM eg
WHERE up_state = 'two_sided' AND band_c IS NOT NULL
GROUP BY t_sec, band_c
HAVING COUNT(*) FILTER (WHERE stale_nj) > 0

ORDER BY claim, t_sec, cell
) TO 'ol002_support.csv' (HEADER);

-- console summary
SELECT claim, SUM(n_rows_total) AS rows_total, SUM(n_stale_novjan) AS stale_nj
FROM read_csv_auto('ol002_support.csv')
GROUP BY claim ORDER BY claim;
