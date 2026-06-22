FRAMEWORK:

AlphaLab

- signal research

ResearchLab

- strategy idea proposal

Strategy Generator

- from signal or proposal to Code

Strategy Lifecycle
IDEA > CODE > BACKTEST > LIVE TRADING

Backtest Runner
Evaluators
custom
latest 500
latest 1000
latest 3000
latest 6000
latest 9000
all
walk-forward
walk-backward
Results/Statistics
run
market
segments

Strategy
Strucuture
Versions
Plugins
Registry

Distributed Backtesting System

Memory Manager

TOOLS

Polymarket Practical Guide

The rule I would use:
If a file is used by only one capability, keep it inside that capability.
If a file is used by three or more capabilities, move it to shared/.
If a file stores historical facts/results, put it in memory/.
If a file references general project docs, link to ../docs, do not duplicate it.
