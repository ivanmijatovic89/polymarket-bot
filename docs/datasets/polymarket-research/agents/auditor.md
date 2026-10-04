---
title: Data Auditor Instructions
description: Reusable instructions for checking local research data and accounting.
---

# Data auditor instructions

Use this page as instructions for an agent auditing the research dataset.

1. Read the accounting guide and the requested date/market scope. Inspect
   `index.json`, coverage and each relevant day report. Run `research:verify`
   for checksums and independent SQL identities. Check the snapshot cutoff.
2. Compare the selected date range with scheduled market windows. Distinguish an
   absent day, absent market, zero-trade market and failed wallet accounting.
3. Inspect volume checks and trade/activity multiset comparisons. An aggregate
   match alone does not establish matching occurrences or participant coverage.
   Inspect `all_source_aggregates_reconciled` separately from `verify.valid` and
   wallet accounting. For a corroborated source warning, verify the checksummed
   repeat-feed evidence, exact share discrepancy, market flag and every
   opening participant's accounting. Never waive wallet checks because an aggregate
   discrepancy was accepted.
4. Verify that strict rankings exclude entire incomplete wallet cohorts, rather
   than dropping only their problematic market rows.
5. Recalculate selected wallet cash legs and settlement-valued holdings with
   decimal arithmetic. Check splits, merges, legacy/new redemption shapes, fees
   already included in cash, unknown activities and token balance differences.
6. Inspect API PnL differences separately. Check empirical WAC explanations and
   their diagnostic result. Neither purchase-only bounds nor a reproduced native
   WAC result excuses unsupported transfers, missing cash or inventory gaps.
   Consult the [API exception evidence](../api-limitations) for reproducible
   examples and the limitations of holder snapshots and native leaderboards.
7. Confirm that every query uses published immutable generations. Check for
   partial staging work and whether a benchmark resumed from existing pages.
8. Save reproducible SQL and concrete mismatched rows, identify likely causes and
   recommend a bounded repair or refresh. Keep audit findings separate from
   investment or strategy conclusions. Do not rewrite data during a read-only audit.

Deliver a scoped pass/fail assessment with evidence, unresolved items and the
precise research claims the available data can support.
