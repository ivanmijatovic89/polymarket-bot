# Polymarket Historical Data: API-First and RPC Fallback

This document records the source-of-truth decision for the historical analytics
pipeline. The immediate implementation uses Polymarket's public APIs. Blockchain
data remains a fallback and an optional later enrichment for exact intra-second
ordering.

## Decision

Use the public Data API for the June 2026 backfill:

- `/trades` is the only source for executed trade rows.
- `/v1/market-positions` discovers every participant and provides the final
  per-wallet position/PnL snapshot.
- `/activity` is normally used only for non-trade events such as `SPLIT`,
  `MERGE`, `REDEEM`, rewards, rebates, conversions, deposits, and withdrawals.
  It has one guarded overflow role described below when a single participant's
  `/trades` result is itself capped.
- MySQL remains the small resumable control plane. Parquet stores the facts and
  DuckDB provides the analytics interface.

Do not use a normal offset walk over `/activity` to reconstruct a market. Live
tests showed that offset pages can overlap and that taker activity can aggregate
multiple per-fill `/trades` rows. The narrow overflow procedure below avoids
both failure modes and must pass strict containment and volume checks.

## Escaping the market-wide `/trades` cap

A market-wide `/trades?market=...&takerOnly=false` query is the fast path. If it
reaches the historical offset ceiling, reconstruct the market through the same
endpoint, partitioned by participant:

1. Read the participant set from the market's position snapshot.
2. For each wallet, request
   `/trades?user=<wallet>&market=<condition>&takerOnly=false`.
3. Concatenate the wallet results without set-based row deduplication.
4. Publish the market's Parquet snapshot only if its completeness checks pass.

### When one participant also exceeds the cap

A very active wallet can exceed the `/trades` ceiling even after the market is
partitioned by participant. In that rare scope:

1. Keep the capped per-wallet `/trades` result as a visible, trusted prefix.
2. Fetch that wallet and market's `TRADE` activity using bounded, disjoint time
   slices. Every request uses `offset=0`; a full page is split recursively by
   timestamp. The API's inclusive `start`/`end` behavior was verified directly.
3. Preserve response rows as a multiset, because two identical rows can
   represent two real fills.
4. Fetch the same wallet's `takerOnly=true` trades. Remove activity groups known
   to be taker and replace them with these per-fill taker rows, avoiding the
   activity endpoint's taker aggregation.
5. Require the entire visible `/trades` prefix to be a multiset subset of the
   reconstructed rows. Retain those visible rows verbatim and use activity only
   for the otherwise unreachable suffix.
6. Require the normal participant, Gamma-volume, and post-write Parquet checks.

This recovered 5,379 otherwise unreachable fills for one wallet on the June 20
BTC daily market. Its independent audit matched exactly: 9,379 stored rows,
9,379 reconstructed API rows, 47,805.810878 shares, and 25,183.510029 USDC. The
same path recovered 3,650 rows on June 21; its independent audit matched
7,150/7,150 wallet rows exactly.

The fallback fails closed if the taker-only scope also caps, one epoch second
contains a full unsplittable page, the visible-prefix containment check fails,
or the resulting market does not reproduce Gamma volume. Any of those cases is
an RPC/indexed-service escalation rather than permission to publish partial
data.

The public endpoint officially supports `user`, `market`, and `takerOnly`
filters: <https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets>.
The documented Data API limit for `/trades` is 200 requests per 10 seconds:
<https://docs.polymarket.com/api-reference/rate-limits>.

The partitioned path was measured against two BTC daily markets:

| Market | Participants | Trade rows | Reconstructed share volume | Gamma share volume |
|---|---:|---:|---:|---:|
| Bitcoin Up or Down on June 29, 2026 | 516 | 7,660 | 314,586.180452 | 314,586.180452 |
| Bitcoin Up or Down on June 6, 2026 | 684 | 13,221 | 667,368.531985 | 667,368.531985 |

Both matched exactly within floating-point noise. The second market contained
717 rows that were identical across all fields exposed by the API. Removing
those rows made the volume wrong, proving that identical-looking fills can be
genuine repeated fills. Trade rows therefore use whole-market snapshot
replacement and are never deduplicated by a synthetic field tuple.

## Verification contract

Every market is verified before it may become `done`:

1. Every returned row must match the requested condition ID and participant.
2. The set of wallets in the completed trade snapshot must be covered by the
   stored position participants.
3. `SUM(size) / 2` must match Gamma's market `volumeNum` within the established
   absolute rounding tolerance.
4. The Parquet file is written to a temporary path and atomically published only
   after the in-memory snapshot passes.
