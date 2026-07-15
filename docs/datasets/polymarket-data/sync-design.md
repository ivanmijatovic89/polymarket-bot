# Polymarket Data — Sync Design

Authoritative design for `src/polymarket-data/`. Read this before changing anything in that directory.

Everything below was **measured against the live API**, not taken from the docs. Several of Polymarket's documented behaviours are wrong in ways that silently corrupt a naive sync, so each claim here carries the evidence.

## The five stages

```
sync-markets    Gamma series          → polymarket_markets          (catalog)
sync-positions  /v1/market-positions  → polymarket_market_positions (participants + PnL)
sync-trades     /trades               → polymarket_trades           (every fill)
deep-backfill   /activity per wallet  → polymarket_trades           (repairs capped markets)
sync-activity   /activity per wallet  → polymarket_activity         (split/merge/redeem)
verify          invariant + resample  → audit                        (proves completeness)
```

Stages share nothing but MySQL state columns. Each is independently resumable, each claims work with the same atomic MySQL queue (`src/db/claimQueue.ts`, shared with Telonex).

**Positions runs before trades** because it is one cheap call per market and returns a *superset* of the wallets `/trades` can show — including for markets whose trades are capped, where it is the only complete participant list available. That list is what makes `deep-backfill` possible.

## Known API limits

