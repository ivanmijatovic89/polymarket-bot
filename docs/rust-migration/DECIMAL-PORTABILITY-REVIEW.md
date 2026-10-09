---
title: DECIMAL Target Portability Review
description: Exact cross-platform Node power evidence and focused native repair.
---

# DECIMAL target portability review

Published `33dbaf89` and diagnostic-only `d20b0dc9` failed Ubuntu native CI at raw DECIMAL scale218. The macOS-captured divisor caused a two-bit output difference. Both hosts ran Node20.20.2/V8 11.3.244.8-node.38: darwin/arm64 returned divisor bits `6d3221563a9b7323`, linux/x64 `6d3221563a9b7322`. Their cold/hot310-power tables agreed within each host and differed only at218. Exact captures bind Node executable identities, CI run/job/revision and the official V8 source hash.

The native helper now selects an explicit reviewed target profile, preserving the Linux218 divisor and the macOS table. The comparator independently checks all310 current Node powers against the matching capture and requires the frozen native executable to identify the same target. Five deliberate profile mutations must fail; twelve codec response mutations must fail. The exact numeric comparison remains unchanged.

Independent debug/release747 comparisons pass against a frozen snapshot containing published `d20b0dc9` plus only the proposed DECIMAL repair files. Eleven focused native units and strict all-target Clippy pass. The snapshot excludes unfinished SDK/OrderManager/replay changes; reports under `evidence/decimal-portability-independent-*.json` carry their own source/build/tool/dependency identities. Those identities apply to the focused repair source set, not unrelated moving work.

The extracted official V8 pow implementation also reproduced the observed ARM divisor with floating contraction enabled and the Linux divisor with contraction disabled. This is supporting experimental evidence, not a blanket assertion about compiler flags in every Node release. Actual captured Node bits are authoritative here.

Further deployment targets/runtime profiles remain an explicit full-migration acceptance dependency. The current guard for unverified high-scale targets is a development limitation, not permission to reject any supported production input permanently. Whole reader/schema/error/Buffer identity, replay modes/feeds, native strategy/SDK/OrderManager, live/fleet/consumer integration and final benchmark remain required. No complete runtime or speed claim is made.

Focused repair `4ed263cf` now passes all seven remote CI checks, including exact debug/release codec and actual-reader comparisons on Ubuntu and macOS. Terminal evidence is `evidence/decimal-portability-ci-4ed263cf.json`. The local frozen source set was also rebuilt in its own private Cargo target and all111 tests, strict Clippy and747 debug/release codec comparisons rerun; updated reports replace the earlier shared-target evidence. See `EVIDENCE-BUILD-ISOLATION.md` for the reproduced artifact-collision defect and its proof policy.
