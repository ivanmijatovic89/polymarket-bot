# JOURNAL — gabagool knowledge shift (append-only)

## 2026-07-17T00:30Z — session 1 begins

First session of the relay. No STATE.md existed; created STATE.md with the
full work queue seeded from the charter, plus this journal. Starting Phase 0
(required reading → PRIORS.md).

Early surprise: the charter points to a "binance aggTrades feed doc under
docs/datasets/" — that doc does not exist anywhere in this repo (repo-wide
grep for "aggTrades" only hits the charter itself). Binance-spot replayability
in backtests is claimed as NEW; I need to find where it actually lives
(possibly strategy-research-protocol/ or the engine code) or ledger it as an
unverified claim.

## 2026-07-17T01:05Z — Phase 0 complete, PRIORS.md written

Read everything the charter required (~3,400 lines + the Binance branch
docs). PRIORS.md now holds 51 tagged claims. The surprises:

1. The "missing" Binance aggTrades doc exists — on unmerged branch
   `binance-aggtrades-r2-sync`. The feed is implemented AND verified against
   the live WS stream (0 mismatches on 48k trades, measured p50 latency
   110ms baked in as the default). So "Binance spot is replayable" is true,
   with the caveat that strategies still only wake on Polymarket book ticks.
2. The mirror-book fact (fable-lab E9/CAL-001: bid_DOWN = 1 − ask_UP,
   16,352/16,353 samples) quietly kills the *instantaneous* version of the
   pair-cost story: top-of-book ask_UP + ask_DOWN = 1 + spread ≥ 1 always.
   Gabagool's sub-$1 pair cost is a TIME-SEPARATED phenomenon. Charter
   measurement D1 needs re-scoping accordingly (noted in PRIORS §11).
3. The two prior campaigns and the live wallets flatly contradict each
   other (T2): every sim-visible passive-maker variant on BTC 15m measured
   negative-to-zero at BOTH fill-model bounds, yet the flagship wallet
   banked ~$644k doing this live. Five candidate reconciliations ledgered;
   the passive-fill reality gap (D2) is the measurement that arbitrates.

Next: wallet forensics scaffolding + @gabagool22 handle→address resolution.

## 2026-07-17T01:55Z — wallet forensics unit 1: handles resolved, ecosystem alive

Resolved all 9 target handles to addresses (profile-page dominant-address
method + lb-api name echo). Findings that move priors:

- gabagool22 = 0x6031…f96d, all-time $868,863 (bigger than the incumbent).
  Active window pinned by data: 2025-10-29 12:34Z → 2026-02-20 09:06Z.
  Ran the full multi-book operation from literally the first minute.
- He DID merge (697 MERGEs in the 2.6-day tail) — "never merges" (P10) is
  a successor-wallet fact, not an archetype fact. Contested.
- MAKER_REBATE rows exist: $1,693 paid 2026-02-18. Venue rebate income is
  real — T2 reconciliation (iv) is live, workstream B must find the terms.
- His volume was mostly 5m/15m BTC/ETH (~35k fills/day) — contests the
  INV claim that the edge lives on 1h/4h (P18/T1 needs re-measurement).
- The ecosystem TODAY: 7 confirmed-active wallets collectively printing
  ~$18.5k/day over 30d; the incumbent's 30d rate GREW since the INV
  (83.8k → 110.6k). "Edge decaying" is contested.
- Cluster lead: incumbent + @0xce25 profiles created 121s apart with the
  same name pattern — likely one operator, two wallets.

Full-history pull for gabagool22 is infeasible (~3-4M rows via a 500/page
API); kept the 75k-row tail (Feb 17-20 + post-stop) and will sample
mid-life windows instead.

## 2026-07-17T02:50Z — puller bug found+fixed; tail forensics done; venue fee timeline pinned

A dedupe bug in puller v1 (identical same-second rows are LEGITIMATE — no
unique ids in /activity) was silently dropping ~22% of trades and showed
+$45k tail profit. Fixed puller, re-pulled, validated MERGE semantics
(= pairs × $1). Corrected picture of his final 2.6 days:

- Trading net −$1,767 (−0.50% of turnover); rebates +$1,819 → he quit at
  breakeven on 2026-02-20. Win% 39–65% by family, NOT 99%.
- Fingerprint: buys only, both sides, near-zero delta (0.13% leg imbalance
  across 845 fills), pair cost ≈ $1.00–1.02 (paying over $1, financed by
  the 20% maker rebate), $4 median clips, burst ladders (p50 gap 0s),
  exits via batched cross-market merges.
- Venue timeline (workstream B): 15m crypto fee-free until 2026-01-06;
  dynamic taker fees (~1.56c/share at p=0.5 — exactly the repo's 156bps
  era) + daily 20%-share maker rebates introduced Jan 6-7; current (Jul
  2026) crypto feeRate 0.07 (1.75c at p=0.5). VENUE-MECHANICS.md started.
- Big narrative shift: end-state gabagool = REBATE FARMER (trading PnL ≈
  −rebates; the live E29 equilibrium). His $869k must be mostly from the
  zero-fee era → mid-life sample (Dec 2025) is the next measurement.

Also: briefly created (and immediately removed) a stray dir at repo-root
measurements/ — write-scope discipline note to self.

## 2026-07-17T03:15Z — ENGINE-GAPS.md written

Eight gaps documented from code reading, ranked. New beyond the charter's
known list: (G3) the sim's taker-fee model is wrong in SHAPE (linear
min(p,1−p) vs the venue's quadratic p(1−p)) and undercharges takers 2–4×
across the price range; (G4) rebates — now known to be the end-state edge
— are absent and their pool-share arithmetic needs trade prints; (G5)
mid-episode merge in sim DESTROYS value (fable E4) while live merge is the
capital-recycling engine of the real strategy — capital velocity is
inexpressible; (G8) the live meta is a 7-bot equilibrium no replay can
express. Fee-shape check also sharpened a fable-lab premise: their "156
bps" era matched January's venue curve only at 45% of its mid-price value.

## 2026-07-17T04:10Z — era comparison: the edge lived and died with the fee regime

Pulled Dec 8-10 2025 (277k rows) and compared to the Feb tail with fixed
boundary handling. Zero-fee December: +1.90% of turnover (~$10k/day), BTC
15m his best book at +$63.85/market and 98.7% win over 229 markets, pair
cost 0.98, worst market −$121. Fee-era February: −0.50%, win rates
collapsed, pair cost ≥ $1, rebates ≈ −trading. The operator claim "99%
win, $30-120/market" is now VERIFIED for December and REFUTED for
February — both were true, at different times.

Venue archaeology (archive.org): Feb-era crypto fee = C·p·0.25·(p(1−p))²
(peak $0.78/100sh = the repo's 156bps calibration, exactly); current =
C·0.07·p(1−p) (peak $1.75). Fees extended to ALL crypto markets
2026-03-06. The maker-rebates docs page first appears in the archive on
2026-02-20 — the day gabagool quit. January's true rate is contested
(press says 2× the Feb snapshot); resolving it matters because a
mid-February fee/rebate halving would be a clean exit trigger.

PRIORS amended (A1–A8). Era-comparison measurement file written.

## 2026-07-17T04:55Z — incumbent decomposition: the current meta is subsidy-heavy but edge-positive

Pulled 2 complete days (Jul 14-16) for 0xb55f. Three income streams:
trading +$2,674/day, MAKER_REBATE $915/day, and a previously-unknown
TAKER_REBATE program paying $3,050/day — venue subsidies now EXCEED the
trading edge. The incumbent is a different animal from the archetype:
never merges (2,220 redeems — INV's "never merges" was about him, A2
confirmed), 47% win rate with tail-harvest payoffs (worst −$770, best
+$2,202), clips to $1,260, buys deep longshots (p25 price $0.09), all 4
coins. Wrote wallets/b55f-incumbent.md with the side-by-side fingerprint
table. The concept now has two verified profitable EXPRESSIONS: parity
grinder (archetype, zero-fee era) and loss-tolerant tail harvester
(incumbent, current era).

## 2026-07-17T05:25Z — synthesis checkpoint: HYPOTHESES, OPEN-QUESTIONS, STATE rewrite

Identified the taker-rebate program (launched 2026-05-28, 7 tiers, 3-50%
refund by 30d weighted volume, crypto 2.3x weight) — incumbents pay ~half
the posted taker fee; a volume moat against new entrants. Wrote
HYPOTHESES.md (H1 parity-grinder rebate-adjusted, H2 tail-completer, H3
subsidy-dominance test, H4 Binance-gated quoting (blocked on branch
merge), H5 15m-vs-5m book allocation) and OPEN-QUESTIONS.md (12 ranked).
STATE.md rewritten as a 60-second onboarding for successors. All
deliverable files now exist with substance. Next big rock: D2.

## 2026-07-17T06:20Z — D2 measured + powerwinner decomposed + literature A1

D2 (the charter's priority measurement): worst_queue admits 44-49% of the
archetype's real fills, touch 64-68% (3s window; 43k fills, both eras,
40+40 markets). The sim sees half the volume — the adverse half. Also
discovered he taker-completed 29-45% of fills (not purely passive), with
a 1-4c-deep bid ladder + touch joins for the passive rest.

powerwinner (hottest wallet, +$122.8k/30d) decomposed: pure TAKER-rebate
farmer — btc-5m only, $84 clips, trading −$13.90/market, taker rebates
+$6.1k/day. The current "ecosystem" mixes real edge (b55f), taker-rebate
farming (powerwinner), and everything between; every wallet needs
decomposition before its P&L means anything.

Wrote literature/A1 (Avellaneda-Stoikov, Glosten-Milgrom, queue models →
BTC-15m implications; the fee introduction as a G-M flow-composition
shift explains the measured margin collapse mechanism cleanly).

## 2026-07-17T07:10Z — all seven actives decomposed: the meta is stratified

Pulled + decomposed the remaining five wallets (same Jul 14-16 window).
The verdict on H3: STRATIFIED. Three wallets carry real trading alpha
(0xce25 +2.31% of turnover — the b55f sibling and the best measured;
badfallen +1.68% on btc-5m alone; b55f ~+0.7%). Three are deliberate
taker-rebate farmers (powerwinner, doggystyie, 0xaaaaa) whose trading
loss is the manufacturing cost of weighted volume. bonereaper printed
negative this window (its $1.19M all-time says sample luck — flagged).

Standouts: doggystyie runs the archetype's EXACT end-state (perfect
0.0% parity, pair cost ≥ $1) profitably TODAY because taker rebates now
pay for it. The edge wallets share the archetype's fingerprint (small
$6-11 clips, multi-book); the farmers trade $35-84 clips at p≈0.5 on
btc-5m only. And the single largest income stream of the whole ecosystem
is the venue's taker-rebate pool (~$20k/day for these 7) — program risk
is now the systemic risk of the meta.

