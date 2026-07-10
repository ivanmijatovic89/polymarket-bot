-- Round 6 probe — surveyor (interleave slot). Memo 005 Part A's EXACT frozen
-- gate stack (round5_probe.sql Part A; gates pre-declared in round5_prereg.md,
-- frozen since round 3), run over the NEW mid-window holdout extraction at
-- t in {300, 450, 600, 690} (~9.5x census density). Zero cells carried from
-- round 5. Gates unchanged: (1) dev > p25_spread + 156bps x avg_ask at the
-- census friction-map cell (fn >= 30 required else FRICTION-UNPRICED);
-- (2) adjacent-band sign agreement, neighbor n >= 50 else FAIL;
-- (3) >= 6/8-month sign consistency (month counts iff n_m >= 10).
-- dev - med_spread (p50 FULL spread) reported per S-001. No z gate (info
-- only). No prev-window-outcome axis (K-004 ban). INFO-ONLY additions
-- (not gates, confession per prereg): n_stale (age_ms > 60s) per cell and
-- dev on fresh rows (age_ms < 60s) — the staleness axis per A-001/PR-005.
-- Usage: duckdb -c ".read round6_probe.sql" from glitch-hunt/census/

SET threads TO 2; SET memory_limit='3GB';

CREATE OR REPLACE TEMP VIEW rows_a AS
SELECT slug, month, t_sec, up_won, age_ms,
       up_bid, up_ask, down_bid, down_ask
FROM 'midwindow_checkpoints.parquet'
WHERE t_sec IN (300, 450, 600, 690)
  AND up_bid IS NOT NULL AND up_ask IS NOT NULL
  AND down_bid IS NOT NULL AND down_ask IS NOT NULL;

CREATE OR REPLACE TEMP VIEW tok AS
SELECT month, t_sec, age_ms, 'UP' AS token, up_ask AS ask,
       CAST(up_won AS INT) AS win
FROM rows_a
WHERE up_bid > 0 AND up_ask < 1 AND up_ask > up_bid
UNION ALL
SELECT month, t_sec, age_ms, 'DOWN', down_ask, 1 - CAST(up_won AS INT)
FROM rows_a
WHERE down_bid > 0 AND down_ask < 1 AND down_ask > down_bid;

CREATE OR REPLACE TEMP VIEW cells AS
SELECT token, t_sec,
       LEAST(CAST(floor(ask*50)*2 AS INT), 98) AS band,
       COUNT(*) AS n, AVG(win) AS p_win, AVG(ask) AS avg_ask,
       AVG(win) - AVG(ask) AS dev,
       COUNT(*) FILTER (WHERE age_ms > 60000) AS n_stale,
       AVG(win) FILTER (WHERE age_ms < 60000)
         - AVG(ask) FILTER (WHERE age_ms < 60000) AS dev_fresh
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
       c.n_stale, c.dev_fresh,
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

-- A0: debt ledger counts + per-gate pass/fail
SELECT 'A0_debt' AS q, COUNT(*) AS cells_n150,
       COUNT(*) FILTER (WHERE fn IS NULL OR fn < 30) AS friction_unpriced,
       COUNT(*) FILTER (WHERE fn >= 30 AND margin > 0) AS gate1_pass,
       COUNT(*) FILTER (WHERE fn >= 30 AND margin > 0
         AND n_lo >= 50 AND n_hi >= 50
         AND sign(dev_lo) = sign(dev) AND sign(dev_hi) = sign(dev)) AS gate12_pass,
       COUNT(*) FILTER (WHERE fn >= 30 AND margin > 0
         AND n_lo >= 50 AND n_hi >= 50
         AND sign(dev_lo) = sign(dev) AND sign(dev_hi) = sign(dev)
         AND months_agree >= 6) AS gate123_pass,
       COUNT(*) FILTER (WHERE months_agree >= 6) AS gate3_alone,
       COUNT(*) FILTER (WHERE n_lo >= 50 AND n_hi >= 50
         AND sign(dev_lo) = sign(dev) AND sign(dev_hi) = sign(dev)) AS gate2_alone
FROM scored;

-- A1: full gate stack survivors
SELECT 'A1_survivors' AS q, *
FROM scored
WHERE fn >= 30 AND margin > 0
  AND n_lo >= 50 AND n_hi >= 50
  AND sign(dev_lo) = sign(dev) AND sign(dev_hi) = sign(dev)
  AND months_agree >= 6
ORDER BY margin DESC;

-- A2: gate-1 passers regardless of gates 2-3 (for the map)
SELECT 'A2_gate1' AS q, token, t_sec, band, n,
       round(dev*100, 2) AS dev_c, round(margin*100, 2) AS margin_c,
       round(dev_minus_p50spread*100, 2) AS dev_m_p50_c,
       round(z, 2) AS z, months_agree,
       round(dev_lo*100, 2) AS dev_lo_c, n_lo,
       round(dev_hi*100, 2) AS dev_hi_c, n_hi,
       round(depth_take, 0) AS depth,
       n_stale, round(dev_fresh*100, 2) AS dev_fresh_c
FROM scored
WHERE fn >= 30 AND margin > 0
ORDER BY margin DESC;

-- A3: region summary — dev by t and coarse band (info only)
SELECT 'A3_summary' AS q, token,
       t_sec,
       CAST(band / 20 AS INT) * 20 AS band_20,
       SUM(n) AS n, round(AVG(dev)*100, 2) AS avg_dev_c,
       round(MIN(dev)*100, 2) AS min_dev_c, round(MAX(dev)*100, 2) AS max_dev_c,
       round(AVG(p25_spread + fee)*100, 2) AS avg_friction_c
FROM scored GROUP BY 1, 2, 3, 4 ORDER BY 2, 3, 4;

-- A4: full scored cell dump for the record
COPY (
  SELECT token, t_sec, band, n, round(p_win, 4) AS p_win,
         round(avg_ask, 4) AS avg_ask, round(dev*100, 2) AS dev_c,
         fn, round(p25_spread*100, 2) AS p25_spread_c,
         round(med_spread*100, 2) AS med_spread_c,
         round(margin*100, 2) AS margin_c,
         round(dev_minus_p50spread*100, 2) AS dev_m_p50_c,
         round(z, 2) AS z, months_agree,
         round(dev_lo*100, 2) AS dev_lo_c, n_lo,
         round(dev_hi*100, 2) AS dev_hi_c, n_hi,
         round(depth_take, 0) AS depth_take,
         n_stale, round(dev_fresh*100, 2) AS dev_fresh_c
  FROM scored ORDER BY token, t_sec, band
) TO 'round6_gatestack_cells.csv' (HEADER);
