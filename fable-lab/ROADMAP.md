# Fable Protocol — Roadmap

Ordered work units. Check off as completed. See STATE.md for live status.

- [x] **U0 — Scaffolding**: ROADMAP.md, STATE.md, DECISIONS.md skeleton; commit + push.
- [x] **U1 — Engine study (Phase 0, mandatory)**: deep read of engine docs + source;
      write `engine/CAPABILITIES.md` with file citations for every claim,
      including what the engine does NOT support.
- [x] **U2 — Engine study verification**: fresh-context subagent audits
      CAPABILITIES.md claims against source; fix discrepancies.
- [x] **U3 — Protocol design core**: epistemology + experiment lifecycle.
      How ideas are generated/deduplicated/prioritized; pre-registration of
      experiments (bias protection); evidence thresholds justified from first
      principles; decision points. Write `protocol/` docs + DECISIONS.md entries.
- [x] **U4 — Memory & resumability design**: what is remembered, where; how a
      zero-context session resumes; knowledge transfer format.
- [x] **U5 — Tools**: working scripts in `tools/` (results reader over MySQL /
      dashboard API, batch analyzer, submission helper, experiment validator).
      Each validated (typecheck + read-only run or ≤10-market --sequential smoke).
- [x] **U6 — Session prompts & role contracts**: apply
      `docs/reference/prompting-claude-fable-5.md`; write the prompts/skills the
      operating Fable sessions will use.
- [x] **U7 — Morning runbook**: step-by-step operator guide (`RUNBOOK.md`).
- [x] **U8 — Final self-review**: fresh-context verifier checks the whole lab
      against CHARTER.md; fix findings. (Historical note: originally ended with
      "create `DONE`" under charter v1; charter v2 made the mission perpetual —
      `DONE` is the OPERATOR's kill-switch and must never be created by us.)

## Perpetual phase (charter v2)

The build phase above is complete. From U9 on, work units are the research
loop itself (register → smoke → probe → judge → lesson → next), tracked live
in STATE.md "Done" / "In progress" / "Next" — not enumerated here in advance,
because the next unit depends on the last verdict.
