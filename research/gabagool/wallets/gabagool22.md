# @gabagool22 — the archetype

Address: `0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d` **[verified]**
(resolution method: fetched `https://polymarket.com/@gabagool22`, took the
dominant 0x40-hex string — 48 occurrences vs ≤3 for others — then confirmed
via `data-api /activity?user=<addr>` returning `name: "gabagool22"`,
`pseudonym: "Grown-Cantaloupe"`, and `lb-api /profit?address=` returning
`name: "gabagool22"`).

Data on disk (gitignored): `data/activity-gabagool22.jsonl` — 75,430 rows
covering 2026-02-17T16:49Z → 2026-06-24 (his full tail: last 2.6 trading
days + all post-stop activity), pulled 2026-07-17 via
`scripts/pull-activity.ts`. Full history is ~35k fills/day × ~114 days ≈
3–4M rows — deliberately NOT pulled wholesale; deep-dives use sampled
windows.

## Verified facts (2026-07-17 pulls)

- **Active window: 2025-10-29T12:34:51Z (first trade) → 2026-02-20T09:06:14Z
  (last trade).** ~114 days. Found by bisecting `end=` on the activity API.
  Last REDEEM 2026-02-21T00:55Z. Refines the "Nov→Feb" prior (P6): he
  started Oct 29 and stopped Feb 20. Post-stop activity is only
  REFERRAL_REWARD rows (still arriving as of 2026-06-24) — the account is
  not "dead", it just stopped trading.
- **All-time profit (lb-api): $868,863.** Bigger than the incumbent
  flagship's $670k. No 30d/1d rows (not traded in >30 days) — consistent
  with the stop.
- **From minute one he ran the full operation**: the first minute of
  activity (2025-10-29 12:34:51) shows simultaneous BUYs across
  btc-updown-15m, BTC hourly, and ETH hourly at multiple price levels
  (0.38–0.65), sizes $3–6. No ramp-up/testing phase visible — the system
  arrived fully formed.
- **He DID merge — 697 MERGE events in the 2.6-day tail** (vs 90,638
  TRADEs, 560 REDEEMs). The "never merges, only redeems" claim (PRIORS
  P10) came from the 0xb55f successor's 337 markets and does NOT
  describe gabagool22. Tag P10 **[contested]** as a general claim:
  merge-vs-redeem is a per-operator choice, not part of the concept.
- **MAKER_REBATE income exists and is material**: $1,693.20
  (2026-02-18T00:11Z) and $125.66 (2026-02-21T00:12Z) in the tail window
  alone. Payout timestamps ~00:11–00:12 UTC suggest a daily batch. A venue
  rebate program was paying him — T2 reconciliation (iv) is live;
  workstream B must find the program's terms and history.
- **Book mix in the tail (trade counts, Feb 17–20)**: btc-updown-5m 26,783;
  btc-updown-15m 18,466; eth-updown-15m 14,125; ETH hourly ~9.8k; BTC
  hourly ~15.3k; eth-updown-5m 6,197. Heavily concentrated on 5m/15m +
  hourly, BTC+ETH. This **contests the INV sweep claim (P18)** that the
  gabagool-style edge lives on 1h/4h — the archetype's own volume was
  mostly short-timeframe. (P18 measured the *successor's* per-market edge,
  different wallet and era; both can be true, but the archetype clearly
  found 5m/15m worth trading at ~35k fills/day.)
- **Fill density**: ~90.6k trades in ~2.6 days ≈ 35k fills/day across all
  books — consistent with the "up to ~700 fills in one market" order of
  magnitude (P7 still unverified per-market; check in the per-market
  deep-dive).

## Tail forensics (final 2.6 days — see measurements/tail-forensics-gabagool22.md)

- Trading net **−$1,767 on $356.6k turnover (−0.50%)**; rebates $1,818.86
  in-window → total ≈ +$52. **He quit at breakeven** (2026-02-20).
- End-state profile: buys only (0 sells), exits ~99% by MERGE ($350.5k)
  not redeem ($4.3k); near-perfect delta neutrality (0.13% leg imbalance
  over 845 fills in the showcase market); pair cost p50 0.99–1.00 (showcase
  1.020 — paying over $1 on purpose, rebate-financed); clip size p50
  $3.84; fills p90 up to ~800/market (max 2,478); inter-fill gap p50 0s
  (burst ladders); max outlay p50 $150–610, max $6.4k.
- Reading: post-fee-era gabagool = **rebate farmer**; the 20% maker-rebate
  pool got competed into pair costs ≥ $1 until total EV ≈ 0 → quit. The
  live-market mirror of fable-lab E29, with rebates as the unmodeled term.
- CAUTION: end-state only. His $869k was mostly earned earlier (probably
  the zero-fee era Oct 29 → Jan 6). Win% in tail: 39–65% by family (P8's
  "99% win" not seen here); hourly books beat 15m even in the tail.

## Open (next units)

- **Mid-life sample (early Dec 2025, zero-fee era): pair costs, win rate,
  book mix — the profitable-era fingerprint vs the tail.** ← next
- Level offsets vs mid at fill time (needs Telonex book join → D2 prep).
- Fee/rebate parameter changes near Feb 20 (workstream B archive sweep).
- Merge cadence: merges are batched cross-market (34 markets/tx seen),
  ~every few minutes; exact trigger policy still uncharacterized.