The lab's takeaway sharpened: real alpha exists in the current era, its
carriers look like gabagool, and BTC-5m/15m are where both the alpha
wallets and the subsidy flow concentrate.

## 2026-07-17T01:30Z — session 3 start: state sync (clock note + last session's uncommitted narration)

Clock note: earlier journal timestamps ("05:20Z"–"07:10Z") were mislabeled
— git commit times show all prior work happened 00:26–01:23 UTC. From
here on, timestamps are real UTC from `date -u`.

Session 2 ended after five commits that never made it into STATE/JOURNAL.
What they did (recovered from diffs):

- **Per-book nets (b6bfedc)**: btc-15m is a live EDGE book today — T1
  (does the archetype's best book still pay?) resolved YES; PRIORS A11.
- **_META v2 (e8b44e7)**: cross-wallet synthesis rewritten around the
  stratified meta (3 edge / 3 farmers / 1 negative).
- **Fee-formula bracketing (57b8b85)**: the crypto fee curve's shape
  change + peak doubling is now bracketed to 2026-03-05 → 2026-04-01 via
  /trading/fees archive snapshots; ~10 March snapshots exist for exact
  bisection if it ever matters. January's true rate remains contested.
- **Literature A2 (5d46efe)**: queue-position value + subsidized-MM
  economics; the YIELD program is dust for this concept.
- **Leg-risk policy rewrite (7a6d21b)**: parity is a zero-fee-era
  artifact, not a concept invariant. Current edge wallets run LOOSE
  parity (p50 leg imbalance 20–40%); the one perfect-parity wallet today
  is trading-negative and lives on rebates. BRIEF now says: sweep parity
  tolerance as a first-class knob (0.1% → 40%).

Also recovered two interrupted pulls and resumed them (puller state files
worked as designed): gabagool22 Jan 10–13 transition sample (was at Jan
11 04:40Z walking back; ~1.2 days remain) and bonereaper Jul 7–12 second
window (was at Jul 10 10:33Z; ~3.4 days remain). Both running in
background now. Next: analyze the Jan transition when the pull lands —
it's the decay-speed prior (Dec 0.98/98.7% → Feb 1.00/38.6%; where was
mid-January?).

## 2026-07-17T01:55Z — bonereaper verdict: hybrid farmer-with-an-edge-sleeve, and a $62.6k bulk payout

Both resumed pulls landed within minutes (they were nearly done when the
last session died). Bonereaper Jul 7–12 (5 days, 137,913 rows, complete):
trading −$35,673 on $3.16M buys (−1.13%) — the earlier 2-day negative was
NOT sample luck. But the per-book split tells three stories at once:
btc-5m is rebate manufacturing (−0.90% on $2.6M, 82% of turnover, the
powerwinner signature), the 15m books are REAL edge (btc-15m +1.12% —
third independent wallet confirming A11; eth-15m +0.77%, which was
negative for b55f/0xce25 — so coin asymmetry is wallet-specific), and
−$15.2k of the loss is discretionary sports punting (one Ronaldo bet
−$18.7k).

The surprise: one TAKER_REBATE payout of **$62,612.93** at Jul 8 23:34Z —
off the daily 00:10Z cadence and 20–45× the normal $1.4–2.9k/day.
Excluding it, bonereaper runs ≈ −$4.5k/day steady-state; including it the
window is +$40k. Its $1.19M all-time is not trading alpha. New open
question: what ARE these bulk payouts (true-up? backpay?) — every
short-window income decomposition is hostage to them.

Wrote wallets/bonereaper.md, updated _META, PRIORS A12, refreshed
OPEN-QUESTIONS (D2/H3/dossier items moved to resolved). Next: the
January transition analysis — the pull completed too.

## 2026-07-17T02:35Z — January analyzed; fee mechanics decoded on-chain; a systematic accounting bias found in ALL fee-era numbers

The January transition unit turned into the most consequential unit of
the shift so far. Three results:

1. **The decay was not a decay.** btc-15m by day: Jan 10 win 49.4% /
   +$0.69/mkt → Jan 12 win 94.0% / +$45.93/mkt, pair cost 0.9945 →
   0.9815. The fee-free btc-1h control book held 87–96% win with flat
   pair costs the same days. He absorbed the Jan-6 fee shock, re-tuned
   his ladder ~130bp deeper in under a week, and was nearly back to
   December performance by Jan 12. The Feb collapse is a separate,
   slower phenomenon (competitive compression). Decay prior for the
   lab: structural shocks are adapted to in days; competition kills in
   weeks.

2. **Fee mechanics decoded from receipts** (his /activity rows carry
   tx hashes; POLYGON_RPC_URL read-only). On-chain, EVERY fill is
   charged 10%×min(p,1−p)×size in the output asset — both sides — and
   the operator module refunds in the same tx: makers 100% (net $0),
   takers down to the published curve. His Jan 11–12 net taker fee
   matches 0.25·p·(p(1−p))² to 4 decimals → **January's rate = the Feb
   formula; the contested 2× press figure is dead; the "mid-Feb fee
   halving" exit-trigger hypothesis is eliminated.** December receipts
   show fee=0 — the zero-fee era verified on-chain.

3. **The bias**: /activity reports GROSS size/usdcSize (verified exact
   on 325k rows) — net taker fees, docked in shares, are invisible.
   Every fee-era cash-flow net we have measured is gross-of-fee, and
   the July decompositions counted rebates (fee REFUNDS) as income
   without the fees. Jan btc-15m: +$24.52/mkt gross → +$10–15/mkt
   corrected at D2's 29–45% taker share. New question #1: does the
   July edge survive fee-inclusive accounting? b55f's $3.05k/day taker
   rebate implies ≥$6.1k/day fees paid vs +$2.7k/day gross trading net
   — the sign of the true trading edge is now genuinely uncertain.

Wrote measurements/jan-transition-gabagool22.md, PRIORS A13–A15,
VENUE-MECHANICS fee-implementation section, caveats added to
era-comparison + actives-decomposition, OPEN-QUESTIONS refreshed.

## 2026-07-17T03:05Z — fee-inclusive audit: the edge survives, and the meta is majority-taker

Wrote scripts/measure-onchain-fees.ts (samples a wallet's fill txs,
decodes receipts for per-fill maker/taker role + net fee). First find:
July fills settle on a NEW exchange contract (0xe1111800…996b, event
0xd543adfd…) with NATIVE fees — maker 0, taker = published curve in
USDC, and mint-matching (complementary buys combine at $1/pair). The
v1 charge-and-refund dance is history; /activity is still gross.

The audit (Jul 14–16, 120–150 receipts/cell, 100% decoded):

- b55f btc-15m: +3.20% gross → **+2.31% fee-inclusive. The edge is
  real.** (37.8% maker by notional, taker fills pay 1.43%.)
- 0xce25 btc-15m: +1.97% → **+0.31%** — barely alive; it's much more
  taker-aggressive (fee 2.64%). The "best edge wallet" ranking FLIPS
  after fees (b55f > 0xce25 on btc-15m).
- b55f btc-5m: −0.14% → −1.98%; doggystyie btc-5m: −0.32% → −2.93%,
  and doggystyie is 100% TAKER (its "perfect parity maker" fingerprint
  is a taker loop — no resting orders at all in 120 txs).
