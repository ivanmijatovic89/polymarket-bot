# 31 — Strategy artifacts: layout, build, identity, publish, trust

This document specifies how a Rust strategy becomes a native strategy
artifact: the crate layout of strategy packages, the pinned toolchain and
lockfile, the canonical build (a fast-compile profile for checks and
iteration, a speed-optimized profile for every published binary) that yields a
static `aarch64-apple-darwin` executable, artifact identity (binary sha256) and source hash, R2 keys and the
`strategy_artifacts` row, how the TypeScript producer resolves an artifact
through `describe`, the Rust `strategy:check`, publish authorization, and what
the live runtime requires before it loads a binary. It also fixes the seams
that let polymarket-protocols author Rust strategies later through a build
step outside the sandbox (D16), without changing this pipeline. The binary's
subcommands and the `describe` JSON are owned by `20-binary-protocol.md`,
fleet gates, cache and blocklist by `40-fleet-integration.md`, migrations by
`42-persistence-and-stats.md`, the live runtime by `50-live-runtime.md`, the
author API by `30-strategy-sdk.md`.

Keywords MUST/SHOULD/MAY are normative. "Builder" means the TS module that
runs the canonical build (`src/strategy/artifacts/`); the CLIs call it today
and the out-of-sandbox build daemon of §11 will call it later.

## 1. Terms

| Term | Meaning |
|---|---|
| Native artifact | One signed executable = engine + one strategy (`native/BINARY-PROTOCOL.md:3-7`). |
| Artifact identity | sha256 of the final signed binary bytes (D17). |
| Source hash | sha256 of a canonical description of everything that went into a build except host toolchain bytes (§5.2). Used for dedupe, rebuild verification and the link between variants. |
| Variant | `standard` (fleet, backtest, paper) or `real-orders` (built with the cargo feature `real-orders` for live). Exists only if gate 1 picks option (b) of 20 Open question 1 (§5.5). |
| Canonical build | The cargo invocation, rendered config, flags and post-link steps of §4, with one of two profiles from the same rendered config: `iterate` (check and local iteration, D18) or `artifact` (every published, fleet and live binary). |
| Build profile | `iterate` or `artifact` (§4.1). Only `artifact` binaries are published or loaded by the fleet and live. |
| Strategy package | A Cargo package holding one protocol's (or repo's) Rust strategies: a shared lib plus one bin per strategy version. |

## 2. Layout

### 2.1 Engine workspace (`native/`)

```
native/
├── Cargo.toml  Cargo.lock  rust-toolchain.toml
├── build/                       # engine-owned build policy, consumed by every strategy build
│   ├── artifact-build.toml      # cargo --config template: profiles iterate + artifact (§4.2)
│   ├── clippy/clippy.toml       # CLIPPY_CONF_DIR for strategy:check (30 §11)
│   ├── dylib-allowlist.txt      # allowed `otool -L` entries (§4.4)
│   └── pgo/                     # only if M5 adopts PGO (§4.6)
├── crates/
│   ├── pmb-sdk/                 # curated facade, strategy_main!, features `testkit`, `real-orders` (option (b) of §5.5 only)
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
| The only dependency is `pmb-sdk` (path); the only dev-dependency is `pmb-sdk` with `testkit`. | D16; offline builds; no nondeterministic crates. |
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
`engine-exerciser.rs` and `overnight-opus55-lagsnipe.v15.rs` (30 §18). Its
path dependency is `../crates/pmb-sdk`. It is built and published only through
this document's pipeline, so the ports exercise the external-author path end to
end.

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
   the lock from the engine lock after an engine dependency change.
4. Build hosts are provisioned by `40-fleet-integration.md`: rustup with the
   pinned toolchain and components, a registry cache filled with
   `cargo fetch --locked` for the engine lock, and Xcode Command Line Tools.
5. Engine dependencies are gated in engine CI by `cargo deny` (advisories,
   bans, licenses, sources limited to crates.io) (critic missing angle on
   supply chain; CI matrix in `60-verification.md`).

## 4. Canonical build

### 4.1 Two profiles, one rendered config

| Profile | Used by | Published or loaded by fleet/live | Settings decided by |
|---|---|---|---|
| `iterate` | `strategy:check` (gates 4–7, §7.1), `cargo test --profile iterate`, `--local-only` runs by default (§7.5), `check` requests of the future build daemon (§11) | never | D18, applied literally |
| `artifact` | every publish (`strategy:publish`, `--strategy-file` auto-publish), `strategy:verify-rebuild`, `strategy:build-live`, `--local-only --profile artifact`, the parity harness, the M5/M6 benchmarks | yes; the only profile workers and the live launcher accept (§8, §10) | §4.2 and §4.6 (proposal, Open question 3) |

Invocation:

```
cargo build --locked --offline --profile <iterate|artifact> --bin <bin> \
  --config <rendered artifact-build.toml> [--features pmb-sdk/real-orders]
