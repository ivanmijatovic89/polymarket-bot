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

- **O6/continued (13:24Z):** see O7 below the 13Z snapshot.
- **O6 (08:10Z):** first real movement — realized pair costs ROSE
  across the board vs the 04–06Z snapshots (b55f 0.991→0.993, 0xce25
  0.994→1.003, b27bc932 0.996→1.005, bonereaper 1.037→1.063): the
  "sub-$1 club" shrank to b55f alone in this window while cadence and
  ranks stayed fixed. Realized pair cost is regime-dependent
  intra-day; a single 2h window cannot certify a wallet's pair-cost
  discipline — snapshots need a full-day spread before averaging.
  (Raw JSON now renamed per snapshot: shadow-2026-07-17T0810Z.json.)

### 2026-07-17T13:24Z (last 2h; first afternoon-UTC sample, no overlap with 1–3)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 2504 | $47337 | 1 | 0.63 | 1.0161 | $6.95 | 0 | 123 | btc-5m $17.5k, eth-5m $6.7k, btc-15m $5.7k |
| 0xce25 | 2895 | $33565 | 1 | 0.847 | 1.0164 | $6.18 | 0 | 119 | btc-5m $14.9k, eth-5m $5.8k, btc-15m $5.4k |
| powerwinner | 444 | $32646 | 1 | 0.917 | 1.0304 | $69.27 | 0 | 25 | btc-5m $32.6k |
| bonereaper | 6569 | $100101 | 1 | 0.383 | 1.0582 | $4.6 | 0 | 100 | btc-5m $59.7k, eth-5m $7.6k, btc-15m $5.2k |
| 0xaaaaa | 545 | $39067 | 1 | 0.667 | 1.1554 | $75.1 | 0 | 24 | btc-5m $39.1k |
| doggystyie | 560 | $21877 | 1 | 0.977 | 1.0029 | $35.69 | 0 | 24 | btc-5m $21.9k |
| badfallen | 1305 | $26931 | 1 | 0.862 | 1.0223 | $13.2 | 0 | 24 | btc-5m $26.9k |
| b27bc932 | 7655 | $50686 | 1 | 0.947 | 1.0306 | $4.12 | 181 | 38 | btc-5m $41.4k, btc-15m $8.1k, bitcoin-up-or-down-july-17-2026-8am-et $0.5k |
| 95f5-challenger | 0 | $0 | - | - | - | - | 0 | 0 | (idle) |

- **O7 (13:24Z) — the meta is NOT static intra-day; b27bc932 expands
  to btc-5m.** Three findings vs the 04–08Z morning snapshots:
  1. **b27bc932 changed shape**: 7,655 fills / $50.7k in 2h (vs
     ~1,800 / $9.5k all morning), with **btc-5m now its top book
     ($41.4k vs $8.1k btc-15m)**. All prior data (June pull, A24,
     A27, capital-curve W2) showed it as btc-15m-first with btc-5m
     absent/dust. Either a session schedule (US-morning btc-5m
     sleeve) or a fresh expansion — check next snapshots. Merge
     cadence scaled with it (181/2h vs 87), so merges track volume,
     not clock. Its 2h pair cost went ABOVE $1 (1.031) during the
     expansion — the btc-5m sleeve trades at farmer-like economics,
     consistent with terrain-books.md (btc-5m margins negative).
  2. **Everyone's realized pair cost is >$1 in this window** (even
     b55f 1.016; sub-$1 club EMPTY). US-morning session: fills and
     notional 2–5× the quiet overnight hours (bonereaper $100k/2h),
     clips bigger (b55f p50 $1.67→$6.95). High-activity regime =
     worse realized pair costs for every wallet — direct support for
     the H-family claim that pair-cost discipline is
     volatility-regime-dependent, and a warning for the lab: a
     strategy certified on quiet hours will look different 13–20Z.
  3. **95f5 idle** (zero rows in 2h) — first fully-dark window;
     its crypto dust trickle is intermittent, not continuous.

