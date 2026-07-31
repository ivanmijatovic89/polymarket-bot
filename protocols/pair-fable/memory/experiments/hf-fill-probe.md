# E-024 — HF maker-capture fill probe (Phase 0, measurement only)

Motivated by `market-context.md` (inbox d904e17d): a profitable operator
places ~700 trades per 15-min window on this exact market; our v1 averages
3.9. The human's question: does E-013's "starts are fill-limited"
conclusion — measured in the few-orders regime under the simulator's
worst-queue model — survive at high activity, and if the engine says it
does, is that a fact about the MARKET or about the FILL MODEL? This probe
also bounds guard-6 (conservative-fill) optimism for every maker-family
kill recorded so far.

## Pre-registration (session 11, BEFORE any computation)

**Claim to test**: the worst-queue fill model (BUY at P fills only when
bestAsk drops strictly below P) understates the maker volume a
persistent top-of-book quoter could capture, by a factor large enough to
change verdicts (i.e., the fill model — not the market — is the binding
constraint on maker activity).

**Method** (reanalysis, no strategy code, no fleet runs): scan the pinned
800 (`--to-ms 1784762100000`, latest 800 — same slugs as E-022) with a
mktselect/bookscan-style replayer. Simulate, per side (UP and DOWN
independently), a hypothetical quoter that ALWAYS rests one 10-share bid
at the current bestBid: when bestBid moves, the quote follows instantly
(0 ms variant) or after 140 ms (latency variant, re-priced to the bestBid
prevailing at re-quote time). No inventory limits, no budget, no
refractory — this is a capture CEILING measurement, not a strategy. Two
frozen fill models on the same event stream:

- **W (worst-queue, the engine's rule)**: the resting bid at P fills when
  a post-event bestAsk < P. After a fill the quote re-arms instantly (0ms)
  or after 140 ms. Readout: fills/market and shares/market (10/fill).
- **O (optimistic front-of-queue)**: the resting bid at P also fills
  whenever the DISPLAYED size at price level P on the bid side DECREASES
  while P is (pre-event) bestBid — decrease interpreted as executed
  volume, captured up to min(decrease, 10). This over-counts (cancels
  also shrink levels), which is its role: a strict UPPER bound on any
  real queue position.

**Frozen readouts** (per model × latency variant, aggregated over the 800
and per-day): fills/market (both sides summed), shares/market, the O/W
ratio on shares, distribution p10/p50/p90 across markets, and raw
level-decrease event count at bestBid per market (the "how much maker
volume exists at top-of-book at all" ceiling, comparable to the
700-trades/window figure).

**Pre-registered verdicts**:
- **Fill-model NOT binding** if O-shares ≤ 2× W-shares (0ms variants):
  worst-queue already captures ≥ half the optimistic ceiling ⇒ E-013's
  fill-limited finding is a market fact; HF maker at top-of-book cannot
  reach the 700-trade regime on this book; the axis closes (scope: pinned
  800, top-of-book, 10-share unit).
- **Fill-model MATERIALLY binding** if O-shares ≥ 3× W-shares: every
  maker-family kill measured through the simulator carries a known
  optimism gap on the FILL side (kills stay valid — guard 6 means
  simulated fills were too FEW, i.e. real strategies trade more, not
  less; but "no volume available" conclusions like E-013 become
  model-scoped). Consequence: file a proposal for a queue-position-aware
  fill model (or live micro-validation) BEFORE building any HF maker
  strategy; do not write HF strategy code against the current simulator.
- Between 2× and 3×: report, no verdict; decide the follow-up from the
  distribution shape.
- Economics side-note (NOT a verdict criterion, context only): multiply
  W- and O-shares by the measured pair margins from prior runs to state
  what the capture gap is worth in $/market.

**Confounders pre-committed**: (a) level-size decreases conflate cancels
with trades — O is deliberately an upper bound; (b) the probe quotes both
sides always, so it measures the BOOK's capture ceiling, not any
strategy's; (c) 10-share unit is the RULES-style increment — capture
scales sub-linearly in size (depth consumption), so shares-based ratios
at other sizes need a re-run; (d) instant-requote (0ms) is physically
unreachable — the 140 ms variant is the deployable bound; (e) same 9-day
pinned window as E-022 — regime drift folded in, per-day reported.

design-ts (E-024): this commit, session 11 — before any computation.
