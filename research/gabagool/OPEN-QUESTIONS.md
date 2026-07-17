# OPEN-QUESTIONS (living)

Ranked by information value per unit effort. Session 1 state.

1. **D2 — passive-fill reality gap** (charter priority): join gabagool22
   fills (have: Feb tail; pull Dec sample slugs as needed) with Telonex
   tick data for the same markets; compute % of his fills admitted by the
   worst_queue rule (bestAsk < fill price after fill time) and by
   touch-or-better. THE sim-credibility number; decides H1's test path
   (sim vs live-paper). Needs: DB access to `telonex_markets` +
   converted parquet for his active-window slugs (Telonex coverage
   starts ~2025-11-29; note pre-2026-01-19 gaps, P36).
2. **H3 decomposition for 2-3 more actives** (powerwinner, 0xaaaaa,
   badfallen): trading vs maker-rebate vs taker-rebate; per-book margins
   (also answers H5). ~30 min each with existing scripts.
3. **January transition curve**: pull Jan 10–14 gabagool sample (fee era,
   pre-decay?) — how fast did pair costs compress from 0.98 to ≥1.00?
   Dates the competitive response speed; informs how long any new edge
   lasts (decay prior for the lab).
4. **Jan-era true fee rate** (contested 2× discrepancy): archive the
   developer docs fees page Jan snapshots; also resolves whether a
   mid-Feb fee/rebate cut triggered the archetype's exit.
5. **Level offsets vs top-of-book at fill time** (D2 byproduct): were his
   bids AT touch or improving? Sets H1's ladder parameters.
6. **Maker/taker role split for the incumbent**: on-chain OrderFilled
   (maker/taker fields) for a day of b55f trades; halves of his flow
   behave differently (maker accumulation vs taker completion at 50%
   fee refund).
7. **P19's "$8M/day" wallet**: still unmatched (largest 30d volume seen:
   bonereaper $663k/day). Either the figure is wrong or the wallet is
   unlisted — check volume leaderboard top-50 for crypto-updown-only
   wallets.
8. **Rebate estimator feasibility** (G4): can `20% × Σ fee-curve(own
   maker fills) × pool-share` be computed with a defensible pool-share
   assumption (e.g., from market total volume × taker share)? Needed to
   judge H1 in sim at all.
9. **Resolution mechanics** (Game J): source/precision/timing — one
   evening on official rules; matters for endgame quoting bounds.
10. **Tick-size rule confirmation** (0.001 outside [0.04, 0.96]?) + min
    order size + rate limits from CLOB docs.
11. **drfc4eybh7i8 address** (weak resolution): re-resolve via profile
    JSON; then dossier if gabagool-style.
12. **Remaining wallet dossiers** (bonereaper — biggest all-time at
    $1.19M and possibly a different mechanism at 0.21% margin;
    powerwinner at $122.8k/30d — currently the hottest).
