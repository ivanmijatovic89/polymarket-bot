---
title: Recorder v3 — exact opening TWAP reference
description: Explicit reference selection, receipt-time replay, compatibility checks, and real-recording validation.
---

# Recorder v3 — exact opening TWAP reference

This follow-up adds `polymarketPriceToBeat.source: 'chainlink-opening-twap'` to Recorder v3 replay. Website PTB remains the default. The recorder preserves both observations and shows their comparison in the dashboard. The [operator guide](./recorder-v3#selecting-the-opening-chainlink-twap) explains configuration and CLI use. Worker-2 deployment remains a separate step.

## Evidence and source contract

The [Polymarket live-data documentation](https://docs.polymarket.com/api-reference/live-data/overview) describes Chainlink 60-second TWAP observations and snapshot history. It does not completely specify market-specific boundary selection or website correction policy. [Chainlink report timestamps](https://docs.chain.link/data-streams/how-report-timestamps-work) describe validity intervals; they do not justify substituting a nearby report for a missing exact boundary.

The comparison used the real recordings from the [archive hardening run](./recorder-v3-hardening). All seven full-duration recordings had an exact opening TWAP matching the later website PTB at the website's numeric precision. They represented six distinct opening timestamps. All six available official Gamma PTBs also matched. Opening TWAP frames arrived 1.018–1.862 seconds after the boundary. Some website requests took approximately 61 seconds after a rate-limit response; other website values were initially different and corrected approximately 30 seconds later.

Those observations support an explicit source choice. They do not establish a universal guarantee of official PTB equivalence. No automatic fallback or website default change was introduced.

## Implementation and failure behavior

Capture diagnostics and replay use the same boundary tracker. It scans every snapshot point and accepts only validated Chainlink observations with a 60-second window and a timestamp exactly equal to the market opening. An exact historical point in a later snapshot becomes usable only at that snapshot's local receipt. The original decimal string and event/session/connection provenance are retained.

A duplicate decimal representation does not change availability time. A different value in a later frame is a correction, exposed at its new receipt. Conflicting exact-boundary values within one frame withhold the reference and disqualify ordinary TWAP backtests. A later unambiguous observation may restore the current value for outage replay. Website disagreement remains a diagnostic and never overwrites the selected TWAP reference.

Preflight admission requires full-window coverage for Polymarket, Chainlink TWAP, and any other requested feeds, plus exact-boundary evidence without conflicts. Website-only HTTP gaps do not invalidate this source. Preflight never injects its final state into the replay timeline. Missing data stays missing during explicit outage replay. A restart clears volatile observations; replay can restore only what the new bootstrap actually contains or later frames deliver.

Existing archives already contain the necessary raw frames. Event schema, immutable archive objects, resolution handling, and R2 hierarchy are unchanged. The verifier reports boundary diagnostics separately from the existing website-mode replay digest. Legacy live trading and historical backtest runtimes reject the new source explicitly because they do not implement these stream semantics.

## Validation

The recorder suite passed 180 tests and the trading suite passed 260 tests. New coverage includes exact boundary extraction from multi-point snapshots, decimal precision, same-frame ambiguity, later corrections, receipt visibility, website independence, market rotation, bootstrap validation/reset, and six Parquet-backed backtest cases. Coordinator snapshots are compared directly with archived replay state for overlapping durations and a subsequent market.

An independent review checked source selection, timing, bootstrap/restart behavior, admission, and default compatibility. It found one dashboard issue: a recovered current value could hide an earlier conflict that still prevented ordinary admission. The diagnostic now retains a warning after recovery within the capture session. It resets at a restart so replay does not expose knowledge absent from the new process; archive inspection separately retains the cumulative conflict count for admission. Regression checks compare restarted and fresh tracker snapshots and cover the dashboard schema.

Final-source offline verification completed on October 4, 2026, at 21:32:46 UTC. It streamed all eleven real packages, totaling 1,431,965 rows. Every file digest, row count, tick count, and default website-mode replay digest matched the prior hardening evidence. All seven full-duration recordings passed the new source's all-feed coverage and exact-boundary preflight, and their final reference comparisons matched. Four of those recordings still have website PTB uncertainty; selecting the independent TWAP source does not erase those original gaps.

Two actual `runSingleMarket` executions then selected all captured feeds and the new PTB source in ordinary mode, without `allowGaps`:

| Recording | Strategy ticks | Ticks with website/TWAP disagreement | Future receipts |
| --- | ---: | ---: | ---: |
| `btc-updown-5m-1791144600` | 114,066 | 13,103 | 0 |
| `btc-updown-15m-1791144900` | 188,834 | 7,085 | 0 |

Binance aggregate trades, Binance best bid/ask, Chainlink spot, rolling Chainlink TWAP, and website observations all updated in the strategy context. The selected opening PTB retained its exact boundary, full precision, event identity, and actual receipt. Ticks before receipt had no selected PTB. Website corrections and disagreement intervals did not overwrite the selected reference. The observer submitted no orders and reported the expected `no_activity`; fill/settlement integration remains covered by the earlier CLI runs and unchanged replay digests.

The offline preload guard allowed no network connection or environment-file read. It blocked two local Unix-pipe connection attempts from the `tsx` loader; an import-only probe reproduced them. No external API or database connection was made. Runtime source hashes were checked before and after the final pass to ensure the verification used unchanged code.

Local root TypeScript, ESLint, Prettier, all 58 dashboard tests, dashboard typecheck/production build, and documentation build passed. After the final conflict-warning adjustment, 39 focused recorder/dashboard tests passed, with another independent 23-test review pass. The PR's required CI repeats the complete repository quality gates before merge.

Detailed ignored local evidence is in `.tmp/recorder-hardening/opening-reference-validation.json`, its harness/log, the source-hash map, and the corresponding guard/probe reports. Earlier preliminary output is kept separately and is not the final-source result.

## Operational scope

This change does not remove upstream uncertainty. It provides another precisely named recorded reference and makes missing or conflicting evidence explicit. The previous local capture, forced restart, upload/read-back/deletion, and queued CLI integration results remain documented in the hardening report. This follow-up validates reference selection against those same immutable recordings; it does not claim a new long-duration capture or a worker-2 deployment.

Before regular recording on worker-2, validate its dedicated configuration, service supervision, dashboard connectivity, resource coexistence, and a complete local capture/upload cycle on that host. No Slack notifications are configured.