5. The persisted Parquet aggregate is checked again before the market is
   reported as complete.

This is intentionally per-market rather than a final sample-only audit. It adds
almost no API traffic: the checks reuse the rows already fetched for that
market. The only network value used by the gate is the Gamma volume already
stored in the market catalog. A later independent audit can still resample live
API responses to detect upstream changes.

## Activity without trade reconstruction

The activity endpoint supports market, event type, and epoch-second `start` and
`end` filters:
<https://docs.polymarket.com/api-reference/core/get-user-activity>.

Request only non-trade activity types. Keep time windows bounded and split a
window when it returns a full page instead of walking deep offsets. Boundary
overlap must be merged as a multiset: two byte-identical activities can be two
real events, so a plain `Set` deduplication is unsafe.

Trades and non-trade activity remain separate Parquet facts. DuckDB may expose a
unified event view ordered by timestamp and transaction hash for analysis.

## Ordering guarantee

The Data API exposes epoch-second timestamps and transaction hashes but not
`block_number`, `transaction_index`, or `log_index`. The API-first dataset can
therefore guarantee:

- all verified trade rows;
- all fetched non-trade activity rows;
- chronological order to one-second resolution;
- grouping of rows that share a transaction hash.

It cannot guarantee the order of independent events inside the same second.
That limitation is accepted for the initial analytics and strategy-inference
use cases.

## What the blockchain contains

Polygon contains the confirmed settlement ledger:

- exchange fills and matches;
- fees emitted by the exchange;
- conditional-token splits, merges, and redemptions;
- exact block, transaction, and log ordering.

The current exchange emits `OrderFilled`, `OrdersMatched`, and `FeeCharged`.
See the official V2 implementation:
<https://github.com/Polymarket/ctf-exchange-v2/blob/main/src/exchange/mixins/Events.sol>.

The chain does **not** contain the complete off-chain strategy context. In
particular, it is not a historical archive of every unfilled order, cancellation,
or order-book state. Blockchain data can reconstruct executed behavior, but it
cannot by itself reveal every decision that produced that behavior.

## Why raw RPC is not the initial source

Raw RPC does not require one request per trade. `eth_getLogs` reads contract
events over block ranges, which can then be decoded locally. However, providers
limit block ranges, response sizes, and request rates; public Polygon endpoints
explicitly warn that traffic restrictions may apply:
<https://docs.polygon.technology/pos/reference/rpc-endpoints>.

There is an additional V2 cost: `OrderFilled` indexes the order hash, maker, and
taker, but stores `tokenId` in the event data rather than an indexed topic. A raw
scanner cannot ask RPC for one market's token ID. It must download every fill
from the relevant exchange contract and block range, decode the logs, and then
filter locally. This is feasible, but materially more expensive and complex
than the API-first path.

## RPC fallback if the API cannot produce a verified market

Use the fallback only for a market that remains unverifiable after the
partitioned `/trades` path and its guarded single-wallet overflow recovery:

1. Resolve the market's two token IDs and active exchange contract from the
   stored Gamma metadata.
2. Resolve the Polygon block range covering market creation through settlement.
3. Fetch `OrderFilled` logs in resumable block chunks from both the standard and
   negative-risk exchanges as applicable.
4. Decode V2 events and retain only the market's token IDs.
5. Persist `block_number`, `transaction_index`, and `log_index` with each row.
6. Reconcile the decoded share volume against Gamma before publishing Parquet.
7. Fetch Conditional Token events separately when exact split/merge/redeem
   ordering is required.

The implementation must checkpoint the last completed block, adapt the chunk
size when a provider rejects a response, retry rate limits, and wait for finalized
blocks for ongoing syncs.

## Indexed-service alternative

Before building and maintaining a raw scanner, evaluate an indexed provider.
Polymarket lists Goldsky, Dune, and Allium as supported on-chain analytics
options. Goldsky can stream Polymarket activity into a database or warehouse:
<https://docs.polymarket.com/resources/blockchain-data>.

An indexed service is preferable when exact chain ordering becomes a routine
requirement across many markets. Raw RPC is preferable only when we need full
control, can tolerate maintaining an indexer, or cannot rely on a third-party
dataset.

## Escalation rule

For now, a market that fails the API verification remains `partial` and stops
the current phased run for investigation. The single-wallet overflow procedure
is permitted only under the explicit checks above; other ad hoc mixing of API
representations is not. Do not silently mix API and blockchain rows in one
market snapshot. If RPC or an indexed service is introduced later, record the
source explicitly and require the same completeness invariant before the market
becomes `done`.
