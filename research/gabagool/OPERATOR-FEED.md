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
