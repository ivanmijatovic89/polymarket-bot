# External strategy artifact compatibility inventory

This is a read-only inventory and migration work specification. It does not certify a native strategy port, full catalog coverage, or production speed. The shared live/backtest runtime must execute the same native strategy version and parameter contract; historical JavaScript artifacts cannot be treated as native Rust executables.

The existing [strategy inventory](strategy-inventory.json) proves 73 loaded definitions at engine reference `07245602d6ff9bca0dcdf772134cba3dd227526c`. It deliberately leaves external artifacts pending. The new [artifact inventory](artifact-inventory.json) preserves independently observed immutable versions rather than adding their strategy IDs to that 73-item count.

## Observed evidence

The capture on 2026-10-08 used reviewed project helper `listStrategyArtifacts(1000)`, which returned **372 rows across 316 strategy IDs**, fewer than the cap. This establishes that this single catalog query exhausted its results at observation time. It is not a cross-service consistent snapshot, a run-reference audit, or an R2 listing. No SQL update, artifact import, strategy factory, trading connection, or remote object download was performed.

| Evidence set                                                                       | Observed result                                                          | Meaning and remaining work                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer artifact catalog                                                          | 372 immutable SHAs; 363 format v2, 9 format v1                           | Each SHA is a separate version, even when strategy IDs match. The current TypeScript loader accepts only v2. Preserve v1 evidence and its existing rejection semantics; do not silently rewrite its identity. |
| Primary local cache                                                                | 155 SHA-named `.mjs` files                                               | Explicit root `/Users/mijat/Sites/polymarket-bot/data/strategy-artifacts`; this is a cache, not the required strategy list.                                                                                   |
| Isolated local cache                                                               | 1 SHA-named `.mjs` file                                                  | Explicit migration worktree cache; one SHA overlaps the primary cache.                                                                                                                                        |
| Union of catalog and caches                                                        | 374 unique SHAs, 156 cache copies                                        | Includes 2 cache-only versions. Their required historical/live/job status remains pending.                                                                                                                    |
| Catalog bytes locally available                                                    | 153 SHAs                                                                 | All observed cache byte hashes matched their filenames; no artifact code executed.                                                                                                                            |
| Catalog bytes unavailable locally                                                  | 219 SHAs                                                                 | Required remote retrieval/reference reconciliation remains pending. Missing bytes do not mean unused or excluded.                                                                                             |
| Dirty publications                                                                 | 143 catalog rows                                                         | A Git commit alone cannot reconstruct the exact published working tree. The immutable bundle is the authoritative code identity.                                                                              |
| Direct historical entrypoint checks                                                | 11 files found at the recorded commit/path                               | 7 were dirty publications; all 11 still need transitive dependency/build reconstruction.                                                                                                                      |
| Other historical source checks                                                     | 356 missing paths/alternate publish anchors; 5 unmapped source locations | Among mapped repositories, 335 commit objects were local and 32 were unavailable locally. Missing paths often need publish-root/layout recovery; no remote Git fetch was attempted.                           |
| Current external source candidates                                                 | 85 tracked candidates in `polymarket-protocols`                          | Static source observations at external HEAD, not a loaded catalog and not historical artifact coverage. Nontracked/ignored sources and other repositories remain pending.                                     |
| Current engine source candidates                                                   | 74 broader static source candidates                                      | This scan also notices re-exports/helpers; the independently captured loaded catalog remains 73. Never substitute this count for registration evidence.                                                       |
| Run rows, active/retained jobs, R2 object set, other fleet caches, live selections | Pending; counts are `null`                                               | None of these sets has been enumerated here. A null count is not zero.                                                                                                                                        |

The sanitized producer metadata snapshot SHA is `1763f08ec2e8539022c7de48ce3a920f8f7411f02ce3ee9f3fa6124dddabd3be`. Every row is retained in the generated inventory. It contains source commit, entrypoint, dirty flag, publisher engine commit, format, byte size and sanitized storage location. It does not retain database credentials, URL userinfo/query tokens, params, commands, market results or arbitrary extra snapshot fields.

Two explicit source roots were inspected:

