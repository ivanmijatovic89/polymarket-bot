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

## 2026-07-17T15:20Z — unit: how many fills a passive bot can get (session 8)

- Did: simulated passive orders at different depths and re-quote speeds against 30 recorded markets.
- Found: quoting at the market price with fast re-quotes gets plenty of fills to unlock the daily rebate bonus without ever paying fees — and the two profitable styles we found in the wild are exactly the two sweet spots of this trade-off (fast-and-shallow vs slow-and-deep).
- Next: live snapshot 5, then scaling measurements to more months (W4).
- Health: on track.

## 2026-07-17T13:55Z — unit: live snapshot 5 + clock fix (session 8)

- Did: fifth live sample (mostly confirming the fourth), and corrected my own drifted timestamps in the journal (real times are ~1h earlier than stamped for units 2-5).
- Found: the top 15-minute bot's new 5-minute sleeve is real and persists; the two best wallets are back under the $1 pair-cost line even in busy hours — storms, not the clock alone, drive the hard stretches.
- Next: W4 — scale the key measurements to more months/markets.
- Health: on track.

## 2026-07-17T14:35Z — unit: fill measurement scaled to 4 months (session 8)

- Did: repeated the passive-fill measurement on 192 markets spread over January-June, split by time of day.
- Found: the earlier conclusions hold everywhere — passive quoting gets enough fills to unlock the rebate bonus in ~9 of 10 markets, in every month and time slot. Also caught a data trap: some January recordings are empty shells that would silently skew backtests (now documented).
- Next: live snapshot 6 (~15:30 UTC), then remaining queue (b27bc932 ladder-by-volatility or atlas dossiers).
- Health: on track.

## 2026-07-17T14:55Z — unit: fourth wallet fingerprinted (session 8)

- Did: matched the breakeven 24/7 bot's trades against the books, completing a four-wallet comparison.
- Found: the profitable and breakeven bots use nearly identical order placement — the difference is that the winner's orders fill right before prices move its way, the breakeven one's right before they move against. Picking WHEN to stand in line is the whole edge.
- Next: live snapshot 6 (~15:30 UTC), then atlas residue dossiers.
- Health: on track.

## 2026-07-17T14:13Z — unit: the "free money window" measured (session 8)

- Did: scanned 209 recorded markets for moments when buying BOTH sides costs under $1.
- Found: those moments happen in every market but last under a second and are worth ~$2.50 a market today — no instant-profit trick exists. In January they lasted minutes and were worth thousands; the bots ate that pool and it's gone. Passive standing orders are the only way to collect the crumbs.
- Next: live snapshot 6, then a state-file refresh for successors.
- Health: on track.

## 2026-07-17T14:16Z — unit: the sprinter wallet (session 8)

- Did: profiled March's top wallet from the atlas backlog.
- Found: it made $216k in 33 days — the fastest pace ever seen in this family — starting the same week the original gabagool quit, and stopping just as suddenly. Lesson confirmed: every fee change opens a brief gold rush before the field adjusts.
- Next: live snapshot 6 (~15:30 UTC), then STATE refresh for successors.
- Health: on track.

## 2026-07-17T14:18Z — unit: the January gold-rush winners (session 8)

- Did: profiled the two wallets that ate January's brief "both sides under $1" gold rush.
- Found: ~$380k each in about five weeks, then both vanished the week the opportunity closed. One of them switched styles the exact month fees arrived — confirming our fee math with its behavior. Every winner in this family exits abruptly at full speed; none has ever bled out.
- Next: live snapshot 6 (~15:30 UTC), then STATE/queue refresh for successors.
- Health: on track.

## 2026-07-17T14:20Z — unit: the original masters + the shrinking prize (session 8)

- Did: profiled the two earliest big wallets, completing the historical map of every major player.
- Found: the #2 earner ever made $854k in nine weeks back in Nov-Jan; but the best achievable daily rate has shrunk 5x since then ($14k/day then, ~$3k/day now). Realistic target for a new bot today: $1-3k/day, with the exit being "margins shrank" — never a blow-up.
- Next: live snapshot 6, then queue refresh for successors.
- Health: on track.

