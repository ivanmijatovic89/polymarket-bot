# Rebate payout provenance — the $62.6k lump is program-wide backpay

Question 1 of OPEN-QUESTIONS (raised by A12): bonereaper's off-schedule
$62,612.93 TAKER_REBATE (2026-07-08T23:34:35Z) — monthly true-up? tier
backpay? one-off?

Method: data-api `/activity?type=TAKER_REBATE|MAKER_REBATE` (the type
filter works — much cheaper than full pulls) for all 7 active wallets,
full history (all under the 500-row page). Raw:
`data/rebates-{taker,maker}-<wallet>.json`. Pulled 2026-07-17.

## The lump is one same-second batch across the ecosystem

2026-07-08T23:34:35Z, identical timestamp in 6 of 7 wallets:

| wallet | bulk payout |
|---|---:|
| bonereaper | $62,612.93 |
| b55f | $41,013.95 |
| 0xce25 | $30,638.58 |
| doggystyie | $16,991.11 |
| 0xaaaaa | $12,462.05 |
| powerwinner | $10,579.07 |
| **total (these 7)** | **$174,297.69** |

badfallen missed the batch and instead got $1,296.97 on Jul 9 21:15:56
(off-schedule), and later a suspiciously round $1,500.00 (Jul 15);
powerwinner also got a round $7,500.00 on Jul 9 21:41:55 — these look
like manual corrections/grants after the batch.

## Reading: backpay for the program's pre-daily-payout window

- The taker-rebate program launched 2026-05-28 (VENUE-MECHANICS), but
  **daily TAKER_REBATE payouts begin exactly 2026-06-20 in every one of
  the 7 wallets** (n=45 payout events each; zero payouts before that
  date anywhere).
- The Jul-8 lump ÷ each wallet's current daily rate = 4–20 "days" —
  consistent with accrual over May 28–Jun 19 (23 days) at lower
  early-program rates (tiers ramp with volume). Not provable from
  outside, but the same-second batch + the clean Jun-20 daily start +
  one-off-ness (no similar lump in 45 subsequent payouts) make
  "launch-window true-up" the only story that fits all three facts.
- Consequence for income decompositions: the lump is JUNE income paid
  in July. Any daily-rate estimate that includes it (A12's "rescued by
  the payout" framing for bonereaper) should treat it as ~3 weeks of
  accrued taker rebates, not a July windfall; steady-state rates from
  the daily 00:10Z payouts remain the right numbers (A16 used those).

## Payout mechanics (verified from the streams)

- TAKER_REBATE: daily ~00:10Z since 2026-06-20. Occasional whole-day
  delays paid same-second across all wallets (Jul 4 11:39Z, Jul 13
  16:50Z) — batch-job hiccups, not wallet events.
- MAKER_REBATE: daily since at least 2026-03-26 (bonereaper's stream
  starts there; b55f/0xce25 from May 1) — at ~01:00Z through April,
  ~00:45Z currently. The January-era program (20% pool, VENUE-MECHANICS)
  predates these API streams; earliest observable payout row is Mar 26.
- Scale check, taker vs maker rebate income since Jun 20 (28 days):
  b55f taker $117.6k vs maker $36.9k **over 77 days**; bonereaper taker
  $156.7k/28d vs maker $111.7k/113d. The taker stream dominates ~5–10×
  on a per-day basis for every wallet — confirms A16's "the ecosystem's
  largest income stream is the taker-rebate pool".
- Fingerprint confirmations: doggystyie has 3 maker payouts EVER
  (April, $7 total) — pure-taker loop confirmed (A16). powerwinner
  maker rebates total $451 and stop Jun 19 — pure taker farmer.
  0xaaaaa's maker payouts stop 2026-05-26 (style change to taker-only
  around the taker-program launch — farmers followed the subsidy).

## Program-risk note for the lab (H3/G8)

The venue demonstrably (a) reprices/reshapes these programs (fee curve
change ~Mar; taker tiers May 28), (b) pays manually-set round amounts to
individual wallets, and (c) runs payouts as fragile batch jobs. Income
built on rebate streams is at the discretion of a counterparty that
actively tunes them — the systemic-risk framing in H3 stands, now with
direct evidence of discretionary payments.

## Producing commands

- curl data-api /activity?user=<addr>&limit=500&type={TAKER,MAKER}_REBATE
  → data/rebates-{taker,maker}-<wallet>.json (7 wallets, 2026-07-17)