```

run from the strategy package root with the host's shared target directory
(§4.5). The `--features` part exists only under option (b) of 20 Open question
1 (§5.5). The builder renders `native/build/artifact-build.toml` by
substituting the host's absolute `CARGO_HOME`, `RUSTUP_HOME` and engine root
and the values of §4.2. The rendered file holds both profiles and MUST be
byte-identical for every command on one host, so no command invalidates
another's cache (requirements-sweep `build-profile-compile-time-disk`). Each
profile has its own output directory under the shared target directory, so
`iterate` and `artifact` builds never evict each other. `describe` reports the
profile name as `buildProfile` (20 §3).

Why two profiles: the D18 measurement (warm rebuild 0.84 s with no LTO and
`codegen-units = 16`, vs 7.3 s with thin LTO and `codegen-units = 1`) is an
argument about iteration time only. A published binary is built once and then
replays thousands of markets on four Macs, or trades live, so its build time
matters far less than its runtime, and speed is the top priority (project
direction 7, 01 Open question 2). Results do not depend on the profile
(below), so splitting costs nothing in correctness.

### 4.2 Profiles and configuration

```toml
[build]
target = "aarch64-apple-darwin"

[profile.iterate]                  # D18, literally
inherits = "release"
opt-level = 3
lto = false
codegen-units = 16
panic = "unwind"
overflow-checks = true
debug = false
strip = "symbols"
incremental = false

[profile.artifact]                 # publish, fleet, live; initial content, final choice per §4.6
inherits = "iterate"
lto = "thin"
codegen-units = 1

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

- `iterate` is D18 for every crate. It serves fast feedback; its bytes are
  never published, so it has no reproducibility requirement beyond determinism
  of results.
- `artifact` sets codegen units and LTO **profile-wide**, not per package. The
  engine runtime is generic over the strategy type (30 §4 rule 1, §16 S9), so
  the hot loop (session, order manager, ledger, simulator, plugins) is
  monomorphized and code-generated in the strategy bin crate, under that
  crate's settings. A per-package `codegen-units = 1` on engine crates would
  therefore not reach the per-candidate cost `C` that 16 §3 names as the main
  sweep lever after M5; profile-wide settings do. (Cargo cannot set `lto` per
  package anyway.) The initial content (thin LTO, `codegen-units = 1`) is the
  WIP release profile (`native/Cargo.toml` `[profile.release]`).
- Both profiles keep `panic = "unwind"` (per-candidate `catch_unwind`, 30 §12)
  and overflow checks on every crate (D18's reason: fixed-point money math,
  10 §2 T3). Turning overflow checks off for third-party crates only is a
  measured candidate of §4.6, not a default.
- Build options do not change results: Rust uses no fast-math and no implicit
  FMA contraction, and both profiles have the same panic and overflow
  behavior, so a profile changes speed, never decisions. This is checked, not
  assumed: the profile-independence check of §7.6 requires byte-identical
  outputs and traces under both profiles.
- `target-cpu` MUST stay the target default (Apple M1 class).
  `target-cpu=native` is forbidden: an M4 build could emit instructions an
  M1 Pro cannot run, and it would break reproducibility across the fleet.
