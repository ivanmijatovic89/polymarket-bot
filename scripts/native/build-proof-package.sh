#!/usr/bin/env bash
# Create a throwaway, std-only strategy package for the builder proof of
# M1 step 5 (31 §4, §5.1; D17): until pmb-sdk exists, it stands in for a
# strategy package. Its bin answers `describe` and `selftest` with fixed JSON
# (plus the engine identity the builder embeds through the rendered
# artifact-build.toml), so the canonical builder can run every post-link step.
#
#   scripts/native/build-proof-package.sh <new dir>
#   npm run strategy:publish -- --local-only --repo <new dir>/strategies --bin builder-proof
#
# Building it from two different directories must give the same sha256
# (31 §4.3: the bytes do not depend on where the package sits).
set -euo pipefail
if [ $# -ne 1 ]; then
  echo "usage: $0 <new directory>" >&2
  exit 2
fi
ROOT="$1"
ENGINE="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -e "$ROOT" ]; then
  echo "$ROOT already exists" >&2
  exit 2
fi
PKG="$ROOT/strategies"
mkdir -p "$PKG/src/bin"
cp "$ENGINE/native/rust-toolchain.toml" "$PKG/rust-toolchain.toml"
printf 'target/\n' >"$ROOT/.gitignore"
printf 'target/\n' >"$PKG/.gitignore"
cat >"$PKG/Cargo.toml" <<'EOF'
[package]
name = "proof-strategies"
edition = "2021"
version = "0.0.0"
publish = false

[workspace]

[package.metadata.pmb]
format = 1

[lints.rust]
unsafe_code = "forbid"
EOF
cat >"$PKG/src/lib.rs" <<'EOF'
//! Code shared across strategy versions (31 §2.2 layout).

/// Strategy id of the proof bin (30 §4 rule 2 grammar).
pub const ID: &str = "builder-proof.v1";
EOF
cat >"$PKG/src/bin/builder-proof.rs" <<'EOF'
//! Std-only stand-in for a pmb-sdk strategy (pre-SDK builder proof). Its
//! main needs args, stdout and exit, which `strategy_main!` will own once
//! pmb-sdk exists; until then the determinism lints run at deny level and
//! this file allows them (pre-SDK phase of the builder).
#![allow(
    clippy::print_stdout,
    clippy::disallowed_macros,
    clippy::disallowed_methods,
    clippy::disallowed_types
)]

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("describe") => println!(
            "{{\"type\":\"describe\",\"protocolVersion\":2,\"binary\":{{\"engineVersion\":\"0.0.0\",\"engineCommit\":\"{}\",\"engineDirty\":{},\"engineSourceHash\":\"{}\",\"sdkVersion\":\"0.0.0\",\"rustc\":\"{}\",\"target\":\"aarch64-apple-darwin\",\"buildProfile\":\"{}\"}},\"capabilities\":{{\"subcommands\":[\"describe\",\"selftest\"],\"realOrders\":false}},\"strategy\":{{\"id\":\"{}\"}}}}",
            env!("PMB_ENGINE_COMMIT"),
            env!("PMB_ENGINE_DIRTY"),
            env!("PMB_ENGINE_SOURCE_HASH"),
            env!("PMB_RUSTC"),
            env!("PMB_BUILD_PROFILE"),
            proof_strategies::ID
        ),
        Some("selftest") => println!("{{\"type\":\"selftest\",\"ok\":true,\"checks\":[]}}"),
        _ => std::process::exit(2),
    }
}
EOF
(cd "$PKG" && cargo generate-lockfile --offline -q)
git -C "$ROOT" init -q
git -C "$ROOT" add -A
git -C "$ROOT" -c user.name=builder-proof -c user.email=builder-proof@localhost commit -q -m "builder proof package"
echo "$PKG"
