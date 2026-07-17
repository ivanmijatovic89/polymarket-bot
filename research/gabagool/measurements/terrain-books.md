# W7 — terrain by book family, era by era (from the era-scan data)

Session 7, 2026-07-17. Source: the 9 era-scan days (12/96 windows, ×8
for day totals — ±30%); class = edge+cheap+farmer clusters
(atlas-classify rules). Strategy scope STAYS btc-15m; this is the
number sheet for the operator's later scope decision.

## Total up/down notional by book (sampled day, top families)

| day | btc-5m | btc-15m | btc-1h(dated) | eth-5m | eth-15m | sol/xrp-15m |
|---|---|---|---|---|---|---|
| 2025-11-15 | — | $448k | $255k | — | $221k | $47k/$35k |
| 2025-12-15 | — | $1,532k | $486k | — | $426k | $153k/$102k |
| 2026-01-15 | — | **$3,181k** | $704k | — | $2,171k | $172k/$140k |
| 2026-02-15 | $3,541k | $1,973k | $682k | — | $484k | $212k/— |
| 2026-03-15 | $3,903k | $948k | $590k | $528k | $232k | — |
| 2026-04-15 | $3,710k | $719k | $247k | $341k | $174k | — |
| 2026-05-15 | $2,855k | $542k | $114k | $282k | $90k | — |
| 2026-06-15 | $2,676k | $412k | $123k | $249k | $81k | — |
| 2026-07-15 | $2,927k | **$347k** | — | $280k | $96k | — |

Class share of each book's flow: 20–42% everywhere, trending UP
(btc-15m 23% → 37%; btc-5m 18% → 36%) — the class is a large and
growing minority of ALL up/down flow on every book.

## What it says

1. **btc-5m appeared between Jan-15 and Feb-15 2026 and immediately
   became the volume king** (~8× btc-15m today). The Jan fee
   introduction + 5m launch together reshaped the terrain: flow
   migrated 15m → 5m.
2. **btc-15m total flow is DOWN ~9× from its Jan peak** ($3.18M →
   $0.35M sampled) and ~4× from the golden era. The lab's book is the
   MARGIN book (fee-audit: only btc-15m cells are fee-inclusive
   positive), not the volume book — capacity for a v1 bot is
   bounded: at $347k/day book flow and A22's $36.4k/day fee pool,
   a bot doing $20–50k/day turnover is 6–14% of the book. Fine for
   v1 scale; a ceiling for scale-up dreams.
3. eth-15m today is $96k/day sampled — a quarter of btc-15m; sol/xrp
   15m books have effectively died since Feb (below top-6 by
   notional). "Expand to alt 15m books" is not a real capacity
   option in the current era; **btc-5m is the only meaningful
   expansion terrain** (8× flow, but measured fee-inclusive margins
   NEGATIVE there for every audited wallet — expansion would need
   the deep-pair/maker-pure discipline, unproven on 5m cadence).
4. The 1h dated books ("bitcoin-up-or-down-<date>-<time>") faded with
   the 15m decline; 4h flow never shows in the top families.

Caveats: window sampling misses intra-day book rotation; "1h(dated)"
naming groups all dated hourly slugs; 5m launch date is bracketed
(Jan-15 → Feb-15), not pinned.

## A60 addendum (session 11): current-era fee/subsidy pools per book (Jul-16, exact curve)

W7 refresh with era-matched constants (A52: current curve
0.070·p·(1−p), uniform across books per session-10 unit 7). Method:
`rebate-pool.ts` (generalized with `--step/--windows` for 5m grids),
data-api /trades per sampled window, single-counting re-verified on a
btc-5m window (Σsize = gamma volumeNum to the cent, 3,105 rows, no
offset cap). Same UTC day for every book (2026-07-16), 24 windows
sampled per book (12 for sol/xrp):

| book | notional/day | taker fees/day | maker pool/day (20%) | per-mkt fees p10/p50/p90 |
|---|---:|---:|---:|---|
| btc-5m | $13.58M | **$296k** | **$59.2k** | $613/$1,007/$1,551 |
| btc-15m | $1.84M | $34.2k | $6.8k | $204/$372/$560 |
| eth-5m | $1.27M | $24.0k | $4.8k | $46/$74/$176 |
| eth-15m | $0.40M | $6.2k | $1.2k | $27/$54/$99 |
| sol-5m | $0.49M | $9.2k | $1.8k | $13/$28/$50 |
| xrp-5m | $0.32M | $5.4k | $1.1k | $8/$17/$33 |

- btc-15m Jul-16 ($34.2k fees / $6.8k pool) replicates the Jul-15
  reference ($36.4k / $7.3k, rebate-pool-btc15m.md) — the A22/A28
  numbers are stable day-to-day.
- **btc-5m is 7.4× the notional and 8.7× the fee/subsidy pool of the
  lab's book** — $59k/day of maker rebates plus the taker-tier refund
  stream sit on the book we cannot backtest (G11). This is THE
  quantified scope-decision tension: the strongest living wallet
  (13e0d447, A57) collects from this pool at ~$1.1k/day rebates —
  i.e. ~2% of the btc-5m maker pool; the pool is nowhere near
  operator-saturated.
- **Correction to the era-scan table above**: its btc-5m column is
  understated ~4–5× ($2.9M vs $13.6M for adjacent days). The
  cross-check proves data-api complete; the era-scan's 12-slice ×8
  extrapolation under-sampled the 5m grid (and its btc-5m absence on
  2026-01-15 is wrong for presence — A54: 5m launched 2025-12-18;
  it was merely below the scan's top-family cut in its fee-free
  infancy). Era-scan RATIOS across eras for 15m books stand; treat
  its 5m absolute levels as floors.
- eth-5m ≈ eth-15m×4 in fees but both are an order below btc books;
  sol/xrp 5m alive at dust-pool scale ($1–2k/day). "Expand to alts"
  remains a non-option; the only real expansion question is btc-5m
  (knowledge-only for now — strategy scope stays btc-15m).
- Caveat: btc-5m day estimate could still be a slight LOWER bound if
  any unsampled window exceeded the /trades offset cap (sampled max
  was 3,105 rows vs cap ~4,500; US-storm windows could exceed it).
  Logs: `data/pool-jul16-*.log`.
