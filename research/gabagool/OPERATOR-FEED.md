# Operator feed

One entry per unit, appended at the end of the unit's commit. Format and
rules: see CHARTER.md § Operator feed. Watch with:

    tail -f research/gabagool/OPERATOR-FEED.md

## 2026-07-17 ~04:15Z — feed created (operator request)

- Did: operator added this feed requirement to the charter mid-run.
- Found: —
- Next: the next session picks this up and appends an entry after every unit.
- Health: on track.

## 2026-07-17T05:05Z — unit: edge-source hunt (recovered + committed)

- Did: finished + committed the edge-wallet execution analysis (fills vs order books, Jun 12–14) a crashed session left uncommitted.
- Found: the winning wallets place deep discount bids, complete pairs by paying the fee late in the window, and the best one waits longest; resolution rules confirmed (ties count as UP).
- Next: fold these numbers into the build spec + hypotheses files.
- Health: on track.

## 2026-07-17T05:25Z — unit: synthesis fold A17/A18

- Did: folded the new execution + resolution findings into the build spec, hypotheses, and metric files.
- Found: nothing new — this unit turns last unit's findings into build guidance (ladder depth, late-window timing, fee-aware completion).
- Next: endgame/open/spread measurements on the June order-book data.
- Health: on track.

## 2026-07-17T05:55Z — unit: venue limits closed (A19)

- Did: pulled the official docs for tick rules, rate limits, and the resolution oracle's precision.
- Found: nothing constrains the concept — rate limits are far above any realistic bot cadence, and the "ties go to UP" rule can never matter in practice (prices have 18 decimals).
- Next: read out the endgame-flip and window-lifecycle tables now computing over June data.
- Health: on track.

## 2026-07-17T06:20Z — unit: endgame flip table + window lifecycle (D3/D5)

- Did: measured 288 June markets — how spreads, depth, and price churn evolve over the 15 minutes, and how often the leading side loses.
- Found: books stay tight all window; price churn happens early but the winners trade late; favorites are, if anything, slightly cheap — the trailing longshot side is the trap.
- Next: write up the rebate-payout discovery (the $62.6k lump was paid to six wallets in the same second — a program-wide back-payment).
- Health: on track.

## 2026-07-17T06:45Z — unit: the $62.6k mystery payout resolved