- Engine checkout HEAD: `07245602d6ff9bca0dcdf772134cba3dd227526c`.
- External `polymarket-protocols` HEAD: `155fa585bea79ad77c1002a167e62f1060261aeb`.

The inventory stores document hashes for current bytes and HEAD bytes, tracked strategy source hashes, current source hashes, and working-tree differences. Existing external edits to README, smoke setup report and runtime launcher tools were preserved. All 85 observed external tracked candidate files and all 74 engine candidate files matched their corresponding HEAD bytes at observation. Untracked sources are not inferred absent.

## Static findings that affect the port

Cached runtime imports include `zod`, `#pmb/strategy/strategyToolkit.ts`, three plugins (`ExternalFeedsRequestPlugin`, `DwellGatePlugin`, `TimeWindowGatePlugin`), `#pmb/trading/fees.ts`, and Node builtins `node:fs`, `node:path`, `node:zlib`, `node:crypto`. Bundle inspection records import specifiers, plugin constructor names, literal banner/definition fields when recoverable and schema-expression hashes. These observations cannot establish API usage completeness or executable semantics.

Of 156 observed cache copies, 52 definitions were not recoverable as a literal strategy ID: examples build `definition` with shared factories and indexed variant arrays. These entries remain visible with the published catalog ID and unresolved static fields. The inventory never invokes a factory or `schema.safeParse` to fill the gap. Static discovery is not a permission boundary or a substitute for reviewed execution traces.

Node builtin dependencies matter: a strategy bundle can contain file access, decompression, hashing, helper state and arbitrary bundled npm logic. Identify exactly which of those operations occur at module initialization, factory construction, market callbacks or account callbacks. Port the required helpers and side effects into native runtime/strategy support or a reviewed acquisition stage with equivalent availability and ordering. Moving a live decision or per-tick callback into TypeScript would violate the intended native shared core. Do not discard file/crypto behavior because a simpler benchmark strategy did not use it.

The current publisher intentionally bundles external repo helpers and npm dependencies, while engine modules remain external through a semi-stable `#pmb` SDK. The allowed engine paths are `strategy/**`, `trading/feeds/**`, `market/**`, and the exact `trading/fees.ts` module. Zod remains external. The allowlist does not constrain bundled Node builtin use. Publish metadata is first-insert provenance: it is not part of the bundle SHA, and unchanged bytes published from different working trees can share a SHA. Recoverability therefore requires the artifact bytes as well as provenance.

## Coverage and acquisition contract

Build a required-version set from the union of:

1. All supported in-repo loaded definitions, plus visible skipped/malformed protocol candidates and their diagnostics.
2. All producer catalog SHAs, keeping every immutable version.
3. Every SHA referenced by historical run rows and run-row fallback metadata, including missing catalog rows used by `--extend`.
4. Active, waiting, delayed, failed, retained and parent/dependency queue payload references in both queues. Explicitly classify retained completed jobs if they remain reachable.
5. Configured live strategy selections and producer launch/source selectors.
6. Current external strategy sources and historical bundle-only/source-repository variants, including unmapped and cache-only versions.

Discovery state and required support classification are separate. A removed legacy version can be classified with evidence, but cannot disappear from the ledger or be excluded merely because bytes are absent. Changes after the captured baseline need an append-only delta ledger and a final discovery refresh before cutover.

The next read-only DB step needs a project-owned helper for exhaustive, stable, paginated run artifact references. Existing helper `getRunForExtension(id)` can validate a known run but cannot prove that every orphaned reference was found. Add the query to the correct shared DB module through its owner; this inventory task does not add inline SQL against `strategy_artifacts`. Do not query giant per-market result JSON. Compare counts, IDs and pagination boundaries; distinguish table absence, access failure, truncation and successful zero results. The producer catalog helper's descending limit is bounded and has no stable pagination contract; a cap hit must remain incomplete.

For queue discovery, review and use read-only payload/set enumeration without creating workers, consuming jobs or mutating BullMQ bookkeeping. Record queue name, job identity, state, protocol version, strategy ID, SHA and storage reference; sanitize payload locations and omit unrelated secrets/results. Preserve parent and child references. Capture the observed boundary and concurrent-change caveat rather than claiming a stable full queue snapshot.

