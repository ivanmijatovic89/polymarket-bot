# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 3, complete)

## Current work

Session 3 delivered (all evidence from this session's tool runs; three
pre-registered experiments, three kills, one class-level law):

1. **E-012 — contested-start axis KILLED at Phase 0** (no strategy code
   ever written). New tool `tools/contested.ts`: per-start |spot−ptb| and
   60s-drift at fill time vs doom, runs 872+873 + last-start-only view —
   doom rate flat everywhere, market-level correlation INVERTED. Doom is
   unpredictable from start-time market state. pair-v3.md.
2. **E-013 — cadence-param axis KILLED**: runs 881/882/883 (ttl 61, cd 5 at
   3 gates, design-ts f938160) — S/played moved <1% ⇒ start rate is
   FILL-LIMITED (crossings are market-given). pair-v1.md §Cadence
   extension, incl. the exact family algebra (S* = q(1+avgE/g_sh);
   incrementSize provably cancels — that idea killed with zero runs).
3. **E-014 — pair-v4 (both-sides start quoting, new code pair.v4.ts,
   design-ts 28f1f8b) KILLED, and with it the mechanism class**: runs
   885/886/887 — q co-inflates with S (0.98: S ×1.41, q ×1.50), ev worse
   at every gate. Six-run cross-section ⇒ **per-start invariant: per-start
   EV ≈ −0.06/share at every gate/cadence/mechanism** — top-of-book maker
   pair accumulation is structurally unprofitable at 140ms under
   worst-queue (time-scoped 2026-07). pair-v4.md §per-start invariant.
4. P-009 filed (live benign-fill-share measurement — worst-queue grants
   only trade-through fills, the maximally adverse subset; only live data
   can bound that bias; needs human/real orders).
5. INDEX.md digest updated; runs 880/884 smokes PASS; all screens on
   identical 800-market universes (common=800 in every compare).

## Next step (session 4)

Guard 4 satisfied — leave the mechanism class, stay inside RULES (buy-only,
no sells, no backtest merges). Two candidate families, Phase-0 DATA SCANS
FIRST (no strategy code until the moment frequency/economics are measured):

1. **Taker pair-arb**: how often does askUp+askDown+takerFees < 1 hold in
   recorded books, for how long, at what depth? Riskless pair if takeable
   within latency. Scan recorded/telonex book states (needs a book-replay
   scan tool — check capabilities/simulator.md + parquet replay helpers
   before building; budget one session for tool+scan+verdict).
2. **Maker-leg + immediate taker-completion**: place ONE maker bid; on
   fill, complete the pair instantly as taker iff fillPrice + ask(other) +
   fee ≤ gate, else... (residue never held to settlement — the doom loss
   mode becomes "expensive completed pairs" + rare abort cost). Phase-0:
   from recorded books, distribution of other-side ask at +140ms after
   trade-through moments; break-even gate math with the 700bps taker curve
   on the completion leg.
3. If both Phase-0s die: the protocol's honest position is that BTC-15m
   top-of-book buy-only pair mechanics are exhausted at 140ms under the
   binding sim; escalate via PROPOSALS (P-009 live measurement, or a human
   ruling on widening the strategy space/timeframes/symbols) — but only
   after the scans, not before.
4. Session 5 is the mission's every-fifth self-check — audit against goal
   1 (profitable variant ASAP) and the M1–M5 gate list (still pending,
   still not urgent: no promotion candidate exists).

## Blockers

None. No in-flight fleet runs — 880–887 all completed and evaluated.

## Needs human

Nothing blocking. New non-blocking proposal: P-009 (live benign-fill-share
measurement — would tell us whether the −0.06/share class verdict is a sim
floor or a market fact). Carried: P-002/P-003/P-005/P-006/P-007 proposed.

## Standing session guards

- Never end a session waiting on an in-flight fleet run — record ids here,
  return `continue` (A4/A6).
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: origin/main advanced only by our own protocols/ commits —
  verified in compare SHA-warning check, no src/ diffs 6a1ecde→28f1f8b).
- Queue submissions require a CLEAN tree: commit+push BEFORE launching.
- m7 remainder pending: pnl decomposition column on next results.ts touch.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes); all this session's compares used
  identical universes (common=800).

## Inbox processed through

2026-07-30T23:20:47.483Z-0e6fde8b (no new entries this session).
