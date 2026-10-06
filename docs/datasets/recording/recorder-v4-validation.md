---
title: Recorder v4 validation
description: Compact-format parity, namespace protection and rollout evidence.
---

# Recorder v4 validation

This report covers the October 6, 2026 V4 implementation. The [format guide](./recorder-v4) defines the archive contract; the [worker-2 guide](./recorder-v4-worker-2) defines the isolated installation. Earlier V3 reports are historical evidence, not proof of a V4 deployment.

## Archive safety

The rollout creates new objects only beneath `recorder-v4/`. Local validation uses `recorder-v4/validation/local-2ec6ad8d-f63d-4b64-8ec1-6eae8c606fa3/`. No existing R2 object is deleted, migrated, renamed or overwritten, and no bucket or lifecycle configuration is changed.

The network adapter rejects operations outside the V4 namespace before making a request. Conditional PUT prevents replacement of an existing object. Publication and local event cleanup still require complete read-back with matching SHA-256 and byte count. Tests cover prefix escapes, sibling prefixes, conflicting objects, interrupted uploads, corrupted manifests and mismatched local receipts. The catalog excludes child validation namespaces unless explicitly selected.

V4 requires a separate spool and rejects V3 sequence state. Interrupted compact intermediates are removed only under the spool lock or from a verified archived package, with schema, filename and entry-type guards. Durable journals, V3 state, unrelated files and symlinks are preserved.

## Retained data and strategy parity

Two real V3 trial fixtures were downloaded read-only and converted privately for comparison. The retired reader is not shipped in V4. The comparison checks every envelope field and every parsed payload field, except the explicitly omitted recognized per-change hashes and the schema version change. Unknown payload text remains byte-exact. Both files preserve their original row counts and receive sequence.

| Fixture | Event rows | Original V3 bytes | V4 compact bytes | Reduction |
| --- | ---: | ---: | ---: | ---: |
| BTC 5m, `btc-updown-5m-1791151800` | 240,595 | 22,243,511 | 4,382,552 | 80.3% |
| BTC 15m, `btc-updown-15m-1791153900` | 409,674 | 39,338,307 | 6,894,018 | 82.5% |

These compare the same captured events. They are not an average storage forecast. Only 703 and 2,108 rows respectively require raw fallback. The format uses JavaScript Zstandard decoding, not an optional WASM path.

The unchanged `SplitSellRedeem.v5` strategy ran through production `runSingleMarket` on the 15m fixture. All 315,796 market callbacks, order books, strategy contexts, decisions, account events and final statistics match the previously verified compact experiment. Binance snapshots were present at all callbacks and website PTB at 315,668. This strategy does not request Chainlink; a separate observer explicitly requested every supported external feed on both durations.

| Proof | SHA-256 |
| --- | --- |
| V5 normalized ticks | `f45306cd71368818b1bef0f9cfae57b50237cfa82846b3ba36137764cc61925b` |
| V5 order books | `c532cad2ab9857625372db22f5f8d8c17204e2df3fcad69d2af7fb09c44cde21` |
| V5 contexts, decisions and account flow | `e62460962195ac0f2d7c0ce3b4e32f740a643b514926b25b89bf35135a7dce55` |
| V5 final statistics | `25b923b3126f2a06caa50ad323248521a6e65173709e972b24d1f1ee6071ed82` |
| All-feed 5m replay, 183,027 callbacks | `b2e2077ff7a9c42885b460b6b2c7bae5a3185d3340a34225ac29b62f4f5e89d4` |
| All-feed 15m replay, 321,831 callbacks | `135eeb0fc422df44040a4530e567cf1a05c4aeb3add1940b1b64dcd5e8fd381d` |

All-feed snapshots include Binance aggregate trades, Binance best bid/ask, Chainlink spot, Chainlink TWAP, website PTB and the selected opening reference. The clean 5m fixture passes ordinary admission; the known incomplete 15m fixture uses explicit outage replay. Diagnostic hashing is deliberately excluded from performance timings.

Offline proof processes block network connections, environment-file reads and live execution imports. These tests place no real orders and do not access trading credentials. The shared `MarketEngine` normalizes only the recognized unused change hashes, so live and backtest strategy messages remain aligned. The dashboard market simulator remains unsupported for recorder input; this work validates the normal backtest runner and CLI package path.

## Tests and review

The local test suites passed 822 tests: 204 recorder, 260 trading, 58 dashboard, 107 global runtime, 34 strategy artifacts, 18 feed coverage and 41 research dataset tests. Root TypeScript/ESLint, formatting, WebUI typecheck/build, dashboard typecheck/build, docs build and research protocol/index checks passed.

Two independent reviews covered storage/R2 safety and replay semantics. Findings fixed before release included child-prefix catalog handling, stale V3 jobs falling through to another replay mode, unpaired Unicode handling, and interrupted intermediate cleanup. A repeated malformed-journal test exposed an asynchronous file-open cleanup race; the writer now opens its temporary file before consuming the input generator and closes it before cleanup.

An initial full-size conversion using a global SQL sort exceeded the finalizer's 256 MiB DuckDB limit. The writer now streams the journal in its already validated sequence order. DuckDB documents order preservation for `read_json`, single-table `SELECT` and `COPY` with `preserve_insertion_order=true`; the V4 reader independently rejects any non-increasing sequence. See [DuckDB's order-preservation documentation](https://duckdb.org/docs/current/sql/dialect/order_preservation).

## Deployment boundary

Local controlled capture receives both durations and all six feeds. Startup partials and Polymarket reconnects are retained with coverage gaps. Validation uploads have passed read-back and local event cleanup under the dedicated validation prefix. The local test uses a 15 GiB free-space floor and 2 GiB spool limit because this laptop had less than the production 20 GiB floor available; production defaults remain unchanged.

Worker-2 still uses a separately pinned V3 release until the reviewed V4 service switch. Existing V3 configuration, spool, release and archives are preserved. A stopped V3 service no longer advances its old resolution backlog. No long-term reliability or gap-free-provider guarantee follows from these bounded tests.
