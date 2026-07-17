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
