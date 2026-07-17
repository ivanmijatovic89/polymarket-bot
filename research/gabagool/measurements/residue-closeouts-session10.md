# Residue close-outs (session 10, unit 5) — 5m launch, drfc, twin links (A54)

Three OPEN-QUESTIONS #6 items, all API-probe work, no scripts (curl +
node one-liners; methods inline below).

## 1. btc-updown-5m series launch: first window 2025-12-18T05:00Z

Method: exact-slug existence bisection against
`gamma-api.polymarket.com/markets/slug/btc-updown-5m-<epoch>` (NOTE:
the `?slug=` query-param form silently returns `[]` even for
existing markets — use the PATH form; the not-found error is
explicit). Noon-probe ladder: absent 2025-10-15/11-15/12-15/12-16/
12-17, present 2025-12-18 →; intra-day bisection on Dec-18: first
existing window is **`btc-updown-5m-1766034000` = 2025-12-18T05:00Z
("December 18, 12:00AM–12:05AM ET")**, i.e. a midnight-ET series
launch. Market batch-created 2025-12-17T20:43:53Z (createdAt field);
the NEXT day's markets were created 2025-12-17T21:07Z — daily batch
creation ~21Z the evening before.

Consequences:
- btc-5m ran **fee-free from launch (Dec-18) until the Mar-06
  all-crypto fee extension** (the Jan-06 fee event was 15m-only).
  The 5m farmer/rebate meta was IMPOSSIBLE before Mar-06 (no fees →
  no rebate pool) — which dates why the 5m-farmer population (atlas
  eras) and b27bc932's ramp (Mar-18) appear when they do.
- The atlas Dec-15 era scan predates the 5m series — its zero 5m
  books are structural, not sampling.

## 2. @drfc4eybh7i8 resolved — and it is an EMPTY profile

Method (the reliable one, record for reuse):
`gamma-api.polymarket.com/public-search?q=<handle>&search_profiles=1`
→ `profiles[0].proxyWallet`. Result:
`0x096924c49e7b92ad96ac6b573dc977398e4a6df3` (pseudonym
"Academic-Compost") — CONFIRMS _META's weak page-signal guess. But
`data-api /activity` for that wallet returns **zero rows ever** (no
window, no limit): the profile has never traded. The charter-listed
handle is a dud/renamed shell; no dossier possible, no class
relevance. Item CLOSED.

## 3. Twin-link checks (profile-creation timestamps via
`gamma-api.polymarket.com/public-profile?address=`)

| wallet | profile createdAt |
|---|---|
| 0x961afce6 (CRYINGLITTLEBABY) | 2025-12-08T21:12:19Z |
| 0x93c22116 | 2025-12-28T21:57:38Z |
| 0x6031b6ee (gabagool22) | 2025-10-29T07:01:58Z |
| 0xa45fe11d (guh123) | **2026-02-20T09:13:05Z** |

- **961afce6 ↔ 93c22116: NO creation-time link** (20 days apart; vs
  the 121s that nailed b55f↔0xce25). The twin suspicion (profits
  within $1.8k, same recipe/era) stays [reported]/circumstantial.
  93c22116's profile creation (Dec-28) matches its first-trade day —
  fresh wallet, immediate deployment.
- **guh123 ↔ gabagool22: SUCCESSION LINK CONFIRMED at the
  operational layer.** gabagool22's last trade ever:
  2026-02-20T09:06:14Z. guh123's profile created:
  2026-02-20T09:13:05Z — **6 minutes 51 seconds later**. The
  operator retired one identity and registered the successor within
  seven minutes. (Not fund-flow proof, but the same evidence class
  that established b55f↔0xce25.) A41's "succession timing
  [reported]" upgrades to verified. Also consistent: guh123's first
  trades appear later the same day (activity empty ≤Feb-18, trades
  by Feb-20 23:59Z).
- Bonus fact: gabagool22 profile created 2025-10-29T07:01:58Z, first
  trade 12:34:51Z same day — 5.5h setup-to-first-trade; all four
  wallets are takerTier 0 today (the tier program post-dates their
  exits, except guh123 who quit Mar-24 pre-tiers).

## Implication (fold into _META/BRIEF)

The gabagool22→guh123 confirmation strengthens the operator-lineage
picture: the archetype operator did NOT leave the class in February —
they rolled capital into a fresh identity within minutes and ran the
Feb–Mar harvest window at $6.5k/day until it closed (Mar-24). "Quit
at peak" (n=8 wallets) is at least partly identity rotation, not
operator exit. Wallet-level lifecycle stats UNDERSTATE operator-level
persistence — treat wallet dossiers as sleeves of operators, not
operators.
