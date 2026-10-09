# 31 — Strategy artifacts: layout, build, identity, publish, trust

This document specifies how a Rust strategy becomes a native strategy
artifact: the crate layout of strategy packages, the pinned toolchain and
lockfile, the build profiles (a fast-compile profile for local checks, the
fastest-running reproducible profile for every published binary, amended
D18), the post-link steps that yield a static `aarch64-apple-darwin`
executable, artifact identity (binary sha256) and source hash, the two
variants (fleet builds that cannot place orders, a separate live build), R2
keys and the `strategy_artifacts` row, how the TypeScript producer resolves an
artifact through `describe`, the Rust `strategy:check`, publish authorization,
what the live runtime requires before it loads a binary, and the
out-of-sandbox build daemon through which polymarket-protocols sessions author
Rust strategies in M11, right after M6 (D39). The binary's subcommands and the
`describe` JSON are owned by `20-binary-protocol.md`, fleet gates, cache,
provisioning and blocklist by `40-fleet-integration.md`, migrations by
`42-persistence-and-stats.md`, the live runtime by `50-live-runtime.md`, the
author API by `30-strategy-sdk.md`.

Keywords MUST/SHOULD/MAY are normative. "Builder" means the TS module that
runs every build of this document (`src/strategy/artifacts/`); the CLIs and
the build daemon of §11 call it.

## 1. Terms

| Term | Meaning |
|---|---|
| Native artifact | One signed executable = engine + one strategy (20 §1). |
| Artifact identity | sha256 of the final signed binary bytes (D17). |
| Source hash | sha256 of a canonical description of everything that went into a build except host toolchain bytes (§5.2). Used for dedupe, rebuild verification and the link between variants. |
| Variant | `standard` (fleet, backtest, paper, agents; no real-order code) or `real-orders` (live only, built with the cargo feature `real-orders`) (§5.5). |
| Build profile | `iterate`, `artifact`, `parity-check` or `profiling` (§4.1). Only `artifact` binaries are published or accepted by the producer, workers and the live launcher. |
| Canonical build | A build with the `artifact` profile through the builder, including the post-link steps of §4.4. The only build that is published or counts as parity, benchmark or gate evidence (00 glossary, 01 §6). |
| Strategy package | A Cargo package holding one protocol's (or repo's) Rust strategies: a shared lib plus one bin per strategy version. |

## 2. Layout

### 2.1 Engine workspace (`native/`)

```
native/
├── Cargo.toml  Cargo.lock  rust-toolchain.toml
├── build/                       # engine-owned build policy, consumed by every strategy build
│   ├── artifact-build.toml      # cargo --config template: all profiles (§4.2)
│   ├── clippy/clippy.toml       # CLIPPY_CONF_DIR for strategy:check (30 §11)
│   ├── dylib-allowlist.txt      # allowed `otool -L` entries (§4.4)
│   └── pgo/                     # only if M5a adopts PGO (§4.6)
├── crates/
│   ├── pmb-sdk/                 # curated facade, strategy_main!, features `testkit`, `real-orders` (§5.5)
│   ├── pmb-sdk-macros/          # #[derive(Params)], price!/qty!/usdc!/cid!/meta!
│   └── …                        # engine crates; names owned by 12/16 (WIP: pmb-core, pmb-replay)
├── fleet/blocklist.json         # 40 §11
├── templates/strategy/          # source of `strategy:new --lang rust` (§7.3)
└── strategies/                  # separate package: in-repo ports (§2.3)
```

`native/strategies/` MUST NOT be a member of the engine workspace
(requirements-sweep `coexistence-and-port-scope`); engine CI checks it as a
separate package (§7.6).

### 2.2 Strategy package

One package per protocol or external repo; each strategy version is a bin
target. Agents mint a new id per code change (up to 129 publishes per day,
requirements-sweep `rust-strategy-file-pipeline`), so a crate per version
would pay a cold build each time.

```
<package>/
├── Cargo.toml          # template, see below
├── Cargo.lock          # subset of native/Cargo.lock (§3)
├── rust-toolchain.toml # copy of native/rust-toolchain.toml
├── .gitignore          # target/
├── src/lib.rs          # code shared across versions (params bases, signals)
├── src/bin/<name>.rs   # one strategy per file: impl Strategy + strategy_main!
└── tests/*.rs          # testkit tests
```

```toml
[package]
name = "<protocol>-strategies"
edition = "2021"
version = "0.0.0"
publish = false

[workspace]            # standalone: never captured by a parent workspace

[package.metadata.pmb]
format = 1

[dependencies]
pmb-sdk = { path = "<relative path to engine>/native/crates/pmb-sdk" }

[dev-dependencies]
pmb-sdk = { path = "<same>", features = ["testkit"] }

[lints.rust]
unsafe_code = "forbid"
```

Package rules, enforced by `strategy:check` and by every publish (§7.1):

| Rule | Reason |
|---|---|
| The only dependency is `pmb-sdk` (path) with no features; the only dev-dependency is `pmb-sdk` with exactly the `testkit` feature. No `[features]` section. | D16; offline builds; no nondeterministic crates; a package cannot enable `real-orders` (§5.5). |
| No `build.rs`, no `proc-macro = true`, no `links`, no `[profile]`, `[patch]`, `[replace]` or `[target]` sections. | Compiling strategy code executes no strategy-authored code (only engine-owned macros), and the profile cannot be changed. |
| `[lints.rust] unsafe_code = "forbid"` present and unchanged. | 30 §11. |
| `target/` is gitignored in the package and in the repository root. | The protocol save loop runs `git add .` (polymarket-protocols `_shared/GIT.md`); the root `.gitignore` there has no `target/` entry. |
| `rust-toolchain.toml` equals the engine's. | §3. |
| Every `src/bin/*.rs` calls `strategy_main!` exactly once; strategy ids (from `describe`) are unique within the package. | 30 §4. |

