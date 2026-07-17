# Variant-scan method (W0) — on-chain two-sided tape

Script: `scripts/variant-scan.ts`. Status: built + smoke-tested
2026-07-17 (session 5). This note records the method and the
load-bearing API fact that forced the design.

## A25 — data-api /trades is TAKER-ONLY [verified]

Probe (2026-07-17): market `btc-updown-15m-1784258100`
(conditionId `0xb5ffb2…e5f4`), tx
`0xacc56fb876b7df3d2874c246115a3ae23e4549e7c0724f5ad22c688de5cd6c8a`.

- data-api `/trades` returned exactly ONE row for the tx: the taker
  (`0xee65685d…`, BUY Up 482.64 @ 0.999).
- The on-chain receipt has FOUR OrderFilled rows: three maker fills
  (`0xfc723f7d…`, `0xd8418208…`, `0x56d48e45…`) plus the taker's
  aggregate row (taker field = 2026 exchange `0xe1111800…`).
- None of the three makers got a /trades row.

Consequences:
1. Any wallet-discovery sweep over /trades finds TAKERS only. A
   pure-maker variant (the gabagool archetype itself) is invisible.
   The Phase-1 leaderboard sweep (A23) is unaffected (lb-api volume
   includes maker volume), but tape-based discovery must be on-chain.
2. Corroborates Phase-1 P-fact that /trades single-counts fills
   (sum(size) == gamma volumeNum): one row per taker order.
3. /activity?user= DOES include maker fills (Phase-1 dossiers relied
   on it) — the taker-only limit is specific to the market-wide
   /trades feed.

## Scan design

- Source: `eth_getLogs` on the 3 exchange contracts (CTF v1
  `0x4bfb41d5…`, negRisk `0xc5d563a3…`, 2026 fee-native
  `0xe1111800…`), topics = OrderFilled v1
  (`0xd0a08e8c…`) + v2 (`0xd543adfd…`). Both sides of every fill.
- RPC: `https://polygon.drpc.org` (free, no key). Empirical limits:
  getLogs OK at 100-block chunks (~1.4s, ~5–8k logs), errors above
  (message misleadingly says "10000 blocks"; the real bound is
  response size). Historical blocks (tested at 80M ≈ 2025-12-07)
  work. `eth_getBlockByNumber` ~70–200ms. The repo's Alchemy key is
  free-tier (getLogs capped at 10 blocks) — kept as fallback only.
- Sampling: N 15m windows per UTC day (`--every 8` → 12 windows).
  ts→block via binary search. A 15m window ≈ 430 blocks ≈ 5 chunks.
- Decode (layout identical v1/v2, verified against
  measure-onchain-fees.ts): wallet = `maker` topic; role = taker
  topic ∈ exchange set ? taker-aggregate : maker fill; BUY iff
  makerAssetId == 0 (px = making/taking, shares = taking,
  tokenId = takerAssetId); SELL mirrored. Each wallet's fills are
  counted exactly once (maker rows for makers, aggregate rows for
  takers).
- tokenId → (market, outcome) via gamma `?clob_token_ids=` batches
  of 20, cached in `data/variant-scan/token-map.json`. Only
  `*-updown-*` slugs kept; the scan therefore covers ALL crypto
  up/down books (all symbols and timeframes) in one pass — W7 gets
  its terrain data for free.
- Aggregates per (wallet, book): buyUp/buyDown shares+notional, sell
  notional, maker/taker notional, fills, clip-size reservoir.
  Classification per wallet: pairRate = Σmin(buyUpSh,buyDnSh) /
  Σmax(…), pairCost = paired-share-weighted (avgUpPx + avgDnPx),
  buyShare, makerShare, clip p50, book mix.
- Candidate filter (atlas grade): pairRate ≥ 0.25 AND buyShare ≥ 0.6
  AND fills ≥ 10 in the sampled windows.

## Caveats

- A sampled window sees only fills INSIDE it; a wallet's pair legs
  filled across window boundaries of longer-timeframe books (1h/4h)
  are truncated → pairRate is understated for slow accumulators on
  long books. For 5m/15m books, windows are aligned so truncation is
  bounded to the window edges (first/last partial 1h/4h overlap).
- pairCost is avg-of-avgs per market, min-leg-weighted across
  markets — atlas grade, not audit grade (dossiers do it exactly).
- Wallets below ~$10 notional per token are dropped from gamma
  resolution to bound API calls (counted in `unresolved`).

## Era plan (next units)

One day per month, 12 windows each: 2025-11-15, 2025-12-15,
2026-01-15, 2026-02-15, 2026-03-15, 2026-04-15, 2026-05-15,
2026-06-15, 2026-07-15. Era boundaries of record: fees on 15m crypto
2026-01-06; all-crypto fees 2026-03-06; fee-curve reshape Mar–May;
taker-rebate tiers 2026-05-28. Results per day →
`data/variant-scan/scan-<day>.json`; synthesis → `VARIANT-ATLAS.md`.

## A29 (session 7) — OF2 decode bug on the 2026 fee-native exchange: SELLs were dropped

Verified on tx `0x771168493f6ae2f77fa5611f4b093935521446e21bf7ad46419a3609e8e0f889`
(a SELL on btc-updown-5m-1784262600 via 0xe111…): on the fee-native
exchange, OrderFilled's data layout is `(sideFlag, tokenId, making,
taking, fee, ?, ?)` — `d[0]` is 0 (maker gives USDC / buy) or 1 (maker
gives token / sell) and the tokenId is ALWAYS `d[1]`. The v1 rule
(SELL tokenId = `d[0]`) binned every new-exchange SELL under token
"1", which never resolves in gamma → all sells silently dropped.

Blast radius (visible as the `unresolved` notional bucket): Nov–Mar
scans ≈ clean ($4–9k unresolved); 2026-04-15 mild ($49k); 2026-05-15
($3.35M) and 2026-06-15 ($4.70M) badly hit; 2026-07-15 worst (new
exchange dominant). Consequences in the affected days: two-way-mm
cluster reads ZERO (a two-way MM's sells vanish → buyShare=1 →
misclassified into buyer clusters), and buyShare/sellShare of any
selling wallet is inflated. BUY-leg pair metrics (pairRate/pairCost)
are unaffected. Fixed in variant-scan.ts (`d[0]===1n → tokenId=d[1]`;
real CTF token ids are keccak-derived so the flag is unambiguous);
days 04/05/06/07-15 re-scanned with the fixed decoder.

Method lesson: a cluster count hitting EXACTLY zero after a venue
infrastructure change is a decoder symptom, not a market observation —
check the residual/unresolved bucket first.
