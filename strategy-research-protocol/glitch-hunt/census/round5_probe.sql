-- Round 5 probe — gabagool. Runs AFTER census/round5_prereg.md (see mtimes).
-- Part A: friction-priced mid-window sweep t 75..765 (gap item 1, frozen spec)
-- Part B: stale-quote endgame pocket (gap item 2)
-- Usage: duckdb -c ".read round5_probe.sql" from glitch-hunt/census/

-- ============ PART A ============

CREATE OR REPLACE TEMP VIEW rows_a AS
SELECT slug, month, t_sec, up_won,
       up_best_bid, up_best_ask, down_best_bid, down_best_ask
FROM 'checkpoints.parquet'
WHERE t_sec BETWEEN 75 AND 765 AND t_sec % 15 = 0
  AND up_best_bid IS NOT NULL AND up_best_ask IS NOT NULL
  AND down_best_bid IS NOT NULL AND down_best_ask IS NOT NULL;

CREATE OR REPLACE TEMP VIEW tok AS
SELECT month, t_sec, 'UP' AS token, up_best_ask AS ask,
       CAST(up_won AS INT) AS win
FROM rows_a
WHERE up_best_bid > 0 AND up_best_ask < 1 AND up_best_ask > up_best_bid
UNION ALL
SELECT month, t_sec, 'DOWN', down_best_ask, 1 - CAST(up_won AS INT)
FROM rows_a
WHERE down_best_bid > 0 AND down_best_ask < 1 AND down_best_ask > down_best_bid;

CREATE OR REPLACE TEMP VIEW cells AS
SELECT token, t_sec,
       LEAST(CAST(floor(ask*50)*2 AS INT), 98) AS band,
       COUNT(*) AS n, AVG(win) AS p_win, AVG(ask) AS avg_ask,
       AVG(win) - AVG(ask) AS dev
FROM tok GROUP BY 1, 2, 3;

CREATE OR REPLACE TEMP VIEW mcells AS
SELECT token, t_sec,
       LEAST(CAST(floor(ask*50)*2 AS INT), 98) AS band,
       month, COUNT(*) AS n_m, AVG(win) - AVG(ask) AS dev_m
FROM tok GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE TEMP VIEW fric AS
SELECT t_sec, band_c, n AS fn, med_spread, p25_spread,
       med_top3_bid, med_top3_ask
FROM read_csv_auto('friction_map.csv')
WHERE source = 'census';

CREATE OR REPLACE TEMP VIEW scored AS
SELECT c.token, c.t_sec, c.band, c.n, c.p_win, c.avg_ask, c.dev,
       0.0156 * c.avg_ask AS fee,
       f.fn, f.p25_spread, f.med_spread,
       CASE c.token WHEN 'UP' THEN f.med_top3_ask ELSE f.med_top3_bid END
         AS depth_take,
       c.dev - (f.p25_spread + 0.0156 * c.avg_ask) AS margin,
       c.dev - f.med_spread AS dev_minus_p50spread,
       c.dev / sqrt(GREATEST(c.p_win * (1 - c.p_win), 1e-9) / c.n) AS z,
       nb_lo.dev AS dev_lo, nb_lo.n AS n_lo,
       nb_hi.dev AS dev_hi, nb_hi.n AS n_hi,
       (SELECT COUNT(*) FROM mcells m
         WHERE m.token = c.token AND m.t_sec = c.t_sec AND m.band = c.band
           AND m.n_m >= 10 AND sign(m.dev_m) = sign(c.dev)) AS months_agree
FROM cells c
LEFT JOIN fric f
  ON f.t_sec = c.t_sec
 AND f.band_c = CASE c.token WHEN 'UP' THEN c.band ELSE 98 - c.band END
LEFT JOIN cells nb_lo
  ON nb_lo.token = c.token AND nb_lo.t_sec = c.t_sec AND nb_lo.band = c.band - 2
LEFT JOIN cells nb_hi
  ON nb_hi.token = c.token AND nb_hi.t_sec = c.t_sec AND nb_hi.band = c.band + 2
WHERE c.n >= 150;

-- A0: debt ledger counts
SELECT 'A0_debt' AS q, COUNT(*) AS cells_n150,
       COUNT(*) FILTER (WHERE fn IS NULL OR fn < 30) AS friction_unpriced,
       COUNT(*) FILTER (WHERE margin > 0) AS gate1_pass
FROM scored;

-- A1: full gate stack
SELECT 'A1_survivors' AS q, *
FROM scored
WHERE fn >= 30 AND margin > 0
  AND n_lo >= 50 AND n_hi >= 50
  AND sign(dev_lo) = sign(dev) AND sign(dev_hi) = sign(dev)
  AND months_agree >= 6
ORDER BY margin DESC;

-- A2: near-misses: gate 1 passers regardless of gates 2-3 (for the map)
SELECT 'A2_gate1' AS q, token, t_sec, band, n,
       round(dev*100, 2) AS dev_c, round(margin*100, 2) AS margin_c,
       round(dev_minus_p50spread*100, 2) AS dev_m_p50_c,
       round(z, 2) AS z, months_agree,
       round(dev_lo*100, 2) AS dev_lo_c, n_lo,
       round(dev_hi*100, 2) AS dev_hi_c, n_hi,
       round(depth_take, 0) AS depth
FROM scored
WHERE fn >= 30 AND margin > 0
ORDER BY margin DESC;