The engine is reached by a relative path dependency, the same sibling-checkout
convention as TS artifacts (`docs/strategy/external-artifacts.md:62-97`;
polymarket-protocols keeps a `polymarket-bot` symlink at its root). The
builder resolves the effective engine root from `cargo metadata`, records the
package-to-engine relative path, and recreates that layout for rebuilds
(§7.4). The bytes do not depend on where the package sits in its repository
(§4.3).

### 2.3 In-repo ports

`native/strategies/` is one strategy package (§2.2) holding
`engine-exerciser.rs` and `overnight-opus55-lagsnipe.v15.rs` (30 §18), plus
the test strategies of 01 §4.1. Its path dependency is `../crates/pmb-sdk`.
It is built only through this document's pipeline, so the ports exercise the
external-author path end to end.

## 3. Toolchain, lockfile, dependencies

1. The toolchain is pinned by `native/rust-toolchain.toml` (today `1.89.0` with
   `rustfmt` and `clippy`, `native/rust-toolchain.toml:1-3`). A toolchain bump
   is an engine change: new `engineVersion`, CONTRACT changelog entry (30 §17),
   and artifacts reach it only by rebuild.
2. Every cargo invocation of the pipeline uses `--locked --offline`.
3. A strategy package's `Cargo.lock` MUST be a subset of `native/Cargo.lock`:
   every registry package it lists has the same name, version, source and
   checksum as in the engine lock (`native/Cargo.toml:11-21` pins only direct
   dependencies, so an independent lock would choose other transitive
   versions). `strategy:check` verifies this; `strategy:sync-lock` regenerates
   the lock from the engine lock (copy, then prune offline) after an engine
   dependency change.
4. Build hosts are provisioned by 40 §17: rustup with the pinned toolchain and
   components, a registry cache filled with `cargo fetch --locked` for the
   engine lock, and the Xcode Command Line Tools version recorded. During this
   goal the build host is worker-1 (D36; toolchain installed user-level via
   rustup).
5. Engine dependencies are gated in engine CI by `cargo deny` (advisories,
   bans, licenses, sources limited to crates.io; 60 §14 CI-1).

## 4. Builds

### 4.1 Profiles (amended D18)

| Profile | Used by | Published or accepted by producer, workers, live |
|---|---|---|
| `iterate` | local checks only: `strategy:check` gates 4–7 (§7.1), `cargo test --profile iterate`, `check` requests of the build daemon (§11) | never |
| `artifact` | every publish (`strategy:publish`, `--strategy-file` auto-publish, both also with `--local-only`), `strategy:verify-rebuild`, `strategy:rebuild`, `strategy:build-live`, parity runs and benchmarks (01 §6, 16 §13) | yes; the only profile accepted (§8, §10) |
| `parity-check` | `artifact` plus debug assertions; built next to each parity strategy's `artifact` binary for the Rust-only matrix runs of 60 §8.1 | never (local cache only) |
| `profiling` | `artifact` with line tables, unstripped (16 BP-4); flamegraphs only | never |

**Amended D18** (lead, gate 1 delegated by the user, 2026-10-09): D18's
fast-compile settings apply only to local checks (`iterate`). Every binary that
is published, run by the fleet or loaded live is built with `artifact`, whose
settings are the fastest-running reproducible candidate of §4.6. Its build
time is recorded (§4.5) and never a criterion. The same rule decides the
dispatch boundary of 12 §14 P6 (M-DSP): the higher-throughput option is the
default, and the `iterate` warm rebuild time under that option is reported
only (this answers 12 Open question 2 and 01 Open question 2). Reason: D18's
measurement (warm rebuild 0.84 s with no LTO and `codegen-units = 16`, vs
7.3 s with thin LTO and `codegen-units = 1`) concerns iteration time; a
published binary is built once and then replays thousands of markets or
trades live, and speed is the top priority (00 R8). Results do not depend on
the profile (§7.6).

Invocation:

```
cargo build --locked --offline --profile <profile> --bin <bin> \
  --config <rendered artifact-build.toml> [--features pmb-sdk/real-orders]
```

run from the strategy package root with the host's shared target directory
(§4.5). Only `strategy:build-live` passes `--features pmb-sdk/real-orders`
(§5.5); every other command refuses it. The builder renders
`native/build/artifact-build.toml` by substituting the host's absolute
`CARGO_HOME`, `RUSTUP_HOME` and engine root and the values of §4.2. The
rendered file holds all profiles and MUST be byte-identical for every command
on one host, so no command invalidates another's cache (requirements-sweep
`build-profile-compile-time-disk`). Each profile has its own output directory
under the shared target directory, so profiles never evict each other.
`describe` reports the profile name as `buildProfile` (20 §3).

### 4.2 Profiles and configuration

```toml
[build]
target = "aarch64-apple-darwin"

[profile.iterate]                  # D18, literally; local checks only
inherits = "release"
opt-level = 3
lto = false
codegen-units = 16
panic = "unwind"
overflow-checks = true
debug = false
strip = "symbols"
incremental = false

[profile.artifact]                 # published, fleet, live; content chosen in M5a (§4.6)
inherits = "iterate"
lto = "thin"
codegen-units = 1

[profile.parity-check]             # 60 §8.1; never published
inherits = "artifact"
debug-assertions = true

[profile.profiling]                # 16 BP-4; never published
inherits = "artifact"
debug = "line-tables-only"
strip = false

[env]
MACOSX_DEPLOYMENT_TARGET = "11.0"  # explicit; MUST NOT exceed the oldest fleet macOS
PMB_ENGINE_SOURCE_HASH = "<§5.3>"
PMB_ENGINE_COMMIT = "<§5.3>"
PMB_ENGINE_DIRTY = "<true|false>"
PMB_RUSTC = "<rustc release>"

[target.aarch64-apple-darwin]
rustflags = [
  "--remap-path-prefix=<CARGO_HOME>=/cargo",
  "--remap-path-prefix=<RUSTUP_HOME>=/rustup",
  "--remap-path-prefix=<ENGINE_ROOT>=/pmb/engine",
  "--remap-path-prefix=<ENGINE_ROOT realpath>=/pmb/engine",
]
```

