# AUDIT 2026-07-12 — BATCH-005 fresh-context batch checker (verbatim report)

_Run per SCREENING.md §5 + amendment 4 immediately after the verdict
ledger commit 2ceed0e (session 67). Checker was fresh-context (did not
watch the batch being built or judged). All 3 findings are MINOR and
were applied in the same unit (commit noted in git); the 0/19/1 verdict
tally stands unchanged._

---

# BATCH-005 Verdict Ledger — Fresh-Context Checker Report

**Checker:** fresh-context batch checker (SCREENING.md §5 + amendment 4) · **Date:** 2026-07-12 · **Ledger:** `/Users/mijat/Sites/polymarket-bot-fable/fable-lab/protocol/registry/screens/BATCH-005.md` @ 2ceed0e · **No files modified.**

## 1. Numbers match DB — VERIFIED (9 runs re-derived)

Re-derived independently via `npx tsx fable-lab/tools/results.ts --batch <uid> --json`. Every field matches the ledgered table at the table's rounding precision:

| batchUid | run | N | played | q̂ (DB) | t (DB) | EV/mkt (DB) | winRate (DB) | won/lost | ledger row | match |
|---|---|---|---|---|---|---|---|---|---|---|
| SCR-025-A | 525 | 2000 | 196 | 0.0410 | 1.8323 | 0.4516 | 0.6224 | 122/74 | 0.0410 / 1.83 / 0.452 / 0.622 (122/74) | ✓ |
| SCR-025-B | 526 | 2000 | 241 | 0.0246 | 1.0993 | 0.2938 | 0.6473 | 156/85 | 0.0246 / 1.10 / 0.294 / 0.647 (156/85) | ✓ |
| SCR-023-A | 521 | 2000 | 0 | null | null | 0.000 | null | 0/0 | — / — / 0.000 / — (0/0) | ✓ |
| SCR-023-B | 522 | 2000 | 0 | null | null | 0.000 | null | 0/0 | — / — / 0.000 / — (0/0) | ✓ |
| SCR-020-A (maker-TP) | 514 | 500 | 361 | −0.0667 | −1.4923 | −1.0135 | 0.9501 | 343/18 | −0.0667 / −1.49 / −1.014 / 0.950 (343/18) | ✓ |
| SCR-012-A (maker-TP) | 536 | 500 | 468 | −0.2797 | −6.2532 | −3.5462 | 0.8526 | 399/69 | −0.2797 / −6.25 / −3.546 / 0.853 (399/69) | ✓ |
| SCR-011-B (taker-SL) | 498 | 500 | 496 | −0.1747 | −3.9073 | −3.2823 | 0.1835 | 91/405 | −0.1747 / −3.91 / −3.282 / 0.183 (91/405) | ✓ |
| SCR-017-A | 510 | 2000 | 16 | 0.0117 | 0.5228 | 0.0224 | 0.3125 | 5/11 | 0.0117 / 0.52 / 0.022 / 0.313 (5/11) | ✓ |
| SCR-029-B | 535 | 2000 | 1434 | −0.0203 | −0.9075 | −0.5534 | 0.8040 | 1153/281 | −0.0203 / −0.91 / −0.553 / 0.804 (1153/281) | ✓ |

Zero mismatches. `failures: 0` in every pulled JSON. Internal consistency also holds (won+lost = played in every row; e.g. 122+74=196).

## 2. Verdicts follow the frozen bars — VERIFIED (all 20 re-applied by hand)

Frozen rule: SURVIVE iff both samples q̂>0 ∧ t≥+1.5 (∧ E14 minority ≥30 for SCR-020/023); PARK-DESIGN iff both played=0; else KILL.

- **SCR-025**: A clears (0.0410, 1.83); B fails t (1.10 < 1.5) → KILL ✓ (one-sample survival = kill, per rule).
- **SCR-023**: played 0/0 in both → PARK-DESIGN ✓.
- **SCR-017** (0.52, 1.00 both t<1.5), **SCR-015** (0.63, 0.23) → KILL ✓.
- **SCR-018, SCR-029, SCR-024**: one sample q≤0, other t<1.5 → KILL ✓; per-sample reason annotations (e.g. SCR-024 "A:q≤0 B:t<1.5" with A q̂=−0.0759, B t=0.29) all correct.
- **SCR-013/014/016/019/027/028/020/022/011/021/010/026/012**: both samples q̂≤0 → KILL ✓. SCR-020's E14 minority counts (18, 21 losses < 30) would independently block survival, but kill already follows from q≤0; annotation "A:q≤0 B:q≤0" is accurate.

