# Live shadowing (W3) — cumulative snapshots of the pair-accumulation meta

Script: `scripts/live-shadow.ts` (data-api /activity, last N hours per
tracked wallet, cursor-walked; pair formulas identical to
variant-scan.ts). Raw snapshots: `data/live-shadow/shadow-<hour>.json`.
Snapshot cadence target: every ~1–2h while a session is live; this file
is append-only per snapshot, with a rolling observation ledger at top.

Caveats: /activity-based, so this sees the tracked wallets only (the
on-chain variant scan is the discovery tool); pairRate/pairCost are
window-truncated (legs bought before the window opens are missing) —
treat as regime indicators, not audit numbers; `bitcoin-up-or-down-…-et`
rows are the HOURLY series (different slug scheme, caught by the
`-up-or-down-` pattern; familyOf() shows them per-day, not folded).

## Observation ledger (updated per snapshot)

- **O1 (04Z):** All 9 tracked wallets active simultaneously, all 100%
  BUY-side. The meta is intact and btc-5m-heavy: 6 of 9 have btc-5m as
  their top book; only b27bc932 is btc-15m-first in this window.
- **O2 (04Z) — CONTRADICTION with A24:** b27bc932 did **89 MERGEs in
  2h** (vs ZERO merges in the entire 2.4-day June pull). Behavior
  changed between mid-June and mid-July: it now recycles capital via
  merges instead of holding everything to redemption. Follow in later
  snapshots; if stable, A24's "zero merges / redeems only" exit-style
  needs a dated amendment (era: ≤Jun-14 redeem-only → Jul merge-mix).
  **RESOLVED (A27, session 7):** merge usage is a TOGGLED module —
  ON ~Mar 7 → Apr-28T14:27Z, OFF Apr 29–Jun 30 (hence the June pull's
  zero), ON again 2026-07-01T07:53:10Z; binary deployments both ways,
  redeems continue throughout, merges are block-sized capital
  recycling (wallets/b27bc932.md).
- **O3 (04Z):** The failed challenger 0x95f5…779f is still trading but
  collapsed to dust ($937/2h ≈ $11k/day pace vs $1.48M/day in the
  30d leaderboard window) with pairRate 0.05 — effectively dead, not
  reformed. Its post-mortem (W1) is about the loss period, not today.
  (REFRAMED by A26: it was never a crypto challenger at scale — the
  $1.48M/day was World Cup volume; today's dust pace is its NORMAL
  crypto-updown baseline, same as its Apr–Jun grind era.)
- **O4 (04Z):** Two clip regimes visible live: grinders at $2–9 p50
  (b55f, 0xce25, b27bc932, bonereaper, badfallen, 95f5) vs big-clip
  farmers at $29–83 p50 (powerwinner, 0xaaaaa, doggystyie) whose pair
  costs sit ABOVE $1 (1.01–1.12) on btc-5m — consistent with
  fee-curve rebate farming rather than sub-$1 edge. The sub-$1 club in
  this window: b55f 0.988, 0xce25 0.991, b27bc932 0.995 (btc-15m/5m
  mix) — same three wallets Phase 1 tagged as the edge cluster.

## Snapshots

### 2026-07-17T04Z (last 2h)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 3174 | $42060 | 1 | 0.694 | 0.9879 | $1.71 | 0 | 104 | btc-5m $12k, btc-15m $11.1k, bitcoin-up-or-down-july-16-2026-11pm-et $4k |
| 0xce25 | 2269 | $20605 | 1 | 0.806 | 0.9913 | $3.77 | 0 | 95 | btc-5m $8.6k, btc-15m $5.6k, eth-15m $1.8k |
| powerwinner | 603 | $49459 | 1 | 0.945 | 1.0288 | $83.08 | 0 | 25 | btc-5m $49.5k |
| bonereaper | 1984 | $26947 | 1 | 0.417 | 1.0079 | $5.27 | 0 | 66 | btc-5m $14.9k, eth-5m $3.6k, bitcoin-up-or-down-july-16-2026-11pm-et $2.6k |
| 0xaaaaa | 581 | $40288 | 1 | 0.704 | 1.1219 | $72.09 | 0 | 24 | btc-5m $40.3k |
| doggystyie | 741 | $25656 | 1 | 0.982 | 1.0116 | $29.36 | 0 | 24 | btc-5m $25.7k |
| badfallen | 1223 | $17935 | 1 | 0.896 | 1.0134 | $8.81 | 0 | 24 | btc-5m $17.9k |
| b27bc932 | 1831 | $9987 | 1 | 0.984 | 0.9952 | $2.99 | 89 | 8 | btc-15m $8.9k, bitcoin-up-or-down-july-16-2026-10pm-et $0.5k, bitcoin-up-or-down-july-16-2026-11pm-et $0.5k |
| 95f5-challenger | 270 | $937 | 1 | 0.049 | 1.0296 | $1.87 | 0 | 12 | btc-5m $0.7k, btc-15m $0.1k, eth-5m $0.1k |

