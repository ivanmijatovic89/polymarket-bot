---
title: Live Recording Overview
description: Recorder V4 captures BTC 5m and 15m markets with mixed feeds, verified R2 archival, and deterministic replay.
---

# Live Recording Overview

[Recorder V4](/datasets/recording/recorder-v4) is the supported recorder for new BTC 5m and 15m data. It runs independently of trading and backtest workers and records Polymarket orderbooks, Binance aggregate trades and best bid/ask, Chainlink spot and 60-second TWAP, and website price-to-beat observations.

All observations receive one shared sequence and local arrival timestamps. Each market has one self-contained compact Parquet file; overlapping markets intentionally contain copies of shared feed observations with the same identity and timing. Replay restores those observations in received order through the shared market engine and strategy runner.

## Capture, archive, and replay

1. Discover upcoming markets and preserve the initial book/feed state with its original observation times.
2. Capture into durable local journals. Record connection changes, uncertainty intervals, and other coverage evidence alongside market data.
3. Finalize a market after its end and diagnostic grace, then upload its Parquet and immutable manifest to R2 under `recorder-v4/btc/<5m|15m>/<slug>/<recording-id>/`.
4. Verify the uploaded bytes and checksums before removing local event files. Keep unfinished work for retry/recovery. Track official resolution in later sidecars.
5. Download verified packages for backtests and select `--input-mode recorder-v4`. Required-feed gaps skip the whole market by default; explicit outage replay keeps those gaps visible.

See the [capture/archive and replay diagrams](/datasets/recording/recorder-v4#capture-and-archive-diagram). Arrival times represent this recorder process; another machine or WebSocket session can receive a different stream. Replay does not reproduce actual exchange fills or recover events never received.

## Operations

- [V4 configuration, capture, download, and backtests](/datasets/recording/recorder-v4)
- [Worker-2 installation and service commands](/datasets/recording/recorder-v4-worker-2)
- [Validation and rollout evidence](/datasets/recording/recorder-v4-validation)

Monitor **More → Recorders** in the dashboard for feed health, gaps, active markets, archive progress, disk usage, and resolution backlog. A green connection alone does not prove uninterrupted upstream coverage.

For data from before recording began, use [Telonex](/datasets/telonex/overview) or [PMXT](/datasets/pmxt/overview). Their historical formats and preparation tools remain separate. The retired standalone recorder and its operating instructions are preserved only in Git history.