- Edge wallets are ~62% taker by NOTIONAL on their edge book. The
  winning meta is maker-accumulate + taker-complete, weighted toward
  completion. A pure-passive lab family models a minority of winner
  flow.

PRIORS A16, _META fee-correction header, VENUE-MECHANICS new-exchange
section, OPEN-QUESTIONS: fee re-audit + maker/taker split resolved.
Next: fold A13–A16 into STRATEGY-BRIEF/HYPOTHESES (they change H1's
premises materially), then the edge-source hunt.

## 2026-07-17T03:25Z — synthesis fold: A13-A16 into BRIEF/HYPOTHESES/METRICS

BRIEF: fee mechanics now "exactly known per era" in §2; §1 economics
updated with fee-inclusive July numbers; §4 gains the completion-policy
knob (the b55f-vs-0xce25 2%-gap observation); §9 marks income
decomposition + January transition answered. HYPOTHESES: H1 parameters
now sweep parity 0.1→40% AND completion policy; H3 carries the
fee-inclusive correction; H5 RESOLVED SUPPORTED (btc-15m is the right
book; 5m is a subsidy game); new H6 "completion aggressiveness is the
margin knob" — testable in sim because fees are exactly modelable and
relative ranking survives a pessimistic maker model. METRICS: added
taker-fee drag, fee-inclusive margin, taker-share-of-notional rows and
the gross-accounting discipline note.

