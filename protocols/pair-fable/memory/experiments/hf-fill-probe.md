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

## Result E-024 (session 12, tools/fillprobe.ts, pinned 800, 0 skipped)

> **DOWNGRADED by E-025 (session 13), per E-025's frozen rule**: the O
> bound is **uninformative** — trade-print calibration measured the
> cancel share of ToB level decreases at **99.1%**, and the
> trade-confirmed ceiling T sits BELOW worst-queue (T140/W140 = 0.65).
> "Materially binding" described the [W, O] interval, and that interval
> was almost entirely cancels. The engine's worst-queue rule is an
> acceptable capacity bound for ToB maker capture. See §Result E-025.

**VERDICT: FILL MODEL MATERIALLY BINDING** — O/W on shares = **235.4×** at
0 ms (frozen bar: ≥ 3×) and **29.2×** at the deployable 140 ms bound.
Every one of the 9 days is far above 3× (range 120.7–385.0). Archive:
`data/fillprobe-2026-07-31-latest800.{json,jsonl}` (checkpoint has
per-market rows). Universe: latest-800 ≤ 1784762100000, slugs
1784043000–1784762100 (2026-07-14→07-22), full 15-min windows,
~178k book events/market.

Headline numbers (shares/market, both sides summed, 10-share unit):

| variant | shares/mkt | fills/mkt | p10 / p50 / p90 |
| --- | --- | --- | --- |
| W 0ms | 235.4 | 23.5 | 40 / 120 / 340 |
| W 140ms | 897.5 | 89.8 | 370 / 810 / 1550 |
| O 0ms | 55,413.9 | 6,976.6 | 27,177 / 52,056 / 87,416 |
| O 140ms | 26,214.9 | 3,396.7 | 16,024 / 25,885 / 36,970 |

Raw top-of-book maker flow (pre-event bestBid level decreases, cancels
included by design): **6,960 events/market, 225,146 shares/market**
(p10 77k, p50 192k, p90 426k). The 700-trades/window operator
(market-context.md) is comfortably inside observed top-of-book activity
even if only a few percent of level decreases are true trades.

Consequences (frozen in the pre-registration):
- All maker-family kills (E-014/E-016/E-017/E-018/E-019/E-021) STAND —
  guard 6 optimism direction unchanged (real strategies fill more, not
  less). But every "no volume available / fill-limited" conclusion
  (E-013 chiefly) is now **model-scoped**: the engine cannot pin maker
  capture within a factor of ~29–235, so it cannot certify that the
  700-trade regime is unreachable.
- **Do NOT write HF maker strategy code against the current simulator.**
  Filed P-011 (queue-aware fill model / trade-print calibration).

Secondary findings (not verdict criteria, recorded for reuse):
- **W-latency inversion**: W140 = 3.8× W0 (897.5 vs 235.4 shares/mkt).
  Under worst-queue, ADDING latency multiplies fills — a lagged quote
  rests at stale (too-high) prices and is picked off when the book
  falls through it. Worst-queue fills are adverse-selection events by
  construction; W fill counts must never be read as benign capture.
  Consistent with the E-014 −0.06/share per-start invariant.
- O captures on essentially every decrease event at 0 ms (6,977
  fills/mkt vs 6,960 decrease events/mkt) — the O ceiling is the
  decrease flow itself, clipped at 10/event.
- Economics side-note (context only, per pre-reg): at run-872's measured
  completed-pair margin (~2.8¢/paired share, gate 0.98), and pairing
  probe shares across sides (÷2): W140 ≈ $12.6/mkt, O140 ≈ $367/mkt of
  gross margin ceiling — the 140 ms capture gap is worth ~$354/mkt
  BEFORE adverse selection, stranding, and the cancel-share of O. Not
  an EV claim; it sizes why the model gap matters.
- Implementation note (within pre-reg intent, recorded for exactness):
  O capture per event is min(decrease, remaining-of-10) with the order
  re-armed instantly (0 ms) / after 140 ms on consumption or reprice —
  i.e. an honest 10-share order lifecycle, marginally tighter than a
  literal per-event min(decrease, 10).

## E-025 pre-registration (session 12, BEFORE any computation) — trade-print calibration