| Endpoint | Limit | Consequence |
|---|---|---|
| `/trades` | `offset` ≤ **3000**, `limit` ≤ 1000 | 4,000 rows per query combo. `side=BUY`/`side=SELL` are separate combos → 8,000/market. Beyond that the rows are unreachable. |
| `/trades` | `start` / `end` / `before` / `after` / `sortDirection` **silently ignored** when querying by market | No time-slicing escape hatch. Paging is offset-only, newest-first. |
| `/trades` | `takerOnly` defaults to **true** | Must pass `takerOnly=false` or you get taker rows only and lose every maker fill. |
| `/trades` | rows have **no id** | Row-level dedup is impossible; markets are written whole (delete + insert) in one transaction. |
| `/activity` | requires `user` (400 without) | Market-wide activity cannot be fetched. Splits/merges/redeems are reachable only per wallet. |
| `/activity` | `offset` ≤ **3000** — *not* the 10000 the OpenAPI spec advertises | Verified: `offset=3500` → 400 `max historical activity offset of 3000 exceeded`. Escaped by walking the `start` window instead of the offset. **Exception:** a cluster of rows all sharing one second that exceeds the reachable window (offset cap + page) cannot be paged (advancing `start` doesn't move past that second) — `fetchActivity` throws a clear error rather than looping forever. |
| `/activity` | `start` / `end` / `sortDirection` **are** honoured (with `user`) | This is what makes the cursor — and the deep backfill — possible. |
| `/activity` | `start=0` means "default ~3y window", not "all history" | Pass `start=1` for full history. |
| `/v1/market-positions` | `limit` ≤ 500 **per outcome token**, `offset` pages within a token | Paged accordingly. |
| Gamma `/events` | `limit` capped at 100, `offset` rejected ≥ 3000, **keyset cursor not honoured** | Every cursor param name we tried returns page 1 again. The catalog pages by walking bounded `end_date_min`/`end_date_max` windows instead. |
| Gamma `startDate` | is the market's **creation** time, ~a day before the window opens | Never use it for market time. Window start = slug epoch (5m/15m/4h) or `eventStartTime` (1h/1d); `endDate` is the true end. Same trap as Telonex's `start_date_us`. |
| Rate limits | Data API 1000 req/10s general, `/trades` 200 req/10s | Defaults sit at half of that; a shared token bucket enforces it across all workers. |

## The completeness invariant

Gamma's `volumeNum` is the **traded share count with each match counted once**:

```
SUM(polymarket_trades.size) / 2  ==  polymarket_markets.volume_gamma
```

Verified across every market synced so far — API-synced and deep-backfilled alike — at **0.000% drift**. It is an identity, so it is a proof of completeness rather than a heuristic: a single missing fill drops the left side below the right.

This is the pipeline's correctness gate, not a report:

- `sync-trades` writes `done` only when the invariant holds; otherwise `partial`, whatever its paging thought it saw.
- `deep-backfill` may only claim `done` under the same test.
- `verify` re-checks it for every market offline and can requeue failures.

**Tolerance is ABSOLUTE shares, not a percentage.** The only slack is the rounding from summing thousands of `decimal(18,6)` sizes (~2e-6/row, max ~0.009 shares observed). A relative tolerance hides real shortfalls on big markets (0.1% of 1M shares = 1,000 shares — it let 6 deep-backfilled markets sit `done` while 6.8–60 shares short), so the budget is `completenessToleranceShares(rows) = max(0.05, rows * 5e-6)`, applied identically in sync-trades, deep-backfill, and verify.

**Row completeness ≠ maker/taker-label completeness.** The invariant only proves all *rows* are present. A capped *taker* query mislabels some takers as makers — that does NOT make the market `partial` (every row is there), but records a persistent `maker/taker flags incomplete` diagnostic on the `done` market. `all.capped` and `taker.capped` are separate signals, never merged.

See [ADR: Completeness Contract](/adr/polymarket-data-completeness-contract) for the full rationale (the three-valued `complete`, the no-Gamma-volume policy, and the fail-loudly rules).

**Do not compare the USDC total to Gamma.** `volume_traded` (money that changed hands) is a different quantity and differs by a few percent. Comparing the two produced a convincing 12.9% "shortfall" during development that turned out to be an artefact of comparing dollars to shares.

## Why deep-backfill exists (and is not an edge case)

A busy 15m market can exceed 4,000 rows *on a single side*, which is more than the side-split ceiling can reach. On a real BTC 15m sample **~12% of markets came back capped**, each missing ~12% of its fills.

Reconstruction path:

1. **Participants** = `/v1/market-positions` (complete even when trades are capped) ∪ wallets already stored from the capped pass.
2. **Per participant**, `/activity?user=…&market=…&type=TRADE`, walking the `start` window past the offset cap.
3. Whole-market replace, `trades_source='deep-backfill'`, `done` only if the invariant holds.

Per-wallet `/activity` was verified to reproduce `/trades` *exactly* for the same market — identical row count and USDC, maker fills included (checked on a wallet with zero taker fills).

::: warning Positions are load-bearing
Building the participant list from the capped `/trades` alone means searching only where you have already looked. An early version did that and rebuilt a market that was *still* 18% short. Positions must always be included — from the DB if the positions stage has run, fetched live otherwise.
:::

`/activity` has two limits the reconstruction has to work around. It carries no maker/taker flag, and it can **aggregate** a taker sweep into one row (several per-fill `/trades` taker rows collapse into a single activity row whose `size`/`usdcSize` are totals and whose `price` is neither their ratio nor an average). So the taker side comes from the taker-only `/trades` query, which is per-fill: when that query is **complete**, its per-fill rows *are* the taker fills stored, and the aggregated taker activity rows are dropped — only the maker side comes from `/activity`. This keeps deep-backfilled markets one-row-per-fill, so fill counts, per-fill prices, and `verify`'s row comparison all line up with a `/trades`-synced market. The taker query has the same offset cap, but taker rows are a fraction of all rows and normally fit; when it **is** capped, exact per-fill reconstruction is impossible, so the aggregated activity row stands in and the market records the limitation (`maker/taker flags incomplete`) rather than pretending the aggregate is a single fill. The share-volume invariant holds either way (an aggregated taker's total shares equal its per-fill total).

## Idempotency

Two different mechanisms, because the data has two shapes:

**Trades and positions — whole-market replace.** The API gives rows no id, and two genuinely identical fills can legitimately exist, so row-level dedup is unsafe. A market's rows are deleted and re-inserted inside one transaction. A crashed or retried market is simply re-fetched and rewritten; duplicates are impossible by construction.

