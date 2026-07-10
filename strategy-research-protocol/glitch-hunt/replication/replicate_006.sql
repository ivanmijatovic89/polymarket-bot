-- REPLICATION-006 — independent measurement, written by the replicator
-- from the falsifiable claim in memos/006-midwindow-favorite-discount.md
-- and the frozen spec in mantis's SURVIVES verdict. No SQL reused from
-- round6_gabagool_probe.sql or round6_probe.sql.
--
-- Data: census/checkpoints.parquet ONLY (2,000-episode census sample,
-- episode-disjoint from the holdout; overlap verified = 0).
--
-- Rule (frozen): per (slug, token), first 15s-grid checkpoint with
-- t_sec in [240, 360] where the token's book is two-sided
-- (bid > 0, ask < 1, ask > bid) and ask in [0.82, 0.86).
-- One entry per (slug, token). dev = win - ask_at_entry.
-- One-tick stratum: ask - bid <= 0.011.
PRAGMA threads=2;
SET memory_limit='3GB';

CREATE TEMP TABLE entries AS
WITH cp AS (
  SELECT slug, month, t_sec, up_won,
         up_best_bid, up_best_ask, down_best_bid, down_best_ask,
         last_event_age_ms
  FROM 'census/checkpoints.parquet'
  WHERE t_sec BETWEEN 240 AND 360
),
tok AS (
  SELECT slug, month, t_sec, last_event_age_ms,
         'UP' AS token, up_best_bid AS bid, up_best_ask AS ask,
         CASE WHEN up_won THEN 1.0 ELSE 0.0 END AS won
  FROM cp
  UNION ALL
  SELECT slug, month, t_sec, last_event_age_ms,
         'DOWN', down_best_bid, down_best_ask,
         CASE WHEN up_won THEN 0.0 ELSE 1.0 END
  FROM cp
),
eligible AS (
  SELECT *, ask - bid AS spr
  FROM tok
  WHERE bid IS NOT NULL AND ask IS NOT NULL
    AND bid > 0 AND ask < 1 AND ask > bid
    AND ask >= 0.82 AND ask < 0.86
)
SELECT * EXCLUDE (rn) FROM (
  SELECT *,
         row_number() OVER (PARTITION BY slug, token ORDER BY t_sec) AS rn
  FROM eligible
) WHERE rn = 1;

-- 1. Pooled
SELECT 'POOLED' AS cut, count(*) AS n,
       avg(won) AS p_win, avg(ask) AS avg_ask,
       avg(won - ask) AS dev,
       avg(won - ask) / (stddev_samp(won - ask) / sqrt(count(*))) AS z
FROM entries;

-- 2. Spread strata (one-tick vs wide)
SELECT CASE WHEN spr <= 0.011 THEN 'one_tick' ELSE 'wide' END AS stratum,
       count(*) AS n, avg(won) AS p_win, avg(ask) AS avg_ask,
       avg(won - ask) AS dev,
       avg(won - ask) / (stddev_samp(won - ask) / sqrt(count(*))) AS z
FROM entries GROUP BY 1 ORDER BY 1;

-- 3. Per-month breakdown
SELECT month, count(*) AS n, avg(won) AS p_win, avg(ask) AS avg_ask,
       avg(won - ask) AS dev
FROM entries GROUP BY 1 ORDER BY 1;

-- 4. Per-token arms
SELECT token, count(*) AS n, avg(won) AS p_win, avg(ask) AS avg_ask,
       avg(won - ask) AS dev
FROM entries GROUP BY 1 ORDER BY 1;

-- 5. Secondary read: t=300-exact subset (entry evaluated at t=300 only)
SELECT 't300_exact' AS cut, count(*) AS n, avg(won) AS p_win,
       avg(ask) AS avg_ask, avg(won - ask) AS dev
FROM entries WHERE t_sec = 300;

-- 6. Entry-t distribution + stale (any-asset event age > 60s) count
SELECT t_sec, count(*) AS n FROM entries GROUP BY 1 ORDER BY 1;
SELECT count(*) AS n_stale,
       avg(won - ask) FILTER (WHERE last_event_age_ms <= 60000) AS dev_fresh,
       count(*) FILTER (WHERE last_event_age_ms <= 60000) AS n_fresh
FROM entries WHERE last_event_age_ms > 60000
UNION ALL BY NAME
SELECT NULL, avg(won - ask), count(*) FROM entries WHERE last_event_age_ms <= 60000;