E-024 leaves a factor-~29–235 interval between W and O because level
decreases conflate cancels with trades. The recorded live-WS dataset
(`data/events/btc/*.parquet`, 36 local files, slugs from 1784637900 =
2026-07-21, overlapping the pinned window's tail) carries
`last_trade_price` events with price, size, AND taker side — true
executed volume. This calibrates where reality sits in [W, O].

**Method** (reanalysis, no strategy code, no fleet): replay each recorded
btc file's market channel (book + price_change + last_trade_price; the
recorded stream is self-contained), maintain per-asset book state, and
compute on the SAME stream:
1. **W and O quoters exactly as E-024** (same automaton, 0/140 ms) — and
   for slugs common with the E-024 archive, report per-slug W0/O0 both
   ways as a dataset-parity note (approximate agreement expected; no
   verdict — different capture paths).
2. **T (trade-confirmed front-of-queue) quoter**: same automaton, but
   capture = min(executed trade volume at our level while quote rests
   there, remaining), counting only trades whose maker side is the bid —
   taker side SELL at price ≤ pre-event bestBid... precisely: side ==
   SELL and |price − quote| < ε. Pre-commit on side semantics: verify on
   a sample that SELL means taker-sell (trade prints at bestBid, not
   bestAsk); if ambiguous, fall back to price-based attribution
   (trade at price ≤ pre-event mid ⇒ bid-side execution) and say so.
3. **Raw flows per market**: total trade count/volume; trade volume at
   pre-event bestBid (bid-side maker flow, the T ceiling); decrease
   events/volume at bestBid (the O ceiling) ⇒ **cancel share of
   decreases** = 1 − tradeVol/decreaseVol at bestBid.

**Frozen readouts**: T0/T140 shares+fills per market; ratios T/W and O/T
(both latencies); cancel share of decrease volume; per-market
p10/p50/p90; trades/market (count) vs the 700 figure.

**Frozen interpretation** (calibration, NOT a family verdict — n≈36,
~2 days, one regime):
- T140 ≤ 2× W140 ⇒ the trade-confirmed ceiling is near worst-queue: the
  E-024 gap is mostly cancels; the current fill model is an acceptable
  bound for maker capture, and E-024's "materially binding" is
  downgraded to "O-bound uninformative" (record in both places).
- T140 ≥ 3× W140 ⇒ the engine materially understates trade-confirmed
  capture ⇒ P-011 escalates: queue-aware fill model calibrated by T (or
  live micro-probe P-009) becomes a prerequisite for ANY maker-capture
  claim, not just HF.
- Between ⇒ report; carry both bounds in all future maker reasoning.

**Confounders pre-committed**: (a) n≈36 markets from ~2 days — a
calibration factor, not a universe claim; (b) recording-path latency
and event ordering differ from the telonex stream (hence the parity
note); (c) T assumes front-of-queue — still an upper bound on a joiner,
but a far tighter one than O; (d) 10-share unit as E-024; (e) trade
prints may undercount (WS drops) — treat T as a lower bound on true
flow when reading the cancel share.

design-ts (E-025): this commit, session 12 — before any computation.

## Result E-025 (session 13, tools/tradeprobe.ts, 36 recorded markets)

**VERDICT (frozen branch 1): T140 ≤ 2× W140** — the trade-confirmed
front-of-queue ceiling is not above worst-queue, it is BELOW it:
**T140/W140 = 0.646** (609.7 vs 944.2 shares/mkt), T0/W0 = 0.797. Zero
of 36 markets reach the 3× escalation bar (per-market p10/p50/p90 =
0.41/0.63/1.08, max 1.72); both days agree (0.69 on 07-21 n=24, 0.52 on
07-25 n=12). Archive: `data/tradeprobe-2026-07-31.json` (per-market rows
included).

**Cancel share of ToB bid-level decrease volume = 99.13%** (per-market
p10/p50/p90 = 98.5/99.1/99.6%). E-024's O bound was almost entirely
cancels ⇒ E-024's "materially binding" verdict is downgraded to
**"O-bound uninformative"** (annotated in §Result E-024, per the frozen
rule "record in both places").

