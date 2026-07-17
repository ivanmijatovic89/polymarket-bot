# Operator Feed

Append-only. One entry per completed unit. Newest at the bottom.

---

## 2026-07-17T03:17Z — unit 1
- Did: bootstrapped the lab (STATE, JOURNAL, DECISIONS, this feed); verified branch + write-guard work.
- Found: nothing new — first session, clean start.
- Next: Phase 0 — digest the knowledge base + quarries, verify engine facts in code.
- Health: on track

## 2026-07-17T04:20Z — unit 2
- Did: finished all Phase 0 reading (knowledge base, fable-lab, old protocol, root docs) + verified engine facts in code; wrote INHERITANCE.md.
- Found: the edge is real and measurable NOW (b55f +2.31% after fees on btc-15m); the sim shows only the worst half of maker fills, so the lab will judge on rankings, corrected fees, rebate line, and time slices — not raw EV alone. June 1–14 data reserved as untouched holdout.
- Next: write the lab's rulebook — EPISTEMOLOGY.md + EVALUATION.md (frozen scoring rule).
- Health: on track

## 2026-07-17T04:50Z — unit 3
- Did: wrote and froze the lab rulebook — EPISTEMOLOGY.md (how experiments are proposed, frozen, judged) + EVALUATION.md (the scoring rule: time-sliced stability, tails, latency stress, subsidy split).
- Found: nothing new — design unit; the scoring rule is now frozen BEFORE any run, as the charter requires.
- Next: build the two tools (submit + results reader), then the end-to-end smoke.
- Health: on track

## 2026-07-17T05:02Z — unit 4
- Did: built and tested the lab tools — guarded run launcher, results readout (with fee correction, rebate line, weekly slices, validators), run lister.
- Found: readout verified against an existing run in the database; all guards fire correctly (holdout protection, latency pinning).
- Next: end-to-end smoke — a scripted test strategy through backtest → database → readout.
- Health: on track

## 2026-07-17T05:32Z — unit 5
- Did: end-to-end smoke passed twice with identical results — strategy → backtest → database → readout all verified; found an exact per-fill data channel needing no engine changes.
- Found: every plumbing check green (settlement math exact, fee validation passes, deterministic replay). The lab is built — L0 done.
- Next: L1 baseline — the first real measurement: archetype-style parity ladder over the search window with time slices + latency stress.
- Health: on track

## 2026-07-17T07:15Z — unit 6 (in progress)
- Did: baseline battery running (4 latency arms, first 1,000 markets each); built the L2 workhorse strategy (all sweep knobs on one file) and safe run-extension tooling.
- Found: first mechanism discovery — under latency, frequent requoting turns resting bids into fee-paying taker fills at scale (fills 9× at 500ms, EL −0.64 → −5.04/market). Standing ladders look like the counter; promoted to a first-class experiment axis.
- Next: extend arms to the full Apr–May window, judge the baseline, freeze tail thresholds.
- Health: on track

## 2026-07-17T08:00Z — unit 6 checkpoint
- Did: four full-window baseline arms running (5,856 markets × latencies 0/140/500/1000; ~3h); extension dead-end documented and routed around without touching frozen code.
- Found: rebate income at test sizing is below the venue's $1/market payout floor (raw $0.25/market) — clearing it needs ~4× the fill mass; noted for candidate sizing.
- Next: when arms land — full baseline judgment (weekly slices, tails, latency curve) + freeze tail thresholds.
- Health: on track

## 2026-07-17T04:45Z — unit 7 (session 2 start)
- Did: found the backtest worker dead (killed with session 1); relaunched it so it now survives session ends; added a queue-status tool; folded new KB findings.
- Found: no jobs lost — ~19k remaining drain at ~6/s, results expected ~05:30Z. KB: the one "big loser" in this strategy family lost on World Cup markets, not on crypto up/down — no known blow-up in this niche.
- Next: when the four baseline runs land — full judgment (weekly slices, tails, latency curve) + freeze thresholds.
- Health: on track

