# Family: pair-v7 (taker-lead pair) — Phase 0: data scan

Third axis after the E-014 class kill, first of the two remaining
inside-RULES untested axes (STATUS session-4 plan). Every killed family led
with a MAKER leg and paid for it in adverse selection (−0.06/share per-start
invariant, decomposed in pair-v6.md). pair-v7 inverts the leg order:

> Buy side Y at its ask as TAKER (paying the 0.07·p·(1−p) fee), and in the
> same decision rest a maker bid on side X at its current bestBid. Enter
> only when `askY + fee(askY) + bidX ≤ gate`. If X's bid fills before the
> window ends, the pair is complete below the gate; if not, hold Y to
> settlement (buy-only residue — no sells, per RULES).

Why this could live where the others died: the entry condition needs only a
WIDE combined book (cross-spread ≥ fee), not a dutch book (pair-v5 needed
ask+ask < 1, sub-ms) and not a trade-through instant (pair-v6's fills were
adversely selected before completion could react). The entry state can
persist; a 140 ms-late arrival meets a book that chose to stay wide. And
the residue you hold is the side whose ask was stale-LOW while the other
side's bid crashed — typically the side gaining at entry, the opposite
carry profile from the killed families' doom (holding the crashed side).

## Pre-registered definitions (written BEFORE the scan ran)

- **Universe**: pinned to session 4's scan range for comparability — latest
  800 eligible btc-15m markets with `market_start_ms ≤ 1784762100000`
  (slugs 1784043000 → 1784762100, 07-14 → 07-23), all local. Same engine
  book reconstruction (`replayTelonexDeltaParquetForMarket`), same fee
  curve 0.07·p·(1−p).
- **Entry moment (direction d, Y = taker side d, X = other side)**: at an
  event's post-apply state, `askY + fee(askY) + bidX ≤ 1.00` (loosest
  gate). Both directions scanned independently. Refractory 5 s per
  direction. Tighter gates are analyzed by filtering moments on their
  detection-time cost (`entryCost = askY + fee(askY) + bidX`); a
  tighter-gate strategy would see a subset of these moments (refractory
  interaction is second-order, accepted).
- **Gate grid**: 1.00 / 0.99 / 0.98 / 0.97. Note gate 1.00 completions earn
  ≈ 0 by construction — the economics per gate are the readout.
- **Execution model (latency-honest, 140 ms)**: decision at t, orders
  arrive at t+140 ms (as-of book state).
  - Taker leg = marketable limit at askY(t): succeeds iff
    askY(t+140) ≤ askY(t), executed at pY = askY(t+140) (price improvement
    allowed); otherwise the entry ABORTS entirely, cost $0 (FOK semantics,
    and the maker bid is canceled unfilled — optimistic by one cancel
    round-trip, noted as bias).
  - Maker leg = bid at bX = bidX(t), active from t+140. Worst-queue fill
    (simulator.md): fills at the first event with bestAskX < bX. If
    already bestAskX(t+140) < bX at arrival, it fills CROSSED (taker):
    fee(bX) charged; otherwise the eventual fill is maker, $0 fee.
    Crossed fraction reported.
- **Completion pnl/share** (bid filled before window end):
  `1 − (pY + fee(pY) + bX + feeX)` — pair valued at settlement ($1), per
  RULES backtest rule (no mid-market merge in sim).
- **Residue pnl/share** (bid never fills): `1{Y wins} − (pY + fee(pY))`
  (outcome from `resultId`: '0'⇒UP wins, '1'⇒DOWN wins).
- **Headline**: per-market EV = Σ over entries of 10 × pnlShare
  (10-share increments), mean over ALL 800 markets, per gate. Decomposed
  into completed-pair contribution vs residue contribution. Also: entries
  per market, P(bid fills | entry), time-to-fill distribution, residue win
  rate vs mean pY.
- **Sane band**: entries with pY ∈ [0.10, 0.90]; verdicts on full set AND
  sane band (kill requires both to fail).
- **Zero-latency counterfactual**: same detection moments, taker fills at
  askY(t), bid active from t — bounds what latency costs (confounder a).

## Pre-registered priors (honest)