Next: edge-source hunt (now question #1) — level/timing analysis of
b55f vs 0xce25 btc-15m fills against Telonex books.

## 2026-07-17T05:05Z — session 4: recovered and committed the edge-source unit

Predecessor died after finishing the edge-source hunt but before
committing. Everything of substance was on disk: A17 (the execution
fingerprint of the current btc-15m edge — deep patient ladders p10 −12c
below touch, cheap-side touch rests, ~43% of notional taker-completed
mid-band, back-loaded into minutes 10–13, no open concentration, and the
better wallet waits longer + crosses further from the fee peak), A18
(venue facts: Chainlink BTC/USD data stream resolution with ties→UP,
negRisk false, tick 0.01, min 5 shares), G9 (Telonex coverage ends
2026-06-14 — July era not replayable), OPEN-QUESTIONS refreshed with
three items resolved. This session verified the files against the diffs,
added the missing journal/feed/state bookkeeping, and committed.

Notable: the July books not existing forced the analysis onto Jun 12–14,
which is fine (era-consistent) but means the lab's newest replayable
slice lags the live meta by a month — flagged as G9.

Next: fold A17/A18 into STRATEGY-BRIEF/HYPOTHESES (ladder priors for H1,
H6 sharpening, endgame bounds from ties→UP), then D3/D4/D5 measurements.

## 2026-07-17T05:25Z — synthesis fold: A17/A18 into BRIEF/HYPOTHESES/METRICS

BRIEF §4 gains the current-era ladder shape (deep rungs to −13c,
cheap-side touch rests, mid-band completion) and the timing profile
(back-load minutes 8–13, cut minute 14, ignore the open); §3 and H4
gain the Chainlink-vs-Binance oracle basis caveat; §7 gains the
resolution bounds (ties→UP, tick 0.01, min 5 shares); §9 marks
edge-source + level-offsets answered. H1's parameter block now
carries the measured ladder-depth and time-weighting priors. H6 gains
the June fills×books cross-check (the completion-price ranking
reproduces independently of the receipt decode). METRICS adds the
minute-of-window fill-share row.

Synthesis is now current through A18. Next: D3/D4/D5 measurements —
first check what fable E24/E25 already cover, then build on June
Telonex books (the newest replayable slice, G9).

## 2026-07-17T05:55Z — venue leftovers closed (A19) while the D3/D5 replay runs

Primary-sourced the remaining order/market mechanics from the docs
site (the old CLOB doc URLs 404 — the index lives at
docs.polymarket.com/llms.txt now): sub-cent tick switches exactly at
>0.96 / <0.04 (tick_size_change, orderbook page); rate limits are
generous and non-binding for this concept (POST /order 5,000/10s
burst, 120k/10min sustained; data-api 1,000/10s — relevant to our own
pullers); Chainlink Data Streams publish ~200ms signed reports with
18-decimal prices, so the ties→UP resolution clause is measure-zero,
not a tradable asymmetry. One [reported] residue: marketable orders
≥ $1 notional (secondary source only).

Meanwhile scripts/window-lifecycle.ts (D3 flip table + D5 lifecycle,
one replay pass, 288 June markets sampled from 1,286 on disk) runs in
the background; smoke test on 8 markets validated plumbing, including
two gotchas: the book WIPES after resolution (outcome must be read
from the last decisive post-window quote, walking backwards), and
minute-14 lifecycle rows condition on the book still being two-sided.

## 2026-07-17T06:20Z — D3+D5 done (A20): tight books, front-loaded churn, calibrated-to-slightly-cheap favorites

The 288-market June run finished. Three takeaways: (1) btc-15m books
are 1c-tight the entire window — there is no wide-spread regime; the
"cheap side" is 1–2c plus depth sweeps. (2) Mid oscillation (the
mechanical pair-harvest fuel) is front-loaded into minutes 0–5 and dies
to zero by minute 14, while the edge wallets' fills (A17) are
back-loaded — combined with fable E24 (open churn = adverse selection
from the first seconds), the winners' revealed preference makes sense:
skip the open, position late. (3) The flip table says the leading side
is slightly UNDERpriced at mid in every band ≥0.6 (0.85-band flips
10.5–13.8% vs 15% implied) — the mirror of fable's cheap-side trap,
~1–5c gross, below fee+spread. Endgame bounds for the lab: ≥0.9 with
<5min flips 0–6%; ≤0.6 is a coin toss at every horizon. D4 resolved by
priors, no measurement needed. One honest bias: the 27 outcome-
ambiguous markets are the closest finishes, so tail flip rates are
slightly understated.

Also this unit (data already pulled, writeup next): the bulk-payout
question cracked open — the Jul 8 lump is ecosystem-wide, same-second.

## 2026-07-17T06:45Z — bulk payout resolved (A21): program-wide backpay, and direct evidence of program discretion

The /activity type filter (news to us — makes rebate pulls nearly
free) gave full payout histories for all 7 actives. The $62.6k lump is
one same-second batch (2026-07-08T23:34:35Z) hitting 6/7 wallets,
$174k in this cohort alone; daily taker payouts start exactly Jun 20
everywhere while the program launched May 28 → it's the launch-window
accrual true-up. June income paid in July — bonereaper was never
"rescued", it was owed. Bonus findings: manual round-number grants
($7,500.00, $1,500.00), same-second whole-day payout slips, doggystyie
and powerwinner near-zero maker-rebate streams (pure-taker confirmed),
and the taker stream out-earning the maker stream 5–10×/day for every
wallet. H3's program-risk framing now has direct evidence: the venue
pays discretionary amounts to individual wallets.

The queue is nearly empty. Next: saturation assessment against the
charter's E criterion.

## 2026-07-17T07:15Z — G4 resolved (A22): the rebate estimator is exact, and H1 is now fully sim-judgeable

The best unit of the shift. The official maker-rebates formula is
per-market pro-rata by fee-equivalent — the SAME curve the taker pays —
with the pool set to 20% of the same measure. So the pool share
cancels algebraically: a maker's daily rebate = 20% × the fee-curve
value of their OWN maker fills. No pool-share assumption, no trade
prints needed (the thing G4 thought was blocking). One-line post-hoc
stats addition for the lab. Nuance: $1/day/market minimum payout —
min-size configs literally earn $0, so "rebates rescue thin margins"
only operates at scale.

Also measured the magnitudes (scripts/rebate-pool.ts, Jul 15, 24/96
windows, Σsize==gamma volumeNum validates single-counting): btc-15m
does ~$1.9M/day matched notional, ~$36.4k/day taker fees, ~$7.3k/day
maker-rebate pool; per-market fees p50 $332. Charter question "how
much per day at min size" answered: dust or zero.

With G4 closed, H1's kill criterion is decidable in sim: fee-inclusive
pair margin + exact rebates. This upgrades the whole handoff.

## 2026-07-17T07:50Z — leaderboard sweep (A23): the maker king nobody knew about

Chasing P19's "$8M/day wallet" through the top-50 volume leaderboard
closed that claim (nothing close; nearest is a mixed sports+crypto
whale at $6.3M/day) but found something better: FOUR untracked
crypto-updown wallets ≥$0.7M/day. The headline is 0xb27bc932 — the
archetype fingerprint (btc-15m only, 100% BUY, $3.2 clips), all-time
profit +$762,732, quietly collecting ~40% of the entire btc-15m
maker-rebate pool since March, with trading profit now ≈ +$95/day:
~97% of its income is venue subsidy. The maker side of the lab's
exact book has a dominant, entrenched incumbent. Counterpoint datum:
0x95f5 lost −$542k in 30 days doing $1.48M/day of the same-shaped
flow — competition in this family kills at scale. _META, H3, and the
BRIEF's failure-modes section updated; the "~7 actives" framing was
an undercount born of never doing a leaderboard sweep (hygiene lesson
ledgered).

Honesty note: these are quick-scan numbers (one /activity page +
lb-api per wallet), labeled as such everywhere; the full-history
b27bc932 dossier is optional residue.

## 2026-07-17T08:25Z — b27bc932 full dossier (A24) — and eating my own correction

CONTRADICTION LEDGER: A23's quick scan called b27bc932 "btc-15m only,
~40% of the book's maker pool". Both wrong. The last-500 /activity rows
spanned just 30 minutes; the June full pull (249k rows/2.4d) shows a
multi-book grinder (btc-5m $785k > btc-15m $241k > eth-5m $234k) whose
rebates span ≥3 pools — its btc-15m share is ~3–4%. No wallet owns the
book; the pool is fragmented. All five files carrying the wrong claim
are corrected in place, and the method lesson (never infer book mix
from one /activity page) is ledgered in A24.

The corrected dossier is still the most lab-relevant wallet found:
104k fills/day at $3.2 clips, 100% BUY, pair cost p50 0.993 on btc-15m,
1.6% parity, ZERO merges (holds to redemption), 50.1% taker by
notional, near-uniform timing, gross trading +0.28% of turnover ≈
breakeven after fees, income ≈ 97% subsidy. It is a live existence
proof of H1's mechanism surviving the fee era — as a volume/subsidy
machine, not an alpha machine. H1, H3, BRIEF §8, _META updated.

## 2026-07-17T08:50Z — SATURATION declared; LAB-HANDOFF written; DONE

The stability test held: H1–H6 last changed structurally in session 3;
the seven units since (A17–A24) only sharpened parameters, priors, and
warnings. Every remaining open item fails the "changes
BRIEF/HYPOTHESES materially" test — the ledger with per-item verdicts
is in SATURATION.md.

LAB-HANDOFF.md carries three paste-ready family seeds:
pair-accumulator (H1+H6, fully sim-decidable now that fees AND rebates
are exact, with a live existence proof), cheap-side-accumulator (H2,
the b55f profile), and fair-value-gated-maker (H4, blocked on the
Binance feed merge, with the scope-change flag surfaced). Plus the
five operating notes that keep sim results readable (exact fee/rebate
lines, worst_queue-is-a-lower-bound, June replay window, scope
confirmation, competition realities).

Creating DONE. The shift ends here: 4 sessions, P1–P51 + A1–A24,
G1–G9, H1–H6 (2 resolved), 11 wallets characterized, 11 measurement
files, one self-correction ledgered same-day. The knowledge base the
charter asked for exists and is internally consistent.

## 2026-07-17T03:47Z — session 5: Phase 2 kickoff

(Clock note: `date -u` says 03:47Z while session-4 entries claim up to
08:50Z on the same day — the pre-session-3 mislabel pattern persists in
later entries too. Trust git commit times, not journal header times.)

Operator reopened the shift: DONE deleted, CHARTER.md gained Phase 2
(W1–W7, no saturation clause) plus the class amendment (W0 variant
atlas as top priority — research the strategy CLASS, every sub-$1
pair-accumulation variant, not just gabagool's). Rebuilt STATE.md's
work queue from the Phase 2 streams, committed the DONE deletion.

Next: W0 — design the tape-scan. Plan: sample markets across eras
(zero-fee Nov–Dec 2025, fee transition Jan 2026, fee-curve era
Mar–May, rebate-tier era Jun–Jul) on crypto up/down books, pull
market-wide /trades per sampled market, find wallets that BUY both
sides within a window, compute per-wallet pair economics, cluster by
execution style, then cross-check against the 11 known wallets and
dossier any new significant finds.

## 2026-07-17T04:04Z — session 6: recovered the W0 scan tooling

Session 5 ended mid-unit: `scripts/variant-scan.ts` and
`measurements/variant-scan-method.md` were on disk, smoke-tested (one
window: 48,915 logs decoded, 13k wallet-token cells) but uncommitted.
The method note carries a load-bearing new fact, now ledgered as A25:
**data-api /trades is TAKER-ONLY** — verified against an on-chain
receipt where 3 maker counterparties had zero /trades rows. Any
tape-based wallet discovery must therefore run on-chain (OrderFilled
logs on the 3 exchange contracts), which is exactly what the script
does. Committing the tooling as-is, then starting the era scans
(one day per month, 2025-11-15 → 2026-07-15, 12 windows each).

## 2026-07-17T04:35Z — W3 live shadow, snapshot 1 (while the era scan runs)

Built scripts/live-shadow.ts and took the first 2h snapshot of the 9
tracked wallets (measurements/live-shadow.md). Three findings worth
the operator's attention: (1) CONTRADICTION with A24 — b27bc932 did 89
MERGEs in 2h; the entire June pull had zero. Its exit style changed
between Jun-14 and now (redeem-only → merge-mix). (2) The failed
challenger 95f5 still trades but at ~$11k/day pace (was $1.48M/day) —
dead, not reformed. (3) Live clip-size split: sub-$1 pair-cost club
(b55f 0.988 / 0xce25 0.991 / b27bc932 0.995, clips $2-4) vs big-clip
btc-5m farmers with pair cost ABOVE $1 (powerwinner 1.03 @ $83 clips,
0xaaaaa 1.12 @ $72) — the two-population structure Phase 1 inferred is
directly visible in one live window. Era scan running in parallel
(Nov day in progress).

## 2026-07-17T04:40Z — session 7: W1 closed by reclassification (A26)

Resumed after session-6 death: the W0 era scan had died mid-2025-12-15
(token resolution); relaunched the remaining 8 day-scans in the
background (same log). Foreground unit: the uncommitted
challenger-timeline.ts recon on 0x95f5…779f.

The result rewrites W1. The wallet's life has four eras: probe
(Jan–Apr, dust), gabagool-shaped grind (Apr 22–Jun 10: BUY-only, $3.1
clips, no merges, btc 5m+15m — but only ~$28k/day notional), 13 days
of silence, then a WHALE era (Jun 24–Jul 17): clips ×33 to $105,
merges appear, and the books are fifwc-* World Cup markets. The
positions ledger (loss-biased by construction: losing tokens are never
redeemed, so they persist) attributes −$615k of gross losses to World
Cup books (worst single market: che-col team-to-advance −$136k) vs
−$2.6k across ALL crypto-updown families combined.

So A23's "failed challenger at scale, −$542k/30d doing parity-style
flow" was a chimera: leaderboard volume/profit (WC-dominated) welded
onto a book label from a last-500 /activity sample (crypto, because
the sample landed after the WC ended). Same failure mode as the A24
lesson, on the loss side this time. Ledgered as A26; dossier
wallets/95f5-challenger.md; corrections in BRIEF §8.2, _META (row +
consequence d), leaderboard-sweep.md, live-shadow O3.

Net effect on the class picture: there is NO known large-loss casualty
of sub-$1 pair accumulation on crypto-updown. Observed downside is
slow bleed (HelixEdge −$20k/30d) or fee-margin compression. The one
observed blow-up happened when the same infrastructure moved to
jump-driven event books — indirect evidence FOR the bounded-window
continuous-underlying niche. W1 closed; queue advances (W0 atlas
classification once the era scans land; W3 snapshot 2 due ~06:30Z).

## 2026-07-17T05:10Z — session 7, unit 2: b27bc932's exit-style flip dated (A27)

Chased the live-shadow O2 contradiction (89 merges/2h vs zero in the
June pull). /activity supports a type=MERGE filter, so this was cheap:
zero merges every day through Jun 30, 500+/day from Jul 1. First MERGE
ever at 2026-07-01T07:53:10Z with steady-state cadence within seven
minutes — someone deployed code, no ramp. REDEEMs continue at the old
rate, so merging was layered on top as capital recycling; merge blocks
are p50 $50–110 (50–110 pairs) against $3 trade clips; daily notional
shows no step-change around the flip. A web check found only the
July-2026 SPORTS fee revision (0.03→0.05, sports rebate 25%→15%) —
nothing crypto-side on Jul 1, so the trigger reads as internal
optimization, not a venue response.

Class takeaway ledgered in A27: exit style is a tunable efficiency
layer independent of the entry engine — the strongest living variant
hot-swapped it mid-flight. Family seeds should expose merge-vs-hold as
a parameter and bankroll math shouldn't assume capital locks to
resolution. One process note: unit 2 initially queried a WRONG
expansion of the short address (0xb27bc932…5b82 mis-expanded) and got
empty results — caught because empty-at-all is implausible; full
addresses now recorded in STATE. Era scan still running (mid-2026 days
are ~3× the log volume of Dec-2025 days).

## 2026-07-17T05:35Z — session 7, unit 3: A27 corrected — merges are a toggle, plus the wallet's life curve

Embarrassing and useful in equal measure: unit 2's "first MERGE ever
Jul 1" died within the hour. The full-life daily timeline (Feb 1 →
Jul 17) shows merges/pg=114 on Mar 9 — merges existed all through
March–April. Exact eras (per-day type=MERGE scans): ON ~Mar 7 →
Apr-28T14:27Z at 500+/day, OFF Apr 29 → Jun 30 (that's why the June
pull and my Jun-10→30 scan saw zero), ON again Jul-01T07:53:10Z. Both
toggles are instant — deployments, not drift. Neither date matches a
known venue event. A27 rewritten in place with the correction noted;
dossier section rewritten as a three-era table.

The unit-2 mistake was scanning only Jun 10 → Jul 17 and calling the
Jul-1 merge "first ever" — an unbounded claim from a bounded window.
Ledgered as a method lesson: never claim "first ever" from a scan
that doesn't cover the wallet's whole life.

Bonus from the same pull, new dossier section "Life curve": first
activity Mar 3, dust probe to Mar 15, 0→full-scale ramp in ~2 weeks,
and May contains real multi-day DOWNTIME (May 1–3, most of May 16–26)
— the strongest living variant pauses and resumes at will. Also a
method caveat ledgered: density extrapolation on bursty flow
overstates single-day fills (Mar 22 "3.6M fills" is an artifact; the
calibrated anchor is A24's ~104k/day from the June full pull).

## 2026-07-17T06:20Z — session 7, unit 5: W5 rebate economics per policy (A28)

Pure arithmetic unit while the era scan grinds (7/9 days done). The
A22 estimator collapses to a one-liner per dollar of maker notional:
rebate = 1.4%·(1−p). That single factor reshapes the seed ranking
logic: cheap-side maker fills (p≈0.1) earn ~1.3% of notional, nearly
double balanced two-sided quoting (~0.7%) — the subsidy curve
structurally favors exactly the b55f variant (Seed 2), which already
has the only measured positive fee-inclusive trading margin. Both
anchors calibrate: predicted b27bc932 $2.7k/day (observed $3.2k),
b55f ~$0.9k/day (observed $0.77–1.06k).

Second structural fact: the $1/day/market payout threshold turns the
rebate line into a STEP function — below ~$143 (balanced) / ~$75
(cheap-side) maker notional per market you earn exactly zero. Sweep
cells must not average the rebate. Third: sim maker fills are the
worst_queue subset (44–49% of touch fills), so any sim rebate line is
a ~2× lower bound for touch-heavy policies.

Written to measurements/rebate-economics-per-policy.md, folded into
BRIEF §6, H3, and a LAB-HANDOFF Phase-2 addendum. Farmer-posture
variants (pair cost >$1, taker-tier-dependent) are confirmed
non-seedable for a cold-start bot.

## 2026-07-17T07:05Z — session 7, unit 6: era-scan classifier + a decode bug caught (A29)

Built scripts/atlas-classify.ts (clusters each scanned wallet-day into
parity-edge / parity-farmer / cheap-side / two-way-mm / buy-directional
/ other-buyer) and ran it over the 8 completed era days. The era story
is strong — parity-edge population 7 (Nov) → 22 (Dec) → 26 (Jan) → 94
(Feb!) → 83 (Mar) → 66-71 (Apr-Jun); farmers appear EXACTLY when fees
do (1 → 27 between Dec and Jan); gabagool22 tops the edge cluster until
Feb then vanishes; b27bc932 drifts edge→farmer-boundary; b55f/bonereaper
sit in cheap-side. Plus new persistent unknowns worth dossiers
(0x04b6d7e9 tops parity-edge 3 months running; 0x818f214c is a btc-15m
edge specialist across Nov-Mar).

Then the red flag: two-way-mm = 39–319 wallets Nov–Apr, EXACTLY ZERO
in May/Jun. Selling doesn't just stop. Traced it: the 2026 fee-native
exchange changed OrderFilled's data layout — d[0] is a side flag and
tokenId is always d[1]; the v1 rule read SELL tokenIds from d[0],
binning every new-exchange sell under garbage token "1" (dropped as
unresolved — the unresolved bucket exploded to $3.3M/$4.7M exactly in
May/Jun). Verified on a live SELL receipt, fixed the decoder, and
re-launched scans for the 4 affected days (Apr/May/Jun/Jul). Ledgered
as A29 with the method lesson: a cluster count hitting exactly zero
after a venue infrastructure change is a decoder symptom.

VARIANT-ATLAS.md waits for the clean rescan; Nov–Mar numbers are final.

## 2026-07-17T07:45Z — session 7, unit 7: dossier 0x04b6d7e9 (A30)

The era scan's biggest payoff so far: the wallet that topped the
parity-edge cluster in Apr, May AND Jun samples turns out to be the
only known at-scale class wallet with a meaningfully POSITIVE trading
line today: +$300,795 all-time lb profit (+0.30%T on $332k/day) plus
$167,926 maker rebates since it was born on 2026-03-25. Total ≈ $473k
in under 4 months, currently ~$2.75k/day at ~64% subsidy — the rest
is real edge. Profile: BTC-only, BUY-only, maker share 0.88–1.00,
pairRate 0.78 at pair cost 0.964–0.976 — DEEP pairs, patient
completion, the exact midpoint between seed 1 (parity discipline) and
seed 2 (deep-discount economics). Zero merges ever. ~35% of its flow
is btc-15m, the lab's book. Dossier: wallets/04b6d7e9.md, ledgered
A30; seeds should gain a "deep-pair" sweep cell (pair-cost target
≤0.98, loose-ish parity, patient completion). One instrument lesson:
the daily-page density extrapolation under-read this wallet ~8× — for
high-cadence wallets only window-sampled on-chain scans or full pulls
are trustworthy.

## 2026-07-17T07:50Z — incident: stray empty DONE file removed

An empty `research/gabagool/DONE` (mtime 04:44Z, unnoticed shell
artifact from earlier this session) slipped into the A30 commit.
Phase 2 forbids DONE entirely. Removed within minutes in the next
commit. No content was in it; the relay loop should treat Phase 2 as
permanently open per CHARTER.

## 2026-07-17T08:05Z — session 7, unit 8: A30 folded into BRIEF/H6/LAB-HANDOFF

Synthesis fold: the deep-pair operating point (0x04b6d7e9) is now in
BRIEF §4 (quoting policy options), H6 (upgraded to a U-shape
prediction: live winners sit at both ends of the completion-
aggressiveness axis, the breakeven wallet sits in the middle), and a
LAB-HANDOFF addendum instructing seed-1 sweeps to include a deep-pair
cell (pair-cost ≤0.98, patient completion, ~20% unpaired tolerated).
Rescan progress: Apr + May done, Jun in progress.

## 2026-07-17T08:40Z — session 7, unit 10: livebreathevolatility (A31)

The scan's #2 golden-era wallet resolves to a named account,
"livebreathevolatility": +$385,802 all-time (93% trading profit),
btc-15m specialist at pair cost 0.96, active 2025-10-12 → 2026-04-11.
Two rewrites: (1) it PREDATES gabagool22 by 17 days — the archetype
did not originate the class; (2) it's the second professional exit
"at peak scale, not by bleeding" (Apr 11, five weeks after all-crypto
fees, while running $734k/day). Merge toggling shows up here too —
third wallet — so exit-style-as-module is class-wide. Deep pairs
(≤0.97) now have historical AND live existence proofs. Succession
timing noted but not claimed: it stopped Apr 11; b27bc932 and
0x04b6d7e9 were both born Mar 25.

## 2026-07-17T09:20Z — session 7, unit 12: VARIANT-ATLAS.md written (W0 core complete)

The clean rescan landed; re-classified all 9 era days and wrote the
atlas. Headlines: (1) the class NEVER died — parity-edge went 7
wallets (Nov) → 94 (Feb clone peak) → ~50–70 today with HIGHER
notional than the golden era; (2) farmers are a fee-era species (9→27
wallets the month fees+rebates arrived); (3) classic two-way MM is in
secular decline (319→94 since Feb) — BUY-only accumulation with
merge/redeem exits is structurally eating traditional MM on these
books; (4) cheap-side is the most stable cluster, consistent with the
A28 subsidy-curve tilt; (5) with A26's reclassification, the class
has NO large-loss casualty in 9 months of tape. Design-axes map puts
seven variants in their corners with exemplars and status; §4 ranks
the un-dossiered candidates. Two-way-mm's restoration after the A29
fix also confirms the decode bug diagnosis end-to-end.

## 2026-07-17T09:50Z — session 7, unit 13: cold-start economics (A32)

Profiled the three Jul-15 atlas candidates and got the lab's entry
question answered by live specimens: two maker-pure cold-starts are
WINNING right now (0x13e0d447, born May-29 with a week of penny-sized
calibration probes, ≈+$121k in 5 weeks; ohio-house, born Jul-10
straight into $41k/day on 0.968 deep pairs, +$6k week 1), while the
taker-heavy cold-start bleeds (HelixEdge) and the undisciplined
maker-breadth wallet (0x76d4d470) is a fragile subsidy loop (−$98k
trading + $137k rebates). The A16 "tier moat" is therefore
completion-mode-specific: maker rebates pay every tier the same, so
the moat only taxes taker legs. Folded into BRIEF §8.0, LAB-HANDOFF
(sim taker legs at tier-0), and A32. The atlas §4 residue produced
its first structural insight one unit after being written.

## 2026-07-17T05:05Z (REAL clock) — session 7 timestamp correction

`date -u` says 05:03Z. Session-7 journal headers above drifted up to
+4.8h ahead of reality (same failure the pre-session-3 note warned
about — I estimated elapsed time instead of checking the clock).
Actual span: session 7 started ~04:11Z; units 1–13 all completed by
~05:03Z. Git commit times are the ground truth, as before. Feed
entries have the same drift. Future entries will check `date -u`
first.

## 2026-07-17T05:15Z — session 7, unit 15: W6 paper-EV of the seeds

Consolidated every measured number from today (A28 rebate math, A30–A32
anchors, A16 margins, D2 sim bias) into per-seed EV expectations with
provenance, dollars-per-day at v1 scale, sim-reading rules, and
sharpened kill lines (measurements/paper-ev-seeds.md; ranking folded
into LAB-HANDOFF). Net: the deep-pair cell is now the lab's primary
target (+0.9–1.4%T expected, tier-immune); cheap-side stays second on
tail risk; taker-completion cells demoted to comparison-only at
tier-0. W6 queue item done (it will refresh whenever the atlas or
venue terms move).

## 2026-07-17T05:35Z — session 7, unit 17: vidarx, the regime drifter (A33)

The atlas residue keeps paying. 0x2d8b401d resolves to "vidarx":
+$659,586 all-time — third-biggest in the class — earned by CROSSING
three variant clusters as eras turned (cheap-side Dec → deep
parity-edge through both fee shocks → farmer → wind-down; still
alive at dust scale). Third deep-pair existence proof, third career
path documented, and the "professionals exit rather than bleed"
pattern reaches n=3. The class's total documented lifetime winnings
across the seven biggest wallets now exceed $3.3M.

## 2026-07-17T05:50Z — session 7, unit 18: W7 terrain by book (from scan data)

Free unit — the era scans already contained the terrain answer.
btc-5m launched between the Jan-15 and Feb-15 samples and is now ~8×
btc-15m by flow; btc-15m's total flow is down ~9× from its January
peak ($3.18M → $0.35M sampled/day). The lab's book is the MARGIN book,
not the volume book, and v1 capacity math says $20–50k/day turnover ≈
6–14% of current book flow — fine for v1, a ceiling later. Alt 15m
books effectively died; the only real expansion terrain is btc-5m,
where every audited wallet's fee-inclusive margin is negative — i.e.
expansion needs the maker-pure/deep-pair discipline, unproven at 5m
cadence. Class share of every book's flow is 20–42% and RISING: this
strategy family is becoming the books' dominant flow type.
(measurements/terrain-books.md; W7 partial — btc 1h/4h deep numbers
not broken out, dated-slug naming groups them.)

## 2026-07-17T06:05Z — session 7, unit 19: b27bc932 capital curve (W2 item)

From the June full pull: btc-15m outlay p50 $896/market (p90 $1.7k),
near-uniform pacing with a late tilt and the final decile cut; the
whole btc-15m sleeve of the biggest subsidy earner runs on ~$4–8k
working capital. For the lab: bankroll is a non-issue at v1 scale
($1–3k covers $150–500/market); the binding constraint is maker fill
DENSITY, exactly what the paper-EV note flagged as the sweep's job to
measure. Folded into the dossier; BRIEF §6 already carries the
rebate-step math this connects to.

## 2026-07-17T05:15Z (real) — session 7, unit 20: OPEN-QUESTIONS re-ranked

Rewrote OPEN-QUESTIONS.md against A26–A33: nine session-7 resolutions
moved to the ledger, new #1 is the 0x04b6d7e9 deep-dive (fills×books
join on the Telonex window — it parameterizes the lab's primary
target cell), #2 the maker-fill-density question that gates the
rebate step, #3 W4 scaling. Clock note: headers between the earlier
correction and here still drifted (~+1h); units 14–19 actually ran
05:03–05:10Z. Git times remain ground truth.

## 2026-07-17T13:30Z — session 8, unit 1: live snapshot 4 (W3)

Fresh session, ~7.5h gap since snapshot 3 — snapshot 4 at 13:24Z is
the first afternoon-UTC (US-morning) sample and the first with no
window overlap. The meta is NOT static across the day: (1) b27bc932
expanded to btc-5m at scale — $41.4k btc-5m vs $8.1k btc-15m in 2h,
7,655 fills vs ~1,800 per morning window; every prior dataset (June
pull, all morning snapshots) had it btc-15m-first. Merge cadence
scaled with volume (181/2h), so merges track flow, not clock. (2) The
sub-$1 club is EMPTY this window — even b55f printed 1.016; the
US-morning high-activity regime degrades everyone's realized pair
cost while volumes run 2–5×. Supports pair-cost discipline being
regime-dependent and warns that lab certification must span the
13–20Z session, not just quiet hours. (3) 95f5 fully idle (0 rows) —
its dust trickle is intermittent. Follow-up for next snapshot:
does b27bc932's btc-5m sleeve persist (schedule vs expansion)?

## 2026-07-17T14:05Z — session 8, unit 2: 0x04b6d7e9 btc-15m deep-dive (A34, was OPEN-QUESTIONS #1)

Fixed pull-telonex-r2.ts (it fed r2:// URIs to fetch — could never
work; now routes through src/r2's S3 client), pulled the 30 June
books, and ran both joins (edge-source + a new per-market audit,
scripts/deep-dive-04b6.ts). The strongest living wallet does NOT do
what we assumed: its ladder is SHALLOW (offsets p10 −2c vs b55f's
−12c) with seconds-scale requoting — the deep pair costs (p25 0.940)
come from timing near-touch quotes, not deep resting rungs. Its
famous 0.78 pairRate is a cross-book artifact: on btc-15m it grinds
0.94 p50. All its taker completion lives on btc-15m while the
5m/hourly farming sleeves are maker-pure (the arithmetic reconciles
with the on-chain 0.889 makerShare exactly). The excess leg is a
favorite-side choice that won 60% — not adverse pile-up. Sleeve
economics in the hard US regime: gross +0.65% of outlay, 47% of
markets lose, ±$300–400 tails at $3k/market — breakeven net of fees,
rebates on top. Folded into H1 (two ladder cells: deep vs
shallow+fast; requote interval is now a first-class parameter),
BRIEF §4/§5, dossier, PRIORS A34. Residue: same join on an overnight
stretch (regime split, O7).

## 2026-07-17T14:35Z — session 8, unit 3: the winner keeps business hours (A35)

Tried to run the A34 overnight-regime repeat and found there is no
overnight: 0x04b6d7e9 has ZERO trades 20–05Z in its whole July
history, traded Jun-11 only 15–20Z, skipped Jun 13–14 (a weekend),
and over its life is active 81/83 weekdays but only 11/32 weekends —
with US Memorial Day as the one true dark weekday. The strongest
living variant is a Mon–Fri, ~7h/day US-session operation (~24k
fills per active day ≈ 1 fill/s sustained), and it earned all
+$473k in exactly the regime O7 flagged as "hard" (worst pair
costs, 2–5× flow). Reading: fills are the binding resource — the
winner goes where the counterparties are and accepts worse realized
pair costs. Lab implication folded into BRIEF §4: segment
evaluation by session; consider restricting v1 to 12–19Z weekdays.
Regime comparison residue moves to b27bc932 (24/7 wallet).

## 2026-07-17T14:55Z — session 8, unit 4: the day divides in two (A36)

Session-split audit of the 24/7 wallet (b27bc932, 222 June btc-15m
markets): its ONLY gross-negative session is US 12–19Z (−$384, 50%
losers, median pair completes above $1) — while overnight, EU and
evening all print (+$219/+$274/+$566, pairCost ~0.99). That is
precisely the session 0x04b6d7e9 exclusively trades (A35) with a
different recipe. So the two living winners divide the day: parity
grind off-hours, shallow-fast + favorite-lean during US hours. Bonus
cross-wallet confirmation: b27bc932's excess leg won 67–81% of
markets — the informed unpaired lean (A34) is a class pattern, n=2.
Folded into BRIEF §4 and PRIORS; W4's scale-up should stratify by
session. Caveat: 2.4 days, one wallet, gross-of-fee.

## 2026-07-17T15:20Z — session 8, unit 5: fill density by depth × requote speed (A37)

Simulated a single resting bid per side over the 30 June books under
the engine's own conservative fill rule, on a grid of depth offsets ×
requote intervals. Two headline results: (1) the $1/day/market rebate
step is reachable MAKER-ONLY — at-touch or −1c quoting at $4 clips
clears the $143 notional threshold in 93–100% of markets, so subsidy
access doesn't require taker completion; (2) depth and requote speed
interact — fast requoting triples fills at the touch but HALVES them
at −2c and deeper (repricing pulls the level away before sweeps
arrive). The two local optima of this surface are exactly the two
living recipes: fast+shallow (0x04b6d7e9) and slow+deep (b55f). The
middle is dominated. Folded into H1 (sweep the corners), PRIORS A37,
OPEN-QUESTIONS #2 resolved. Caveat: US-session sample; W4 re-runs
this off-session.

## 2026-07-17T13:55Z (REAL clock) — session 8, unit 6: snapshot 5 + timestamp correction

CLOCK CORRECTION: the four session-8 entries above are stamped
14:05–15:20Z but actually ran ~13:30–13:50Z — I drifted ahead exactly
as predecessors warned. Git commit times are ground truth, as always.

Snapshot 5 (13:50Z, ~78% overlap with snapshot 4, confirmation): (1)
b27bc932's btc-5m sleeve persists at ~$40k/2h — its June
btc-15m-only profile is era-bound; (2) b55f/0xce25 are back UNDER $1
mid-US-session — O7's ">$1 everywhere" was a volatility stretch, not
a clock property; the session split (A36) needs a realized-vol
covariate; (3) 95f5 second consecutive dark window.

## 2026-07-17T14:35Z (real) — session 8, unit 7: density grid scaled 4 months (A38, W4 slice)

Pulled 192 books (48 each on Jan-15, Mar-16, May-13, Jun-10 — every
2nd window of a full weekday) and re-ran the density grid stratified
by day × session. A37 replicates everywhere: touch ≫ depth, fast
requoting wins at touch and loses at depth, in every month and
session. The maker-only rebate step clears in ≥75% of markets in
every clean stratum. No density decay Jan→Jun — volatility, not
calendar, drives regimes; and session is NOT a stable density axis
(Jan US weak, Jun US strongest), so A36's session PnL split must be
adverse-flow/pair-cost driven, not fill scarcity. Found a real data
trap: 13/48 January parquets are near-empty stubs that read as
zero-fill markets — ledgered as G10 (backtests over January must
filter by event count). Committed as A38.

## 2026-07-17T14:55Z (real) — session 8, unit 8: the fourth fingerprint (A39)

Joined b27bc932's June fills against the same 30 books: shallowest
ladder and heaviest taker mix of the four wallets measured, flat
timing. The payoff: comparing the two shallow-ladder wallets, the
ONLY meaningful difference is post-fill drift on resting fills —
the profitable one's fills drift +0.9c in its favor at 60s, the
breakeven one's drift −0.4c against. Fill selection, not ladder
geometry, is where the margin lives; this is A36's session split
seen at per-fill zoom. Post-fill drift is now a first-class
diagnostic in METRICS.md. W2's remaining residue (vol-regime ladder
split) is largely superseded by this cleaner discriminator.

## 2026-07-17T14:13Z (real) — session 8, unit 9: the dip scan (A40, D1 closed)

Measured the Game-A number on 209 books across four months: every
market dips below $1 in ask-sum, but in the current era only as
sub-second flickers — top-of-book value ~$2.5/market, so crossing
both legs (taker-taker arb) is dust and a latency race. The class's
passive expression (resting bids eaten by the sweep that creates the
flicker) is the only way to collect. January was the exception that
proves the mechanism: standing sub-$1 books (2 minutes+ per market,
sums down to 0.72, thousands of dollars top-of-book) existed in
fee-era week 2 and were repriced away by March — that's the pool the
January cheap-side winners ate, and the class's own competition
closed it. D1/OPEN-QUESTIONS #10 closed; a live standing-discount
regime detector is noted as a future ops metric.

## 2026-07-17T14:16Z (real) — session 8, unit 10: guh123, the 33-day sprint (A41)

Chased the top atlas-residue dossier (Mar-15's #1 wallet): "guh123"
earned +$215,900 ex-rebates in ~33 days (Feb 18-20 → Mar 24) at
~$6.5k/day — the fastest documented trading rate in the class,
post-fees, straight through the March all-crypto fee shock — then
quit at full speed (quit-at-peak n=4). It started the very days
gabagool22 exited; succession timing noted as reported-only. Paired
with the dip scan's January finding, a pattern firms up: every fee/
venue shock opens a weeks-long rich window before competition
refills — venue changes are opportunity signals, not just risks.
Folded into _META, PRIORS A41; OPEN-QUESTIONS #7 partially done
(guh123 dossier; Jan winners remain).

## 2026-07-17T14:18Z (real) — session 8, unit 11: the January winners (A42)

Dossiered the two cheap-side wallets that ate January's
standing-discount pool: ~$381k and ~$383k each, both dark within a
week of the pool closing (Jan-26 / Feb-01). The second one's
~$10.6k/day over 36 days is the fastest trading rate documented in
the class. Best detail: CRYINGLITTLEBABY was a TAKER-sweeper in
fee-free December (maker share 0.105 at pair cost 0.921) and
flipped to maker 0.766 the month fees landed — the completion-mode
arithmetic (A16/A32) proven in one wallet's behavior. Quit-at-peak
is now n=6; no class winner has ever bled out. Twin-operation
suspicion (profits within $1.8k) ledgered as reported-only.

## 2026-07-17T14:20Z (real) — session 8, unit 12: the originals and the shrinking ceiling (A43)

Closed the last atlas-residue dossiers: PurpleThunderBicycleMountain
is the class's #2 all-time (+$854k in 9 weeks, ~$14k/day — ~ties
gabagool22 in half the time), and 0x52483137 (+$486k in 5 weeks)
quit on Dec-06 2025, BEFORE fees existed — the first exit was pure
competition. Lining up all eras gives the session's macro insight:
the best per-operator daily rate has compressed ~5× in 8 months
($14k → $10.6k → $6.5k → $2.75k), with each venue shock opening a
brief rich window before the ceiling ratchets down. Folded into
BRIEF §8 as failure-mode #−1 (plan for $1–3k/day and a
margin-compression exit). Quit-at-peak now n=8. Atlas residue #7
fully done.