### 2026-07-17T13:50Z (last 2h; ~78% overlap with snapshot 4 — confirmation snapshot)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 3236 | $69359 | 1 | 0.687 | 0.9894 | $6.7 | 0 | 124 | btc-5m $25.5k, btc-15m $10.6k, eth-5m $9.5k |
| 0xce25 | 3306 | $43717 | 1 | 0.824 | 0.9903 | $6.74 | 0 | 119 | btc-5m $18.4k, btc-15m $7.6k, eth-5m $7.4k |
| powerwinner | 565 | $43506 | 1 | 0.93 | 1.021 | $75.94 | 0 | 25 | btc-5m $43.5k |
| bonereaper | 7366 | $101660 | 1 | 0.41 | 1.0388 | $4.23 | 0 | 101 | btc-5m $62k, eth-5m $9.2k, btc-15m $5.6k |
| 0xaaaaa | 673 | $46112 | 1 | 0.704 | 1.1126 | $70.59 | 0 | 24 | btc-5m $46.1k |
| doggystyie | 485 | $18542 | 1 | 0.981 | 1.0049 | $35.57 | 0 | 22 | btc-5m $18.5k |
| badfallen | 2684 | $43146 | 1 | 0.902 | 1.0211 | $7.44 | 0 | 24 | btc-5m $43.1k |
| b27bc932 | 7449 | $50477 | 1 | 0.946 | 1.0356 | $4.15 | 179 | 36 | btc-5m $40.6k, btc-15m $8.7k, bitcoin-up-or-down-july-17-2026-9am-et $0.6k |
| 95f5-challenger | 0 | $0 | - | - | - | - | 0 | 0 | (idle) |

- **O8 (13:50Z):** (1) b27bc932's btc-5m sleeve PERSISTS (~$40k/2h,
  merge cadence ~180/2h) — this is a real mid-July expansion or a
  daily US-session sleeve, not a blip; its June btc-15m-only profile
  (A24/W2) is now era-bound ≤Jun. (2) b55f and 0xce25 are back UNDER
  $1 (0.989/0.990) in the middle of US hours — O7's "sub-$1 club
  empty" was a transient volatility stretch, not a stable
  clock-property: intra-session pair-cost regime is
  VOLATILITY-driven, finer than the 4-bucket session split (A36).
  The A36 session table therefore mixes calm and stormy US windows;
  the lab's session dimension should carry a realized-vol covariate,
  not clock alone. (3) 95f5 still fully idle (2nd consecutive dark
  window).

### 2026-07-17T14:47Z (last 2h; ~55m after snapshot 5)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 4056 | $96727 | 1 | 0.725 | 0.9981 | $6.68 | 0 | 139 | btc-5m $31.2k, eth-5m $13.4k, btc-15m $13.4k |
| 0xce25 | 3928 | $57233 | 1 | 0.832 | 0.9923 | $7.87 | 0 | 129 | btc-5m $21.9k, eth-5m $10.2k, btc-15m $10.1k |
| powerwinner | 759 | $61888 | 1 | 0.941 | 1.0162 | $82.8 | 0 | 25 | btc-5m $61.9k |
| bonereaper | 8237 | $96602 | 1 | 0.474 | 1.0613 | $3.43 | 0 | 94 | btc-5m $61.3k, eth-5m $9.2k, btc-15m $8.3k |
| 0xaaaaa | 729 | $48003 | 1 | 0.769 | 1.081 | $66.89 | 0 | 24 | btc-5m $48k |
| doggystyie | 390 | $13901 | 1 | 0.982 | 1.011 | $30.35 | 0 | 19 | btc-5m $13.9k |
| badfallen | 2853 | $41064 | 1 | 0.904 | 1.0178 | $6.62 | 0 | 24 | btc-5m $41.1k |
| b27bc932 | 6689 | $43002 | 1 | 0.949 | 1.0183 | $4.06 | 174 | 37 | btc-5m $33.5k, btc-15m $8.1k, bitcoin-up-or-down-july-17-2026-9am-et $0.9k |
| 95f5-challenger | 27 | $56 | 1 | 0 | - | $1.25 | 0 | 0 | btc-15m $0k, eth-15m $0k |

- **O9 (14:47Z):** the US-session surge continues and broadens —
  total tracked flow ~$460k/2h (vs ~$250k in the overnight
  snapshots); b55f nearly $100k/2h with pair cost right AT 0.998.
  b27bc932's btc-5m sleeve persists (3rd consecutive window,
  $33.5k) — this is a durable mid-July expansion, not a blip; its
  dossier era table needs the amendment (residue for next session).
  95f5 back from idle at dust scale ($56/2h). Sub-$1 club this
  window: 0xce25 only (b55f 0.998 borderline) — consistent with O8:
  vol regime, not clock, drives who clears $1.

