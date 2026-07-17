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
  **RESOLVED (A27, session 7):** flip dated exactly to
  2026-07-01T07:53:10Z, binary deployment, redeems continue, merges
  are block-sized capital recycling (wallets/b27bc932.md).
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