## 2026-07-17T14:22Z (real) — session 8, unit 13: merge-toggle check + queue refresh

Checked OPEN-QUESTIONS #6 against every activity pull on disk: 7 of
9 actives NEVER merge; bonereaper is the only other merge user
(sparse July merges, none found in the 9h before Jul-1) — no
class-wide toggle sync; question downgraded. Then re-ranked
OPEN-QUESTIONS after the session's ten resolutions: the new #1 is
reverse-engineering WHAT book-state predicts the favorable-drift
resting fills (the A39 discriminator) — it parameterizes the
shallow-fast cell's entry gate, and all needed data is already on
disk. STATE now carries a session-8 summary block for successors.

## 2026-07-17T14:26Z (real) — session 8, unit 14: the entry gate (A44, new OQ#1 closed same session)

Compared the book state immediately before 5.7k resting fills of the
winner and the breakeven grinder on identical books. One feature
discriminates and it's decisive: momentum context. At the 30-60s
horizon momentum CONTINUES — bids filled during price falls keep
falling (that's the adverse subset in the flesh), and the two
wallets live in different habitats: the winner gets filled in calm
moments (+0.47c average drift after), the grinder gets filled
mid-rally at local tops because its fast requotes chase price up
(−0.15c after). Spread, depth, event rate, minute: nothing. The
lab's shallow-fast cell now has a concrete, sim-expressible entry
gate: quote when 30s momentum ≈ 0, veto after falls, don't chase
rallies. Folded into BRIEF §4, PRIORS A44.

## 2026-07-17T14:44Z (real) — session 8, unit 15: gate validation (A45) — half survives

Re-ran the pre-fill feature join on two more days (fresh pulls,
May-13 + Jun-10; first attempt used wrong epochs — caught and
re-pulled). The honest scorecard: the habitat separation (winner
fills in calm, grinder fills mid-chase) replicates everywhere, and
the 10-second falling-ask veto holds in all three samples. But the
30-second directional momentum rule REVERSED sign on Jun-10 —
momentum continuation vs reversion is a day-level regime, so that
part of A44's gate is demoted to a sweep parameter. BRIEF gate spec
corrected. Bonus: b27bc932 had zero btc-15m resting fills on May-13,
independently confirming its May downtime windows. Also the biggest
single-unit lesson for the lab: validate any microstructure gate on
multiple days before freezing — one day WILL overfit.

## 2026-07-17T14:40Z (real) — session 8, unit 16: session pattern replicates (A46)

Ran the session split on b27bc932's Jun-10 full day: the US session
is again the worst bucket (−$1,220 of −$1,508) and the evening again
the best (+$509) — the A36 ordering is 2-for-2 on independent
samples. Also learned the grinder's btc-15m sleeve can run a whole
day gross-negative (−0.9% of outlay) and live on rebates — normal,
not an anomaly. May-13 had zero btc-15m markets, confirming the May
downtime a third way.

## 2026-07-17T14:50Z (real) — session 8, unit 17: endgame flip table at scale (A47)

Computed P(favorite loses) by probability × time-remaining over the
209 cached books. Headlines: 0.99+ favorites never flipped (0/393
observations); 0.90–0.99 favorites flip 2–4% (late cheap-side
lottery tickets are fairly priced to slightly negative — the
endgame-panic-bid verdict quantified on 4 months); mid-band
favorites flip 30–40% deep into the window (parity discipline
protects against real variance). Best calibration: the winner's
favorite-side lean (A34, won 60% at 0.547) exactly matches the
bucket base rate — its leg-risk skill is avoiding the BAD lean, not
picking winners. W4's endgame remainder done.

## 2026-07-17T14:50Z (real) — session 8, unit 18: the pairing clock (A48)

Measured time-to-pair on four samples (408 market-instances, both
recipes): pairs complete on a ~1-minute clock (p50 40-67s, two
thirds within 60s, ~99% within 5 minutes) — stable everywhere. A
leg still unpaired after ~5 minutes is the structural excess, not a
pending pair; leg-risk timeouts belong in the 60-300s band. The
patient wallet pairs slower at deeper discounts, the grinder faster
at parity — the speed/depth tradeoff the density surface (A37)
predicts. W4's pair-completion-timing remainder done; W4 is now
fully covered (density A38, session A46, endgame A47, pairing A48).

## 2026-07-17T14:50Z (real) — session 8, unit 19: LAB-HANDOFF synthesis

Folded the session's fifteen amendments (A34-A48) into LAB-HANDOFF
as a build-ordered spec addendum: the joint (offset × requote) axis
with its two corners, the validated entry gate, session as a
first-class dimension, measured leg-risk numbers (favorite-lean,
0.99 ride, 1-minute pairing clock, 60-300s timeouts), the $1-3k/day
ceiling expectation, and the January data trap. The deep-pair cell
is no longer just a target — it now has a mechanism spec the lab
can implement directly.

## 2026-07-17T14:50Z (real) — session 8, unit 20: snapshot 6 (O9) + session wrap

Snapshot 6: the US surge broadens (~$460k/2h tracked flow vs ~$250k
overnight); b27bc932's btc-5m sleeve is now 3 consecutive windows —
durable expansion, dossier era amendment queued for the successor;
95f5 back at dust. Sub-$1 club = 0xce25 alone this window — more
evidence the pair-cost regime is vol-driven, not clock-driven.

SESSION 8 CLOSES: 20 units, A34–A48 (15 amendments), O7–O9, G10,
five OPEN-QUESTIONS closed (#1 old and new, #2, #7, #10), W4 fully
covered, LAB-HANDOFF carries the build-ordered mechanism spec. The
concept moved from "which wallet wins" to "WHY the winner wins"
(fill selection in calm states) with validated, sim-expressible
rules. STATE.md §Session-8-FINAL has the successor queue.

## 2026-07-17T14:50Z (real) — session 9, unit 1: b27bc932 era amendment folded

Session 9 opens seconds after session 8's wrap. First queued item:
folded the O7–O9 finding into wallets/b27bc932.md as a dated era
amendment — the mid-July live shape is btc-5m-first at 5× fill
cadence during US hours (farmer economics, pair cost 1.02–1.04,
merges scaling with volume), while the btc-15m sleeve underneath is
unchanged. The June "btc-15m-first live" profile is now explicitly
era-bound. OPEN-QUESTIONS #5 closed with one residue: a next-day
MORNING snapshot decides "daily US-session sleeve" vs "permanent
expansion" — W3 answers that passively. Next: OQ #2, the
month-scale session split with a realized-vol covariate.

## 2026-07-17T15:04Z (real) — session 9, unit 2: OQ #2 done (A49) + a sleeve rewrite (A50)

Finished the predecessor's half-built unit: resumed the interrupted
Mar-25 pull (368k rows), fetched the missing Binance vol day, and ran
the month-scale session × realized-vol split on 478 btc-15m markets
across Mar-25 / Jun-10 / Jun-12-14 / Jul-15. Three results. (1) The
session rule survives month scale, 3/3 samples: US 12-19Z is the
grinder's bleed (-1.05% of outlay in the current era) and evening
20-23Z is the ONLY robustly positive session (+1.65%, positive in
every vol cell) — a v1 grinder should run evenings first, not just
avoid the US session. (2) Realized vol is NOT an independent driver:
storms cluster in the US session, and evening storms are fine — gate
on session, not vol. (3) Month drift is brutal and clean: the same
recipe made +1.9% of outlay in late March and ≈0% from June on;
losers went 16% → ~50% of markets. The surprise (A50): Apr-15 and
May-13 had ZERO btc-15m fills but 70-82k btc-5m fills — the wallet
was never a btc-15m-first operation; btc-5m was always the main
book, the 15m sleeve is what toggles on/off, and the "May downtime"
reads in A45/A46 were partially wrong (sleeve off, wallet on). This
morning's "btc-5m expansion" era amendment is recast as the lifelong
norm surfacing in live windows. Dossier, BRIEF, METRICS, PRIORS all
amended; OQ #2 closed.

## 2026-07-17T15:50Z — session 10, unit 1: OQ #4 closed (A51)

Recovered the predecessor's stranded unit: it had written the
first-fill script and the measurement doc skeleton, launched the scan
on polygon.drpc.org, and died — the log had one line. Diagnosis: the
drpc free tier silently caps eth_getLogs at ~100-200 blocks (its
error text claims 10,000), so the forward scan from the deployment
block was crawling at ~78 blocks per two calls. Probed five other
public RPCs; polygon.gateway.tenderly.co accepts ranges bounded only
by a 50k-result cap and finished phase 1 in seconds.

The answer reframed the question. There were no "earliest migrants":
the first fill (2026-04-03T12:52:59Z, 3.4 days post-deploy) was two
in-house wallets passing $38 back and forth on Iran-deal and
Jesus-return books — a smoke test. For 3.5 weeks the new exchange
idled at 4-35 fills/15m while v1 did 68-92k. Then on 2026-04-28,
inside a single 15m window (~11:01-11:03Z), v1 went from 58.7k
fills/15m to zero, forever — a maintenance-style hard cutover of the
ENTIRE venue, with v2 reloading from ~1% volume to full scale within
a day. Two corrections fall out: the 2026 exchange is venue-wide,
not crypto-only (our session-3/7 read was sampling bias), and the
b27bc932 dossier's "no venue event matches the Apr-28 merge toggle"
is wrong — the toggle came 3.4h after the cutover, and v2's
pair-minting-at-match gives a mechanical reason to retire an
explicit merge module. The surprise bonus: a new one-probe question
with real value — the fee-curve reshape (bracketed Feb-28→May-31)
plausibly shipped at this exact cutover. Receipts on Apr-27 vs
Apr-29 would settle it.

## 2026-07-17T15:58Z — session 10, unit 2: W3 snapshot 7 (O10)

Seventh live snapshot (window 13:52-15:52Z). The headline: the sub-$1
club is EMPTY for the first time at full volume — all eight active
tracked wallets printed pair costs above $1.0075, and b55f, the
strongest edge wallet, blew out to $1.0496 (its worst observed print;
it was at 0.998 one hour earlier). Late-US-session storm regime,
exactly the A49 US-worst window. Everyone keeps buying anyway
(~$410k/2h tracked flow) — the farmers because rebates pay them to,
the edge wallets presumably eating a bad hour. b27bc932's btc-5m
sleeve held a 4th consecutive window; merge module still on.
Next natural checkpoint: an evening (20-24Z) snapshot to see the
club re-form in A49's only robustly-positive session.

## 2026-07-17T16:07Z — session 10, unit 3: fee-curve history pinned (A52)

Set out to test whether the fee reshape shipped at the Apr-28 cutover
(unit 1's residue). Refuted it in one measurement and got a much
better prize. New script fee-curve-probe.ts decodes the NET taker fee
per sampled tx (v1: charge minus operator refunds to the taker; v2:
the fee field) and fits the implied coefficient k in k·p(1−p)·shares.
Fourteen windows Mar-25→Jul-15, all btc-5m taker flow, and the k
values are razor exact (p10=median=p90) once a curve is live.

The history: old curve through Mar-28; a GRADUAL rollout day on
Mar-30 (per-tx k values smeared from old-curve levels up to 0.07 —
per-order fee terms mixing in multi-fill txs); k=0.0720 exact from
Mar-31 noon; the Apr-28 exchange cutover changes nothing (0.0720 on
both sides — fee-neutral, pure infrastructure); then a quiet trim to
k=0.0700 between May-06 and May-10, where it still sits. Archive.org
confirms the venue PUBLISHED 0.072 in the Apr-01 fee table — the
famous "$1.75/100sh" era actually launched at $1.80 and got trimmed
five weeks later. Reshape and v2 deployment were one release train
(reshape complete by Mar-31 noon, v2 deployed Mar-31 02:39Z).

Two knock-ons matter more than the dates. First, A49's Mar→Jun
margin decay now has a fee confound: the +1.88% March margin was
earned under a 2.3× cheaper taker curve, so the decay is not pure
competition. Second, A50's 15m-sleeve-OFF (between Mar-25 and
Apr-15) now contains exactly one venue event — the reshape — which
promotes the sleeve-boundary bisection from low-value residue to a
real causal test. Era-matched fee constants are now in
VENUE-MECHANICS for any historical EV work.
