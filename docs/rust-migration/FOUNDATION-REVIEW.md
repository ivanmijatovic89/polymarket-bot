---
title: Native Foundation Review
description: Independent findings, fixes and limits of the initial migration milestone.
---

# Native foundation review

A reviewer who did not author the protocol, client or statistics implementation inspected the integrated files and independently reran the client/process and full-output statistics checks. All five reported P2 findings were repaired and rechecked. No remaining blocking defect was found within this bounded review. This does not certify the full trading rewrite, fleet deployment or a production speed multiplier.

| ID  | Finding                                                                      | Verified repair                                                                                                                                  |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | JSON accessors and serialization hooks could change validated payloads.      | Descriptor-only traversal rejects hooks, accessors, proxies, custom array prototypes and ignored properties without invoking them.               |
| R2  | TS accepted greater nesting than the native parser.                          | Shared container limit 124; cached subtree heights preserve depth checks for reused references. Boundary and boundary-plus-one regressions pass. |
| R3  | Native calendar rejected part of the valid JavaScript Date range.            | Pure Gregorian arithmetic covers the whole TimeClip domain, small-year UTC quirks, expanded-year substring labels and derived clipping.          |
| R4  | Python comparator accepted JSON numbers as booleans.                         | Symmetric Boolean/number distinction with ten scalar/nested mutation checks.                                                                     |
| R5  | A concurrent build could replace the executable fingerprinted after testing. | Execute a frozen binary copy verified before/after; fingerprint and recheck oracle sources and runner/wrapper files.                             |

Final independent results: 40 client tests, 7 actual executable integration tests, 94 full-output statistics scenarios over 28,899 market rows, and 10 comparator mutation checks passed. No tests were skipped. The year-zero leap-day normalization is a durable fixture.

## Parent-loss evidence correction

The initial Node-managed stdin pipe test inspected `writableEnded`, which did not prove the writer stayed open after the intermediary parent died. That earlier evidence claim was too strong. The final test retains an independently owned `O_RDWR` named-FIFO descriptor inherited as native stdin. The guarded runtime exits after parent SIGKILL; an otherwise identical unguarded negative control remains alive. A separate watchdog-EOF test keeps stdin open and verifies exit code 130. The reviewer inspected descriptor ownership and reran the final tests.

## Scope and provenance

The executable advertises only `describe_runtime` and `aggregate`, with empty strategy/input-mode lists and `liveTrading: false`. Other operations fail explicitly. Evidence is recorded in `evidence/foundation-validation.json` and `evidence/foundation-stats.json`, including source/oracle/fixture/build identities and commands. These files describe this checkpoint; changes require affected checks to be rerun.

Shared core, strategies/plugins, replay inputs, live signing/execution/accounts/blockchain, traces/simulator, job/fleet deployment, persistence/extensions and final benchmarks remain required acceptance work. External artifact coverage and complete schema contracts remain pending.
