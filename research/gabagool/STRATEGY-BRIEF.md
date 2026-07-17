# STRATEGY-BRIEF — the gabagool concept build spec (living draft)

Session 1 draft, 2026-07-17. Every claim links to PRIORS (P/A numbers),
measurements/, wallets/, VENUE-MECHANICS, or ENGINE-GAPS. Update
continuously; this is the file the lab builds from.

## 1. Mechanism (what verifiably made money)

Passive two-sided BUY-only maker on crypto up/down binaries. Rest bids on
BOTH legs across a band around mid; every filled pair whose combined cost
< $1 is riskless at settlement. The archetype's verified implementation
(measurements/tail-forensics, era-comparison):

- **Delta-parity accumulation, not independent leg-catching**: leg
  imbalance held at ~0.1% across hundreds of fills per market. The bot
  buys whichever leg restores balance — pair completion is continuous,
  not an afterthought. This is why the "unpaired inventory" tail risk
  (P14) barely materialized for him (worst Dec market −$121 across 568).
- **Buys only. Zero sells, ever** (both eras). Exits: batched
  cross-market MERGE (~99% of exit dollars, every few minutes) + redeem
  dust. Merge recycles capital within the window (capital velocity —
  inexpressible in the current sim, G5).
- **Small clips, huge counts**: $4 median buy, p90 $13; 45–618 fills per
  market median by era/book; burst ladders (p50 inter-fill gap 0s).
- **Wide band**: buy prices p25–p75 = 0.31–0.63 (p5 0.11, p95 0.85). He
  quotes the whole probability band, not cheap tails.
- Economics by era (THE central fact — the edge is regime-dependent):
  - Zero-fee era (≤2026-01-06): pair cost p50 0.98 → ~2c/pair margin ×
    ~500k pairs/day scale → +1.9% of turnover, 98.7% win on btc-15m.
  - Fee+rebate era: pair costs compressed to ≥$1; trading PnL → −rebates;
    the 20% maker-rebate pool became the income; competed to breakeven →
    archetype exited 2026-02-20. Current actives still run 0.9–2.0%
    margins (composition unknown — measurement in flight).

## 2. Who pays (and the era-dependence of the counterparty)

- Zero-fee era: takers crossing mid-band spreads freely — retail
  gamblers + latency arbs (venue's own justification for the fee, VENUE-
  MECHANICS). The maker's 2c/pair was the immediacy premium of a young
  fee-free market.
- Current era: taker flow is taxed 0.07·p(1−p) (peak 1.75c/share) and
  20% of that tax is recycled to makers as rebates. The maker earns
  (a) whatever pair-cost margin survives competition, plus (b) the
  rebate stream ∝ own share of fee-weighted maker volume. Rebates are
  volume-proportional → they reward exactly the high-count/small-clip
  fingerprint the archetype had.

## 3. Fair-value options (open — ranked by evidence)

The archetype's quoting band was wide and symmetric; nothing measured so
far REQUIRES a fair-value model beyond "mid ± band with delta-parity".
Candidates for the lab:

1. **No-model baseline (archetype-faithful)**: quote both legs around
   current mid with parity-keeping size selection. Evidence: he ran this
   (or something indistinguishable from it) profitably for 3 months.
   Cheapest to implement; the D2 fill-gap number decides if the sim can
   see its fills at all.
2. **Binance-anchored fair value** (Game B): p_fair from spot-vs-strike
   + time-left + vol; quote only the side(s) where book price < fair −
   margin. Feed exists on the unmerged branch (G6); strike must be
   proxied by window-open spot in replay. Untested by any prior campaign
   — the genuinely new territory. Risk: PM-tick-only wakeups leave stale
   quotes in quiet books (G6).
3. **Hybrid: parity-quoting with fair-value kill-switch**: quote like #1
   but pull quotes when |spot drift| since window open exceeds a
   threshold (the trending-window guard, P48). Targets the one measured
   loss channel of two-sided quoting (first-fill adverse selection, P42).

## 4. Quoting policy options

- Band width & ladder: archetype ~[0.11, 0.85] effective; unknown level
  offsets vs top-of-book (needs D2's fills×books join).
- Reprice cadence: unknown for archetype (cancels invisible, P21);
  inter-fill bursts suggest standing ladders, not chase-the-mid. NOTE:
  SRP spread-capture measured never-reprice as the WORST static-ask
  config under worst_queue (P42) — but that was the SELL side without
  parity control.
- Parity control (the load-bearing piece): size each new bid to close
  the current leg imbalance; suspend the rich side when imbalance = 0.
- Endgame: stop quoting when a leg's price leaves the band (book decided)
  — archetype's band implies no quoting beyond ~0.85; endgame-panic-bid
  family results (P43) say late resting bids ≈ fairly priced tail risk.

## 5. Leg-risk policy

Archetype answer: prevent, don't manage — parity accumulation keeps the
unpaired remainder ≈ dust; remainder rides to settlement (never sold).
SRP evidence agrees from the other side: post-first-fill survivor
policies were a ±$0.01 sideshow (P42, spread-capture 000/001/002); the
loss lives in the FIRST fill. A gabagool family should spend its
parameter budget on WHICH fills to accept (band, parity, kill-switch),
not on unwind logic.

## 6. Sizing / cadence / capital

- Clip $1–28, median $4 (both eras) — sits inside L1 depth; rebate
  income scales with fill COUNT × fee-weight, favoring many small fills.
- Per-market outlay: Dec p50 $3.2k (btc-15m), max $7.9k; capital
  recycled by merges within minutes. Per-day capital ≈ few × $10k for
  ~$10k/day at peak (extraordinary ROC — enabled by merge velocity, G5).
- Books: archetype = BTC+ETH, 15m+1h (Dec) → +5m (Feb). Successors run
  4 coins × 4 timeframes. Diversification across ~16 books smooths the
  daily P&L (leading book rotates, P18-note).

## 7. Exit / endgame handling

- Merge whenever paired inventory accumulates (batched, cross-market,
  every few minutes live). In SIM: never emit merge (G5/E4) — hold pairs
  to auto-credit; accept that sim capital velocity is unmeasurable.
- Redeem the (dust) remainder after resolution; abandonment observed only
  at sub-$20 scale.

## 8. What kills this (measured failure modes)

1. Fee-regime shift against takers → pair-cost compression (the
   archetype's actual death; VENUE-MECHANICS timeline).
2. Rebate-pool dilution — more maker wallets splitting the same 20%
   (current meta risk; G8 — no sim can price it).
3. Worst-queue-style adverse selection IS real when quoting without
   parity/flow context: every prior sim family died on the first fill
   (P42/P43/P45). The archetype's counter was flow-feeding parity at
   scale, not smarter single quotes.
4. A strong directional window with a stale ladder — bounded by band +
   parity (Dec worst −$121), but only if repricing keeps up (G6 wakeup
   gap in quiet books).

## 9. Open questions gating the build (→ OPEN-QUESTIONS.md)

- D2: what fraction of archetype fills does worst_queue admit? (sim
  credibility number)
- Current actives' income decomposition trading-vs-rebates (pull in
  flight for 0xb55f).
- Level offsets vs top-of-book at fill time (D2 byproduct).
- January transition speed (fee introduction → margin collapse curve).
- Whether rebate accrual can be estimated per-fill precisely enough to
  bolt onto backtest stats (G4 estimator; needs pool-share assumption).
