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

## A59 addendum (session 11): the session rule is WEEKDAY-ONLY

OQ #7 (raised by A58's Saturday-evening drift flip). Method: same
script + `--dow weekday|weekend` (UTC day of window start), pooled
current-era days only — weekday = Jun-10 (Wed), Jun-12 (Fri), Jul-15
(Wed); weekend = Jun-13/14 (partial Sun), Jul-11/12 (full Sat+Sun,
fresh pull `activity-b27bc932-jul11-12.jsonl`, 255,690 rows). 574
markets total (262 weekday / 312 weekend), gross = merge-neutral
winnerShares − outlay, session marginals:

| session | WEEKDAY %outlay (losers%) | WEEKEND %outlay (losers%) |
|---|---|---|
| overnight 00-05Z | −0.34% (44%) | −0.83% (57%) |
| eu 06-11Z | −0.09% (53%) | −0.98% (59%) |
| us 12-19Z | **−1.58%** (48%) | +0.59% (57%) |
| evening 20-23Z | **+1.74%** (30%) | +0.34% (44%) |

- **A49's map is the weekday map.** Weekday evening is the only cell
  positive in ALL vol terciles (+2.06/+1.84/+0.92% calm/mid/storm) —
  the "run evenings first" rule survives, but with a weekday
  qualifier. The weekday US bleed replicates (−1.58%).
- **Weekends restructure rather than attenuate.** Overnight/EU go
  negative, US flips positive (+0.59%, but storm-driven: calm −1.72%
  / mid +1.25% / storm +1.66%), evening decays to +0.34%. Weekend
  per-day is noisy (Jun-13 +0.72%, Jul-11 +0.42%, Jul-12 −1.70%) —
  no weekend cell is robust across days.
- **The favorite-lean module is the casualty**: excessWon 60–76% on
  weekdays vs 40–51% weekend (calm cells 20–27% — catastrophic).
  The wallet's residual-lean edge (A34/A36 class pattern) needs
  weekday flow; on weekends the lean is a coin flip or worse.
- Book-level echo: A58's Jun-13 (Sat) evening deep-fill drift was
  adverse (−1.38c @60s) where weekday evenings were +1.4/+1.5c.
- Lab rule update (supersedes item 1 above): v1 grinder envelope =
  **weekday** 20–24Z first; weekends have no robust positive cell —
  idle, or run only with the directional-lean module disabled.
  Weekend calm is the worst environment measured for the lean.
- Caveats: 3 weekday vs 4 weekend days, one era (Jun–Jul); dow is
  UTC (a US-clock Friday night 20–24Z is still UTC Friday =
  weekday). Log: `data/session-split-dow.log`.

Producing: `npx tsx research/gabagool/scripts/session-split-vol.ts
--activity data/activity-b27bc932-{jun10,jun,jul11-12,jul15}.jsonl
--dow weekday` (and `--dow weekend`).

### A59 REVISION at n=10 weekend days (same session, unit 5)

The 4-day weekend read above ("overnight/EU negative, nothing
robust") was itself small-sample noise. Three more weekends pulled
(Jun-20/21, Jun-27/28, Jul-04/05 — 192k/173k/209k rows), weekend
sample now 858 markets over 10 days:

| session | WEEKEND n=10 %outlay (losers%) | weekday n=3 (unchanged) |
|---|---|---|
| overnight 00-05Z | +0.27% (48%) | −0.34% (44%) |
| eu 06-11Z | +0.45% (50%) | −0.09% (53%) |
| us 12-19Z | +0.76% (47%) | −1.58% (48%) |
| evening 20-23Z | +0.61% (42%) | +1.74% (30%) |

- **Weekends are mildly positive EVERYWHERE and structureless**:
  total +$6,442 on $1.19M (+0.54%), 8/10 days positive (only Jul-12
  −1.70% and Jun-14 −0.06% negative). No US bleed, no evening
  premium — the weekday session structure simply does not exist on
  weekends. What survives from the first read: the structure
  difference, and the lean's death.
- **The lean stays dead on weekends, and got worse over July**:
  excessWon by weekend day — Jun 55–78%, Jul-04→12: 37/36/27/32%.
  Weekend gross stays positive because pair economics (pairCost p50
  0.988–0.995) carry it lean-less. Whether the July lean collapse
  is drift or noise: open; recheck on the next weekend.
- Revised lab rule: weekday evening remains the best cell (+1.74%)
  and weekday US the only real bleed. On weekends run the grinder
  WITHOUT the directional-lean module at flat-mild expectation
  (+0.5%), or idle — but "weekends are toxic" is NOT supported at
  n=10.
- Caveat flip: the WEEKDAY map (3 days) is now the thinner sample;
  its structure matches A49's month-scale read but A49 pooled dow —
  extending weekday days is the next cheap robustness step.
  Log: `data/session-split-dow-x10.log`.

### Weekday sample extended to n=6 (unit 6): structure holds, softer

Added Jul-13 (Mon), Jul-14 (Tue), Jul-16 (Thu) — weekday sample now
529 markets over 6 days spanning Mon/Tue/Wed/Thu/Fri:

| session | weekday n=6 %outlay (losers%, excessWon%) |
|---|---|
| overnight | +0.03% (42%, 66%) |
| eu | +0.22% (52%, 55%) |
| us | **−0.79%** (46%, 76%) |
| evening | **+1.27%** (36%, 59%) |

- The weekday map is confirmed at twice the days with moderated
  magnitudes: US remains the ONLY negative session; evening remains
  the best and is positive in calm AND mid AND storm (+1.31/+2.03/
  +0.20%). The n=3 numbers (−1.58/+1.74%) were the same shape,
  amplified by the Jun-10 storm day.
- The lean is confirmed weekday-native: excessWon 55–76% across
  weekday sessions (vs ~50% weekends) — highest exactly where gross
  is worst (US 76%): the lean rescues the US session from being
  even worse, it does not cause the bleed.
- One nuance moves: at n=6 the US bleed sits in mid/storm (−1.50%/
  −0.86%) while US×calm is positive (+0.95%, n=30) — "US-storm
  veto" softens to "US mid+storm are the toxic cells".
- Per-day: 4/6 weekdays negative-to-flat overall for the wallet
  (ALL −$131 on $726k ≈ 0) — weekday gross ≈ breakeven + rebates,
  consistent with A49's margin-decay read.
  Log: `data/session-split-dow-wd6.log`.