## 2026-07-17T05:02Z — unit 8
- Did: proved the whole judgment readout on the preview runs; added the per-market export needed to set tail thresholds; wrote down HOW thresholds will be derived before seeing the final numbers.
- Found: preview confirms across all four latencies: delay itself creates bad fills (2.8k fills at 0ms -> 27.6k at 1000ms, half of them forced conversions). Requote discipline is the lever to attack next.
- Next: runs finish draining ~06:20Z; then the full baseline verdict + threshold freeze.
- Health: on track

## 2026-07-17T05:45Z — unit 9
- Did: found and fixed two bugs in the next strategy's "complete the pair by paying up" path (a missed order could jam it for the whole market and linger into the risky final minute); verified with a clean 2-market smoke.
- Found: my own process rule proved its worth — I bypassed the lab's launcher once for a quick test and it silently queued a job into the shared pipeline instead of running locally; cleaned up, no data lost, rule now absolute.
- Next: baseline runs finish draining (~06:30Z); then the full verdict + threshold freeze.
- Health: on track

## 2026-07-17T05:57Z — unit 10
- Did: built and tested the tool that turns the baseline's loss-tail into the frozen pass/fail thresholds for all future candidates.
- Found: preview shape — a worst-case market burns ~37% of the money a typical market puts to work; thresholds will demand ~$0.50–1.00/market edge to justify that tail.
- Next: baseline drain continues (~12.4k jobs left); freeze thresholds when it lands.
- Health: on track

## 2026-07-17T06:22Z — unit 11
- Did: wrote the exact launch plan for the first parameter sweep (parity tolerance, 10 runs) and proved the strategy code gives byte-identical results on identical input — three times over.
- Found: nothing new economically; the baseline drain is slower than hoped (~2h left of ~6h total).
- Next: baseline verdict + threshold freeze when runs land (this session if it lasts, else successor resumes from STATE).
- Health: on track

## 2026-07-17T04:58Z — unit 13
- Did: session-3 pickup — overnight machinery healthy; read the finished zero-latency baseline arm (5,856 markets); folded 5 new knowledge-base findings.
- Found: with zero latency the baseline loses $0.42/market, every week negative, and barely pairs (29%) — while a newly discovered live wallet (the only one profitable on pure trading today) pairs 78% by quoting 2–3 cents deeper. Deep pairs go on the experiment list.
- Next: last three latency arms finish ~05:10Z; then the full baseline verdict + threshold freeze.
- Health: on track

## 2026-07-17T05:38Z — unit 14
- Did: judged the full baseline (4 latency arms × 5,856 markets); froze the tail + capital thresholds (EVALUATION v1.1).
- Found: baseline loses everywhere — $0.42/market at zero latency, $4.39 at realistic 140ms; the requote loop turns 34–55% of fills into fee-paying taker trades under latency, and shallow quotes almost never complete a pair. Region closed with numbers; this is the reference every variant must beat.
- Next: launch E003 (10 runs probing how strictly the two sides must stay balanced).
- Health: on track

## 2026-07-17T05:48Z — unit 14a
- Did: found and removed a stray empty DONE file (the mission-end marker) that something OUTSIDE this session created and then deleted; added a commit guard so it cannot slip in again before the real finish.
- Found: not created by me or my tools — if YOU created it to end the mission, say so in OPERATOR-FEED or a non-empty DONE; I treated the empty flicker as an accident.
- Next: launch E003 (the two-sided balance experiment, 10 runs).
- Health: on track

## 2026-07-17T06:08Z — unit 15
- Did: launched E003 — 10 runs asking how tightly the two sides must stay balanced (0.1% to 40% tolerance), April vs May halves; accidentally submitted everything twice, removed the 9 removable duplicates, hardened the launcher so it can't happen again.
- Found: one junk run row (679, labeled failed, ignore); the 10 real runs are draining, first results in ~1 hour.
- Next: judge E003 when drained (does parity tolerance matter, and does April agree with May).
- Health: on track

