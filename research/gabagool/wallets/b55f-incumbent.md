# 0xb55f…64d4 — the incumbent flagship (INV's "active wallet")

Address: `0xb55fa1296e6ec55d0ce53d93b9237389f11764d4` **[verified]**
(found by scanning 3,000 recent global data-api /trades for the 0xb55f
prefix; lb-api echoes profile name
`0xb55fa1296E6ec55D0cE53d93B9237389f11764d4-1777575277609`, pseudonym
"Lively-Authenticity").

Data on disk: `data/activity-b55f-jul.jsonl` — 56,688 rows, complete
window 2026-07-14T00:00Z → 2026-07-16T00:00Z (2 full days), pulled
2026-07-17 with `scripts/pull-activity.ts` v2.

## Snapshot (lb-api, 2026-07-17)

All-time +$670,104 on $67.7M volume; 30d +$110,589 on $12.2M (0.90%);
7d +$32,292; 1d +$4,604. 30d rate GREW from the INV's $83.8k (Jul 13-14)
— still compounding, not decaying (PRIORS A5).

## Income decomposition (Jul 14–16, measured)

| stream | 2-day total | per day | share |
|---|---:|---:|---:|
| trading cash flow (complete markets, n=2,413) | +$5,348 | ~$2,674 | ~40% |
| MAKER_REBATE (paid ~00:45 UTC daily) | $1,829.91 | ~$915 | ~14% |
| TAKER_REBATE (paid ~00:10 UTC daily) | $6,100.32 | ~$3,050 | ~46% |

- **TAKER_REBATE is a previously-unknown venue program** paying him MORE
  than the maker rebate. All 54,464 TRADE rows are BUYs; /activity does
  not expose maker/taker role, but a taker rebate this size implies
  heavy taker-side buying (crossing asks) with a fee-refund program on
  top (VIP tier? Builder program? — OPEN, workstream B).
- lb-api "profit" (~$3.7k/day over 30d) sits between trading-only and
  trading+rebates → likely excludes rebate transfers (flag P51 nuance).

## Behavioral fingerprint (vs the archetype)

| axis | archetype (gabagool22) | incumbent (this wallet) |
|---|---|---|
| exits | ~99% MERGE, batched, minutes | **0 merges; 2,220 REDEEMs** — hold to resolution (INV P10 was about THIS wallet; A2) |
| win rate/market | 98.7% (Dec era) | **47.0%** — loss-tolerant, asymmetric payoff (worst −$770, best +$2,202) |
| fills/market | 618 p50 (btc-15m Dec) | ~22 mean |
| clip size | p50 $4, p99 $22, max $28 | p50 $4, **p90 $39, p99 $192, max $1,260** |
| buy price band | p25–p75 0.31–0.63 (mid band) | **p25 0.09, p5 0.017** — heavy cheap-tail/longshot accumulation |
| books | BTC+ETH, 15m/1h (Dec era) | **all 4 coins × 5m/15m/1h+** (btc-5m top) |
| delta discipline | parity ~0.1% | loose (47% win + big tails = real directional remainders) |
| net/market | +$63.85 (Dec btc-15m) | +$2.22 mean |

This IS the "simpler, more loss-tolerant version" of the charter's P19
claim (though the "$8M/day" number matches nothing: his 30d volume is
~$0.4M/day; P19's wallet remains unidentified — possibly bonereaper at
$663k/day 30d volume, still not $8M).

## Interpretation

- The CURRENT era still pays a real trading edge (~$2.7k/day for this
  wallet) — the game did not reduce to pure rebate farming after the
  archetype left. But venue-program income (maker+taker rebates ≈
  $3,965/day) now EXCEEDS the trading edge — the venue is subsidizing
  its market-making layer heavily, and any current-meta strategy
  evaluation that ignores both rebate streams mis-prices the opportunity
  by ~2.5×.
- The variant trades PARITY for TAIL-HARVESTING: buying 2–9c longshots
  both as pair-completers (favorite 0.93 + longshot 0.05 = 0.98 pair)
  and as lottery tickets, held to redemption. Median pair economics are
  thin; the PnL comes from the right tail (+$1.5–2.2k markets at 40-125
  fills) — the exact opposite payoff shape of the archetype.
- Cluster: profile created 121s before @0xce25…'s (wallets/_META.md) —
  same operator runs ≥2 wallets; the 0xce25 sibling adds ~$5.4k/day.

## Open

- Maker/taker role split (needs CLOB /trades or on-chain OrderFilled).
- What program pays TAKER_REBATE (size ≈ 50%+ of his gross taker fees?).
- Extend the INV 337-market analysis: per-market pair cost distribution
  for THIS wallet on a bigger sample; how often is the longshot leg a
  pair-completer vs a naked lottery ticket?

## A65 (session 11): birth date found — the "incumbent" is a v2-native cold-start

Day-probes (unit 20): zero activity for BOTH twin wallets through
2026-04-29; first activity 2026-04-30 (b55f: sol-updown-4h TRADE;
0xce25: already redeeming btc-15m the same day). The profile-name
suffixes decode to the same timestamp (1777575277/398 ms =
2026-04-30T23:34Z, 121s apart — A9's twin link). So the operator
pair was born **two days after the Apr-28 v1→v2 venue cutover
(A51)** and has earned lb $675,059 + $470,335 ≈ **$1.145M combined
in 78 days (~$14.7k/day operator-level, ex-rebates)** — the largest
and fastest documented ramp in the class, dwarfing guh123's $6.5k/day
sprint. Early schedule note: both dark on May-03 (young-wallet gap
days, like 13e0d447's).

Consequences:
- "Incumbent" was a misnomer: NO living wallet predates the March
  fee reshape (field birth dates: b27bc932 Mar-03, 04b6d7e9 ~Mar-25,
  76d4d470 Mar-25, b55f/0xce25 Apr-30, 13e0d447 May-29, e114e5ca
  Jul-10). The entire current field consists of current-era natives;
  survivorship of pre-fee wallets is ZERO.
- The birth timing (48h post-cutover) suggests the operator launched
  WITH the v2 exchange. Whether this is a fresh entrant or an
  identity rotation from a pre-cutover operator is UNKNOWN (A55's
  sweep found no ≤72h link to any known wallet's exit; rotations
  into fresh wallets from unknown priors are invisible). Hypothesis,
  not finding.
- A62 amplified: the biggest winner of the current era started from
  zero AFTER the cold-start moat (tier system) existed — the moat
  taxes but does not gate entry at any measured scale.