-- A3: region summary — best/worst dev by t bucket and coarse band (info only)
SELECT 'A3_summary' AS q, token,
       CAST(t_sec / 150 AS INT) * 150 AS t_bucket,
       CAST(band / 20 AS INT) * 20 AS band_20,
       SUM(n) AS n, round(AVG(dev)*100, 2) AS avg_dev_c,
       round(MIN(dev)*100, 2) AS min_dev_c, round(MAX(dev)*100, 2) AS max_dev_c,
       round(AVG(p25_spread + fee)*100, 2) AS avg_friction_c
FROM scored GROUP BY 1, 2, 3, 4 ORDER BY 2, 3, 4;

-- ============ PART B ============

-- B-i: stale share by month x t; p90 age at 897
SELECT 'Bi_staleshare' AS q, month, t_sec, COUNT(*) AS n,
       round(AVG(CASE WHEN age_ms > 60000 THEN 1.0 ELSE 0 END)*100, 1)
         AS stale_pct,
       round(quantile_cont(age_ms, 0.9)/1000.0, 1) AS p90_age_s
FROM 'endgame_checkpoints.parquet'
GROUP BY 1, 2, 3 ORDER BY month, t_sec;

-- stale token-side rows (takeable standing asks)
CREATE OR REPLACE TEMP VIEW stale_asks AS
SELECT month, t_sec, age_ms, 'UP' AS token, up_ask AS ask,
       up_ask_sz AS ask_sz, up_top3_ask AS top3,
       CAST(up_won AS INT) AS win
FROM 'endgame_checkpoints.parquet'
WHERE t_sec IN (885, 897, 899) AND age_ms > 60000
  AND up_state IN ('two_sided', 'ask_only')
  AND up_ask IS NOT NULL AND up_ask > 0 AND up_ask < 1 AND up_ask_sz > 0
UNION ALL
SELECT month, t_sec, age_ms, 'DOWN', down_ask, down_ask_sz, down_top3_ask,
       1 - CAST(up_won AS INT)
FROM 'endgame_checkpoints.parquet'
WHERE t_sec IN (885, 897, 899) AND age_ms > 60000
  AND down_state IN ('two_sided', 'ask_only')
  AND down_ask IS NOT NULL AND down_ask > 0 AND down_ask < 1
  AND down_ask_sz > 0;

-- B-ii primary: per t, pooled
SELECT 'Bii_primary' AS q, t_sec, COUNT(*) AS n,
       round(AVG(ask)*100, 2) AS avg_ask_c,
       round(AVG(win)*100, 2) AS p_win_c,
       round((AVG(win) - AVG(ask))*100, 2) AS gross_c,
       round((AVG(win) - AVG(ask) - 0.0156*AVG(ask))*100, 2) AS net_c,
       round(1.96 * sqrt(AVG(win)*(1-AVG(win))/COUNT(*))*100, 2) AS ci_hw_c
FROM stale_asks GROUP BY t_sec ORDER BY t_sec;

-- B-ii splits: age bucket x coarse band x month group, per t
SELECT 'Bii_split' AS q, t_sec,
       CASE WHEN age_ms <= 120000 THEN '60-120s' ELSE '>120s' END AS age_b,
       CASE WHEN ask <= 0.04 THEN 'a_le4c'
            WHEN ask <= 0.20 THEN 'b_4_20c'
            WHEN ask < 0.80 THEN 'c_20_80c'
            WHEN ask <= 0.96 THEN 'd_80_96c'
            ELSE 'e_gt96c' END AS band_b,
       CASE WHEN month = '2026-01' THEN 'jan26' ELSE 'other' END AS mg,
       COUNT(*) AS n,
       round(AVG(ask)*100, 2) AS avg_ask_c,
       round((AVG(win) - AVG(ask))*100, 2) AS gross_c,
       round((AVG(win) - AVG(ask) - 0.0156*AVG(ask))*100, 2) AS net_c,
       round(1.96 * sqrt(GREATEST(AVG(win)*(1-AVG(win)), 1e-9)/COUNT(*))*100, 2)
         AS ci_hw_c,
       round(median(ask_sz), 0) AS med_ask_sz, round(median(top3), 0) AS med_top3
FROM stale_asks GROUP BY 1, 2, 3, 4, 5 ORDER BY t_sec, age_b, band_b, mg;

-- B artifact check 1: rows stale at 885 — age progression at 897/899
WITH s885 AS (
  SELECT slug FROM 'endgame_checkpoints.parquet'
  WHERE t_sec = 885 AND age_ms > 60000
)
SELECT 'B_art1' AS q, e.t_sec,
       COUNT(*) AS n,
       COUNT(*) FILTER (WHERE e.age_ms > 60000) AS still_stale,
       COUNT(*) FILTER (WHERE e.age_ms <= (e.t_sec - 885) * 1000 + 500)
         AS age_reset
FROM 'endgame_checkpoints.parquet' e
JOIN s885 USING (slug)
WHERE e.t_sec IN (897, 899)
GROUP BY e.t_sec;

-- B artifact check 2: episodes frozen across the whole endgame grid
SELECT 'B_art2' AS q, month, COUNT(*) AS frozen_eps
FROM (
  SELECT slug, month
  FROM 'endgame_checkpoints.parquet'
  GROUP BY slug, month
  HAVING MIN(age_ms) > 60000
) GROUP BY month ORDER BY month;
