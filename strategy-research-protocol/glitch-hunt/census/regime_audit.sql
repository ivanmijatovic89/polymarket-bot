-- Regime-shift audit of standing atlas claims (ATLAS gap item 1, round 7).
-- Recuts each standing falsifiable claim on 2025-10..2026-02 (early) vs
-- 2026-03..2026-05 (late), FRESH books (age_ms < 60000), using
-- census/endgame_checkpoints.parquet only (17,126 holdout episodes,
-- t in {780,840,870,885,897,899}). Labeling only — no new claims.
-- Run from strategy-research-protocol/glitch-hunt/ :
--   nice -n 19 duckdb < census/regime_audit.sql
SET threads TO 2;
SET memory_limit='3GB';

-- Token-level view, fresh books only.
CREATE TEMP TABLE tok AS
WITH e AS (
  SELECT month, t_sec, age_ms,
         CASE WHEN month <= '2026-02' THEN '2025-10..2026-02' ELSE '2026-03..2026-05' END AS regime,
         up_bid, up_ask, down_bid, down_ask, result_id
  FROM 'census/endgame_checkpoints.parquet'
  WHERE age_ms IS NOT NULL AND age_ms < 60000
)
SELECT regime, month, t_sec, 'UP' AS token, up_bid AS bid, up_ask AS ask,
       (up_bid IS NOT NULL AND up_ask IS NOT NULL) AS two_sided,
       CASE WHEN result_id = 0 THEN 1.0 ELSE 0.0 END AS won
FROM e
UNION ALL
SELECT regime, month, t_sec, 'DOWN', down_bid, down_ask,
       (down_bid IS NOT NULL AND down_ask IS NOT NULL),
       CASE WHEN result_id = 1 THEN 1.0 ELSE 0.0 END
FROM e;

-- E-001a: fav ask >= 0.96, two-sided, t >= 885: stays within +-1c gross.
CREATE TEMP TABLE e001a AS
SELECT 'E-001 fav96 within +-1c gross, t>=885' AS claim, regime, t_sec,
       count(*) AS n, round(avg(won), 4) AS p_win, round(avg(ask), 4) AS avg_price,
       round(100*avg(won - ask), 3) AS dev_c,
       round(avg(won - ask) / nullif(stddev_samp(won - ask) / sqrt(count(*)), 0), 2) AS z,
       CASE WHEN abs(avg(won - ask)) <= 0.01 THEN 'SUPPORTED' ELSE 'UNSUPPORTED' END AS label
FROM tok
WHERE two_sided AND ask >= 0.96 AND ask <= 1 AND t_sec >= 885
GROUP BY regime, t_sec;

-- E-001b: no two ADJACENT takeable 2c ask bands both clear 156bps*ask at
-- z >= 2 same-direction, POSITIVE direction (taker-harvestable — the
-- claim's guard; adjacent NEGATIVE pairs are E-002's own channel and the
-- S-001 negative-shifted field norm, recorded separately below).
-- Cells n >= 150, all endgame t.
CREATE TEMP TABLE cells AS
SELECT regime, t_sec, least(cast(floor(ask*50) AS INT)*2, 98) AS band,
       count(*) AS n, avg(won - ask) AS dev, 0.0156*avg(ask) AS fee,
       avg(won - ask) / nullif(stddev_samp(won - ask) / sqrt(count(*)), 0) AS z
FROM tok WHERE two_sided AND ask IS NOT NULL
GROUP BY 1, 2, 3 HAVING count(*) >= 150;

CREATE TEMP TABLE e001b AS
SELECT 'E-001 no adjacent fee-clearing band pair (positive)' AS claim,
       r.regime, NULL::INT AS t_sec,
       count(q.regime) AS n, NULL::DOUBLE AS p_win, NULL::DOUBLE AS avg_price,
       NULL::DOUBLE AS dev_c, NULL::DOUBLE AS z,
       CASE WHEN count(q.regime) = 0 THEN 'SUPPORTED' ELSE 'UNSUPPORTED' END AS label
FROM (
  SELECT a.regime FROM cells a JOIN cells b
    ON a.regime = b.regime AND a.t_sec = b.t_sec AND b.band = a.band + 2
  WHERE a.dev > a.fee AND b.dev > b.fee AND a.z >= 2 AND b.z >= 2
) q RIGHT JOIN (SELECT DISTINCT regime FROM cells) r ON q.regime = r.regime
GROUP BY r.regime;

-- E-002 ch.1 robust cell: longshot ask in [0.04, 0.20), two-sided,
-- t >= 885: dev stays <= -1c (fresh books).
CREATE TEMP TABLE e002 AS
SELECT 'E-002 longshot 4-20c <= -1c, t>=885' AS claim, regime, t_sec,
       count(*) AS n, round(avg(won), 4) AS p_win, round(avg(ask), 4) AS avg_price,
       round(100*avg(won - ask), 3) AS dev_c,
       round(avg(won - ask) / nullif(stddev_samp(won - ask) / sqrt(count(*)), 0), 2) AS z,
       CASE WHEN avg(won - ask) <= -0.01 THEN 'SUPPORTED' ELSE 'UNSUPPORTED' END AS label
FROM tok
WHERE two_sided AND ask >= 0.04 AND ask < 0.20 AND t_sec >= 885
GROUP BY regime, t_sec;

-- OL-001: two-sided fav BID bands 90-98 at t in {897,899}:
-- standing margin P(win) - bid >= +1.5c.
CREATE TEMP TABLE ol001 AS
SELECT 'OL-001 fav bid margin >= +1.5c, t=897/899' AS claim, regime, t_sec,
       count(*) AS n, round(avg(won), 4) AS p_win, round(avg(bid), 4) AS avg_price,
       round(100*avg(won - bid), 3) AS dev_c,
       round(avg(won - bid) / nullif(stddev_samp(won - bid) / sqrt(count(*)), 0), 2) AS z,
       CASE WHEN avg(won - bid) >= 0.015 THEN 'SUPPORTED' ELSE 'UNSUPPORTED' END AS label
FROM tok
WHERE two_sided AND bid >= 0.90 AND bid < 1 AND t_sec IN (897, 899)
GROUP BY regime, t_sec;

COPY (
  SELECT * FROM e001a
  UNION ALL SELECT * FROM e001b
  UNION ALL SELECT * FROM e002
  UNION ALL SELECT * FROM ol001
  ORDER BY claim, regime, t_sec NULLS FIRST
) TO 'census/regime_audit.csv' (HEADER);

SELECT * FROM 'census/regime_audit.csv';

-- Supporting detail: monthly vector for each claim cell (context only).
SELECT 'E002_monthly' AS what, month, t_sec, count(*) AS n,
       round(100*avg(won - ask), 3) AS dev_c
FROM tok WHERE two_sided AND ask >= 0.04 AND ask < 0.20 AND t_sec >= 885
GROUP BY month, t_sec ORDER BY month, t_sec;

SELECT 'E001a_monthly' AS what, month, t_sec, count(*) AS n,
       round(100*avg(won - ask), 3) AS dev_c
FROM tok WHERE two_sided AND ask >= 0.96 AND ask <= 1 AND t_sec >= 885
GROUP BY month, t_sec ORDER BY month, t_sec;

SELECT 'OL001_monthly' AS what, month, t_sec, count(*) AS n,
       round(100*avg(won - bid), 3) AS margin_c
FROM tok WHERE two_sided AND bid >= 0.90 AND bid < 1 AND t_sec IN (897, 899)
GROUP BY month, t_sec ORDER BY month, t_sec;
