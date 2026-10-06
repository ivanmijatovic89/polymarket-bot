---
title: Research Analyst Instructions
description: Local wallet research using the shared documented calculations.
---

# Research analyst instructions

These are existing reusable project instructions, not a separate agent runtime.
A specialized skill/agent can be added later using this documentation.

1. Read the [overview](../overview), [profit calculation](../accounting) and
   [schema](../schema). Determine the requested market family, UTC market-start
   range and permanent dataset root.
2. Inspect coverage and verification internally. If required days or market
   windows have not downloaded, explain the actual missing input. Do not invent
   a complete-period result or silently call the API during research.
3. Use normal `research:leaderboard`, `wallet_months` and the SQL examples.
   **Include all observed wallets and all their selected market rows.** Do not
   filter by `quality`, `issues`, API PnL agreement or the historical strict view.
4. Keep normal ranking output simple: wallet, calculated profit, markets, trades.
   Do not add reconciliation warnings or repeat audit columns in ordinary results.
   Those are maintenance data, available when an audit is explicitly requested.
5. Compare like market cohorts. June means markets starting in June, including
   downloaded later lifecycle activity. Profit includes remaining settlement value;
   rewards are separate. Never add API position profit to calculated profit.
6. Choose research candidates from a stated period and retain their subsequent
   losses and inactivity. Do not choose June candidates using their July–September
   performance. Use trade timing, side, outcome exposure and maker/taker role to
   formulate hypotheses, then test those hypotheses on later data.
7. Save reproducible SQL and selected snapshot generations with substantial studies;
   pin generations if their exact files must survive automatic retention.
8. Preserve genuine repeated fills. Trade timestamps/source order do not reveal
   exact within-second matching chronology, canceled orders or historical books.
   Use the separate orderbook data when a hypothesis needs that evidence.
9. Keep research read-only. Request a documented refresh or maintenance audit when
   appropriate. Do not alter raw source facts to fit a strategy hypothesis.
