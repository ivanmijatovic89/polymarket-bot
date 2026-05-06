# Polymarket Bot Documentation (Codex Edition)

This folder is a full project documentation pack for:

- developers onboarding to the codebase,
- operators running live bots/backtests,
- content tooling (VitePress) for publishing product/docs pages.

## What This Project Is

`polymarket-bot` is a live trading bot + deterministic backtesting engine for Polymarket.

Core invariant:

- **Live trading and backtesting must use the same strategy logic and tick semantics.**

## Documentation Map

1. [Quickstart](./01-quickstart.md)
2. [Architecture](./02-architecture.md)
3. [Live Runtime](./03-runtime-live.md)
4. [Backtest Runtime](./04-runtime-backtest.md)
5. [Recording + Parquet](./05-data-recording-parquet.md)
6. [Strategy System](./06-strategy-system.md)
7. [Plugins + External Feeds](./07-plugins-and-feeds.md)
8. [CLI Reference](./08-cli-reference.md)
9. [Environment Variables Reference](./09-env-reference.md)
10. [Database + Stats Pipeline](./10-database-and-stats.md)
11. [Web UI](./11-webui.md)
12. [Ops Runbook + Troubleshooting](./12-ops-runbook.md)
13. [Full Source Inventory](./13-source-inventory.md)
14. [VitePress Handoff Guide](./14-vitepress-handoff.md)

## Scope and Coverage

- Covers all tracked source areas (`src/**`, `webui/**`) and project runtime flow.
- Includes complete source inventory for indexing and editorial pipelines.
- Distinguishes core runtime code from research artifacts and generated outputs.