Entry moments should be far more common than pair-v5's dutch books —
combined cross-spread ≥ ~1.75c (mid prices) happens in every volatile
window. The open questions the scan decides: (1) does the FOK re-check
survive 140 ms often enough (if askY reprices before arrival, this family
inherits pair-v6's death); (2) does the maker completion leg fill at a
useful rate — X's bid just crashed, completion requires X to keep falling;
if X mean-reverts the bid strands; (3) what the stranded-Y residue is
actually worth — the "you hold the winning side" story is a hypothesis,
not a fact; momentum-vs-reversion at 15 m scale decides its sign. Any of
the three can kill alone; all three must cooperate for BUILD.

## Pre-registered verdicts

- **BUILD v7**: per-market total EV ≥ $0.25 at some gate in the grid
  (sane band and full set agreeing on sign), entries in ≥10% of markets,
  AND fill rate ≥ 20% with completed-pair contribution ≥ $0 — the
  mechanism must actually pair, not be a disguised momentum bet.
- **DIRECTIONAL-SIGNAL (separate outcome)**: total EV ≥ $0.25 but driven
  by residue with fill rate < 20% — that is not a pair family; record the
  numbers, do NOT build under this family, and raise the strategy-space
  question in PROPOSALS instead.
- **WEAK**: total EV in [$0.10, $0.25) at the best gate — record, revisit
  only if it stacks with another family.
- **KILL the family**: total EV < $0.10/market at EVERY gate in the grid,
  on both the full set and the sane band. Time-scoped as always.

Confounders pre-committed: (a) zero-latency counterfactual reported — if
EV exists at 0 ms but dies at 140 ms, latency-sensitivity red flag (RULES);
(b) FOK survival rate reported — < 30% is the same red flag from the entry
side; (c) taker-leg depth: fraction of entries with askY size ≥ 10 shares;
(d) entries/market distribution (a family firing in 3% of markets cannot
carry goal 1); (e) BIAS DIRECTION IS ASYMMETRIC: the maker-leg fill proxy
assumes a perfectly fresh quote (overstates fills and completion rate), so
a KILL on completion economics is a fortiori, but a BUILD is NOT — a BUILD
verdict here only licenses Phase-1 strategy code whose backtest under the
real simulator is the confirming evidence. The taker leg has no such bias
(true depth-walk parity, pair-v5.md §Parity note).

## Phase-0 results (E-017, scanned 2026-07-31, session 6) — VERDICT: KILL

Scan executed by session 6 (session 5 died mid-scan; the pre-registrations
above were committed before any scan ran — 8513649 bars, c348f15 code).
Archive: `memory/experiments/data/bookscan-2026-07-31-s6-latest800.json`
(scans A–D, 800/800 pinned markets, 199.5M events; scan-A and scan-B/δ=0
outputs reproduce the session-4 archive EXACTLY, validating the extension).

**Entry frequency (confounder d fails first).** 334 entries at the loosest
gate (1.00) across 264/800 markets (33%), 0.42/market; sane band 204
entries. Tighter gates collapse: 56 entries at 0.99, 32 at 0.98, 23 at
0.97 (≤7% of markets). Taker-leg depth ≥ 10 sh in 74% of entries (c OK).

**FOK survival 44.6%** at gate 1.00 (below 50%, above the 30% red-flag
line): askY reprices within 140 ms in more than half of the moments —
the pair-v6 death mechanism, attenuated but present.

**Maker completion actually works mechanically** — fill rate 69% of
surviving entries (89% at 0.99), crossed-at-arrival only 1%, time-to-fill
p50 28 s. This is the first family where the completion leg fills. But:

**Economics fail at every gate** (per-market total EV, 10-sh increments):

| gate | entries | pairs EV/mkt | residue EV/mkt | TOTAL EV/mkt (all / sane) |
| --- | --- | --- | --- | --- |
| 1.00 | 334 | +0.036 | −0.093 | **−0.057 / −0.048** |
| 0.99 | 56 | +0.029 | −0.008 | **+0.020 / +0.020** |
| 0.98 | 32 | +0.026 | −0.007 | **+0.018 / +0.018** |
| 0.97 | 23 | +0.026 | −0.007 | **+0.018 / +0.018** |

Best gate +$0.02/market vs the $0.10 kill bar — and the maker-fill proxy
is OPTIMISTIC (fresh-quote assumption inflates fills and pairs EV), so
these numbers are upper bounds (pre-registered bias direction, e).

**The residue hypothesis is REFUTED, hard.** Pre-registration hoped the
stranded taker side is "the side that was winning at entry". Measured:
residue win rate **2.2%** (n=46, mean pY 0.177, −0.162/share). A cheap
ask inside a wide combined book is cheap because it is informed — the
unfilled-completion branch strands you on the LOSING side, same doom as
every killed family, now from the taker side.

**No latency red flag (confounder a): the family is unprofitable even at
zero latency.** Zero-latency counterfactual at gate 1.00: −$0.19/market
(worse than 140 ms, because FOK-dead entries at 140 ms are free aborts
while at 0 ms they execute and strand); tighter gates +$0.004–0.007. This
axis does not die of latency — it dies of adverse selection in the entry
condition itself.

**Verdict per pre-registered bars: KILL the family** — total EV < $0.10 at
EVERY gate on both the full set and the sane band (max +$0.020).
DIRECTIONAL-SIGNAL outcome not triggered (EV never ≥ $0.25). Time-scoped
2026-07 as always.