### 2026-07-17T05:45Z (last 2h; window overlaps snapshot 1 ~50%)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 2832 | $38893 | 1 | 0.726 | 0.9908 | $1.65 | 0 | 92 | btc-15m $10.6k, btc-5m $10.1k, bitcoin-up-or-down-july-16-2026-11pm-et $4k |
| 0xce25 | 1980 | $18037 | 1 | 0.825 | 0.9936 | $3.66 | 0 | 84 | btc-5m $7.1k, btc-15m $5.1k, eth-5m $1.7k |
| powerwinner | 581 | $47633 | 1 | 0.937 | 1.03 | $83.65 | 0 | 25 | btc-5m $47.6k |
| bonereaper | 2005 | $29449 | 1 | 0.401 | 1.0368 | $5.28 | 0 | 66 | btc-5m $15.6k, eth-5m $4.6k, bitcoin-up-or-down-july-16-2026-11pm-et $2.6k |
| 0xaaaaa | 563 | $39333 | 1 | 0.706 | 1.1397 | $72.83 | 0 | 23 | btc-5m $39.3k |
| doggystyie | 757 | $22705 | 1 | 0.986 | 1.016 | $25.28 | 0 | 24 | btc-5m $22.7k |
| badfallen | 1219 | $17150 | 1 | 0.905 | 1.0063 | $8.24 | 0 | 23 | btc-5m $17.2k |
| b27bc932 | 1771 | $9579 | 1 | 0.985 | 0.9958 | $2.5 | 87 | 8 | btc-15m $8.3k, bitcoin-up-or-down-july-16-2026-11pm-et $0.5k, bitcoin-up-or-down-july-17-2026-12am-et $0.4k |
| 95f5-challenger | 296 | $1067 | 1 | 0.043 | 1.0296 | $1.9 | 0 | 16 | btc-5m $0.8k, eth-5m $0.2k, btc-15m $0.1k |

- **O5 (05:45Z):** hour-over-hour STABILITY — all 9 wallets hold rank,
  pair costs move ≤0.018, clip regimes unchanged, book mixes
  unchanged, b27bc932's merge cadence steady (87 vs 89 per 2h). The
  equilibrium does not visibly shift on a ~1.5h scale; day-scale
  snapshots will carry the information. (Caveat: 2h windows taken
  1.5h apart overlap ~50%, which mechanically dampens deltas.)
- Method note: the snapshot JSON filename floors to an even 2h bucket,
  so snapshot 2 OVERWROTE snapshot 1's raw JSON
  (shadow-2026-07-17T04Z.json). Tables here are the durable record;
  future snapshots should pass a distinct --out or rename the JSON
  after the run.

### 2026-07-17T08:10Z (last 2h)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 3074 | $42200 | 1 | 0.728 | 0.9932 | $1.67 | 0 | 93 | btc-5m $11.5k, btc-15m $11.2k, bitcoin-up-or-down-july-16-2026-11pm-et $4k |
| 0xce25 | 2127 | $19828 | 1 | 0.818 | 1.0031 | $4.08 | 0 | 85 | btc-5m $8k, btc-15m $5.3k, eth-5m $1.7k |
| powerwinner | 538 | $44241 | 1 | 0.935 | 1.0325 | $84.47 | 0 | 24 | btc-5m $44.2k |
| bonereaper | 1923 | $27058 | 1 | 0.409 | 1.0627 | $5.29 | 0 | 67 | btc-5m $14.2k, eth-5m $4.7k, bitcoin-up-or-down-july-16-2026-11pm-et $2.6k |
| 0xaaaaa | 542 | $38360 | 1 | 0.683 | 1.1534 | $74.02 | 0 | 24 | btc-5m $38.4k |
| doggystyie | 723 | $18859 | 1 | 0.986 | 1.0186 | $20.7 | 0 | 24 | btc-5m $18.9k |
| badfallen | 1159 | $16523 | 1 | 0.907 | 1.0091 | $8.34 | 0 | 24 | btc-5m $16.5k |
| b27bc932 | 1730 | $9324 | 1 | 0.961 | 1.0045 | $2.75 | 87 | 9 | btc-15m $8.1k, bitcoin-up-or-down-july-17-2026-12am-et $0.7k, bitcoin-up-or-down-july-16-2026-11pm-et $0.5k |
| 95f5-challenger | 425 | $1852 | 1 | 0.027 | 1.0296 | $2.5 | 0 | 22 | btc-5m $1.4k, eth-5m $0.3k, btc-15m $0.2k |

- **O6 (08:10Z):** first real movement — realized pair costs ROSE
  across the board vs the 04–06Z snapshots (b55f 0.991→0.993, 0xce25
  0.994→1.003, b27bc932 0.996→1.005, bonereaper 1.037→1.063): the
  "sub-$1 club" shrank to b55f alone in this window while cadence and
  ranks stayed fixed. Realized pair cost is regime-dependent
  intra-day; a single 2h window cannot certify a wallet's pair-cost
  discipline — snapshots need a full-day spread before averaging.
  (Raw JSON now renamed per snapshot: shadow-2026-07-17T0810Z.json.)
