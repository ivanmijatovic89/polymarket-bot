# Family: pair-v6 (maker leg + instant taker completion) — Phase 0: data scan

Second axis after the E-014 class kill. The killed class rested maker orders
on BOTH legs and held unrepaired residue to settlement (the ~20–28%
per-start doom is where the −0.06/share invariant lives). pair-v6 keeps ONE
maker leg (fee-free fill) but completes the pair IMMEDIATELY as taker:

> Rest one bid joining bestBid on side X. When it fills, buy side Y at its
> current ask iff `fillPrice + askY + fee(askY) ≤ gate`; otherwise handle
> the residue by abort policy (Phase 1 design — never held silently).

The doom mode becomes "expensive completed pairs + rare measurable aborts"
instead of unbounded residue. Whether the economics survive is exactly what
the −0.06 invariant makes doubtful: trade-through fills are adversely
selected, and by the time our completion order lands (+140 ms), side Y's
ask has repriced. Phase 0 measures that repricing from recorded books,
BEFORE any strategy code.

## Pre-registered definitions (written BEFORE the scan ran)

- Universe + replay + fee curve: identical to pair-v5 Phase 0 (same scan
  pass, latest-800 local, engine book reconstruction, 0.07·p·(1−p)).
- **Trade-through moment (sim-faithful fill proxy)**: at an event where side
  X's new bestAsk < X's bestBid *before* the event (worst-queue trigger,
  simulator.md: a resting BUY at P fills only when bestAsk < P). Fill price
  P = the pre-event bestBid (a joiner's resting price). This proxies a
  strategy that always has a fresh join-bid resting — optimistic on quote
  freshness, which OVERSTATES opportunity count, a one-sided bias that makes
  a KILL a fortiori (same logic as pair-v3's fill-time bias).
- **Refractory 5 s per side**: after a counted moment on side X, further X
  trade-throughs within 5 s are not counted (one resting bid, requote
  cadence ≈ latency + cooldown). Raw counts reported for context; economics
  computed on the refractory set.
- **Completion readout per moment**: askY@t (zero-latency) and askY@t+140ms
  (as-of book state — the price our taker completion actually meets), its
  best-level size, completion cost `C = P + askY140 + fee(askY140)`,
  completion margin `1 − C`.
- **Residue readout per moment (replaces "free abort")**: did side X win at
  settlement (`resultId`: '0'⇒UP/assetId0, '1'⇒DOWN/assetId1)? Residue EV
  per share if NOT completed = `1{X wins} − P`. Reported conditional on
  C ≥ gate (the only states where residue is actually held).
- **Headline (upper bound, 10-share increments)**: per-market
  `Σ 10 × max(0, 1 − C)` over refractory moments — the family's EV upper
  bound assuming free aborts. Then the abort-corrected view: at gate 1.00,
  `Σ 10 × [ (1−C)·1{C<1} + residueEVshare·1{C≥1} ]`.
- Verdicts computed on fill prices P ∈ [0.10, 0.90] (sane pair band) AND on
  the full set; extremes reported as a stratum.

## Pre-registered priors (honest)

The per-start invariant says a maker trade-through fill carries ≈ 6c/share
of adverse selection net of achievable pair margin under repair-at-cap. If
that cost is mostly "side Y repriced before any completion could happen",
then E[C] will sit near or above 1 and P(C<1) will be small with thin
margins — family dead. If instead a material fraction of trade-throughs are
benign two-sided flow where askY has NOT moved at +140 ms, completion can
lock small margins at high frequency and the family lives where the killed
class could not (it never paid the residue tail). The scan discriminates
these two worlds directly.

## Pre-registered verdicts

- **BUILD v6**: abort-corrected per-market EV (sane band, gate 1.00 or any
  tighter gate) ≥ $0.25 AND P(C < gate | moment) ≥ 20% (enough completions
  that the strategy is mostly its intended mechanism, not an abort machine).
- **WEAK**: upper-bound (free-abort) EV ≥ $0.25 but abort-corrected < 0.25
  — the completion economics exist but residue kills them; only then is
  Phase-1 abort-policy design worth a session.
- **KILL the family**: free-abort upper bound < $0.10/market on the sane
  band — if even free aborts can't pay, no abort policy can. Time-scoped.

Confounders pre-committed: (a) askY@t vs askY@t+140 gap reported — if the
margin exists at t but dies by t+140, that is a latency-sensitivity red flag
(RULES: must not be latency-dependent; the standard upward sweep would
follow in Phase 1); (b) completion depth: fraction of completable moments
with askY size ≥ 10 shares (increment size); (c) moments per market
distribution — a family that only fires in 3% of markets cannot carry
goal 1 alone regardless of margin.

## Phase 0 results (2026-07-31, session 4) — VERDICT: KILL the family

Tool: `tools/bookscan.ts` (one pass shared with pair-v5 Phase 0; 800/800
markets, 199.5M events). Evidence JSON:
`data/bookscan-2026-07-31-latest800.json`. Pre-registration committed at
2e9bfef BEFORE the scan. Numbers below are the sane band (P ∈ [0.10,0.90],
4,247 refractory moments in 747/800 markets, ≈5.3/market); the full set
(5,039 moments) agrees on every verdict-relevant number.

- **The complement has ALREADY repriced at the fill instant.** Zero-latency
  completion cost C p50 = 1.0159 — before our completion order even
  leaves. By +140 ms, C p50 = 1.0373 (askY drifts a further +0.0285 mean).
  Distribution: p10 1.0167, p90 1.0675. Depth was never the binding issue
  (91% of moments have ≥10 shares at askY) — price is.
- **P(C < 1) = 2.4%** (mean margin when below: 0.032); tighter gates are
  rarer still (P(C<0.98) = 1.1%). Free-abort upper bound = **$0.041/market**
  vs the $0.10 kill bar → KILL fires. The WEAK prong (abort-policy design)
  is ALSO closed: residue EV is −0.031/share (see below), so no abort
  policy can rescue completion economics this thin.
- **Hold-all readout (the "never complete, hold the dip" directional
  variant): NEGATIVE.** Win rate 47.5% vs mean fill price 0.504 ⇒
  −0.029/share; per-market EV −$1.51 (p50 −$1.10); only 36% of markets
  positive; negative on 8 of 9 scan days — the sole positive day is the
  34-market partial day 07-14, which is exactly what the 10-market smoke
  sample saw and mistook for signal (+0.04/share tease, refuted at n=800).
  Abort-corrected family EV: −$1.55/market.
- **The −0.06/share per-start invariant now has a decomposition**: ≈1.6c
  of instant complement repricing + ≈2.9c more within 140 ms on the
  completion leg, and −2.9c of unconditional directional adverse selection
  on the filled leg itself. Trade-through fills are adversely selected
  unconditionally — not merely conditionally on repair failure (closes the
  question pair-v4's parity caveat left open, within sim evidence).
- Bias direction (pre-registered): the fresh-quote fill proxy overstates
  opportunity; a real resting bid is staler and fills worse — every number
  above is an upper bound, so KILL a fortiori.

**Interpretation**: at 140 ms there is no moment after a maker fill where
the pair can be completed below $1 often enough to matter, and the fill
itself carries negative directional value. Together with pair-v5's Phase 0
(no takeable two-sided arb) this closes BOTH instant-completion routes.
Time-scoped 2026-07, latest-800.
[tools/bookscan.ts | data/bookscan-2026-07-31-latest800.json | 2026-07-31]