Retrieve required missing artifacts using their exact storage refs; SHA-verify bytes before any inspection or execution. Enumerate remote objects only if needed to reconcile references/unrecorded immutable objects. Inspect other three fleet caches and their engine/native build identities. Do not silently fall back to a registry ID, newest artifact, a newer source checkout, or the same ID at a different SHA.

For historical source recovery, distinguish these cases explicitly:

| Source state                                                     | Required treatment                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean publish, entrypoint and dependencies recoverable at commit | Rebuild with captured entrypoint anchor, dependency/toolchain versions and external SDK reference; compare exact legacy SHA. A matching entrypoint hash alone is insufficient.                                 |
| Publish anchored under a protocol subfolder                      | Recover the original repoDir/relative-entrypoint pair from provenance, bundled source comments and matching Git tree paths; record the inference and validate by reproducing bytes. Do not guess a new anchor. |
| Dirty publish                                                    | Recover exact bytes from the immutable bundle and any preserved working tree/build evidence. A clean source commit cannot certify equivalence. Review shared factory/helpers included in the bundle.           |
| Source repository moved or local temp repository gone            | Preserve legacy SHA and storage ref; recover archive/object bytes and record source availability. Do not replace the artifact with a similarly named file.                                                     |
| Commit absent from local checkout                                | Perform a later bounded Git retrieval with provenance/object checks; this capture disables lazy fetch and reports it pending.                                                                                  |
| No source, but verified bundle available                         | Treat bundle semantics as the reference; a reviewed native port must compare full traces and schemas. Lack of original source is a required recovery task, not a coverage exception.                           |
| Legacy format v1                                                 | Preserve its immutable code/version and current rejection evidence. Specify and test any deliberate historical compatibility bridge separately; republishing under v2 creates a new SHA.                       |

## Native build and version mapping

A `.mjs` hash remains a historical identity. Rust cannot directly execute it. Native strategy publishing needs a new versioned descriptor/build contract, and every legacy SHA needs an explicit mapping to the native implementation or its evidenced legacy rejection state.

A native descriptor should carry at least: legacy source artifact SHA when applicable, native strategy identity/version, exact recovered source tree/bundle reference, parameter contract version/hash, required plugins/feeds, SDK/core ABI version, native build SHA, dependency lockfile/toolchain version, build features, target architecture/OS, and parity fixture/report identities. Preserve publisher provenance separately from code identity. A single logical strategy ID with several legacy SHAs must retain several mappings. Mac fleet architecture differences require separately verified build hashes without changing the strategy semantic version.

The producer validates selectors and params against native metadata, checks requested feeds, and places the immutable native descriptor/build reference into jobs. The TypeScript control plane may retain queue submission, scheduling, DB transactions, API and UI duties. Native backtest and live runtime both resolve the same descriptor and execute the same native strategy core. There is no target in which a TypeScript live strategy callback or TypeScript signer handles the migrated per-tick trading path.

Preserve selector behavior for `--strategy`, `--strategy-artifact`, `--strategy-file`, `--extend`, direct worker jobs and live launch. Current `.ts` authoring and `--strategy-file` auto-publish cannot silently work after deleting the JavaScript strategy runtime: provide the native authoring/build workflow and port current external sources/SDK consumers, then update their check/publish/launch instructions. Before enqueue/live startup, unsupported old source selectors must fail explicitly with actionable version/migration information. Transitional legacy workers are an isolated compatibility path, not an all-native completion claim.

Existing caller-relative source rules are part of compatibility: `PTE_CALLER_PWD`, then `INIT_CWD`, then cwd; realpath symlinks; nearest ancestor `.git`; caller-provided manual publish roots; entrypoint containment; deterministic banner bytes; registry ID collision rejection for fresh launch; inherited SHA retained for extensions; fallback run metadata when the catalog row is missing; worker strategy-ID mismatch rejection. Current external protocol layout uses `pte --dir`, a compatibility engine symlink, nested `protocols/<name>` workspaces, and sparse fleet checkouts. Preserve those contracts or ship a tested, documented replacement. Do not alter research-owned files as an incidental migration side effect.

