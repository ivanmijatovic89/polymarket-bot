---
title: How Verify Works
description: A plain-English, step-by-step walkthrough of what telonex:verify actually does — and what its OK result does and does not guarantee.
---

# How Verify Works

The [Verify Conversions](/datasets/telonex/verify) page describes the command's flags, prerequisites, and output. This page explains, in plain English, **what the script actually does step by step** and **what an `OK` result really guarantees**. Read it once if you are asked to trust verification for production decisions.

The whole script lives in [`src/telonex/verify-conversion.ts`](https://github.com/) — about 600 lines. Below is what those lines do, in order.

## The one question the script answers

> For one slug, if the backtest engine reads the converted Parquet, does it reconstruct the **same orderbook state** that the original raw Telonex `book_snapshot_full` files describe — at every emitted strategy tick?

Everything below exists to answer that question rigorously.

## Step 1 — Load the market context from MySQL

- From `telonex_markets`, read which `asset_id` is "Up" and which is "Down" for this slug. The mapping is derived from the `outcome` labels, **not** from column order — code never assumes `asset_id_0` is Up.
- From `telonex_market_files`, fetch all R2 keys for raw files whose `status = 'uploaded'`. If there are none, abort.

## Step 2 — Download the raw R2 files into a temp directory

- Create `os.tmpdir()/telonex-verify-<slug>-<random>/raw/`.
- Stream each raw R2 object directly to disk (no full-buffer in memory — these files have deeply nested bid/ask lists).
- Tag every downloaded file as `up` or `down` by matching its `asset_id` against the mapping from Step 1. If a raw file's asset matches neither side → abort immediately. The verifier never guesses from filenames.

## Step 3 — Run the real converter into a temp output

- For `--converter paired`: call `convertPaired(inputs, tmpDir/paired.parquet)`.
- For `--converter delta`: call `createDeltaConverter({bookInterval})(inputs, tmpDir/delta.parquet)`.
- For `--converter delta-typed`: call `createDeltaTypedConverter({bookInterval})(inputs, tmpDir/delta-typed.parquet)`. This uses the same expected-snapshot stream as `delta` — only the on-disk representation differs (typed repeated columns instead of `raw_json`).

If the converter reports `ticksDropped > 0`, verification fails right here with `refusing to certify`. A single dropped raw row is enough to disqualify the run — verify is intentionally strict about this.

## Step 4 — Build an independent "expected" stream from the same raw files

This is the heart of the test. The verifier re-derives, from the raw Telonex files alone, exactly which strategy snapshots the backtest engine **must** produce. It does this independently of the converter's output:

### Paired expected provider

1. Group raw ticks by `timestamp_us`.
2. Within each group, split into Up ticks and Down ticks.
3. For each `k` from `0` to `max(up.length, down.length) - 1`:
   - take the Up tick at index `k` if present, otherwise carry forward the last seen Up tick;
   - same for Down;
   - if either side has never been seen yet, skip this frame;
   - otherwise emit one expected snapshot in which both books are stamped with the **current** event timestamp (matching the paired format, which stores only one `ts_exchange_ms` per row).

### Delta expected provider

1. Group raw ticks by `timestamp_us`.
2. For each asset, track the last seen bid/ask levels and a `ticksSinceBook` counter.
3. For each `k`, for each side present:
   - if the asset has never been seen or `ticksSinceBook >= bookInterval` → emit a full `book` snapshot, reset the counter to 1;
   - otherwise check numerically (price and size as numbers) whether any level changed. If yes, update the expected book and mark a combined delta for this group.
4. After processing both sides at index `k`, if either side produced a delta, emit one combined `price_change` snapshot.

Both providers push their snapshots through a **one-item async queue**: the producer waits until the consumer takes the previous snapshot before pushing the next. This keeps memory bounded regardless of how big the slug is.

## Step 5 — Replay the converted file through the same path backtest uses

Verification deliberately does **not** invent its own replay logic. It calls the same primitives backtest uses:

| Converter | Replay function used |
| --- | --- |
| `paired` | `replayTelonexPairedParquetForMarket` |
| `delta` | `replayOrderBookForMarket` (the standard live-format replay) |
| `delta-typed` | `replayTelonexDeltaParquetForMarket` (typed-column adapter that skips `raw_json`) |

For each strategy snapshot the replay emits, the verifier pulls the next expected snapshot from the queue and compares them immediately.

## Step 6 — Compare every emitted strategy tick

Per tick:

- market ID and strategy-tick timestamp must match exactly;
- the set of asset IDs in `byAssetId` must match (no asset may be missing or extra);
- per asset book: `market`, `assetId`, and per-asset `timestamp` must match;
- bids and asks: same length, same order, numeric equality on price and size at every level.

The first mismatch throws a `VerificationError` containing tick number, the reason string for that snapshot, the asset, the side, and the level index. The process exits with code 1.

## Step 7 — Drain check and cleanup

- After replay finishes, the expected queue must also be empty. If one more expected snapshot is still pending → fail with `replay ended before all expected ticks were emitted`, including the leftover snapshot's tick number and reason.
- On full success: log `paired OK …` / `delta OK …` / `delta-typed OK …`, then a final `OK`.
- The temp directory is removed unless you passed `--keep-temp`.

## What an `OK` result guarantees

Strong guarantees — for the **specific slug**, the **chosen converter**, on the **current code at the moment you ran it**:

1. **Bit-exact orderbook equality.** The backtest engine reconstructs the same prices, sizes, level ordering, and asset set as the raw Telonex `book_snapshot_full` files, on every emitted strategy tick.
2. **No silent data loss in conversion.** `ticksDropped == 0` is enforced before any comparison runs.
3. **Tick count matches.** The converter did not emit a single extra strategy tick and did not skip a single change the expected model predicted.
4. **The replay path is the production replay path.** Verification calls `replayOrderBookForMarket`, `replayTelonexPairedParquetForMarket`, and `replayTelonexDeltaParquetForMarket` — the exact functions backtests use. What verify sees is what backtest will see.
5. **Carry-forward semantics in paired output behave exactly as the format allows.** Both books share one `ts_exchange_ms`; bid/ask levels on the carried-forward side preserve the previous tick's state exactly.
6. **Delta change detection is consistent with the converter.** Both sides use numeric equality and the same `bookInterval` checkpoint rule.

## What an `OK` result does **not** guarantee

Important boundaries — keep these in mind before treating verification as proof of correctness for the whole pipeline:

1. **Other slugs.** Only the slug you ran is certified. For converter changes, run a representative sample (different tick densities, day-boundary crossings, Up/Down asymmetry).
2. **Truthfulness of the raw Telonex files themselves.** Verify compares the converter against those same raw files. If Telonex's own collector dropped a WS event, verify will not see it. Use [Diagnostics > Omitted Events](/datasets/telonex/diagnostics) to compare against a local live recording.
3. **Correlation with the real Polymarket WS feed at that moment.** Verify only proves internal consistency (raw → converter → replay).
4. **Strategy-level semantics.** Fill simulation, latency model, fees, intent dispatch — none of that is exercised. Verification stops at the `MarketEngine` snapshot boundary.
5. **Future code stability.** Verify is a snapshot test against current code. Change `OrderBookEngine`, the converter, or the replay path → re-run verify.
6. **Fields outside bids / asks / timestamp / market / asset set.** Things like `hash`, raw_json metadata, or auxiliary columns are not compared.
7. **Performance or output size.** A converter could pass verify while producing a 10× larger Parquet than necessary. Verify is purely about correctness.

## Short answer

Verify answers one question and only one question: **"Does backtest see the same orderbook as the raw Telonex feed for this slug?"** For the slug you ran, with high confidence — yes. For the whole pipeline — run it on many slugs.

## Related

- [Verify Conversions](/datasets/telonex/verify) — the command reference (flags, output, failure modes).
- [Telonex Verification ADR](/adr/telonex-verification-replay-parity) — the architectural decision behind tick-by-tick replay verification.
- [Convert](/datasets/telonex/convert) — the converter that verify checks.
- [Diagnostics](/datasets/telonex/diagnostics) — coverage and alignment tools (different question from verify).
