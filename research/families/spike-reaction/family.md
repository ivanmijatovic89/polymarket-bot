# Family: spike-reaction

**Thesis:** a fast move in the UP-token mid over a few seconds (a "spike") carries
information about the next few seconds of price.

**Status:** 🔴 **KILLED — 2026-06-10.** A real directional edge exists, but it is the
_same size as the execution cost_. Not monetizable at this signal / size on btc 15m.

## Candidates

| id  | strategy              | reaction / execution    | decisive run (`batch_uid`)       | verdict                                |
| --- | --------------------- | ----------------------- | -------------------------------- | -------------------------------------- |
| 001 | `OverreactionSnap.v1` | FADE the spike, taker   | `osnap-v1-probe-1`               | 🔴 win 27.6% — signal was sign-flipped |
| 002 | `SpikeMomentum.v1`    | FOLLOW the spike, taker | `spikemom-sweep-10` (best of 18) | 🔴 gross ≈ break-even, fee-bound       |
| 003 | `SpikeMomentum.v2`    | FOLLOW, maker entry     | `spikemom-v2-maker-2`            | 🔴 gross −$676, adverse selection      |

Full taker surface: `spikemom-sweep-01..18`. A/B direction check: `spikemom-v1-probe-2`.
Exact metrics in `backtest_runs` (query by `batch_uid`).

## The lesson (reusable knowledge)

1. **Direction.** 15m btc spikes **continue** more than they revert. Fading lost (27.6% win);
   following the _same_ signal won every metric (40% win). The signal was real but sign-flipped —
   a sub-50% directional win rate is a flipped signal, not noise.
2. **Exit shape (taker).** Let winners run, cut losers fast. EV climbs with `takeProfit` and with
   tighter `stopLoss`; interior optimum at **tp ≈ 0.12 / sl ≈ 0.02**. `maxHoldSec` is a dead knob.
   At the ridge top, **GROSS PnL ≈ $0** (break-even _before_ fees).
3. **The wall (a pincer).**
   - _Taker_ captures the immediate continuation, but gross tops out at break-even → taker fees
     (~$325 / 1000 markets) turn it into a guaranteed loss.
   - _Maker_ removes the fee, but a resting buy on a momentum signal is **adversely selected**:
     it fills on down-ticks (reversals) and cancels on continuations → gross collapses (−$676).
   - The momentum edge ≈ the execution cost. No free lunch.

## Pre-registered kill criteria (all met)

- Best param region ≤ baseline net of fees. ✅
- Only survives with idealized fills / zero cost (gross ≈ break-even at best). ✅

## What would reopen this family

- A cheaper fee tier or **maker rebates** that flip the fee sign.
- A **stronger / conditioned signal** that lifts gross above the spread — e.g. spike **+ orderbook
  imbalance confirmation** — i.e. a different signal, not re-tuning these knobs.
- Other symbols / larger size where spikes carry more follow-through.

## Reuse

`SpikeMomentum.v1/v2` carry a clean exit state-machine (take-profit / stop / maxHold /
late-window bailout + marketable-sell helper). Lift it for the next family rather than rewriting.
