-- Round 6 gabagool adjudication probes G1-G4 (pre-registered in
-- round6_prereg.md BEFORE this file was written or run).
-- Usage: duckdb -c ".read round6_gabagool_probe.sql" from glitch-hunt/census/

SET threads TO 2; SET memory_limit='3GB';

-- Region R: t=300, both tokens two-sided, token ask in [0.82, 0.86)
CREATE OR REPLACE TEMP VIEW rows_a AS
SELECT slug, month, t_sec, up_won, age_ms,
       up_bid, up_ask, down_bid, down_ask
FROM 'midwindow_checkpoints.parquet'
WHERE t_sec = 300
  AND up_bid IS NOT NULL AND up_ask IS NOT NULL
  AND down_bid IS NOT NULL AND down_ask IS NOT NULL;

CREATE OR REPLACE TEMP VIEW tok AS
SELECT month, 'UP' AS token, up_ask AS ask, up_ask - up_bid AS spr,
       CAST(up_won AS INT) AS win
FROM rows_a WHERE up_bid > 0 AND up_ask < 1 AND up_ask > up_bid
UNION ALL
SELECT month, 'DOWN', down_ask, down_ask - down_bid,
       1 - CAST(up_won AS INT)
FROM rows_a WHERE down_bid > 0 AND down_ask < 1 AND down_ask > down_bid;

CREATE OR REPLACE TEMP VIEW region AS
SELECT * FROM tok WHERE ask >= 0.82 AND ask < 0.86;

-- G1a: pooled + per-token
SELECT 'G1a' AS q, token, COUNT(*) AS n, round(AVG(win),4) AS p_win,
       round(AVG(ask),4) AS avg_ask,
       round((AVG(win)-AVG(ask))*100,2) AS dev_c,
       round((AVG(win)-AVG(ask))/sqrt(AVG(win)*(1-AVG(win))/COUNT(*)),2) AS z
FROM region GROUP BY token
UNION ALL
SELECT 'G1a', 'POOLED', COUNT(*), round(AVG(win),4), round(AVG(ask),4),
       round((AVG(win)-AVG(ask))*100,2),
       round((AVG(win)-AVG(ask))/sqrt(AVG(win)*(1-AVG(win))/COUNT(*)),2)
FROM region ORDER BY token;

-- G1b: per (month, token) and pooled month vector
SELECT 'G1b' AS q, month, token, COUNT(*) AS n_m,
       round((AVG(win)-AVG(ask))*100,2) AS dev_m_c
FROM region GROUP BY month, token ORDER BY month, token;

SELECT 'G1b_pooled' AS q, month, COUNT(*) AS n_m,
       round(AVG(win),4) AS p_win,
       round((AVG(win)-AVG(ask))*100,2) AS dev_m_c
FROM region GROUP BY month ORDER BY month;

-- G2: spread split (one-tick vs wider)
SELECT 'G2' AS q,
       CASE WHEN spr <= 0.011 THEN 'one_tick' ELSE 'wider' END AS stratum,
       COUNT(*) AS n, round(AVG(spr)*100,2) AS avg_spr_c,
       round(AVG(win),4) AS p_win, round(AVG(ask),4) AS avg_ask,
       round((AVG(win)-AVG(ask))*100,2) AS dev_c,
       round((AVG(win)-AVG(ask))/sqrt(AVG(win)*(1-AVG(win))/COUNT(*)),2) AS z
FROM region GROUP BY 2 ORDER BY 2;

-- G4: comparison-debt arithmetic over the published scan dump.
-- H0: p_true = avg_ask. thr = dev - margin (cents -> fraction). SE0 from ask.
-- Phi via logistic approx. Cells with NULL margin (friction-unpriced) carry
-- no gate-1 probability (they could never pass).
CREATE OR REPLACE TEMP VIEW debt AS
SELECT token, t_sec, band, n,
       avg_ask,
       (dev_c - margin_c)/100.0 AS thr,
       sqrt(avg_ask*(1-avg_ask)/n) AS se0,
       1.0/(1.0+exp(1.702*((dev_c - margin_c)/100.0)
            / sqrt(avg_ask*(1-avg_ask)/n))) AS p_gate1
FROM read_csv_auto('round6_gatestack_cells.csv')
WHERE margin_c IS NOT NULL;

SELECT 'G4' AS q,
       COUNT(*) AS cells_priced,
       round(SUM(p_gate1),2) AS exp_gate1,
       round(SUM(p_gate1)*0.25*0.145,3) AS exp_survivors_lo,
       round(SUM(p_gate1)*0.25*0.45,3) AS exp_survivors_hi,
       round(371 * (1.0/(1.0+exp(1.702*2.42))),2) AS exp_z_ge_242
FROM debt;
