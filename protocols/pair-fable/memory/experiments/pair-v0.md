# Family: pair-v0 (baseline maker accumulation)

Strategy file: `protocols/pair-fable/strategies/pair.v0.ts` (id `pair-fable-v0`),
committed @ bcca2c8. Purpose: prove the research loop end-to-end (PLAN
`baseline-pair-strategy`), not profitability. This file is the family's memory;
one line per run in LEDGER.md.

## Design (v0)

- One resting GTD BUY bid at a time, always on the side with FEWER shares
  (tie → alternate). Structural consequence: |imbalance| ≤ incrementSize at all
  times — CONFIRMED over 55 markets: max |up−down| = 10.000000 = incrementSize
  [db MAX(ABS(up_shares-down_shares)) runs 861/862 | 2026-07-30].
- Pair gate: place at price p only if projected side avg after the fill keeps
  projAvg(side) + otherRef ≤ maxPairCost (otherRef = other side's actual avg if
  held, else its bestBid). Maker fills pay $0 fees so pair cost == pair_avg.
- Price = min(bestBid, gate cap floored to 0.01 grid), forced strictly below
  bestAsk at placement. GTD ttl 90s retires stale bids (no cancels → no
  cancel-id parity trap). Cooldown 25 ticks between orders.
- Capital cap `capPerMarket` ($50 default) — the evaluator-convention sweep
  knob. CONFIRMED binding: max(cost)=50.0000 exactly [db run 862 | 2026-07-30].
- Defaults: incrementSize 10, capPerMarket 50, maxPairCost 0.98, ttlSec 90,
  maxImbalance 20, cooldownTicks 25.

## Runs (2026-07-30, protocol pins 140/20ms, floor 2026-04-02)

| run | universe | pnl | ev/mkt | p/100 | trades m/t | notes |
| --- | --- | --- | --- | --- | --- | --- |
| 861 | 5 mkts (smoke, sequential, oldest-first from floor) | −8.90 | −1.78 | −6.41 | 30/0 | SMOKE PASS; behavior verified per market |
| 862 | 50 mkts (fleet, 4 machines, 21.8s, 0 failures) | −121.69 | −2.43 | −8.94 | 290/1 | batchUid pf0-baseline-50-20260730T200938-tdw70o |

Verdict (time-scoped per memory convention): v0 with default params was NOT
profitable on the first 50 protocol-floor markets (2026-04-02+) at 140/20ms —
EV −2.43/market, winRate 16.3%, profitPer100 −8.94 (median −11.59, p10 −100,
p90 +2.04). [run 862 | 2026-07-30] This is the BASELINE, not a dead end: v0
has no repricing, no entry timing, no end-of-window handling, and joins the
bid passively under the worst-queue maker model (which understates fill rate —
RULES safe bias).

## Loss anatomy (what actually kills it)

- Pairs earn at most 1−maxPairCost = $0.02/pair; a completed 50/50 market at
  the gate boundary earned exactly +1.00 (50 pairs × 0.02) [db run 861 slug
  …-1775088900: up=50, dn=50, cost=49, pnl=+1 | 2026-07-30].
- Losses come from UNPAIRED residue: the lesser-side bid does not fill and the
  surplus side settles worthless when it loses. p10 = −100/$100 means some
  markets lose their entire (small) investment — e.g. run 861 slug
  …-1775091600: 10 UP shares, 0 DOWN, cost 3.90, pnl −3.90 (DOWN won, UP bid
  filled once, DOWN bid never filled).
- Asymmetric fill risk: a resting bid fills (worst-queue) only when price
  trades THROUGH it — i.e. preferentially on the side the market is moving
  AGAINST (the run-852 lesson reproduced at increment scale). The pair
  completion leg then needs the price to come back.
- Reward:risk per increment is ~0.02 gain vs up to full increment notional
  loss — the gate alone cannot carry it; fills need better entry prices
  (deeper bids / timing) or repair logic.

## Engine facts run-verified by this family

- GTD place→expire→re-place loop works in replay; order_done(reason filled)
  arrives on complete maker fills; per-market strategy state reset works
  across 50 fleet markets (fresh episode each). [runs 861/862 | 2026-07-30]
- intent_meta persists exactly one entry per FILLED order (expired-unfilled
  orders leave no meta; meta_n == trade_count on every market) with full
  convention keys {t,i,side,ot,p,s,ts}. [db runs 861/862 | 2026-07-30]
- Maker-only intent stream CAN still produce a taker fill: book drift across
  the 140ms latency made 1 of 291 fills taker (fees 0.09 total). A
  placement-time price < bestAsk check cannot prevent this; accounting handles
  it (fee capitalized into cost). Judge "maker-only" claims by trades_taker,
  not by construction. [run 862 | 2026-07-30]
- Fleet batch of 50: 21.8s wall clock end-to-end incl. aggregate; machines
  527674ef4858×27, da1482db09f6×17, 8955f8d87c59×5 (producer slots — P-004),
  5a69e8aa2068×1. [run 862 | 2026-07-30]

## Variant ideas for mission 02 (untested — do not treat as knowledge)

- Entry condition: only start a market when upBid+downBid is comfortably under
  maxPairCost (both legs plausibly completable), instead of always quoting.
- Deeper placement: bid k ticks below bestBid for better pair prices (lower
  fill rate, better reward:risk per fill) — sweepable k.
- Imbalance repair: after a fill, price the completion leg more aggressively
  (toward its gate cap, still maker) instead of joining the bid.
- End-of-window discipline: stop opening NEW pair starts in the last N
  minutes; residue risk concentrates there.
- Lower maxPairCost (e.g. 0.95): fewer fills, 2.5× reward per pair.
- Reprice-on-drift: cancel+replace when our level goes stale (needs the
  both-ids cancel convention, parity.md §5.1).