## 2026-07-17T05:34Z — units 16+17 (BACKFILLED by session 4 — session 3 skipped these entries; times are real commit times)
- Did: while E003 drained: started LESSONS.md, built the tool that renders E003's verdict table mechanically, re-smoked E004's completion code (green), drafted the E005 proposal, and wrote down how E003's curve will be read BEFORE seeing results.
- Found: the tightest E003 arm reproduces E002's baseline week-by-week to 4 decimals from an independently written strategy file — the comparison is apples-to-apples by construction.
- Next: judge E003 when the queue drains.
- Health: on track (this backfill itself: session 3 missed 4 feed entries — repaired, rule re-pinned in STATE)

## 2026-07-17T05:55Z — unit 18
- Did: session-4 pickup: re-armed the drain watcher, re-checked the new data feeds (still not landed), folded the KB's new capital + market-size measurements, repaired the missing feed entries above.
- Found: the venue's BTC-15m book has shrunk ~9x since January ($3.2M→$0.35M/day); the strongest live wallet runs its whole 15m operation on $4–8k of capital. Context for sizing/capacity — no strategy change.
- Next: E003 judgment when the queue drains (~30–60 min); then E004 freeze.
- Health: on track

## 2026-07-17T05:51Z — unit 19
- Did: pre-wrote E004's rules (what counts as success, how the verdict is read) BEFORE E003's numbers exist, and built its hardened launch script; smoked the refusal paths.
- Found: E004 can skip re-running its control arm — the identical run already exists in E003 (determinism proven), saving ~40 min of compute. Also: I caught myself estimating timestamps again (+9 min); now stamped mechanically.
- Next: E003 judgment when the queue drains (~07:15–08:15Z); then E004 freeze is a 5-minute fill-in.
- Health: on track

## 2026-07-17T05:56Z — unit 20
- Did: session 5 pickup; re-armed both drain watchers (one wakes me, one survives me); verified worker + queue health.
- Found: E003 half done, draining at ~380 jobs/min, 0 failures — results land ~06:34Z.
- Next: E003 judgment (parity axis verdict) the moment the queue drains.
- Health: on track

## 2026-07-17T06:01Z — unit 21
- Did: session 6 pickup — E003 batch ~57% done (0 failures), completion watcher re-armed for this session, judgment rules re-loaded.
- Found: nothing new — batch on pace to finish ~06:24Z; 3 of 9 result sets already saved.
- Next: safety re-test of the "complete the pair" code path while the batch finishes; then E003 judgment.
- Health: on track

## 2026-07-17T06:06Z — unit 22
- Did: found the planned safety re-test was already done in session 3 (my to-do list was stale); double-checked that result against the database and test-fired the E004 launch script (print-only).
- Found: the pair-completion code path is verified working; E004 can launch minutes after E003's verdict.
- Next: E003 verdict when the batch finishes (~06:25Z); then E004 launch.
- Health: on track

## 2026-07-17T06:11Z — unit 23
- Did: session 7 pickup; drain watcher re-armed for this session; judgment rules re-loaded.
- Found: E003 backtests ~73% done, zero failures, 6 of 9 result sets already saved; on pace for ~06:26Z.
- Next: judge the E003 parity-tolerance axis the moment the queue drains, then launch E004.
- Health: on track

## 2026-07-17T06:14Z — unit 24
- Did: session-8 pickup; drain watcher re-armed; judgment checklist reloaded.
- Found: E003 ~79% done (ETA ~06:27Z), 0 failures, 6/9 result sets already in DB.
- Next: judge E003 parity axis the moment the last runs land.
- Health: on track

## 2026-07-17T06:19Z — unit 25
- Did: session-9 pickup; drain watcher re-armed; judgment kit reloaded.
- Found: E003 ~86% done (ETA ~06:28Z), 0 failures, 7 of 9 pending result sets now in DB.
- Next: judge E003 parity axis the moment the last runs land.
- Health: on track

## 2026-07-17T06:23Z — unit 26
- Did: session 10 pickup — re-armed the drain watcher, re-loaded the judgment materials.
- Found: E003 ~93% done (ETA ~06:27Z), 0 failed jobs, 8/9 result flows already saved. Nothing new.
- Next: judge the E003 parity-tolerance axis the moment the queue finishes.
- Health: on track