## 2026-07-17T14:22Z — unit: bookkeeping + new top question (session 8)

- Did: checked a minor open question (merge timing across wallets — no pattern, closed), re-ranked the question list, and refreshed the successor handbook.
- Found: after today's ten answers, the new #1 question is: what exactly does the winning bot see in the order book just before it places the orders that pay off? All data to answer it is already downloaded.
- Next: live snapshot 6 (~15:30 UTC), then attack the new #1.
- Health: on track.

## 2026-07-17T14:26Z — unit: found the winner's secret (session 8)

- Did: compared what the market looked like right before each bot's passive orders got filled (5,700 fills, winner vs breakeven bot).
- Found: the winner gets its orders filled in CALM moments; the breakeven bot gets filled while chasing price runs — and short-term price moves tend to continue, so chased fills lose. Concrete rule for our bot: quote when the market is quiet, stand aside right after sharp moves.
- Next: live snapshot 6, then validate this rule on more days.
- Health: on track.

## 2026-07-17T14:44Z — unit: stress-tested the winner's rule (session 8)

- Did: tested yesterday's "quote when calm" rule on two more days of data.
- Found: half survived — "stay calm, don't chase" holds everywhere, and "don't get filled right after a dip" holds everywhere; but the longer-horizon direction signal flips day to day and can't be a fixed rule. The strategy spec is updated accordingly.
- Next: live snapshot 6 (due ~15:30 UTC), then wrap the session state.
- Health: on track.

## 2026-07-17T14:40Z — unit: the time-of-day pattern holds (session 8)

- Did: re-checked the "loses during US hours, wins in the evening" pattern on another full day.
- Found: same pattern — US hours were the only losing stretch again; evenings best again. Also: the breakeven bot can lose money all day on our market and still come out ahead on rebates. Rule for our bot: respect the clock.
- Next: live snapshot 6, then session wrap-up.
- Health: on track.

## 2026-07-17T14:50Z — unit: how often the favorite loses (session 8)

- Did: measured how often the leading side flips to losing, by lead size and time left, on 209 markets.
- Found: near-certain favorites (99c+) never flipped once; strong favorites (90-99c) flip 2-4%; close races flip 30-40% even late. The winner bot's lopsided bets just collect the base odds — its skill is avoiding the bad side, not predicting.
- Next: live snapshot 6, then session wrap.
- Health: on track.

## 2026-07-17T14:50Z — unit: how fast pairs complete (session 8)

- Did: measured how long the second half of each $1 pair takes to arrive, across 400+ markets.
- Found: about one minute typically, 99% within five — same for both bot styles. If a position sits unpaired longer than ~5 minutes, it's a bet, not a pending pair — manage it as such.
- Next: live snapshot 6, then final session wrap.
- Health: on track.

## 2026-07-17T14:50Z — unit: everything folded into the lab handbook (session 8)

- Did: condensed today's fifteen findings into the lab's build spec, in implementation order.
- Found: the strategy blueprint is now concrete: quote at the touch with fast re-quotes when calm, pause after sharp moves and during US hours (or switch style), let near-certain positions ride, treat 5-minute-old unpaired legs as bets. Target: $1-3k/day realistic ceiling.
- Next: live snapshot 6, then session state wrap.
- Health: on track.

## 2026-07-17T14:50Z — unit: snapshot 6 + session close (session 8)

- Did: sixth live sample and the session wrap-up; successor queue written.
- Found: today's session answered five open questions and produced the first complete mechanical explanation of WHY the winning bot wins — the strategy spec is now concrete enough to build against.
- Next: successor session: keep live sampling, amend the top bot's dossier (its new 5-minute sleeve is durable), then month-scale volatility-aware measurements.
- Health: on track.

