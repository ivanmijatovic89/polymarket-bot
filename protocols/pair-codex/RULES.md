# Pair Protocol — Rules

These are human-owned boundaries. Models may propose changes, but they must not
change or bypass these rules without explicit human approval.

## Strategy boundaries

1. Research only Bitcoin 15-minute Up/Down markets for now.
2. The strategy buys both UP and DOWN shares and seeks a fee-inclusive combined
   cost that leaves a profitable margin below the pair's $1 settlement value.
   The entry threshold is not fixed by the human. Research must determine
   whether it should be $0.98, $0.97, $0.90, dynamic, or something else.
3. The strategy may buy but must never sell. Its only exits are merge and
   redemption.
4. Pair inventory should be accumulated incrementally. The research system
   must account explicitly for unmatched inventory and directional risk.
5. The intended edge is structural execution and market microstructure, not a
   strategy whose profit depends primarily on predicting Bitcoin direction.
6. Strategy implementation details—including practical entry margin, sizing,
   maker/taker behavior, order placement, and unmatched-leg management—belong
   to research and are not fixed here.

## Fees and accounting

1. All results are fee-inclusive.
2. Maker fills pay no fee.
3. Taker fills use the full tier-0 crypto fee curve:
   `shares × 0.07 × price × (1 − price)`.
4. Rebates or fee discounts must not be assumed.
5. Capital usage, unmatched exposure, and profit must be reported together. A
   profit number without the capital and risk required to produce it is not
   sufficient evidence.

## Backtesting

1. Use Telonex `delta-typed` data for BTC 15-minute markets, with a protocol
   universe starting at `2026-04-02T00:00:00Z`.
2. Backtest strategies must not emit `merge_positions`. The current simulator
   does not account for mid-market merges correctly; paired positions are held
   to settlement for scoring.
3. Every evidentiary run must pin and record all execution assumptions,
   including latency and jitter.
4. A promoted strategy must not depend on one favorable latency setting. The
   exact robustness test is designed during Mission 01.
5. Strategy code must remain compatible with the engine's shared
   live/backtest strategy path, but this protocol only executes backtests.
   Simulator limitations must be measured and reported as risk.
6. Performance claims must be reproducible from recorded evidence. Mission 01
   decides the exact manifest, run metadata, and verification system.

## Safety and authority

1. This is a backtest-only protocol. Models must not start, control, monitor,
   or modify dry-run or real-money trading processes.
2. No model may place orders or access live-trading credentials. The human
   handles all live testing manually outside the protocol.
3. Models do not change shared engine code during this protocol. Engine bugs
   and improvement requests must be reported with an exact reproduction for
   human review.
4. Models must not edit this file, `VISION.md`, or the canonical mission files.
5. Models may design their own research workspace and conventions within the
   permissions provided by the human-controlled launcher.
6. Mission transitions require human approval. Completing Mission 01 does not
   authorize Mission 02.
