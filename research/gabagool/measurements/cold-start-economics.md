# Cold-start economics in the tier era (W0 residue → the lab's entry question)

Session 7, 2026-07-17. The lab's bot will BE a cold-start (taker-rebate
tier 3%, no history). Do new entrants still win after the 2026-05-28
tier system? Four specimens, all found on the Jul-15 scan day or A23:

## Specimens

| wallet | born | style | trading (lb) | maker rebates | net | verdict |
|---|---|---|---|---|---|---|
| `0x13e0d447…5204` | 2026-05-29 (dust) / Jun-9 (scale) | maker-pure (1.00), pair 0.89@0.984, clips $3, btc-5m/15m | **+$81,698 all-time** (+$46,885/30d) | $39,414 since Jun-10 (~$1.1k/day) | **≈ +$121k in 5 weeks** | cold-start WIN |
| `0xe114e5ca…c208` "ohio-house" | 2026-07-10 (0→$41k/day overnight) | maker 0.98, DEEP pairs 0.95@0.968 | +$104 | $5,893 in first 6 days | ≈ +$6k week 1 | early WIN, deep-pair |
| `0x76d4d470…c512` | 2026-03-31 | maker-pure 1.00, breadth 264 mkts/day, pair 0.75–0.81 @ 0.98–1.05 | **−$97,821 all-time** (−$18,915/30d) | $137,022 since Mar-31 (~$1.25k/day) | ≈ +$39k in 3.5 months | subsidy loop, barely net-positive |
| HelixEdge `0x2ebd…38cf` (A23) | ~2026-07-07 | big clips $18, btc-5m, taker-heavy | −$20,476/30d | $171 | **−$20k/month** | cold-start LOSS |

Birth patterns: 0x13e0d447 ran a WEEK of penny-notional probes
($0–$1/day fills May-29→Jun-5) before scaling — deliberate calibration
phase. ohio-house skipped it (ported/experienced operator).

## The finding — the moat is completion-mode-specific

A16 framed the taker-tier system as a cold-start moat. The specimens
split it cleanly:

- **Maker-pure cold-starts win TODAY** (2 of 2): if you never cross
  the spread you never pay taker fees, so your tier is irrelevant —
  and your maker rebate rate (1.4%·(1−p), A28) is identical to every
  incumbent's. The moat does not touch you.
- **Taker-heavy cold-starts bleed** (HelixEdge): they pay full-curve
  fees that incumbents get 50% back, a structural 1.5–3.5%-of-taker-
  notional handicap on the completion leg.
- The subsidy-loop corner (0x76d4d470) is net-positive but fragile:
  its whole P&L is one venue-policy decision away from negative (H3
  risk), and its trading line (−0.98%T) shows what maker-pure breadth
  WITHOUT pair discipline earns: adverse selection.

Corollary for the seeds: seed 1's maker-only cells and the deep-pair
cell (A30/A31) are tier-immune — the lab's cold-start status does NOT
handicap them. Only taker-completion cells inherit the moat, and their
sim fee line should use tier-0 (3% refund), not incumbent tiers.

Confidence: lb-profit ≈ excludes rebate transfers (P-fact, used
throughout); 13e0d447's 30d-volume lb row is missing (endpoint quirk)
so its margin%T is not computed; all four specimens are single wallets
— treat as existence proofs, not rates.