Headline numbers (shares/mkt, both sides summed, 10-share unit):

| variant | shares/mkt | fills/mkt | p10 / p50 / p90 |
| --- | --- | --- | --- |
| W 0ms | 755.6 | 75.6 | 20 / 100 / 2,790 |
| W 140ms | 944.2 | 94.4 | 340 / 930 / 1,510 |
| T 0ms | 602.0 | 95.9 | 252 / 580 / 1,016 |
| T 140ms | 609.7 | 97.3 | 282 / 568 / 1,082 |
| O 0ms | 52,135 | 6,297 | 19,540 / 53,335 / 87,356 |
| O 140ms | 22,293 | 2,781 | 10,665 / 24,030 / 33,872 |

(W levels here are higher than E-024's pinned-800 averages — the 36
recorded markets skew to an active regime; per-slug parity below shows
the pipelines agree, so it is composition, not measurement.)

Raw flows per market: **1,027 trade prints / 34.0k shares total** (both
sides, all price levels); taker-SELL prints at the pre-event bestBid
(the T ceiling flow): **95.7 prints / 2,187 shares**; decrease flow at
bestBid: 6,226 events / 252.6k shares (the O ceiling — 99% cancels).

Side-semantics pre-commit executed (4-file sample, `--verify-side`):
SELL prints at pre-event bestBid 455 vs 100 at ask; BUY at ask 3,200 vs
663 at bid — **taker-side semantics CONFIRMED** (~72% clean in both
classes, symmetric; the crossings are book-state lag during fast moves —
classification is against the pre-event book). Primary side-based
attribution used; the price-based fallback was not needed.

Dataset-parity note (24 slugs common with the E-024 archive): mean
recorded/telonex O0 ratio **0.995**; W0 near-identical per slug (e.g.
4350 vs 4340, 80 vs 80, 12900 vs 12720). The recorded-WS and telonex
delta pipelines agree on book dynamics — strong cross-validation of
both.

Consequences:
- **The current worst-queue fill model is an acceptable capacity bound
  for ToB maker capture** (W within 0.65–1.6× of trade-confirmed T at
  both latencies, on the generous side). The E-024 consequence "no HF
  maker strategy code against the current sim" lifts as a MODEL
  constraint. All maker-family kills stand, now without the 29–235×
  optimism caveat.
- **E-013 "fill-limited" is restored to (approximately) a market fact**
  at ToB/10-share unit: trade-confirmed capture ceiling ≈ 610 shares /
  ~97 fills per market — an order of magnitude below the 700-trade
  regime, even for a front-of-queue quoter with no budget.
- **The 700-trades figure reinterpreted**: TOTAL trade prints per market
  measured 704 (quiet day) and 1,189 (busy day). A 700-trade operator
  would be ~all executed trades in the window — the figure almost surely
  counts order placements/replacements (consistent with 6,226 ToB
  decrease events/mkt of cancel-dominated quoting), not fills. Recorded
  in market-context.md.
- **HF ToB maker economics measured modest**: T140 ceiling ≈ 610 sh/mkt
  ⇒ ~305 paired shares × ~2.8¢ measured pair margin ≈ **$8.5/mkt gross
  ceiling** (before adverse selection, stranding, and queue position —
  T assumes front-of-queue). The HF maker axis is deprioritized on
  measured economics, not on model uncertainty. P-011 resolved
  (self-served); engine work (queue-aware fill model) NOT needed.

Caveats (pre-committed): n=36, ~2 days, one regime — a calibration
factor, not a universe claim; T assumes front-of-queue (upper bound for
a joiner); 10-share unit; trade prints may undercount (WS drops) ⇒ T is
a lower bound on true flow; 4 `-terminated` files with partial coverage
(385–785 s of 900) included — levels biased down slightly, within-market
ratios unaffected (T and W measured on the same truncated stream).

Implementation notes (recorded for exactness, within pre-reg intent):
T capture is trade-only — no W-rule fills — reading the frozen "capture
= min(executed trade volume at our level while quote rests there,
remaining)" literally; T's 0 ms variant re-arms at the standing quote
level on full consumption (a trade print does not mutate the book; the
next book event reprices if bestBid moved).
