# Literature note A1 — inventory-controlled market making & adverse selection

Session 1. Canonical theory mapped onto the gabagool concept. References
are the standard papers (by name/year — verify page-level details before
quoting numbers from them; the mappings below are the point).

## Avellaneda–Stoikov (2008) and successors

- Setup: a maker quotes bid/ask around a *reservation price* r(t) =
  mid − q·γ·σ²·(T−t), where q = signed inventory, γ = risk aversion,
  σ = volatility, T−t = time to horizon. Optimal half-spread also shrinks
  as T→t. Two structural lessons:
  1. **Inventory skews quotes, not sizes**: the standard solution moves
     BOTH quotes away from the accumulating side. The archetype's
     delta-parity accumulation (buy whichever leg restores balance) is a
     binary-market translation: with UP+DOWN merging to $1, "inventory"
     is the LEG IMBALANCE, not gross position — pairs are flat. So the
     A-S inventory penalty applies only to `netUp − netDown`, and the
     natural control is exactly what he did: quote only (or size up) the
     lagging leg. Gross inventory is capital usage, not risk.
  2. **Horizon term (T−t)**: as expiry approaches, holding imbalance is
     more dangerous per unit time (no time to mean-revert) → quotes
     should widen/withdraw near window end. Matches: SRP spread-capture
     measured late-window quoting as pure adverse selection (P42;
     quoteStopSec monotone better earlier), and the archetype's price
     band (p95 buy 0.85) implies he stopped providing once books decided.
- Guéant–Lehalle–Fernandez-Tapia (2013+): closed forms with inventory
  LIMITS — quotes switch off at ±Q_max. Translation: parity tolerance
  band (suspend the rich side at imbalance > x% of accumulated).
- Successor work on multi-asset MM: with correlated books (UP/DOWN are
  perfectly anti-correlated), the portfolio inventory term collapses to
  the imbalance — same conclusion from a different route.

## Glosten–Milgrom (1985)

- Spread exists because some counterparties are informed; each fill
  moves the dealer's posterior. The maker's break-even half-spread =
  E[loss to informed] / P(uninformed fill). Two mappings:
  1. In BTC 15m up/down, "informed" = anyone reacting to Binance spot
     faster than the book reprices. The zero-fee era subsidized exactly
     this taker (latency arbs) — yet the archetype still made 2c/pair.
     Explanation candidates: (a) informed flow lifts ASKS (taker BUYs
     the leg that spot favors) while gabagool rests BIDS on both legs —
     the seller-initiated flow hitting his bids skews uninformed
     (loss-cutting/panic, not spot-driven); (b) his band (0.31–0.63)
     avoids the near-certain regimes where informed flow dominates.
     TESTABLE from tape+books (D-series): classify hits-on-bids vs
     lifts-on-asks around spot moves.
  2. The 2026-01 fee did a Glosten–Milgrom regime shift: taxing takers
     removes marginal UNinformed flow first (informed flow's edge
     exceeds fee; noise flow's doesn't) → the remaining flow is more
     toxic per fill → maker margins compress even though makers pay no
     fee. That is precisely the measured transition (pair cost 0.98 →
     ≥1.00 within weeks). Lesson for the lab: fee changes reprice the
     WHOLE flow composition; never extrapolate maker EV across fee
     regimes (METRICS "per-era split" rule).

## Queue/fill models (why worst_queue is the wrong tail)

- Standard microstructure fill models (e.g., Cont–Stoikov–Talreja
  queue-reactive models; Moallemi & Yuan queue-position value): fill
  probability = f(queue position, arrival rates of market orders vs
  cancellations). A maker's realized spread = quoted spread − adverse
  selection, and the PROFITABLE fills are market-order arrivals that do
  NOT precede price moves. worst_queue keeps only fills where the price
  moved THROUGH the level — by construction the informed subset (fable
  E16: "the simulator selects exactly the non-noise fills"). D2's first
  read (45–56% of the archetype's real fills admitted at 1–3s windows)
  says the benign-arrival channel that queue models price is about HALF
  of his volume — invisible-in-sim, and it is the profitable half.

## Prediction-market microstructure specifics

- Bounded payoff [0,1] + hard expiry: volatility of the PRICE collapses
  near 0/1 (price ≈ probability; gamma concentrates near the strike at
  expiry). Market making near 0.5 mid-window ≈ making a high-vol asset;
  near expiry the book bifurcates (one leg →1, other →0) and two-sided
  quoting becomes pure directional exposure — theory agrees with every
  measured late-window kill (P42, P43, fable E24 opening/tail cells).
- Complement structure (UP = 1 − DOWN by arbitrage; venue-enforced
  mirror books, P38): there is only ONE book economically. Two-sided
  both-legs bidding = bidding both sides of one book — the pair-cost
  < $1 condition IS the bid-ask spread capture condition on that single
  book, harvested across time. This makes the concept literally
  textbook market making, with merge = the clearing mechanism.

## Implications for BTC-15m implementation

1. Inventory variable = leg imbalance; control by SIZING the lagging
   leg (archetype-verified) — not by A-S price skewing, which fights
   the venue's 1c tick granularity at $4 clips.
2. Add the A-S horizon term as a hard quote-stop: withdraw when
   remaining-time × imbalance risk exceeds the pair margin; measured
   priors say stop well before the final minutes and/or outside price
   band ~[0.15, 0.85].
3. Expect fee-regime shifts to change flow toxicity discontinuously;
   any validated parameterization carries a "regime stamp" and must be
   re-screened after venue fee/rebate changes (VENUE-DRIFT-style check).
4. The sim's fill model excludes the uninformed-arrival channel that
   funds real makers: a worst_queue-negative result does NOT kill the
   concept (D2 quantifies the blind spot); conversely a
   worst_queue-POSITIVE parity variant would be remarkable evidence.
5. Direction-of-flow asymmetry (bids get hit by uninformed sellers,
   asks get lifted by informed buyers) is a measurable, mechanism-level
   hypothesis for why BUY-only both-legs beat the SELL-side mirror
   (spread-capture, measured dead) — worth one tape measurement before
   any family proposal fixes the side.
