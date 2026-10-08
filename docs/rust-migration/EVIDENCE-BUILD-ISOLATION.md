---
title: Evidence Build Isolation
description: Prevent cached native binaries from being attributed to a different source tree.
---

# Evidence build isolation

A frozen DECIMAL review snapshot temporarily reused the active worktree's Cargo target directory. Cargo package artifact paths collided between checkouts: later the active Portfolio source contained20 tests while a nominally fresh binary listed18 historical tests. The reviewer rejected that stale result and rebuilt independently. This was a real harness defect; hashing a frozen executable alone does not prove it was compiled from the recorded source bytes.

Evidence builds must never share a Cargo target between different source roots. Frozen snapshots use their own private target. Each agent uses an independent target for its current worktree-only proof. Do not clean another agent's shared target or overwrite source bytes merely to force compilation. Verify meaningful expected test-name/count sentinels before accepting cached test artifacts, and bind the exact source/dependency/tool identities to the actual compiled executable.

The focused DECIMAL repair was rebuilt from scratch in the frozen snapshot's private target and its debug/release747 comparisons rerun; all111 native tests and strict lint were also rerun there. Updated reports replace the earlier shared-target results and remain restricted to that exact repair source set. All seven remote CI checks on published4ed263cf now pass, including both native hosts.

The affected active-worktree Portfolio/OrderManager proofs are being rerun in private targets. Earlier reports retain their own dates/source identities; no broad current-source acceptance may be inferred from them. Exact owning-executor scheduling and the entire production migration remain incomplete.
