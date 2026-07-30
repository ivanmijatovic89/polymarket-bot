# Experiment ledger

One line per experiment (mission 02). Append-only; details live in the
family file. Columns: id | date | variant/family | universe | run id(s) |
verdict | evidence pointer.

| id | date | family | universe | runs | verdict | detail |
| --- | --- | --- | --- | --- | --- | --- |
| E-001 | 2026-07-30 | pair-v0 defaults (inc 10, cap $50, gate 0.98, ttl 90s) | 50 oldest floor mkts (2026-04-02+) @ 140/20ms | 861 (smoke), 862 (fleet) | baseline works mechanically; NOT profitable on this universe/date (EV −2.43/mkt, p/100 −8.94) | pair-v0.md |
| E-002 | 2026-07-30 | pair-v0 noise floor (identical config ×2) | 300 oldest @ 140/20ms | 865, 868 | Δev 0.0008, daily corr 1.0 — passive-maker family near-deterministic under jitter | pair-v0.md + evaluator.md §Noise |
| E-003 | 2026-07-30 | pair-v0 latency sweep | 300 oldest @ 140/300/600/1000ms | 865, 866, 867, 869 | ev flat (−2.35→−2.25, no collapse) BUT taker share rises 1.4%→9.1% — placement-time maker check decays with latency | pair-v0.md |
| E-004 | 2026-07-30 | pair-v0 maxPairCost=0.95 | 300 oldest @ 140/20ms | 863 (vs 868) | ev +0.29 better but p/100 worse (−10.10 vs −9.19): trades less, loses less — direction not cure; daily corr vs default 0.9989 | pair-v0.md |
| E-005 | 2026-07-30 | pair-v0 defaults, FULL universe | 10,747 mkts 2026-04-02→07-27 @ 140/20ms | 870 | loss is stationary: monthly ev −2.21..−2.26 all 4 months, 0 of 16 positive weeks — structural (unpaired residue), not regime; v0 defaults time-scoped KILL @ 2026-07; evaluate.ts full pipeline verdict FAILS-S2-FULL | pair-v0.md §Definitive evaluation |