## Required implementation work and ownership

These are proposals for the migration acceptance ledger, not completed milestones.

| ID     | Work                                                                                                                | Dependency and owner boundary                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ART-01 | Exhaustive run/job/live/fleet reference reconciliation and final delta refresh                                      | Control-plane/DB owner; independent reviewer checks completeness and count boundaries.                                                            |
| ART-02 | Required immutable byte acquisition, SHA verification, v1/v2 classification and provenance/anchor recovery          | Artifact migration owner; no executing unreviewed bundles during discovery.                                                                       |
| ART-03 | Per-version parameter contract: coercions, defaults, refinements, unknown-key policy, error cases, canonical params | Native strategy SDK owner; review Zod behavior against an isolated pinned TS reference. Field names or schema-expression hashes are insufficient. |
| ART-04 | Native SDK parity for all actual toolkit, fee, market, portfolio and plugin usages                                  | Shared-core/plugin owners; inventory real usage, including helpers bundled from external repositories.                                            |
| ART-05 | Per-version strategy/factory/helper port and reviewed builtin/npm replacement                                       | Strategy owner; dependencies ART-02/03/04. Include module setup, callbacks, restart/reset and state isolation.                                    |
| ART-06 | Native descriptor/build/publish/check/reproducible-cache pipeline                                                   | Native build + artifact owner; includes multi-architecture builds and hash/ABI validation.                                                        |
| ART-07 | Producer/worker/extend selector integration and immutable DB metadata migration                                     | Control-plane owner; needs ART-06 and preserves run fallback/collision semantics.                                                                 |
| ART-08 | Native live selection and identical strategy version/params/plugin semantics                                        | Native live owner; needs shared core and ART-05/06. No TypeScript per-tick bridge.                                                                |
| ART-09 | External repository authoring/tooling/instructions and sparse fleet deployment update                               | Explicit external-repository owner; source changes tracked separately from engine baseline.                                                       |
| ART-10 | Full per-version trace fixtures, independent validation oracle and malicious/malformed metadata failure cases       | Independent test/review owner; coverage is version based, not one selected benchmark.                                                             |
| ART-11 | Cutover gate, queue drain/version compatibility and rollback with legacy references preserved                       | Deployment/control-plane owner; no production deletion before all required gates pass.                                                            |
| ART-12 | End-to-end timing for full real workloads with native build/download/cache costs reported                           | Benchmark owner after ART-01–11; no production multiplier inferred from static inventory.                                                         |

Ownership stays non-overlapping: shared core/plugin ports do not own external research source changes; DB/fleet owners do not implement strategy decisions; the artifact owner supplies descriptors and recovery evidence; independent review verifies traces and reference coverage. The migration coordinator integrates accepted changes and retains every pending ledger item until evidence closes it.

## Acceptance scenarios

Every required SHA/version needs schema/params, feed requirements, native mapping and full decision/accounting trace evidence. Generated factories may share native implementation only when variant-specific params/defaults, callback behavior and lifecycle are verified for every mapped version.

- Select each supported definition/source/artifact for both native replay and captured live input; compare ticks, plugin snapshots, strategy state transitions, client order IDs, intents, order/account callbacks, portfolio state and final outputs against the immutable TS reference. Include empty/missing feeds and synthetic-tick opt-ins.
- Validate defaults/string coercion, booleans, finite/bounds/refinement failures, unknown keys and aliases; verify producer and worker cannot disagree about canonical params or required feed selection.
- Cover fills before acknowledgements, duplicate/out-of-order account updates, cancellation/replace failures, batch placements, split/merge, risk reservations, episode rotation, late old-market events, first-snapshot/warmup and reset isolation. Use the same native strategy core for live and backtest.
- Reproduce old SHAs from recovered clean source when possible; test dirty/bundle-only provenance explicitly. Verify module-init/factory helpers and every imported builtin/npm behavior used by required artifacts.
- Reject corrupt cache bytes, wrong storage bytes, wrong native binary hash, unsupported architecture/ABI/SDK/format, malformed descriptor, unknown SHA, ID mismatch, source path escape, collision on fresh launch and unsupported `.ts` selectors before trading/job execution. Never substitute another strategy.
- Extend a saved run after its producer catalog row is missing; inherited SHA and meta remain authoritative. A newer registry definition with the same ID cannot replace the inherited version.
- Run identical immutable versions/params on each fleet architecture, cold and warm caches, restart/retry/cancellation and parent death. Verify deployments update external tooling and remote worker build availability without launching research missions.