- `iterate` is D18 for every crate. Its bytes are never published, so it has
  no reproducibility requirement beyond determinism of results.
- `artifact` sets codegen units and LTO **profile-wide**, not per package. The
  engine runtime is generic over the strategy type (30 §4 rule 1, §16 S9;
  12 §14 P6), so the hot loop (session, order manager, ledger, simulator,
  plugins) is monomorphized and code-generated in the strategy bin crate,
  under that crate's settings. Per-package settings on engine crates would
  therefore not reach the per-candidate cost `C` (16 §3); profile-wide
  settings do (Cargo cannot set `lto` per package anyway). This holds while
  M-DSP (16 M-23) keeps the generic dispatch default. The initial
  content (thin LTO, `codegen-units = 1`) is the WIP release profile
  (`native/Cargo.toml` `[profile.release]`).
- Every profile keeps `panic = "unwind"` (per-candidate `catch_unwind`, 30
  §12) and overflow checks on every crate (D18's reason: fixed-point money
  math, 10 §2 T3). `parity-check` differs from `artifact` only by debug
  assertions. Turning overflow checks off for third-party crates only is a
  measured candidate of §4.6, not a default.
- Build options do not change results: Rust uses no fast-math and no implicit
  FMA contraction, and the profiles have the same panic and overflow
  behavior, so a profile changes speed, never decisions. This is checked, not
  assumed (§7.6).
- `target-cpu` MUST stay the target default (Apple M1 class, 16 BP-1).
  `target-cpu=native` is forbidden: an M4 build could emit instructions an
  M1 Pro cannot run, and it would break reproducibility across the fleet.
- No build script, environment read or macro may embed time, hostname, user,
  absolute paths or the repository HEAD into the binary. The binary embeds
  only `engineVersion`, `sdkVersion`, `protocolVersion`, the schema version
  lists, `contractSha256`, `PMB_ENGINE_SOURCE_HASH`, `PMB_ENGINE_COMMIT`,
  `PMB_ENGINE_DIRTY`, `PMB_RUSTC`, target, profile name and the real-order
  capability (all reported by `describe`, 20 §3, §5.1). Strategy git
  provenance lives in the DB row, as for TS artifacts
  (`src/strategy/artifacts/types.ts:61-73`).

### 4.3 Paths

Remap prefixes MUST be host-stable (identical for every strategy package on a
host), so compiled dependencies are shared between packages. Cargo passes a
workspace member's own sources to rustc relative to the package root, so the
strategy needs no package-specific remap and its location inside its
repository does not change the bytes (unlike the TS rule "one sha per (repo
root, entrypoint) pair", `docs/strategy/external-artifacts.md:138-140`). The
path-leak gate (§4.4) verifies both properties on every build.

### 4.4 Post-link steps and gates

After cargo finishes, the builder MUST, in order:

1. Re-sign ad hoc with a canonical identifier:
   `codesign --force --sign - --identifier pmb.<strategy id> <bin>` (a strip
   after linking invalidates the linker's signature, and Apple Silicon refuses
   to run unsigned code).
2. Verify the signature: `codesign --verify --strict <bin>`.
3. Check dynamic dependencies with `otool -L` against
   `native/build/dylib-allowlist.txt` (macOS system libraries under `/usr/lib`
   only; any `@rpath`, `/opt/homebrew` or `/usr/local` entry fails). "Static"
   means all Rust and C code is linked in and only system libraries are
   dynamic.
4. Path-leak scan: the bytes MUST NOT contain the host's home directory,
   `CARGO_HOME`, `RUSTUP_HOME`, the engine root, the package root or
   `/private/var/folders` (a test build contained 74 `/Users/mijat/...` paths,
   requirements-sweep `artifact-identity-reproducibility`).
5. Run `<bin> selftest` (20 §5.3).
6. Run `<bin> describe` and check that `binary.target` is
   `aarch64-apple-darwin`, `binary.buildProfile` is the requested profile, and
   `capabilities.realOrders` is `true` for a `strategy:build-live` build and
   `false` for every other build (§5.5).
7. Compute the sha256 of the final bytes.

A failed step fails the build; there is no override flag.

### 4.5 Build hosts

- **During this goal** every engine build, canonical build, parity run and
  benchmark runs on worker-1 (D36) in the goal checkout
  `/Users/worker-1/Sites/polymarket-bot-native`, never in the fleet's working
  copy `/Users/worker-1/Sites/polymarket-bot`; datasets and `node_modules` MAY
  be symlinked read-only from the fleet copy. The MacBook (m1-ivan) does no
  engine builds. From M6 every native fleet host is a provisioned builder
  (40 §17); from M11 the build daemon (§11) builds on hosts that run Global
  Runtime sessions.
- One shared target directory per host and toolchain (for example
  `~/.cache/pmb/target/<rustc release>`), shared by every strategy package on
  the host, so registry and engine crates compile once per host per engine
  revision. Cargo's directory lock serializes concurrent builds; the builder
  runs one build at a time per host.
