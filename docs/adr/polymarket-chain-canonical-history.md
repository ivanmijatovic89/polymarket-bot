# ADR: Chain-canonical Polymarket history

Status: Accepted for the RPC prototype  
Date: 2026-07-16

## Decision

Executed Polymarket history is reconstructed from finalized Polygon logs and
stored in Parquet. The Data API and Gamma remain independent comparison and
metadata sources; neither is allowed to fill a hole in the chain dataset.

For CLOB V2 trades, discovery uses the `OrdersMatched` event rather than a
global download of every `OrderFilled` event. Every successful V2
`matchOrders` call emits one taker `OrderFilled` followed by one
`OrdersMatched`. `OrdersMatched` contains the taker market token ID. The
pipeline therefore:

1. scans `OrdersMatched` over the complete market lifetime;
2. filters the decoded token ID against both outcome token IDs in our catalog;
3. fetches the receipt for every matching transaction;
4. retains every target-market `OrderFilled` event from those receipts; and
5. orders rows by block number, transaction index, and log index.

This is complete for a binary market because every maker order in a successful
match is for the taker token or its complementary outcome, and both outcome
token IDs are in the market catalog.

Non-trade activity is sourced separately. `PositionSplit` and
`PositionsMerge` can be filtered by their indexed condition ID.
`PayoutRedemption` must be scanned by event signature and filtered after
decoding because its condition ID is not indexed. These semantic lifecycle
events retain canonical block, transaction, and log coordinates, so they can be
ordered exactly with trade fills. Internal ERC-1155 transfer logs are not
duplicated as activity rows; doing so would count the token movement and the
split/merge/redeem that caused it as two user actions.

## Completeness contract

A scope may be published only when all of these checks pass:

- the catalog has a condition ID and two outcome token IDs for every market;
- the block range starts no later than market creation and ends after the last
  accepted trade;
- two independent Polygon RPC providers return the same ordered
  `OrdersMatched` log sequence for every scanned block chunk;
- both providers return the same relevant ordered log sequence for every
  selected transaction receipt;
- both providers return the same ordered split/merge/redemption sequence and
  matching block headers for every activity checkpoint;
- block hashes agree between providers and every log has `removed = false`;
- every matching `OrdersMatched` event discovered for a transaction is present
  at the same log index in its verified receipt;
- every retained fill maps to exactly one catalog market and outcome;
- no duplicate `(block_hash, transaction_hash, log_index)` identity exists;
- exact integer amounts are preserved before any decimal presentation value is
  calculated;
- per-market chain totals and participant sets are compared with the Data API,
  and chain collateral volume is compared with Gamma; and
- any discrepancy produces a failed verification report and prevents
  publication. API rows are never silently merged into chain rows.

For historical backfills, blocks are already deeply finalized. Recurring
updates additionally wait for a configurable finality distance and re-check
the last checkpoint's block hash before resuming.

## Evidence and limitations

The V2 event definitions and emission order come from Polymarket's official
[`ctf-exchange-v2`](https://github.com/Polymarket/ctf-exchange-v2) contract.
Contract addresses come from the official
[contract reference](https://docs.polymarket.com/resources/contracts).

The public Polymarket Goldsky orderbook subgraph is not used for June 2026. Its
public endpoint was observed at block `87,814,766` on 2026-07-16 and its schema
targets the older exchange event, while the verified June sample is on CLOB V2
at block `88,245,581`.

The chain is canonical for executed settlements, not for the off-chain order
book. It cannot recover historical unfilled or cancelled orders, historical
book snapshots, or the private decision context that preceded an execution.
Direct ERC-1155 transfers are outside the semantic activity view; add a
separate transfer-ledger view if that distinction becomes analytically useful.

## Provider constraints established by the prototype

- receipt verification uses 250-receipt JSON batches and keeps its provider
  pool separate from activity discovery;
- activity log queries use 25-block ranges because global redemption responses
  can become dense;
- dRPC accepts at most 10 calls in a JSON batch, so activity block headers are
  verified in batches of 10; and
- HTTP 408, 429, 5xx, network failures, and request timeouts are retryable.
  Checkpoints are written only after both providers agree, so a failed request
  can never publish a partial chunk.

## Storage

Discovery checkpoints and unverified candidate Parquet remain under
`data/polymarket/chain/staging/`. Verified market facts are published to the
symbol/timeframe/day prototype partitions only after the complete scope passes.
Monthly compaction is deliberately deferred until the one-day BTC 5m test is
complete and validated.
