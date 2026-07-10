-- Self-check aggregation by month (run after extraction completes).
-- cd strategy-research-protocol/glitch-hunt/census && duckdb -c ".read selfcheck_by_month.sql"
SET threads TO 2;
SET memory_limit='3GB';
WITH s AS (
  SELECT slug,
         CAST(snapshots_checked AS BIGINT) AS checked,
         CAST(mismatches AS BIGINT) AS mism,
         CAST(stale_explained AS BIGINT) AS stale
  FROM read_csv('selfcheck.csv', header=true,
    columns={'slug':'VARCHAR','snapshots_checked':'VARCHAR','mismatches':'VARCHAR',
             'stale_explained':'VARCHAR','n_events':'VARCHAR'})
  WHERE snapshots_checked != 'ERROR'
)
SELECT m.month,
       count(*) AS episodes,
       sum(s.checked) AS snaps_checked,
       sum(s.mism) AS mismatches,
       sum(s.stale) AS stale_explained,
       round(100.0 * sum(s.mism) / nullif(sum(s.checked), 0), 3) AS raw_pct,
       round(100.0 * (sum(s.mism) - sum(s.stale)) / nullif(sum(s.checked), 0), 3) AS hard_pct,
       round(sum(s.checked) / count(*), 0) AS snaps_per_ep,
       round(sum(s.mism) / 2.0 / count(*), 1) AS incidents_per_ep
FROM s
JOIN read_csv('sample_manifest.csv', header=true) m USING (slug)
GROUP BY ROLLUP (m.month)
ORDER BY m.month NULLS LAST;
