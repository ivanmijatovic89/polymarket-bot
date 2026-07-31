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
| E-005 | 2026-07-30 | pair-v0 defaults, FULL universe | 10,747 mkts 2026-04-02→07-23 @ 140/20ms (edge corrected per m11) | 870 | loss is stationary: monthly ev −2.21..−2.26 all 4 months, 0 of 16 positive weeks — structural (unpaired residue), not regime; v0 defaults time-scoped KILL @ 2026-07; evaluate.ts full pipeline verdict FAILS-S2-FULL | pair-v0.md §Definitive evaluation |
| E-006 | 2026-07-31 | pair-v1-a defaults (structural: join-only starts, repair-at-cap, 3min cutoff; design-ts 6a1ecde) | latest 800 (07-14→07-22) @ 140/20ms | 872 (vs 874 v0 baseline) | Δev +0.61 AND Δp/100 +1.13 — both units improve, real mechanism gain; ev −1.50 still <0 ⇒ ITERATE; taker share 13.4% (repair legs cross) is the v2 target | pair-v1.md |
| E-007 | 2026-07-31 | pair-v1-b maxPairCost=0.95 (design-ts 6a1ecde) | latest 800 @ 140/20ms | 873 (vs 874) | best family ev −1.07 (Δ +1.04 vs v0) but p/100 flat — ~half the gain is volume reduction; ITERATE; taker 15.8% | pair-v1.md |
| E-008 | 2026-07-31 | pair-v2-a defaults (repair persistence: chase-to-0.995, no repair cooldown, ask−2G guard; design-ts 0f0f423) | latest 800 @ 140/20ms | 876 (vs 872) | Δev −0.027 < 0.05 ⇒ INDISTINGUISHABLE from v1-a; doom −22 mkts but pairsPnl −139 pays it back; taker unchanged 14.1% | pair-v2.md |
| E-009 | 2026-07-31 | pair-v2-b maxPairCost=0.95 (design-ts 0f0f423) | latest 800 @ 140/20ms | 877 (vs 873) | Δev +0.036 < 0.05 ⇒ indistinguishable; replicates E-008 at second gate level ⇒ repair persistence EV-neutral, family pair-v2 KILL (time-scoped 2026-07) | pair-v2.md |
| E-010 | 2026-07-31 | pair-v1-c maxPairCost=0.96 (design-ts 0f0f423) | latest 800 @ 140/20ms | 878 (vs 874/872/873) | gate-curve midpoint: ev −1.23, p/100 −8.28 — on the monotone line | pair-v1.md |
| E-011 | 2026-07-31 | pair-v1-d maxPairCost=0.93 (design-ts 0f0f423) | latest 800 @ 140/20ms | 879 (vs curve) | best headline ev −0.55 but played 416/800, p/100 −8.38 flat ⇒ pure volume shrink; gate-curve interior-optimum hypothesis REFUTED — per-dollar loss ~−8/100 is gate-invariant | pair-v1.md |
