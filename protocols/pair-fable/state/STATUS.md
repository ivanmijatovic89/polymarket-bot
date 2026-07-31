# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 2)

## Current work

Session 2 delivered (all evidence from this session's tool runs):

1. **New tool `tools/anatomy.ts`**: exact pnl decomposition (paired vs
   residue, recon err ≤0.01, 0 bad rows), S/R fill-mode stats, bounded
   taker attribution, doom-hazard-by-start-minute. Anatomy of 872/873/874
   recorded in pair-v1.md §Anatomy.
2. **Root cause quantified**: v1's loss is entirely unpaired residue —
   344/345 residue markets lose ~$4.4 each (held to ~0); pairs earn only
   +$0.54/played market vs doom −$2.15. Repair rate 80% vs ~94% break-even.
   Doom hazard flat across start minutes (start-delay variant killed
   pre-launch). Taker fees minor in pnl ($68 of −$1202) — S3/parity
   concern only.
3. **pair-v2 family (repair persistence) built, frozen (0f0f423 =
   design-ts 2026-07-31T00:06:47Z), screened, KILLED**: chase-to-breakeven
   + no repair cooldown + ask−2G guard is INDISTINGUISHABLE from v1 at
   both gate levels (Δev −0.027 / +0.036, threshold 0.05; runs 876/877 vs
   872/873). Mechanism finding: doom savings are repaid exactly in pair
   margin — efficient pricing; completing above the gate recovers nothing.
   Taker guard ineffective (~15% persists). Details: pair-v2.md.
4. **v1 gate curve completed (runs 878/879 + prior 872/873): interior-
   optimum hypothesis REFUTED.** ev monotone in gate (0.98 −1.50 → 0.93
   −0.55) but p/100 flat −8.0..−9.2 per $100 in every config — the whole
   curve is volume shrink (E-004 writ large). Doom rate gate-invariant
   (~50%). Gate tuning is not a path to profit. Details: pair-v1.md.
5. M4 note: cross-run SHA warning (6a1ecde/0f0f423/b70b3ea) verified
   benign — diffs touch only protocols/ files, no engine code.

**Axis verdict: HOW to complete pairs is exhausted (entries=v1, repair=v2,
gate=curve — per-dollar loss constant). The live axis is WHEN to start.**

## Next step (session 3)

1. **Validate the contested-window hypothesis from data BEFORE building
   pair-v3**: take 872's ~345 doomed-market slugs (anatomy.ts gives them)
   and measure early-window |spot − priceToBeat| (and/or drift over the
   first minutes) from the local datasets (binance aggTrades day files /
   telonex crypto_prices; see docs/datasets/price-feeds/*). Hypothesis to
   test: dooms concentrate in windows that decide early (spot runs from
   priceToBeat); contested windows complete pairs. If the separation is
   weak ⇒ kill v3 before writing strategy code.
2. If validated: design pair-v3 = v1 + contested start gate using the
   backtest-fulfilled feeds (`binanceWsSpotPrice` + `polymarketPriceToBeat`
   — CLAUDE.md documents both replay-supported; read
   memory/capabilities/parity.md §feeds + plugin ExternalFeedsRequestPlugin
   first). New param (contested threshold) must earn its slot per guard 2.
   Pre-register grid, freeze, smoke, screen vs 874 (baseline valid ≤
   2026-08-06; universe drifts — compare via intersection).
3. Guard-4 watch: pair family is at 6 configs without a per-dollar
   improvement; stopping rule triggers at ≥20 — the axis switch in (1)/(2)
   is the required "different idea axis".

## Blockers

None. Fleet healthy (workers self-updated to 0f0f423 during screens). No
in-flight fleet runs — 875–879 all completed and evaluated.

## Needs human

Nothing new this session. Carried from Mission 01 (non-blocking): P-004
accepted; P-002/P-003/P-005/P-006/P-007 remain `proposed` — engine-side,
human's call.

## Standing session guards

- Never end a session waiting on an in-flight fleet run — record ids here,
  return `continue` (A4/A6).
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: none — origin/main only advanced by our own protocol
  commits; verified no src/ diffs).
- Queue submissions require a CLEAN tree (dirty guard refused 3 launches
  this session): commit+push state/memory edits BEFORE launching, or batch
  launches before editing files.
- m7 remainder still pending: pnl decomposition column on the NEXT
  results.ts touch (anatomy.ts covers the analysis need meanwhile).
- Self-check session: session 5 (every fifth).

## Inbox processed through

2026-07-30T23:20:47.483Z-0e6fde8b (no new entries this session).