### 2026-07-17T15:52Z (last 2h; ~65m after snapshot 6)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 3203 | $89949 | 1 | 0.647 | 1.0496 | $7.62 | 0 | 142 | btc-5m $25.9k, eth-5m $13.8k, btc-15m $10.2k |
| 0xce25 | 3450 | $52846 | 1 | 0.828 | 1.0076 | $8.69 | 0 | 126 | btc-5m $21.8k, eth-5m $10.7k, btc-15m $6.6k |
| powerwinner | 813 | $65384 | 1 | 0.95 | 1.0082 | $81.2 | 0 | 24 | btc-5m $65.4k |
| bonereaper | 10678 | $90267 | 1 | 0.509 | 1.0242 | $2.69 | 1 | 124 | btc-5m $55.8k, eth-5m $8.6k, btc-15m $8.3k |
| 0xaaaaa | 542 | $35700 | 1 | 0.754 | 1.0783 | $66.89 | 0 | 23 | btc-5m $35.7k |
| doggystyie | 529 | $17327 | 1 | 0.991 | 1.0118 | $27.87 | 0 | 21 | btc-5m $17.3k |
| badfallen | 1601 | $18235 | 1 | 0.862 | 1.0192 | $7.8 | 0 | 23 | btc-5m $18.2k |
| b27bc932 | 6048 | $39598 | 1 | 0.922 | 1.0075 | $3.84 | 169 | 34 | btc-5m $30.9k, btc-15m $7.1k, bitcoin-up-or-down-july-17-2026-10am-et $0.9k |
| 95f5-challenger | 96 | $444 | 1 | 0.054 | 0.9866 | $2.28 | 0 | 4 | eth-5m $0.2k, btc-5m $0.2k, eth-15m $0.1k |

- **O10 (15:52Z):** first FULLY-empty sub-$1 window at full volume —
  every tracked wallet's pair cost ≥ 1.0075 (95f5's 0.9866 is dust at
  pairRate 0.05). Even b55f blew out to 1.0496 (its worst observed;
  0.998 an hour earlier) with pairRate down to 0.647 — a late-US-
  session storm print consistent with A49's US-worst rule. Flow still
  elevated (~$410k/2h tracked). b27bc932's btc-5m sleeve persists a
  4th consecutive window ($30.9k 5m vs $7.1k 15m; merges 169, module
  ON). bonereaper churned hardest (10.7k fills, $90k) at pairRate
  0.51 — half its buys unpaired at snapshot time. Watch: does the
  club re-form in the 20–24Z evening session (A49's only robust
  positive)? An evening snapshot today would pair nicely with the
  morning one for OQ #5's residue.

### 2026-07-17T17:08Z (last 2h; ~76m after snapshot 7)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 3174 | $81891 | 1 | 0.643 | 0.9892 | $7.26 | 0 | 137 | btc-5m $19.2k, eth-5m $13.8k, btc-15m $10.6k |
| 0xce25 | 3427 | $53563 | 1 | 0.828 | 0.9807 | $8.77 | 0 | 127 | btc-5m $18.6k, eth-5m $9.9k, btc-15m $8.6k |
| powerwinner | 824 | $60677 | 1 | 0.953 | 1.0109 | $75.59 | 0 | 27 | btc-5m $60.3k, eth-5m $0.4k |
| bonereaper | 12324 | $92777 | 1 | 0.494 | 1.0219 | $2.67 | 1 | 158 | btc-5m $54.3k, eth-5m $9.1k, btc-15m $6k |
| 0xaaaaa | 371 | $25308 | 1 | 0.664 | 1.0937 | $70.71 | 0 | 24 | btc-5m $25.3k |
| doggystyie | 720 | $24839 | 1 | 0.994 | 1.013 | $31.47 | 0 | 24 | btc-5m $24.8k |
| badfallen | 1041 | $10568 | 1 | 0.824 | 1.029 | $9.05 | 0 | 22 | btc-5m $10.6k |
| b27bc932 | 5581 | $36753 | 1 | 0.922 | 1.0096 | $3.76 | 173 | 33 | btc-5m $27.5k, btc-15m $8k, bitcoin-up-or-down-july-17 1h $0.7k |
| 95f5-challenger | 285 | $1975 | 1 | 0.054 | 1.1484 | $3.8 | 0 | 8 | eth-15m $0.9k, btc-15m $0.5k, btc-5m $0.4k |
| 13e0d447 | 1029 | $24498 | 1 | 0.805 | 0.9748 | $3.05 | 0 | 20 | btc-5m $24.5k |
| 76d4d470 | 3717 | $26651 | 1 | 0.77 | 0.9877 | $2.55 | 666 | 151 | btc-5m $15.9k, btc-15m $3.8k, eth-5m $1.3k |

