-- Round 4 probe (gabagool) — run from glitch-hunt/
-- Pre-registration: census/round4_prereg.md (written BEFORE these queries).
-- SET threads=2; SET memory_limit='2GB';

-- Token-level view: holdout only, two-sided books, prev-window outcome
-- joined on epoch-900 (17,113/17,126 episodes have a resolved prev window).
CREATE TEMP VIEW toks AS
SELECT h.slug, h.epoch, h.month, h.t_sec, h.age_ms, s.side,
       CASE WHEN s.side='UP' THEN h.up_ask ELSE h.down_ask END ask,
       CASE WHEN s.side='UP' THEN h.down_ask ELSE h.up_ask END opp_ask,
       CASE WHEN s.side='UP' THEN (h.result_id=0) ELSE (h.result_id=1) END won,
       CASE WHEN s.side='UP' THEN (p.result_id=0) ELSE (p.result_id=1) END prev_won
FROM 'replication/holdout_checkpoints.parquet' h
JOIN read_csv_auto('census/outcomes_all.csv') p ON p.epoch = h.epoch - 900
CROSS JOIN (SELECT 'UP' side UNION ALL SELECT 'DOWN') s
WHERE h.up_bid>0 AND h.up_ask<1 AND h.up_bid<h.up_ask
  AND h.down_bid>0 AND h.down_ask<1 AND h.down_bid<h.down_ask;

-- PRIMARY: prev-winner vs prev-loser, ask in [0.50,0.66), t in {15,30,45,60}
SELECT t_sec, prev_won, COUNT(*) n, AVG(ask) avg_ask, AVG(won::INT) p_win,
       100*(AVG(won::INT)-AVG(ask)) edge_c,
       (AVG(won::INT)-AVG(ask))/SQRT(AVG(won::INT)*(1-AVG(won::INT))/COUNT(*)) z
FROM toks WHERE ask>=0.50 AND ask<0.66 AND t_sec IN (15,30,45,60)
GROUP BY 1,2 ORDER BY 1,2 DESC;

-- MONTHS at t=45/60 (prev-winner in-band)
SELECT t_sec, month, COUNT(*) n, 100*(AVG(won::INT)-AVG(ask)) edge_c
FROM toks WHERE ask>=0.50 AND ask<0.66 AND prev_won AND t_sec IN (45,60)
GROUP BY 1,2 ORDER BY 1,2;

-- HARVEST: buy the complement (prev-loser token) at ITS ask when the
-- prev-winner token is in-band. Fee = 156bps x ask (in cents: 0.72c @ 0.46).
SELECT t_sec, COUNT(*) n, AVG(opp_ask) avg_opp_ask,
       100*(AVG((NOT won)::INT)-AVG(opp_ask)) gross_c
FROM toks WHERE ask>=0.50 AND ask<0.66 AND prev_won AND t_sec IN (15,30,45,60)
GROUP BY 1 ORDER BY 1;

-- SHAPE: t=60, 4c bands 0.34-0.66, both classes (adjacency check)
SELECT prev_won, FLOOR(ask/0.04)*4 band4_c, COUNT(*) n,
       100*(AVG(won::INT)-AVG(ask)) edge_c
FROM toks WHERE ask>=0.34 AND ask<0.66 AND t_sec=60
GROUP BY 1,2 ORDER BY 1 DESC,2;

-- AUDIT 1: book age by month (holdout t=15; endgame t=897)
SELECT month, COUNT(*) n, quantile_cont(age_ms,0.5)/1000.0 p50_s,
       quantile_cont(age_ms,0.9)/1000.0 p90_s,
       100.0*AVG((age_ms<60000)::INT) pct_fresh
FROM 'replication/holdout_checkpoints.parquet' WHERE t_sec=15 GROUP BY 1 ORDER BY 1;
SELECT month, COUNT(*) n, quantile_cont(age_ms,0.5)/1000.0 p50_s,
       quantile_cont(age_ms,0.9)/1000.0 p90_s,
       100.0*AVG((age_ms<60000)::INT) pct_fresh
