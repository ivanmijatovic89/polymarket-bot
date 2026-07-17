# Gabagool Lab — DECISIONS

Design forks, with the rejected option and why. Append-only.

---

## D-000 (2026-07-17): Phase 0 via parallel digests, not serial reading

**Chosen:** fan out subagents to digest the four inherited corpora (KB,
fable-lab, strategy-research-protocol, repo-root docs) into a single
INHERITANCE.md; I personally verify only the engine footguns in code
(they are load-bearing for simulator trust) and read the KB's
STRATEGY-BRIEF/STATE myself (they shape the design directly).

**Rejected:** reading everything myself serially — burns most of a session
on ingestion before any lab exists; fable-lab's failure mode was spending
tokens on meta-work instead of experiments. Verification effort must be
proportional to decision stakes: engine semantics get first-hand
verification, narrative history gets digests.