- No build script, environment read or macro may embed time, hostname, user,
  absolute paths or the repository HEAD into the binary. The binary embeds
  only `engineVersion`, `sdkVersion`, `protocolVersion`, the schema version
  lists, `contractSha256`, `PMB_ENGINE_SOURCE_HASH`, `PMB_ENGINE_COMMIT`,
  `PMB_ENGINE_DIRTY`, `PMB_RUSTC`, target, profile name and variant (all
  reported by `describe`, 20 §3). Strategy git provenance lives in the DB row,
  as for TS artifacts (`src/strategy/artifacts/types.ts:61-73`).
- If gate 1 keeps D18 for published artifacts as well (Open question 3),
  `[profile.artifact]` becomes `inherits = "iterate"` with no overrides and the
  rest of this document is unchanged.

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
6. Compute the sha256 of the final bytes.

A failed step fails the build; there is no override flag.

### 4.5 Build hosts

- One shared target directory per host and toolchain (for example
  `~/.cache/pmb/target/<rustc release>`), shared by all strategy packages, so
  engine and registry crates compile once per host per engine revision. Cargo's
  directory lock serializes concurrent builds; the builder runs one build at a
  time per host.
- On hosts that run backtests, builds MUST cap jobs (`CARGO_BUILD_JOBS`, value
  set in `40`) and SHOULD run with background QoS (`taskpolicy -b`), which
  restricts them to efficiency cores and leaves performance cores to backtests
  (40 §7.3). Interactive builds on the author's machine run unthrottled. The
  effect on build time and on backtest throughput MUST be measured (M5, `16`).
- Disk: the target directory has a size budget with periodic GC; the local
  artifact cache has the LRU policy of 40 §9. `native/target` was already
  443 MB with the disk at 100% (requirements-sweep
  `build-profile-compile-time-disk`). Two profiles roughly double the
  compiled dependency set per host; the budget accounts for both.
- `artifact` builds are the heavy ones (cross-crate LTO, one codegen unit;
  fat LTO links largely single-threaded). Their wall time (cold, and warm after
  a one-line strategy change) is recorded in the build manifest (§5.4) of every
  publish, so the cost is visible per host and per engine revision.

### 4.6 Choosing the `artifact` profile (M5)

The M5 benchmark (16 §11.2) chooses the final `artifact` settings from these
candidates, each measured on top of the previous best:

| Candidate | Note |
|---|---|
| D18 for all crates (= `iterate`) | baseline |
| thin LTO, `codegen-units = 1` | initial content of §4.2 |
| fat LTO, `codegen-units = 1` | one LLVM module for the whole program; tends to win when hot code crosses crate boundaries |
| best of the above, third-party crates without overflow checks (`[profile.artifact.package."*"] overflow-checks = false`, re-enabled for every engine crate) | Parquet decoding is about 50% of a market's profile (early-audits C), and third-party crates are written for release builds without overflow checks; engine and strategy crates keep them (D18) |
| best of the above plus PGO with an engine-owned profile file committed under `native/build/pgo/` (part of the engine source set, §5.3) | A shared profile only matches non-generic engine code (decode, tape, book): monomorphized generic code has strategy-specific symbols, so a profile collected with one strategy does not apply to another. Per-artifact PGO (instrumented build, fixture run, rebuild) roughly triples publish time; it MAY be measured but is not planned |

Requirements on the measurement and the rule (for 16 §11.2 to adopt):

1. Metrics: end-to-end throughput on `recent-1k` (16 §13.1), per-candidate
   cost `C` on a candidate-group bench (16 §3), and `artifact` build time
   (cold, warm) at background QoS, on this host in M5 and on an M4 mini in M6.
2. A candidate is eligible only if it passes the profile-independence check
   (§7.6) and D17 byte reproducibility: two clean builds on this host give
   identical bytes (M5). The four-Mac comparison follows in M6 (§7.6); a
   candidate that fails there is replaced by the next eligible one.
