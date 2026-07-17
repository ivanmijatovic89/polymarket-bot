# First fill + migration onto the 2026 fee-native exchange (OQ #4)

Scripts: `scripts/first-fill-2026-exchange.ts` (left by a predecessor
session; run + written up here, session 10) +
`scripts/bisect-cutover.ts` (follow-up, pins the cutover hour). Raw
output: `data/first-fill-2026-exchange.json` (gitignored) +
`logs/first-fill-2026-exchange.log`.

RPC note: the default `polygon.drpc.org` free tier silently caps
`eth_getLogs` at ~100–200 blocks (error text claims 10,000) — the
forward scan crawls forever on it. **`https://polygon.gateway.tenderly.co`**
accepts ranges up to a 50k-result cap (returns the suggested retry
range on overflow) and is the endpoint that made this unit feasible;
both scripts take `--rpc`. Alchemy free (10-block cap), polygon-rpc.com
(dead key), publicnode (archive walled), 1rpc (50) were all worse.

Question (OPEN-QUESTIONS #4, venue residue): the 2026 fee-native
exchange `0xe111180000d2663c0091e4f400237545b87b996b` was deployed
2026-03-31T02:39:03Z (block 84902353, pinned session 7). When did
trading actually START on it, who migrated first, and how fast did
flow move over from the v1 exchanges?

## Method

1. Forward-scan `eth_getLogs` from the deployment block in adaptive
   ranges until the first OrderFilled-topic log (both v1 topic
   `0xd0a08e8c…` and the 2026 layout `0xd543adfd…` accepted).
2. Decode the first 3h of fills with the A29-corrected layout;
   per-wallet first-fill time / fills / notional / maker share; market
   series resolved through the variant-scan token-map cache only
   (unmapped tokens stay `(unmapped)` — no new API pulls).
3. For 10 sample days (Mar-31 → Jul-15), count OrderFilled logs per
   exchange contract in the 15m window starting 12:00Z — a v1 vs 2026
   share curve.

## Caveats (read before quoting the numbers)

- The pre-registered caveat here ("the 2026 exchange is crypto
  up/down only, so the share understates crypto migration") turned
  out to be WRONG — see result R4: the 2026 exchange is venue-wide,
  its first fills were on political/novelty books, and post-cutover
  it carries ALL Polymarket flow. Both sides of the share are
  all-of-Polymarket; the metric is clean.
- Log counts, not notional — clip-size differences between books are
  not weighted.
- One 15m window per sample timestamp — point samples, subject to the
  session effects documented in A49. Good enough here because the
  cutover turned out to be binary (0% or 100%, never mixed).
- Token-map is cache-only, so series attribution in phase 2 covers
  only tokens the earlier scans already resolved.

## Results (2026-07-17, session 10 — PRIORS A51)

**R1 — First fill: 2026-04-03T12:52:59Z** (block 85050371, tx
`0x5a829009714d1e2b8e17383078b18f64ef195da5ccd056107ecf01c5a4737ed1`),
3.4 days after deployment. It was a smoke test, not a launch: the
entire first 3h contain **30 fill rows between exactly two wallets**
trading $38 against each other — `0x6e0c80c9…b5b5` (100% maker) vs
`0xd74b83e1…ed75` (100% taker) — on `us-iran-nuclear-deal-before`
($40), `will-jesus-christ-return-before` ($25) and one unmapped token
($10). Deliberate tiny orders on illiquid novelty books = internal
end-to-end testing.

**R2 — Test-trickle era (Apr 3 → Apr 28):** sample 12:00Z windows on
Apr-20/24/27 show 4–35 fills per 15m on the new exchange vs 68–92k
on v1 (~0.0%). The venue tested in production for ~3.5 weeks.

**R3 — Hard cutover 2026-04-28 ~11:01–11:03Z** (bisected to one 15m
window):

| window (UTC) | v1 fills | 2026 fills | share new |
|---|---|---|---|
| Apr-27 12:00 | 68,289 | 4 | 0.0% |
| Apr-28 06:00 | 49,369 | 28 | 0.1% |
| Apr-28 09:00 | 57,187 | 8 | 0.0% |
| Apr-28 10:45 | 58,729 | 14 | 0.0% |
| Apr-28 11:00 | **4,036** | 16 | 0.4% |
| Apr-28 11:15 | **0** | 10 | 100% |
| Apr-28 11:45 | 0 | 215 | 100% |
| Apr-28 12:00 | 0 | 698 | 100% |
| Apr-29 12:00 | 0 | 52,754 | 100% |

v1 was fully active through 10:45–11:00Z (58.7k fills), collapsed
inside the 11:00–11:15 window, zero ever after (every later sample:
May-01/15, Jun-01/15, Jul-01/15 all v1=0). No dual-running period at
15m resolution — a maintenance-style hard cutover. The new exchange
started from near-zero and took **hours to reload**: 10 → 215 → 698
fills/15m in the first hour (~1% of normal), full scale by next day.

**R4 — The 2026 exchange is VENUE-WIDE, not crypto-only** (corrects
the session-3/7 working assumption): first fills were non-crypto;
after Apr-28 11Z it carries all Polymarket flow and both v1 exchanges
are dead. "Fee-native" semantics (maker fee 0 on-chain, taker charged
the curve directly in USDC, pair-minting at match) therefore apply to
the WHOLE venue from 2026-04-28 ~11:02Z, and any on-chain fee/receipt
forensics must use the v1 charge+refund decode before that timestamp
and the native decode after it.

## Implications / cross-links

- **Venue timeline gains a precise anchor**: 2026-04-28 ~11:02Z,
  venue-wide v1→v2 cutover. Folded into VENUE-MECHANICS.md.
- **b27bc932's merge module toggled OFF at Apr-28T14:27Z (A27) — 3.4h
  after the cutover.** What looked like an unexplained behavioral
  toggle now has a proximate venue event. Plausible mechanism: the v2
  exchange mints complementary pairs at match time, changing the
  economics/necessity of explicit CTF merges. (Merges resumed Jul-01 —
  the module stayed available.) Noted in the dossier.
- The A50 15m-sleeve toggle does NOT line up with the cutover (sleeve
  was already off on Apr-15) — that residue stays low-value.
- **Fee-curve reshape hypothesis (new, testable):** the reshape (peak
  $0.78→$1.75/100sh) is bracketed Feb-28→May-31. If the reshape
  shipped WITH the v2 cutover, its date is exactly Apr-28 ~11Z.
  One-probe test: decode taker fee rates from receipts on Apr-27 vs
  Apr-29 (measure-onchain-fees.ts pattern). Left as OQ residue.
