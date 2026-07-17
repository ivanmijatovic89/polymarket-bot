# Session × realized-vol split at month scale (A49, A50) — OQ #2

Question (OPEN-QUESTIONS #2, residue of A36/A46): does the "day
divides in two" session rule survive month scale, and is time-of-day
just a proxy for realized volatility?

## Method

- Wallet: 0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82 (the 24/7 parity
  grinder, strongest living class wallet).
- Samples: full-UTC-day /activity pulls on 2026-03-25, 04-15, 05-13,
  06-10, 06-12→14 (the A36 window), 07-15 — one day mid-month across
  the wallet's whole life (first activity Mar 3). Per-file 1h margins;
  btc-updown-15m BUY fills only.
- Winners: Gamma `/events?slug=` (cached `data/gamma-winners.json`) —
  works past Telonex coverage (G9). 478/478 resolved.
- Realized vol covariate: Binance BTCUSDT 1m klines per 15m window,
  `volBp = sqrt(sum 1m logret²)` in bp; terciles over the pooled
  sample (≤11.6 / ≤19.2 / > 19.2 bp).
- Gross PnL = winnerShares − outlay (merge-neutral identity; gross of
  fees and rebates).
- Scripts: `scripts/fetch-binance-1m.ts`, `scripts/session-split-vol.ts`
  (both left by session 9's predecessor; run + written up this unit).
  Logs: `logs/session-split-vol-run1.log` (pooled),
  `logs/session-split-vol-junjul.log` (current era only).

## Headline result

**478 markets, $770k outlay, +$4,012 gross (+0.52%) — and ALL of the
positive margin is March.** Mar-25 alone: +$4,926 (+1.88% of ~$262k).
The 392 June–July markets sum to ≈ −$915 (−0.18% of ~$508k).

### Sleeve context first (A50 — found by accident, changes the era story)

Apr-15 and May-13 have ZERO btc-15m fills — yet the wallet did 82,060
and 70,303 TRADE rows those days, **100% btc-updown-5m**. Series mix
by sample day (share of TRADE rows):

| day | trades | btc-5m | btc-15m | eth-5m | merges |
|---|---|---|---|---|---|
| Mar-25 | 358,542 | 75% | 13% | 12% | 8,662 |
| Apr-15 | 82,060 | 100% | 0 | 0 | 4,208 |
| May-13 | 70,303 | 100% | 0 | 0 | 0 |
| Jun-10 | 118,762 | 70% | 25% | 1h-ET books ~3% | 0 |
| Jun-12→14 | 247,791 | 48% | 17% | 31% | 0 |
| Jul-15 | 105,333 | 78% | 18% | 1h-ET ~3% | 2,308 |

- **btc-5m has been the wallet's main book its entire life** (75% on
  Mar-25). The btc-15m sleeve is the thing that toggles: ON in March,
  OFF mid-April through May, ON June onward. The mid-July "btc-5m
  expansion" (O7–O9) is the wallet's historical norm showing up in
  live windows, not a strategic shift.
- **The "May downtime" reads in A45/A46 were wrong as stated**: on
  May-13 the wallet was fully active (70k fills) — only the btc-15m
  sleeve was off. Wallet-level downtime in May is only the specific
  dark days in the dossier's life table (May 1–3, most of 16–26).
- Merge counts per day match the A27 merge-era table exactly
  (ON-era days 4.2k–8.7k, OFF-era days 0, Jul ON again 2.3k) — an
  independent confirmation of the toggle dates.

## Session marginal (A49)

Pooled (478 mkts, Mar+Jun+Jul):

| session | mkts | pairCost p50 | gross (%outlay) | pnl p10/p50/p90 | losers | excessWon |
|---|---|---|---|---|---|---|
| overnight 00–05Z | 124 | 0.992 | +$715 (+0.37%) | −$57/+$9/+$72 | 44% | 70% |
| eu 06–11Z | 130 | 0.996 | +$2,292 (+1.08%) | −$61/+$8/+$88 | 42% | 65% |
| us 12–19Z | 160 | 0.994 | **−$723 (−0.27%)** | −$112/+$11/+$84 | 43% | 73% |
| evening 20–23Z | 64 | 0.987 | +$1,728 (+1.76%) | −$29/+$19/+$103 | 23% | 73% |

Current era only (Jun+Jul, 392 mkts — March's rich regime excluded):

| session | mkts | gross (%outlay) | losers | note |
|---|---|---|---|---|
| overnight | 105 | −$237 (−0.21%) | 49% | flat/negative |
| eu | 106 | +$37 (+0.03%) | 46% | breakeven |
| us | 128 | **−$1,948 (−1.05%)** | 48% | the bleed |
| evening | 53 | **+$1,233 (+1.65%)** | 28% | only robust positive |

- **US-worst / evening-best now replicates on a third independent
  sample set and at month scale** (A36 Jun-12–14, A46 Jun-10, now
  pooled Mar/Jun/Jul). In the current era the grinder is gross-flat
  or negative in three of four sessions; **evening 20–23Z carries the
  whole trading line** (positive in all three vol cells, 28% losers).
- The pooled EU +1.08% is a March artifact (Simpson's) — current-era
  EU is +0.03%.

## Vol covariate (A49): NOT an independent driver

Pooled marginal is flat (+0.52/+0.64/+0.42% calm/mid/storm — all
positive). Current era: calm +0.28%, mid +0.21%, storm −0.78% — but
the storm loss is one cell:

| current-era cell | mkts | gross (%outlay) |
|---|---|---|
| us × storm | 71 | **−$1,744 (−1.43%)** |
| evening × storm | 13 | +$301 (+1.27%) |
| overnight × storm | 17 | +$17 (+0.08%) |
| eu × storm | 29 | −$215 (−0.47%) |

- Storms concentrate in the US session (71/130 current-era storm
  windows are 12–19Z) — **realized vol mostly proxies session**, and
  where they can be separated, session wins: evening storms are fine,
  US storms are the bleed. "Avoid vol" is the wrong rule; "avoid (or
  switch recipe in) US-session storms" is the measured one.
- Within calm windows every session is ≈ flat (−0.19% to +1.37%) —
  the parity grinder has essentially no gross edge in calm current-era
  markets anywhere; evening's edge is earned in mid/storm windows at
  tight pair costs (p50 0.987–0.990).

## Month drift (A49)

| day | mkts | fills p50 | outlay p50 | pairCost p50 | gross (%outlay) | losers |
|---|---|---|---|---|---|---|
| 2026-03-25 | 86 | 445 | $2,665 | 0.984 | **+1.88%** | 16% |
| 2026-06-10 | 85 | 330 | $1,925 | 1.007 | −0.89% | 48% |
| 2026-06-12 | 92 | 168 | $951 | 0.990 | −0.11% | 39% |
| 2026-06-13 | 96 | 164 | $895 | 0.993 | +0.72% | 42% |
| 2026-06-14 | 34 | 137 | $798 | 1.007 | −0.06% | 50% |
| 2026-07-15 | 85 | 170 | $1,133 | 1.002 | −0.08% | 51% |

- **The grinder's gross trading margin on btc-15m collapsed from
  ~+1.9% of outlay (late March) to ≈0% (June onward)**; fills/market
  fell 445 → ~170 p50, per-market capital $2.7k → ~$1k. Late March
  was still a rich era for the recipe; the current-era 15m sleeve is
  subsidy-carried breakeven — consistent with A24/A28 (trading ≈
  breakeven, rebates carry) and terrain-books' flow decline, now
  measured on one wallet's own P&L across its life.
- Loser share ~48–51% on flat days vs 16% in March: the recipe's
  per-market win rate degraded with the margin, not just the size.
- excessWon 62–80% every day — the informed-residual-lean class
  pattern (A34/A36) holds in every era and session.

## Lab implications

1. Session stays a first-class dimension (confirms the A36/A46 build
   rule at month scale). For the parity-grind cell expect: evening
   pass, US fail, overnight/EU ≈ 0 in the current era — a v1 grinder
   sleeve should run 20–24Z first, NOT 24/7.
2. Do NOT add realized vol as an entry gate on its own — gate on
   session (or session × vol only for the US-storm veto). Sweeping a
   vol filter without session stratification would misattribute the
   US bleed to vol.
3. Judge day-level gross near zero as NORMAL for this recipe in the
   current era; the decision metric is trading-gross + expected
   rebate (A28), segmented by session.
4. March-era numbers (and January's, A40/A42) must never be pooled
   with current-era numbers when judging a candidate — regime
   stamping by month is mandatory (extends G10's January warning).

## Producing commands

- `npx tsx research/gabagool/scripts/pull-activity.ts --address 0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82 --label b27bc932-<day> --start <day 00:00:00Z> --end <day 23:59:59Z>`
- `npx tsx research/gabagool/scripts/fetch-binance-1m.ts 2026-03-25 2026-04-15 2026-05-13 2026-06-10 2026-06-12 2026-06-13 2026-06-14 2026-07-15`
- `npx tsx research/gabagool/scripts/session-split-vol.ts --activity data/activity-b27bc932-{mar25,apr15,may13,jun10,jun,jul15}.jsonl` (comma-joined)