3. Build time of `artifact` is reported, not gated: it is paid once per
   published artifact. 16 §11.2 currently applies a warm-rebuild ceiling of
   60 s to any faster published profile; with this split that ceiling belongs
   to `iterate` only, and 16 §11.2 needs a row "D18 `iterate` + `artifact`
   publish profile".
4. Proposed adoption rule (owned by 16 §11.2, confirmed at gate 1): adopt the
   fastest eligible candidate whose gain over the next cheaper one exceeds the
   measured run-to-run spread (16 §13.5). The chosen settings and numbers go
   into the M5 report (16 §13.8). A profile change alters
   `PMB_ENGINE_SOURCE_HASH` (`native/build/**` is in the engine source set,
   §5.3) but not results, so existing artifacts keep their outputs and reach
   the new speed only by rebuild (§7.4).

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
| `target`, `profile` | build selectors; `profile` is `artifact` for every published row (`iterate` appears only in local manifests, §7.5); the variant and features are **not** included (§5.5) |
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
different bytes on two hosts.

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

Every published artifact has a JSON build manifest next to it (§6.1): the
source-hash input of §5.2 with the full file list, the rendered flags with host
paths replaced by their remap targets, toolchain provenance (§6.2), git
provenance, the build wall time (§4.5) and the `describe` output. Anyone can
recompute the source hash and replay the build from it.

### 5.5 Variants (conditional on 20 Open question 1)

Which variants exist depends on the gate-1 answer to 20 Open question 1
(real-order capability vs artifact identity). This document is complete under
either answer. 50 §13.3 and §17 currently describe option (b) and depend on the
same answer.

| | Option (a): one binary | Option (b): two builds from one source |
|---|---|---|
| Variants | `standard` only. It contains the CLOB V2 adapter; real orders are gated only at runtime (20 §7 flag and config, the §10 checks, the key lock). | `standard` (fleet, backtest, paper) and `real-orders` (built with `--features pmb-sdk/real-orders`, D05). |
| Binary loaded for real orders | The verified standard artifact itself: the same sha that was backtested. | The `real-orders` build, linked to the standard artifact by `source_hash` and `parent_sha256`. |
| R2 | `strategy-artifacts/native/` only | plus `strategy-artifacts/native-live/` (audit copy, never read by workers) |
| §10 step 6.3 | dropped | applies |
| Columns `variant`, `parent_sha256` | always `standard` and null | as below |

Both variants are built with the `artifact` profile (§4.1). Under option (b):

- `standard` is the only variant the fleet runs and the only one published
  under `strategy-artifacts/native/`. Workers MUST refuse any other variant
  (`describe` reports `capabilities.realOrders`, 20 §5.1).
- `real-orders` is built only by `strategy:build-live` on the live host, from
  the tree that the verified rebuild of §10 has just reproduced, and only by
  the user: the agent never builds or runs the real-order feature against
  production (00 R10). The row records `parent_sha256` = the standard artifact;
  both share one `source_hash` (§5.2 excludes variant and features), which is
  the check 50 §17 requires. The binary and its manifest are stored for audit
  under `strategy-artifacts/native-live/`, which workers never read.

### 5.6 Dedupe

At publish, after the build:

1. If the sha is already in `strategy_artifacts`, the publish is a no-op
   (`already published`), as for TS (`src/strategy/artifacts/publish.ts:173-182`).
2. Else, if a row with the same `source_hash`, `target`, `variant` and
   `build_profile` exists, the publish MUST reuse that row's sha (the new bytes
   are not uploaded) and record a reproducibility observation (host, built sha,
   toolchain provenance) for that artifact.
3. Else, a new artifact is published.

## 6. Storage

### 6.1 R2 and local cache

| Object | Key |
|---|---|
| Standard binary | `strategy-artifacts/native/<sha>` (existing prefix, `src/strategy/artifacts/native.ts:23-28`) |
| Build manifest | `strategy-artifacts/native/<sha>.build.json` |
| Real-orders binary and manifest (option (b) of §5.5 only) | `strategy-artifacts/native-live/<sha>`, `<sha>.build.json` |
| Local cache | `data/strategy-artifacts/native/<sha>`, mode 0755 (`native.ts:30-32`); verify-once marker, size cap, LRU and prefetch per 40 §9 |