- On hosts that also run backtests or Global Runtime sessions (worker-1 is
  both, D36), builds MUST cap jobs (`CARGO_BUILD_JOBS`, value set in 40) and
  SHOULD run with background QoS (`taskpolicy -b`), which restricts them to
  efficiency cores (40 §7.3). Builds whose time is being measured (§4.6) run
  under the benchmark conditions of 16 §13.5 instead (fleet worker and Global
  Runtime paused first). Interactive builds on an author's own machine run
  unthrottled.
- Disk: the target directory has a budget (default 10 GiB per host); above
  it, the builder deletes the least recently used profile directory before
  the next build. The local artifact cache has the LRU policy of 40 §9.
- `artifact` builds are the heavy ones (cross-crate LTO, one codegen unit).
  Their wall time (cold, and warm after a one-line strategy change) is
  recorded in the build manifest (§5.4) of every publish, so the cost is
  visible per host and per engine revision.

### 4.6 Choosing the `artifact` profile (M5a, 16 M-8)

The M5a benchmark chooses the `artifact` settings from these candidates, each
measured on top of the previous best. This document owns the candidates and
the rule; 16 §11.2 runs the measurement.

| Candidate | Note |
|---|---|
| D18 for all crates (= `iterate`) | baseline |
| thin LTO, `codegen-units = 1` | initial content of §4.2 |
| fat LTO, `codegen-units = 1` | one LLVM module for the whole program; tends to win when hot code crosses crate boundaries |
| best of the above, third-party crates without overflow checks (`[profile.artifact.package."*"] overflow-checks = false`, re-enabled for every engine crate) | Parquet decoding is about 50% of a market's profile (early-audits C), and third-party crates are written for release builds without overflow checks; engine and strategy crates keep them (D18) |
| best of the above plus PGO with an engine-owned profile file committed under `native/build/pgo/` (part of the engine source set, §5.3) | A shared profile only matches non-generic engine code (decode, tape, book): monomorphized code has strategy-specific symbols. Per-artifact PGO (instrumented build, fixture run, rebuild) roughly triples publish time; it MAY be measured but is not planned |

Rule:

1. **Eligibility.** A candidate is eligible only if it passes the
   profile-independence check (§7.6) and D17 byte reproducibility: two clean
   builds on worker-1 give identical bytes. M6 repeats the reproducibility
   check on every native fleet host (§7.6); a candidate that fails there is
   replaced by the next eligible one.
2. **Metric.** End-to-end throughput (markets per second) on `recent-1k` with
   one candidate (16 §13.1), on worker-1 (M4) under the conditions of
   16 §13.5. The per-candidate cost `C` on a 20-candidate group bench (16 §3)
   and the M1-class numbers from M6 are reported next to it; if `C` ranks the
   candidates differently, the report says so and the choice still follows
   `recent-1k`.
3. **Adoption.** The fastest eligible candidate. A candidate counts as faster
   than a cheaper one (higher in the table) only when its gain exceeds the
   measured run-to-run spread (16 §13.5); otherwise the cheaper one wins.
   Build time (cold and warm, at background QoS) is reported, never gated
   (amended D18).
4. The chosen settings and numbers go into the M5a report (16 §13.8). A
   profile change alters `PMB_ENGINE_SOURCE_HASH` (`native/build/**` is in
   the engine source set, §5.3) but not results, so existing artifacts keep
   their outputs and reach the new speed only by rebuild (§7.4).

## 5. Identity

### 5.1 Artifact identity

The artifact identity is the sha256 of the final signed bytes (D17). Jobs,
run rows, the local cache and R2 keys use it. Different bytes are a different
artifact, even from identical source.

### 5.2 Source hash

`source_hash` = sha256 of this canonical JSON (keys sorted, no whitespace):

| Field | Content |
|---|---|
| `v` | `1` |
| `target`, `profile` | build selectors; `profile` is `artifact` for every published row (other profiles appear only in local manifests, §7.5); the variant and features are **not** included (§5.5) |
| `rustc` | full `rustc -vV` output |
| `deploymentTarget` | value from §4.2 |
| `buildConfig` | sha256 of the unrendered `native/build/artifact-build.toml` |
| `lock` | sha256 of the package `Cargo.lock` |
| `files` | sorted `[role, relativePath, sha256]` for every file in cargo's dep-info for the bin (`target/<triple>/<profile>/<bin>.d`) under the engine root (`role = "engine"`) or the package root (`role = "strategy"`), plus every path package's `Cargo.toml` |

Registry sources are excluded from `files` because the lock pins them by
checksum. A dep-info entry outside the engine root, the package root, the
registry cache and the toolchain fails the build, as TS rejects bundled files
outside the repository (`docs/strategy/external-artifacts.md:190`). Because the
list comes from dep-info, adding `v16.rs` to a package does not change the
source hash of `v15`.

Host toolchain bytes outside the hash (Xcode Command Line Tools: the macOS SDK
version written into the Mach-O build-version load command, the linker
version, the C compiler for C dependencies such as zstd) are recorded as
provenance (§6.2). They are the expected cause when one source hash yields
different bytes on two hosts (gate-4 question 1).

### 5.3 Engine identity inside the binary

- `PMB_ENGINE_SOURCE_HASH` = sha256 over the sorted `[relativePath, sha256]`
  list of the **engine source set**: files under `native/crates/` except
  `*/tests/**`, `*/benches/**` and `*.md`, plus `native/Cargo.toml`,
  `native/Cargo.lock`, `native/rust-toolchain.toml` and `native/build/**`.
  Working-tree contents are hashed (tracked and untracked, not ignored), so a
  dirty tree gets a distinct value. Fixtures embedded by `selftest` MUST live
  inside the set.