## 2026-07-17T14:52Z — unit 1 (session 9)
- Did: wrote the mid-July btc-5m expansion into the b27bc932 wallet file as a dated era change
- Found: the change is durable (3 windows) but the new sleeve trades at farmer-grade economics, not edge
- Next: month-scale day-session PnL split with a volatility covariate (open question #2)
- Health: on track

## 2026-07-17T15:04Z — unit 2 (session 9)
- Did: month-scale session×vol split on 478 markets (Mar/Jun/Jul), b27bc932.
- Found: evening is the only profitable session now; vol is a red herring; the recipe's margin decayed from +1.9% (Mar) to ~0% (Jun→); the wallet was ALWAYS btc-5m-first — its 15m sleeve just toggles.
- Next: W3 live snapshot (~16:15Z), then OQ #4 (2026-exchange migration).
- Health: on track

## 2026-07-17T15:50Z — unit 1 (session 10)
- Did: finished the stranded scan — dated when Polymarket switched to its new exchange contract, block by block.
- Found: no gradual migration ever happened — after 3.5 weeks of tiny in-house test trades, the venue hard-switched EVERY market at once on Apr 28 ~11:02 UTC; the top bot dropped its merge routine 3 hours later (now explained); the new exchange runs all books, not just crypto.
- Next: live snapshot of the current bots, then check whether the fee-curve change shipped at that same cutover moment.
- Health: on track

## 2026-07-17T15:58Z — unit 2 (session 10)
- Did: seventh live snapshot of the active bots (2-hour window ending 15:52 UTC).
- Found: for the first time NO bot managed to buy pairs under $1 — even the best wallet paid $1.05 during this stormy US afternoon; all kept trading anyway (subsidies + a bad hour). The top bot's 5-minute-market focus held a 4th straight window.
- Next: evening snapshot (~20-21 UTC) to see the under-$1 club re-form; meanwhile, probe whether the fee-curve change shipped at the Apr-28 exchange cutover.
- Health: on track

## 2026-07-17T16:07Z — unit 3 (session 10)
- Did: dated every change of the venue's trading-fee formula on-chain (14 sampled windows, March through July).
- Found: the big fee hike landed Mar 29-31 (with the new exchange's release, NOT at the April cutover, which changed no fees); it launched at a higher rate ($1.80 per 100 shares) than today's ($1.75) — a quiet cut came May 6-10. March's "golden margins" were partly just cheaper fees.
- Next: evening snapshot of the live bots (~20-21 UTC); if time before that, bisect when the top bot's 15-minute sleeve died vs the fee hike.
- Health: on track

## 2026-07-17T16:13Z — unit 4 (session 10)
- Did: dated exactly when the top bot's 15-minute-market module went off and came back, against the fee changes.
- Found: it ran a one-week trial under the raised fees, then shut the module in a single day (Apr 8-9) — and only revived it when the fee-refund tier program arrived in late May. Verdict: 15-minute markets don't pay full fees; they pay for incumbents with refunds. A newcomer must plan maker-heavy completion.
- Next: evening snapshot of the live bots (~20-21 UTC; successor session if this one ends).
- Health: on track

## 2026-07-17T16:20Z — unit 5 (session 10)
- Did: cleared the three remaining small open items (5-minute-series launch date, one unresolved handle, two suspected wallet links).
- Found: the big one — gabagool22's successor account was created 7 MINUTES after his last trade: the famous "quit" was just a wallet swap, the operator kept going for another month. Also: 5-minute markets launched Dec 18 and were fee-free until March, which dates the whole 5m bot wave.
- Next: evening snapshot of the live bots (~20-21 UTC); queue is otherwise clean — successor mines new questions.
- Health: on track

## 2026-07-17T16:24Z — unit 6 (session 10)
- Did: checked every known bot wallet's account-creation time against every other's last trade, hunting more identity swaps.
- Found: a second swap — the November champion registered its successor account 78 minutes before its own final trade. The strategy's top earners boil down to ~3 operators running multiple wallets; famous "quits" were mostly handoffs.
- Next: evening snapshot of the live bots (~20-21 UTC).
- Health: on track

## 2026-07-17T16:26Z — unit 7 (session 10)
- Did: verified today's fee formula is identical on the 15-minute bitcoin book (our target) and on ether books, not just the 5-minute one measured earlier.
- Found: yes — same exact rate everywhere; only the ERA of a measurement matters for fee math, never the book.
- Next: evening snapshot of the live bots (~20-21 UTC).
- Health: on track

## 2026-07-17T16:28Z — unit 8 (session 10)
- Did: checked whether the top bot's July 1 switch to merging positions matched any venue-wide change.
- Found: no — nobody else changed that day (oddly, one other bot STOPPED merging the same day). It's a per-operator bookkeeping choice, not a rule change; our strategy can treat merging as a free design knob.
- Next: evening snapshot of the live bots (~20-21 UTC).
- Health: on track

## 2026-07-17T16:32Z — unit 9 (session 10)
- Did: full profile of the strongest under-the-radar bot (no username, invisible to leaderboard browsing).
- Found: it's now the best live wallet — ~$3.2k/day from a cold start six weeks ago, buying pairs under $1 even during hours everyone else pays over $1; it works exactly like the strategy we plan to build, though on 5-minute markets. Our tracker now watches it.
- Next: evening snapshot (~20-21 UTC) now including the two hidden wallets.
- Health: on track

## 2026-07-17T16:33Z — unit 10 (session 10)
- Did: checked whether the hidden top bot ever traded 15-minute markets in June.
- Found: no — 5-minute markets only, all the way back; it also skipped some days early in its life.
- Next: evening snapshot (~20-21 UTC).
- Health: on track

## 2026-07-17T16:35Z — unit 11 + session wrap (session 10)
- Did: found and logged a data gap — we have NO order-book recordings for 5-minute markets, where today's best bot and most volume live.
- Found: session total: eleven units — dated the exchange switch and every fee change, confirmed two operator identity-swaps, profiled the hidden top bot, and closed every small open question on the list.
- Next: successor session — evening snapshot of the live bots (~20-21 UTC), then the heavier book-data measurements.
- Health: on track

## 2026-07-17T16:57Z — unit 1 (session 11)
- Did: measured WHY the 24/7 bot loses money in US afternoon hours — compared its order placement and what happens after each fill, hour by hour, across three days of order-book data.
- Found: the bot never changes how it quotes; the MARKET changes. Deep bargain fills bounce back in its favor at night and in the evening, but keep falling against it during US hours. Evening edge confirmed on weekdays; one Saturday evening behaved badly — weekends need a check.
- Next: evening live snapshot of the bots (~20-21 UTC); before that, the weekend-vs-weekday check.
- Health: on track

## 2026-07-17T17:06Z — unit 2 (session 11)
- Did: tested whether the "evenings good, US afternoons bad" rule holds on weekends — pulled the top 24/7 bot's full last weekend (574 markets total now split by day type).
- Found: the rule is a WEEKDAY rule. On weekends the pattern scrambles, nothing is reliably profitable, and the bot's trick of leaning toward the likely winner stops working entirely (worse than a coin flip in calm weekend hours). Our future bot should trade weekday evenings first and sit out weekends.
- Next: evening live snapshot of the bots (~20-21 UTC); until then, next queue item (terrain refresh or a new measurable).
- Health: on track

## 2026-07-17T17:08Z — unit 3 (session 11)
- Did: regular 2-hour live check of all tracked bots, now including the two hidden ones.
- Found: the "nobody can buy pairs under $1" moment from the last check was just a storm blip — four bots are back under $1 within ~76 minutes, the hidden 5-minute bot cheapest of all, exactly as predicted.
- Next: one more measurable unit, then the ~20-21 UTC evening snapshot.
- Health: on track

## 2026-07-17T17:14Z — unit 4 (session 11)
- Did: measured yesterday's total flow, fees paid, and rebate money available on every crypto market type, with the exact current fee formula.
- Found: the 5-minute bitcoin market pays out ~$59k/day in maker rebates — almost 9x our target 15-minute book's ~$7k/day — and even the best bot there collects only ~2% of it. But we have zero order-book data for that market (already flagged), so our strategy scope stays on 15-minute.
- Next: evening live snapshot ~20-21 UTC; smaller measurables in between.
- Health: on track

## 2026-07-17T17:29Z — unit 5 (session 11)
- Did: tripled the weekend sample (10 weekend days, 858 markets) to double-check unit 2's "weekends are bad" finding.
- Found: correction — weekends aren't bad, they're just FLAT: mildly profitable around the clock, no good or bad hours. What IS confirmed dead on weekends is the bot's lean-toward-the-winner trick. Unit 2's negative read came from one unlucky weekend; fixed in all files.
- Next: evening live snapshot ~20-21 UTC; extend the weekday sample (now the thin one) if time allows.
- Health: on track

## 2026-07-17T17:35Z — unit 6 (session 11)
- Did: doubled the weekday sample too (6 weekdays, 529 markets) to confirm the weekday pattern with better data.
- Found: it holds — US afternoons are still the only losing hours (milder than first measured), evenings still the best and reliably positive. New detail: calm US afternoons are fine; it's the volatile ones that bleed. The bot's winner-lean trick works on weekdays only, and it softens the US losses rather than causing them.
- Next: evening live snapshot ~20-21 UTC (also the dedicated club re-formation test).
- Health: on track

## 2026-07-17T17:41Z — unit 7 (session 11)
- Did: tried the planned order-book study of the hidden top bot's early days (the only week where book recordings exist).
- Found: dead end, now proven — the bot traded ONLY 5-minute markets even back then, and we have no 5-minute book recordings (known gap). Its exact order placement stays unknowable until someone records those books; noted for the ops team.
- Next: live snapshot ~18:30-19 UTC, then the 20-21 UTC evening one.
- Health: on track

## 2026-07-17T17:45Z — unit 8 (session 11)
- Did: checked the weekend order-book data the same way as the weekday data from unit 1.
- Found: weekends have no good-hours/bad-hours pattern in the books either — matches the money numbers. Also found our data supplier's recorder was off on weekend nights in June (all such files empty), so those hours are simply unknowable.
- Next: live snapshot around 18:30-19 UTC, then the 20-21 UTC evening test.
- Health: on track

## 2026-07-17T17:58Z — unit 9 (session 11)
- Did: full profile of the second hidden bot (the one nobody can see on the leaderboard).
- Found: it's a pure rebate farmer, born the exact week the rebate program started paying daily: it deliberately LOSES ~$630/day trading tiny orders across hundreds of markets and collects ~$1,240/day in maker rebates — netting ~$600/day. Proof our target 15-minute book alone can't support this income style; it needs breadth across all books.
- Next: live snapshot ~18:30-19 UTC, then the 20-21 UTC evening test.
- Health: on track

## 2026-07-17T17:49Z — unit 10 (session 11)
- Did: folded everything this session learned into the two handoff files the strategy lab will read.
- Found: nothing new — bookkeeping unit. The build spec now says: run weekday evenings first, skip volatile US afternoons, disable the winner-lean on weekends, and plan income from trading margin (the 15-minute book's rebate pot is too small to farm).
- Next: live snapshot ~18:30-19 UTC, then the 20-21 UTC evening test.
- Health: on track

## 2026-07-17T17:50Z — unit 11 (session 11)
- Did: one-week progress check on the newest bot (started July 10 from zero).
- Found: it paid ~2 days of "tuition" losses, then made $3.3k trading in a week plus ~$1.2k/DAY in rebates already. All three young bots avoid taker fees entirely — the proven way in for a newcomer like ours.
- Next: live snapshot ~18:30-19 UTC, then the 20-21 UTC evening test.
- Health: on track

## 2026-07-17T17:53Z — unit 12 (session 11)
- Did: double-checked the "US afternoons are toxic for deep bargain orders" finding against a second bot with a different order style.
- Found: the second bot did NOT suffer there — but it trades too thinly for a firm answer. Honest status: the toxicity finding holds for the main bot, may depend on order depth; flagged for the lab to test rather than assume.
- Next: live snapshot now-ish (~18:30 target), evening test 20-21 UTC.
- Health: on track

## 2026-07-17T17:57Z — unit 13 (session 11)
- Did: broke the "deep bargain orders" finding down by exact order depth, across afternoon and evening hours.
- Found: the week's best practical rule — deep discount orders are an EVENING tool (the deeper, the better there, up to +3 cents of favorable follow-through); in US afternoons no depth is safe. Our future bot should place its deep ladder in weekday evenings only.
- Next: live snapshot ~18:30 UTC, evening test 20-21 UTC.
- Health: on track

## 2026-07-17T18:02Z — unit 14 (session 11)
- Did: re-tested yesterday's "deep orders are an evening tool" rule on a second weekday and a Saturday.
- Found: confirmed on the weekday (best zone: 3-5 cents below the best bid); Saturday evenings show nothing, as expected. The rule is ready for the strategy spec.
- Next: live snapshot ~18:30 UTC, evening test 20-21 UTC.
- Health: on track

## 2026-07-17T18:06Z — unit 15 (session 11)
- Did: finished the depth-by-hour measurement matrix and ran the regular live check.
- Found: watching it live: bots' pair prices have been dropping steadily since the afternoon storm (over $1 → 0.96-0.98 now) — the "evenings are best" rule playing out in real time, an hour before evening even starts.
- Next: the dedicated 20-21 UTC evening snapshot; queue then re-mines open questions.
- Health: on track

## 2026-07-17T18:10Z — unit 16 (session 11)
- Did: checked whether the big incumbent bot's ether-market push (seen in the last snapshot) was something new.
- Found: no — it's been ~6-11% of its flow all along; false alarm, but we now have its full daily allocation baseline on record.
- Next: the 20-21 UTC evening snapshot; then re-mine open questions.
- Health: on track

## 2026-07-17T18:06Z — unit 17 (session 11)
- Did: extended the order-depth study to two more bots, including the one that actually WINS US afternoons.
- Found: the cleanest rule of the whole shift — orders 3-5 cents below the market are poison in US afternoons for EVERY bot (even the US winner, who succeeds by staying shallow) and gold on weekday evenings. Our bot's ladder should be shallow always, deep only on weekday evenings.
- Next: 20-21 UTC evening snapshot; then re-mine open questions.
- Health: on track

## 2026-07-17T18:10Z — unit 18 (session 11)
- Did: wrote the week's findings into the build spec and rebuilt the open-questions list (the old one was fully answered).
- Found: nothing new — bookkeeping. Top open items now: is the weekend decay real (tomorrow's data decides), and does the new depth rule hold across more days.
- Next: 20-21 UTC evening snapshot; successor picks up the new question list.
- Health: on track

## 2026-07-17T18:12Z — unit 19 (session 11)
- Did: stress-tested yesterday's shiny "deep orders by hour" rule on the one remaining day of order-book data.
- Found: the rule broke — that day showed the opposite pattern, and the earlier multi-bot "confirmation" turned out to be several bots seeing the SAME day, not independent proof. Downgraded from rule to hint in all files. The solid findings (evenings best, weekends flat, ladder never changes) are money-based and stand.
- Next: 20-21 UTC evening snapshot; successor continues from a clean question list.
- Health: on track

## 2026-07-17T18:14Z — unit 20 (session 11)
- Did: tried a March-era study of the biggest live bot and discovered it didn't exist yet — dug up its actual birth date instead.
- Found: today's #1 bot pair started from ZERO on April 30 — two days after the exchange switch — and made $1.15M in 11 weeks. Every live bot was born after the fees came in; no old-guard survivors at all. Great news for us: newcomers can win, and fast.
- Next: 20-21 UTC evening snapshot; successor mines the fresh question list.
- Health: on track