Upload is skip-if-exists with a size check and Content-MD5, as the TS publish
does (`publish.ts:170-190`). Binaries referenced by any run row MUST NOT be
deleted from R2; retention of unreferenced binaries belongs to the later
retention script (D15, 01 follow-up F3).

### 6.2 `strategy_artifacts` row

The migration and the dashboard mirror are owned by 42 §3.6, which already
adds `kind` (`'js'|'native'`, default `'js'` for existing rows), `target`,
`rustc`, `engine_version`, `sdk_version`, `protocol_version`, `source_hash`,
`lock_hash` and `build_profile`. This document needs the following
**additional** fields, which 42 §3.6 MUST add:

| Column | Content |
|---|---|
| `variant`, `parent_sha256` | §5.5 (under option (a): always `standard` and null) |
| `engine_source_hash`, `engine_dirty` | §5.3 (`engine_commit`, an existing column, holds `engineCommit` of §5.3 for native rows) |
| `package_name`, `bin_name`, `engine_rel_path` | §2.2 (`entrypoint`, existing, holds the repo-relative path of `src/bin/<name>.rs`) |
| `capabilities` (JSON) | the `binary` and `capabilities` objects of `describe` (20 §5.1), including the schema version lists |
| `params_schema` (JSON) | 30 §9 rule 8 |
| `rebuilt_from_sha256` | §7.4 |

Further rules:

- The `kind` column replaces native detection by R2 URL substring
  (`src/cli/helpers/strategyArgs.ts:232,269`).
- `built_with` (existing, widened by 42) holds
  `{ rustc, macosSdk, ld, cc, host }` for native rows.
- `format_version` holds the native artifact format version (starting at 1),
  independent of the JS `ARTIFACT_FORMAT_VERSION`.
- `build_profile` is `artifact` for every row; publish refuses an `iterate`
  build (§7.2).
- Reproducibility observations (§5.6) and verified rebuilds (§7.4) are
  recorded per artifact with host, time, built sha, match flag and toolchain
  provenance, in a child table or JSON column chosen by `42`.
- The index on `source_hash` (42 §3.6) SHOULD include `target`, `variant` and
  `build_profile`, the dedupe key of §5.6.

## 7. Pipelines

All commands run through the TS CLI, and through `pte` from any directory
(`docs/reference/pte-cli.md`). The language is detected from the file (`.rs`
vs `.ts`) or from a `Cargo.toml` with `[package.metadata.pmb]`.

### 7.1 `strategy:check -- --repo <dir>` (Rust)

| # | Gate | Skippable at publish |
|---|---|---|
| 1 | Toolchain and package rules (§2.2), lock subset (§3) | no |
| 2 | `cargo fmt --check` | yes |
| 3 | Clippy with the engine-owned config: `CLIPPY_CONF_DIR=<engine>/native/build/clippy`, `-D warnings`, determinism lints with `-F` (30 §11) | no |
| 4 | `cargo test --profile iterate --locked --offline` (testkit, and `testkit::bench` for the ns/callback report of gate 7, 30 §15), under a deny-network sandbox profile that allows writes only to the target directory | yes |
| 5 | Canonical build of every bin with the steps of §4.4 (including `selftest`): `iterate` profile in `strategy:check` (`--profile artifact` builds exactly what a publish builds); `artifact` profile in a publish | no |
| 6 | `describe` of every bin built in gate 5, with default params: id grammar and uniqueness, `paramsSchema`, requirements | no |
| 7 | Behavioral smoke of the gate-5 binaries on the committed fixture markets (`60`): run-group of `[p, p]` and of reversed candidates equals standalone runs; declared interests equal all interests (30 §4.1); ns/callback report (30 §16 S11) | no |

