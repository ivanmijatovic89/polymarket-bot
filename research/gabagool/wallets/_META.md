# Cross-wallet synthesis (_META)

Living file. Snapshot date for all numbers: **2026-07-17** (lb-api pulls;
realized-leaning but window semantics per PRIORS P16/P51 — 1d values are
partly mark-to-market).

## Address table (resolution: profile-page dominant-address method, see gabagool22.md; confirmed via lb-api name echo where shown)

| handle | address | all-time $ | 30d $ | 1d $ | 30d vol $ | 30d margin | status |
|---|---|---:|---:|---:|---:|---:|---|
| @gabagool22 | `0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d` | 868,863 | — | — | — | — | stopped 2026-02-20 |
| (incumbent) | `0xb55fa1296e6ec55d0ce53d93b9237389f11764d4` | 670,104 | 110,589 | 4,604 | 12,219,648 | 0.90% | ACTIVE (traded hours ago; SOL/ETH 5m/15m/4h seen) |
| @0xce25…-1777575398144 | `0xce25e214d5cfe4f459cf67f08df581885aae7fdc` | 465,871 | 86,138 | 5,363 | 6,982,623 | 1.23% | ACTIVE |
| @powerwinner | `0xf3531b23b504cf0aed4ff21325232b2a2d496685` | 247,119 | 122,773 | 7,291 | 13,626,107 | 0.90% | ACTIVE (seen in live tape) |
| @bonereaper | `0xeebde7a0e019a63e6b476eb425505b7b3e6eba30` | 1,189,582 | 42,167 | 3,515 | 19,875,367 | 0.21% | ACTIVE (seen in live tape) |
| @0xaaaaa | `0x251c1a283703beed41590b0875a8dcb8ddd1541f` | 157,945 | 76,758 | 7,838 | 5,582,141 | 1.38% | ACTIVE |
| @doggystyie | `0x0484e64092ba4108c2786b61e6fc052d3bf41b1a` | 158,162 | 62,876 | 4,499 | 6,402,512 | 0.98% | ACTIVE |
| @drfc4eybh7i8 | `0x096924c49e7b92ad96ac6b573dc977398e4a6df3` | none | none | none | none | — | UNCONFIRMED address (weak page signal, 18 hits; no lb rows — re-resolve) |
| @badfallen | `0x3048d65321be3497164cdfc2996f94f98a2e7537` | 83,982 | 54,845 | 5,085 | 2,741,094 | 2.00% | ACTIVE |
| (quiet winner, A30) | `0x04b6d7e930cf9e493c5e6ef24b496294f95594c8` | 300,795 | 30,332 | — | 9,952,633 | 0.30% | ACTIVE (born 2026-03-25; + $167,926 maker rebates; wallets/04b6d7e9.md) |
| livebreathevolatility (A31) | `0x818f214c7f3e479cce1d964d53fe3db7297558cb` | 385,802 | — | — | — | — | RETIRED 2026-04-11 (predates gabagool22; wallets/818f214c-livebreathevolatility.md) |

The incumbent's full address was found by scanning 3,000 recent global
`data-api /trades` rows for the `0xb55f` prefix (it trades constantly, so
it appears in any recent sample).

## Fee-inclusive correction (session 3, A13/A16 — read before the tables below)

All decomposition "trading net" figures below and in
measurements/actives-decomposition.md are GROSS of taker fees
(invisible in /activity). On-chain audit (measurements/
fee-audit-actives.md): b55f btc-15m +3.20% gross → **+2.31%**
fee-inclusive (edge real); 0xce25 btc-15m +1.97% → **+0.31%** (barely
positive; the "best edge wallet" ranking flips); btc-5m cells all
fee-negative. Edge wallets are ~62% taker by notional; doggystyie 100%
taker. Rebates refund ≤ tier% (≤50%) of fees and must never be added
to gross nets without subtracting fees.

## Synthesis v2 (2026-07-17, after the 7-wallet decomposition)

Full table + method: `measurements/actives-decomposition.md`. One line:
**the meta is stratified** — 3 edge wallets (0xce25 +2.31% of turnover,
badfallen +1.68%, b55f ~+0.7%; small clips, multi-book or btc-5m), 3
taker-rebate farmers (powerwinner, doggystyie, 0xaaaaa; big clips at
p≈0.5, trading negative by design), bonereaper resolved as a **hybrid**
(5-day window, wallets/bonereaper.md): btc-5m rebate manufacturing at
−0.90% + a REAL 15m edge sleeve (btc-15m +1.12%, eth-15m +0.77% — third
independent btc-15m confirmation) + lumpy sports punts; steady-state
negative ≈ −$4.5k/day but rescued by a single off-schedule **$62.6k
TAKER_REBATE bulk payout** (resolved A21: program-wide same-second
May 28–Jun 19 accrual true-up — June income paid in July). The venue's taker-rebate pool
(~$20k/day across these 7) is the ecosystem's single largest income
stream — program risk is systemic. btc-15m is a LIVE edge book for both
multi-book edge wallets (+2.0–3.2%); ETH books are negative for both.
doggystyie runs the archetype's end-state (0.0% parity) profitably on
taker rebates alone.

## First synthesis notes (2026-07-17)