## 2026-07-17T06:33Z — unit 27
- Did: judged E003 (parity-tolerance axis, 10 runs, Apr+May, all validators green).
- Found: tighter parity is strictly better in both months, but even the best setting only matches the baseline (−4.39/market) — the knob limits damage, it cannot create profit. Loose settings lose up to $1/market more with deeper worst-cases. Axis closed.
- Next: freeze and launch E004 (completion policy — when to pay to finish a pair) at the winning parity setting.
- Health: on track

## 2026-07-17T06:36Z — unit 28
- Did: froze and launched E004 (completion policy: when to pay to finish a lopsided pair) — 6 runs over Apr+May at the E003-winning parity setting.
- Found: nothing new yet — runs queued clean (~17.5k jobs, ETA ~07:16Z), no double-submit, watchers armed.
- Next: prep E005 (ladder depth) spec while E004 drains; judge E004 when done.
- Health: on track

## 2026-07-17T06:42Z — unit 29
- Did: finalized the E005 (ladder depth) experiment spec while E004 runs — checked every planned arm against the code so no two arms secretly test the same thing (E003 wasted 2 of 5 arms that way).
- Found: the "force cheaper pairs" sub-experiment needed a smarter grid rule — the price caps only matter if fills actually land near them, so the final grid is chosen by a rule written down today, before any results exist.
- Next: judge E004 when it finishes (~07:09Z), then launch E005.
- Health: on track

## 2026-07-17T06:47Z — unit 30
- Did: built + verified the E004 judgment tool (it can now read the completion-policy runs, including what the "pay to finish pairs" crosses actually cost).
- Found: tool reproduces all known numbers exactly; side note — the current design's average completed pair already costs ~$0.97, right in the region where the profitable live wallets operate.
- Next: E005 launcher prep, then judge E004 when the runs finish (~07:09Z).
- Health: on track

## 2026-07-17T06:50Z — unit 31
- Did: prepared the E005 (ladder depth) launch — 3 new ladder shapes over Apr+May; the 4th (current shape) reuses existing runs, saving ~12k compute jobs.
- Found: nothing new — two safety guards correctly rejected a bad arm code and an uncommitted launcher during rehearsal.
- Next: verify the launcher, judge E004 (~07:14Z), then launch E005.
- Health: on track

## 2026-07-17T06:55Z — unit 32
- Did: new session picked up cleanly; re-checked the knowledge base and main branch (nothing new to fold in), pre-loaded the E004 judgment procedure while runs finish.
- Found: nothing new — runs on pace, ~19 min to done.
- Next: judge E004 (completion policy) the moment runs finish, then launch E005 (ladder depth).
- Health: on track

## 2026-07-17T07:28Z — unit 33
- Did: judged E004 (completion policy) — 6 runs + control, all checks green.
- Found: crossing to complete pairs whenever a leg lags CUTS the loss by ~$1/mkt (−4.39 → −3.41, best cell yet); price-capped crossing does nothing. Still loses money overall.
- Next: launch E005 (ladder depth/shape arms), the axis aimed at where profitable wallets live.
- Health: on track

## 2026-07-17T07:33Z — unit 34
- Did: froze and launched E005 (ladder depth/shape) — 6 runs, ~17.6k jobs, draining ~35 min.
- Found: nothing new yet (launch unit); E004's free-completion finding is banked.
- Next: judge E005 shapes on drain, then decide the cap grid from the winner's pair-cost distribution.
- Health: on track

## 2026-07-17T07:38Z — unit 35
- Did: built + verified the E005 readout tool while the queue drains (blind to results).
- Found: nothing new (tooling unit); reference numbers reproduce exactly.
- Next: judge E005 shapes when the queue drains (~08:10Z), then the cap-grid decision.
- Health: on track

## 2026-07-17T08:22Z — unit 36
- Did: judged E005 shapes (6 runs + reference) and launched the cap arms on the winner (6 more runs, draining ~40 min).
- Found: deep quoting is the strongest lever yet — loss drops from −4.39 to −2.36/−2.71 per market (maker-only, best tails, half the capital); the copied 4-rung wallet ladder shape does NOT explain the incumbent's profit. First experiment to pass its pre-set stability rule.
- Next: judge the pair-cost-cap arms when drained (~09:00Z), then time-weighting (E006).
- Health: on track

