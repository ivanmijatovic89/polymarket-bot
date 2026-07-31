# Market context — external facts from the human

Facts about the live BTC-15m market that we cannot observe from our own
data. Each entry: source, fact, implications, and which of our conclusions
it constrains. These are HUMAN-REPORTED (not run-verified) — treat as
strong priors, not measurements.

## 2026-07-31 — profitable operator at ~700 trades/window (inbox d904e17d)

**Fact (human's own research of live operators):** on this exact market
(BTC 15m up/down), the best-known profitable bot places on the order of
**700 trades inside a single 15-minute window**. Some profitable operators
also finish a window **deliberately tilted to one side** rather than
perfectly paired.

**Our position in that space:** v1 averages 3.9 trades/market, max 12
(run 872); v4 averages 5.4. The regime between ~10 and ~700 trades/window
is completely unexplored by us, and at least one profitable operator
lives at the far end.

**What it constrains:**

- E-013's "starts are fill-limited" (cadence family kill) was measured in
  the few-orders-per-window regime. It is a FAMILY kill and does not
  cover high-frequency quoting (100×+ activity). Open question flagged by
  the human: if the engine says fill-limited survives at 100× activity,
  is that a fact about the market or about the worst-queue fill model?
  (Guard 6: worst-queue understates maker fills; the understatement
  compounds with quote frequency, so backtest evidence AGAINST
  high-frequency variants is weak evidence.)
- "Finish tilted" as a live pattern: run 900's accidental over-tilt
  (FOK-burst bug, 320-vs-50 shares) showed tilt at taker prices ≈
  symmetric gamble (residue won 34 → +$904, lost 362 → −$2,613 — net
  negative at OUR prices). A deliberate tilt would need an edge signal;
  noted as context, not a direction (human's words).
- Ranking left to us (human explicit). Current ranking: complete the
  ceiling/completion axes first (E-020b/E-021 in flight), then consider a
  high-frequency probe — cheapest honest first step would be a bookscan
  measurement of how much maker volume a high-frequency quoter could
  plausibly capture per window vs the worst-queue model's answer, before
  any strategy code.

**Measured update (E-025, session 13, run-verified):** total trade prints
per market on the 36 recorded live-WS markets are **704 (quiet day,
07-25) to 1,189 (busy day, 07-21)** — a 700-trade operator would account
for roughly ALL executed trades in a window. The figure therefore almost
surely counts order placements/replacements, not fills (consistent with
the measured cancel-dominated quoting: ~6,226 ToB bid-level decrease
events/mkt, 99.1% of decrease volume being cancels). The
trade-confirmed front-of-queue capture ceiling for an always-on ToB
10-share quoter is ~610 shares (~97 fills) per market — an order of
magnitude below 700 fills. E-013's fill-limited conclusion is restored
to (approximately) a market fact; the HF ToB maker gross ceiling is
~$8.5/mkt at measured pair margins. Details: hf-fill-probe.md §Result
E-025.
