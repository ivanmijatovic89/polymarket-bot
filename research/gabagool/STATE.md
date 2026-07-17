# STATE — gabagool knowledge shift

Session relay state. A fresh session continues from CHARTER.md + this file.

## Status digest (updated 2026-07-17T01:05Z, session 1)

- Phase 0 COMPLETE: all required reading done, PRIORS.md written (51 tagged
  claims P1–P51, two central tensions T1/T2 ledgered).
- Binance aggTrades mystery resolved: feed IS implemented + live-verified,
  on unmerged branch `binance-aggtrades-r2-sync` (doc:
  `docs/datasets/polymarket-data/binance-aggtrades-feed.md` on that branch).
  Strategies still wake only on PM book ticks (Binance-driven ticks = ADR,
  proposed not implemented).
- Key tensions driving everything: T1 (lab scope BTC 15m vs INV's "edge is
  on 1h/4h+alts, 15m ≈ 0"); T2 (fable-lab closed passive maker in-model at
  both fill bounds, yet gabagool wallets made $644k live doing it —
  candidate reconciliations i–v in PRIORS §9).
- Next unit: workstream C start — resolve @gabagool22 handle→address, pull
  activity, first forensic pass (needs scripts/ + data/ scaffolding +
  .gitignore for data/).

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
