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

The incumbent's full address was found by scanning 3,000 recent global
`data-api /trades` rows for the `0xb55f` prefix (it trades constantly, so
it appears in any recent sample).

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
  bonereaper ($1.19M), which predates/outlives him — bonereaper deserves
  early forensic attention: it may be the "$8M/day, all symbols, more
  loss-tolerant" wallet of P19 (its 30d volume $19.9M ≈ $663k/day though —
  the $8M/day figure matches nobody yet; keep P19's wallet unidentified).

## Open

- Resolve @drfc4eybh7i8 properly (JSON-parse the profile page rather than
  counting hex strings).
- Profile-creation timestamps for all actives (cluster detection).
- Per-wallet behavioral fingerprints (book mix, size ladder, cadence,
  merge-vs-redeem) — one dossier each.