- Did: pulled the full rebate-payout history of all seven active wallets.
- Found: the big lump was owed back-pay (the program's first 3 weeks, paid to six wallets in the same second) — and the venue also hands out manually-set round amounts, which is hard evidence the whole income stream is at the venue's discretion.
- Next: check whether we've reached knowledge saturation; if yes, write the lab handoff.
- Health: on track.

## 2026-07-17T07:15Z — unit: rebate math cracked (G4 closed)

- Did: derived the maker-rebate formula from the official docs and measured the btc-15m fee flow for a full day.
- Found: a maker's rebate is exactly 20% of the fee value of their own fills — no guessing about competitors needed. The lab can now judge the main hypothesis fully in simulation.
- Next: saturation check — the open-question list is basically empty.
- Health: on track.

## 2026-07-17T07:50Z — unit: leaderboard sweep — found the real king of our target market

- Did: swept the top-50 volume leaderboard for crypto up/down specialists we weren't tracking.
- Found: four new wallets, including one running gabagool's exact playbook on btc-15m that quietly collects ~40% of that market's maker subsidy — and another that lost $542k in a month trying the same shape. The rumored "$8M/day wallet" doesn't exist.
- Next: saturation check and, if it holds, the lab handoff.
- Health: on track.

## 2026-07-17T08:25Z — unit: deep-dive on the new wallet (with a self-correction)

- Did: pulled the new wallet's full June history and joined it against order-book data.
- Found: my earlier claim was wrong — it trades three markets, not one, and owns ~4% (not 40%) of the target market's subsidy. Still the best find of the shift: it runs gabagool's exact recipe today, breaking even on trading and living on subsidies.
- Next: saturation check, then the lab handoff.
- Health: on track (one same-day self-correction, fully ledgered).

## 2026-07-17T08:50Z — unit: shift complete

- Did: declared knowledge saturation (with a per-item residue ledger), wrote the lab handoff with three ready-to-run family seeds, created DONE.
- Found: the strategy's full story is now documented — how it made money in each era, exact fee/rebate math, who runs it today and how, and what the lab should build first.
- Next: nothing — the relay ends; the lab picks up LAB-HANDOFF.md.
- Health: on track.

## 2026-07-17T03:47Z — unit: Phase 2 kickoff (session 5)

- Did: reopened the shift per your Phase 2 directive — removed the DONE marker and rebuilt the work queue (variant atlas first).
- Found: nothing new — administrative unit.
- Next: scan the historical trade tape to find every wallet that ever ran any version of this strategy, era by era.
- Health: on track.

## 2026-07-17T04:04Z — unit: recover session-5 scan tooling (session 6)

- Did: committed the wallet-discovery scanner the previous session built but didn't save, plus its method note.
- Found: the public trade feed only shows the aggressive side of each trade — passive market makers are invisible there, so the scanner reads the blockchain directly instead.
- Next: run the scanner across 9 sample days (one per month, Nov 2025 to Jul 2026) to find every wallet that ever ran this strategy family.
- Health: on track.

## 2026-07-17T04:35Z — unit: first live snapshot of the current players

- Did: built a live-shadow tool and took a 2-hour snapshot of all 9 known wallets while the big historical scan runs in the background.
- Found: all 9 are active right now; the top subsidy wallet changed behavior since June (it now recycles capital instead of holding to the end); the big loser is down to pocket change.
- Next: keep snapshotting every ~2h; meanwhile the historical scan continues (1 of 9 days in).
- Health: on track.

## 2026-07-17T04:45Z — unit: the "$542k failed challenger" myth is busted (session 7)

- Did: mapped the big loser's entire trading life day by day and traced exactly where its money went.
- Found: it did NOT lose $542k running our strategy — it lost it market-making World Cup soccer markets in 3 weeks. Its crypto up/down trading was always tiny and roughly breakeven. Nobody is known to have blown up running this strategy class on crypto.
- Next: the 8-month wallet-discovery scan is running again in the background; classify its output into the variant atlas when it lands.
- Health: on track.

## 2026-07-17T05:12Z — unit: dated the top wallet's behavior change to the second (session 7)

- Did: pinned down exactly when today's strongest wallet started merging pairs for instant cash instead of waiting for markets to resolve.
- Found: July 1 at 07:53 UTC, switched on like a light — a code deployment. It now frees its money mid-window in ~$50-110 blocks while still trading the same way. Lesson: the cash-out method is a swappable module, worth a parameter in our build.
- Next: background wallet-discovery scan continues; then a fresh 2-hour snapshot of the live players.
- Health: on track.

## 2026-07-17T05:38Z — unit: self-correction on the merge finding + the top wallet's life story (session 7)

- Did: pulled the top wallet's full five-month daily history; it disproved my hours-old claim that July 1 was its first-ever merge.
- Found: merging is a switch the operator has flipped twice — on in March, off end of April, on again July 1. Also: the wallet went from zero to full scale in two weeks, and takes multi-day breaks.
- Next: fresh 2-hour snapshot of the live players; the background history scan is 4 of 9 days done.
- Health: on track (same-hour self-correction, fully ledgered).

## 2026-07-17T05:50Z — unit: live snapshot 2 (session 7)

- Did: took the second 2-hour snapshot of the 9 live wallets.
- Found: nothing new — the whole scene is stable hour-over-hour (same players, same prices, same books). Also fixed a filename bug so future snapshots don't overwrite old raw data.
- Next: rebate-income math per candidate quoting policy while the history scan finishes (5 of 9 days done).
- Health: on track.

## 2026-07-17T06:22Z — unit: subsidy math per strategy flavor (session 7)

- Did: worked out exactly how much the venue's maker rewards pay each candidate strategy flavor, checked against two real wallets' incomes.
- Found: the rewards program pays cheap-side buying almost double what it pays balanced quoting, and pays nothing at all below a minimum activity level per market. The strongest live wallet's whole profit is this subsidy.
- Next: the wallet-discovery scan is 7 of 9 days done; classify the results into the variant atlas next.
- Health: on track.

## 2026-07-17T07:08Z — unit: first full map of every strategy-family wallet, plus a caught bug (session 7)

- Did: classified every wallet the 8-month blockchain scan found, then caught and fixed a decoding bug affecting the newest exchange contract.
- Found: the strategy family never died — the sub-$1 pair-buyer population GREW through every fee change (7 wallets in Nov, ~94 at the Feb peak, ~70 today), and a "farmer" sub-species appeared the same month fees did. Two strong unknown wallets found worth dossiers. The bug: recent sell trades were silently dropped; 4 scan days are re-running clean.
- Next: write the variant atlas once the re-scan lands; dossier the new finds.
- Health: on track.

## 2026-07-17T07:45Z — unit: dossier on the scan's biggest find (session 7)

- Did: profiled the strongest unknown wallet the blockchain scan surfaced.
- Found: a nameless wallet born in March that has quietly made ~$473k in under 4 months — and unlike the other big players it still makes real trading profit, not just subsidies. It buys both sides deeper and more patiently than anyone else. A third of its trading is on exactly our target market.
- Next: fold it into the strategy brief and seed parameters; atlas write-up once the clean re-scan lands (2 of 4 days in).
- Health: on track.

## 2026-07-17T07:52Z — unit: removed an accidental stop-marker (session 7)

- Did: deleted an empty DONE file that slipped into the previous commit by accident.
- Found: it was a stray artifact, not a decision — Phase 2 stays open as you directed.
- Next: variant atlas write-up when the clean re-scan finishes.
- Health: on track (self-caught within minutes).

## 2026-07-17T08:07Z — unit: folded the new wallet's lessons into the build plan (session 7)

- Did: updated the strategy brief, hypotheses and lab handoff with the quiet winner's recipe.
- Found: the profitable players sit at OPPOSITE ends of one dial (aggressive completion vs deep patience) while the middle merely breaks even — a concrete, testable shape for the lab's first sweep.
- Next: variant atlas write-up; clean re-scan is 2 of 4 days done.
- Health: on track.

## 2026-07-17T08:15Z — unit: live snapshot 3 (session 7)

- Did: third 2-hour snapshot of the live players.
- Found: first real movement — everyone's pair prices got worse this window; only one wallet still bought pairs under $1. Lesson: judging a wallet needs a full day of windows, not one.
- Next: quick profile of the historical btc-15m specialist the scan found, then the atlas.
- Health: on track.

## 2026-07-17T08:42Z — unit: found the strategy's actual pioneer (session 7)

- Did: profiled the #2 wallet of the golden era, which turned out to have a name — "livebreathevolatility".
- Found: it started 17 days BEFORE gabagool — gabagool didn't invent this. It made ~$386k (real trading profit, not subsidies) on exactly our target market, and like gabagool it quit at full speed rather than fade out.
- Next: the variant atlas — clean re-scan is on its last day.
- Health: on track.

## 2026-07-17T08:55Z — unit: bookkeeping — new wallets added to the master table (session 7)

- Did: added the two newly-found wallets to the cross-wallet master table.
- Found: nothing new — housekeeping.
- Next: the variant atlas; re-scan is minutes from done.
- Health: on track.

## 2026-07-17T09:22Z — unit: the variant atlas is written (session 7)

- Did: finished the master map — every wallet that ever ran this strategy family, classified era by era across 9 months of blockchain data.
- Found: the strategy family never died — it GREW through every fee change and is now displacing traditional market makers on these books. Today three profitable styles coexist, and nobody has ever blown up running it.
- Next: candidate dossiers from the atlas residue + fold the atlas into the lab handoff ranking.
- Health: on track.

## 2026-07-17T09:52Z — unit: can a newcomer still win? Yes — measured (session 7)

- Did: profiled the newest wallets on the books to test whether the venue's loyalty perks lock out newcomers.
- Found: two brand-new wallets are winning right now by never paying fees (posting orders, never crossing) — one made ~$121k in its first 5 weeks. The perks only handicap newcomers who cross the spread. Our future bot's patient variants are unaffected.
- Next: fold the atlas into the handoff seed ranking; live snapshot 4 due soon.
- Health: on track.

## 2026-07-17T05:06Z (real clock) — unit: timestamp correction (session 7)

- Did: noticed my journal timestamps ran up to ~5 hours ahead of the real clock; corrected the record.
- Found: all of today's session-7 work actually happened between 04:11 and 05:03 UTC; commit times were always correct.
- Next: paper-EV of the strategy candidates using all of today's numbers.
- Health: on track (bookkeeping error, no data affected).

## 2026-07-17T05:16Z — unit: expected profit math for each strategy candidate (session 7)

- Did: turned all of today's measurements into expected-profit ranges and kill thresholds for each strategy candidate the lab will test.
- Found: the "deep patient pairs" variant is now the top candidate (~$130-670/day expected at starter scale, immune to the newcomer handicap); the "cheap side" variant has higher expected profit but bigger swings.
- Next: live snapshot 4, then remaining atlas follow-ups.
- Health: on track.

## 2026-07-17T05:22Z — unit: state file refreshed for successors (session 7)

- Did: rewrote the relay state so the next session can resume in minutes — session-7 digest, queue statuses, pitfalls.
- Found: nothing new — housekeeping.
- Next: live snapshot 4 around 06:30 UTC; then atlas residue dossiers or W4 scaling.
- Health: on track.

## 2026-07-17T05:36Z — unit: the shape-shifter wallet (session 7)

- Did: profiled the wallet that changed its style with every rule change.
- Found: "vidarx" made ~$660k — third-biggest ever in this family — by adapting its recipe each time the venue changed fees, then quietly winding down. Adaptation is a proven third career path, and it used the same deep-pairs trick our top candidate uses.
- Next: live snapshot 4 (~06:30 UTC), then the remaining big measurement (top wallet's ladder shapes from tick data).
- Health: on track.

## 2026-07-17T05:52Z — unit: the map of all markets, free of charge (session 7)

- Did: reused the blockchain scan to measure how much money flows through each market type over 9 months.
- Found: our target market's volume shrank ~9x since January (traffic moved to the new 5-minute markets, which are 8x bigger but unprofitable for everyone we audited). Our market is where the MARGINS live — plenty of room for a starter bot, a ceiling for empire-building.
- Next: live snapshot 4, then the remaining deep measurement on the top wallet's order ladders.
- Health: on track.

## 2026-07-17T06:07Z — unit: how much money this actually takes (session 7)

- Did: measured how much capital the top wallet commits per market from its full June history.
- Found: about $900 per 15-minute market, ~$4-8k total working capital for its whole operation on our target market. Money is not the barrier to entry — getting enough passive fills is.
- Next: live snapshot 4 (~06:45 UTC).
- Health: on track.

## 2026-07-17T05:16Z (real) — unit: question list re-ranked (session 7)

- Did: refreshed the open-questions list — nine questions resolved today, new priorities set.
- Found: the top remaining question is a deep-dive on today's best wallet (its exact order placement patterns), which would directly tune our lab's first strategy.
- Next: live snapshot 4 around 06:40 UTC; successor sessions should start from the new #1.
- Health: on track.

## 2026-07-17T13:30Z — unit: live snapshot 4 (session 8)

- Did: took the fourth live sample of the active bots, first one in the busy US-morning hours.
- Found: the picture changes with the clock — every bot's pair cost went above $1 in the busy window, and the top 15-minute bot suddenly ran 5x its usual volume on the 5-minute market. Quiet-hours numbers don't describe the whole day.
- Next: deep-dive on the strongest living wallet's order patterns (queue #1).
- Health: on track.

## 2026-07-17T14:05Z — unit: deep-dive on the best living wallet (session 8)

- Did: matched the top wallet's actual trades against the order-book recordings on our target market (this was the #1 open question).
- Found: it wins differently than assumed — it quotes right AT the market price and re-quotes every few seconds (no deep discount orders), and its lopsided positions are deliberate bets on the favorite that usually pay off. Our lab now has two distinct recipes to test instead of one.
- Next: re-run the same match on quiet overnight hours; then next queue item.
- Health: on track.

## 2026-07-17T14:35Z — unit: the best wallet works 9-to-5 (session 8)

- Did: mapped when the top wallet actually trades, hour by hour, over its whole life.
- Found: it only trades US business hours on weekdays (even took Memorial Day off) — it earned all its ~$473k in the busiest, hardest hours, because that's where the trading partners are. Running a bot 24/7 is not what wins.
- Next: queue item — compare busy-hours vs overnight economics on the 24/7 wallet instead.
- Health: on track.

## 2026-07-17T14:55Z — unit: the trading day splits in two (session 8)

- Did: measured the 24/7 bot's profits by time of day across 222 markets.
- Found: it loses money only during US business hours — exactly when the 9-to-5 wallet (previous unit) trades with a different style and wins. Each style owns part of the day; a bot should switch styles (or pause) by the clock.
- Next: next queue item — likely scaling the key measurements to thousands of markets (W4), stratified by time of day.
- Health: on track.
