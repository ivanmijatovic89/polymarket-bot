# Measurement: gabagool22 tail forensics (final 2.6 trading days)

Session 1, 2026-07-17. Scripts: `scripts/pull-activity.ts` (v2, fixed) +
`scripts/analyze-tail.ts`. Data: `data/activity-gabagool22.jsonl` (106,338
rows, 2026-02-17T16:00Z → 2026-06-24, complete — the API window was
exhausted). Analysis window: markets whose first fill ∈
[2026-02-17T20:00Z, 2026-02-20T09:10Z] — 493 markets.

## Method notes (hard-won)

- data-api `/activity` rows have NO unique id and SECOND-granularity
  timestamps. A bot doing many identical small fills in one second emits
  byte-identical rows. **Never dedupe by row content** — v1 of the puller
  did and silently dropped ~30k rows (~22% of TRADEs), inflating measured
  net from −$1.8k to +$45k. The fixed puller paginates by inclusive `end`
  cursor, holding back the partially-fetched boundary second.
- MERGE `usdcSize` semantics VALIDATED = pairs merged × $1 (dollars
  received): for `btc-updown-15m-1771362000`, merged $6,527.39 vs max
  possible pairs 6,538.0, leftover UP 19.1 / DOWN 10.6 = dust.
- PnL = pure cash flow per market: −BUY + SELL + REDEEM + MERGE. No
  resolution oracle needed. Caveat: winning shares never redeemed are
  counted as loss (observed leftovers are dust-scale; last REDEEM
  2026-02-21, so nothing was redeemed later).

## Results — per family (final 2.6 days ONLY; this is his END state)

| family | mkts | fills p50 | fills p90 | fills max | net$ mean | net$ p50 | win% | pairCost p50 | maxOutlay p50 | maxOutlay max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| btc-5m | 163 | 80 | 286 | 497 | −4.25 | +1.56 | 55.8 | 0.99 | 301 | 3,385 |
| eth-5m | 122 | 45 | 91 | 127 | −0.51 | −0.34 | 48.4 | 0.99 | 148 | 350 |
| btc-15m | 57 | 162 | 737 | 853 | −12.94 | −1.55 | 38.6 | 1.00 | 610 | 4,750 |
| eth-15m | 53 | 160 | 532 | 736 | −5.21 | −1.56 | 43.4 | 0.99 | 577 | 1,915 |
| btc-1h | 51 | 141 | 499 | 2,478 | −0.81 | +2.22 | 64.7 | 1.00 | 425 | 6,419 |
| eth-1h | 47 | 86 | 798 | 1,434 | +0.91 | +0.64 | 57.4 | 0.99 | 268 | 4,671 |

Totals: **net −$1,767 on $356,561 buy turnover (−0.50%)**; exits: merges
$350,528 (dominant), redeems $4,266, sells $0 (he NEVER sells). In-window
MAKER_REBATE payouts: $1,693.20 + $125.66 = **$1,818.86** → trading + rebates
≈ **+$52 over 2.6 days**. He quit at breakeven.

## Behavioral fingerprint (verified numbers)

- **Near-perfect delta neutrality**: showcase market bought UP 6,546.5 /
  DOWN 6,538.0 shares (0.13% imbalance) across 845 fills. Continuous
  balance-keeping, not opportunistic one-sided dips.
- **Buys only, both sides, wide price band**: buy price p25/p50/p75 =
  0.31/0.48/0.63 (p5 0.11, p95 0.85). Not a cheap-tail collector — he
  quotes the whole band around mid.
- **Tiny clips, huge counts**: buy usd size p50 $3.84, p99 $21.84, max
  $27.72; fills per market p50 45–162, p90 up to ~800, max 2,478
  (btc-1h). The "~700 fills in one 15m market" prior (P7) is verified in
  magnitude: btc-15m p90 = 737, max = 853.
- **Burst cadence**: within-market inter-fill gap p50 = 0s, mean 5.4s, p90
  10s — fills arrive in same-second bursts (ladders across price levels),
  contrasting the successor's 11s median (INV, 1h/4h books).
- **Capital per market**: max outlay p50 $150–610, max $6,419 — NOT the
  ~$34k/market of the operator claim (P8) — at least not in the tail era.
- **Pair cost sits AT/ABOVE $1**: p50 0.99–1.00 by family; the showcase
  market paid 1.020. At $1.02 pair cost he loses 2c/pair on merge by
  construction — only rebates justify it.

## Interpretation (prior-moving)

1. **End-state gabagool was a rebate farmer, not a mispricing collector.**
   In the fee+rebate era (post 2026-01-06), his trading PnL went ≈ −rebate
   income: the 20% maker-rebate pool got competed into pair costs ≥ $1
   until rebate-adjusted EV ≈ 0. He quit 2026-02-20 when the total edge hit
   ~zero. This is the live-market version of fable-lab E29 ("premium =
   adverse-selection cost, zero rent") — with the rebate as the extra term
   the engine does not model (P32).
2. **The 99%-win / $30–120-per-market prior (P8) does NOT describe the
   end state** (win% 39–65%, p50 net ±$2). Either it described the
   zero-fee era (Oct–Dec 2025) or it was never true. → next measurement:
   pull a mid-December sample and compare pair costs / win rates pre-fee
   vs post-fee.
3. **Win% correlates with family in a telling way**: hourly books (64.7%
   btc / 57.4% eth) beat 15m (38.6% / 43.4%). Even in his dying days the
   longer windows were kinder — directionally consistent with INV P18.
4. All numbers here are END-STATE. Do not generalize to his profitable era
   without the mid-life sample.