Gates 1, 3, 5, 6 and 7 guard against silent cross-machine or cross-candidate
divergence and are cheap with a warm target directory (in a publish, gate 5 is
the `artifact` build itself, which a publish needs anyway). `--skip-checks`,
and the `--strategy-file` auto-publish (skip-checks semantics today,
`docs/strategy/external-artifacts.md:136`), therefore skip only gates 2 and 4.
The TS `strategy:check` (`src/strategy/artifacts/externalRepoCheck.ts:32-144`)
stays unchanged for `.ts` sources.

### 7.2 `strategy:publish` and `--strategy-file`

`strategy:publish -- --repo <dir> --bin <name>` (or
`--entrypoint src/bin/<name>.rs`), and `backtest` or the paper/live launcher
(`50`) with `--strategy-file <pkg>/src/bin/<name>.rs` (auto-publish):

1. Resolve package and bin; refuse an entrypoint outside the repository.
2. Provenance: strategy repository remote, commit and dirty flag; engine
   commit and dirty flag (§5.3). A dirty strategy tree is refused unless
   `--allow-dirty` (`publish.ts:82-86`); the flag is recorded either way.
3. Gates of §7.1, minus the skippable ones when skipping. Gate 5 builds with
   the `artifact` profile (sha, source hash), and gates 6 and 7 run on that
   binary, so the checked bytes are the published bytes. A request for the
   `iterate` profile is refused.
4. Dedupe (§5.6).
5. Id checks: the `describe` id equals the bin's `ID`; it MUST NOT collide with a
   TS registry id or with an id published as `kind = 'js'` (30 §4). Several
   shas MAY share an id, as for TS.
6. Upload binary and build manifest (§6.1).
7. Insert the row (§6.2).
8. Prime the local cache.

Publishing is idempotent and has no fallback: every failure is a loud error,
as for TS artifacts (`docs/strategy/external-artifacts.md:175-190`).

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
  the recorded profile (`artifact`) and variant and compares shas. Both commits MUST be fetchable from
  their remotes. The result is recorded (§6.2). Refused for rows with
  `source_dirty` or `engine_dirty`.
- `strategy:rebuild -- --sha <sha> [--engine <commit>|current]`: rebuilds the
  recorded strategy source against another engine and publishes the result with
  `rebuilt_from_sha256`, so an old strategy can be compared on a newer engine
  (requirements-sweep `engine-in-binary-versioning`).

### 7.5 Branch phase and local-only mode

- `--local-only` builds with the `iterate` profile by default (fast
  feedback) or with `--profile artifact`, runs the gates a publish runs on that
  binary, writes the binary and its build manifest only to the local cache, and
  touches neither R2 nor the DB. It serves offline development and the parity
  harness. The parity harness uses `--profile artifact`, so parity runs
  exercise the bytes that will be published and double as throughput
  measurements. Workers and the live launcher never accept an `iterate`
  binary (§8, §10).
- Before gate 2 only m1-ivan runs native jobs (40 §13 phase A). Publishes then
  write their row to the branch dev schema (42 §2 rule 4), never to the shared
  production schema, and do not upload to the shared R2 bucket; binaries stay
  in the local cache.

### 7.6 CI

Engine CI runs gates 1–4 and 6 of §7.1 on `native/strategies/` on every push.
The canonical build and the reproducibility proof need macOS; the runner or
fleet canary is chosen in `60-verification.md` (CI is `ubuntu-latest` today,
`.github/workflows/quality.yml:185-217`).

- **Profile-independence check.** `engine-exerciser.rs` and
  `overnight-opus55-lagsnipe.v15.rs`, built with `iterate` and with
  `artifact`, MUST produce byte-identical `RunSingleMarketOutput`s and
  canonical traces (22) on the committed fixture markets (`60`). It runs in M5
  for every candidate of §4.6 and on every change to
  `native/build/artifact-build.toml`; a difference is an engine bug (for
  example a float expression whose result depends on inlining).
- **Reproducibility proof (M6).** The same source is built with the
  `artifact` profile on all four fleet Macs and the shas are compared; on a
  mismatch the builder diffs the Mach-O load commands to name the cause (Open
  question 1).

## 8. Producer resolution via `describe`

For `--strategy-artifact <sha>` and `--strategy-file`, the TS producer MUST:

