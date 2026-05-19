---
layout: home

hero:
  name: Polymarket Bot
  text: Live trading + deterministic backtesting
  tagline: The same strategy code runs in live markets and backtests — on the exact same tick stream, with no approximations.
  image:
    light: /img/logos/polymarket-twin-engine.png
    dark: /img/logos/polymarket-twin-engine-dark.png
    alt: Polymarket Twin Engine
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart-new
    - theme: alt
      text: View on GitHub
      link: https://github.com/ivanmijatovic89/polymarket-bot

features:
  - title: Deterministic Backtesting
    details: The recorder captures every raw WebSocket message to Parquet. Backtests replay them tick-by-tick through the same MarketEngine as live trading — not a simulation, a replay.
  - title: Strategy System
    details: Strategies are TypeScript closures that return typed Intents. Validate parameters with Zod, access volatility indicators and external feeds through plugins, and test every edge case in backtest before going live.
  - title: Multi-symbol Support
    details: BTC, ETH, SOL, and XRP — 15-minute UP/DOWN markets on the Polymarket CLOB. Record, backtest, and trade any symbol with the same tooling.
  - title: Parallel Backtest Queue
    details: A folder-watched GNU parallel runner lets you sweep strategy parameters across hundreds of recordings simultaneously. Results land in the database for analysis.
---

## What this project is

`polymarket-bot` is an open-source live trading bot and deterministic backtesting engine for [Polymarket](https://polymarket.com) prediction markets.

It trades Polymarket's 15-minute UP/DOWN markets for BTC, ETH, SOL, and XRP using a strategy system built around a core invariant:

> **Live trading and backtesting run the exact same strategy code over the exact same event stream.**

The recorder captures raw WebSocket events to Parquet files. The backtester replays those files through the identical pipeline that processes live data. A backtest is not an approximation — it is a deterministic replay of what actually happened.

## Where to start

| If you want to… | Go to |
| --- | --- |
| Get up and running fast | [Quickstart](/quickstart-new) |
| Understand the architecture | [How It Works](/how-it-works) |
| Learn the terminology | [Key Concepts](/key-concepts) |
| Write your first strategy | [Tutorial: First Strategy](/strategy/tutorial-first-strategy) |
| See all available strategies | [Strategy Interface](/strategy/strategy-interface) |
| Configure environment variables | [Environment Variables](/reference/environment-variables) |
