# The btc-15m sleeve toggle vs venue fee events (A53)

Method: 12:00–14:00Z (plus one 18–21Z) activity windows for b27bc932,
slug-family counts only (`pull-activity.ts` + grep; files
`data/activity-b27bc932-*{fee,sleeve}probe.jsonl`, gitignored). The
12–14Z windows control for session-of-day, so presence/absence of
`btc-updown-15m-*` fills is a clean sleeve-state read. Follow-up to
A50 (sleeve is the toggling module) and A52 (fee-curve history);
promoted from OQ #2 residue after A52 put a venue event inside the
toggle gap.

## Sleeve state by probe day (btc-15m fills in the 2h window)

| day (12–14Z) | 15m fills | sleeve | fee context |
|---|---|---|---|
| Mar-25 | 47k (full-day file, 13%) | ON | old curve |
| Mar-28 | 3,598 | ON | old curve |
| Mar-29 | 4,026 | ON | reshape rollout begins |
| Mar-30 | 0 | OFF | rollout day — see note |
| Mar-31 | 0 | OFF | 0.072 curve live |
| Apr-02 | 2,508 | ON | 0.072 |
| Apr-05 | 2,538 | ON | 0.072 |
| Apr-07 | 2,017 | ON | 0.072 |
| Apr-08 | 2,276 | ON | 0.072 |
| Apr-09 | 0 | OFF | 0.072 |
| Apr-15 | 0 (full day, A50) | OFF | 0.072 |
| May-13 | 0 (full day, A50) | OFF | 0.070 (post-trim!) |
| May-16–26 | — | wallet mostly dark | |
| May-27 | 1,778 | ON | day BEFORE taker-tier launch |
| May-29 | 675 (low-vol day) | ON | tiers live (May-28) |
| Jun-01 | 2,005 | ON | |
| Jun-10 → Jul | ON (A50: 70/25 mix) | ON | |

Note Mar-30: the midday window shows ONLY btc-5m at ~4× reduced
volume (5.7k trades vs 20k+ on neighbor days) and the 18–21Z window
shows all four 5m books but still no 15m — the wallet ran a reduced,
single-then-few-book mode through the fee-rollout day itself.

## Reading

1. **The shutdown was NOT a reflex to the fee hike** — it is a
   two-phase event. Phase 1: operational pause during the rollout
   itself (Mar-30/31, wallet-wide reduced mode while per-order fee
   terms were mixed). Phase 2: the sleeve came BACK at full cadence
   for a ~1-week evaluation under the 2.3×-dearer curve (Apr-02→08,
   ~2.0–2.5k fills/2h, same as before), then shut down inside one day
   (Apr-08→09) and stayed off ~7 weeks. That is an operator MEASURING
   the new economics and killing the module on evidence — the
   strongest revealed-preference datum yet that btc-15m
   taker-completion economics flipped sign under the 0.072 curve.
2. **The May-6–10 fee trim (0.072→0.070) did NOT revive the sleeve**
   (May-13: still 100% btc-5m) — a 2.8% cut wasn't the margin.
3. **The sleeve returned with the post-dark redeploy on ~May-27, one
   day before the taker-rebate tier launch (May-28)** — consistent
   with re-enabling a taker-heavy module in anticipation of tier
   refunds (top tier halves effective taker fees; the wallet is a
   top-volume incumbent). Announcement-before-launch is unverified
   ([reported] inference); what is verified is the coincidence: trim
   alone no, redeploy+tiers yes.
4. Class lesson for the BRIEF: fee-schedule shocks gate MODULE
   viability, not wallet viability — the operator held the 5m core
   throughout and A/B-tested the 15m sleeve against each fee regime
   within days. A lab strategy on btc-15m must clear the CURRENT
   0.070-curve + tier-rebate economics, and cross-era backtests must
   use A52's era-matched constants.