- **O11 (17:08Z): the sub-$1 club RE-FORMED within ~76 minutes of the
  O10 empty print** — four wallets sub-$1 (13e0d447 0.9748 deepest,
  exactly the queue's prediction; 0xce25 0.9807; 76d4d470 0.9877;
  b55f 0.9892 after its worst-ever 1.0496). First snapshot including
  the profile-less pair: 13e0d447 runs $24.5k/2h btc-5m-only at the
  deepest pair cost on the board with zero merges; 76d4d470 is the
  continuous-merge style (666 merges/2h) at 0.9877 — the two
  profile-less actives bracket the merge-posture axis (A56). O10 was
  a storm SPIKE, not a regime shift: pair-cost dispersion collapsed
  back as the US storm passed (A49/A58 clock effect visible live at
  76-minute resolution). b27bc932 unchanged (5m sleeve $27.5k/2h,
  merge module ON at 173, pairCost still ≥1). bonereaper still the
  churn leader (12.3k fills at pairRate 0.49 — half its flow
  unpaired). Note: script prints 95f5 twice (duplicate tracker
  entry, cosmetic — dedupe when reading; raw JSON renamed to
  shadow-2026-07-17T1708Z.json).

### 2026-07-17T18:04Z (last 2h; ~56m after snapshot 8)

| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |
|---|---|---|---|---|---|---|---|---|---|
| b55f | 3858 | $81126 | 1 | 0.624 | 0.9607 | $4.55 | 0 | 132 | btc-5m $18.7k, eth-15m $11.8k, eth-5m $11.6k |
| 0xce25 | 3559 | $53292 | 1 | 0.834 | 0.9697 | $8.05 | 0 | 126 | btc-5m $16k, btc-15m $11.1k, eth-5m $9.6k |
| powerwinner | 1199 | $63467 | 1 | 0.956 | 1.0142 | $39.96 | 0 | 43 | btc-5m $61.2k, eth-5m $2.2k |
| bonereaper | 13117 | $99512 | 1 | 0.513 | 1.03 | $2.76 | 0 | 160 | btc-5m $52.4k, eth-5m $9.3k, sol-5m $7.2k |
| 0xaaaaa | 559 | $36836 | 1 | 0.709 | 1.0816 | $69.27 | 0 | 24 | btc-5m $36.8k |
| doggystyie | 812 | $29248 | 1 | 0.99 | 1.0132 | $33.65 | 0 | 24 | btc-5m $29.2k |
| badfallen | 1299 | $13520 | 1 | 0.832 | 1.0113 | $9.25 | 0 | 21 | btc-5m $13.5k |
| b27bc932 | 5887 | $38638 | 1 | 0.94 | 1.0237 | $4 | 175 | 38 | btc-5m $28.2k, btc-15m $9.2k, 1h ET $0.7k |
| 95f5-challenger | 348 | $2404 | 1 | 0.033 | 1.2232 | $3.7 | 0 | 10 | eth-15m $0.9k, btc-5m $0.9k, btc-15m $0.6k |
| 13e0d447 | 951 | $18555 | 1 | 0.842 | 0.9706 | $3.52 | 0 | 19 | btc-5m $18.6k |
| 76d4d470 | 4031 | $27978 | 1 | 0.768 | 0.9836 | $2.5 | 727 | 152 | btc-5m $15k, btc-15m $4.6k, eth-5m $1.6k |

- **O12 (18:04Z): the club DEEPENS into the pre-evening hours** —
  same four sub-$1 wallets as O11 but all deeper (b55f 0.9607, its
  deepest recent print; 0xce25 0.9697; 13e0d447 0.9706; 76d4d470
  0.9836). Three consecutive snapshots trace the clock effect live:
  15:52 club empty (US storm) → 17:08 re-formed (0.975–0.989) →
  18:04 deepening (0.961–0.984) — the A49/A58 evening ramp in real
  time. b55f notably shifted book mix toward eth-15m ($11.8k/2h,
  unusual for it) at $4.55 clips (half its usual). b27bc932's own
  pair cost WORSENED (1.0237) while running 5m-first — the grinder
  keeps buying through hours the edge wallets price at sub-$1.
  bonereaper churn at 13.1k fills/2h, pairRate 0.51, cost 1.03 —
  farmer economics at full tilt.