1. Read the row; the artifact kind comes from `kind`, never from the URL.
2. Ensure the binary locally (download, sha verify; `native.ts:49-84`, 40 §9).
3. Refuse before building any job when: `target` matches no native worker
   target; `variant` is not `standard`; `buildProfile` is not `artifact`;
   `protocolVersion` or every offered
   `jobSchemaVersion` is unsupported (20 §3); the sha or engine version is on
   the blocklist (40 §11); a requested flag, input mode or profile is missing
   from `capabilities` (requirements-sweep `native-flag-matrix`, 20 §5.1).
4. Run `describe` with the raw params (the `--params-file` batch form for
   candidate files, 20 §5.1, 41 §3.4): invalid params are a CLI error; the
   returned id MUST equal the row's `strategy_id`; the normalized params are
   what is stored on the run; `requiredFeeds` (TS `ExternalFeedsRequestConfig`
   shape) and the plugin requirements feed the existing eligibility and
   preflight code.
5. Cache `describe` results per (sha, canonical raw params) for the process.
6. On `--extend`, run `describe` with the stored typed params and require the
   normalized result to equal them, compared as in 30 §9 rule 10 (numbers by
   value, absent `Option` fields omitted on both sides).
7. Put `{ sha256, r2Url, kind: 'native', target }` in jobs (workers stay
   DB-free, `src/strategy/artifacts/types.ts:38-46`) and copy `engineVersion`,
   `engineCommit`, `engine_source_hash` and the sha into run provenance (D09,
   42 §4).

The producer MUST NOT build a TS `Strategy` object for a native artifact (the
WIP returns an inert placeholder, `strategyArgs.ts:300-312`); paths that need
one, such as the dashboard simulator, refuse native runs (D10).

## 9. Publish authorization and trust

| Context | Trust anchor |
|---|---|
| Fleet backtests, paper | Whoever can write `strategy-artifacts/native/` in R2 and insert into `strategy_artifacts`, plus sha verification on every host. Binaries run with an allowlisted environment under a deny-network sandbox (20 G6, 40 §6.2). |
| Live with real orders | A verified reproducible rebuild on the live host from clean, pushed commits (§10). The publisher's claims are not trusted. |

- In this goal only the user and the implementation session on m1-ivan publish
  native artifacts (D16). Workers never publish. Agents get no Rust authoring
  tasks until the follow-up goal.
- A native binary is opaque, unlike a ~30 KB readable TS bundle, so review
  means reviewing the source at the recorded commits and proving the binary
  comes from it (D17).
- Strategy packages cannot add dependencies, build scripts or proc macros
  (§2.2), so a build executes no strategy-authored code; tests do, and they run
  sandboxed (§7.1 gate 4).
- The protocol sandbox can reach R2 today (`*.r2.cloudflarestorage.com`,
  polymarket-protocols `srt-settings.template.json:67`) and TS launchers publish
  from inside it. Credentials reachable there could therefore also write native
  binaries that then run on every fleet Mac, including the live-key machine
  (`docs/strategy/external-artifacts.md:194-201`). See Open question 2.

## 10. What live requires before loading a binary

The TS launcher (`50-live-runtime.md`, trust check row) MUST check, in this
order, and refuse with a specific message on the first failure. The binary
then applies its own gate (20 §7).

1. The row exists, `kind = 'native'`, `build_profile = 'artifact'`, and
   `target` equals the host target.
2. The local binary's sha equals the requested sha; `codesign --verify` and the
   dylib allowlist pass.
3. `describe` succeeds with the launch params and reports the needed
   subcommand (`paper` or `live`) and a supported `protocolVersion`.
4. `engineVersion` is at or above the live-safe minimum and neither the sha nor
   the engine version is on the blocklist (minimum owned by `50`; blocklist
   40 §11).
