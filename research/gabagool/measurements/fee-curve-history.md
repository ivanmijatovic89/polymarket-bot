# On-chain fee-curve history: the reshape date, the cutover, and a quiet trim (A52)

Script: `scripts/fee-curve-probe.ts` (new, session 10). For sampled tx
receipts in a window, decodes the NET taker fee per fill — v1 era:
OrderFilled charge minus operator-module refunds to the taker wallet;
v2 era: the fee field directly — and reports the implied coefficient
`k` in `netTakerFee = k·p(1−p)·shares` per tx (median + spread + a
per-price-band table). Sampling frame: b27bc932's activity JSONLs
(the wallet is ~100% maker in these windows; we measure the
counterparty TAKER side, so the result is venue-wide, not
wallet-specific). Windows are 12:00–14:00Z unless noted, 60–120 txs
sampled, receipts via `polygon.gateway.tenderly.co`. Raw pulls:
`data/activity-b27bc932-*feeprobe.jsonl` (gitignored).

Question (OQ residue from A51): did the fee-curve reshape (peak
$0.78 → $1.75 per 100 shares) ship at the 2026-04-28 v1→v2 exchange
cutover?

## Answer: NO — the cutover was fee-neutral. The measured history:

| window (12–14Z) | exchange | implied k (median [p10,p90]) | reading |
|---|---|---|---|
| Mar-25 | v1 | 0.025 [0.005, 0.036] | OLD curve (implied-k ceiling ~0.036) |
| Mar-28 | v1 | 0.027 [0.005, 0.036] | old curve |
| Mar-30 (12–14Z) | v1 | 0.035 [0.007, 0.067] | **MIXED — rollout in progress** |
| Mar-30 (18–21Z) | v1 | 0.046 [0.021, 0.068] | mixed, new-curve share rising |
| Mar-31 | v1 | **0.0720 [exact]** | new curve, pre-cutover |
| Apr-05 | v1 | 0.0720 [exact] | |
| Apr-15 | v1 | 0.0720 [exact] | |
| Apr-27 | v1 | 0.0720 [exact] | day before cutover |
| Apr-29 | v2 | 0.0720 [exact] | day after cutover — **identical** |
| May-06 | v2 | 0.0720 [exact] | |
| May-10 | v2 | **0.0700 [exact]** | trimmed |
| May-13 | v2 | 0.0700 [exact] | |
| Jun-10 | v2 | 0.0700 [exact] | |
| Jul-15 | v2 | 0.0700 [exact] | current |

All windows are btc-updown-5m flow. "[exact]" = p10 = median = p90 to
4 decimals across 60–120 sampled txs — the curve is deterministic
`k·p(1−p)` with zero dispersion once live.

## The four facts

1. **Reshape date pinned: rolled out 2026-03-29/30, complete by
   Mar-31 12:00Z** — inside the archive.org bracket (Mar-05→Apr-01)
   VENUE-MECHANICS already had, and (within a day) simultaneous with
   the v2 exchange DEPLOYMENT (2026-03-31T02:39Z, A51). One release
   train: new fee curve first (on v1!), new exchange contract
   deployed hours later, cutover four weeks after.
2. **The rollout was gradual over ~a day, not atomic**: Mar-30
   windows show a continuum of per-tx implied k from old-curve
   values up to 0.070 (impossible under the old curve, whose
   implied-k ceiling is ~0.036). Consistent with per-order fee
   terms — old resting orders kept old fees while new orders got the
   new curve, blending within multi-fill txs.
3. **The v1→v2 cutover (Apr-28 ~11:02Z) changed NOTHING about fees**:
   k = 0.0720 exact on both sides. The unit-1 hypothesis is refuted;
   the cutover was pure infrastructure.
4. **The launch coefficient was 0.072, publicly, then quietly trimmed
   to 0.070 between May-06 and May-10.** The Apr-01 archive snapshot
   of docs.polymarket.com/trading/fees literally publishes "Crypto:
   0.072" (fetched via web.archive.org/web/20260401214533); the
   May-31 snapshot and live page say 0.07. On-chain the charge
   switched between May-06 12Z and May-10 12Z. Peak fee history is
   therefore **$0.78 → $1.80 (Mar-29/31) → $1.75 (May 6–10)** per
   100 shares — the well-known "$1.75" era actually started five
   weeks after the reshape.

## Implications

- **A49's margin decay has a fee confound**: b27bc932's +1.88%/outlay
  Mar-25 margin was earned under the old cheap curve; every June/July
  number sits under a ~2.3× dearer taker curve. The Mar→Jun decay is
  not pure competition. Folded into STRATEGY-BRIEF (session block).
- **The A50 15m-sleeve toggle now has a venue-event candidate**: the
  sleeve was ON Mar-25 (13% of flow) and OFF by Apr-15; the fee
  reshape (Mar-29/31) is the only venue event inside that gap. A
  2.3× taker-fee hike plausibly killed the sleeve's taker-completion
  economics. (The sleeve returned by June under the same 0.070 curve
  — so the operator adapted rather than the fee reverting; the
  toggle-ON explanation is still open.)
- **Paper-EV / backtest fee constants must be era-matched**:
  0.25·p·(p(1−p))² per share before Mar-29; 0.072·p(1−p) Mar-31→
  ~May-8; 0.07·p(1−p) after. The repo's 156bps constant matches only
  the pre-reshape era (known, G-series).
- Method note: under the OLD curve the implied-k (against a p(1−p)
  denominator) is price-dependent with ceiling ~0.036 and median
  ~0.025-0.027 — matches the known 0.25·p·(p(1−p))² form; no new
  measurement of the old shape was attempted.

## Addendum (unit 7): the current curve is uniform across books

The table above is all btc-5m flow. Same probe with `--prefix`:
**btc-updown-15m** (Jul-15, 60 txs — the lab's exact scope) and
**eth-updown-5m** (Jun-12 via the 0xce25 file, 50 txs) both give
k = 0.0700 exact. The 0.07·p(1−p) curve is symbol- and
timeframe-uniform in the current era; no book-specific fee constant
is needed.