- **The game is NOT dead and NOT decaying (contra P16's trajectory claim).**
  Sum of 30d profit across the 7 confirmed-active wallets above: ~$556k/30d
  ≈ **$18.5k/day** collectively. The incumbent's own 30d figure GREW from
  $83.8k (INV, Jul 13-14) to $110.6k (Jul 17 pull) — the "edge compressing
  $7k→$3k/day" reading is **[contested]**; it may have been a temporary dip
  or window artifact. 7d rates for several wallets exceed their 30d rates.
- **Same-operator cluster lead**: the incumbent's profile name is
  `0xb55f…64d4-1777575277609` and the @0xce25 handle is
  `0xce25…7fdc-1777575398144` — identical naming pattern, creation
  timestamps 121s apart (~2026-04-30). Likely one operator, ≥2 wallets.
  Check the other actives' profile-creation timestamps for more cluster
  members.
- **Margin band 0.9–2.0% of volume** for most actives (bonereaper is the
  outlier at 0.21% on much higher volume — possibly a different, more
  aggressive variant, or heavy wash within its volume figure).
- gabagool22 remains the biggest single-wallet all-time earner except
  bonereaper ($1.19M), which predates/outlives him — DOSSIER DONE
  (wallets/bonereaper.md): hybrid farmer-with-edge-sleeve; its $1.19M
  all-time cannot be read as trading alpha (rebates incl. bulk payouts +
  15m sleeve + punt variance). Its 30d volume $19.9M ≈ $663k/day — the
  P19 "$8M/day" figure still matches nobody; keep P19's wallet
  unidentified.

## Sweep addendum (2026-07-17, A23 — the cohort above is NOT the whole ecosystem)

A top-50 volume-leaderboard sweep (measurements/leaderboard-sweep.md)
found 4 crypto-updown wallets ≥$0.7M/day that no prior unit tracked:

| wallet | vol/day | books | note |
|---|---|---|---|
| `0xb27bc932…5b82` | $0.73M | btc/eth 5m+15m (CORRECTED A24) | **biggest maker-rebate earner**: archetype-discipline grinder at 3× cadence, +$762,732 all-time, ~3–4% of each book's pool, ~97% of current income = subsidy (wallets/b27bc932.md) |
| `0x95f51617…779f` | $1.48M | ~~btc+eth 5m/15m~~ WORLD CUP (A26) | ~~failed challenger at scale~~ **RECLASSIFIED (A26)**: −$542k lost MM'ing fifwc-* books at $105 clips Jun 24–Jul 17; its crypto-updown side was $28k/day dust, near-breakeven (wallets/95f5-challenger.md) |
| HelixEdge | $0.95M | btc-5m only | new entrant (~Jul 7), −$20k/30d, near-zero rebates (cold-start moat evidence) |
| neutralwave23 | $0.76M | sol/btc 5m+15m | taker-rebate skewed ($22.7k vs maker $1.2k) |

Consequences: (a) "~$18.5k/day collectively" describes the TRACKED 7,
not the ecosystem; (b) the btc-15m maker pool is FRAGMENTED — even the
biggest earner holds ~3–4% of it (A24 correction; no dominant
incumbent); (c) the family's turnover is ≥$120M/month across the 11
known wallets; (d) ~~losing big is a live outcome (0x95f5)~~ WITHDRAWN
by A26 — 0x95f5's loss was a World Cup sports-MM blow-up, not a
crypto-updown class casualty; the measured class downside is slow
bleed (HelixEdge −$20k/30d) or margin compression — competition
is not hypothetical. P19's $8M/day: closed as unmatched (top-50 exhaustive
for >$0.5M/day; nearest = mixed whale suntori $6.3M/day).

## Open

- Resolve @drfc4eybh7i8 properly (JSON-parse the profile page rather than
  counting hex strings).
- Full dossier for `0xb27bc932` (era split, pair cost, merge behavior,
  operator-cluster check) — the most lab-relevant wallet found.
- Profile-creation timestamps for all actives (cluster detection).
- Per-wallet behavioral fingerprints (book mix, size ladder, cadence,
  merge-vs-redeem) — one dossier each.

## Session-7 additions (A30–A33)

| wallet | all-time $ | status | file |
|---|---:|---|---|
| `0x04b6d7e9…94c8` (quiet winner) | 300,795 + 167,926 rebates | ACTIVE, only trading-profitable parity wallet at scale | wallets/04b6d7e9.md |
| `0x818f214c…58cb` livebreathevolatility | 385,802 | RETIRED 2026-04-11 (predates gabagool22) | wallets/818f214c-livebreathevolatility.md |
| `0x2d8b401d…260a` vidarx | 659,586 + 76,093 rebates | wind-down (regime drifter, 3 clusters) | wallets/2d8b401d-vidarx.md |
| `0x13e0d447…5204` | 81,698 + 39,414 rebates | ACTIVE cold-start win (born May-29) | measurements/cold-start-economics.md |
| `0xe114e5ca…c208` ohio-house | ~6k week 1 | ACTIVE cold-start, deep pairs | same |
| `0x76d4d470…c512` | −97,821 + 137,022 rebates | ACTIVE subsidy loop | same |

## Session-8 addition (A41)

| wallet | all-time $ | status | file |
|---|---:|---|---|
| `0xa45fe11d…2429` guh123 | 215,900 (ex-rebates) | RETIRED 2026-03-24 after a 33-day sprint at ~$6.5k/day trading — fastest documented rate, post-fees; started as gabagool22 quit | wallets/a45fe11d-guh123.md |
| `0x961afce6…3361` CRYINGLITTLEBABY | 381,215 | RETIRED 2026-01-26 (January-pool harvester) | wallets/jan-winners-961afce6-93c22116.md |
| `0x93c22116…c072` | 382,998 | RETIRED 2026-02-01 (~$10.6k/day over 36d — fastest documented) | same |