FROM 'census/endgame_checkpoints.parquet' WHERE t_sec=897 GROUP BY 1 ORDER BY 1;

-- AUDIT 2: PR-002 locked cell, all vs fresh (age_ms<60000 at t=15)
CREATE TEMP VIEW pr AS
SELECT t0.slug, t0.month, t15.age_ms,
       CASE WHEN t0.up_ask<=0.46 THEN t0.down_ask ELSE t0.up_ask END fav_ask0,
       CASE WHEN t0.up_ask<=0.46 THEN t15.down_ask ELSE t15.up_ask END fav_ask15,
       CASE WHEN t0.up_ask<=0.46 THEN (t0.result_id=1) ELSE (t0.result_id=0) END fav_won
FROM (SELECT * FROM 'replication/holdout_checkpoints.parquet' WHERE t_sec=0
      AND up_bid>0 AND up_ask<1 AND up_bid<up_ask AND down_bid>0 AND down_ask<1 AND down_bid<down_ask) t0
JOIN (SELECT * FROM 'replication/holdout_checkpoints.parquet' WHERE t_sec=15
      AND up_bid>0 AND up_ask<1 AND up_bid<up_ask AND down_bid>0 AND down_ask<1 AND down_bid<down_ask) t15
  USING (slug)
WHERE (t0.up_ask<=0.46 OR t0.down_ask<=0.46);
SELECT month,
       COUNT(*) FILTER (WHERE incell) n_all,
       100*(AVG(fav_won::INT) FILTER (WHERE incell) - AVG(fav_ask15) FILTER (WHERE incell)) edge_all,
       COUNT(*) FILTER (WHERE incell AND age_ms<60000) n_fresh,
       100*(AVG(fav_won::INT) FILTER (WHERE incell AND age_ms<60000) - AVG(fav_ask15) FILTER (WHERE incell AND age_ms<60000)) edge_fresh
FROM (SELECT *, (fav_ask15 >= fav_ask0 - 0.005) incell FROM pr)
GROUP BY 1 ORDER BY 1;

-- AUDIT 3: E-002 channel 1 (two-sided, ask 4-20c, t>=885), all vs fresh
CREATE TEMP VIEW eg AS
SELECT month, age_ms, s.side,
       CASE WHEN s.side='UP' THEN up_ask ELSE down_ask END ask,
       CASE WHEN s.side='UP' THEN up_won ELSE NOT up_won END won
FROM 'census/endgame_checkpoints.parquet'
CROSS JOIN (SELECT 'UP' side UNION ALL SELECT 'DOWN') s
WHERE up_state='two_sided' AND down_state='two_sided' AND t_sec>=885;
SELECT month,
       COUNT(*) FILTER (WHERE ask>=0.04 AND ask<=0.20) n_all,
       100*(AVG(won::INT) FILTER (WHERE ask>=0.04 AND ask<=0.20) - AVG(ask) FILTER (WHERE ask>=0.04 AND ask<=0.20)) edge_all,
       COUNT(*) FILTER (WHERE ask>=0.04 AND ask<=0.20 AND age_ms<60000) n_fresh,
       100*(AVG(won::INT) FILTER (WHERE ask>=0.04 AND ask<=0.20 AND age_ms<60000) - AVG(ask) FILTER (WHERE ask>=0.04 AND ask<=0.20 AND age_ms<60000)) edge_fresh
FROM eg GROUP BY 1 ORDER BY 1;

-- AUDIT 4: primary cell fresh-book restatement
SELECT t_sec, COUNT(*) n_all, 100*(AVG(won::INT)-AVG(ask)) edge_all,
       COUNT(*) FILTER (WHERE age_ms<60000) n_fresh,
       100*(AVG(won::INT) FILTER (WHERE age_ms<60000) - AVG(ask) FILTER (WHERE age_ms<60000)) edge_fresh
FROM toks WHERE ask>=0.50 AND ask<0.66 AND prev_won AND t_sec IN (30,45,60)
GROUP BY 1 ORDER BY 1;
