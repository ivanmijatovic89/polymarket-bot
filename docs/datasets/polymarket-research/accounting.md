---
title: Research Accounting
description: Market cohort profit, settlement valuation and API reconciliation rules.
---

# Research accounting

## Default profit definition

Select markets by the UTC start of their trading window, then include their full
observed lifecycle. A June leaderboard therefore includes later redemption of a
June market, but excludes a July market even if it was listed during June.

For a wallet and condition:

```text
cash PnL = sell cash + merge cash + redemption cash
           - buy cash - split cash

economic PnL = cash PnL + remaining shares valued at the final payout

PnL with rewards = economic PnL + attributable rewards/rebates
```

This is a dollar result for the selected markets. It is not wallet-wide PnL or a
return on invested capital. Cash withdrawn from the wallet is not profit; deposits
are not revenue. Wallet-wide income with no reliable condition attribution must
not be spread over markets by an invented allocation rule.

Activity `usdc_size` supplies the cash legs. In the observed V2 buy samples it
already includes the fee charged over trade notional. The fee must not be deducted
a second time. `/trades` supplies participant discovery and occurrence checks;
its rows are not added to cash again.

For unresolved markets there is no final economic PnL. Winning tokens that remain
unredeemed have settlement value, so the economic ranking does not depend on when
a wallet chooses to redeem. Their value transfers to cash when redemption occurs.

## Inventory and activity checks

Every trade occurrence must appear in the wallet activity feed with matching
wallet, condition, token, transaction, timestamp, side, quantity and normalized
price. Matching is a multiset operation: two identical-looking fills still count
as two occurrences. A transaction hash is not a unique trade or activity key.

Splits add equal quantities of both outcome tokens and consume collateral once.
Merges consume both tokens and return collateral once. New redemption rows may
identify each outcome, including a losing outcome with zero cash payout. Older
combined rows can omit the token ID. For a resolved binary market with one $1
winner, the returned cash identifies the winning shares burned; the losing burn
is checked only to the extent the API exposes it.

The event-derived remaining balances are compared with position snapshots
(OPEN by market, CLOSED by wallet). The served balances in the tested V2 data have four-decimal precision;
the comparison allows one such quantum. Missing snapshots, negative unexplained
inventory, unsupported actions and meaningful balance differences remain visible
as issues. The activity API does not expose a complete general-purpose token
transfer ledger. Transfer-affected histories may therefore remain unresolved.

OPEN and CLOSED can both expose the same resolved holding. When balance and total
PnL agree, its economics is counted once and the overlap is recorded in `notes`.
Conflicting snapshots remain unresolved. A resolved losing position can also
report a synthetic zero CLOSED balance without a corresponding burn activity.
That unexposed balance has zero payout, is recorded in `notes`, and cannot change
economic PnL. A similar gap in a winning position remains an error.

## Why API PnL is a separate column

The live June 10 regression fixtures contain two fully closed, purchase-only
wallet histories. Their cash-based PnL is `82.377961` and `-100.446775`, while summed
API position PnL is `82.5311` and `-100.3381`.

A weighted-average-cost model truncating average entry cost to six decimals after
each purchase reproduces three of the four outcome-level API PnL values exactly
at their served four-decimal precision. Reordering purchases within the same
second reproduces the fourth. This is an empirical explanation, not a documented
promise about Polymarket's internal implementation. Such repeated rounding is
order sensitive; summing the exact served cash amounts is not.

The dataset keeps `api_position_pnl_usdc`, `api_pnl_difference_usdc` (local minus
API), and `api_pnl_status`. The separately rounded native realized/unrealized
components allow up to two four-decimal quanta per outcome. A conservative WAC
rounding bound applies only to
closed, purchase-only histories. It is never used to excuse a missing cash leg,
a trade mismatch or a balance gap. Other unexplained PnL differences exclude a
wallet/market from strict ranking until investigated.

For mixed BUY/SELL histories, a second empirical check replays six-decimal WAC
using the served activity order. A history is labeled `native_wac_reproduced` only
when this independently calculated result matches native PnL within the documented
component precision. Its diagnostic value is stored as `modeled_api_pnl_usdc`.
This model does not change local cash PnL, invent a within-second chronology, or
accept unsupported split/merge sequences. A June 1 regression fixture includes
both an explained 109-trade history and a three-trade counterexample whose larger
API PnL difference remains unresolved.

All served cash and share quantities are accumulated as integer millionths.
Parquet uses decimal columns. API prices are ratios and are stored at higher
precision; price times quantity is not a replacement for the cash field.

## Scope of a strict ranking

Every selected day must be published, and every scheduled market window must
have a documented catalog result. A missing market prevents a strict leaderboard.
For a wallet to rank, all of its observed trader/market pairs in the selected
cohort must have complete accounting. A missing losing position must never turn
partial profit into an apparently complete winning record.

Raw SQL and coverage reports retain excluded wallets and their reasons. The
`wallet_months` view also requires coverage of the whole calendar month before
exposing a final monthly economic PnL; observed cash is labeled separately.