**Activity — `dedup_key` + `INSERT … ON DUPLICATE KEY UPDATE dedup_key = dedup_key`.** The wallet cursor deliberately re-reads an overlap window, so rows arrive twice by design; the dedup key no-ops the duplicates. The key is a hash of the row's identity plus **its occurrence index within its identity group** — how many byte-identical rows precede it. (Deliberately NOT `INSERT IGNORE`: that also swallows truncation / invalid / out-of-range errors into warnings and stores coerced data — the `ON DUPLICATE KEY` form keeps only the duplicate idempotent and lets a real data error abort the transaction.)

::: warning The occurrence index must not come from page position
An early version keyed on the row's index in the fetched page. Page position depends on where the cursor started, so a second run with a different cursor minted fresh keys and re-inserted everything — a re-run of 8 wallets doubled the table. Counting within the identity group is cursor-independent, while still letting two genuinely identical events (the same split twice in one transaction) both survive.
:::

Verified: three runs over the same wallets — empty cursor, warm cursor, and a full re-read — all leave exactly 2,870 rows.

## Concurrency and failure handling

- **Claiming**: candidates are read with a single-status predicate (stays on the `(status, market_start_ms)` index), then an atomic PK-keyed conditional `UPDATE` races for the row. An empty claim is treated as *contention*, not drain, until a real `COUNT(*)` confirms zero (`claimNextOrConfirmEmpty`) — the bug that primitive exists to prevent.
- **Deadlocks are normal.** Concurrent workers writing *different* markets still deadlock: InnoDB takes gap locks on secondary indexes and those gaps overlap (the same wallets recur across markets). We hit `ER_LOCK_DEADLOCK` immediately at concurrency 2. A deadlock is InnoDB picking a victim, not an error — the loser is rolled back cleanly and replayed by `withDeadlockRetry` (`src/db/txRetry.ts`). Every writer here is a whole-market replace, so a retry is exactly equivalent to the first attempt.
- **Shutdown**: SIGINT aborts in-flight work and returns *this process's* claims to `pending` (only its own ids — reverting by predicate would steal peers' claims). A second SIGINT exits hard.
- **Crash recovery**: rows stuck in `processing` are freed with `--reset-processing`. Only run it when no other workers are live, or you will steal their claims.
- **Rate limiting**: one shared token bucket per process, well under the documented caps; 429s honour `Retry-After` and do not consume the retry budget.

## Wallet counters are derived, not incremented

`polymarket_wallets.trade_count` / `markets_count` / `first_trade_ms` / `last_trade_ms` are recomputed from `polymarket_trades` (`refreshWalletStats`), never accumulated with `+= n`. A market's trades are rewritten whole on every re-sync, so incremental bookkeeping would double-count on each retry.

`activity_status` is never reset by discovery: a wallet seen again in a new market stays `done` and is **not** automatically re-synced. That is deliberate — re-discovery is not a reason to re-read a wallet's whole history — but it means a recurring sync must explicitly re-queue already-synced wallets to catch their new activity (see "Recurring sync" in the overview). The cursor makes that refresh cheap: a re-queued wallet resumes from `activity_cursor_ts − 1h`, so it re-reads only the recent window, and `dedup_key` drops anything already stored (verified end-to-end: a re-queued wallet fetched 2,971 recent rows instead of 14,135 and inserted 0 duplicates).

