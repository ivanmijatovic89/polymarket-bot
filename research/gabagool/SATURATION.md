# SATURATION — why this shift is done

Written 2026-07-17 (session 4), per charter workstream E: workstreams
have stopped changing STRATEGY-BRIEF/HYPOTHESES/METRICS **materially**.
The evidence for that claim, then the residue and why it doesn't move
the needle.

## The stability test

The hypothesis set (H1–H6) last changed STRUCTURALLY in session 3 (H6
added, H3/H5 resolved). Everything since — A17 (edge execution
fingerprint), A18/A19 (resolution + venue limits), A20 (lifecycle +
flip table), A21 (payout provenance), A22 (exact rebate estimator),
A23/A24 (leaderboard sweep + maker-king dossier incl. self-correction)
— sharpened parameters, priors, and warnings INSIDE that structure.
The BRIEF's mechanism section (§1), fair-value options (§3), and
leg-risk policy (§5) have been stable across the last seven units. New
data kept confirming, quantifying, or correcting details — not
reopening design questions. That is saturation as the charter defines
it.

## What is now known, in one paragraph

The concept verifiably made money three ways across three eras:
zero-fee parity-grinding (archetype, +1.9% of turnover, dead by regime
change), fee-era taker-heavy completion with real edge (b55f +2.31%
fee-inclusive on btc-15m, alive), and fee-era parity-grinding as a
subsidy volume machine (b27bc932, pair cost p50 0.993, ~breakeven
trading, $3–4k/day rebates, alive). Fees and rebates are now EXACTLY
modelable per era (A13/A14/A16/A22 — the rebate pool-share cancels);
the sim's fill model admits 44–49% of real fills (D2) so absolute sim
EV is a lower bound while relative rankings (esp. completion policy,
H6) are trustworthy; the venue's books are 1c-tight all window with
front-loaded churn and back-loaded winner flow (A17/A20); and the
competitive field is ~11 known wallets, a fragmented rebate pool, one
−$542k/30d corpse, and a tier-based fee moat against cold starts
(A16/A23/A24).

## Residue ledger (each judged against "changes BRIEF/HYPOTHESES materially?")

| item | verdict |
|---|---|
| drfc4eybh7i8 re-resolution + badfallen/doggystyie/0xaaaaa dossiers | NO — all four are classified (farmer cluster) in actives-decomposition + fee-audit + _META; a dossier adds biography, not policy |
| b27bc932 handle/era-split/operator-cluster | NO — its role (H1 existence proof + subsidy end-state) is established; era split would only confirm the front-load pattern every wallet shows |
| 2026-exchange contract launch date | NO — fee mechanics are exact per era already; the date is venue trivia |
| 1-pUSD marketable-order minimum primary source | NO — resting orders (the concept's substance) are governed by the verified 5-share min |
| Chainlink boundary-report sampling | NO — likely unknowable from public docs; bounded as ±1 report (~sub-second) in VENUE-MECHANICS |
| more literature (A3+) | NO — A1/A2 cover inventory control, adverse selection, queue value; further reading refines nothing the data hasn't already fixed |
| D1 in its original form | RE-SCOPED (P38) — instantaneous sum-of-asks is impossible (mirror-book); the time-separated version is what wallets measure |
| deeper flip-table cells (0.5–0.6 × <60s) | NO for this shift — flagged to the lab as a watch-cell (n=23); it's a lab-scale sweep, not a priors question |

## Charter deliverable checklist

- PRIORS.md (P1–P51 + A1–A24) ✓ ; STRATEGY-BRIEF.md ✓ ; HYPOTHESES.md
  (H1–H6, 2 resolved) ✓ ; METRICS.md ✓ ; VENUE-MECHANICS.md ✓ ;
  ENGINE-GAPS.md (G1–G9) ✓ ; OPEN-QUESTIONS.md (all high-value items
  resolved; residue ledgered above) ✓
- wallets/: gabagool22, b55f-incumbent, powerwinner, bonereaper,
  b27bc932 dossiers + _META (the three farmer handles are covered
  per-wallet inside actives-decomposition + fee-audit tables; judged
  sufficient — see residue ledger) ✓
- measurements/: tail-forensics, era-comparison, d2-fill-reality-gap,
  jan-transition, fee-audit-actives, actives-decomposition,
  edge-source-btc15m, window-lifecycle-btc15m,
  rebate-payout-provenance, rebate-pool-btc15m, leaderboard-sweep ✓
- LAB-HANDOFF.md — written next, then DONE.
