---
layout: home

hero:
  name: Polymarket Bot
  text: Live trading + deterministic backtesting
  tagline: Same strategy code runs in live trading and backtests — on the exact same tick stream.
  image:
    light: /img/logos/polymarket-twin-engine.png
    dark: /img/logos/polymarket-twin-engine-dark.png
    alt: Polymarket Twin Engine
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/ivanmijatovic89/polymarket-bot

features:
  - title: Deterministic Backtesting
    details: Parquet captures raw WebSocket events. Backtests replay them tick-by-tick using the same MarketEngine as live trading.
  - title: Strategy System
    details: Write a strategy once, run it in backtest and live. Validate with Zod params, plug in volatility indicators and external feeds.
  - title: Multi-symbol Support
    details: BTC, ETH, SOL, XRP — 15-minute Up/Down markets on Polymarket CLOB. Record, backtest, and trade any symbol.
---

## What This Project Is

`polymarket-bot` is a live trading bot + deterministic backtesting engine for Polymarket.

Core invariant:

- **Live trading and backtesting must use the same strategy logic and tick semantics.**

## Documentation Map

1. [Quickstart](./quickstart)
2. [Architecture](./other/architecture)
3. [Live Runtime](./live-runtime)
4. [Backtest Runtime](./backtest-runtime)
5. [Recording + Parquet](./recording-parquet)
6. [Strategy System](./strategy-system)
7. [Plugins + External Feeds](./plugins-feeds)
8. [CLI Reference](./cli-reference)
9. [Environment Variables Reference](./env-reference)
10. [Database + Stats Pipeline](./database-stats)
11. [Web UI](./webui)
12. [Ops Runbook + Troubleshooting](./ops-runbook)
13. [Full Source Inventory](./source-inventory)

## Scope and Coverage

- Covers all tracked source areas (`src/**`, `webui/**`) and project runtime flow.
- Includes complete source inventory for indexing and editorial pipelines.
- Distinguishes core runtime code from research artifacts and generated outputs..
