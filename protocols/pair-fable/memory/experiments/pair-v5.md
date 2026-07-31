# Family: pair-v5 (taker pair-arb) — Phase 0: data scan

Axis entered after the E-014 class kill (pair-v4.md §per-start invariant):
top-of-book MAKER pair accumulation is structurally unprofitable at 140ms
under worst-queue. This family leaves the maker mechanism entirely: buy BOTH
sides as TAKER in the same instant, only when the fee-inclusive ask-sum is
already below $1. No resting orders, no doom mode, no residue — the pair is
complete at fill time and settles at $1.

Phase 0 measures whether such moments exist at all, from recorded books,
BEFORE any strategy code (STATUS session-4 plan; same discipline as pair-v3
Phase 0).

**Parity note (why this family is attractive beyond the numbers)**: the
worst-queue caveat does not apply to takers. The sim's taker path is a true
depth walk against the recorded visible book (simulator.md §Fill models) —
the same book this scan reads. If Phase 0 shows executable margin, a
backtest will show it too, with no fill-quality bias argument on either
side. The known live risk is instead exchange-side: the visible book can be
stale/raced live (parity.md), so live sizing starts small regardless.

## Pre-registered definitions (written BEFORE the scan ran)

- Universe: latest 800 eligible btc-15m markets on local disk (scan time
  2026-07-31; slugs 1784043000 → 1784762100, i.e. 07-14 → 07-23). All 800
  verified present locally before the scan.
- Book state: engine-reconstructed via `replayTelonexDeltaParquetForMarket`
  (the identical code path backtests replay through).
- Taker fee per share at price p: `0.07·p·(1−p)` (RULES rubric 4, tier-0).
- **Arb condition (fee-inclusive)**: `askUp + fee(askUp) + askDown +
  fee(askDown) < 1` at the best ask levels. Fee-exclusive
  (`askUp+askDown<1`) tracked for context only.
- **Episode**: a maximal contiguous span of book states where the condition
  holds. Entry margin = margin at flip-on; during the episode track min
  margin and min executable depth = min(bestAskSizeUp, bestAskSizeDown).
- **Survivable episode**: duration ≥ 140 ms (the measured live latency —
  an order sent at flip-on arrives while the condition still holds). FOK
  semantics: if the condition lapsed before arrival, the FOK kills — cost
  $0, so failed attempts are free; only successes count. Jitter ±20 ms is
  noise around this bar.
- **Executable value per episode (conservative)**: `min(depthMin, 100) ×
  marginMin` — min margin and min depth over the whole episode, depth
  capped at 100 shares/side (≈ the $25–100 capPerMarket band at these
  prices). Headline: per-market sum over survivable episodes.

## Pre-registered priors (honest)

A fee-inclusive dutch book is free money to every taker watching, including
faster ones; the prior is that such moments are rare, thin, and short-lived.
At mid prices (0.50/0.50) fees are ~0.035/pair, so ask-sum must dip below
~0.965; at skewed prices (0.90/0.10) below ~0.987. The scan exists because
15m crypto windows are chaotic enough that the prior deserves a measurement,
not an assumption — and because the measurement is cheap (one local replay
pass shared with pair-v6 Phase 0).

## Pre-registered verdicts

- **BUILD v5**: mean per-market executable value (survivable episodes,
  conservative depth/margin) ≥ $0.25 — a real contributor toward goal 1,
  worth strategy code even if not $2 alone.
- **WEAK**: $0.10–0.25 — record, do not build yet; revisit if it stacks
  with another family.
- **KILL the family**: < $0.10/market, or survivable episodes essentially
  absent (present in < 5% of markets). Time-scoped as always.

Confounders pre-committed: (a) report the zero-latency (instantaneous)
version too — bounds what latency costs and whether a faster loop would
change the verdict; (b) episodes at extreme prices (either ask ≤ 0.05)
reported as their own stratum — near-settled books can print artifact
quotes; the verdict is computed on the full set AND the sane-band subset,
kill applies only if both fail; (c) depth walk below best level is ignored
(conservative — deeper levels could only add value).

## Phase 0 results

(to be filled by the scan — tools/bookscan.ts)