- `PMB_ENGINE_COMMIT` (`engineCommit` in 20 §3) = the most recent commit that
  changed the engine source set (`git log -1 --format=%H -- <set>`), not the
  repository HEAD. `PMB_ENGINE_DIRTY` (`engineDirty`) = whether the working
  tree's engine source set differs from that commit.
- Reason: the repository HEAD moves with every TS, docs or dashboard commit.
  Embedding it would give the same strategy on the same engine a new sha after
  every unrelated commit, which TS artifacts deliberately avoid (artifact
  format v2, `src/strategy/artifacts/types.ts:11-18`). With the definition
  above, unchanged strategy code on an unchanged engine keeps its sha.
- Rebuilds need enough history to compute `engineCommit`: rebuild clones MUST
  NOT be shallow below that commit (§7.4).

### 5.4 Build manifest

Every artifact has a JSON build manifest next to it (§6.1): the source-hash
input of §5.2 with the full file list, the rendered flags with host paths
replaced by their remap targets, toolchain provenance (§6.2), git provenance,
the build wall time (§4.5) and the `describe` output. Anyone can recompute the
source hash and replay the build from it.

### 5.5 Variants (D05, D44)

| Variant | Built by | Contains | Runs | R2 |
|---|---|---|---|---|
| `standard` | every publish, `strategy:verify-rebuild`, `strategy:rebuild`, the build daemon | no real-order code: no order signing, no authenticated trading endpoint, no heartbeat (50 §17); `describe` reports `capabilities.realOrders = false` and no `live` subcommand | fleet and local backtests, paper, agent work | `strategy-artifacts/native/` |
| `real-orders` | only `strategy:build-live`, run by the user on the live host | additionally the CLOB V2 adapter (feature `pmb-sdk/real-orders`) | live with real orders only | `strategy-artifacts/native-live/` (audit copy, never read by workers) |

Both variants are built with the `artifact` profile.

- Fleet and agent builds physically cannot place orders: a strategy package
  cannot enable the feature (§2.2), every builder command except
  `strategy:build-live` refuses it, and the producer, workers and the build
  daemon refuse any binary whose `describe` reports
  `capabilities.realOrders = true` (§8, 40 §9).
- `strategy:build-live` builds from the tree that `strategy:verify-rebuild`
  of the standard artifact has just reproduced on the live host (§10). The
  row records `variant = 'real-orders'` and `parent_sha256` = the standard
  artifact; both share one `source_hash` (§5.2 excludes variant and features),
  which is the check 50 §17 requires. The cross-artifact replay proof of
  50 §13.3 shows that the feature gates only the adapter.
- The agent never runs `strategy:build-live` and never builds or runs the
  real-order feature against production (00 R10, 50 LR-5). Mock and fixture
  tests of the adapter with throwaway keys are owned by 60 (LV-5…LV-9).

### 5.6 Dedupe

At publish, after the build:

1. If the sha is already in `strategy_artifacts`, the publish is a no-op
   (`already published`), as for TS (`src/strategy/artifacts/publish.ts:173-182`).
2. Else, if a row with the same `source_hash`, `target`, `variant` and
   `build_profile` exists, the publish MUST reuse that row's sha (the new bytes
   are not uploaded) and record a `publish_observation` (host, built sha,
   match flag, toolchain provenance; `strategy_artifact_builds`, 42 §3.7).
3. Else, a new artifact is published.

## 6. Storage

### 6.1 R2 and local cache

| Object | Key |
|---|---|
| Standard binary | `strategy-artifacts/native/<sha>` (existing prefix, `src/strategy/artifacts/native.ts:23-28`) |
| Build manifest | `strategy-artifacts/native/<sha>.build.json` |
| Real-orders binary and manifest | `strategy-artifacts/native-live/<sha>`, `<sha>.build.json` (upload credential on the live host: gate-4 question 2) |
| Local cache | `data/strategy-artifacts/native/<sha>`, mode 0755 (`native.ts:30-32`); verify-once marker, size cap, LRU and prefetch per 40 §9 |

Upload is skip-if-exists with a size check and Content-MD5, as the TS publish
does (`publish.ts:170-190`). Binaries referenced by any run row MUST NOT be
deleted from R2; retention of unreferenced binaries belongs to the later
retention script (D15, 01 §10 F3).

### 6.2 `strategy_artifacts` row

The migration and the dashboard mirror are owned by 42 §3.7: the native
columns and the `strategy_artifact_builds` table. Semantics defined here:

| Column | Content |
|---|---|
| `kind` | `'native'`; replaces native detection by R2 URL substring (`src/cli/helpers/strategyArgs.ts:232,269`) |
| `variant`, `parent_sha256` | §5.5 (`parent_sha256` is set only on `real-orders` rows) |
| `target`, `rustc`, `sdk_version`, `protocol_version` | from `describe` (20 §3) |
| `engine_version`, `engine_source_hash`, `engine_dirty` | §5.3; `engine_commit` (existing column) holds `engineCommit` of §5.3 |
| `source_hash`, `lock_hash` | §5.2 |
| `build_profile` | always `artifact`; publish refuses every other profile (§7.2) |
| `package_name`, `bin_name`, `engine_rel_path` | §2.2; `entrypoint` (existing) holds the repo-relative path of `src/bin/<name>.rs` |
| `capabilities` (JSON) | the `binary` and `capabilities` objects of `describe` (20 §5.1), including the schema version lists |
| `params_schema` (JSON) | 30 §9 rule 8 |
| `rebuilt_from_sha256` | §7.4 |

- `built_with` (existing, widened by 42) holds
  `{ rustc, macosSdk, ld, cc, host }` for native rows.
- `format_version` holds the native artifact format version (starting at 1),
  independent of the JS `ARTIFACT_FORMAT_VERSION`.
