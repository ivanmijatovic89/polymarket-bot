# Measurement: gabagool22 era comparison — zero-fee Dec 2025 vs fee-era Feb 2026 tail

Session 1, 2026-07-17. CAVEAT added session 3: Feb-side numbers are
GROSS of taker fees (invisible in /activity, A13) — Feb true trading
net is more negative than shown; Dec side is exact (fee=0 on-chain).
Script: `scripts/analyze-tail.ts` (with fills>0 +
1h/2h boundary margins; see method notes in tail-forensics file). Data:
`data/activity-gabagool22-dec.jsonl` (277,832 rows, 2025-12-07T23:00Z →
2025-12-10T12:00Z, complete pull of that window) and the Feb tail file.

## The comparison (both windows ≈ 2.5 days)

| | Dec 8–10 2025 (ZERO-FEE) | Feb 17–20 2026 (fee+rebate, final days) |
|---|---|---|
| markets played | 568 | 492 |
| books | btc-15m (229), eth-15m (229), btc-1h (55), eth-1h (55) — **no 5m, no SOL/XRP** | btc-5m (163!), eth-5m (122), btc/eth-15m (57/52), btc/eth-1h (51/47) |
| trading net | **+$24,521 on $1.29M buys = +1.90%** (~$10k/day) | **−$1,767 on $0.36M = −0.50%** |
| btc-15m per market | mean **+$63.85**, p50 +$54.75, p90 +$128.84, **win 98.7%**, p10 **+$19.80** | mean −$12.94, p50 −$1.55, win 38.6% |
| btc-1h per market | +$61.75, win 98.2% | −$0.81, win 64.7% |
| eth-15m / eth-1h | +$20.55 (83.8%) / +$32.65 (89.1%) | −$5.21 (43.4%) / +$0.91 (57.4%) |
| pair cost p50 | **0.98** (2c/pair margin) | 0.99–1.00 (showcase 1.02) |
| fills p50 (btc-15m) | 618 (max 1,276) | 162 (max 853) |
| max outlay p50 (btc-15m) | $3,195 (max $6,846) | $610 (max $4,750) |
| worst market | **−$120.90** (across 568!) | −$145.22 |
| inter-fill gap mean | 2.60s | 5.44s |
| rebates | $0 (program didn't exist) | +$1,819 (≈ −trading net) |

Scale check: +$10k/day (Dec sample) vs lifetime $868,863 / 114 days ≈
$7.6k/day average — consistent (Dec was a good-but-not-peak period).

## Prior updates (numbers now verified from primary data)

1. **P8 VERIFIED for the zero-fee era, refuted for the tail**: "~99% win,
   $30–120/market" exactly matches Dec btc books (98.7%/98.2% win, p50
   $54.75, p90 $128.84). The "$34k deployed/market" part remains
   UNMATCHED anywhere (Dec p50 outlay $3.2k, max $7.9k) — either a peak-
   January figure or wrong.
2. **T1 RE-FRAMED — the BTC-15m edge EXISTED and was his biggest earner.**
   INV P18's "15m ≈ 0" measured the LATE era (post-fee, competed). In Dec
   2025 btc-updown-15m alone printed ≈ $5.9k/day at 98.7% win for one
   wallet. The lab's scope (BTC 15m) is exactly where the archetype's
   crown jewel was — the question is not "was there edge on 15m" but
   "what remains of it in the fee+rebate+7-bot era".
3. **The tail-risk story (P14's −$500 markets) is nearly absent for the
   archetype**: worst Dec market −$121 across 568. Near-perfect
   delta-neutral accumulation (leg imbalance ~0.1%) + hold-to-merge kept
   the unpaired exposure tiny. The −$500 markets belong to other wallets
   (successor's looser variant) or other eras.
4. **Book evolution**: Dec = 15m+1h BTC/ETH only (5m books absent — they
   were introduced later; his Feb tail is 5m-heavy). "16 books, 4 coins ×
   4 timeframes" (P12) describes the successor meta, not the archetype.
5. **What killed the edge**: the 2026-01-06 fee introduction bracket.
   Zero-fee era: takers crossed freely (latency arbs + retail), makers
   collected ~2c/pair. Fees taxed exactly the mid-price crossings the
   strategy feeds on (Feb-era crypto curve peaked at p=0.5), taker flow
   thinned/wised up, pair costs compressed to ≥$1, and the 20% rebate pool
   became the only income — until that too competed to breakeven and he
   left (2026-02-20). NOTE: this is the leading STORY consistent with the
   two samples; a January sample (fee era, pre-decay) would show the
   transition speed and is the natural next pull.

## Implications for the lab (feeds STRATEGY-BRIEF / LAB-HANDOFF)

- Replaying the Dec zero-fee regime in backtests would measure a dead
  regime. Any evidence run must use post-2026-01-06 markets for
  current-meta relevance, and must model rebates (ENGINE-GAPS G4) or it
  mis-signs the current equilibrium.
- The CURRENT actives still run 0.9–2.0% margins (wallets/_META.md) in the
  fee era — the concept is alive, but its income decomposition (trading vs
  rebates) is unknown for them. That decomposition is measurable from
  their /activity (MAKER_REBATE rows) — high-value next forensic step.
- The archetype's risk management (delta-parity accumulation) is the
  load-bearing mechanism to copy: pair completion ~99.9%, not leg-risk
  timeouts.
