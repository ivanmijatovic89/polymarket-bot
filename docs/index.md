---
layout: home

hero:
  name: Polymarket Bot
  text: One engine for live trading and backtesting
  tagline: Record raw market data, replay it tick-for-tick in backtests, and run the exact same strategy code live — no approximations.
  image:
    light: /img/logos/polymarket-twin-engine.png
    dark: /img/logos/polymarket-twin-engine-dark.png
    alt: Polymarket Twin Engine
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart-new
    - theme: alt
      text: How It Works
      link: /how-it-works
    - theme: alt
      text: View on GitHub
      link: https://github.com/ivanmijatovic89/polymarket-bot

features:
  - title: Deterministic backtesting
    details: The recorder writes every raw WebSocket message to Parquet. Backtests replay it tick-by-tick through the same MarketEngine as live trading — a replay, not a simulation.
  - title: Shared strategy system
    details: Strategies are auto-discovered TypeScript modules that return typed Intents. Zod-validated params, volatility and external-feed plugins, and the identical code path in backtest and live.
  - title: Datasets pipeline
    details: Build historical coverage from live recordings, the Telonex archive, Polymarket's own trade and activity feeds, and PMXT — each with its own sync, convert, and verify steps.
  - title: Distributed backtest workers
    details: Batches fan out to Redis-backed BullMQ workers across machines, with a Next.js dashboard for queue depth, active batches, and run history. Extend a finished run with more markets in place.
  - title: Multi-symbol 15m markets
    details: BTC, ETH, SOL, and XRP UP/DOWN markets on the Polymarket CLOB. Record, backtest, and trade any symbol with the same tooling.
  - title: EOA or SAFE execution
    details: Sign orders directly from an EOA, or fund positions from a SAFE wallet through the relayer. Dry-run by default, with per-operation control over split, merge, and redeem transaction modes.
---

## What this project is

`polymarket-bot` is an open-source live trading bot and deterministic backtesting engine for [Polymarket](https://polymarket.com) prediction markets.

It trades Polymarket's 15-minute UP/DOWN markets for BTC, ETH, SOL, and XRP with a strategy system built around one invariant:

> **Live trading and backtesting run the exact same strategy code over the exact same event stream.**

The recorder captures raw WebSocket events to Parquet. The backtester replays those files through the identical pipeline that processes live data — so a backtest is a deterministic replay of what actually happened, not an approximation. Historical coverage is filled by the [datasets pipeline](/datasets/index) (live recordings, Telonex, Polymarket's trade and activity feeds, and PMXT), and large sweeps fan out to distributed BullMQ workers.

## Where to start

| If you want to… | Go to |
| --- | --- |
| Get up and running fast | [Quickstart](/quickstart-new) |
| Understand the architecture | [How It Works](/how-it-works) |
| Learn the terminology | [Key Concepts](/key-concepts) |
| Write your first strategy | [Tutorial: First Strategy](/strategy/tutorial-first-strategy) |
| Run and parallelize backtests | [Running Backtests](/backtest/running-backtests) |
| Build a historical dataset | [Datasets Overview](/datasets/index) |
| Configure environment variables | [Environment Variables](/reference/environment-variables) |
