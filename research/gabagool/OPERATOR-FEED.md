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
