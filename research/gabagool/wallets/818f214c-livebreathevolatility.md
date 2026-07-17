# 0x818f214c…58cb "livebreathevolatility" — the PREDECESSOR (W0 atlas find, session 7)

Address: `0x818f214c7f3e479cce1d964d53fe3db7297558cb`
Pseudonym: **livebreathevolatility** (a chosen name, unlike most class
wallets). Found by the era scan: #2 parity-edge wallet behind
gabagool22 on the Nov-15 and Dec-15 sample days.

## Headline numbers (pulled 2026-07-17)

| metric | value |
|---|---|
| all-time lb profit | **+$385,802** (4th biggest known in the class) |
| 30d lb profit | none (RETIRED) |
| maker rebates | $27,687 total, 2026-01-08 → 2026-04-11 |
| active window | **2025-10-12 → 2026-04-11** (first/last activity day) |

~93% of income is TRADING profit, mostly earned pre-fees — this is a
zero-fee-era edge wallet, not a subsidy wallet.

## Why it rewrites the atlas timeline

**It predates gabagool22 by 17 days** (first fills 2025-10-12 vs the
archetype's 2025-10-29; Sep 2025 fully empty). The "archetype" was not
the class originator — livebreathevolatility was already running
BUY-only merge-mix accumulation at ~$20k/day when gabagool22 started.
Treat "who invented it" as unknown; this is merely the EARLIEST clas
wallet found so far.

## Profile (era-scan samples + daily timeline)

- **btc-updown-15m specialist** in the golden era: Nov/Dec samples are
  ~100% btc-15m ($22.6k and $77.6k on the sampled days), pair
  0.90–0.92 @ **0.959–0.966**, maker share 0.80–0.84, clips $7–9.
  Deep pairs on the lab's exact book — the historical existence proof
  that patient sub-0.97 pair accumulation printed on btc-15m.
- Scale arc (monthly medians of active days): $23k/day (Oct) → $75k
  (Nov) → $215k (Dec) → $105k (Jan, fee shock) → $148k (Feb) →
  **$734k/day (Mar!)** → stop 2026-04-11. It ADAPTED to the Jan fee
  era (pair cost drifted 0.966 → 0.985–0.989 in Jan/Mar samples,
  maker share up to 0.96, books broadened to 5m/multi-coin, 240
  markets/day by Mar-15) and QUIT AT PEAK SCALE five weeks after
  all-crypto fees (Mar 6) — same "walk away, don't bleed" end as the
  archetype, at 3× the scale.
- Merge usage TOGGLED here too: merge-mix Oct–Nov (5–7 merge days/mo)
  → zero merges from Dec on. Third wallet observed treating exit
  style as a switchable module (with b27bc932 A27 and gabagool22's
  era shift) — this is a CLASS-WIDE pattern, not one operator's
  quirk.
- Timing braid (speculative, ledgered as open question): it stopped
  Apr 11; the two strongest CURRENT wallets (b27bc932, 0x04b6d7e9)
  were both born 2026-03-25, 2.5 weeks before. Fingerprints differ
  enough (books, pair depth, taker share) that wallet rotation is NOT
  claimed — but the succession timing is noted.

## What this changes

1. The class's btc-15m golden-era capacity was bigger than the
   archetype implied: TWO wallets (gabagool22 + this one) printed
   simultaneously on the same book with different pair depths (0.98
   vs 0.96) — depth niches coexisted.
2. Deep-pair discipline (≤0.97) has TWO existence proofs now: this
   wallet historically, 0x04b6d7e9 (A30) live today. Strengthens the
   deep-pair sweep cell.
3. The exit pattern "adapt for a while, then quit at scale rather
   than bleed" now has n=2 (gabagool22 Feb-20, this Apr-11). The
   class's professional operators treat regime shifts as exit
   signals, not optimization problems — consistent with H3's
   subsidy-fragility framing.

Data: data/818f214c-timeline{,-early}.json (gitignored).