The current static inspector supplies no executed schema, feed or native trace evidence; all those fields remain pending. No migration completion percentage or speed multiplier is justified by this document.

## Reproduction and checks

Use Node 20. The generator only scans explicitly supplied roots; hashes bundle streams; statically parses bundles up to 2 MiB; rejects symlink/nonregular cache files; sanitizes metadata locations; records parse/factory gaps; disables Git lazy fetch; and never calls loader, publisher, `create()` or schema methods. A publish dry-run is unsuitable because it primes/imports executable bundles.

The metadata input contract is a sanitized JSON object `{query, limit, exhausted, rows}`. `rows` are projected results from reviewed `listStrategyArtifacts(limit)`, with the catalog fields preserved in the generated inventory. `exhausted` means fewer rows than the cap, not a universal service snapshot. Credentials and unrelated values must never enter the snapshot. Preserve the sanitized snapshot hash and query/limit evidence; a fresh DB observation can differ and requires a new delta, not overwriting the prior version ledger unnoticed.

To reconstruct the captured sanitized metadata input from this inventory for a deterministic offline rerun:

```bash
/Users/mijat/.nvm/versions/node/v20.19.6/bin/node --input-type=module -e '
import fs from "node:fs";
const inventory = JSON.parse(fs.readFileSync("docs/rust-migration/artifact-inventory.json", "utf8"));
const rows = inventory.artifacts.flatMap(item => item.metadata);
fs.writeFileSync("/tmp/artifact-metadata-reproduction.json", JSON.stringify({query: inventory.catalog.query, limit: inventory.catalog.limit, exhausted: inventory.catalog.status === "bounded-query-exhausted-at-observation", rows}));
'
```

The reconstructed input has a different byte-order hash from the original helper snapshot; artifact/version observations should match. For byte-identical output, retain the original sanitized snapshot and unchanged source/cache roots. Source documents/caches can change independently; compare and record drift explicitly.

```bash
/Users/mijat/.nvm/versions/node/v20.19.6/bin/node --import tsx scripts/rust-migration/inventory-artifacts.mts \
  --cache-root /Users/mijat/Sites/polymarket-bot/data/strategy-artifacts \
  --cache-root /Users/mijat/.codex/worktrees/rust-backtest-benchmark/polymarket-bot/data/strategy-artifacts \
  --source-root /Users/mijat/Sites/polymarket-protocols \
  --source-root /Users/mijat/Sites/polymarket-bot \
  --metadata-snapshot /tmp/artifact-metadata-reproduction.json \
  --reference 07245602d6ff9bca0dcdf772134cba3dd227526c \
  --output /tmp/artifact-inventory-reproduction.json

/Users/mijat/.nvm/versions/node/v20.19.6/bin/node --import tsx --test scripts/rust-migration/inventory-artifacts.test.ts

/Users/mijat/.nvm/versions/node/v20.19.6/bin/node node_modules/typescript/bin/tsc \
  --noEmit --strict --skipLibCheck --target es2022 --module nodenext \
  --moduleResolution nodenext --types node \
  scripts/rust-migration/inventory-artifacts.mts scripts/rust-migration/inventory-artifacts.test.ts
```

Seven focused regressions cover nonexecution, literal-vs-factory/static shadowing, URL sanitization, deterministic discovery, explicit unknown reference sets, corrupt SHA/symlink rejection, bounded oversized parsing, preserved same-ID versions, capped metadata queries and duplicate SHA rejection. These verify the inspector boundary; they are not strategy compatibility tests.