- `strategy_artifact_builds` rows are `publish_observation` (§5.6) or
  `verified_rebuild` (§7.4).

## 7. Pipelines

All commands run through the TS CLI, and through `pte` from any directory
(`docs/reference/pte-cli.md`). The language is detected from the file (`.rs`
vs `.ts`) or from a `Cargo.toml` with `[package.metadata.pmb]`. §12 lists the
milestone that delivers each command.

### 7.1 `strategy:check -- --repo <dir>` (Rust)

| # | Gate | Skippable at publish |
|---|---|---|
| 1 | Toolchain and package rules (§2.2), lock subset (§3) | no |
| 2 | `cargo fmt --check` | yes |
| 3 | Clippy with the engine-owned config: `CLIPPY_CONF_DIR=<engine>/native/build/clippy`, `-D warnings`, determinism lints with `-F` (30 §11) | no |
| 4 | `cargo test --profile iterate --locked --offline` (testkit, and `testkit::bench` for the ns/callback report of gate 7, 30 §15), under a deny-network sandbox profile that allows writes only to the target directory | yes |
| 5 | Builder build of every bin with the steps of §4.4 (including `selftest` and the `describe` checks): `iterate` in `strategy:check` (`--profile artifact` builds exactly what a publish builds); `artifact` in a publish | no |
| 6 | `describe` of every bin built in gate 5, with default params: id grammar and uniqueness, `paramsSchema`, requirements | no |
| 7 | Behavioral smoke of the gate-5 binaries on the committed fixture markets (60 §12): run-group of `[p, p]` and of reversed candidates equals standalone runs; declared interests (event flags and tick interest) equal all interests (30 §4.1); ns/callback report (30 §16 S11) | no |

Gates 1, 3, 5, 6 and 7 guard against silent cross-machine or cross-candidate
divergence and are cheap with a warm target directory (in a publish, gate 5 is
the `artifact` build itself, which a publish needs anyway). `--skip-checks`,
and the `--strategy-file` auto-publish (skip-checks semantics today,
`docs/strategy/external-artifacts.md:136`), therefore skip only gates 2 and 4.
The TS `strategy:check` (`src/strategy/artifacts/externalRepoCheck.ts:32-144`)
stays unchanged for `.ts` sources.

### 7.2 `strategy:publish` and `--strategy-file`

`strategy:publish -- --repo <dir> --bin <name>` (or
`--entrypoint src/bin/<name>.rs`), and `backtest` or the paper launcher
(`50`) with `--strategy-file <pkg>/src/bin/<name>.rs` (auto-publish):

1. Resolve package and bin; refuse an entrypoint outside the repository.
2. Provenance: strategy repository remote, commit and dirty flag; engine
   commit and dirty flag (§5.3). A dirty strategy tree is refused unless
   `--allow-dirty` (`publish.ts:82-86`); the flag is recorded either way.
3. Gates of §7.1, minus the skippable ones when skipping. Gate 5 builds with
   the `artifact` profile (sha, source hash), and gates 6 and 7 run on that
   binary, so the checked bytes are the published bytes. A request for any
   other profile, or for the `real-orders` feature, is refused.
4. Dedupe (§5.6).
5. Id checks: the `describe` id equals the bin's `ID`; it MUST NOT collide with a
   TS registry id or with an id published as `kind = 'js'` (30 §4). Several
   shas MAY share an id, as for TS.
6. Upload binary and build manifest (§6.1).
7. Insert the row (§6.2).
8. Prime the local cache.

With `--local-only` (§7.5), steps 6 and 7 are skipped and step 4 looks only
at the local cache. Publishing is idempotent and has no fallback: every
failure is a loud error, as for TS artifacts
(`docs/strategy/external-artifacts.md:175-190`).

### 7.3 `strategy:new -- --lang rust --repo <dir> [--package <name>]`

Generates the package of §2.2 from `native/templates/strategy/`: manifest with
the correct relative engine path, lock via `strategy:sync-lock`, toolchain
file, `.gitignore`, `src/lib.rs`, one example bin (30 §4) and one testkit test.
It also adds `target/` to the repository root `.gitignore`. The generated
package MUST pass `strategy:check` unmodified.

### 7.4 Rebuilds

- `strategy:verify-rebuild -- --sha <sha>`: clones the recorded strategy commit
  and engine commit into a fresh temporary directory (history deep enough for
  §5.3), recreates the recorded relative layout, runs the canonical build for
  the recorded variant and compares shas. Both commits MUST be fetchable from
  their remotes. The result is a `verified_rebuild` row (§6.2). Refused for
  rows with `source_dirty` or `engine_dirty`.
- `strategy:rebuild -- --sha <sha> [--engine <commit>|current]`: rebuilds the
  recorded strategy source against another engine and publishes the result with
  `rebuilt_from_sha256`, so an old strategy can be compared on a newer engine
  (requirements-sweep `engine-in-binary-versioning`).

### 7.5 Local-only mode and the phase before M3a

- `--local-only` (with `strategy:publish` or `--strategy-file`) builds the
  `artifact` profile, runs the gates a publish runs, writes the binary and its
  build manifest only to the local cache, and touches neither R2 nor any
  database. Parity runs and benchmarks use binaries built this way (01 §6 M1
  step 5), plus the `parity-check` binary the builder builds next to each
  parity strategy (60 §8.1). Workers never receive a local-only binary, so
  backtests of one need `--sequential` (20 §5.6).
- Until M3a, no native artifact is uploaded or recorded in any database and
  no native run is persisted (00 R13, 01 §8): publishing exists only as
  `--local-only`, on worker-1 in the goal checkout (D36). Full publish (R2
  upload and the `strategy_artifacts` row) arrives in M3a with the migrations
  (01 §6 M3a). No branch dev schema is used.

