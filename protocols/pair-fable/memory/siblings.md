# Sibling-workspace review

Cross-protocol reads are allowed (human ruling, inbox c68ea4ce 2026-07-30:
pair-* loops may read each other's `memory/**` and `state/PROPOSALS.md`;
writes stay own-protocol). This note records each review pass so future
sessions know what exists elsewhere and when to look again.

## 2026-07-31 — session 7 (mission 02): first full pass

Inventory `[db ls protocols/ + find | 2026-07-31]`:

- **`protocols/pair/`** — the HUMAN's design workspace for the multi-model
  team (not an agent loop): `VISION.md` (empty placeholder), `VISION_AI.md`
  (design v6), `DECISIONS.md` (settled design decisions), `RULES.md`,
  `missions/00-build-runtime|01-explore-and-build|02-research.md`,
  `scripts/setup-model-worktree.sh` + pre-commit hook. No `memory/`, no
  `state/`, no `strategies/`. Nothing to import as research evidence — it is
  the template our own workspace descends from.
- **`protocols/pair-codex/`** — a Codex/GPT sibling loop that has NOT
  started: only `RULES.md`, `VISION.md`, `missions/01-explore-and-build.md`.
  No `memory/`, no `state/`, no `strategies/`, no runs in `backtest_runs`
  under a pair-codex protocol tag would exist yet (workspace has no tooling).
- **pair-opus / pair-sonnet** (named in session-6 STATUS): DO NOT EXIST —
  that was an error; the only pair-* siblings on disk and on origin/main are
  the two above.

**Conclusion: there is no sibling research memory to mine yet.** No
mechanism, experiment, or negative result exists outside our own
`memory/experiments/`. Re-check is cheap (`ls protocols/*/memory 2>/dev/null`)
— do it when a future session starts, especially after the human announces
the Codex loop has launched.

Two template facts worth citing (both already covered on our side):

1. `protocols/pair/DECISIONS.md` §4 + `VISION_AI.md` backtest rule: mid-episode
   `merge_positions` is mis-scored by the simulator (human-verified
   2026-07-26: full merge → $0, partial merge → negative on a profitable
   trade). Already binding in our `RULES.md` (lines 65–68) and mapped in
   `capabilities/parity.md` §3.
2. `VISION_AI.md` phase P2.5 plans a ~$50 micro live probe whose stated
   purpose — "measures whether sub-$1 pairs are actually capturable against
   live competition, the one question no backtest can answer, and calibrates
   the simulator" — is design-level precedent for our P-009/P-010 option 1
   (live fill-quality measurement). Cited in the P-010 addendum.
