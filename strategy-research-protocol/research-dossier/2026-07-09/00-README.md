# Research Dossier 2026-07-09 — BTC 15m Up/Down Strategy Fan-Out

This dossier is the output of a seven-lane parallel research fan-out run on
2026-07-09: seven independent research lanes (microstructure literature,
binary pricing theory, venue mechanics, competitor landscape, engine
capabilities, internal findings, behavioral biases) each produced a
standalone brief, and a synthesis stage cross-referenced them into ranked,
ProposeFamily-ready candidate families
([`strategy-research-protocol/research-dossier/2026-07-09/08-candidate-families.md`](./08-candidate-families.md)).
Scope throughout: Polymarket BTC 15-minute up/down binaries, in-stream
replayable inputs only, per
[`strategy-research-protocol/SCOPE.md`](../../SCOPE.md). All external claims
carry citations in the lane briefs; internal numbers are quoted from family
research logs (nothing modeled).

## Contents

| File                                                             | One-line description                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00-README.md`](./00-README.md)                                 | This index and executive summary.                                                                                                                 |
| [`01-microstructure-signals.md`](./01-microstructure-signals.md) | Order-book/trade-flow literature (OFI, VPIN, cancellations, resiliency, micro-price, spreads) transferred to this venue; 8 ranked drivers.        |
| [`02-binary-pricing-theory.md`](./02-binary-pricing-theory.md)   | Parameter-free fair-speed null model for near-expiry binaries (Monte Carlo verified); decay, hover, and QV-budget drivers.                        |
| [`03-polymarket-mechanics.md`](./03-polymarket-mechanics.md)     | Current fees, rebates, CLOB v2, split/merge, Chainlink resolution, tick regimes; 6 structural opportunities, confidence-flagged with live probes. |
| [`04-competitor-landscape.md`](./04-competitor-landscape.md)     | Public bots, claimed edges, flow composition; which edges are crowded/dead and 6 underexplored book-stream-only angles.                           |
| [`05-engine-capabilities.md`](./05-engine-capabilities.md)       | Source-anchored map of what the backtest engine replays today, its 10 limits (L1–L10), and CHEAP/MODERATE/BLOCKED idea classes.                   |
| [`06-internal-findings-map.md`](./06-internal-findings-map.md)   | Every empirical in-protocol result (4 families, ~30 experiments), consolidated market picture, 6 contradictions, ranked gaps.                     |
| [`07-behavioral-biases.md`](./07-behavioral-biases.md)           | FLB, in-play over/underreaction, loss-chasing, anchoring, herding — each mapped to an in-stream footprint; 7 ranked drivers.                      |
| [`08-candidate-families.md`](./08-candidate-families.md)         | **The payoff:** merge map, 8 ranked ProposeFamily-ready family briefs, and the "do not bother" list.                                              |

## Executive summary — the ten most decision-relevant facts

1. **The in-scope game is inference of spot-watchers' footprints.** BTC spot
   is the one input we cannot see; everyone informed is watching it. Every
   viable in-stream signal reads the _footprints_ the spot-watchers leave —
   cancels, repricings, prints, decay gaps — faster or cheaper than the book
   adjusts (lane 01 §0).
2. **A parameter-free null model exists and nobody uses it.** Fair binary
   price volatility is `φ(Φ⁻¹(p))/√τ` — independent of BTC's vol. It gives
   exact fair speeds (50/50 at 60s left should move ~5.15¢/s), fair
   conditional decay (+7.1¢ from 0.70 over 120→60s if the book is silent),
   and hover probabilities (5.3% for [0.40,0.60] at τ=60s). All Monte Carlo
   verified; all computable from mid + clock alone (lane 02).
3. **Validated internal knowledge is narrow but real:** one taker fee is
   ~$0.11–0.12/mkt at size 20 and redemption is free; deep-book depth-ratio
   _flow_ carries ~+0.146 gross/mkt (champion, 9000 markets); every tested
   exit lost to hold-to-redemption; makers get only toxic fills here (nine
   screen-pass/confirm-fail cycles); win rate anti-correlates with EV
   (lane 06).
4. **The champion's edge is a recent-regime edge:** monthly EV Mar −0.23,
   Apr −0.18, May +0.21, Jun +0.42. That sign flip straddles the 2026-04-28
   CLOB v2 exchange migration — regime conditioning and calendar-aware
   judging are not optional (lanes 06, 03).
5. **Fees are dynamic, operator-set, and shaped:** live crypto taker fee is
   `0.07·p(1−p)` per share — 1.75¢ at p=0.50 but only 0.63¢ at 0.90 and
   ~0.14¢ at 0.98 — while the engine charges flat 156 bps of notional. The
   live schedule _undercharges extremes and overcharges mid-range relative
   to the backtest_, favoring favorite-zone strategies; fees must be
   measured per fill, never modeled (lane 03 §1.1, lane 05 §2.3).
6. **The two books are one book mirrored** (live probe: identical sizes,
   ask sum 1.01). Complement-sum arbitrage and cross-book staleness signals
   are structurally empty; UP+DOWN cross-leg state is still free in every
   engine snapshot (lanes 03, 05).
7. **The public competition is uniformly anchored on external feeds**
   (Binance/Chainlink latency, TA dashboards, sum<$1 rebalancing — all
   crowded, fee-taxed, or dead). Nobody public does book-stream-only
   microstructure on these markets; flow is ~6,189 bot addresses making 56M
   trades at $6–7 vs a thin retail minority that picks winners but loses on
   timing (lane 04).
8. **Resolution mechanics carry tradable asymmetries:** Chainlink Data
   Streams point-read at window end (not an average); exact tie resolves UP
   (fair UP = P(up) + P(tie)); tick tightens 0.01→0.001 beyond 0.96/0.04
   (unconfirmed on 15m — measure); redemption latency sets compounding
   velocity across ~96 windows/day (lane 03).
9. **Behavioral residuals concentrate late and at extremes:** cut-off
   effect + late-favorite FLB ("Midas" harvesting is documented profitable
   in-play), surprise-conditioned over/underreaction, round-tick barriers —
   while minutes 7–15 of the episode have never hosted a deliberate entry
   by any internal family (lanes 07, 02, 06).
10. **Top-ranked new families:** (1) `quiet-decay` — silence-conditioned
    time-decay favorite capture (cheap, three-lane convergence);
    (2) `liquidity-pull` — cancel-led depth-evaporation follow (needs
    entry-overlap dedup vs the champion); (3) `speed-ratio` — fair-QV
    deviation fade/follow (cheap, pure mid+clock). The single cheapest next
    action is not a new family at all: **run the already-proposed
    momentum-hold 000** (lane 06, gap 1). Full briefs in
    [`08-candidate-families.md`](./08-candidate-families.md).

## Infrastructure action items (non-strategy work the dossier surfaced)

1. **Immediate-fill latency optimism — fix ENGINE.md and require latency envs.**
   ENGINE.md says backtests use queued intent execution flushed at tick N+1;
   in reality every current path runs `intentExecutionMode: 'immediate'`
   (`src/backtest/runSingleMarket.ts:145`) with default zero latency, so
   taker intents fill against the exact snapshot the strategy just observed.
   Optimistic for every fast-reacting family (candidates 2, 3, 4, 6, 7).
   Action: correct ENGINE.md; make `BACKTEST_LATENCY_DELAY`/`JITTER` (jitter 0
   for determinism) a mandatory robustness axis for event-triggered takers
   (lane 05 §2.2, §7).
2. **Expose trade prints (engine limit L1) — highest-ROI single change.**
   `last_trade_price` is recorded into `OrderBookEngine.recentTrades` (cap 200) but not exposed in `OrderBookSnapshot` and emits no tick. This blocks
   the entire trade-flow signal class (tape-burst, quote-cause, sweep-refill,
   small/large-print divergence, whale-fade, wash-flow hygiene). Small-to-
   moderate change with live/backtest parity by construction; follow-up:
   audit aggressor-side label accuracy (~59% for public-feed inference in the
   literature, arXiv:2604.24366) (lane 05 §5 L1, lane 01 §7).
3. **FOK synthetic CONFIRMED — doc contradiction.** ENGINE.md claims MINED
   and CONFIRMED are never simulated; in fact FOK full fills emit a synthetic
   `CONFIRMED` (`BacktestExecution.ts:515-529`) while resting orders stop at
   MATCHED and MINED is never emitted. Fix ENGINE.md; note that strategies
   gating on `MINED` never exercise that path in backtests (lane 05 §2.3, §7).
4. **April 2026 CLOB v2 migration breaks data homogeneity.** 2026-04-28:
   full exchange upgrade (CTF Exchange V2, pUSD collateral, all resting
   orders wiped, fees became operator-set at match time). The Mar–Jun dataset
   spans this boundary; the champion's monthly sign flip coincides with it.
   Action: tag runs/segments by pre/post-migration and treat cross-boundary
   averages as suspect; consider a migration-boundary flag in eligibility or
   stats (lane 03 §4, lane 06 §2).
5. **Fees must be measured, not modeled — and the engine's flat model is
   mis-shaped.** Live fees are dynamic per market (`getClobMarketInfo()`, raw
   metadata contradicts the docs table), formula `0.07·p(1−p)`/share vs the
   engine's flat `BACKTEST_TAKER_FEE_BPS=156` of notional: mid-range entries
   are undercharged and extreme-favorite entries overcharged in backtests.
   Action: reconcile realized fee per fill from trade reports against the
   engine constant, per price band; make the fee a per-run parameter (L9)
   (lane 03 §1.1, lane 05 §5 L9).
6. **Dead-tail markets pollute latest-N selections.** The ~39 newest markets
   (after `btc-updown-15m-1781394300`, Jun 13–14) contain only pre-window
   snapshots and replay as `no_in_window_activity`; eligibility gates on
   conversion/resolution, not in-window event presence, so they silently
   dilute every latest-N denominator and make `--latest --limit 10` smokes
   look like broken code. Action: add an in-window-activity check to
   `telonexEligibility.ts` (or exclude the dead tail), and record fresh data
   — the recorder has been stopped since Jun 13-14 (lane 06 §2, LESSONS).
7. **Secondary items:** thread `makerFillMode` (`touch_or_better` exists,
   hardcoded to `worst_queue` — maker numbers are a conservative bound,
   lane 05 L3); build the offline per-slug feature store + loader plugin to
   unlock cross-episode families (L5, candidate 8); confirm whether
   `tick_size_change` fires on 15m markets in the final seconds (endgame
   quoting depends on it, lane 03 §2.1); measure redemption→spendable-pUSD
   latency (capital velocity across consecutive windows, lane 03 §5);
   maker rebates (~20% of taker fees, per-market pools) are not simulated
   at all — any maker-family EV is understated by that amount (lane 03 §1.2).
