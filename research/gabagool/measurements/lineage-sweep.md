# Operator-lineage sweep — profile registrations vs exits (A55)

Script: `scripts/lineage-sweep.ts` (session 10). For all 20 known
class wallets: profile `createdAt` (gamma public-profile) + last
TRADE (data-api /activity?type=TRADE&limit=1), then every
(A's last trade → B's profile creation) pair within ±72h.
Systematizes A54's single find.

## Method caveats (read first)

- `public-profile.createdAt` is USERNAME REGISTRATION, not wallet
  birth: PurpleThunder registered Dec-06 but traded since ~Nov-20
  (dossier bisection). A tight (exit → registration) delta is still
  operational-timing evidence, but read it as "the operator touched
  both identities within minutes/hours", not "new wallet born".
- Two class wallets have NO public profile at all (13e0d447,
  76d4d470 — "profile not found" while actively trading): API-only
  operators never registering a username. The sweep cannot see
  rotations into profile-less wallets; links found are a LOWER bound.
- Active wallets' "last trade" is just now — only retired wallets
  produce meaningful exit events.

## Roster by profile registration (2026-07-17 sweep)

| registered | wallet | last trade | note |
|---|---|---|---|
| 2025-10-12 | livebreathevol | 2026-04-11 | pre-gabagool pioneer |
| 2025-10-21 | 52483137 | 2025-12-06T23:48Z | |
| 2025-10-29 | gabagool22 | 2026-02-20T09:06Z | reg 07:01Z, first trade 12:34Z same day |
| 2025-11-24 | vidarx | 2026-07-14 | wind-down but still ticking |
| 2025-12-06T22:29Z | PurpleThunder | 2026-01-21 | registered 78min BEFORE 52483137's last trade |
| 2025-12-08 | CRYINGLITTLEBABY | 2026-01-20 | +45h after 52483137 exit (weak) |
| 2025-12-28 | 93c22116 | 2026-02-01 | reg day = first-trade day |
| 2026-01-07 | 95f5 | active | day after the Jan-06 fee launch |
| 2026-02-20T09:13Z | guh123 | 2026-03-24T08:50Z | +6m51s after gabagool22 (A54) |
| 2026-03-03 | b27bc932 | active | |
| 2026-03-25T05:55Z | bonereaper | active | +21h after guh123 exit |
| 2026-03-25T14:19Z | 04b6d7e9 | active | +29h after guh123 exit |
| 2026-03-31 | powerwinner | active | v2-deploy day (coincidence?) |
| 2026-04-22 | doggystyie | active | |
| 2026-04-27 | 0xaaaaa | active | day before v1→v2 cutover |
| 2026-04-30T18:54:37Z | b55f | active | twin: 121s before 0xce25 ✓ |
| 2026-04-30T18:56:38Z | 0xce25 | active | |
| 2026-06-08 | badfallen | active | |
| — none — | 13e0d447 | active | profile-less (API-only) |
| — none — | 76d4d470 | active | profile-less (API-only) |

## Links found (≤72h)

1. **52483137 → PurpleThunder: −1.31h (CONFIRMED rotation #2).**
   PT's username was registered 78 minutes before 52483137's final
   trade, on the same Saturday evening — and PT had already been
   trading ~2 weeks in parallel. Reading: one operator ran both,
   consolidated into PT that night. This REWRITES A43's "52483137
   quit Dec-06, competition alone sufficed": the first documented
   'exit' was a consolidation, and 52483137+PurpleThunder is ONE
   operator with ~$854k+ across Nov-01→Jan-21.
2. **gabagool22 → guh123: +6m51s (A54, re-confirmed).**
3. guh123 → bonereaper (+21h) and guh123 → 04b6d7e9 (+29h):
   day-scale, [reported]/suggestive only — two of today's main
   actives registered the day after guh123's exit. Could be
   coincidence (both responding to the same market conditions) or a
   further rotation; styles differ (bonereaper hybrid farmer,
   04b6d7e9 business-hours shallow-fast). NOT counted as links.
4. CRYINGLITTLEBABY +45h after 52483137: weak, not counted.

## Reading (folded into BRIEF §8, dossiers, _META)

- Confirmed operator chains: {52483137 → PurpleThunder} (Nov→Jan-21)
  and {gabagool22 → guh123} (Oct→Mar-24). With b55f↔0xce25
  (concurrent twin), that is 3 multi-wallet operators among the
  class's top earners. The "8 quit-at-peak wallets" collapse to at
  most 6 operator exits, and the two biggest documented earners both
  continued under fresh identities after their famous "quits".
- Operator-level daily-rate ceiling (redraws A43's curve): op#1
  (52483137+PT) Nov→Jan ~$13-14k/day sustained across the rotation;
  op#2 (gabagool22+guh123) Oct→Mar $7.6k→$6.5k/day. The compression
  story survives but exits shift right: op#1 ended Jan-21, op#2
  Mar-24 — both AFTER their wallet-level "quit dates".
- Watch item for W3: if a current active goes dark, sweep new
  profile registrations around the exit time (rerun this script);
  and remember rotations into profile-less wallets are invisible.
