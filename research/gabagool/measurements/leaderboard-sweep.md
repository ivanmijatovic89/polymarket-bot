# Volume-leaderboard sweep — 4 unknown crypto-updown wallets

**CORRECTION (A24, same session)**: the `0xb27bc932` rows below carry
two quick-scan errors, overturned by the June full pull: it is
MULTI-BOOK (btc-5m > btc-15m > eth-5m; the "btc-15m only" read came
from a 0.5h last-500 sample) and therefore holds ~3–4% of the btc-15m
maker pool, NOT ~40%. See wallets/b27bc932.md for the corrected
dossier. Lesson: never infer book mix from one /activity page.

Trigger: P19's "$8M/day wallet" claim (unmatched). Method: lb-api
30d volume top-50 → last 300–500 /activity TRADE rows per wallet →
crypto-updown share; fingerprint + rebate streams + lb profit for hits.
Pulled 2026-07-17. All numbers below are quick-scan grade (one
/activity page + lb-api), NOT full-history audits like the 7 dossiers.

## P19 verdict

No crypto-updown-only wallet approaches $8M/day. Top-10 volume is
sports/politics whales; nearest mixed fit is suntori ($6.3M/day total,
~35% crypto-updown incl. 5m/15m/4h, rest sports). The claim is either a
mixed-whale misread or inflated. Largest specialist found: $1.48M/day.
P19 stays [contested]; the search is done (top-50 is exhaustive for
>$0.5M/day).

## The four hits (ranks 11–50, crypto-updown share >50%)

| wallet | vol/day (30d) | books | clip p50 | BUY% | maker rebates | taker rebates | lb profit 30d |
|---|---|---|---|---|---|---|---|
| `0xb27bc932…5b82` | $0.73M | **btc-15m only** | $3.2 | 100% | **$363,820** (n=114, since 2026-03-14) | $29,723 (since Jun 23) | +$2,847 (all-time **+$762,732**) |
| `0x95f51617…779f` | $1.48M | btc+eth 5m/15m | $2.8 | 100% | $60,108 (since Apr 15) | $10 | **−$542,088** (all-time −$547k) |
| HelixEdge `0x2ebd6425…38cf` | $0.95M | btc-5m only | $18.0 | 100% | $171 | $63 | −$20,476 (all-time −$16k) |
| neutralwave23 `0x5b6331e7…11a4` | $0.76M | sol/btc 5m+15m | $8.8 | 81% | $1,207 | $22,671 | (not pulled) |

## What this changes

1. **`0xb27bc932` is the modern archetype at scale — on the lab's exact
   book.** gabagool's fingerprint (BUY-only, ~$3 clips, one book:
   btc-15m), running since ≥Mar 14, all-time lb profit $762,732
   (comparable to gabagool22's $868,863 — and lb profit ~excludes
   rebate transfers, so total income is ~$1.15M with rebates). Its
   maker-rebate stream averages **$3.2k/day — ~40% of the ENTIRE
   measured btc-15m maker pool ($7.3k/day, A22)**. One wallet owns the
   book's maker side. 30d trading profit is only +$2.8k → its income
   TODAY is predominantly the rebate stream (H3-flavored end-state,
   same as the archetype's final era — but sustained for months
   instead of quitting).
2. **The competition picture was undercounted.** _META's "~7 actives"
   missed at least 4 wallets ≥$0.7M/day. The prior wallet list came
   from the investigation + operator hints; a leaderboard sweep should
   have been session 1 hygiene.
3. ~~**Cold-start losses are real and large**~~ **CORRECTED by A26
   (2026-07-17, wallets/95f5-challenger.md)**: `0x95f5`'s −$542k was
   lost market-making World Cup sports books (fifwc-*), NOT crypto
   up/down — this point's "body-count evidence" is withdrawn; only the
   HelixEdge −$20k/30d part stands. Original text kept below for the
   record: `0x95f5` (profile created
   2026-01-07, the day after fees) lost −$542k in 30d doing parity-
   style BUY-only flow at $1.48M/day with near-zero taker rebates;
   HelixEdge (btc-5m, since ~Jul 7) is −$20k/30d. The A16 "fee moat +
   competition" story now has body-count evidence — losing at scale is
   a live outcome of exactly this strategy family executed badly (or
   at bad tiers). Caveat: lb-profit excludes rebate transfers and may
   treat unredeemed positions oddly; −$542k could overstate.
4. gabagool-style flow (BUY-only small clips on crypto-updown) sums to
   ≥$3.9M/day across just these 4 + the 7 tracked — the family manages
   ~$120M/month of turnover in the current era.

## Producing commands

- curl lb-api /volume?window=30d&limit=50; per wallet: data-api
  /activity?type=TRADE|MAKER_REBATE|TAKER_REBATE&limit=500; lb-api
  /profit?window=all|30d&address=. (Ad-hoc, this file is the record.)