::: warning Expanding historical coverage rebases cursors
A wallet's activity was filtered against the catalog **as it existed at sync time**. If you later lower the backfill floor or add an older symbol/timeframe, markets the wallet traded in get cataloged *after* it was synced — and their activity (fetched but dropped as not-in-catalog originally) now sits behind the wallet's cursor, so a normal `cursor − 1h` refresh never re-reads it. `sync-activity` detects this automatically: at start it rebases affected wallets to a **full-history** cursor and re-queues them. Rebasing only to `market_start_ms` is not sufficient because valid SPLIT/MERGE/trade activity can occur from market creation, up to roughly a day before the window starts. Detection uses `polymarket_markets.synced_at` (catalog-insert time, which the catalog upsert never overwrites) — a wallet is affected when it participated (trade **or** position) in a market with `synced_at > wallet.activity_synced_at` whose `market_start_ms` predates the wallet's refresh window. A cheap pre-check on the small markets table skips the trades/positions join entirely in normal operation, so this costs nothing until coverage actually expands. The complete re-scan is idempotent (`dedup_key`) and concurrent-safe: `pending`/`done` wallets may be repaired, `failed` wallets remain opt-in via retry/named runs, and `processing` wallets owned by a live worker are never touched.
:::

## Trade ordering and time resolution

Read trades with **`ORDER BY ts_ms, tx_hash`**. Never `ORDER BY id`.

`ts_ms` comes from the API's `timestamp` field and is identical whichever stage
wrote the row, so ordering is fully recoverable and consistent across the whole
dataset. `id` (autoincrement) is insertion order: in the trades-api path that
happens to track time, but in a deep-backfilled market the rows are written
grouped by wallet, so `id` order there is meaningless. Sorting by `ts_ms` erases
that difference — the two paths are equivalent to one-second resolution.

The resolution *is* one second — that is an API limit, not a pipeline choice, and
it applies to both paths equally. `timestamp` is epoch **seconds**, and neither
`/trades` nor `/activity` exposes any finer key (no sequence, block, or
log-index — checked). A busy second can hold ~50 rows, but those are a handful
of *matches*, not 50 independent events: each match is one taker + its makers
sharing a `tx_hash`, and a `tx_hash` never spans more than one second (verified
across the dataset), so `GROUP BY tx_hash` reconstructs matches exactly in both
paths. What is genuinely unavailable — from this API, on either path — is the
sub-second sequence of independent matches within the same second. The only
source for that is on-chain `(block, tx_index, log_index)` via the `tx_hash`,
which this pipeline does not fetch.

## Verify — two checks, and what fails the audit

`verify` runs an **offline invariant** pass over every synced market (`SUM(size)/2` vs `volume_gamma`, absolute-share tolerance) and, with `--resample N`, an **online** pass that re-pulls N markets from the live API. See the [Completeness Contract ADR](/adr/polymarket-data-completeness-contract) for the tolerance and status rules.

Pass/fail is by intent — a `partial` market failing the invariant is expected work, a `done` market failing it is an **integrity violation** (process exits non-zero). The resample adds three live cross-checks, all folded into the verdict:

- **rows** — stored rows must be ≥ the live `/trades` count (live is a *lower bound*, capped for busy markets). This does not over-fire on deep-backfilled markets: `/activity` and `/trades` produce the same per-fill row count (measured 352 == 352), so a complete market is always ≥ live.
- **positions — identities, not counts.** Compares the `(wallet, asset)` set (wallet lowercased). A **live** position missing from stored → fail (a missing participant; the only signal for a wallet absent from both stored positions and the capped stored trades). A **stored-only** position → informational note (a wallet can redeem to zero and drop from the live snapshot after sync). Equal counts alone never "pass" a mismatched set.
- **orphan wallets** — every trade wallet must have a stored positions row (positions is a verified superset).

`--dry-run` on any stage is fully read-only: the retry/reset requeue reports the count that *would* move without writing.

## Residual gaps (honest list)

- A wallet that **never traded and holds no position** — i.e. only ever moved tokens on-chain — is invisible to every endpoint we use. It is the one participant class we cannot discover.
- Trades **before the window opens are normal**, not an anomaly: a market accepts orders from creation, up to ~a day early, and ~6% of a 15m market's fills land there. Only fills long after settlement are flagged.
- For a deep-backfilled market whose taker query also hit the cap, `is_taker` flags are incomplete (the market records this).
- Markets where Gamma reports no volume cannot be completeness-checked; `verify` reports them as `unknown` rather than assuming they are fine.
