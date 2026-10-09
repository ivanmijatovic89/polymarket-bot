# Host facts: worker-1 (2026-10-09)

Recorded by `scripts/native/bench-l1-host-facts.ts` for 16 §2.3 (M1 step 7).
Every benchmark report of this host repeats the core line below (16 §13.5).

- Host: worker-1 (`Worker-1s-Mac-mini.local`), model `Mac16,10`
- Chip: Apple M4, 4P + 6E (10 logical)
- Memory: 16 GiB (`hw.memsize` 17179869184)
- Cache line: 128 B; page size: 16 KiB
- macOS 26.2 (build 25C56)
- Toolchain: rustc 1.89.0 (29483883e 2025-08-04); cargo 1.89.0 (c24e10642 2025-06-23); Node 20.20.2
- Power: AC Power; Low Power Mode off

## Core layout per performance level (`sysctl hw.perflevelN.*`)

| Level | Name        | Physical | Logical | L1i per core | L1d per core | L2 per cluster | CPUs per L2 | Clusters |
| ----- | ----------- | -------- | ------- | ------------ | ------------ | -------------- | ----------- | -------- |
| 0     | Performance | 4        | 4       | 192 KiB      | 128 KiB      | 16 MiB         | 4           | 1        |
| 1     | Efficiency  | 6        | 6       | 128 KiB      | 64 KiB       | 4 MiB          | 6           | 1        |

## Fleet configuration

- `cores_for_backtest` (dashboard/src/data/machines.json): 8
- Load average at recording time (1/5/15 min): 6.45 / 6.17 / 5.34

## Notes for 16 §2.3 (hand-written)

- The worker-1 row of 16 §2.3 reads "to record via sysctl in M1 step 7" for
  L2: one 16 MiB L2 shared by the 4 P-cores, one 4 MiB L2 shared by the
  6 E-cores. worker-2 is the same model (`Mac16,10`, machines.json) and is
  expected to match; it is recorded in M6 (16 §10.3).
- Against m1-ivan (M1 Pro, 2 × 12 MB P clusters of 4 cores, 4 MB E
  cluster): worker-1 has one P cluster with more L2 per cluster but fewer
  P-cores (4 vs 8), the same L1d sizes (128 KiB P / 64 KiB E) and the same
  128-byte cache line.
- Shared L2 per core: 4 MiB per P-core, about 683 KiB per E-core when all
  six are busy. A 4,096-event tape batch (~290 KB, 16 §7.3) and the dense
  ladder's hot lines (16 BK-3) fit both.
- The recording load average (6.45) shows the fleet worker and Global
  Runtime running; these facts do not depend on load.
