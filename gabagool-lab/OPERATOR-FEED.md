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