### 7.6 CI and host checks

Engine CI (GitHub `ubuntu-latest`, 60 §14 CI-1) runs gates 1–4 and 6 of §7.1
on `native/strategies/` on every push to a PR, including the draft PR "DO NOT
MERGE before gate 2" (D48); gate 6 uses a Linux host build there.
No macOS runner runs per PR (D48): the canonical build, `selftest`
and the checks below run on worker-1 as 60 LG-1 (`npm run
native:verify:local`) before every milestone proof and before each merge
after G2.

- **Profile-independence check.** `engine-exerciser.rs` and
  `overnight-opus55-lagsnipe.v15.rs`, built with `iterate`, `artifact` and
  `parity-check`, MUST produce byte-identical deterministic result sections
  (21 §10) and canonical traces (22) on the committed fixture markets (60
  §12). It runs in LG-1, in M5a for every candidate of §4.6, and on every
  change to `native/build/artifact-build.toml`; a difference is an engine bug
  (for example a float expression whose result depends on inlining).
- **Reproducibility proof (M6).** `strategy:verify-rebuild` of the same
  artifacts runs on every native fleet host of M6 (worker-1, worker-2, and
  m1-milan when available; 40) and the shas are compared (60 DET-12). On a
  mismatch the builder diffs the Mach-O load commands and the toolchain
  provenance to name the cause (gate-4 question 1).

## 8. Producer resolution via `describe`

For `--strategy-artifact <sha>` and `--strategy-file`, the TS producer MUST:

1. Read the row; the artifact kind comes from `kind`, never from the URL.
2. Ensure the binary locally (download, sha verify; `native.ts:49-84`, 40 §9).
3. Refuse before building any job when: `target` matches no native worker
   target; `variant` is not `standard` or `capabilities.realOrders` is true;
   `buildProfile` is not `artifact`; `protocolVersion` or every offered
   `jobSchemaVersion` is unsupported (20 §3); the sha or engine version is on
   the blocklist (40 §11); a requested flag, input mode or profile is missing
   from `capabilities` (requirements-sweep `native-flag-matrix`, 20 §5.1).
4. Run `describe` with the raw params (the `--params-file` batch form for
   candidate files, 20 §5.1, 41 §3.4), with the 20 G6 environment and under a
   deny-network sandbox at least as strict as 40 §6.2 that allows reads of the
   binary and system libraries only and writes only to its temp directory:
   `describe` runs strategy code (params validation, `requirements`,
   `interests`), the producer host holds live keys, and from M11 that code
   is agent-written (§9). Invalid params
   are a CLI error; the returned id MUST equal the row's `strategy_id`; the
   normalized params are what is stored on the run; `requiredFeeds` (TS
   `ExternalFeedsRequestConfig` shape) and the plugin requirements feed the
   existing eligibility and preflight code.
5. Cache `describe` results per (sha, canonical raw params) for the process.
6. On `--extend`, run `describe` with the stored typed params and require the
   normalized result to equal them, compared as in 30 §9 rule 10 (numbers by
   value, absent `Option` fields omitted on both sides).
7. Put `{ sha256, r2Url, kind: 'native', target }` in jobs (workers stay
   DB-free, `src/strategy/artifacts/types.ts:38-46`) and copy `engineVersion`,
   `engineCommit` and the sha into run provenance (D09, 42 §4); the engine
   source hash is read through the artifact row.

The producer MUST NOT build a TS `Strategy` object for a native artifact (the
WIP returns an inert placeholder, `strategyArgs.ts:300-312`); paths that need
one, such as the dashboard simulator, refuse native runs until M3c (D10).

## 9. Publish authorization and trust

| Context | Trust anchor |
|---|---|
| Fleet backtests, paper | Whoever can write `strategy-artifacts/native/` in R2 and insert into `strategy_artifacts`, plus sha verification on every host. Binaries run with the allowlisted environment under a deny-network sandbox: executors per 20 G6 and 40 §6.2, `describe` on the producer per §8 step 4. |
| Live with real orders | A verified reproducible rebuild on the live host from clean, pushed commits (§10). The publisher's claims are not trusted. |

- Until M11, only the user and the implementation session (on worker-1,
  D36) publish native artifacts. From
  then on (D39), the per-host build daemon of §11 also publishes, on behalf of
  protocol sessions, with its own credential; agents never hold it. The
  worker shim never builds or publishes (40 §17).
- A native binary is opaque, unlike a ~30 KB readable TS bundle, so review
  means reviewing the source at the recorded commits and proving the binary
  comes from it (D17).
- Strategy packages cannot add dependencies, build scripts, proc macros or
  features (§2.2), so a build executes no strategy-authored code; tests do,
  and they run sandboxed (§7.1 gate 4).
- The protocol sandbox can reach R2 today (`*.r2.cloudflarestorage.com`,
  polymarket-protocols `srt-settings.template.json:67`) and TS launchers publish
  from inside it (`docs/strategy/external-artifacts.md:194-201`), so the same
  credential could write native binaries. Until gate-4 question 2 scopes the
  credential, the MacBook (the live-key machine) runs no native fleet jobs
  (it is producer-only in M6, D55) and executes native binaries
  only through the sandboxed `describe` of §8.

## 10. What live requires before loading a binary

The TS launcher (50 §17) MUST check, in this order, and refuse with a
specific message on the first failure. The binary then applies its own gate
(20 §7).

1. The standard row exists, `kind = 'native'`, `variant = 'standard'`,
   `build_profile = 'artifact'`, and `target` equals the host target.
2. The local binary's sha equals the requested sha; `codesign --verify` and the
   dylib allowlist pass.
