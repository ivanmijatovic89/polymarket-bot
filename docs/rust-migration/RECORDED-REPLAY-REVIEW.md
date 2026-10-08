---
title: Recorded Replay Body Review
description: Development evidence for the actual recorded replay body and its remaining acceptance requirements.
---

# Recorded replay body review

The native `recorded_replay.rs` now drives the real merged Parquet reader and shared MarketEngine. It preserves ingest-sequence heap precedence, secondary recorded/exchange clocks, per-file ties, raw serialization before fast-path filtering, nullish active-market selection, strict primitive/object identity, the selected-message JSON round-trip, awaited child callbacks, stop checks and refill ordering. Original frame text is retained as UTF-16 for callbacks. This is a development checkpoint; the production executable still advertises no replay input mode.

## Evidence

`replay-body-debug.json` and `replay-body-release.json` bind the exact native sources/test driver, frozen executable, Node/Cargo/Rust identities, all imported production TS bodies against reference `07245602d6ff9bca0dcdf772134cba3dd227526c`, wrappers, Parquet bytes and2,611 observed/imported/package/helper files. Both compare64 scenarios/96 emitted ticks, including snapshot/message/source/raw-frame output and failure prefixes. Nine deliberate response mutations and five dependency mutations must be rejected.

The original22 cases were expanded with42 independently designed cases for primitive/composite/nullish market values, signed zero, overflow and literal/pair/lone UTF-16/backslash text. A fresh reviewer independently reproduced64/96 output pairs before the continuation repair. That earlier exploratory result was output-only and did not certify scheduling or the entire moving source set.

Eight native units directly test pending/ready callback boundaries, child ordering, failure identity and input cleanup, stop after frame/refill, strict selection, time-driven zero/capped/regressing delays, pre-skip BigInt serialization and raw lone UTF-16 parsing. These units include individual Future polls, so final output equality cannot hide eager advance.

## Review repair

Fresh source review confirmed that a ready Rust async callback originally applied the next child within the same poll. The TS onTick wrapper always returns a Promise and suspends even for a void callback. Metadata-only selected frames also await handleRaw before refill. The native replay now uses the shared `js_async::js_await` for callback results and whole selected-frame completion, retaining errors unchanged. The reviewer direct-poll probe and expanded guarded debug/release comparisons pass after repair.

This proves explicit owning-thread continuation boundaries in the documented native API. Exact ordering of every nested ECMAScript Promise job, eager invocation through concrete SDK/OrderManager bindings and the actual owning executor remains a separate required integration check.

## Required remaining work

Full raw-row physical/nested conversion (including dates and other annotations), all reader metadata/page/error/Buffer identity domains, R2 and EPERM reader opening, differential time-driven scheduling, feed preparation, Telonex paired/delta and Recorder V4, native strategy/context/OrderManager/execution, all callers and fleet/persistence remain incomplete. Unsupported physical raw_json conversions currently produce an explicit development error; this is not permission to remove any supported production input.

No migration acceptance item is completed by this evidence. No production activation, real-money order or new speed measurement occurred.

## Reproduce

```sh
python3 scripts/rust-migration/recorded-replay-differential.py --node /absolute/path/to/node20
python3 scripts/rust-migration/recorded-replay-differential.py --node /absolute/path/to/node20 --release
cargo test --offline --manifest-path native/trading-runtime/Cargo.toml --test recorded_replay
```