## 2026-07-17T08:26Z — unit 37
- Did: extended the readout tool for the running cap experiment (blind, verified on known runs).
- Found: nothing new (tooling unit).
- Next: judge the cap arms when the queue drains (~09:00Z).
- Health: on track

## 2026-07-17T09:08Z — unit 38
- Did: judged the pair-cost-cap arms; E005 (depth axis) is now fully closed.
- Found: tighter buying discipline monotonically cuts the loss — best cell now −2.02 to −2.29/market (was −4.39 at baseline; half the bleed removed, maker-only, half the capital). Optimum may be even tighter — follow-up seeded.
- Next: latency stress test (0/500/1000 ms) on the winning cell — required before this can become a candidate.
- Health: on track

## 2026-07-17T09:13Z — unit 39
- Did: launched the latency stress test on the best cell (6 runs; 0/500/1000 ms vs the existing 140 ms).
- Found: nothing new yet (launch unit); plan and pass/fail reading were written down before launching.
- Next: judge the stress test when the queue drains (~09:52Z) — it decides whether depth's gains are real structure or a latency artifact.
- Health: on track

## 2026-07-17T09:15Z — unit 40 (backfilled next commit — same-commit rule missed)
- Did: verified the stress-test readout path on old runs and wrote down, in advance, how each possible outcome will be acted on.
- Found: nothing new (prep unit).
- Next: judge the stress test on drain (~09:52Z).
- Health: on track

## 2026-07-17T10:27Z — unit 41
- Did: recovered the stress test's one stalled market; my first retry command was wrong and briefly queued 9k unwanted jobs — caught before any data was touched, cleaned up fully, lesson written (LS-10).
- Found: all 6 stress-test runs are now complete and verified intact.
- Next: judge the stress test (the numbers are all in).
- Health: on track (near-miss handled inside the unit; no data corrupted)

## 2026-07-17T10:31Z — unit 42
- Did: judged the latency stress test on the best cell (all checks green).
- Found: the deep design stays ~2x better than baseline at EVERY latency — but at zero latency it barely trades and loses ~nothing, so nearly ALL of today's loss comes from quotes getting run over while updates are in flight. The next lever is obvious and measured: stop re-quoting so much.
- Next: draft + launch the quote-stability experiment (how rarely can the ladder re-quote?).
- Health: on track

## 2026-07-17T10:36Z — unit 43
- Did: wrote the quote-stability experiment plan (how rarely can the ladder re-quote before it stops trading?).
- Found: nothing new (proposal unit); prediction written down before any data.
- Next: build the launcher + readout, then launch (~8 runs, ~55 min drain).
- Health: on track

## 2026-07-17T10:35Z — unit 44
- Did: launched the quote-stability experiment (8 runs, draining ~50 min).
- Found: nothing new yet (launch unit).
- Next: extend the readout tool (blind), then judge on drain (~11:26Z).
- Health: on track

## 2026-07-17T10:37Z — unit 45
- Did: extended the readout tool for the running experiment (blind, verified).
- Found: nothing new (tooling unit).
- Next: judge quote-stability on drain (~11:26Z).
- Health: on track

## 2026-07-17T12:01Z — unit 46
- Did: session 13 pickup; 4 of 8 quote-stability runs finished early — verified all four (ids exact, checks green).
- Found: early numbers look flat-to-worse vs the 0.02 reference (q05 h2 −2.59 vs −2.02) — "quote stability recovers the loss" is in trouble; verdict on the full table.
- Next: judge the axis when the last 4 runs land (~12:35Z; drain slowed — your tmux markets worker died, my worker carries on).
- Health: on track

## 2026-07-17T12:05Z — unit 47
- Did: verified the 5th of 8 E006 runs the moment it landed (all checks green); waiter now watching the last 3.
- Found: 5 of 5 runs so far LOSE more than the reference — making quotes stickier removes the panic-trades but the losses just shift to getting picked off on stale prices. Verdict waits for the full table (~12:35Z).
- Next: verify last 3 runs, build the 8-run table, judge E006 by the frozen criteria.
- Health: on track
