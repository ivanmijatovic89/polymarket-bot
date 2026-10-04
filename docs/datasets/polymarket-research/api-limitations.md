---
title: API Accounting Exceptions
description: Reproducible evidence for excluded wallet histories and the limits of additional V2 endpoints.
---

# API accounting exceptions

The downloader can finish and pass local integrity checks while some served
wallet histories remain inconsistent. `verify.valid` confirms the implemented
file and SQL checks; `all_wallet_accounting_complete` answers the separate
accounting question. An unresolved wallet is excluded from the strict leaderboard
for the entire selected cohort, including its otherwise complete markets.

The following evidence was inspected on October 4, 2026. It uses Data API V2 and
saved Parquet only. The contract reference is the
[official V2 OpenAPI document](https://data-api.polymarket.com/v2/openapi.json).
Context7 returned older V1 documentation for the holder lookup, so the V2 contract
and bounded live requests were used for that endpoint.

## Observed issue classes

These are overlapping wallet/market counts from accounting version 5. A row can
have several issues; adding the columns overcounts affected pairs. These three
sample days are not evidence of complete calendar months.

| Issue | June 1 | July 1 | August 1 | Meaning |
| --- | ---: | ---: | ---: | --- |
| `api_pnl_unreconciled` | 425 | 426 | 298 | Cash-based economics differs from native PnL beyond the supported explanations. |
| `missing_position_economics` | 76 | 56 | 29 | No position economics is available for this observed trading wallet/market. |
| `missing_position_snapshot` | 107 | 89 | 88 | An outcome requiring a position comparison has no served snapshot. |
| `position_balance_mismatch` | 260 | 29 | 1 | The activity-derived balance and served position disagree materially. |
| `unexplained_token_outflow` | 71 | 27 | 1 | Observed sells, merges or redemptions consume more tokens than the history acquired. |
| Distinct unresolved pairs | 732 | 492 | 347 | Each affected wallet/market counted once. |

The sample days have no trade/activity multiset mismatches. Agreement between the
two trade feeds cannot prove that all non-trade acquisitions, burns or transfers
were exposed. The evidence below distinguishes observations from possible causes.

### Exclusion can affect active wallets disproportionately

The accounting-version-5 audit of June 1–7 covers 672 market windows and
3,341,212 trade rows. It finds 3,049 unresolved pairs out of 411,576 observed
wallet/market pairs. Excluding each affected wallet's entire weekly cohort removes
791 of 13,018 wallets (6.1%), including 1,391,334 trade rows (41.6%). These are
historical baseline measurements, not complete-month results or current-version
coverage. A small unresolved-pair percentage can therefore hide a substantial
limitation for research into active traders. Report wallet and trade participation
alongside unresolved-pair counts, and rerun the audit after accounting updates.

The reproducible SQL, bound snapshot index and source probes are saved under
`logs/weekly-audit-20260601-20260608/`. The accounting-version-6 dry run explains
17 terminal-merge histories across the nine sample days then available, without
changing any exact cash result. This narrow improvement does not resolve the
other discrepancies or establish a complete calendar month's rankings.

After rebuilding all ten days then published, 19 histories passed the new rule.
Source hashes, cutoffs, row membership and every monetary total were unchanged.
In the same June 1–7 cohort, unresolved pairs fell to 3,033 and excluded wallets
to 790. Restoring one active wallet's complete weekly cohort reduced excluded
trade rows to 1,243,100 (37.2% of 3,341,212). This is still a material selection
effect. The new measurements are in `eligibility-v6.json`, with unchanged-fact
checks in `rebuild-v6-invariants.json` under the audit directory above.

The later June 1–24 checkpoint contains 9,984,088 participant trade rows and
26,905 wallets. Its 8,226 unresolved wallet/market pairs exclude 1,945 wallets
(7.2%) with 4,832,670 trade rows (48.4%). This is a partial-month measurement,
using accounting version 6, not a final June ranking. Four corroborated market
volume warnings are counted separately and do not cause these exclusions.
Run [the monthly population query](./schema#runnable-research-queries) beside
each ranking; its excluded-trade count includes an excluded wallet's reconciled
markets too. Snapshot-bound output and the twenty largest excluded contributors
are saved under `logs/monthly-population-20261004/`.

## Native lifetime purchases disagree with activity

Wallet `0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82` has 177,851 trade rows in the
first week, but two unresolved markets exclude it from that strict weekly cohort.
For `btc-updown-15m-1780384500`, observed winning-token purchases total
`935.918090` shares; native `total_size` reports `915.9245`. The contract defines
that field as lifetime bought shares. The `19.993590` share difference exceeds
its output precision. Exact cash PnL is `24.868641`, compared with native
`7.117400`; the `17.751241` difference also exceeds the purchase rounding bound.

On `btc-updown-15m-1780724700`, observed winning purchases are `1657.445524`
shares versus native `1645.4455`; local and native PnL differ by `2.710361`.
Fresh complete activity and CLOSED-position walks reproduce both cases exactly.
Six diagnostic within-second orderings do not reproduce native PnL. This proves
an inconsistency between served representations, not which underlying event or
ledger is wrong. Both histories remain excluded, with all original facts retained.

A second wallet on `btc-updown-15m-1780384500`,
`0x48ac40fc545cf327edd5365435c3a9f385614a7e`, has a losing-token discrepancy:
43 BUY activities acquire `211.552755` shares, while native lifetime purchases
report `204.9527`, a difference of `6.600055` shares. Its winning purchases and
redemption agree at `297.760189` shares. Exact cash PnL is `-36.549486` versus
native `-34.348300`; the empirical WAC model gives `-36.543098` and does not
explain that gap. Fresh wallet-scoped walks at page size 137 reproduce all 96
trades, 97 activities and both CLOSED positions. The wallet has only this one
unresolved market among 2,284 observed June 1–24 markets, but its 225,054 trade
rows are excluded from that strict cohort. The saved and repeated source rows
remain in `logs/monthly-population-20261004/wallet-48ac-june02/evidence.json`.
This is an unresolved source contradiction, not a reason to discard its loss or
increase the rounding tolerance.

## Winning holding disappears without a redemption row

Wallet `0x0b4c08cc6017119e98479629c17b1445c41f0f79`, condition
`0xde70ef2f4204289e0fcc54d22a5b0ed941334cf9d0eb9b859d73c7b83967f5e3`:

- The saved activity contains one BUY of `6.340908` winning shares for `5.626869`.
- The CLOSED position reports zero shares and native PnL `0.7140`.
- The local economic result is `0.714039` if those shares remain available for
  settlement, but there is no activity establishing their later disposition.
- A fresh activity request still returns just that BUY. A complete holder walk
  with `include_pnl=true` returns 121 holders and none for this wallet. An OPEN
  position request with `include_archived=true` and a one-micro-share floor is
  also empty.

A second one-BUY case, wallet `0x10e5900cf249c95c5e4912843b008059120e63c8`
on condition `0xd2a9e15d208a0e7adcfd093ac7b462e6f8a9756dc39068c926070585eefe2db8`,
has the same pattern: no matching holder among 153 served holders, no OPEN
position, and no additional activity. These checks do not tell us whether a
redemption or another disposition is missing. Matching approximate economic PnL
is insufficient to assert complete cash and inventory history.

## Acquisition or position economics is absent

Wallet `0x651f1e1bd1ef9736bdca24578bd06e8ca953e460`, condition
`0xa683556202289e88862297e4b1c44d49fb45a6ee54f7229d3ac52d761703266b`,
has SPLIT 40, SELL 20 for `18.4`, and MERGE 20, but no native positions. A fresh
walk returns the same three activities, no OPEN position and no matching holder
among 86 served holders. This market's remaining observed shares have zero
settlement value; the missing native economics is still explicitly unresolved.

For the same wallet on condition
`0xd2a9e15d208a0e7adcfd093ac7b462e6f8a9756dc39068c926070585eefe2db8`,
the saved history contains SELL 20, MERGE 20 and REDEEM 20 without an acquisition.
There is no defensible local purchase price to invent. An unexposed transfer or
missing source activity is a possible cause, not an established explanation.

A bounded follow-up compared `exclude_deposits_withdrawals=true` and `false`
for this missing-acquisition case and the first missing-redemption case above.
Both requests used the same wallet, condition, time bounds and ascending order,
and followed pagination to exhaustion. Including deposits and withdrawals still
returned the same three and one economic rows respectively, including duplicate
multiplicity. This option did not recover the missing events in either case;
it does not establish that every other wallet behaves the same way. The saved
request parameters, original responses and comparison are in
`logs/api-exception-probes/include-deposits-evidence.json` under the dataset root.

## Large native PnL differences in SPLIT histories

Wallet `0x674887d1ac838099a48b629dff53f25b7b87ee08`, condition
`0xa87031a0326f50403887aa0f9e15574532d54271cd4c8c6f12eec857572bcc53`,
has 58 trades, one SPLIT and one REDEEM. Its served cash totals are:

```text
240.340200 sell + 83.161355 redeem - 172.276920 buy - 400 split
= -248.775365 USDC
```

The two CLOSED positions instead sum to `-5.684400`. Their `total_size` fields
match BUY quantities and omit the 400 shares minted per outcome. That observation
does not establish how the native ledger accounted for the SPLIT. The empirical
WAC replay gives `-248.772638`, so ordinary rounding does not reproduce native
PnL here. Two further inspected markets for this wallet have differences above
193 USDC. These histories remain unresolved; the pipeline neither replaces the
cash result with native PnL nor treats the difference as a fee adjustment.

## What the other V2 endpoints can establish

| Endpoint | Useful evidence | Why it does not repair these histories |
| --- | --- | --- |
| `/v2/holders?include_pnl=true` | Per-outcome gross holdings and position economics; both outcomes can appear. | A present-day snapshot has no missing transaction history. The three complete sample walks above recovered no missing holding. |
| `/v2/positions` | Remaining balances and native economics; wallet-scoped CLOSED recovers exited traders omitted by market-scoped queries. | Inactive markets can still be excluded; missing or contradictory source facts remain possible. |
| `/v2/user-pnl` and `/v2/user-stats` | Wallet-wide native PnL and profile statistics. | Neither accepts the arbitrary BTC 15-minute condition cohort needed to isolate these months. |
| `/v2/leaderboard` | Existing category/time-period rankings. | Its rolling windows and accounting definition differ from a chosen historical market-start cohort; it is not a June BTC 15-minute reconciliation source. |
| `/v2/biggest-winners` | Large individual winning positions. | It omits the complete loss history needed for wallet rankings and selects by resolution window. |

Holder pagination uses offset positions inside its cursor. Merge token groups by
`token_id`; exhausted groups disappear from later pages. A changing holder table
is not a frozen historical transaction snapshot. The bounded probes used stable,
resolved markets, preserved every original filter and followed each cursor to
completion.

## Gamma list omission recovered by direct lookup

On June 17, `btc-updown-15m-1781727300` was absent from both closed/open list
requests and a separate unfiltered slug list. Gamma's direct market and event
slug endpoints returned market `2570741`, event `602381`, with `closed=true` and
`active=false`. The market is therefore available; the list omission must not
be classified as a nonexistent window.

Catalog discovery now tries the direct market endpoint for each missing slug
and fetches its resolution alongside the other markets. A direct 404 stays an
explicit gap. Transient failures and responses for another slug fail visibly.
Resuming a checkpoint with missing catalog entries retries discovery. Regression
tests cover recovery, true 404s, failures, mismatched identities and resume.
Original Gamma responses are in `logs/catalog-gap-20260617/` in the data root.

## June 16 taker-volume disagreement

Market `btc-updown-15m-1781581500`, event `596280`, stopped publication because
1,431 taker rows sum to **29,379.603267 shares**, while `/v2/live-volume` returns
**29,377.642483 shares**. Fresh walks at page sizes 1,000 and 137 reproduce the
same multiset, with no identical taker rows. A fresh all-side walk also matches
the checkpoint exactly; its 58,759.206534 shares equal twice the taker total.

The 1.960784-share difference is within one microshare of the earliest trade's
1.960783 shares. That trade occurred on June 15 at 03:53:12 UTC, before the
selected market window, in transaction
`0x7d8a73c8516e505f728ac0e4172cb4b59562078284a187e55fc8185b15cca1d1`.
Both counterparties' wallet-scoped trade and activity endpoints retain it;
their CLOSED positions also report the acquired quantity at four-decimal
precision. The winning wallet's activity additionally contains its redemption.
This supports retaining the trade. It does not establish why the aggregate
differs or justify deleting a row to force agreement.

Downloader version 8 retains this kind of corroborated disagreement as a source
warning, under the user's delegated acceptance decision. The rule is deliberately
narrow. All of these conditions must hold:

- The market is resolved, its reported aggregate is positive, and the detailed
  taker total exceeds that aggregate. Neither an absolute nor a percentage
  difference is sufficient evidence for this exception.
- The discrepancy matches **all** taker fills in the first 60 seconds of observed
  trading, within one microshare. This opening burst is entirely before the
  market window, with an observed later trade at least 60 seconds after its last fill.
  All same-second fills are included; the code never searches for a matching
  subset or invents ordering within a second.
- Every opening transaction has exactly one taker row, and its maker rows sum
  exactly to that taker's quantity with matching timestamps. Multiple makers
  are preserved. All-side quantity is exactly twice total taker quantity.
- Independent all-side and taker walks at page size 137 reproduce every original
  fill with its multiplicity. A repeated single-event aggregate remains unchanged.
- Every wallet involved in the opening burst passes the existing full
  wallet/market accounting checks, including trade/activity, cash, positions and
  native PnL reconciliation.

The code retains every trade and cash amount. It saves the repeated source rows
in checksummed `volume-evidence.json`, flags the market in Parquet using
`source_warnings`, and exposes the warning in coverage, wallet and leaderboard
reports. Offline verification rechecks the saved evidence and recomputes the
participants' accounting. `verify.valid` may be true with a warning, while
`all_source_aggregates_reconciled` is false. Wallet eligibility still depends on
wallet accounting; this source warning alone does not exclude an otherwise
complete wallet. A mismatch outside this rule still stops publication.

June 18 exposed another candidate: `btc-updown-15m-1781818200` has a
3.000001-share discrepancy, within one microshare of a 3-share early fill.
Both June 16 and June 18 have now passed the repeated-feed and counterparty
checks, followed by offline verification after publication, with their warnings
preserved. June 18's early counterparties have cash PnL +1.417530 and -1.470000
USDC and no wallet-accounting issues. The separate 304 unresolved histories on
that day retain their existing exclusions. Live evidence is saved in
`logs/volume-policy-20261004/live-2026-06-18.json`.
This recurrence supports investigating aggregate start boundaries, but does not
prove the cause. Original June 16 pages and wallet comparisons remain in
`logs/volume-mismatch-20260616/` in the permanent root.

## June 20 opening burst

`btc-updown-15m-1781927100` has 34,013.455487 taker shares versus the aggregate's
33,984.043742. Their **29.411745-share** difference equals all 15 taker fills in
the opening 31 seconds. The next trade occurred over 22 hours later. Fresh
all-side and taker walks reproduce the cached multisets exactly. Two opening
transactions have several makers; their quantities sum exactly to the taker
quantity. All eight involved wallets' full market histories reconcile, including
their later trades, cash, positions and native PnL.

Version 7 extended the original single-fill rule to an isolated opening
burst. It removed the original absolute 10-share cap while retaining a 0.1%
relative bound. Version 8 subsequently removed that magnitude gate for the
reason below; complete repeated feeds and every participant's accounting remain required.
The rule does not accept a mismatch merely because it is small. Tests cover
multi-maker fills, all participants, arbitrary input order, rejection of matching
subsets and continuous trading, Parquet publication, rebuild and offline evidence
verification. Original pages, all eight wallet histories and the candidate
validation are in `logs/volume-mismatch-20260620/` in the permanent root. This
establishes corroboration of the retained facts, not the cause of the aggregate
omission. The full June 20 day has since published and passed offline verification.
The eight involved wallets retain exactly the probe's cash PnL, economic PnL,
native PnL and trade counts; `publication-invariants.json` records the comparison.
The separate 322 unresolved histories elsewhere that day retain their exclusions.

Gamma's saved market and event `startDate` are both 03:52:56 UTC, before this
03:53:13–03:53:44 opening burst. A cutoff at that declared timestamp therefore
does not explain this case. The actual aggregate omission mechanism remains
unproven.

## June 30: evidence and the percentage gate

`btc-updown-15m-1782789300` has 26,094.468913 downloaded taker shares versus
26,065.057158 in the aggregate. The **29.411755-share** difference equals all five
opening fills and is about 0.113% of the downloaded total. Fresh complete walks
at page size 137 reproduce both trade multisets exactly, the aggregate is
unchanged, and all seven opening participants' full market histories reconcile.
This is the same absolute discrepancy observed and verified on June 28, whose
higher market volume kept it below the former 0.1% gate.

Version 8 removes the percentage gate instead of increasing it to fit this one
market. Market volume does not establish whether the retained trades and cash
are correct. The exception requires the entire isolated opening burst to explain
the discrepancy, repeated complete feeds to agree, all maker/taker quantities
to match, and every involved wallet to pass accounting. A missing later trade,
matching subset, changed repeat feed or unresolved participant still fails.
The exact discrepancy remains a source warning, and the aggregate remains
explicitly unreconciled. No trade, cash value or wallet-accounting tolerance changes.

The cached rows, repeat walks, seven wallet histories and candidate validation
are retained in `logs/volume-mismatch-20260630/`. They establish evidence for
retaining the source facts; the upstream cause of the aggregate omission remains
unknown. Publication and full-day verification are separate steps.

## Reproduce the local audit

Run these queries through `research:sql --sql-file ...` against the saved root.
They make no API requests. Always pair the output with `research:coverage` and
the selected snapshot timestamps.

```sql
SELECT strftime(to_timestamp(market_start), '%Y-%m-%d') AS day,
       u.issue, count(*) AS affected_pairs,
       count(DISTINCT wallet) AS affected_wallets
FROM wallet_markets, unnest(issues) AS u(issue)
GROUP BY day, u.issue
ORDER BY day, u.issue;
```

```sql
SELECT wallet, condition_id, slug, trade_count, activity_count,
       buy_usdc, sell_usdc, split_usdc, merge_usdc, redeem_usdc,
       cash_pnl_usdc, unredeemed_value_usdc, economic_pnl_usdc,
       api_position_pnl_usdc, api_pnl_difference_usdc,
       modeled_api_pnl_usdc, issues, notes
FROM wallet_markets
WHERE quality <> 'complete'
ORDER BY abs(api_pnl_difference_usdc) DESC NULLS LAST
LIMIT 25;
```

Filter `activities` and `positions` by both `proxy_wallet` and `condition_id` to
inspect an individual case. `raw_json` retains fields such as native cost basis
and source event timestamps. A source refresh may recover corrected rows; an
offline rebuild can only reevaluate the facts already saved. Neither operation
is evidence that a discrepancy has disappeared until its checks pass again.