3. `describe` succeeds with the launch params and reports the needed
   subcommand (`paper` or `live`) and a supported `protocolVersion`.
4. `engineVersion` is at or above the live-safe minimum and neither the sha nor
   the engine version is on the blocklist (minimum owned by 50 §17; blocklist
   40 §11).
5. Paper: no further check; paper runs the standard binary and never sends
   orders (D28).
6. Real orders additionally require:
   1. `source_dirty = false` and `engine_dirty = false`;
   2. a successful `strategy:verify-rebuild` of the standard artifact on this
      host, with the host's current `rustc` and macOS SDK equal to those
      recorded in that verification;
   3. a `real-orders` binary built by the user with `strategy:build-live` from
      that verified tree, with `parent_sha256` = the standard sha, the same
      `source_hash`, and `describe` reporting `capabilities.realOrders = true`;
      this is the binary that is loaded;
   4. the explicit real-order flag and config of 20 §7 (D05). The AI agent never
      passes it (00 R10).

The launcher SHOULD warn when the standard sha has no completed backtest run
under the profile being launched. Every check result is written to the live
journal (22 §6).

## 11. Agent authoring from polymarket-protocols (M11, D39)

Protocol sessions start authoring Rust strategies in M11, right after M6, in
parallel with the live work (D39). Nothing in §2–§10 needs cargo, a Rust toolchain or
publish credentials inside the sandbox; the build daemon below is the only
new component.

1. A per-host daemon (launchd, outside srt, on hosts that run Global Runtime
   sessions, worker-1 first) watches a spool under
   `data/strategy-artifacts/build-requests/`, a path the sandbox can already
   write (polymarket-protocols `srt-settings.template.json:30`).
2. A request names the protocol, package path, bin, kind, mode and an
   idempotency key. Kind `check` runs `strategy:check` (`iterate` profile,
   diagnostics only); kind `publish` runs the publish of §7.2 (`artifact`
   profile). Mode `snapshot` copies the package's working tree into a staging
   directory (dirty, backtests only); mode `commit` builds a pushed commit
   from a clean checkout (the only mode eligible for live). The daemon checks
   that the package lies inside the requesting protocol's folder and that
   this host owns the protocol.
3. The daemon builds against the host's main checkout of polymarket-bot (the
   `polymarket-bot` symlink of the protocols workspace), with its own
   credentials, the shared target directory, the job cap and background QoS
   of §4.5, and a per-request timeout. Identical sources dedupe (§5.6). A
   build during which the engine source hash (§5.3) changed, for example by a
   `fleet:git:pull`, fails and is retried.
4. It writes `build-results/<request>.json`: the sha, or every diagnostic with
   remapped paths (compiler, clippy, tests, gates), so an agent that cannot
   run cargo can still iterate. It also records queue wait and build time per
   request. A warm `check` costs about one `iterate` rebuild (D18
   measurement: about one second plus link time); a `publish` costs the
   `artifact` build time recorded in M5a (§4.5), so agents check often and
   publish what they backtest.
5. The sandboxed launcher waits for the result and runs
   `--strategy-artifact <sha>`.

Agent-facing material is `pmb-sdk` 1.0.0 with its rustdoc and `CONTRACT.md`
(30 §2, §17), and the `strategy:new` template (§7.3).

## 12. Delivery by milestone

| Milestone (01 §6) | Delivered from this document |
|---|---|
| M1 step 5 | `native/build/` (all profiles, clippy config, dylib allowlist); the builder with the post-link steps; Rust `strategy:check`; `strategy:sync-lock`; `strategy:publish -- --local-only`; the `native/strategies/` package; the `parity-check` build |
| M2 | `--strategy-file … --local-only` (20 §5.6) for local runs |
| M3a | Full publish (R2, row, dedupe, manifests); producer resolution via `describe` (§8) |
| M5a | `artifact` profile choice (§4.6) with the profile-independence check per candidate |
| M6 | Builder provisioning on the native fleet hosts (40 §17); `strategy:verify-rebuild`; reproducibility proof (§7.6) |
| M11, right after M6 (D39) | Build daemon (§11); `strategy:new --lang rust` and its template; `strategy:rebuild`; `pmb-sdk` 1.0.0 with rustdoc and `CONTRACT.md` (30 §17) |
| M9 | `strategy:build-live`; the live checks of §10 |

## Changes required in other documents

None open: every item was applied in the gate-1 consolidation.

## Gate-4 questions

Deferred by the lead to gate 4 (collected in 01 §12.1, items 3 and 1); nothing
before gate 4 depends on the answers.

1. **Byte reproducibility on the live host.** If the live host builds
   different bytes from the same source because its Xcode Command Line Tools
   differ (macOS SDK version in the Mach-O build-version command, linker, C
   compiler for zstd), step 6.2 of §10 fails for artifacts built elsewhere.
   Options: (a) one CLT version on every builder and the live host, checked
   by provisioning (40 §17); (b) live-bound strategies are built and
   backtested from the live host; (c) an equal source hash plus identical
   outputs on the fixture markets count as equivalence. The M6 comparison
   (§7.6) provides the evidence, and the answer depends on the choice of the
   live host (also a gate-4 question). Recommended: (a) if M6 shows
   CLT-caused mismatches and the hosts can share one CLT version, else (c).
2. **Publish credentials (R2 token scoping).** Should native binaries go to a
   separate R2 bucket or token whose write credential exists only on builder
   hosts (the build daemon, the user's machine), so that no credential
   reachable from the protocol sandbox can publish an executable? The answer
   also decides whether the live host may upload the `real-orders` audit copy
   (§6.1). Until then the daemon uses today's publish credential, the MacBook
   stays producer-only, and the producer runs `describe` sandboxed (§9).

## Open questions

None.
