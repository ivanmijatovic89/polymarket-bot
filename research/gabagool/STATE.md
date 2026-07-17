# STATE — gabagool knowledge shift

Session relay state. A fresh session continues from CHARTER.md + this file.

## Status digest (updated 2026-07-17T03:20Z, session 1)

- Phase 0 DONE: PRIORS.md (51 claims, tensions T1/T2). ENGINE-GAPS.md DONE
  (8 gaps). VENUE-MECHANICS.md started (fee timeline pinned: 15m crypto
  fee-free until 2026-01-06; dynamic taker fees + 20% daily maker rebates
  since; current crypto feeRate 0.07). Wallet forensics WELL UNDERWAY:
  - All 9 handles resolved (wallets/_META.md table + PnL snapshots).
    Ecosystem ALIVE: ~7 wallets printing ~$18.5k/day collectively.
  - gabagool22 = 0x6031…f96d, $868,863 all-time, active 2025-10-29 →
    2026-02-20 (pinned by data). Tail forensics (final 2.6d) DONE:
    trading −$1,767, rebates +$1,819 → quit at breakeven; END-STATE WAS
    REBATE FARMING (pair cost ≥ $1 on purpose). Fingerprint: buys-only,
    delta-neutral (0.13% leg imbalance), $4 clips, burst ladders, batched
    cross-market merges, win% 39–65%.
  - Incumbent 0xb55f full address found:
    0xb55fa1296e6ec55d0ce53d93b9237389f11764d4 — STILL ACTIVE, 30d $110.6k
    (GREW since INV → "decaying edge" contested). Cluster lead: incumbent +
    0xce25 profiles created 121s apart (same operator likely).
- KNOWN PITFALL for successors: data-api /activity rows have no unique id
  + second timestamps → identical same-second rows are REAL; never dedupe
  by content (puller v1 bug, fixed in scripts/pull-activity.ts v2).
- IN FLIGHT: Dec 8-10 2025 (zero-fee era) activity pull for gabagool22
  (`data/activity-gabagool22-dec.jsonl`, background task) — compare
  profitable-era fingerprint vs tail; then update dossier + PRIORS.
- Next after that: METRICS.md fill-out, mid-life analysis, then D2 prep
  (Telonex book join for fill-offset measurement).

## Work queue

### Phase 0 — required reading (DONE, session 1)
- [x] All charter reading; PRIORS.md written and committed.

### Workstream A — Literature
- [ ] Avellaneda–Stoikov & successors (inventory-controlled two-sided quoting)
- [ ] Glosten–Milgrom adverse selection; queue/fill models
- [ ] Prediction-market microstructure; MM on bounded-payoff assets near expiry
- Each note ends with "implications for BTC-15m implementation".

### Workstream B — Venue mechanics → VENUE-MECHANICS.md
- [ ] Fee schedule NOW + history for crypto up/down series (primary sources)
- [ ] Liquidity/maker rewards terms; do 15m crypto markets qualify? $/day at min size
- [ ] Tick size, min order size, rate limits, GTD min expiry
- [ ] Resolution source/precision/timing; negRisk status

### Workstream C — Wallet forensics → wallets/<handle>.md + wallets/_META.md
- [ ] NEXT: @gabagool22 handle→address + activity pull (scaffolding:
      scripts/, data/ gitignored)
- [ ] 0xb55f…64d4 (incumbent flagship; extend 337-market analysis)
- [ ] @powerwinner, @bonereaper, @0xaaaaa, @doggystyie, @drfc4eybh7i8,
      @0xce25e214d5cfe4f459cf67f08df581885aae7fdc-1777575398144, @badfallen
- [ ] Resolve handle→address for each (record method)

### Workstream D — Own-data measurements → measurements/<slug>.md
- [ ] D1 Sum-of-best-asks < $1 scan (freq/depth/duration) on recent BTC 15m
- [ ] D2 Passive-fill reality gap (gabagool's actual fills vs worst-queue rule)
- [ ] D3 Endgame reversal table P(flip | spot distance, seconds left)
- [ ] D4 Open dynamics (first 60s vs rest)
- [ ] D5 Spread & depth lifecycle over the 15m window

### Workstream E — Synthesis (continuous)
- [ ] STRATEGY-BRIEF.md (seed after Phase 0; update continuously)
- [ ] HYPOTHESES.md (ranked; mechanism/params/metrics/kill criteria/SRP family)
- [ ] METRICS.md
- [ ] ENGINE-GAPS.md (from reading code/docs only)
- [ ] OPEN-QUESTIONS.md
- [ ] At saturation: SATURATION.md → LAB-HANDOFF.md → DONE

## Operator claims to verify (from CHARTER)
- gabagool up to ~700 fills in a single 15m market. [reported]
- ~$34k per 15m market for ~$30–120 profit, win rate ~99%. [reported]
- Active Nov 2025→Feb 2026, then stopped entirely. [reported]
- A current large wallet trades ALL crypto symbols/timeframes, simpler and
  more loss-tolerant, ~$8M/day (volume or PnL?). [reported]

## Conventions
- Raw pulls → research/gabagool/data/ (gitignored). Scripts →
  research/gabagool/scripts/ (tsx, read-only outside folder).
- Commit + push after every unit. Branch gabagool-knowledge only.
- No evidence backtests; only ≤10-market --sequential plumbing smokes.