Tally re-derived: **0 survive / 19 kill / 1 park-design** — matches the verdict statement exactly.

## 3. No post-results spec edits — VERIFIED

`git log --oneline -- BATCH-005.md`: exactly three commits — dd41894 (freeze) → 5ce1494 (smokes + pre-submission amendment 1) → 2ceed0e (verdicts). Nothing after 2ceed0e; working tree clean for this file.

- **dd41894 → 5ce1494**: only removed lines are the smoke-section placeholder ("_To be appended before submission..._"); additions are the smoke table (counts only, no PnL) and amendment 1 (fsig pending-signal fix). No mini-spec bars, N, params, or predictions touched. The amendment is pre-submission (fleet runs 496+ all postdate re-smoke 495) and explicitly reads no PnL.
- **5ce1494 → 2ceed0e**: only removed lines are the Verdicts placeholder ("_To be appended: one ranked table..._"); 115 added lines, all inside the Verdicts section. Append-only confirmed.

## 4. Amendment-4 re-verification — VERIFIED (one MINOR nuance)

- **(a) 0 failures**: `failures: 0` in all 9 results.ts JSONs I pulled; `runs.ts --limit 45` shows `fail=0` on all 41 rows 496–536.
- **(b) exactly 41 rows, every batchUid once**: confirmed. IDs 496–536 = 41 rows = 40 unique `SCR-0NN-{A,B}` + run 499 (`PARITY-496-latcheck`). The out-of-sequence claim also checks out: 534 = SCR-019-A, 536 = SCR-012-A, single rows each.
- **(c) latency pin**: run 499 exists in the DB, `PARITY-496-latcheck`, `markets=12`, completed — matching the citation. Submit artifacts DO exist on disk: `fable-lab/logs/b5-submit.sh` contains `export BACKTEST_LATENCY_DELAY=0` / `BACKTEST_LATENCY_JITTER=0` at the top, and `fable-lab/logs/b5-submit.log` records all 40 enqueues (80 batchUid lines, 2 per submission, commitSha=44817851). Honest caveat: the log itself has **0 grep hits** for the env var — the pin lives once in the wrapper script's `export`, not on each logged command line. The ledger's phrase "all 40 submit commands carried BACKTEST_LATENCY_DELAY=0" is functionally true via environment inheritance but not literally visible per-command in the log. The empirical parity re-run (499, byte-identical rows) remains the real evidence. Grade: MINOR.

## 5. Verdict-statement prose — largely disciplined, two MINOR nits

The SCR-025 paragraph is careful: no edge language, explicitly flags the winner's-curse caveat and says "nothing in this batch distinguishes" real effect from curse artifact. SCR-023 correctly attributes the park to the spec's incidence prior, not the mechanism. Two nits:

- "Exit structures RESHAPE the payoff but **cannot manufacture edge from a fair entry**" — a general causal law asserted from 8 exit cells at one parameter point each; the table supports "every tested exit variant lost," not impossibility. MINOR wording.
- Taker-SL win-rate range stated as "0.07–0.23"; SCR-027-B is 0.233, marginally above the stated ceiling. MINOR transcription/rounding.

## Findings

1. **MINOR** — Latency-pin phrasing: "all 40 submit commands carried BACKTEST_LATENCY_DELAY=0" is realized as one `export` in `fable-lab/logs/b5-submit.sh`, not per-command flags visible in `b5-submit.log` (0 grep hits there). Artifact exists; parity run 499 is the empirical proof. Not verdict-affecting.
2. **MINOR** — Over-general prose: "exit structures ... cannot manufacture edge from a fair entry" generalizes beyond the two samples × 8 tested cells.
3. **MINOR** — Win-rate range "0.07–0.23" for taker-SL excludes SCR-027-B's 0.233.

No MAJOR findings. All 9 re-derived runs match the DB exactly; all 20 verdicts follow mechanically from the frozen bars; the ledger history is genuinely append-only after results existed; all three amendment-4 integrity claims re-verify.

## Overall verdict: **SOUND-WITH-FINDINGS** (3 MINOR, 0 MAJOR — the 0/19/1 verdict tally stands as ledgered)