5. Paper: no further check (paper never sends orders, D28).
6. Real orders additionally require:
   1. `source_dirty = false` and `engine_dirty = false`;
   2. a successful `strategy:verify-rebuild` of the standard artifact on this
      host, with the host's current `rustc` and macOS SDK equal to those
      recorded in that verification; under option (a) of §5.5 this verified
      standard artifact is the binary that is loaded;
   3. only under option (b) of §5.5: a `real-orders` variant built by the user
      with `strategy:build-live` from that verified tree, sharing its
      `source_hash`; this is the binary that is loaded;
   4. the explicit real-order flag and config of 20 §7 (D05). The AI agent never
      passes it (00 R10).

The launcher SHOULD warn when the standard sha has no completed backtest run
under the profile being launched. Every check result is written to the live
journal (`22`).

## 11. Future: agent authoring from polymarket-protocols

Not in this goal (D16). The pipeline above MUST NOT require cargo, a Rust
toolchain or publish credentials inside the sandbox, so the follow-up can add
an out-of-sandbox build daemon without changing it:

1. A per-host daemon (launchd, outside srt, on hosts that run Global Runtime
   sessions) watches a spool under `data/strategy-artifacts/build-requests/`, a
   path the sandbox can already write (polymarket-protocols
   `srt-settings.template.json:30`).
2. A request names the protocol, package path, bin, kind, mode and an
   idempotency key. Kind `check` runs `strategy:check` (`iterate` profile,
   diagnostics only); kind `publish` runs the publish of §7 (`artifact`
   profile). Mode `snapshot` copies the package's working tree into a staging
   directory (dirty, backtests only); mode `commit` builds a pushed commit from
   a clean checkout (eligible for live). The daemon checks that the package lies
   inside the requesting protocol's folder and that this host owns the protocol.
3. The daemon runs `strategy:check` and the publish of §7 with its own
   credentials, the shared target directory, the job cap and background QoS of
   §4.5, and a per-request timeout.
4. It writes `build-results/<request>.json`: the sha, or every diagnostic with
   remapped paths (compiler, clippy, tests, gates), so an agent that cannot run
   cargo can still iterate. A warm `check` is expected to take about one
   second plus link time (D18 measurement); a `publish` takes the `artifact`
   build time reported by M5 (§4.6). If that time limits agent throughput, the
   follow-up goal decides how often agents publish versus check.
5. The sandboxed launcher waits for the result and runs
   `--strategy-artifact <sha>`.

Agent-facing material comes from 30 §17 (rustdoc, CONTRACT, examples).

## Open questions

1. **Byte reproducibility across hosts (D17).** If hosts with the same pinned
   rustc produce different bytes because their Xcode Command Line Tools differ
   (macOS SDK version in the Mach-O build-version command, linker, C compiler
   for zstd), the live gate of §10 fails for artifacts built elsewhere. Should
   we (a) pin one Command Line Tools version on every builder and the live
   host, (b) build live-bound artifacts only on the live host, or (c) accept an
   equal source hash plus identical output on the fixture markets as live
   equivalence? The M6 four-Mac build comparison (§7.6) will show whether this
   happens.
2. **Publish credentials.** Should native binaries go to a separate R2 bucket
   (or token) whose write credential exists only on builder hosts, so that no
   credential reachable from the protocol sandbox can publish an executable
   that runs on the live-key machine?
3. **Separate publish profile (amends D18; answers 01 Open question 2).** D18
   says one fast-compile profile for check, iterate and publish. This document
   keeps D18 for checks and local iteration (`iterate`) but builds every
   published, fleet and live binary with a speed-optimized `artifact` profile
   (initially thin LTO with one codegen unit; final settings chosen by the M5
   measurement of §4.6, judged on runtime and reproducibility, with build time
   reported but not gated). Results are identical under both profiles
   (checked, §7.6); the cost is a slower publish build (warm about 7 s with
   thin LTO by the earlier measurement; fat LTO or PGO slower). Do you accept
   this split at gate 1? If not, `artifact` equals `iterate` (§4.2, last
   bullet).
4. **Variants.** §5.5, §6.1 and §10 step 6.3 depend on the gate-1 answer to
   20 Open question 1 (one binary gated at runtime, or a separate
   `real-orders` build). No separate decision is needed here.
